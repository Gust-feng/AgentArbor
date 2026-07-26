/**
 * DeepTaskBoard —— 一次多 Agent run 的运行中权威任务状态（deep 一期，T1-2，ADR-0025）。
 *
 * per-run、manager-owned，只记安全结构化字段（不保存 raw prompt / raw response / 工具原始
 * 输出，FR-TB-01）；是 liveProjection 与 eventSequence 的运行中事实源（FR-TB-02）；
 * 不替 manager 判断语义（FR-TB-03，不内置"是否继续探索/是否综合"规则）。
 *
 * 边界（design.md §3.1）：
 *   - 不调用模型；
 *   - 不负责并发启动（那是 {@link DeepChildScheduler} 的职责）；
 *   - 状态迁移只守合法性（pending → running → 终态；可审查终态可由父层显式继续），不做业务决策。
 *
 * 单一事实源链（design.md §6 风险3）：运行中 board.snapshot() 是权威状态；liveProjection
 * 与 eventSequence 的 child 状态从 snapshot 派生（T2-1）；终态 board.terminalSnapshot()
 * 供 buildAndPublishRunTree 对齐（T2-1）。
 *
 * 命名红线（ADR-0025 决策三）：DeepChildTask 只记安全结构化字段，不出现
 * Plan / directionHandoffPackage / artifact / Fruits 产物字段；child 完整材料仍由
 * DeepChildSummary / ChildAgentRun / event refs / DeepExplorationReport 承载。
 */
import { createId, nowIso } from "../../kernel/id.js";
import type { ChildAgentRunPendingApproval } from "../../domain/underground/agent-fabric.js";
import type {
  DeepChildStatus,
  DeepChildSpec,
  DeepChildSummary,
  DeepChildTask,
  DeepChildTaskSeed,
  DeepTaskBoardPhase,
  DeepTaskBoardSnapshot,
} from "./contracts.js";

/** 任务板默认初始相位（manager run 启动时处于规划态）。 */
export const DEEP_TASK_BOARD_DEFAULT_PHASE: DeepTaskBoardPhase = "planning";

/**
 * 合法状态迁移邻接表（from → 允许的 to 集合）。cancelled 为不可逆终态；completed/failed/blocked/interrupted
 * 仅允许在父层显式继续同一 child run 时回到 running，其他终态重写仍被拒绝。
 */
const ALLOWED_TRANSITIONS: ReadonlyMap<DeepChildStatus, ReadonlySet<DeepChildStatus>> = new Map([
  ["pending", new Set<DeepChildStatus>(["running", "cancelled"])],
  ["running", new Set<DeepChildStatus>(["completed", "failed", "interrupted", "cancelled", "blocked"])],
  ["completed", new Set<DeepChildStatus>(["running"])],
  ["failed", new Set<DeepChildStatus>(["running"])],
  ["interrupted", new Set<DeepChildStatus>(["running", "cancelled"])],
  ["cancelled", new Set<DeepChildStatus>()],
  ["blocked", new Set<DeepChildStatus>(["running", "cancelled"])],
]);

/**
 * DeepTaskBoard —— per-run、manager-owned 任务板。
 *
 * 一次多 Agent run 创建一个实例（由 DeepRuntime 在 T2-1 装配）。所有状态变更方法
 * 同步执行（无 await），单线程事件循环内天然原子；snapshot 返回深拷贝保证外部不可变。
 */
export class DeepTaskBoard {
  private readonly runId: string;
  private readonly tasks: Map<string, DeepChildTask> = new Map();
  private phase: DeepTaskBoardPhase;
  private stopped = false;
  private updatedAt: string;

  constructor(input: { readonly runId: string; readonly initialPhase?: DeepTaskBoardPhase }) {
    this.runId = input.runId;
    this.phase = input.initialPhase ?? DEEP_TASK_BOARD_DEFAULT_PHASE;
    this.updatedAt = nowIso();
  }

  /**
   * 把派生 child 批量记为 pending（design.md §3.1）。board 为每个种子生成任务板内稳定
   * taskId；返回创建的任务列表（不可变快照副本）。不保存 raw 材料（FR-TB-01）。
   */
  enqueue(seeds: readonly DeepChildTaskSeed[]): readonly DeepChildTask[] {
    const createdAt = nowIso();
    const created: DeepChildTask[] = [];
    for (const seed of seeds) {
      const taskId = createId("deep-task");
      const task: DeepChildTask = {
        taskId,
        childRunId: seed.childRunId,
        spec: seed.spec,
        status: "pending",
        updatedAt: createdAt,
      };
      this.tasks.set(taskId, task);
      created.push(task);
    }
    this.touch();
    return created.map((task) => cloneTask(task));
  }

  /** pending → running（startedAt 回填）。 */
  markRunning(taskId: string): DeepChildTask {
    return this.transition(taskId, "running", (task) => {
      const at = nowIso();
      return {
        ...task,
        status: "running",
        startedAt: task.startedAt ?? at,
        updatedAt: at,
        completedAt: undefined,
        summary: undefined,
        failure: undefined,
        pendingApproval: undefined,
      };
    });
  }

  /** running → completed（summary 回填，completedAt 回填）。 */
  markCompleted(taskId: string, summary: DeepChildSummary): DeepChildTask {
    return this.transition(taskId, "completed", (task) => {
      const at = nowIso();
      return { ...task, status: "completed", summary, completedAt: at, updatedAt: at, pendingApproval: undefined };
    });
  }

  /** running → failed（failure / 可选安全 summary 回填，completedAt 回填）。 */
  markFailed(taskId: string, failure: string, summary?: DeepChildSummary): DeepChildTask {
    return this.transition(taskId, "failed", (task) => {
      const at = nowIso();
      return {
        ...task,
        status: "failed",
        summary: summary === undefined ? undefined : cloneSummary(summary),
        failure,
        completedAt: at,
        updatedAt: at,
        pendingApproval: undefined,
      };
    });
  }

  /** running → interrupted（child 自身中断/异常停止；可带安全 summary，父层可审查后继续）。 */
  markInterrupted(taskId: string, reason: string, summary?: DeepChildSummary): DeepChildTask {
    return this.transition(taskId, "interrupted", (task) => {
      const at = nowIso();
      return {
        ...task,
        status: "interrupted",
        summary: summary === undefined ? undefined : cloneSummary(summary),
        failure: reason,
        completedAt: at,
        updatedAt: at,
        pendingApproval: undefined,
      };
    });
  }

  /** running → blocked（summary/failure 回填，completedAt 表示本次暂停时间）。 */
  markBlocked(
    taskId: string,
    summary: DeepChildSummary,
    pendingApproval?: ChildAgentRunPendingApproval,
  ): DeepChildTask {
    return this.transition(taskId, "blocked", (task) => {
      const at = nowIso();
      return {
        ...task,
        status: "blocked",
        summary,
        failure: summary.uncertainty ?? summary.summary,
        pendingApproval: clonePendingApproval(pendingApproval),
        completedAt: at,
        updatedAt: at,
      };
    });
  }

  /** pending/running → cancelled（不回填 summary；pending 取消无 startedAt）。 */
  markCancelled(taskId: string): DeepChildTask {
    return this.transition(taskId, "cancelled", (task) => {
      const at = nowIso();
      return { ...task, status: "cancelled", updatedAt: at, pendingApproval: undefined };
    });
  }

  /**
   * 置 board stopped 标志（此后 scheduler.startQueued 为 no-op）并把相位切到 stopped。
   * running child 不被真 abort（design.md §6 风险2），自然完成后材料只进保留。
   */
  markStopped(): void {
    this.stopped = true;
    this.phase = "stopped";
    this.touch();
  }

  isStopped(): boolean {
    return this.stopped;
  }

  setPhase(phase: DeepTaskBoardPhase): void {
    this.phase = phase;
    this.touch();
  }

  getPhase(): DeepTaskBoardPhase {
    return this.phase;
  }

  getRunId(): string {
    return this.runId;
  }

  /** 返回不可变快照（tasks 深拷贝，外部修改不影响内部，FR-TB-02）。 */
  snapshot(): DeepTaskBoardSnapshot {
    return {
      runId: this.runId,
      phase: this.phase,
      tasks: [...this.tasks.values()].map((task) => cloneTask(task)),
      updatedAt: this.updatedAt,
    };
  }

  /**
   * 返回终态快照（供 final AgentRunTree 对齐，FR-PROJ-03）。当前等价于 snapshot()，
   * 语义上标记为"终态读取点"——调用方（T2-1 buildAndPublishRunTree）据此与 executor
   * 结果构建一致的 AgentRunTree（final tree child 状态 ≡ board 终态快照）。
   */
  terminalSnapshot(): DeepTaskBoardSnapshot {
    return this.snapshot();
  }

  private transition(
    taskId: string,
    to: DeepChildStatus,
    apply: (task: DeepChildTask) => DeepChildTask,
  ): DeepChildTask {
    const current = this.tasks.get(taskId);
    if (current === undefined) {
      throw new Error(`DeepTaskBoard: task not found (taskId=${taskId})`);
    }
    assertTransition(current.status, to);
    const next = apply(current);
    this.tasks.set(taskId, next);
    this.updatedAt = next.updatedAt;
    return cloneTask(next);
  }

  private touch(): void {
    this.updatedAt = nowIso();
  }
}

// ---------------------------------------------------------------------------
// 本地辅助函数
// ---------------------------------------------------------------------------

function assertTransition(from: DeepChildStatus, to: DeepChildStatus): void {
  const allowed = ALLOWED_TRANSITIONS.get(from);
  if (allowed === undefined || !allowed.has(to)) {
    throw new Error(
      `DeepTaskBoard: illegal status transition ${from} -> ${to} (terminal states are irreversible)`,
    );
  }
}

/**
 * 深拷贝单个 DeepChildTask（含嵌套 spec/summary 数组），保证 snapshot/mark* 返回值不可变，
 * 外部修改不污染 board 内部状态（FR-TB-02 不可变快照）。
 */
function cloneTask(task: DeepChildTask): DeepChildTask {
  return {
    taskId: task.taskId,
    childRunId: task.childRunId,
    spec: cloneSpec(task.spec),
    status: task.status,
    startedAt: task.startedAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
    summary: task.summary === undefined ? undefined : cloneSummary(task.summary),
    failure: task.failure,
    pendingApproval: clonePendingApproval(task.pendingApproval),
  };
}

function cloneSpec(spec: DeepChildSpec): DeepChildSpec {
  const cloned: DeepChildSpec = {
    specId: spec.specId,
    displayName: spec.displayName,
    role: spec.role,
    objective: spec.objective,
    allowedTools: [...spec.allowedTools],
    inputRefs: [...spec.inputRefs],
  };
  if (spec.maxModelRounds !== undefined) {
    return {
      ...cloned,
      maxModelRounds: spec.maxModelRounds,
      ...(spec.maxToolRounds === undefined ? {} : { maxToolRounds: spec.maxToolRounds }),
    };
  }
  if (spec.maxToolRounds !== undefined) {
    return {
      ...cloned,
      maxToolRounds: spec.maxToolRounds,
    };
  }
  return cloned;
}

function cloneSummary(summary: DeepChildSummary): DeepChildSummary {
  const cloned: DeepChildSummary = {
    childRunId: summary.childRunId,
    spec: cloneSpec(summary.spec),
    status: summary.status,
    summary: summary.summary,
    findings: [...summary.findings],
    evidenceRefs: [...summary.evidenceRefs],
    confidence: summary.confidence,
    uncertainty: summary.uncertainty,
  };
  return {
    ...cloned,
    ...(summary.failureDetail === undefined ? {} : { failureDetail: { ...summary.failureDetail } }),
    ...(summary.continuationContextRef === undefined ? {} : { continuationContextRef: summary.continuationContextRef }),
  };
}

function clonePendingApproval(
  pendingApproval: ChildAgentRunPendingApproval | undefined,
): ChildAgentRunPendingApproval | undefined {
  if (pendingApproval === undefined) {
    return undefined;
  }
  return {
    ...pendingApproval,
    affectedResources: [...pendingApproval.affectedResources],
    sourceRefs: [...pendingApproval.sourceRefs],
  };
}
