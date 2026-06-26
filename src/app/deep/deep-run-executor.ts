/**
 * DeepRunExecutor —— manager 决策 action loop（deep 一期，T2-3/T2-6/T2-7，ADR-0025 §5.3）。
 *
 * 本文件实现 DeepRuntime manager 的逐 step 决策循环：
 *   - 每个 step 通过 AgentTurnRuntime 调模型产出 {@link DeepDelegationDecision}（六动作）；
 *   - 分发到六动作分支（direct_answer / spawn_children / wait_children / synthesize /
 *     ask_user / stop），每个分支都可执行；
 *   - run 启动时冻结 {@link BasicAgentCapabilitySnapshot}，保证运行中能力边界稳定（FR-003）；
 *   - manager 在证据不足时按模型决策走 spawn_children（继续派生 child 探索）或
 *     ask_user（向用户澄清），**不伪装成已完成判断**；
 *   - 无可用模型时拒绝运行（需求 A3，AI-first 边界，不 fallback 伪装）。
 *
 * T2-7 打断/纠正/停止（FR-008）：manager step 循环之间注入 control point（
 * {@link DeepRunControlHandle}）。
 *   - interrupt：立即停止循环，**保留已产出的 child/材料**，run 置 interrupted；
 *   - correct：携带补充上下文注入下一 manager 决策 step（经 deep-model-io
 *     correctionContext 传播），manager 据此调整派生与综合方向，循环继续；
 *   - stop：停止运行，若已有 child 材料则尝试产出 partial conclusion（经综合），
 *     run 置 stopped；综合硬约束失败时不阻塞停止（材料仍保留）。
 *   control 不破坏已产出材料（FR-008）。
 *
 * 设计边界（ADR-0025 决策一 AI-first）：
 *   - 所有决策 source:"ai"（由 deep-model-io 解析器产出）；executor 不合成
 *     deterministic_fallback 决策，也不在证据不足时自行伪装 direct_answer/synthesize。
 *   - executor 只执行模型决策 + 守边界（depth guard、child 数量上限、
 *     assertNoDirectChildOutputHandoff），不替代模型的语义判断（FR-003/FR-005）。
 *
 * 复用边界：
 *   - 复用 AgentTurnRuntime（经 deep-turn.executeDeepTurn）调模型；
 *   - 复用 child-delegation（deriveDeepChildren + exploreDeepChild）做 child 派生与探索；
 *   - 复用 deep-model-io（契约/消息/解析器，含 correctionContext 传播，T2-7 基础）；
 *   - 复用 parent-synthesis.synthesizeDeepConclusion 做父层综合（T2-5 抽取，不再内联）；
 *   - 复用 domain/underground/agent-fabric.assertNoDirectChildOutputHandoff 守 FR-005 硬约束。
 *   - 不 import cognitive-work-session-*（legacy action loop，仅作设计输入吸收，design.md §4.1）。
 *
 * 模块边界：synthesize 分支委托 parent-synthesis.ts（T2-5），不再内联实现综合逻辑；
 * 父层综合由模型完成（AI-first 边界），executor 只执行模型决策 + 守边界。
 */
import type { ObservationRef } from "../../domain/observation/contracts.js";
import type { ToolConfirmationPolicy } from "../../domain/tools/contracts.js";
import type { BasicAgentCapabilitySnapshot } from "../../domain/config/contracts.js";
import type { TaskSoil } from "../../domain/soil/task-soil.js";
import type { ChildAgentRun, ParentSynthesisResult } from "../../domain/underground/agent-fabric.js";
import type { AgentTurnRuntime } from "../../kernel/intelligence/agent-turn-runtime.js";
import { nowIso } from "../../kernel/id.js";
import type {
  DeepConversation,
  DeepDelegationAction,
  DeepDelegationDecision,
  DeepRun,
  DeepRunStatus,
  DeepChildSummary,
  SynthesizedConclusion,
} from "./contracts.js";
import {
  DEEP_DECISION_CONTRACT_ID,
  DEEP_DIRECT_ANSWER_CONTRACT_ID,
  deepDecisionMessages,
  deepDecisionOutputContract,
  deepDirectAnswerMessages,
  deepDirectAnswerOutputContract,
  extractStructuredOutput,
  parseDeepDecision,
  parseDeepDirectAnswer,
} from "./deep-model-io.js";
import { executeDeepTurn } from "./deep-turn.js";
import {
  DEEP_MANAGER_AGENT_ID,
  DEEP_MAX_CHILDREN,
  deriveDeepChildren,
  exploreDeepChild,
} from "./child-delegation.js";
import { synthesizeDeepConclusion, buildParentSynthesisRecord } from "./parent-synthesis.js";

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** manager 决策循环默认 step 上限（防失控；模型可在 stop 动作提前终止）。 */
export const DEEP_STEP_LIMIT = 6;

/** manager 决策/直接回答/综合 turn 默认只做单轮纯推理（工具调用并入 child 探索）。 */
export const DEEP_MANAGER_MAX_MODEL_ROUNDS = 1;
export const DEEP_MANAGER_MAX_TOOL_ROUNDS = 0;

// ---------------------------------------------------------------------------
// T2-7 打断/纠正/停止 control handle（FR-008）
// ---------------------------------------------------------------------------

/**
 * control point 读出的信号。`none` 表示无待处理信号；`correct` 被消费（读后即清，
 * 仅作用于下一个 manager 决策 step）；`interrupt`/`stop` 为终态（读后循环终止）。
 */
export type DeepRunControlSignal =
  | { readonly kind: "none" }
  | { readonly kind: "correct"; readonly correctionContext: readonly string[]; readonly reason?: string }
  | { readonly kind: "interrupt"; readonly reason?: string }
  | { readonly kind: "stop"; readonly reason?: string };

/**
 * 可变 control handle：外部调用方经 request* 设信号，executor 在每个 manager step
 * 之间经 {@link consume} 读出并处理。一旦终态（interrupt/stop）被设置，后续 correct
 * 请求被忽略；correct 信号读后即清（仅作用于一次决策）。
 *
 * 该 handle 使 executor 能在 manager step 循环之间响应外部打断/纠正/停止，不阻塞
 * 模型 turn 本身（B-3 不在模型 turn 内部中断，符合"step 之间注入打断点"口径）。
 */
export type DeepRunControlHandle = {
  /** executor 在 control point 读取并（对 correct）消费待处理信号。 */
  readonly consume: () => DeepRunControlSignal;
  /** 外部请求打断：保留已产出材料，run 置 interrupted。终态，忽略其后的 correct/stop。 */
  readonly requestInterrupt: (reason?: string) => void;
  /** 外部请求纠正：携带补充上下文，注入下一 manager 决策 step。非终态，可多次请求。 */
  readonly requestCorrect: (correctionContext: readonly string[], reason?: string) => void;
  /** 外部请求停止：停止运行，若已有 child 材料尝试产出 partial conclusion。终态。 */
  readonly requestStop: (reason?: string) => void;
};

/**
 * 创建一个独立的 control handle。同一 run 共享一个 handle；DeepRuntime（T2-6/T2-7）
 * 持有 handle 以便 API 层转发用户打断/纠正/停止请求。
 */
export function createDeepRunControlHandle(): DeepRunControlHandle {
  let terminal: { readonly kind: "interrupt" | "stop"; readonly reason?: string } | undefined;
  let pendingCorrect:
    | { readonly correctionContext: readonly string[]; readonly reason?: string }
    | undefined;
  return {
    consume(): DeepRunControlSignal {
      if (terminal) {
        return terminal.kind === "interrupt"
          ? { kind: "interrupt", reason: terminal.reason }
          : { kind: "stop", reason: terminal.reason };
      }
      if (pendingCorrect) {
        const consumed = pendingCorrect;
        pendingCorrect = undefined;
        return {
          kind: "correct",
          correctionContext: consumed.correctionContext,
          reason: consumed.reason,
        };
      }
      return { kind: "none" };
    },
    requestInterrupt(reason?: string): void {
      if (!terminal) {
        terminal = { kind: "interrupt", reason };
      }
    },
    requestCorrect(correctionContext: readonly string[], reason?: string): void {
      if (!terminal) {
        pendingCorrect = { correctionContext, reason };
      }
    },
    requestStop(reason?: string): void {
      if (!terminal) {
        terminal = { kind: "stop", reason };
      }
    },
  };
}

/**
 * 一次 control 事件的可观察记录（持久化投影，FR-008/FR-009）。executor 在 control
 * point 处理信号时记录，供 DeepRuntime 写入事件序列与可复盘证据链。
 */
export type DeepRunControlEvent =
  | {
      readonly kind: "interrupt";
      readonly atStepIndex: number;
      readonly recordedAt: string;
      readonly reason?: string;
      readonly preservedChildRuns: number;
      readonly preservedMaterials: number;
    }
  | {
      readonly kind: "correct";
      readonly atStepIndex: number;
      readonly recordedAt: string;
      readonly correctionContext: readonly string[];
      readonly reason?: string;
    }
  | {
      readonly kind: "stop";
      readonly atStepIndex: number;
      readonly recordedAt: string;
      readonly reason?: string;
      readonly partialSynthesis: boolean;
    };

// ---------------------------------------------------------------------------
// 配置与输入/输出类型
// ---------------------------------------------------------------------------

/**
 * DeepRunExecutor 配置。turnRuntime 是 manager/child/synthesis 共用的 AgentTurnRuntime
 * （封装 IntelligenceChannel + 可选 ToolCenter/确认门）。
 */
export type DeepRunExecutorConfig = {
  readonly turnRuntime: AgentTurnRuntime;
  readonly stepLimit?: number;
  readonly maxChildren?: number;
  readonly managerMaxModelRounds?: number;
  readonly managerMaxToolRounds?: number;
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
 */
export type DeepRunStepRecord = {
  readonly stepIndex: number;
  readonly decision: DeepDelegationDecision;
  readonly dispatchedAction: DeepDelegationAction;
  readonly childrenAdded?: readonly DeepChildSummary[];
  readonly depthGuardPassed?: boolean;
  readonly overflowCount?: number;
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
  readonly control?: DeepRunControlHandle;
};

/**
 * 一次 deep run 的执行结果（T2-6 扩展：暴露 childRuns/synthesisRecord/controlEvents）。
 * executor 不持久化（持久化由 T2-6 DeepRuntime 负责），只返回完整可观察结果供调用方
 * 写入 RuntimeDatabase 并构建 AgentRunTree。
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
};

// ---------------------------------------------------------------------------
// 主入口：startDeepRun
// ---------------------------------------------------------------------------

/**
 * 驱动一次 deep run 的 manager 决策循环。
 *
 * AI-first 边界（需求 A3）：无可用模型时立即拒绝（status=failed，
 * stopReason=no_model_rejected），不 fallback 伪装成已完成判断。有模型时逐 step
 * 调模型产出决策并分发六动作；模型 turn 失败（executeDeepTurn 抛错）时整 run 置 failed。
 *
 * T2-7（FR-008）：若传入 `control` handle，在每个 manager step 之间注入 control point：
 *   - interrupt/stop 终止循环并保留已产出材料（interrupt 置 interrupted，stop 尝试 partial 综合）；
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

  // AI-first 边界（需求 A3）：无可用模型时拒绝运行，不 fallback 伪装。
  if (!input.modelAvailable) {
    return {
      run: withRunStatus(input.run, "failed"),
      decisions: [],
      steps: [],
      childSummaries: [],
      childRuns: [],
      controlEvents: [],
      stopReason: "no_model_rejected",
      failure:
        "No model available: deep run rejected (AI-first boundary, no fallback pretending).",
    };
  }

  const decisions: DeepDelegationDecision[] = [];
  const steps: DeepRunStepRecord[] = [];
  const childSummaries: DeepChildSummary[] = [];
  const completedChildRuns: ChildAgentRun[] = [];
  const controlEvents: DeepRunControlEvent[] = [];
  const goal = input.conversation.goal;
  let conclusion: SynthesizedConclusion | undefined;
  let synthesisRecord: ParentSynthesisResult | undefined;
  let stopReason: DeepRunStopReason | undefined;
  let finalStatus: DeepRunStatus = "completed";
  let failure: string | undefined;

  try {
    for (let stepIndex = 0; stepIndex < stepLimit; stepIndex += 1) {
      // T2-7 control point：在每个 manager step 之前检查外部打断/纠正/停止（FR-008）。
      // 放在 step 顶部保证每个 step 之间都响应（包括 spawn_children 重探索后）。
      let correctionContext: readonly string[] | undefined;
      if (input.control) {
        const signal = input.control.consume();
        if (signal.kind === "interrupt") {
          // FR-008：保留已产出的 child/材料（已在 completedChildRuns/childSummaries 中），
          // run 置 interrupted，不伪造完成。
          controlEvents.push({
            kind: "interrupt",
            atStepIndex: stepIndex,
            recordedAt: nowIso(),
            reason: signal.reason,
            preservedChildRuns: completedChildRuns.length,
            preservedMaterials: childSummaries.length,
          });
          stopReason = "interrupted";
          finalStatus = "interrupted";
          break;
        }
        if (signal.kind === "stop") {
          // FR-008：停止运行。若已有 child 材料，尝试产出 partial conclusion（经综合，
          // 受 assertNoDirectChildOutputHandoff 约束）；综合硬约束失败时不阻塞停止，
          // 材料仍保留在结果中。
          const partial = await attemptPartialSynthesis({
            input,
            config,
            childSummaries,
            completedChildRuns,
            decisions,
            goal,
            managerMaxModelRounds,
            managerMaxToolRounds,
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

      const evidenceRefs = collectEvidenceRefs(childSummaries);
      const decision = await runManagerDecisionStep({
        input,
        config,
        stepIndex,
        stepLimit,
        maxChildren,
        managerMaxModelRounds,
        managerMaxToolRounds,
        childSummaries,
        evidenceRefs,
        priorDecisions: decisions,
        correctionContext,
        createdAt: nowIso(),
      });
      decisions.push(decision);

      // 分发六动作分支——每条分支都基于模型决策执行，executor 不改写动作语义。
      if (decision.action === "direct_answer") {
        conclusion = await runDirectAnswerStep({
          input,
          config,
          decision,
          evidenceRefs,
          managerMaxModelRounds,
          managerMaxToolRounds,
          goal,
          createdAt: nowIso(),
        });
        synthesisRecord = buildDirectAnswerSynthesisRecord(conclusion, completedChildRuns);
        steps.push({ stepIndex, decision, dispatchedAction: decision.action });
        stopReason = "direct_answer";
        finalStatus = "completed";
        break;
      }

      if (decision.action === "spawn_children") {
        const spawn = await runSpawnChildrenStep({
          decision,
          goal,
          parentAgentId: DEEP_MANAGER_AGENT_ID,
          maxChildren,
          input,
          config,
          createdAt: nowIso(),
        });
        childSummaries.push(...spawn.summaries);
        completedChildRuns.push(...spawn.completedRuns);
        steps.push({
          stepIndex,
          decision,
          dispatchedAction: decision.action,
          childrenAdded: spawn.summaries,
          depthGuardPassed: spawn.depthGuardPassed,
          overflowCount: spawn.overflowCount,
        });
        continue;
      }

      if (decision.action === "wait_children") {
        // B-2 child 探索同步完成（spawn_children 内 await）；wait_children 在同步模型下
        // 等价于"下一 step 重新评估"，不伪造 child 进行中状态。
        steps.push({
          stepIndex,
          decision,
          dispatchedAction: decision.action,
          note: "children explored synchronously in B-2; next step re-evaluates.",
        });
        continue;
      }

      if (decision.action === "synthesize") {
        // T2-5：synthesize 分支委托 parent-synthesis.synthesizeDeepConclusion（不再内联）。
        const outcome = await synthesizeDeepConclusion({
          turnRuntime: config.turnRuntime,
          traceId: input.traceId,
          goalId: input.goalId,
          runId: input.run.runId,
          goal,
          taskSoil: input.taskSoil,
          childSummaries,
          completedChildRuns,
          evidenceRefs,
          inputRefs: buildManagerInputRefs(input, decisions),
          maxModelRounds: managerMaxModelRounds,
          maxToolRounds: managerMaxToolRounds,
          createdAt: nowIso(),
        });
        conclusion = outcome.conclusion;
        synthesisRecord = outcome.synthesisRecord;
        steps.push({ stepIndex, decision, dispatchedAction: decision.action });
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
        stopReason = "ask_user";
        finalStatus = "interrupted";
        break;
      }

      if (decision.action === "stop") {
        steps.push({
          stepIndex,
          decision,
          dispatchedAction: decision.action,
          note: decision.uncertainty,
        });
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
      stopReason = "failed";
      finalStatus = "failed";
      failure = `Unhandled deep delegation action: ${decision.action}`;
      break;
    }
  } catch (error) {
    failure = errorMessage(error);
    stopReason = "failed";
    finalStatus = "failed";
  }

  if (stopReason === undefined) {
    // 循环走完 stepLimit 未触发终止动作——按 step 上限收束（manager 未主动收口）。
    stopReason = "step_limit_reached";
    finalStatus = "completed";
  }

  return {
    run: withRunStatus(input.run, finalStatus),
    decisions,
    steps,
    childSummaries,
    childRuns: completedChildRuns,
    conclusion,
    synthesisRecord,
    controlEvents,
    stopReason,
    failure,
  };
}

// ---------------------------------------------------------------------------
// Step 实现：manager 决策
// ---------------------------------------------------------------------------

type RunManagerDecisionStepInput = {
  readonly input: StartDeepRunInput;
  readonly config: DeepRunExecutorConfig;
  readonly stepIndex: number;
  readonly stepLimit: number;
  readonly maxChildren: number;
  readonly managerMaxModelRounds: number;
  readonly managerMaxToolRounds: number;
  readonly childSummaries: readonly DeepChildSummary[];
  readonly evidenceRefs: readonly string[];
  readonly priorDecisions: readonly DeepDelegationDecision[];
  /** T2-7：用户中途纠正/补充上下文（FR-008），传入决策消息让 manager 据此调整。 */
  readonly correctionContext?: readonly string[];
  readonly createdAt: string;
};

/**
 * 执行一个 manager 决策 step：经 AgentTurnRuntime 调模型（deep_decision）产出
 * DeepDelegationDecision。manager 是纯推理（allowedTools=[]，单轮），工具调用并入 child。
 * T2-7：correctionContext 非空时经 deepDecisionMessages 标注"用户纠正/补充"段。
 */
async function runManagerDecisionStep(
  step: RunManagerDecisionStepInput,
): Promise<DeepDelegationDecision> {
  const callerRef: ObservationRef = {
    kind: "agent_run",
    id: step.input.run.runId,
    label: `${DEEP_MANAGER_AGENT_ID}:decision:${step.stepIndex}`,
  };
  const turn = await executeDeepTurn({
    turnRuntime: step.config.turnRuntime,
    traceId: step.input.traceId,
    goalId: step.input.goalId,
    callerAgentId: DEEP_MANAGER_AGENT_ID,
    callerRef,
    purpose: "deep_decision",
    outputContract: deepDecisionOutputContract(),
    inputRefs: buildManagerInputRefs(step.input, step.priorDecisions),
    messages: deepDecisionMessages({
      goal: step.input.conversation.goal,
      taskSoil: step.input.taskSoil,
      stepIndex: step.stepIndex,
      stepLimit: step.stepLimit,
      childSummaries: step.childSummaries,
      priorDecisionSummaries: step.priorDecisions.map((decision) => decision.decisionSummary),
      evidenceRefs: step.evidenceRefs,
      permissionBoundaryRefs: step.input.permissionBoundaryRefs,
      maxChildren: step.maxChildren,
      correctionContext: step.correctionContext,
      // P6：传入 run 冻结的 capabilitySnapshot，让 manager 决策消息投影「可用工具清单」，
      // 引导其设计 childSpec.allowedTools 时从真实可用工具中选取（不凭空编造）。
      capabilitySnapshot: step.input.capabilitySnapshot,
    }),
    allowedTools: [],
    maxModelRounds: step.managerMaxModelRounds,
    maxToolRounds: step.managerMaxToolRounds,
  });
  const structured = extractStructuredOutput(turn.finalOutput);
  return parseDeepDecision({
    value: structured,
    parentAgentId: DEEP_MANAGER_AGENT_ID,
    createdAt: step.createdAt,
  });
}

// ---------------------------------------------------------------------------
// Step 实现：direct_answer
// ---------------------------------------------------------------------------

type RunDirectAnswerStepInput = {
  readonly input: StartDeepRunInput;
  readonly config: DeepRunExecutorConfig;
  readonly decision: DeepDelegationDecision;
  readonly evidenceRefs: readonly string[];
  readonly managerMaxModelRounds: number;
  readonly managerMaxToolRounds: number;
  readonly goal: string;
  readonly createdAt: string;
};

/**
 * direct_answer 分支：证据已足够时直接产出结论级 SynthesizedConclusion（简单任务，
 * 无需多角度探索）。经 deep_direct_answer 契约调模型解析。
 */
async function runDirectAnswerStep(
  step: RunDirectAnswerStepInput,
): Promise<SynthesizedConclusion> {
  const callerRef: ObservationRef = {
    kind: "agent_run",
    id: step.input.run.runId,
    label: `${DEEP_MANAGER_AGENT_ID}:direct_answer`,
  };
  const turn = await executeDeepTurn({
    turnRuntime: step.config.turnRuntime,
    traceId: step.input.traceId,
    goalId: step.input.goalId,
    callerAgentId: DEEP_MANAGER_AGENT_ID,
    callerRef,
    purpose: "deep_direct_answer",
    outputContract: deepDirectAnswerOutputContract(),
    inputRefs: buildManagerInputRefs(step.input, []),
    messages: deepDirectAnswerMessages({
      goal: step.goal,
      taskSoil: step.input.taskSoil,
      decision: step.decision,
      evidenceRefs: step.evidenceRefs,
    }),
    allowedTools: [],
    maxModelRounds: step.managerMaxModelRounds,
    maxToolRounds: step.managerMaxToolRounds,
  });
  const structured = extractStructuredOutput(turn.finalOutput);
  return parseDeepDirectAnswer({
    value: structured,
    createdAt: step.createdAt,
    evidenceRefs: step.evidenceRefs,
  });
}

// ---------------------------------------------------------------------------
// Step 实现：spawn_children（委托 child-delegation）
// ---------------------------------------------------------------------------

type RunSpawnChildrenStepInput = {
  readonly decision: DeepDelegationDecision;
  readonly goal: string;
  readonly parentAgentId: string;
  readonly maxChildren: number;
  readonly input: StartDeepRunInput;
  readonly config: DeepRunExecutorConfig;
  readonly createdAt: string;
};

/**
 * spawn_children 分支：按 decision.childSpecs 派生 child（一层，depth=1）并逐个探索。
 * 委托 child-delegation.deriveDeepChildren（守 depth + 数量上限）与 exploreDeepChild
 * （经 ToolCenter/确认门）。child 产出局部材料汇入 childSummaries 供下一 step 综合或
 * ask_user。超数量上限的 childSpec 记入 overflowCount（不伪造派生成功）。
 */
async function runSpawnChildrenStep(
  step: RunSpawnChildrenStepInput,
): Promise<{
  readonly summaries: DeepChildSummary[];
  readonly completedRuns: ChildAgentRun[];
  readonly depthGuardPassed: boolean;
  readonly overflowCount: number;
}> {
  const derived = deriveDeepChildren({
    specs: step.decision.childSpecs,
    parentAgentId: step.parentAgentId,
    parentDepth: 0,
    goalId: step.input.goalId,
    traceId: step.input.traceId,
    maxChildren: step.maxChildren,
    createdAt: step.createdAt,
  });
  const summaries: DeepChildSummary[] = [];
  const completedRuns: ChildAgentRun[] = [];
  for (const childRun of derived.children) {
    const result = await exploreDeepChild({
      childRun,
      goal: step.goal,
      permissionBoundaryRefs: step.input.permissionBoundaryRefs,
      turnRuntime: step.config.turnRuntime,
      traceId: step.input.traceId,
      goalId: step.input.goalId,
      confirmationPolicy: step.input.confirmationPolicy,
      // P6：传入 run 冻结的 capabilitySnapshot，让 child 探索消息投影「本 child 被授权可用工具」
      // 及其能力简述，帮助 child 知道能用什么收集一手证据。
      capabilitySnapshot: step.input.capabilitySnapshot,
    });
    summaries.push(result.summary);
    completedRuns.push(result.completedRun);
  }
  return {
    summaries,
    completedRuns,
    depthGuardPassed: derived.depthGuard.passed,
    overflowCount: derived.overflowCount,
  };
}

// ---------------------------------------------------------------------------
// T2-7 辅助：stop 时的 partial 综合（FR-008，保留材料 + 尝试收口）
// ---------------------------------------------------------------------------

type AttemptPartialSynthesisInput = {
  readonly input: StartDeepRunInput;
  readonly config: DeepRunExecutorConfig;
  readonly childSummaries: readonly DeepChildSummary[];
  readonly completedChildRuns: readonly ChildAgentRun[];
  readonly decisions: readonly DeepDelegationDecision[];
  readonly goal: string;
  readonly managerMaxModelRounds: number;
  readonly managerMaxToolRounds: number;
};

/**
 * 用户 stop 时若有 child 材料则尝试产出 partial conclusion（经综合，受
 * assertNoDirectChildOutputHandoff 约束）。无材料返回 undefined；综合失败（硬约束或
 * 模型异常）时返回 undefined 但不抛——停止意图优先，材料已保留在结果中（FR-008）。
 */
async function attemptPartialSynthesis(
  input: AttemptPartialSynthesisInput,
): Promise<{ conclusion: SynthesizedConclusion; synthesisRecord: ParentSynthesisResult } | undefined> {
  if (input.childSummaries.length === 0) {
    return undefined;
  }
  const evidenceRefs = collectEvidenceRefs(input.childSummaries);
  try {
    const outcome = await synthesizeDeepConclusion({
      turnRuntime: input.config.turnRuntime,
      traceId: input.input.traceId,
      goalId: input.input.goalId,
      runId: input.input.run.runId,
      goal: input.goal,
      taskSoil: input.input.taskSoil,
      childSummaries: input.childSummaries,
      completedChildRuns: input.completedChildRuns,
      evidenceRefs,
      inputRefs: buildManagerInputRefs(input.input, input.decisions),
      maxModelRounds: input.managerMaxModelRounds,
      maxToolRounds: input.managerMaxToolRounds,
      createdAt: nowIso(),
    });
    return outcome;
  } catch {
    // FR-008：停止意图优先。partial 综合失败（硬约束/模型异常）不阻塞停止；
    // 已产出材料仍在结果中保留。partialSynthesis=false 体现在 control event。
    return undefined;
  }
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

/**
 * 构造 manager turn 的 inputRefs（可观察引用链）：trace + goal + manager run +
 * taskSoil 上下文引用 + 历史 decision 引用。用于 AgentTurnRuntime 把上下文挂到
 * ModelRequest（经 sanitizedMessages 装配正文，inputRefs 承载可观察引用）。
 */
function buildManagerInputRefs(
  input: StartDeepRunInput,
  decisions: readonly DeepDelegationDecision[],
): ObservationRef[] {
  const refs: ObservationRef[] = [
    { kind: "trace", id: input.traceId },
    { kind: "goal", id: input.goalId },
    { kind: "agent_run", id: input.run.runId, label: "deep-manager-run" },
  ];
  for (const contextRef of input.taskSoil.contextRefs) {
    refs.push({
      kind: "artifact",
      id: contextRef.ref,
      label: contextRef.summary,
    });
  }
  for (const decision of decisions) {
    refs.push({ kind: "agent_delegation", id: decision.decisionId });
  }
  return refs;
}

/**
 * 汇总已完成 child 的证据引用（去重），供 manager 决策/综合消息装配与结论 keyEvidenceRefs。
 */
function collectEvidenceRefs(childSummaries: readonly DeepChildSummary[]): string[] {
  const refs = new Set<string>();
  for (const child of childSummaries) {
    for (const ref of child.evidenceRefs) {
      const trimmed = ref.trim();
      if (trimmed.length > 0) {
        refs.add(trimmed);
      }
    }
  }
  return [...refs];
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

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : String(error);
}

// ---------------------------------------------------------------------------
// 类型再导出（供消费方按需引用 deep 模块契约）
// ---------------------------------------------------------------------------

export type {
  DeepConversation,
  DeepDelegationDecision,
  DeepRun,
  DeepChildSummary,
  SynthesizedConclusion,
};

export {
  DEEP_DECISION_CONTRACT_ID,
  DEEP_DIRECT_ANSWER_CONTRACT_ID,
};
