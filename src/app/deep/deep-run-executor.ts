/**
 * DeepRunExecutor —— manager 决策 action loop（deep 一期，T2-3/T2-6/T2-7，ADR-0025 §5.3）。
 *
 * 本文件实现 DeepRuntime manager 的逐 step 决策循环：
 *   - 每个 step 通过 AgentTurnRuntime 调模型产出 {@link DeepDelegationDecision}；
 *   - 分发到 manager 动作分支（direct_answer / spawn_children / wait_children /
 *     continue_child / synthesize / ask_user / stop），每个分支都可执行；
 *   - run 启动时冻结 {@link BasicAgentCapabilitySnapshot}，保证运行中能力边界稳定（FR-003）；
 *   - manager 在证据不足时按模型决策走 spawn_children（继续派生 child 探索）或
 *     ask_user（向用户澄清），**不伪装成已完成判断**；
 *   - 无可用模型时拒绝运行（需求 A3，AI-first 边界，不 fallback 伪装）。
 *
 * T1-4 多 Agent 最小协作闭环（design.md §3.3）：spawn_children/wait_children/synthesize/control
 * 四分支接入 {@link DeepTaskBoard}（运行中权威状态）与 {@link DeepChildScheduler}（并发调度）：
 *   - spawn_children：去掉串行 `for...of await`，改为 derive→`scheduler.enqueue`→
 *     `scheduler.startQueued`（并发 fire-and-forget，不要求全部完成）→ 立即下一 step；
 *     首次 spawn 后装配 {@link DeepResearchBrief}（目标明确自动进入探索，FR-BRIEF-02/03）；
 *   - wait_children：从 no-op 改为 `scheduler.waitForProgress` 真实等待在途 child，合并新终态材料
 *     进 childSummaries/completedChildRuns，并发槽空闲且有 pending 时 `startQueued` 继续（FR-WAIT-01/02）；
 *   - continue_child：父层审查已有 child 后，给同一个 child run 追加指令，复用标准
 *     child Agent loop 继续工作，完成后按 childRunId 替换父层材料；
 *   - synthesize：仍有 pending/running 时先 `scheduler.waitForAllQueued` 清场（FR-SAFE-03）；无任何 child 材料
 *     时拒绝综合走 ask_user/failed guard（防伪造结论，FR-SAFE-03）；
 *   - control point（interrupt/stop）：调 `scheduler.cancelPendingAndRunning`（pending 取消、
 *     board 置 stopped 使此后 startQueued no-op）+ drain 在途材料保留（FR-SAFE-02，本轮不真 abort 模型调用）；
 *   - step 边界 `board.setPhase` 切相位（planning/deciding/exploring/waiting/synthesizing/completed/stopped...）。
 *
 * T2-7 打断/纠正/停止（FR-008）：manager step 循环之间注入 control point（{@link DeepRunControlHandle}）。
 *   - interrupt：停止循环，drain 在途材料保留，run 置 interrupted；
 *   - correct：携带补充上下文注入下一 manager 决策 step（经 deep-model-io correctionContext 传播）；
 *   - stop：停止运行，drain 在途材料后尝试产出 partial conclusion（经综合），run 置 stopped。
 *   control 不破坏已产出材料（FR-008）。
 *
 * 设计边界（ADR-0025 决策一 AI-first）：
 *   - 所有决策 source:"ai"（由 deep-model-io 解析器产出）；executor 不合成
 *     deterministic_fallback 决策，也不在证据不足时自行伪装 direct_answer/synthesize。
 *   - executor 只执行模型决策 + 守边界（depth guard、child 数量上限、
 *     assertNoDirectChildOutputHandoff），不替代模型的语义判断（FR-003/FR-005）。
 *
 * 复用边界：
 *   - 经 deep-manager-turns 复用 AgentTurnRuntime 调模型；
 *   - 复用 child Agent runner 做 child 探索（默认 scheduler 工厂经 exploreDeepChild 兼容包装封装）；
 *   - 复用 DeepChildScheduler/DeepTaskBoard（闭环1-A 产出）做并发调度与运行中权威状态；
 *   - 复用 deep-model-io（契约/消息/解析器，含 correctionContext + task board 摘要投影，T2-7/T1-5）；
 *   - 复用 parent-synthesis.synthesizeDeepConclusion 做父层综合（T2-5 抽取，不再内联）；
 *   - 复用 domain/underground/agent-fabric.assertNoDirectChildOutputHandoff 守 FR-005 硬约束。
 *
 * 模块边界：synthesize 分支委托 parent-synthesis.ts（T2-5）；spawn/wait 分支委托 scheduler（T1-3）；
 * 父层综合与决策由模型完成（AI-first 边界），executor 只执行模型决策 + 守边界。
 *
 * 命名红线（ADR-0025 决策三）：产物统一 SynthesizedConclusion/DeepExplorationReport，不出现
 * Plan/directionHandoffPackage/artifact/Fruits；DeepResearchBrief 是低心智计划投影，非 Plan。
 */
import type { ToolConfirmationPolicy } from "../../domain/tools/contracts.js";
import type { BasicAgentCapabilitySnapshot } from "../../domain/config/contracts.js";
import type { TaskSoil } from "../../domain/soil/task-soil.js";
import type { ChildAgentRun, ParentSynthesisResult } from "../../domain/underground/agent-fabric.js";
import type { AgentTurnRuntime } from "../../kernel/intelligence/agent-turn-runtime.js";
import { nowIso, type IdFactory } from "../../kernel/id.js";
import type {
  DeepConversation,
  DeepDelegationAction,
  DeepDelegationDecision,
  DeepFollowUpContext,
  DeepIntakeContext,
  DeepRun,
  DeepRunStatus,
  DeepChildSpec,
  DeepChildSummary,
  DeepResearchBrief,
  DeepTaskBoardSnapshot,
  SynthesizedConclusion,
} from "./contracts.js";
import {
  DEEP_DECISION_CONTRACT_ID,
  DEEP_DIRECT_ANSWER_CONTRACT_ID,
} from "./deep-model-io.js";
import type { DeepRunControlEvent, DeepRunControlHandle } from "./deep-run-control.js";
export {
  createDeepRunControlHandle,
} from "./deep-run-control.js";
export type {
  DeepRunControlEvent,
  DeepRunControlHandle,
  DeepRunControlSignal,
} from "./deep-run-control.js";
import { DEEP_MANAGER_AGENT_ID, DEEP_MAX_CHILDREN } from "./child-delegation.js";
import { synthesizeDeepConclusion, buildParentSynthesisRecord } from "./parent-synthesis.js";
import {
  attemptDeepPartialSynthesis,
  buildDeepManagerInputRefs,
  collectDeepChildEvidenceRefs,
  describeDeepManagerTurnError,
  runDeepDirectAnswerTurn,
  runDeepManagerDecisionTurn,
} from "./deep-manager-turns.js";
import { DeepChildScheduler } from "./deep-child-scheduler.js";
import type {
  DeepChildExecutedQueuedInstruction,
  DeepChildSchedulerCallbacks,
  DeepChildTerminalMaterial,
} from "./deep-child-scheduler-contracts.js";
import type { DeepTaskBoard } from "./deep-task-board.js";
import {
  backfillDeepSpawnedChildren,
  buildDeepResearchBrief,
  createDeepDefaultScheduler,
  deepTaskBoardPhaseForRunStatus,
  mergeDeepTerminalMaterials,
  waitForDeepChildTerminalForReview,
} from "./deep-run-scheduler-support.js";

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** manager 决策循环默认 step 上限（防失控；模型可在 stop 动作提前终止）。 */
export const DEEP_STEP_LIMIT = 6;

/** manager 决策/直接回答/综合 turn 默认只做单轮纯推理（工具调用并入 child 探索）。 */
export const DEEP_MANAGER_MAX_MODEL_ROUNDS = 1;
export const DEEP_MANAGER_MAX_TOOL_ROUNDS = 0;

/**
 * EP1/EP2：manager 决策 / direct_answer 模型轮的失败重试上限。
 *
 * 覆盖两类失败：模型 turn 瞬时异常（网络/超时/provider 抖动）与输出解析失败
 * （schema 校验错误）。重试预算共享：任一类失败都消耗一次重试；重试成功则正常返回，
 * 重试耗尽仍失败则向上抛出（run 失败，不伪造决策，守 AI-first 边界）。
 */
export const DEEP_MANAGER_MAX_RETRIES = 1;

/** EP1：模型轮瞬时失败重试的线性退避基准（毫秒），实际退避 = 基准 × 当前尝试序号。 */
export const DEEP_TURN_RETRY_BACKOFF_MS = 400;

// ---------------------------------------------------------------------------
// 运行进度事件
// ---------------------------------------------------------------------------

export type DeepRunProgressEvent =
  | {
      readonly kind: "decision.started";
      readonly stepIndex: number;
      readonly recordedAt: string;
    }
  | {
      readonly kind: "manager.decided";
      readonly stepIndex: number;
      readonly decision: DeepDelegationDecision;
      readonly recordedAt: string;
    }
  | {
      readonly kind: "child.started";
      readonly stepIndex: number;
      readonly childRun: ChildAgentRun;
      readonly childSpec: DeepChildSpec;
      readonly recordedAt: string;
    }
  | {
      readonly kind: "child.completed";
      readonly stepIndex: number;
      readonly childRun: ChildAgentRun;
      readonly summary: DeepChildSummary;
      readonly recordedAt: string;
    }
  | {
      readonly kind: "synthesis.started";
      readonly stepIndex: number;
      readonly recordedAt: string;
    }
  | {
      readonly kind: "synthesis.completed";
      readonly stepIndex: number;
      readonly synthesisRecord: ParentSynthesisResult;
      readonly conclusion: SynthesizedConclusion;
      readonly recordedAt: string;
    };

export type DeepRunProgressObserver = (event: DeepRunProgressEvent) => void | Promise<void>;

// ---------------------------------------------------------------------------
// 配置与输入/输出类型
// ---------------------------------------------------------------------------

/**
 * DeepRunExecutor 配置。turnRuntime 是 manager/child/synthesis 共用的 AgentTurnRuntime
 * （封装 IntelligenceChannel + 可选 ToolCenter/确认门）。
 *
 * T1-4 新增 scheduler 注入位（design.md §3.3 配置扩展）：
 *   - `scheduler`：外部注入的 scheduler（T2-1 runtime 装配 board + exploreFactory + 生命周期
 *     回调后注入）。省略时 executor 内部创建默认 board+scheduler（默认 exploreFactory 封装
 *     child Agent run + run 上下文），使本任务在不改 runtime 的前提下即具备真实并发语义。
 *   - `maxConcurrency`：默认 scheduler 并发上限（仅 scheduler 省略时生效）。
 */
export type DeepRunExecutorConfig = {
  readonly turnRuntime: AgentTurnRuntime;
  readonly stepLimit?: number;
  readonly maxChildren?: number;
  /** Optional neutral child identity capability; defaults to the runtime UUID factory. */
  readonly childIdFactory?: IdFactory;
  readonly managerMaxModelRounds?: number;
  readonly managerMaxToolRounds?: number;
  /**
   * EP1/EP2：manager 决策 / direct_answer 模型轮的失败重试上限（默认 DEEP_MANAGER_MAX_RETRIES）。
   * 见该常量注释的失败语义与 AI-first 边界。
   */
  readonly managerMaxRetries?: number;
  /**
   * 运行中安全进度投影观察者。只用于 Panel read-model 实时刷新，不参与 manager 语义决策。
   */
  readonly onProgress?: DeepRunProgressObserver;
  /**
   * manager 已选择终态动作后，在分发该动作前停止新的 child control 准入，
   * 并等待已接收操作完成。这是执行一致性屏障，不属于可吞错的进度投影。
   */
  readonly sealChildControl?: () => void | Promise<void>;
  /**
   * T1-4：scheduler 注入位。T2-1 runtime 装配 board+exploreFactory+生命周期回调后注入，
   * 使 child 生命周期事件在真实状态变化时实时发布（FR-PROJ-02，闭环2）。省略时 executor
   * 内部创建默认 scheduler（无生命周期回调，投影权威化在闭环2 由 runtime 注入补齐）。
   */
  readonly scheduler?: DeepChildScheduler;
  /** T1-4：默认 scheduler 并发上限（仅 scheduler 省略时生效，默认 DEEP_SCHEDULER_DEFAULT_CONCURRENCY）。 */
  readonly maxConcurrency?: number;
};

/**
 * manager 决策循环停止原因。`no_model_rejected` 为 AI-first 边界拒绝；`interrupted`/
 * `stopped_by_control` 为 T2-7 用户打断/停止（FR-008）；其余为模型决策终止或循环边界收束。
 */
export type DeepRunStopReason =
  | "direct_answer"
  | "synthesized"
  | "ask_user"
  | "stopped"
  | "interrupted"
  | "stopped_by_control"
  | "step_limit_reached"
  | "no_model_rejected"
  | "failed";

/**
 * 单个 step 的可观察记录（决策 + 分发动作 + 该 step 产出的 child/守卫信息）。
 * 用于复盘 manager→child→综合→结论推理路径（FR-009 可复盘侧）。
 *
 * T1-4：spawn_children step 的 `spawnedChildRunIds` 记录本 step 派生并入板的 childRunId
 * （并发启动后材料在后续 step 才回收），`childrenAdded` 在 run 结束时按 childRunId 从最终
 * childSummaries 回填（供 DeepRuntime 的 buildAndPublishRunTree 按 step 关联 child 进 tree）。
 */
export type DeepRunStepRecord = {
  readonly stepIndex: number;
  readonly decision: DeepDelegationDecision;
  readonly dispatchedAction: DeepDelegationAction;
  readonly childrenAdded?: readonly DeepChildSummary[];
  /** T1-4：本 step 派生并入板的 childRunId（spawn_children step 非空，并发启动后供回填关联）。 */
  readonly spawnedChildRunIds?: readonly string[];
  readonly depthGuardPassed?: boolean;
  readonly overflowCount?: number;
  /** EP3：本 step 派生的 child 中探索失败（降级为 failed 投影）的数量。 */
  readonly failedChildren?: number;
  /** T1-4：本 step 新回收的终态 child 数量（spawn/wait/synthesize/control 分支可观察）。 */
  readonly harvestedChildren?: number;
  /** 父层显式继续操作的已有 childRunId（continue_child step 非空）。 */
  readonly operatedChildRunIds?: readonly string[];
  readonly note?: string;
};

/**
 * 启动一次 deep run 的输入。
 *
 * - `modelAvailable`：AI-first 边界——false 时拒绝运行（需求 A3），不 fallback 伪装。
 *   由调用方（DeepRuntime，T2-6）据冻结的 capabilitySnapshot.activeModel 判定。
 * - `capabilitySnapshot`：run 启动时冻结的能力快照（FR-003），保证运行中能力边界稳定。
 * - `control`：T2-7 打断/纠正/停止 handle（FR-008）；省略时不可被外部打断/纠正/停止。
 */
export type StartDeepRunInput = {
  readonly run: DeepRun;
  readonly conversation: DeepConversation;
  readonly taskSoil: TaskSoil;
  readonly permissionBoundaryRefs: readonly string[];
  readonly confirmationPolicy?: ToolConfirmationPolicy;
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  readonly modelAvailable: boolean;
  readonly traceId: string;
  readonly goalId: string;
  readonly followUpContext?: DeepFollowUpContext;
  readonly intakeContext?: DeepIntakeContext;
  readonly control?: DeepRunControlHandle;
};

/**
 * 一次 deep run 的执行结果（T2-6 扩展：暴露 childRuns/synthesisRecord/controlEvents）。
 * executor 不持久化（持久化由 T2-6 DeepRuntime 负责），只返回完整可观察结果供调用方
 * 写入 RuntimeDatabase 并构建 AgentRunTree。
 *
 * T1-4 新增：
 *   - `taskBoard`：本次 run 使用的 board（注入或内部创建），供 T2-1 buildAndPublishRunTree
 *     读 terminalSnapshot 与 runtime 装配回调（闭环2 投影权威化接入点）；
 *   - `brief`：首次 spawn 后装配的 DeepResearchBrief（FR-BRIEF-02/03），供 T2-1 写入
 *     DeepRunRecord 供 Panel 消费。
 */
export type DeepRunExecutorResult = {
  readonly run: DeepRun;
  readonly decisions: readonly DeepDelegationDecision[];
  readonly steps: readonly DeepRunStepRecord[];
  readonly childSummaries: readonly DeepChildSummary[];
  /** 已完成 child run（完整 domain 记录，供 AgentRunTree.appendChildRunToTree）。 */
  readonly childRuns: readonly ChildAgentRun[];
  readonly conclusion?: SynthesizedConclusion;
  /** 父层综合产出的 run-tree 级记录（synthesize/direct_answer/stop-partial 时产出）。 */
  readonly synthesisRecord?: ParentSynthesisResult;
  /** T2-7 control 事件序列（interrupt/correct/stop），供持久化与可复盘。 */
  readonly controlEvents: readonly DeepRunControlEvent[];
  readonly stopReason: DeepRunStopReason;
  readonly failure?: string;
  /** T1-4：本次 run 使用的 task board（注入或内部创建），闭环2 投影权威化接入点。 */
  readonly taskBoard?: DeepTaskBoard;
  /** T1-4：首次 spawn 后装配的研究简报（FR-BRIEF），供 T2-1 写入 record 供 Panel 消费。 */
  readonly brief?: DeepResearchBrief;
  /**
   * 已实际执行的运行中排队父层追加指令。manager 自身的 continue_child 会在 steps 中
   * 记录，这里主要供 DeepRuntime 为控制 API 排队续跑补齐 resume_child 审计事实。
   */
  readonly executedQueuedChildInstructions: readonly DeepChildExecutedQueuedInstruction[];
};

// ---------------------------------------------------------------------------
// 主入口：startDeepRun
// ---------------------------------------------------------------------------

/**
 * 驱动一次 deep run 的 manager 决策循环。
 *
 * AI-first 边界（需求 A3）：无可用模型时立即拒绝（status=failed，
 * stopReason=no_model_rejected），不 fallback 伪装成已完成判断。有模型时逐 step
 * 调模型产出决策并分发 manager 动作；模型 turn 失败（executeDeepTurn 抛错）时整 run 置 failed。
 *
 * T1-4 多 Agent 最小协作闭环（design.md §3.3）：spawn_children/wait_children/synthesize/
 * control 四分支接入 scheduler+board，使多个 child 真实并发、wait 真实等待在途、synthesize
 * 拒绝伪造结论、control 取消 pending 并保留已完成材料。scheduler/board 默认由 executor 内部
 * 创建；T2-1 runtime 装配回调后注入 scheduler 使事件/投影实时化。
 *
 * T2-7（FR-008）：若传入 `control` handle，在每个 manager step 之间注入 control point：
 *   - interrupt/stop 终止循环并保留已产出材料（drain 在途 child 材料后，interrupt 置 interrupted，
 *     stop 尝试 partial 综合）；
 *   - correct 携带补充上下文注入下一决策 step（经 deep-model-io correctionContext）。
 */
export async function startDeepRun(
  input: StartDeepRunInput,
  config: DeepRunExecutorConfig,
): Promise<DeepRunExecutorResult> {
  const stepLimit = Math.max(1, Math.floor(config.stepLimit ?? DEEP_STEP_LIMIT));
  const maxChildren = Math.max(0, Math.floor(config.maxChildren ?? DEEP_MAX_CHILDREN));
  const managerMaxModelRounds = Math.max(
    1,
    Math.floor(config.managerMaxModelRounds ?? DEEP_MANAGER_MAX_MODEL_ROUNDS),
  );
  const managerMaxToolRounds = Math.max(
    0,
    Math.floor(config.managerMaxToolRounds ?? DEEP_MANAGER_MAX_TOOL_ROUNDS),
  );
  // EP1/EP2：manager 决策 / direct_answer 模型轮失败重试上限（turn 异常 + 解析错误共享预算）。
  const managerMaxRetries = Math.max(
    0,
    Math.floor(config.managerMaxRetries ?? DEEP_MANAGER_MAX_RETRIES),
  );

  // AI-first 边界（需求 A3）：无可用模型时拒绝运行，不 fallback 伪装。
  if (!input.modelAvailable) {
    return {
      run: withRunStatus(input.run, "failed"),
      decisions: [],
      steps: [],
      childSummaries: [],
      childRuns: [],
      controlEvents: [],
      executedQueuedChildInstructions: [],
      stopReason: "no_model_rejected",
      failure:
        "No model available: deep run rejected (AI-first boundary, no fallback pretending).",
    };
  }

  // T1-4：装配 board+scheduler。外部注入（T2-1 runtime 装配回调后）优先；否则内部创建默认
  // scheduler（无生命周期回调，闭环2 由 runtime 注入补齐实时事件/投影）。
  const goal = deepRunGoal(input.conversation);
  const scheduler = config.scheduler ?? createDeepDefaultScheduler({
    runId: input.run.runId,
    goal,
    permissionBoundaryRefs: input.permissionBoundaryRefs,
    turnRuntime: config.turnRuntime,
    traceId: input.traceId,
    goalId: input.goalId,
    confirmationPolicy: input.confirmationPolicy,
    capabilitySnapshot: input.capabilitySnapshot,
    maxConcurrency: config.maxConcurrency,
    maxChildren: config.maxChildren,
    childIdFactory: config.childIdFactory,
    emitProgress: (event) => emitProgress(config, event),
  });
  const board = scheduler.getBoard();
  let childControlSeal: Promise<void> | undefined;
  const sealChildControl = (): Promise<void> => {
    childControlSeal ??= Promise.resolve().then(() => config.sealChildControl?.());
    return childControlSeal;
  };
  board.setPhase("planning");

  const decisions: DeepDelegationDecision[] = [];
  const steps: DeepRunStepRecord[] = [];
  const childSummaries: DeepChildSummary[] = [];
  const completedChildRuns: ChildAgentRun[] = [];
  const executedQueuedChildInstructions: DeepChildExecutedQueuedInstruction[] = [];
  const controlEvents: DeepRunControlEvent[] = [];
  /** spawn step 派生并入板的 childRunId（stepIndex → childRunId[]），供 run 结束时回填 childrenAdded。 */
  const spawnedChildRunIdsByStep = new Map<number, string[]>();
  let conclusion: SynthesizedConclusion | undefined;
  let synthesisRecord: ParentSynthesisResult | undefined;
  let brief: DeepResearchBrief | undefined;
  let stopReason: DeepRunStopReason | undefined;
  let finalStatus: DeepRunStatus = "completed";
  let failure: string | undefined;
  let childWorkFinalized = false;

  try {
    for (let stepIndex = 0; stepIndex < stepLimit; stepIndex += 1) {
      // 告知 scheduler 当前 stepIndex，供生命周期回调装配 child.started/child.completed 进度事件元数据。
      scheduler.setStepIndex(stepIndex);
      // 非阻塞回收上一 step fire-and-forget child 已经完成的材料，让 manager 下一次决策能审查
      // 完整 child material，而不是只能看到 task board 的短摘要。
      mergeDeepTerminalMaterials(
        scheduler.harvestReady(),
        childSummaries,
        completedChildRuns,
        executedQueuedChildInstructions,
      );
      // T2-7 control point：在每个 manager step 之前检查外部打断/纠正/停止（FR-008）。
      // 放在 step 顶部保证每个 step 之间都响应（包括 spawn_children 重探索后）。
      let correctionContext: readonly string[] | undefined;
      if (input.control) {
        const signal = input.control.consume();
        if (signal.kind === "interrupt") {
          await sealChildControl();
          // FR-008 + T1-4：先 cancel pending（board 置 stopped，此后 startQueued no-op），
          // 再 drain 在途 running（本轮不真 abort 模型调用，running 自然完成后材料进保留），
          // 合并新终态材料后记录保留量。已产出的 child/材料保留，run 置 interrupted。
          scheduler.cancelPendingAndRunning(signal.reason);
          const drained = await scheduler.waitForAll();
          mergeDeepTerminalMaterials(drained, childSummaries, completedChildRuns, executedQueuedChildInstructions);
          childWorkFinalized = true;
          controlEvents.push({
            kind: "interrupt",
            atStepIndex: stepIndex,
            recordedAt: nowIso(),
            reason: signal.reason,
            preservedChildRuns: completedChildRuns.length,
            preservedMaterials: childSummaries.length,
          });
          board.setPhase("stopped");
          stopReason = "interrupted";
          finalStatus = "interrupted";
          break;
        }
        if (signal.kind === "stop") {
          await sealChildControl();
          // FR-008 + T1-4：停止运行。先 cancel pending + drain 在途材料（保留），再尝试产出
          // partial conclusion（经综合，受 assertNoDirectChildOutputHandoff 约束）；综合硬约束
          // 失败时不阻塞停止，材料仍保留在结果中。
          scheduler.cancelPendingAndRunning(signal.reason);
          const drained = await scheduler.waitForAll();
          mergeDeepTerminalMaterials(drained, childSummaries, completedChildRuns, executedQueuedChildInstructions);
          childWorkFinalized = true;
          const partial = await attemptDeepPartialSynthesis({
            context: input,
            turnRuntime: config.turnRuntime,
            childSummaries,
            completedChildRuns,
            decisions,
            goal,
            maxModelRounds: managerMaxModelRounds,
            maxToolRounds: managerMaxToolRounds,
          });
          if (partial) {
            conclusion = partial.conclusion;
            synthesisRecord = partial.synthesisRecord;
          }
          controlEvents.push({
            kind: "stop",
            atStepIndex: stepIndex,
            recordedAt: nowIso(),
            reason: signal.reason,
            partialSynthesis: partial !== undefined,
          });
          board.setPhase("stopped");
          stopReason = "stopped_by_control";
          finalStatus = "stopped";
          break;
        }
        if (signal.kind === "correct") {
          // FR-008：携带补充上下文，注入本轮 manager 决策 step（manager 据此调整派生
          // 与综合方向）。循环继续，不终止。
          correctionContext = signal.correctionContext;
          controlEvents.push({
            kind: "correct",
            atStepIndex: stepIndex,
            recordedAt: nowIso(),
            correctionContext: signal.correctionContext,
            reason: signal.reason,
          });
        }
      }

      board.setPhase("deciding");
      const evidenceRefs = collectDeepChildEvidenceRefs(childSummaries);
      await emitProgress(config, {
        kind: "decision.started",
        stepIndex,
        recordedAt: nowIso(),
      });
      const decision = await runDeepManagerDecisionTurn({
        context: input,
        turnRuntime: config.turnRuntime,
        scheduler,
        stepIndex,
        stepLimit,
        maxChildren,
        maxModelRounds: managerMaxModelRounds,
        maxToolRounds: managerMaxToolRounds,
        maxRetries: managerMaxRetries,
        retryBackoffMs: DEEP_TURN_RETRY_BACKOFF_MS,
        childSummaries,
        completedChildRuns,
        evidenceRefs,
        priorDecisions: decisions,
        correctionContext,
        goal,
        createdAt: nowIso(),
      });
      decisions.push(decision);
      await emitProgress(config, {
        kind: "manager.decided",
        stepIndex,
        decision,
        recordedAt: nowIso(),
      });
      if (isTerminalDeepAction(decision.action)) {
        // Seal new live child-control admission through a critical awaited
        // port. Progress observers are best-effort and cannot own this barrier.
        await sealChildControl();
        if (decision.action !== "synthesize") {
          // A terminal decision must not leave never-started child work behind.
          // Running children finish naturally; pending children and queued
          // follow-ups are cancelled because this run will not explore again.
          scheduler.cancelPendingAndRunning(decision.uncertainty);
        }
        const terminalMaterials = decision.action === "synthesize"
          ? await scheduler.waitForAllQueued()
          : await scheduler.waitForAll();
        mergeDeepTerminalMaterials(
          terminalMaterials,
          childSummaries,
          completedChildRuns,
          executedQueuedChildInstructions,
        );
        childWorkFinalized = true;
      }

      // 分发 manager 动作分支——每条分支都基于模型决策执行，executor 不改写动作语义。
      if (decision.action === "direct_answer") {
        board.setPhase("synthesizing");
        await emitProgress(config, {
          kind: "synthesis.started",
          stepIndex,
          recordedAt: nowIso(),
        });
        conclusion = await runDeepDirectAnswerTurn({
          context: input,
          turnRuntime: config.turnRuntime,
          decision,
          evidenceRefs: collectDeepChildEvidenceRefs(childSummaries),
          maxModelRounds: managerMaxModelRounds,
          maxToolRounds: managerMaxToolRounds,
          maxRetries: managerMaxRetries,
          retryBackoffMs: DEEP_TURN_RETRY_BACKOFF_MS,
          goal,
          createdAt: nowIso(),
        });
        synthesisRecord = buildDirectAnswerSynthesisRecord(conclusion, completedChildRuns);
        await emitProgress(config, {
          kind: "synthesis.completed",
          stepIndex,
          synthesisRecord,
          conclusion,
          recordedAt: nowIso(),
        });
        steps.push({ stepIndex, decision, dispatchedAction: decision.action });
        board.setPhase("completed");
        stopReason = "direct_answer";
        finalStatus = "completed";
        break;
      }

      if (decision.action === "spawn_children") {
        // T1-4 FR-SPAWN-01：去掉串行 for...of await，改为 enqueue + 并发 startQueued
        // （fire-and-forget，不要求全部完成），立即进入下一 manager step。
        board.setPhase("exploring");
        const enqueueResult = scheduler.enqueue({
          specs: decision.childSpecs,
          parentAgentId: DEEP_MANAGER_AGENT_ID,
          goalId: input.goalId,
          traceId: input.traceId,
          createdAt: nowIso(),
        });
        scheduler.startQueued();
        const spawnedChildRunIds = enqueueResult.tasks.map((task) => task.childRunId);
        if (spawnedChildRunIds.length > 0) {
          spawnedChildRunIdsByStep.set(stepIndex, spawnedChildRunIds);
        }
        // FR-BRIEF-02/03：首次 spawn 后装配 DeepResearchBrief。目标明确时 brief 自动进入探索
        // （不强制审批，needsUserApproval=false）；信息不足由 manager 走 ask_user，不伪装完成。
        if (brief === undefined && decision.childSpecs.length > 0) {
          brief = buildDeepResearchBrief({
            goal,
            decision,
            childSpecs: decision.childSpecs,
            permissionBoundaryRefs: input.permissionBoundaryRefs,
          });
        }
        steps.push({
          stepIndex,
          decision,
          dispatchedAction: decision.action,
          spawnedChildRunIds,
          depthGuardPassed: enqueueResult.depthGuardPassed,
          overflowCount: enqueueResult.overflowCount,
        });
        continue;
      }

      if (decision.action === "wait_children") {
        // T1-4 FR-WAIT-01/02：从 no-op 改为真实等待在途 child。
        board.setPhase("waiting");
        const snapshot = scheduler.snapshot();
        const hasRunning = snapshot.tasks.some((task) => task.status === "running");
        const hasPending = snapshot.tasks.some((task) => task.status === "pending");
        if (!hasRunning && !hasPending) {
          // 无在途任务：记录事实，按模型语义继续（可能是综合或重派）。
          steps.push({
            stepIndex,
            decision,
            dispatchedAction: decision.action,
            note: "无在途任务（无 running/pending child），按模型语义继续。",
          });
          continue;
        }
        const harvested = await scheduler.waitForProgress();
        mergeDeepTerminalMaterials(harvested, childSummaries, completedChildRuns, executedQueuedChildInstructions);
        // 并发槽空闲且有 pending 时继续启动剩余 pending（FR-WAIT-02）。
        scheduler.startQueued();
        steps.push({
          stepIndex,
          decision,
          dispatchedAction: decision.action,
          harvestedChildren: harvested.length,
          note:
            harvested.length > 0
              ? `等待回收 ${harvested.length} 个新终态 child；继续推进。`
              : "本轮无新终态（在途仍在运行），下一 step 重新评估。",
        });
        continue;
      }

      if (decision.action === "continue_child") {
        board.setPhase("exploring");
        mergeDeepTerminalMaterials(
          scheduler.harvestReady(),
          childSummaries,
          completedChildRuns,
          executedQueuedChildInstructions,
        );
        const continued: DeepChildTerminalMaterial[] = [];
        const waitedChildRunIds: string[] = [];
        const invalidOperations: string[] = [];
        for (const operation of decision.childOperations) {
          let snapshotTask = scheduler
            .snapshot()
            .tasks
            .find((task) => task.childRunId === operation.childRunId);
          if (snapshotTask === undefined) {
            invalidOperations.push(`${operation.childRunId}: child task not found`);
            continue;
          }
          if (snapshotTask.status === "pending" || snapshotTask.status === "running") {
            const harvestedBeforeContinue = await waitForDeepChildTerminalForReview(scheduler, operation.childRunId);
            mergeDeepTerminalMaterials(
              harvestedBeforeContinue,
              childSummaries,
              completedChildRuns,
              executedQueuedChildInstructions,
            );
            if (harvestedBeforeContinue.length > 0) {
              waitedChildRunIds.push(operation.childRunId);
            }
            snapshotTask = scheduler
              .snapshot()
              .tasks
              .find((task) => task.childRunId === operation.childRunId);
          }
          if (snapshotTask === undefined) {
            invalidOperations.push(`${operation.childRunId}: child task not found after waiting`);
            continue;
          }
          if (snapshotTask.status === "pending" || snapshotTask.status === "running") {
            invalidOperations.push(`${operation.childRunId}: child status ${snapshotTask.status} is not reviewable`);
            continue;
          }
          if (snapshotTask.status === "cancelled") {
            invalidOperations.push(`${operation.childRunId}: child status ${snapshotTask.status} cannot be continued`);
            continue;
          }
          const childRun = completedChildRuns.find((run) => run.childRunId === operation.childRunId);
          if (childRun === undefined) {
            invalidOperations.push(`${operation.childRunId}: child run material not available`);
            continue;
          }
          const previousSummary = childSummaries.find((summary) => summary.childRunId === operation.childRunId);
          const material = await scheduler.continueChild({
            childRun,
            childSpec: previousSummary?.spec ?? snapshotTask.spec,
            previousSummary,
            parentInstruction: operation.instruction,
            source: "manager",
            review: operation.review,
          });
          continued.push(material);
        }
        mergeDeepTerminalMaterials(continued, childSummaries, completedChildRuns, executedQueuedChildInstructions);
        steps.push({
          stepIndex,
          decision,
          dispatchedAction: decision.action,
          operatedChildRunIds: [
            ...continued.map((material) => material.completedRun.childRunId),
          ],
          harvestedChildren: continued.length,
          note:
            invalidOperations.length === 0
              ? `父层继续 ${continued.length} 个已有 child；等待 ${waitedChildRunIds.length} 个运行中 child 完成当前轮。`
              : `父层继续 ${continued.length} 个已有 child；等待 ${waitedChildRunIds.length} 个运行中 child 完成当前轮；跳过 ${invalidOperations.length} 个无效操作：${invalidOperations.join("; ")}`,
        });
        continue;
      }

      if (decision.action === "synthesize") {
        // T1-4 FR-SAFE-03：synthesize 加固——拒绝伪造结论。
        board.setPhase("synthesizing");
        await emitProgress(config, {
          kind: "synthesis.started",
          stepIndex,
          recordedAt: nowIso(),
        });
        // 仍有 pending/running child 时先清空队列（本轮最小闭环口径，FR-SAFE-03）；
        // waitForAllQueued 会按并发上限启动剩余 pending，避免终态残留 planned 节点。
        const drained = await scheduler.waitForAllQueued();
        mergeDeepTerminalMaterials(drained, childSummaries, completedChildRuns, executedQueuedChildInstructions);
        // 无任何 completed/blocked/failed child 材料时拒绝综合，走 ask_user/failed guard，不伪造结论。
        if (childSummaries.length === 0) {
          steps.push({
            stepIndex,
            decision,
            dispatchedAction: decision.action,
            note: "无任何 child 材料可综合；拒绝伪造结论，转入 ask_user。",
          });
          board.setPhase("needs_input");
          stopReason = "ask_user";
          finalStatus = "interrupted";
          break;
        }
        // T2-5：synthesize 分支委托 parent-synthesis.synthesizeDeepConclusion（受
        // assertNoDirectChildOutputHandoff 守 FR-005 硬约束）。
        const evidenceRefsForSynthesis = collectDeepChildEvidenceRefs(childSummaries);
        const outcome = await synthesizeDeepConclusion({
          turnRuntime: config.turnRuntime,
          traceId: input.traceId,
          goalId: input.goalId,
          runId: input.run.runId,
          goal,
          taskSoil: input.taskSoil,
          childSummaries,
          completedChildRuns,
          evidenceRefs: evidenceRefsForSynthesis,
          inputRefs: buildDeepManagerInputRefs(input, decisions),
          maxModelRounds: managerMaxModelRounds,
          maxToolRounds: managerMaxToolRounds,
          createdAt: nowIso(),
        });
        conclusion = outcome.conclusion;
        synthesisRecord = outcome.synthesisRecord;
        await emitProgress(config, {
          kind: "synthesis.completed",
          stepIndex,
          synthesisRecord,
          conclusion,
          recordedAt: nowIso(),
        });
        steps.push({ stepIndex, decision, dispatchedAction: decision.action });
        board.setPhase("completed");
        stopReason = "synthesized";
        finalStatus = "completed";
        break;
      }

      if (decision.action === "ask_user") {
        // AI-first：证据/方向不足时模型选 ask_user，executor 据此置 interrupted，
        // 不伪装完成。
        steps.push({
          stepIndex,
          decision,
          dispatchedAction: decision.action,
          note: decision.uncertainty,
        });
        board.setPhase("needs_input");
        stopReason = "ask_user";
        finalStatus = "interrupted";
        break;
      }

      if (decision.action === "stop") {
        scheduler.cancelPendingAndRunning(decision.uncertainty);
        const drained = await scheduler.waitForAll();
        mergeDeepTerminalMaterials(drained, childSummaries, completedChildRuns, executedQueuedChildInstructions);
        const partial = await attemptDeepPartialSynthesis({
          context: input,
          turnRuntime: config.turnRuntime,
          childSummaries,
          completedChildRuns,
          decisions,
          goal,
          maxModelRounds: managerMaxModelRounds,
          maxToolRounds: managerMaxToolRounds,
        });
        if (partial) {
          conclusion = partial.conclusion;
          synthesisRecord = partial.synthesisRecord;
        }
        steps.push({
          stepIndex,
          decision,
          dispatchedAction: decision.action,
          harvestedChildren: drained.length,
          note:
            partial !== undefined
              ? "模型主动停止；已取消 pending child、保留在途材料并产出部分综合。"
              : "模型主动停止；已取消 pending child 并保留可用材料。",
        });
        board.setPhase("stopped");
        stopReason = "stopped";
        finalStatus = "stopped";
        break;
      }

      // 穷尽守卫：DEEP_DELEGATION_ACTIONS 外的动作（理论上不可能，解析器已校验）。
      steps.push({
        stepIndex,
        decision,
        dispatchedAction: decision.action,
        note: `unhandled action: ${decision.action}`,
      });
      board.setPhase("failed");
      stopReason = "failed";
      finalStatus = "failed";
      failure = `Unhandled deep delegation action: ${decision.action}`;
      break;
    }
  } catch (error) {
    failure = describeDeepManagerTurnError(error);
    stopReason = "failed";
    finalStatus = "failed";
  }

  // Every exit path has one finalization owner. Seal control admission before
  // the final drain so runtime persistence never has to reinterpret or merge
  // child business facts after this executor returns.
  await sealChildControl();
  if (!childWorkFinalized) {
    // Step-limit and exception exits have no terminal manager action to apply
    // the policy above. Stop pending admission before draining running work.
    scheduler.cancelPendingAndRunning(failure ?? stopReason ?? "run_finalization");
    childWorkFinalized = true;
  }

  // T1-4 兜底：循环结束后 drain 任何残留 in-flight child（防 step_limit / 异常时材料丢失），
  // 保证 executorResult.childRuns/childSummaries 涵盖所有已启动 child（一致性 + 可复盘）。
  // board 已 stopped（control 终止）时 running 仍自然完成进 buffer，waitForAll 照常 drain。
  try {
    const tailMaterials = await scheduler.waitForAll();
    mergeDeepTerminalMaterials(tailMaterials, childSummaries, completedChildRuns, executedQueuedChildInstructions);
  } catch {
    // 兜底 drain 失败不改变已确定的终态（失败/中断材料已在循环内保留）。
  }

  if (stopReason === undefined) {
    stopReason = "step_limit_reached";
    if (childSummaries.length > 0) {
      board.setPhase("synthesizing");
      const partial = await attemptDeepPartialSynthesis({
        context: input,
        turnRuntime: config.turnRuntime,
        childSummaries,
        completedChildRuns,
        decisions,
        goal,
        maxModelRounds: managerMaxModelRounds,
        maxToolRounds: managerMaxToolRounds,
      });
      if (partial) {
        conclusion = partial.conclusion;
        synthesisRecord = partial.synthesisRecord;
        finalStatus = "completed";
        board.setPhase("completed");
      } else {
        finalStatus = "failed";
        failure = "Step limit reached with child materials, but parent synthesis failed.";
        board.setPhase("failed");
      }
    } else {
      finalStatus = "failed";
      failure = "Step limit reached before the manager produced a conclusion or child material.";
      board.setPhase("failed");
    }
  }

  // 终态相位对齐。Finalization may temporarily mark the board stopped only
  // to cancel pending work; preserve that phase solely for real stop/input exits.
  const preservesStoppedPhase =
    stopReason === "stopped"
    || stopReason === "stopped_by_control"
    || stopReason === "interrupted"
    || stopReason === "ask_user";
  if (!preservesStoppedPhase) {
    board.setPhase(deepTaskBoardPhaseForRunStatus(finalStatus));
  }

  // 回填 spawn step 的 childrenAdded：按 childRunId 从最终 childSummaries 匹配，供
  // DeepRuntime buildAndPublishRunTree 按 step 关联 child 进 AgentRunTree + 发布事件序列。
  const finalSteps = backfillDeepSpawnedChildren(steps, spawnedChildRunIdsByStep, childSummaries);

  return {
    run: withRunStatus(input.run, finalStatus),
    decisions,
    steps: finalSteps,
    childSummaries,
    childRuns: completedChildRuns,
    conclusion,
    synthesisRecord,
    controlEvents,
    stopReason,
    failure,
    taskBoard: board,
    brief,
    executedQueuedChildInstructions,
  };
}

function isTerminalDeepAction(action: DeepDelegationDecision["action"]): boolean {
  return action === "direct_answer" || action === "synthesize" || action === "ask_user" || action === "stop";
}

// ---------------------------------------------------------------------------
// 本地辅助函数
// ---------------------------------------------------------------------------

/**
 * 为 direct_answer 结论构造一份 run-tree 级综合记录（direct_answer 视为 manager 直接
 * 收口的单源综合，source 跟随 conclusion.source）。复用 parent-synthesis 的
 * buildParentSynthesisRecord（顶部已 import），保持与 synthesize 分支同一字段映射口径，
 * 避免 DeepRuntime 为 direct_answer 单独处理综合记录装配。
 */
function buildDirectAnswerSynthesisRecord(
  conclusion: SynthesizedConclusion,
  completedChildRuns: readonly ChildAgentRun[],
): ParentSynthesisResult {
  return buildParentSynthesisRecord({
    conclusion,
    childRuns: completedChildRuns,
    parentAgentId: DEEP_MANAGER_AGENT_ID,
    createdAt: nowIso(),
  });
}

function deepRunGoal(conversation: DeepConversation): string {
  return conversation.currentObjective ?? conversation.goal;
}

/**
 * 返回带新 status 的 DeepRun（不可变更新）。终态（completed/failed/stopped）补 completedAt。
 */
function withRunStatus(run: DeepRun, status: DeepRunStatus): DeepRun {
  const now = nowIso();
  const terminal = status === "completed" || status === "failed" || status === "stopped";
  return {
    ...run,
    status,
    updatedAt: now,
    completedAt: terminal ? now : run.completedAt,
  };
}

async function emitProgress(
  config: DeepRunExecutorConfig,
  event: DeepRunProgressEvent,
): Promise<void> {
  if (config.onProgress === undefined) {
    return;
  }
  try {
    await config.onProgress(event);
  } catch {
    // Observation updates must not change the model decision or run terminal state.
  }
}

// ---------------------------------------------------------------------------
// 类型再导出（供消费方按需引用 deep 模块契约）
// ---------------------------------------------------------------------------

export type {
  DeepConversation,
  DeepDelegationDecision,
  DeepRun,
  DeepChildSummary,
  DeepResearchBrief,
  SynthesizedConclusion,
};

export {
  DEEP_DECISION_CONTRACT_ID,
  DEEP_DIRECT_ANSWER_CONTRACT_ID,
};

// 闭环2 接入点再导出：T2-1 runtime 装配 board+scheduler+回调所需类型。
export type { DeepChildScheduler, DeepChildSchedulerCallbacks };
