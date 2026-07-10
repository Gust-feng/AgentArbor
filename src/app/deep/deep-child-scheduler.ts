/**
 * DeepChildScheduler —— 多 Agent run 的并发 child 调度（deep 一期，T1-3，ADR-0025）。
 *
 * 按 maxConcurrency 并发启动 child 探索，只做状态与并发管理，不调用模型做语义判断
 * （FR-SCH-01/03）。child 通过注入的 child Agent runner 工厂运行，并复用
 * AgentTurnRuntime / ToolCenter / 确认门（FR-SCH-03，不复制执行实现）。
 *
 * 六能力（design.md §3.2 / tasks.md T1-3）：
 *   - {@link enqueue}：复用 deriveDeepChildren（守 depth=1 + 数量上限），结果记入 board 为 pending；
 *   - {@link startQueued}：按 (maxConcurrency - 当前 running) 取 pending 并发启动 child Agent run
 *     （fire-and-forget，不串行 await），resolve → markCompleted/markBlocked + onChildTerminal，
 *     reject → buildFailedChildExploration 降级为 failed task + onChildTerminal；
 *   - {@link waitForProgress}：等待任一 in-flight 终态，返回自上次以来新终态材料列表；
 *   - {@link waitForAll}：等待全部 in-flight 终态；
 *   - {@link waitForAllQueued}：持续启动 pending 并等待，直到 board 中不再有 pending/running；
 *   - {@link cancelPendingAndRunning}：pending 置 cancelled + board 置 stopped（此后 startQueued no-op）；
 *     同时清空尚未执行的父层追加指令；
 *   - {@link queueChildInstruction}：为 pending/running child 排队父层追加指令，当前 loop
 *     返回后按 FIFO 续跑同一个 childRunId；
 *   - {@link snapshot}：返回 board.snapshot()。
 *
 * 单 child 失败经 buildFailedChildExploration 降级为 failed task，不击穿 run（FR-SCH-04 /
 * FR-SAFE-01）。approval_required / out_of_fuel / context_overflow 等标准 child Agent
 * 暂停结果会进入 blocked task，交给父层审查而非误报失败。stop 不真 abort 模型调用：running child 自然完成，但其材料只进保留，
 * board stopped 后不触发继续探索，也不执行尚未开始的父层追加指令（design.md §6 风险2 / FR-SAFE-02）。
 *
 * 生命周期回调（onChildStarted / onChildTerminal）由 T2-1 DeepRuntime 装配，使事件与投影
 * 实时化（FR-PROJ-02）。本任务只预留注入位，不实现装配。
 *
 * 命名红线（ADR-0025 决策三）：scheduler 只产出 SynthesizedConclusion / DeepExplorationReport
 * 范围内的材料（child summary / completedRun），不出现 Plan / directionHandoffPackage /
 * artifact / Fruits。
 */
import type {
  ChildAgentRun,
  ChildAgentRunParentReview,
} from "../../domain/underground/agent-fabric.js";
import { createId, nowIso } from "../../kernel/id.js";
import type {
  DeepChildSpec,
  DeepChildSummary,
  DeepChildTask,
  DeepTaskBoardSnapshot,
} from "./contracts.js";
import {
  buildFailedChildExploration,
  DEEP_MAX_CHILDREN,
  deriveDeepChildren,
  type ExploreDeepChildResult,
} from "./child-delegation.js";
import { DeepTaskBoard } from "./deep-task-board.js";
import {
  DeepChildParentInstructionHistory,
  cloneDeepChildParentReview,
  deepChildParentInstructionMessageRef,
  summarizeDeepChildParentInstruction,
} from "./deep-child-parent-instruction-history.js";
import {
  executeDeepChildScheduledRun,
  mapDeepChildExecutionResult,
  type DeepChildScheduledInstruction,
} from "./deep-child-scheduler-execution.js";
import type {
  ContinueDeepChildFactory,
  DeepChildCancelResult,
  DeepChildEnqueueResult,
  DeepChildExecutedQueuedInstruction,
  DeepChildInstructionContinueResult,
  DeepChildInstructionQueueHandle,
  DeepChildInstructionQueueResult,
  DeepChildInstructionRecord,
  DeepChildQueuedInstructionProjection,
  DeepChildQueuedInstructionSource,
  DeepChildSchedulerCallbacks,
  DeepChildSchedulerConfig,
  DeepChildTerminalMaterial,
  ExploreDeepChildFactory,
} from "./deep-child-scheduler-contracts.js";
export type {
  ContinueDeepChildFactory,
  DeepChildCancelResult,
  DeepChildEnqueueResult,
  DeepChildExecutedQueuedInstruction,
  DeepChildInstructionContinueResult,
  DeepChildInstructionQueueHandle,
  DeepChildInstructionQueueResult,
  DeepChildInstructionRecord,
  DeepChildQueuedInstructionProjection,
  DeepChildQueuedInstructionSource,
  DeepChildSchedulerCallbacks,
  DeepChildSchedulerConfig,
  DeepChildTerminalMaterial,
  ExploreDeepChildFactory,
} from "./deep-child-scheduler-contracts.js";

/** scheduler 默认并发上限（design.md §3.2：生产默认 3，测试可注入 2）。 */
export const DEEP_SCHEDULER_DEFAULT_CONCURRENCY = 3;

/**
 * DeepChildScheduler —— per-run 并发调度器。
 *
 * 由 DeepRuntime 在 T2-1 装配（注入 board + exploreFactory + 并发配置 + 生命周期回调），
 * executor（T1-4）通过 enqueue / startQueued / waitForProgress / waitForAll /
 * waitForAllQueued / cancelPendingAndRunning / snapshot 七能力驱动 spawn_children / wait_children /
 * synthesize / control 四分支。
 */
export class DeepChildScheduler {
  private readonly board: DeepTaskBoard;
  private readonly exploreFactory: ExploreDeepChildFactory;
  private readonly continueFactory?: ContinueDeepChildFactory;
  private readonly maxConcurrency: number;
  private readonly maxChildren: number;
  private readonly callbacks?: DeepChildSchedulerCallbacks;
  /** childRunId → ChildAgentRun（deriveDeepChildren 产出，供 startQueued 调 exploreFactory）。 */
  private readonly childRunById: Map<string, ChildAgentRun> = new Map();
  /** childRunId -> 父层对该 child run 的追加/取消/执行操作历史。 */
  private readonly parentInstructionHistory = new DeepChildParentInstructionHistory();
  /** 当前在途（已启动未终态）的 child 数。 */
  private inFlightCount = 0;
  /** 自上次 waitForProgress 以来新终态的材料缓冲。 */
  private terminalBuffer: DeepChildTerminalMaterial[] = [];
  /** pending/running child 接收到的父层补充指令；当前 loop 结束后按 FIFO 同 childRunId 续跑。 */
  private readonly queuedInstructionsByChildRunId: Map<string, DeepChildScheduledInstruction[]> = new Map();
  /** waitForProgress 的等待者（任一终态时被唤醒）。 */
  private progressWaiters: Array<() => void> = [];
  /** executor 每步设置的当前 stepIndex，供生命周期回调装配进度事件元数据（默认 0）。 */
  private currentStepIndex = 0;

  constructor(config: DeepChildSchedulerConfig) {
    this.board = config.board;
    this.exploreFactory = config.exploreFactory;
    this.continueFactory = config.continueFactory;
    this.maxConcurrency = Math.max(
      1,
      Math.floor(config.maxConcurrency ?? DEEP_SCHEDULER_DEFAULT_CONCURRENCY),
    );
    this.maxChildren = Math.max(0, Math.floor(config.maxChildren ?? DEEP_MAX_CHILDREN));
    this.callbacks = config.callbacks;
  }

  /**
   * 复用 deriveDeepChildren（守 depth=1 + 数量上限，FR-SCH-01），结果记入 board 为 pending。
   * 返回 addedCount / overflowCount / depthGuardPassed / tasks 供 executor 记录 step。
   *
   * 不调用模型（deriveDeepChildren 是纯派生 + Guard）；超数量上限的 childSpec 记入
   * overflowCount（不伪造派生成功，AI-first 边界）。
   */
  enqueue(input: {
    readonly specs: readonly DeepChildSpec[];
    readonly parentAgentId: string;
    readonly goalId: string;
    readonly traceId: string;
    readonly createdAt?: string;
  }): DeepChildEnqueueResult {
    const derived = deriveDeepChildren({
      specs: input.specs,
      parentAgentId: input.parentAgentId,
      parentDepth: 0,
      goalId: input.goalId,
      traceId: input.traceId,
      maxChildren: this.maxChildren,
      createdAt: input.createdAt,
    });
    const specBySpecId = new Map(
      input.specs.map((spec) => [spec.specId, spec] as const),
    );
    const seeds: { readonly childRunId: string; readonly spec: DeepChildSpec }[] = [];
    for (const childRun of derived.children) {
      this.childRunById.set(childRun.childRunId, childRun);
      const spec = specBySpecId.get(childRun.spec.specId);
      if (spec === undefined) {
        // deriveDeepChildren 产出的 childRun.spec.specId 必能在传入 specs 中找到；
        // 找不到属调用方契约不一致，跳过该 child 不入板（不伪造入板成功）。
        continue;
      }
      seeds.push({ childRunId: childRun.childRunId, spec });
    }
    const tasks = this.board.enqueue(seeds);
    return {
      addedCount: tasks.length,
      overflowCount: derived.overflowCount,
      depthGuardPassed: derived.depthGuard.passed,
      tasks,
    };
  }

  /**
   * 取 (maxConcurrency - 当前 running) 个 pending 并发启动 child Agent run（fire-and-forget）。
   * board stopped 后为 no-op（FR-SAFE-02）。
   *
   * 并发语义（FR-SCH-02 验收：事件顺序证明并发）：所有被选中的 pending 任务在同一个同步
   * 遍历内依次 markRunning + 触发 onChildStarted + 启动 child Agent run，遍历期间不让出
   * 事件循环；因此 onChildStarted 的多个回调先于任何 child Agent run 终态（出现
   * `started, started, ..., completed` 的真实并发序列，而非成对串行）。
   */
  startQueued(): number {
    if (this.board.isStopped()) {
      return 0;
    }
    const snapshot = this.board.snapshot();
    const runningCount = snapshot.tasks.filter((task) => task.status === "running").length;
    const slots = Math.max(0, this.maxConcurrency - runningCount);
    if (slots === 0) {
      return 0;
    }
    const pending = snapshot.tasks
      .filter((task) => task.status === "pending")
      .slice(0, slots);
    let started = 0;
    for (const task of pending) {
      const childRun = this.childRunById.get(task.childRunId);
      if (childRun === undefined) {
        // 入板时已建立映射；缺映射属内部不一致，跳过启动（不击穿）。
        continue;
      }
      const runningTask = this.board.markRunning(task.taskId);
      this.invokeStarted(runningTask, childRun);
      this.inFlightCount += 1;
      started += 1;
      void this.runChild(task.taskId, childRun, task.spec);
    }
    return started;
  }

  /**
   * 父层显式要求同一个 child run 继续工作。
   *
   * 与 enqueue/startQueued 的新 child 路径不同，这里不创建 child，不改变 childRunId；
   * 只把既有任务切回 running，调用注入的 continueFactory 追加父层指令并复用标准
   * child Agent loop。返回值直接交给 executor 合并进父层材料。
   */
  async continueChild(input: {
    readonly childRun: ChildAgentRun;
    readonly childSpec: DeepChildSpec;
    readonly parentInstruction: string;
    readonly previousSummary?: DeepChildSummary;
    readonly source?: DeepChildQueuedInstructionSource;
    readonly review?: ChildAgentRunParentReview;
  }): Promise<DeepChildTerminalMaterial> {
    if (this.continueFactory === undefined) {
      throw new Error("DeepChildScheduler: continueFactory is not configured");
    }
    const task = this.findTaskByChildRunId(input.childRun.childRunId);
    if (task === undefined) {
      throw new Error(`DeepChildScheduler: child task not found (childRunId=${input.childRun.childRunId})`);
    }
    const requestedAt = nowIso();
    const instructionId = createId("deep-child-instruction");
    const messageRef = deepChildParentInstructionMessageRef(instructionId);
    const childRunForContinuation = this.recordParentInstructionForRun(input.childRun, {
      instructionId,
      messageRef,
      childRunId: input.childRun.childRunId,
      source: input.source ?? "manager",
      status: "executed",
      instructionSummary: summarizeDeepChildParentInstruction(input.parentInstruction),
      review: cloneDeepChildParentReview(input.review),
      requestedAt,
      executedAt: requestedAt,
    });
    const executedInstructionRecord: DeepChildInstructionRecord = {
      instructionId,
      messageRef,
      childRunId: input.childRun.childRunId,
      source: input.source ?? "manager",
      status: "executed",
      instruction: input.parentInstruction,
      review: cloneDeepChildParentReview(input.review),
      requestedAt,
      executedAt: requestedAt,
    };
    const runningTask = this.board.markRunning(task.taskId);
    this.invokeStarted(runningTask, childRunForContinuation);
    let summary: DeepChildSummary;
    let completedRun: ChildAgentRun;
    let terminalTask: DeepChildTask;
    let pendingContinuation: ExploreDeepChildResult["pendingContinuation"];
    try {
      const result = await this.continueFactory(
        childRunForContinuation,
        input.childSpec,
        input.parentInstruction,
        input.previousSummary,
        {
          instructionId,
          messageRef,
          source: input.source ?? "manager",
          review: cloneDeepChildParentReview(input.review),
        },
      );
      pendingContinuation = result.pendingContinuation;
      terminalTask = mapDeepChildExecutionResult({
        board: this.board,
        taskId: task.taskId,
        result,
      });
      summary = result.summary;
      completedRun = this.applyParentInstructionHistory(result.completedRun);
      this.childRunById.set(input.childRun.childRunId, completedRun);
    } catch (error) {
      const reason = errorMessage(error);
      const failed = buildFailedChildExploration({
        childRun: childRunForContinuation,
        childSpec: input.childSpec,
        reason,
        failedAt: nowIso(),
      });
      summary = failed.summary;
      completedRun = this.applyParentInstructionHistory(failed.completedRun);
      terminalTask = this.board.markFailed(task.taskId, reason, summary);
    } finally {
      this.invokeInstructionRecorded(executedInstructionRecord);
    }
    const material: DeepChildTerminalMaterial = {
      task: terminalTask,
      summary,
      completedRun,
      pendingContinuation,
    };
    this.invokeTerminal(material);
    return material;
  }

  /**
   * 为尚未交还终态材料的 child 追加父层指令。
   *
   * pending/running 状态下只入队，不直接打断当前模型/工具 loop；runChild 在当前 loop
   * 返回后会把 queued instruction 作为同一个 childRunId 的 continueFactory 续跑，再
   * 交还最终材料。completed/failed/blocked/interrupted 已进入父层审查态，应走 continueChild 或外部
   * child message 路由的即时恢复路径，不在这里静默改写终态材料。
   */
  queueChildInstruction(input: {
    readonly childRunId: string;
    readonly instruction: string;
    readonly source?: DeepChildQueuedInstructionSource;
    readonly review?: ChildAgentRunParentReview;
  }): DeepChildInstructionQueueResult {
    const instruction = input.instruction.trim();
    const task = this.findTaskByChildRunId(input.childRunId);
    if (task === undefined) {
      return {
        status: "child_not_found",
        childRunId: input.childRunId,
        reason: "child task not found",
      };
    }
    if (instruction.length === 0) {
      return {
        status: "not_accepting",
        childRunId: input.childRunId,
        childStatus: task.status,
        reason: "empty instruction",
      };
    }
    if (this.continueFactory === undefined) {
      return {
        status: "not_accepting",
        childRunId: input.childRunId,
        childStatus: task.status,
        reason: "continueFactory is not configured",
      };
    }
    if (this.board.isStopped()) {
      return {
        status: "not_accepting",
        childRunId: input.childRunId,
        childStatus: task.status,
        reason: "child scheduler is stopped",
      };
    }
    if (task.status !== "pending" && task.status !== "running") {
      return {
        status: "not_accepting",
        childRunId: input.childRunId,
        childStatus: task.status,
        reason: `child status ${task.status} is not queueable`,
      };
    }
    const instructionId = createId("deep-child-instruction");
    const queuedInstruction: DeepChildScheduledInstruction = {
      instructionId,
      messageRef: deepChildParentInstructionMessageRef(instructionId),
      childRunId: input.childRunId,
      instruction,
      source: input.source ?? "control_api",
      review: cloneDeepChildParentReview(input.review),
      queuedAt: nowIso(),
    };
    this.recordParentInstruction(input.childRunId, {
      instructionId: queuedInstruction.instructionId,
      messageRef: queuedInstruction.messageRef,
      childRunId: queuedInstruction.childRunId,
      source: queuedInstruction.source,
      status: "queued",
      instructionSummary: summarizeDeepChildParentInstruction(instruction),
      review: cloneDeepChildParentReview(queuedInstruction.review),
      requestedAt: queuedInstruction.queuedAt,
      queuedAt: queuedInstruction.queuedAt,
    });
    this.invokeInstructionRecorded({
      instructionId: queuedInstruction.instructionId,
      messageRef: queuedInstruction.messageRef,
      childRunId: queuedInstruction.childRunId,
      source: queuedInstruction.source,
      status: "queued",
      instruction,
      review: cloneDeepChildParentReview(queuedInstruction.review),
      requestedAt: queuedInstruction.queuedAt,
      queuedAt: queuedInstruction.queuedAt,
    });
    const queue = this.queuedInstructionsByChildRunId.get(input.childRunId) ?? [];
    queue.push(queuedInstruction);
    this.queuedInstructionsByChildRunId.set(input.childRunId, queue);
    this.invokeInstructionQueued(task, {
      instructionId: queuedInstruction.instructionId,
      messageRef: queuedInstruction.messageRef,
      childRunId: queuedInstruction.childRunId,
      source: queuedInstruction.source,
      queuedAt: queuedInstruction.queuedAt,
      queuedCount: queue.length,
    });
    return {
      status: "queued",
      instructionId: queuedInstruction.instructionId,
      messageRef: queuedInstruction.messageRef,
      childRunId: input.childRunId,
      childStatus: task.status,
      queuedCount: queue.length,
      queuedAt: queuedInstruction.queuedAt,
    };
  }

  getInstructionQueueHandle(): DeepChildInstructionQueueHandle {
    return {
      queueChildInstruction: (input) => this.queueChildInstruction(input),
      continueChildInstruction: (input) => this.continueChildInstruction(input),
      snapshot: () => this.snapshot(),
    };
  }

  async continueChildInstruction(input: {
    readonly childRunId: string;
    readonly instruction: string;
    readonly source?: DeepChildQueuedInstructionSource;
    readonly review?: ChildAgentRunParentReview;
  }): Promise<DeepChildInstructionContinueResult> {
    const instruction = input.instruction.trim();
    const task = this.findTaskByChildRunId(input.childRunId);
    if (task === undefined) {
      return {
        status: "child_not_found",
        childRunId: input.childRunId,
        reason: "child task not found",
      };
    }
    if (instruction.length === 0) {
      return {
        status: "not_accepting",
        childRunId: input.childRunId,
        childStatus: task.status,
        reason: "empty instruction",
      };
    }
    if (this.continueFactory === undefined) {
      return {
        status: "not_accepting",
        childRunId: input.childRunId,
        childStatus: task.status,
        reason: "continueFactory is not configured",
      };
    }
    if (this.board.isStopped()) {
      return {
        status: "not_accepting",
        childRunId: input.childRunId,
        childStatus: task.status,
        reason: "child scheduler is stopped",
      };
    }
    if (task.status === "pending" || task.status === "running") {
      return {
        status: "not_accepting",
        childRunId: input.childRunId,
        childStatus: task.status,
        reason: `child status ${task.status} should be queued before the current loop finishes`,
      };
    }
    if (task.status === "cancelled") {
      return {
        status: "not_accepting",
        childRunId: input.childRunId,
        childStatus: task.status,
        reason: `child status ${task.status} cannot be continued`,
      };
    }
    const childRun = this.childRunById.get(input.childRunId);
    if (childRun === undefined) {
      return {
        status: "not_accepting",
        childRunId: input.childRunId,
        childStatus: task.status,
        reason: "child run material not available",
      };
    }
    this.inFlightCount += 1;
    try {
      const material = await this.continueChild({
        childRun,
        childSpec: task.summary?.spec ?? task.spec,
        previousSummary: task.summary,
        parentInstruction: instruction,
        source: input.source ?? "control_api",
        review: cloneDeepChildParentReview(input.review),
      });
      this.notifyTerminal(material);
      return {
        status: "continued",
        childRunId: input.childRunId,
        childStatus: material.task.status,
        material,
      };
    } catch (error) {
      this.inFlightCount = Math.max(0, this.inFlightCount - 1);
      throw error;
    }
  }

  /**
   * 等待任一 in-flight child 终态，返回自上次以来新终态的材料列表（FR-WAIT-01/02）。
   * 无在途任务且无缓冲时返回空（调用方 executor 据此判断"无在途任务"按模型语义继续）。
   */
  async waitForProgress(): Promise<DeepChildTerminalMaterial[]> {
    if (this.terminalBuffer.length > 0) {
      return this.drainBuffer();
    }
    if (this.inFlightCount === 0) {
      return [];
    }
    await new Promise<void>((resolve) => {
      this.progressWaiters.push(resolve);
    });
    return this.drainBuffer();
  }

  /**
   * 等待全部 in-flight child 终态，累积返回全部终态材料（FR-SAFE-03 synthesize 前清场：
   * 仍有 running 时先等全部终态再综合，本轮最小闭环口径）。
   */
  async waitForAll(): Promise<DeepChildTerminalMaterial[]> {
    const accumulated: DeepChildTerminalMaterial[] = [];
    while (this.inFlightCount > 0) {
      const batch = await this.waitForProgress();
      accumulated.push(...batch);
    }
    // 兜底：极端时序下 inFlightCount 归零后仍可能有残留缓冲（waitForProgress 已 drain，
    // 此处通常为空），drain 以保单调一致。
    accumulated.push(...this.drainBuffer());
    return accumulated;
  }

  /**
   * 非阻塞回收已经进入终态缓冲的 child 材料。
   *
   * manager 每个 step 开始前调用它，把刚完成但尚未 wait 的 child 材料合并进父层
   * 上下文；没有材料时立即返回空，不等待 running child。
   */
  harvestReady(): DeepChildTerminalMaterial[] {
    return this.drainBuffer();
  }

  /**
   * 持续启动 pending child 并等待全部 in-flight 终态，直到 task board 不再有 pending/running。
   *
   * synthesize 前使用该能力清空真实队列：若 maxConcurrency 小于派生数量，会按批次启动
   * 剩余 pending，而不是只等待当前 running 导致终态投影残留 planned 节点。board stopped
   * 后不再启动 pending，只 drain running。
   */
  async waitForAllQueued(): Promise<DeepChildTerminalMaterial[]> {
    const accumulated: DeepChildTerminalMaterial[] = [];
    while (true) {
      if (!this.board.isStopped()) {
        const started = this.startQueued();
        const snapshotAfterStart = this.board.snapshot();
        const hasPendingWithoutRunning =
          started === 0 &&
          this.inFlightCount === 0 &&
          snapshotAfterStart.tasks.some((task) => task.status === "pending");
        if (hasPendingWithoutRunning) {
          // 理论上只有 childRun 映射缺失才会发生。取消异常 pending，避免终态保留
          // 无法解释的 planned 节点；不置 board stopped，不影响已完成材料综合。
          for (const task of snapshotAfterStart.tasks) {
            if (task.status === "pending") {
              this.board.markCancelled(task.taskId);
            }
          }
        }
      }
      accumulated.push(...(await this.waitForAll()));
      const snapshot = this.board.snapshot();
      const hasRunning = snapshot.tasks.some((task) => task.status === "running");
      const hasPending = snapshot.tasks.some((task) => task.status === "pending");
      if (!hasRunning && (!hasPending || this.board.isStopped())) {
        accumulated.push(...this.drainBuffer());
        return accumulated;
      }
    }
  }

  /**
   * 取消全部 pending（置 cancelled）并置 board stopped（此后 startQueued 为 no-op）。
   * running child 不真 abort，完成后材料只进保留（不触发继续探索）；尚未执行的父层
   * 追加指令会被丢弃，避免 stop 后又续跑同一个 child，FR-SAFE-02。
   * 返回被取消的 pending 任务数。
   */
  cancelPendingAndRunning(reason?: string): DeepChildCancelResult {
    void reason; // reason 仅供调用方可观察（事件/日志由 T2-2 承载），scheduler 不存 raw。
    this.board.markStopped();
    const cancelledAt = nowIso();
    for (const queue of this.queuedInstructionsByChildRunId.values()) {
      for (const instruction of queue) {
        this.markParentInstructionCancelled(instruction.childRunId, instruction.instructionId, cancelledAt);
        this.invokeInstructionRecorded({
          instructionId: instruction.instructionId,
          messageRef: instruction.messageRef,
          childRunId: instruction.childRunId,
          source: instruction.source,
          status: "cancelled",
          instruction: instruction.instruction,
          requestedAt: instruction.queuedAt,
          queuedAt: instruction.queuedAt,
          cancelledAt,
        });
      }
    }
    this.queuedInstructionsByChildRunId.clear();
    const snapshot = this.board.snapshot();
    let cancelledCount = 0;
    for (const task of snapshot.tasks) {
      if (task.status === "pending") {
        this.board.markCancelled(task.taskId);
        cancelledCount += 1;
      }
    }
    return { cancelledCount };
  }

  /** 返回 board 当前不可变快照（运行中事实源对外投影，FR-TB-02）。 */
  snapshot(): DeepTaskBoardSnapshot {
    return this.board.snapshot();
  }

  /** 暴露 board 引用（供 executor 在 step 边界 setPhase / 装配 brief / 终态对齐）。 */
  getBoard(): DeepTaskBoard {
    return this.board;
  }

  /**
   * 设置当前 manager stepIndex（executor 在每个 loop 顶部调用），供生命周期回调
   * （onChildStarted/onChildTerminal）装配 child.started/child.completed 进度事件元数据。
   * scheduler 自身不解读 stepIndex 语义，仅透传给回调；回调决定如何投影。
   */
  setStepIndex(stepIndex: number): void {
    this.currentStepIndex = stepIndex;
  }

  // -------------------------------------------------------------------------
  // 内部：单个 child 并发执行（fire-and-forget runChild 由 startQueued 启动）
  // -------------------------------------------------------------------------

  /**
   * 单个 child 的并发执行体。resolve → markCompleted/markBlocked + onChildTerminal；
   * reject → buildFailedChildExploration 降级为 failed task + onChildTerminal（FR-SCH-04）。
   * 终态后 notifyTerminal 把材料交还 waitForProgress / waitForAll。
   */
  private async runChild(taskId: string, childRun: ChildAgentRun, childSpec: DeepChildSpec): Promise<void> {
    const material = await executeDeepChildScheduledRun({
      board: this.board,
      taskId,
      childRun,
      childSpec,
      childRunById: this.childRunById,
      exploreFactory: this.exploreFactory,
      continueFactory: this.continueFactory,
      applyParentInstructionHistory: (run) => this.applyParentInstructionHistory(run),
      takeNextInstruction: (childRunId) => this.shiftQueuedInstruction(childRunId),
      markParentInstructionExecuted: (childRunId, instructionId, executedAt) =>
        this.markParentInstructionExecuted(childRunId, instructionId, executedAt),
      recordInstruction: (instruction) => this.invokeInstructionRecorded(instruction),
    });
    this.invokeTerminal(material);
    this.notifyTerminal(material);
  }
  private shiftQueuedInstruction(childRunId: string): DeepChildScheduledInstruction | undefined {
    const queue = this.queuedInstructionsByChildRunId.get(childRunId);
    if (queue === undefined || queue.length === 0) {
      return undefined;
    }
    const instruction = queue.shift();
    if (queue.length === 0) {
      this.queuedInstructionsByChildRunId.delete(childRunId);
    }
    return instruction;
  }

  private notifyTerminal(material: DeepChildTerminalMaterial): void {
    this.terminalBuffer.push(material);
    this.inFlightCount = Math.max(0, this.inFlightCount - 1);
    const waiters = this.progressWaiters;
    this.progressWaiters = [];
    for (const resolve of waiters) {
      resolve();
    }
  }

  private drainBuffer(): DeepChildTerminalMaterial[] {
    const drained = this.terminalBuffer;
    this.terminalBuffer = [];
    return drained;
  }

  private invokeStarted(task: DeepChildTask, childRun: ChildAgentRun): void {
    const callback = this.callbacks?.onChildStarted;
    if (callback === undefined) {
      return;
    }
    this.invokeCallback(() => callback(task, childRun, this.currentStepIndex));
  }

  private invokeTerminal(material: DeepChildTerminalMaterial): void {
    const callback = this.callbacks?.onChildTerminal;
    if (callback === undefined) {
      return;
    }
    this.invokeCallback(() => callback(
      material.task,
      material.summary,
      material.completedRun,
      material,
      this.currentStepIndex,
    ));
  }

  private invokeInstructionQueued(
    task: DeepChildTask,
    queued: DeepChildQueuedInstructionProjection,
  ): void {
    const callback = this.callbacks?.onChildInstructionQueued;
    if (callback === undefined) {
      return;
    }
    this.invokeCallback(() => callback(task, queued, this.currentStepIndex));
  }

  private invokeInstructionRecorded(instruction: DeepChildInstructionRecord): void {
    const callback = this.callbacks?.onChildInstructionRecorded;
    if (callback === undefined) {
      return;
    }
    this.invokeCallback(() => callback(instruction, this.currentStepIndex));
  }

  private findTaskByChildRunId(childRunId: string): DeepChildTask | undefined {
    return this.board.snapshot().tasks.find((task) => task.childRunId === childRunId);
  }

  private recordParentInstruction(childRunId: string, instruction: Parameters<DeepChildParentInstructionHistory["record"]>[2]): void {
    const updated = this.parentInstructionHistory.record(
      childRunId,
      this.childRunById.get(childRunId),
      instruction,
    );
    if (updated !== undefined) {
      this.childRunById.set(childRunId, updated);
    }
  }

  private recordParentInstructionForRun(
    childRun: ChildAgentRun,
    instruction: Parameters<DeepChildParentInstructionHistory["record"]>[2],
  ): ChildAgentRun {
    return this.parentInstructionHistory.record(childRun.childRunId, childRun, instruction) ?? childRun;
  }

  private markParentInstructionExecuted(childRunId: string, instructionId: string, executedAt: string): void {
    const updated = this.parentInstructionHistory.markExecuted(
      childRunId,
      this.childRunById.get(childRunId),
      instructionId,
      executedAt,
    );
    if (updated !== undefined) {
      this.childRunById.set(childRunId, updated);
    }
  }

  private markParentInstructionCancelled(childRunId: string, instructionId: string, cancelledAt: string): void {
    const updated = this.parentInstructionHistory.markCancelled(
      childRunId,
      this.childRunById.get(childRunId),
      instructionId,
      cancelledAt,
    );
    if (updated !== undefined) {
      this.childRunById.set(childRunId, updated);
    }
  }

  private applyParentInstructionHistory(childRun: ChildAgentRun): ChildAgentRun {
    return this.parentInstructionHistory.apply(childRun);
  }

  /**
   * 同步触发回调（不 await），吞掉同步异常与异步 rejection——投影/事件回调不能反向
   * 改变调度状态或击穿 run（与 executor emitProgress 同口径）。回调可做异步工作
   * （如 store.upsert），但其结果不参与调度关键路径，保序只看同步触发点。
   */
  private invokeCallback(emit: () => void | Promise<void>): void {
    try {
      const ret = emit();
      if (ret !== undefined && typeof (ret as Promise<void>).then === "function") {
        void (ret as Promise<void>).catch(() => {
          /* 投影/事件回调异步失败不影响调度 */
        });
      }
    } catch {
      /* 投影/事件回调同步失败不影响调度 */
    }
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : String(error);
}
