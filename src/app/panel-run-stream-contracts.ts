import type { PanelRunStreamEventDetail } from "./panel-stream-tool-projection.js";

export type PanelRunStreamEventType =
  | "run.started"
  | "run.cancelled"
  | "run.blocked"
  | "run.resumed"
  | "agent.note.delta"
  | "agent.note.completed"
  | "model.reasoning.delta"
  | "model.reasoning.completed"
  | "model.output.delta"
  | "model.output.completed"
  | "model.side.completed"
  | "model.failed"
  | "context.compaction.completed"
  | "context.compaction.failed"
  | "tool.requested"
  | "tool.completed"
  | "tool.failed"
  | "confirmation.needed"
  | "user_approval.received"
  | "user.guidance"
  | "agent.delegation.planned"
  | "agent.child.started"
  | "agent.child.completed"
  | "agent.child.waiting"
  | "agent.parent_synthesis.completed"
  | "final.result"
  | "run.failed";

export type { PanelRunStreamEventDetail } from "./panel-stream-tool-projection.js";

export type PanelRunStreamEvent = {
  readonly eventId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly type: PanelRunStreamEventType;
  readonly createdAt: string;
  readonly agentLabel?: string;
  readonly summary?: string;
  readonly delta?: string;
  readonly status?: "pending" | "running" | "approval_needed" | "needs_input" | "completed" | "failed" | "cancelled" | "blocked";
  readonly toolName?: string;
  readonly detail?: PanelRunStreamEventDetail;
  readonly sourceRefs: readonly string[];
  readonly modelCallRefs: readonly string[];
  readonly toolCallRefs: readonly string[];
};
