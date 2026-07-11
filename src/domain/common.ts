export type RuntimeShape =
  | "single_agent"
  | "sub_agent_tree"
  | "shared_team_cluster"
  | "competitive_team_cluster"
  | "fruit_run";

export type TaskState =
  | "Draft"
  | "DirectionReady"
  | "Planning"
  | "Assigned"
  | "Running"
  | "Blocked"
  | "NutrientRequested"
  | "Revising"
  | "Verifying"
  | "AcceptedForDelivery"
  | "Fruiting"
  | "GovernanceReview"
  | "Delivered"
  | "Archived"
  | "Cancelled"
  | "Failed";

export type AgentLayer =
  | "soil"
  | "underground_center"
  | "agentarbor_handoff"
  | "aboveground_center"
  | "aboveground_growth"
  | "verification"
  | "fruits"
  | "governance";

export type AgentTurnPermissionPolicy = {
  readonly allowModel: boolean;
  readonly allowedTools: readonly string[];
  readonly maxModelRounds?: number;
  readonly maxToolRounds?: number;
  readonly fallback: "deterministic" | "disabled";
};

export const TOOL_LIFECYCLE_MESSAGE_TYPES = [
  "tool.requested",
  "tool.completed",
  "tool.failed",
  "tool.cancelled",
] as const;

export const ARBOR_MESSAGE_TYPES = [
  "goal.received",
  "underground.exploration_planned",
  "rootlet_cluster.started",
  "exploration_candidate.produced",
  "candidate_pool.updated",
  "model.requested",
  "model.completed",
  "model.failed",
  "context.compaction.completed",
  "context.compaction.failed",
  ...TOOL_LIFECYCLE_MESSAGE_TYPES,
  "skill.triggered",
  "agent.delegation.planned",
  "agent.child.started",
  "agent.child.completed",
  "agent.child.interrupted",
  "agent.child.resumed",
  "agent.child.waiting",
  "agent.parent_synthesis.completed",
  "deep.goal_received",
  "deep.manager.decided",
  "deep.child.started",
  "deep.child.waiting",
  "deep.child.instruction_queued",
  "deep.child.completed",
  "deep.child.blocked",
  "deep.child.interrupted",
  "deep.child.failed",
  "deep.parent_synthesis.completed",
  "deep.failed",
  "deep.interrupted",
  "deep.corrected",
  "deep.stopped",
  "deep.conclusion.produced",
  "autonomy_review.completed",
  "convergence_review.requested",
  "convergence_review.completed",
  "direction_handoff.requested",
  "direction_handoff.completed",
  "direction_handoff.revision_requested",
  "user_approval.requested",
  "user_approval.received",
  "nutrient_request.requested",
  "nutrient_patch.supplied",
  "growth_plan.requested",
  "growth_plan.completed",
  "growth_plan.revision_requested",
  "growth_plan.revised",
  "workflow.created",
  "task.created",
  "task.assigned",
  "task.started",
  "task.progress",
  "task.blocked",
  "task.completed",
  "task.failed",
  "artifact.produced",
  "artifact.updated",
  "verification.requested",
  "verification.completed",
  "verification.failed",
  "acceptance.requested",
  "acceptance.completed",
  "acceptance.rejected",
  "fruit.proposed",
  "run_memory.captured",
  "experience_candidate.proposed",
  "path_bias.suggested",
  "governance.review.requested",
  "governance.review.completed",
  "error.raised",
  "sub_agent.started",
  "sub_agent.completed",
  "sub_agent_batch.started",
  "sub_agent_batch.completed",
] as const;

export type ArborMessageType = (typeof ARBOR_MESSAGE_TYPES)[number];
export type ToolLifecycleMessageType = (typeof TOOL_LIFECYCLE_MESSAGE_TYPES)[number];

const TOOL_LIFECYCLE_MESSAGE_TYPE_SET = new Set<string>(TOOL_LIFECYCLE_MESSAGE_TYPES);

export function isToolLifecycleMessageType(type: string): type is ToolLifecycleMessageType {
  return TOOL_LIFECYCLE_MESSAGE_TYPE_SET.has(type);
}

export type ArtifactRef = {
  id: string;
  taskId?: string;
  producedBy: string;
  type: "document" | "code" | "config" | "report" | "log" | "package";
  path?: string;
  uri?: string;
  version: string;
  createdAt: string;
};

export type ArborMessage<TPayload = unknown> = {
  id: string;
  traceId: string;
  taskId?: string;
  parentTaskId?: string;
  from: { id: string; role?: string; cluster?: string };
  to?: { id: string } | { role: string } | { group: string };
  type: ArborMessageType;
  intent: string;
  payload: TPayload;
  artifacts?: ArtifactRef[];
  requiredCapabilities?: string[];
  priority?: "low" | "normal" | "high" | "critical";
  permissions?: {
    canRead?: string[];
    canWrite?: string[];
    canExecute?: string[];
  };
  createdAt: string;
};

export type AgentManifest = {
  id: string;
  name: string;
  layer: AgentLayer;
  description: string;
  lifecycle: {
    status: "active" | "retired";
    createdReason: string;
    retirementCondition: string;
  };
  capabilities: string[];
  inputEvents: ArborMessageType[];
  outputEvents: ArborMessageType[];
  permissions: {
    read: string[];
    write: string[];
    execute: string[];
  };
  turnPolicy: AgentTurnPermissionPolicy;
};
