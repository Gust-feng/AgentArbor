/**
 * deep-events.ts —— deep 运行事件发布器（T3-2/T3-3，design §6.2 / §3.4）。
 *
 * 职责边界：
 *   - 发布 `deep.*` 事件类型到 message bus（EP2 路径①）；
 *   - 同时累积安全投影 {@link DeepRunStreamEvent} 序列（EP3），供 SSE 轮询与 replay；
 *   - 安全投影口径（FR-007 / design §6.2）：每事件含
 *     id/runId/sequence/type/title/summary/status/timestamp/refs/visibility，
 *     **不含 raw prompt/response/output**；DeepRuntime 内部上下文（AgentRunTree /
 *     childSummaries / synthesisRecords / conclusion）保留完整材料，SSE 仅为可观察投影。
 *
 * 实时事件（T2-2，FR-PROJ-02 事件侧）：`deep.child.started`/`deep.child.completed`/
 * `deep.child.blocked`/`deep.child.interrupted`/`deep.child.failed` 由 DeepRuntime 装配的 scheduler 生命周期
 * 回调（onChildStarted/onChildTerminal）在真实状态变化时驱动发布，而非 run 结束后由
 * buildAndPublishRunTree 倒序重建。publisher 本身只提供发布能力，"实时 vs 事后重建"
 * 由调用方装配决定。
 *
 * 复用边界：复用 {@link safeAgentRunTreeRef}（underground-events）的 tree 投影语义。
 * 旧 `underground-events.ts` 的 `agent.*` publisher 仍服务旧 underground cluster 兼容链，
 * 不在此模块修改；deep-runtime 改用本模块发布 `deep.*`。
 *
 * 命名红线：消费 contracts.ts 的 SynthesizedConclusion；不引入 Plan/artifact/Fruits。
 */
import type { MinimalRuntime } from "../runtime.js";
import { createMessage } from "../../kernel/messages/create-message.js";
import { createId, nowIso } from "../../kernel/id.js";
import type {
  AgentRunTree,
  ChildAgentRun,
  DelegationDecision,
  ParentSynthesisResult,
} from "../../domain/underground/agent-fabric.js";
import { safeAgentRunTreeRef } from "../underground-events.js";
import type { DeepRunControlEvent } from "./deep-run-executor.js";
import type { SynthesizedConclusion } from "./contracts.js";
import { DEEP_MANAGER_AGENT_ID } from "./child-delegation.js";

// ---------------------------------------------------------------------------
// deep.* 事件类型（T3-2 / design §6.2）
// ---------------------------------------------------------------------------

/**
 * deep 运行 SSE 流式事件类型全集。
 *
 * T2-2（FR-PROJ-02 事件侧）补齐 `deep.child.blocked` / `deep.child.interrupted` / `deep.child.failed`：
 * child 标准 Agent run 暂停或失败时，由 scheduler 的 onChildTerminal 回调在真实状态
 * 变化时发布（非 run 结束后重建）。
 */
export type DeepEventType =
  | "deep.goal_received"
  | "deep.manager.decided"
  | "deep.child.started"
  | "deep.child.waiting"
  | "deep.child.instruction_queued"
  | "deep.child.completed"
  | "deep.child.blocked"
  | "deep.child.interrupted"
  | "deep.child.failed"
  | "deep.parent_synthesis.completed"
  | "deep.interrupted"
  | "deep.corrected"
  | "deep.stopped"
  | "deep.conclusion.produced";

/** 流式事件的安全引用（指向 record 内的结构化对象，不含 raw 材料）。 */
export type DeepRunStreamEventRef = {
  readonly kind:
    | "conversation"
    | "delegation_decision"
    | "child_run"
    | "child_instruction"
    | "parent_synthesis"
    | "control"
    | "conclusion"
    | "agent_run_tree";
  readonly refId: string;
};

/**
 * deep 运行流式事件安全投影（SSE 轮询源 + replay）。
 *
 * 安全口径（FR-007）：不含 raw prompt/response/output；仅承载可观察的
 * 标题/摘要/状态/引用。完整材料保留在 DeepRunRecord 内部上下文中。
 */
export type DeepRunStreamEvent = {
  readonly id: string;
  readonly runId: string;
  readonly sequence: number;
  readonly type: DeepEventType;
  readonly title: string;
  readonly summary: string;
  readonly status: string;
  readonly timestamp: string;
  readonly refs: readonly DeepRunStreamEventRef[];
  readonly visibility: "public";
};

// ---------------------------------------------------------------------------
// 发布器：createDeepEventPublisher
// ---------------------------------------------------------------------------

/**
 * deep 事件发布器。每个方法既发布 `deep.*` message 到 bus（可观察投影 / 审计），
 * 又追加一条安全投影 {@link DeepRunStreamEvent} 到内部序列（SSE 轮询源 + replay）。
 *
 * 一次 deep run 创建一个 publisher 实例；序列号从 0 递增，保证 SSE cursor 恢复语义。
 * 运行结束后通过 {@link DeepEventPublisher.events} 取出完整序列，写入
 * {@link DeepRunRecord.eventSequence}。
 */
export interface DeepEventPublisher {
  /** 当前已累积的安全投影事件序列（有序，sequence 从 1 递增，与桌面 run stream 约定一致）。 */
  readonly events: readonly DeepRunStreamEvent[];

  /** 运行启动时发布：目标已接收。 */
  publishGoalReceived(input: { readonly goal: string; readonly conversationId: string }): void;

  /** 每个 manager 决策 step 发布：Manager 决策已产出。 */
  publishManagerDecided(input: {
    readonly decision: DelegationDecision;
    readonly childSpecs: readonly { readonly specId: string; readonly displayName: string }[];
    readonly agentRunTree: AgentRunTree;
  }): void;

  /** child 探索已启动。 */
  publishChildStarted(input: { readonly childRun: ChildAgentRun; readonly agentRunTree: AgentRunTree }): void;

  /** child 探索等待中（manager 等待 child 完成的概念相位）。 */
  publishChildWaiting(input: { readonly childRun: ChildAgentRun; readonly agentRunTree: AgentRunTree }): void;

  /** 父层已为运行中 child 追加继续指令（只发布安全队列事实，不包含 raw 指令）。 */
  publishChildInstructionQueued(input: {
    readonly childRunId: string;
    readonly displayName: string;
    readonly role: string;
    readonly instructionId: string;
    readonly messageRef: string;
    readonly queuedCount: number;
    readonly agentRunTree: AgentRunTree;
  }): void;

  /** child 探索已完成。 */
  publishChildCompleted(input: { readonly childRun: ChildAgentRun; readonly agentRunTree: AgentRunTree }): void;

  /** child 探索暂停，需要确认/预算/上下文等外部条件。 */
  publishChildBlocked(input: {
    readonly childRun: ChildAgentRun;
    readonly reason?: string;
    readonly agentRunTree: AgentRunTree;
  }): void;

  /** child 探索中断或异常停止，父层可审查后继续同一个 child run。 */
  publishChildInterrupted(input: {
    readonly childRun: ChildAgentRun;
    readonly reason?: string;
    readonly agentRunTree: AgentRunTree;
  }): void;

  /**
   * child 探索失败（T2-2，FR-PROJ-02 事件侧）。child 抛错经 scheduler 降级为 failed task 时，
   * 由 onChildTerminal 回调在真实状态变化时发布（非 run 结束后重建）。载荷为安全字段：
   * failure 为短失败原因（来自 task.failure / buildFailedChildExploration 的 reason），
   * 不含 raw prompt/response/output。
   */
  publishChildFailed(input: {
    readonly childRun: ChildAgentRun;
    readonly failure?: string;
    readonly agentRunTree: AgentRunTree;
  }): void;

  /** 父层综合已完成（synthesize / direct_answer 收口 step）。 */
  publishParentSynthesisCompleted(input: {
    readonly parentSynthesis: ParentSynthesisResult;
    readonly childRuns: readonly ChildAgentRun[];
    readonly agentRunTree: AgentRunTree;
  }): void;

  /** 结论已产出（结论存在时，在综合收口后发布）。 */
  publishConclusionProduced(input: { readonly conclusion: SynthesizedConclusion }): void;

  /** T2-7 control 事件（interrupt / correct / stop），承载可观察打断/纠正/停止记录。 */
  publishControlEvent(controlEvent: DeepRunControlEvent, agentRunTree: AgentRunTree): void;
}

/**
 * 创建 deep 事件发布器。序列号从 0 递增；每条事件同时落入 bus + 安全投影序列。
 */
export function createDeepEventPublisher(options: {
  readonly runtime: MinimalRuntime;
  readonly traceId: string;
  readonly runId: string;
}): DeepEventPublisher {
  const events: DeepRunStreamEvent[] = [];
  // sequence 从 1 开始：与桌面 run stream 一致；parseStreamCursor 无 cursor 时返回 0，
  // flush 循环 `sequence > lastSequence(0)` 正确包含首个事件（sequence=1），不漏 goal_received。
  let sequence = 1;

  function record(
    type: DeepEventType,
    projection: Pick<DeepRunStreamEvent, "title" | "summary" | "status" | "refs">,
    busPayload: unknown,
  ): void {
    const event: DeepRunStreamEvent = {
      id: createId("deep-evt"),
      runId: options.runId,
      sequence,
      type,
      title: projection.title,
      summary: projection.summary,
      status: projection.status,
      timestamp: nowIso(),
      refs: projection.refs,
      visibility: "public",
    };
    sequence += 1;
    events.push(event);
    options.runtime.bus.publish(
      createMessage({
        traceId: options.traceId,
        from: { id: DEEP_MANAGER_AGENT_ID, role: "deep_manager" },
        to: { group: "underground-center" },
        type,
        intent: type,
        payload: busPayload,
      }),
    );
  }

  function treeRef(tree: AgentRunTree): DeepRunStreamEventRef {
    return { kind: "agent_run_tree", refId: tree.treeId };
  }

  return {
    get events(): readonly DeepRunStreamEvent[] {
      return events;
    },

    publishGoalReceived(input) {
      record(
        "deep.goal_received",
        {
          title: "已接收目标",
          summary: input.goal,
          status: "received",
          refs: [{ kind: "conversation", refId: input.conversationId }],
        },
        { goal: input.goal, conversationId: input.conversationId, runId: options.runId },
      );
    },

    publishManagerDecided(input) {
      record(
        "deep.manager.decided",
        {
          title: `已生成计划：${input.decision.action}`,
          summary: input.decision.rationale,
          status: "decided",
          refs: [
            { kind: "delegation_decision", refId: input.decision.decisionId },
            treeRef(input.agentRunTree),
          ],
        },
        {
          decisionId: input.decision.decisionId,
          action: input.decision.action,
          rationale: input.decision.rationale,
          confidence: input.decision.confidence,
          uncertainty: input.decision.uncertainty,
          childSpecIds: input.childSpecs.map((spec) => spec.specId),
          agentRunTree: safeAgentRunTreeRef(input.agentRunTree),
        },
      );
    },

    publishChildStarted(input) {
      record(
        "deep.child.started",
        {
          title: `探索开始：${input.childRun.spec.displayName}`,
          summary: input.childRun.spec.role,
          status: "running",
          refs: [
            { kind: "child_run", refId: input.childRun.childRunId },
            treeRef(input.agentRunTree),
          ],
        },
        {
          childRunId: input.childRun.childRunId,
          displayName: input.childRun.spec.displayName,
          role: input.childRun.spec.role,
          agentRunTree: safeAgentRunTreeRef(input.agentRunTree),
        },
      );
    },

    publishChildWaiting(input) {
      record(
        "deep.child.waiting",
        {
          title: `等待探索：${input.childRun.spec.displayName}`,
          summary: "正在等待子任务返回材料。",
          status: "waiting",
          refs: [
            { kind: "child_run", refId: input.childRun.childRunId },
            treeRef(input.agentRunTree),
          ],
        },
        {
          childRunId: input.childRun.childRunId,
          agentRunTree: safeAgentRunTreeRef(input.agentRunTree),
        },
      );
    },

    publishChildInstructionQueued(input) {
      record(
        "deep.child.instruction_queued",
        {
          title: `已追加子任务：${input.displayName}`,
          summary: "父层已要求同一个子 Agent 继续；当前轮完成后会按队列执行。",
          status: "queued",
          refs: [
            { kind: "child_run", refId: input.childRunId },
            { kind: "child_instruction", refId: input.messageRef },
            treeRef(input.agentRunTree),
          ],
        },
        {
          childRunId: input.childRunId,
          displayName: input.displayName,
          role: input.role,
          instructionId: input.instructionId,
          messageRef: input.messageRef,
          queuedCount: input.queuedCount,
          agentRunTree: safeAgentRunTreeRef(input.agentRunTree),
        },
      );
    },

    publishChildCompleted(input) {
      record(
        "deep.child.completed",
        {
          title: `探索完成：${input.childRun.spec.displayName}`,
          summary: input.childRun.spec.role,
          status: "completed",
          refs: [
            { kind: "child_run", refId: input.childRun.childRunId },
            treeRef(input.agentRunTree),
          ],
        },
        {
          childRunId: input.childRun.childRunId,
          displayName: input.childRun.spec.displayName,
          agentRunTree: safeAgentRunTreeRef(input.agentRunTree),
        },
      );
    },

    publishChildBlocked(input) {
      record(
        "deep.child.blocked",
        {
          title: `探索受阻：${input.childRun.spec.displayName}`,
          summary: input.reason ?? input.childRun.failureReason ?? "子 Agent 需要确认或外部条件后才能继续。",
          status: "blocked",
          refs: [
            { kind: "child_run", refId: input.childRun.childRunId },
            treeRef(input.agentRunTree),
          ],
        },
        {
          childRunId: input.childRun.childRunId,
          displayName: input.childRun.spec.displayName,
          reason: input.reason ?? input.childRun.failureReason,
          agentRunTree: safeAgentRunTreeRef(input.agentRunTree),
        },
      );
    },

    publishChildInterrupted(input) {
      record(
        "deep.child.interrupted",
        {
          title: `探索中断：${input.childRun.spec.displayName}`,
          summary: input.reason ?? input.childRun.failureReason ?? "子 Agent 已中断，可由父层审查后继续。",
          status: "interrupted",
          refs: [
            { kind: "child_run", refId: input.childRun.childRunId },
            treeRef(input.agentRunTree),
          ],
        },
        {
          childRunId: input.childRun.childRunId,
          displayName: input.childRun.spec.displayName,
          reason: input.reason ?? input.childRun.failureReason,
          agentRunTree: safeAgentRunTreeRef(input.agentRunTree),
        },
      );
    },

    publishChildFailed(input) {
      // T2-2（FR-PROJ-02 事件侧）：安全字段投影，failure 为短失败原因，不含 raw 材料。
      record(
        "deep.child.failed",
        {
          title: `探索失败：${input.childRun.spec.displayName}`,
          summary: input.failure ?? input.childRun.spec.role,
          status: "failed",
          refs: [
            { kind: "child_run", refId: input.childRun.childRunId },
            treeRef(input.agentRunTree),
          ],
        },
        {
          childRunId: input.childRun.childRunId,
          displayName: input.childRun.spec.displayName,
          failure: input.failure,
          agentRunTree: safeAgentRunTreeRef(input.agentRunTree),
        },
      );
    },

    publishParentSynthesisCompleted(input) {
      record(
        "deep.parent_synthesis.completed",
        {
          title: "综合完成",
          summary: "已综合子任务材料。",
          status: "synthesized",
          refs: [
            { kind: "parent_synthesis", refId: input.parentSynthesis.synthesisId },
            treeRef(input.agentRunTree),
          ],
        },
        {
          synthesisId: input.parentSynthesis.synthesisId,
          childRunCount: input.childRuns.length,
          agentRunTree: safeAgentRunTreeRef(input.agentRunTree),
        },
      );
    },

    publishConclusionProduced(input) {
      record(
        "deep.conclusion.produced",
        {
          title: "结论生成",
          summary: "多 Agent 已生成综合结论。",
          status: "concluded",
          refs: [{ kind: "conclusion", refId: input.conclusion.conclusionId }],
        },
        { conclusionId: input.conclusion.conclusionId },
      );
    },

    publishControlEvent(controlEvent, agentRunTree) {
      const ce = controlEvent;
      if (ce.kind === "interrupt") {
        record(
          "deep.interrupted",
          {
            title: "运行打断",
            summary: ce.reason ?? "多 Agent 运行已被打断。",
            status: "interrupted",
            refs: [
                { kind: "control", refId: `${ce.kind}-${ce.recordedAt}` },
                treeRef(agentRunTree),
              ],
            },
            { ...ce, runId: options.runId, agentRunTree: safeAgentRunTreeRef(agentRunTree) },
          );
        } else if (ce.kind === "correct") {
          record(
            "deep.corrected",
            {
              title: "收到补充",
              summary: ce.reason ?? "用户已补充要求。",
              status: "corrected",
              refs: [
                { kind: "control", refId: `${ce.kind}-${ce.recordedAt}` },
                treeRef(agentRunTree),
              ],
            },
            { ...ce, runId: options.runId, agentRunTree: safeAgentRunTreeRef(agentRunTree) },
          );
        } else {
          record(
            "deep.stopped",
            {
              title: "运行停止",
              summary: ce.reason ?? "多 Agent 运行已停止。",
              status: "stopped",
              refs: [
                { kind: "control", refId: `${ce.kind}-${ce.recordedAt}` },
                treeRef(agentRunTree),
              ],
            },
            { ...ce, runId: options.runId, agentRunTree: safeAgentRunTreeRef(agentRunTree) },
          );
        }
    },
  };
}
