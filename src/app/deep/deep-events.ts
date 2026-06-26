/**
 * deep-events.ts —— deep 运行事件发布器（T3-2/T3-3，design §6.2）。
 *
 * 职责边界：
 *   - 发布 10 个 `deep.*` 事件类型到 message bus（EP2 路径①）；
 *   - 同时累积安全投影 {@link DeepRunStreamEvent} 序列（EP3），供 SSE 轮询与 replay；
 *   - 安全投影口径（FR-007 / design §6.2）：每事件含
 *     id/runId/sequence/type/title/summary/status/timestamp/refs/visibility，
 *     **不含 raw prompt/response/output**；DeepRuntime 内部上下文（AgentRunTree /
 *     childSummaries / synthesisRecords / conclusion）保留完整材料，SSE 仅为可观察投影。
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
// deep.* 事件类型（10 个，T3-2 / design §6.2）
// ---------------------------------------------------------------------------

/** deep 运行 SSE 流式事件类型全集（10 个 deep.* 类型）。 */
export type DeepEventType =
  | "deep.goal_received"
  | "deep.manager.decided"
  | "deep.child.started"
  | "deep.child.waiting"
  | "deep.child.completed"
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

  /** child 探索已完成。 */
  publishChildCompleted(input: { readonly childRun: ChildAgentRun; readonly agentRunTree: AgentRunTree }): void;

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
          title: "Goal received",
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
          title: `Manager decided: ${input.decision.action}`,
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
          title: `Child started: ${input.childRun.spec.displayName}`,
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
          title: `Child waiting: ${input.childRun.spec.displayName}`,
          summary: "Manager is waiting for delegated child agents to complete.",
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

    publishChildCompleted(input) {
      record(
        "deep.child.completed",
        {
          title: `Child completed: ${input.childRun.spec.displayName}`,
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

    publishParentSynthesisCompleted(input) {
      record(
        "deep.parent_synthesis.completed",
        {
          title: "Parent synthesis completed",
          summary: "Manager synthesized delegated child material.",
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
          title: "Conclusion produced",
          summary: "Deep run produced a synthesized conclusion.",
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
            title: "Run interrupted",
            summary: ce.reason ?? "Deep run was interrupted by the user.",
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
              title: "Run corrected",
              summary: ce.reason ?? "User supplied correction context.",
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
              title: "Run stopped",
              summary: ce.reason ?? "Deep run was stopped by the user.",
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
