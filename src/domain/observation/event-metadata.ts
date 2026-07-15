import type { ArborMessageType } from "../common.js";
import type {
  ObservationProgress,
  ObservationScope,
  ObservationSeverity,
  RunPhase,
  RunStage,
} from "./contracts.js";

export type EventObservationMetadata = {
  readonly summary: string;
  readonly scope: ObservationScope;
  readonly severity: ObservationSeverity;
  readonly progress: Pick<ObservationProgress, "status" | "label">;
  readonly phase: RunPhase;
  readonly stage: RunStage;
};

type EventObservationMetadataInput = Omit<EventObservationMetadata, "severity" | "progress"> & {
  readonly severity?: ObservationSeverity;
  readonly progressStatus?: ObservationProgress["status"];
  readonly progressLabel?: string;
};

export const EVENT_OBSERVATION_METADATA = {
  "goal.received": metadata({
    summary: "User goal entered the runtime.",
    scope: "soil",
    phase: "underground",
    stage: "goal_received",
  }),
  "underground.exploration_planned": metadata({
    summary: "Underground Cognitive Runtime planned bounded exploration.",
    scope: "underground",
    phase: "underground",
    stage: "underground_exploration_planned",
  }),
  "rootlet_cluster.started": metadata({
    summary: "Underground rootlet clusters started.",
    scope: "underground",
    progressStatus: "in_progress",
    phase: "underground",
    stage: "rootlet_clusters_started",
  }),
  "exploration_candidate.produced": metadata({
    summary: "Rootlets produced exploration candidates.",
    scope: "underground",
    phase: "underground",
    stage: "exploration_candidates_produced",
  }),
  "candidate_pool.updated": metadata({
    summary: "Candidate pool was updated.",
    scope: "underground",
    phase: "underground",
    stage: "candidate_pool_updated",
  }),
  "model.requested": metadata({
    summary: "Intelligence Channel requested model output.",
    scope: "runtime",
    progressStatus: "in_progress",
    phase: "underground",
    stage: "model_requested",
  }),
  "model.completed": metadata({
    summary: "Intelligence Channel completed model output validation.",
    scope: "runtime",
    phase: "underground",
    stage: "model_completed",
  }),
  "model.failed": metadata({
    summary: "Intelligence Channel failed or rejected model output.",
    scope: "runtime",
    severity: "warning",
    progressStatus: "failed",
    phase: "underground",
    stage: "model_failed",
  }),
  "context.compaction.completed": metadata({
    summary: "Desktop Agent compacted earlier safe context into a continuation prompt.",
    scope: "runtime",
    phase: "underground",
    stage: "context_compaction_completed",
  }),
  "context.compaction.failed": metadata({
    summary: "Desktop Agent context compaction failed and the run paused.",
    scope: "runtime",
    severity: "warning",
    progressStatus: "failed",
    phase: "underground",
    stage: "context_compaction_failed",
  }),
  "tool.requested": metadata({
    summary: "ToolCenter requested a tool execution.",
    scope: "runtime",
    progressStatus: "in_progress",
    phase: "underground",
    stage: "tool_requested",
  }),
  "tool.completed": metadata({
    summary: "ToolCenter completed a tool execution.",
    scope: "runtime",
    phase: "underground",
    stage: "tool_completed",
  }),
  "tool.failed": metadata({
    summary: "ToolCenter failed or denied a tool execution.",
    scope: "runtime",
    severity: "warning",
    progressStatus: "failed",
    phase: "underground",
    stage: "tool_failed",
  }),
  "tool.cancelled": metadata({
    summary: "Tool execution was cancelled.",
    scope: "runtime",
    severity: "warning",
    progressStatus: "cancelled",
    phase: "underground",
    stage: "tool_cancelled",
  }),
  "skill.triggered": metadata({
    summary: "A desktop agent skill was matched and added as safe context.",
    scope: "runtime",
    phase: "agent",
    stage: "skill_triggered",
  }),
  "agent.delegation.planned": metadata({
    summary: "Underground parent agent planned child delegation.",
    scope: "underground",
    progressStatus: "in_progress",
    phase: "underground",
    stage: "agent_delegation_planned",
  }),
  "agent.child.started": metadata({
    summary: "Delegated child agent started.",
    scope: "underground",
    progressStatus: "in_progress",
    phase: "underground",
    stage: "agent_child_started",
  }),
  "agent.child.completed": metadata({
    summary: "Delegated child agent completed local material.",
    scope: "underground",
    phase: "underground",
    stage: "agent_child_completed",
  }),
  "agent.child.interrupted": metadata({
    summary: "Delegated child agent was interrupted by its parent.",
    scope: "underground",
    severity: "warning",
    progressStatus: "blocked",
    phase: "underground",
    stage: "agent_child_interrupted",
  }),
  "agent.child.resumed": metadata({
    summary: "Delegated child agent was resumed by its parent.",
    scope: "underground",
    progressStatus: "in_progress",
    phase: "underground",
    stage: "agent_child_resumed",
  }),
  "agent.child.waiting": metadata({
    summary: "Parent agent is waiting for delegated child agents.",
    scope: "underground",
    progressStatus: "in_progress",
    phase: "underground",
    stage: "agent_child_waiting",
  }),
  "agent.parent_synthesis.completed": metadata({
    summary: "Parent agent synthesized delegated child material.",
    scope: "underground",
    phase: "underground",
    stage: "agent_parent_synthesis_completed",
  }),
  "deep.goal_received": metadata({
    summary: "Deep run received the user goal and began the manager decision cycle.",
    scope: "underground",
    progressStatus: "in_progress",
    phase: "underground",
    stage: "deep_goal_received",
  }),
  "deep.manager.decided": metadata({
    summary: "Deep manager produced a delegation decision for the current step.",
    scope: "underground",
    progressStatus: "in_progress",
    phase: "underground",
    stage: "deep_manager_decided",
  }),
  "deep.child.started": metadata({
    summary: "A delegated child agent run started exploration.",
    scope: "underground",
    progressStatus: "in_progress",
    phase: "underground",
    stage: "deep_child_started",
  }),
  "deep.child.waiting": metadata({
    summary: "Manager is waiting for delegated child agents to complete.",
    scope: "underground",
    progressStatus: "in_progress",
    phase: "underground",
    stage: "deep_child_waiting",
  }),
  "deep.child.instruction_queued": metadata({
    summary: "Parent manager queued a follow-up instruction for a delegated child agent run.",
    scope: "underground",
    progressStatus: "in_progress",
    phase: "underground",
    stage: "deep_child_instruction_queued",
  }),
  "deep.child.completed": metadata({
    summary: "A delegated child agent run completed its exploration.",
    scope: "underground",
    progressStatus: "in_progress",
    phase: "underground",
    stage: "deep_child_completed",
  }),
  "deep.child.blocked": metadata({
    summary: "A delegated child agent run is blocked and needs external input or budget.",
    scope: "underground",
    severity: "warning",
    progressStatus: "blocked",
    phase: "underground",
    stage: "deep_child_blocked",
  }),
  "deep.child.interrupted": metadata({
    summary: "A delegated child agent run was interrupted and can be reviewed for continuation.",
    scope: "underground",
    severity: "warning",
    progressStatus: "blocked",
    phase: "underground",
    stage: "deep_child_interrupted",
  }),
  "deep.child.failed": metadata({
    summary: "A delegated child agent run failed during exploration.",
    scope: "underground",
    severity: "warning",
    progressStatus: "in_progress",
    phase: "underground",
    stage: "deep_child_failed",
  }),
  "deep.parent_synthesis.completed": metadata({
    summary: "Parent manager synthesized delegated child material into a synthesis record.",
    scope: "underground",
    progressStatus: "in_progress",
    phase: "underground",
    stage: "deep_parent_synthesis_completed",
  }),
  "deep.failed": metadata({
    summary: "Deep run failed before producing a synthesized conclusion.",
    scope: "underground",
    severity: "error",
    progressStatus: "failed",
    phase: "underground",
    stage: "deep_failed",
  }),
  "deep.interrupted": metadata({
    summary: "Deep run was interrupted by the user; produced materials are retained.",
    scope: "underground",
    severity: "warning",
    progressStatus: "blocked",
    phase: "underground",
    stage: "deep_interrupted",
  }),
  "deep.corrected": metadata({
    summary: "User supplied correction context; manager will adjust the next step.",
    scope: "underground",
    progressStatus: "in_progress",
    phase: "underground",
    stage: "deep_corrected",
  }),
  "deep.stopped": metadata({
    summary: "Deep run was stopped by the user; partial conclusion or stop note produced.",
    scope: "underground",
    phase: "underground",
    stage: "deep_stopped",
  }),
  "deep.conclusion.produced": metadata({
    summary: "Deep run produced a synthesized conclusion.",
    scope: "underground",
    phase: "underground",
    stage: "deep_conclusion_produced",
  }),
  "autonomy_review.completed": metadata({
    summary: "Underground autonomy core completed a cycle decision.",
    scope: "underground",
    phase: "underground",
    stage: "autonomy_review_completed",
  }),
  "convergence_review.requested": metadata({
    summary: "Underground autonomy core requested convergence review.",
    scope: "underground",
    progressStatus: "in_progress",
    phase: "underground",
    stage: "convergence_review_requested",
  }),
  "convergence_review.completed": metadata({
    summary: "Convergence review judged candidate outcomes.",
    scope: "underground",
    phase: "underground",
    stage: "convergence_review_completed",
  }),
  "direction_handoff.requested": metadata({
    summary: "Plan Package creation was requested.",
    scope: "handoff",
    progressStatus: "in_progress",
    phase: "handoff",
    stage: "direction_handoff_requested",
  }),
  "direction_handoff.completed": metadata({
    summary: "Plan Package was completed.",
    scope: "handoff",
    phase: "handoff",
    stage: "direction_handoff_completed",
  }),
  "direction_handoff.revision_requested": metadata({
    summary: "Plan Package revision was requested.",
    scope: "handoff",
    progressStatus: "in_progress",
    phase: "handoff",
    stage: "direction_handoff_revision_requested",
  }),
  "user_approval.requested": metadata({
    summary: "User approval was requested.",
    scope: "handoff",
    progressStatus: "in_progress",
    phase: "handoff",
    stage: "user_approval_requested",
  }),
  "user_approval.received": metadata({
    summary: "User approval was received.",
    scope: "handoff",
    phase: "handoff",
    stage: "user_approval_received",
  }),
  "nutrient_request.requested": metadata({
    summary: "Nutrient Request was requested.",
    scope: "runtime",
    progressStatus: "in_progress",
    phase: "aboveground",
    stage: "nutrient_request_requested",
  }),
  "nutrient_patch.supplied": metadata({
    summary: "Nutrient Patch was supplied.",
    scope: "runtime",
    phase: "aboveground",
    stage: "nutrient_patch_supplied",
  }),
  "growth_plan.requested": metadata({
    summary: "Aboveground execution plan was requested.",
    scope: "aboveground",
    progressStatus: "in_progress",
    phase: "aboveground",
    stage: "growth_plan_requested",
  }),
  "growth_plan.completed": metadata({
    summary: "Aboveground Execution Runtime completed the execution plan.",
    scope: "aboveground",
    phase: "aboveground",
    stage: "growth_plan_completed",
  }),
  "growth_plan.revision_requested": metadata({
    summary: "Execution plan revision was requested.",
    scope: "aboveground",
    progressStatus: "in_progress",
    phase: "aboveground",
    stage: "growth_plan_revision_requested",
  }),
  "growth_plan.revised": metadata({
    summary: "Execution plan was revised.",
    scope: "aboveground",
    phase: "aboveground",
    stage: "growth_plan_revised",
  }),
  "workflow.created": metadata({
    summary: "Workflow IR was created.",
    scope: "aboveground",
    phase: "aboveground",
    stage: "workflow_created",
  }),
  "task.created": metadata({
    summary: "Executable task was created.",
    scope: "aboveground",
    phase: "aboveground",
    stage: "task_created",
  }),
  "task.assigned": metadata({
    summary: "Task was assigned to an aboveground worker.",
    scope: "aboveground",
    phase: "aboveground",
    stage: "task_assigned",
  }),
  "task.started": metadata({
    summary: "Task was started.",
    scope: "aboveground",
    progressStatus: "in_progress",
    phase: "aboveground",
    stage: "task_started",
  }),
  "task.progress": metadata({
    summary: "Task progress was reported.",
    scope: "aboveground",
    progressStatus: "in_progress",
    phase: "aboveground",
    stage: "task_progress",
  }),
  "task.blocked": metadata({
    summary: "Task was blocked.",
    scope: "aboveground",
    severity: "warning",
    progressStatus: "blocked",
    phase: "aboveground",
    stage: "task_blocked",
  }),
  "task.completed": metadata({
    summary: "Task was completed.",
    scope: "aboveground",
    phase: "aboveground",
    stage: "task_completed",
  }),
  "task.failed": metadata({
    summary: "Task failed.",
    scope: "aboveground",
    severity: "warning",
    progressStatus: "failed",
    phase: "aboveground",
    stage: "task_failed",
  }),
  "artifact.produced": metadata({
    summary: "Worker produced an artifact.",
    scope: "fruits",
    phase: "fruits",
    stage: "artifact_produced",
  }),
  "artifact.updated": metadata({
    summary: "Artifact was updated.",
    scope: "fruits",
    phase: "fruits",
    stage: "artifact_updated",
  }),
  "verification.requested": metadata({
    summary: "Verification was requested.",
    scope: "verification",
    progressStatus: "in_progress",
    phase: "verification",
    stage: "verification_requested",
  }),
  "verification.completed": metadata({
    summary: "Verification completed.",
    scope: "verification",
    phase: "verification",
    stage: "verification_completed",
  }),
  "verification.failed": metadata({
    summary: "Verification failed.",
    scope: "verification",
    severity: "warning",
    progressStatus: "failed",
    phase: "verification",
    stage: "verification_failed",
  }),
  "acceptance.requested": metadata({
    summary: "Acceptance was requested.",
    scope: "verification",
    progressStatus: "in_progress",
    phase: "verification",
    stage: "acceptance_requested",
  }),
  "acceptance.completed": metadata({
    summary: "Acceptance completed.",
    scope: "verification",
    phase: "verification",
    stage: "acceptance_completed",
  }),
  "acceptance.rejected": metadata({
    summary: "Acceptance was rejected.",
    scope: "verification",
    severity: "warning",
    progressStatus: "blocked",
    phase: "verification",
    stage: "acceptance_rejected",
  }),
  "fruit.proposed": metadata({
    summary: "Fruit candidate was proposed.",
    scope: "fruits",
    phase: "fruits",
    stage: "fruit_proposed",
  }),
  "run_memory.captured": metadata({
    summary: "Run Memory was captured.",
    scope: "governance",
    phase: "soil_return",
    stage: "run_memory_captured",
  }),
  "experience_candidate.proposed": metadata({
    summary: "Experience Candidate was proposed.",
    scope: "governance",
    phase: "soil_return",
    stage: "experience_candidate_proposed",
  }),
  "path_bias.suggested": metadata({
    summary: "Path Bias was suggested for future similar runs.",
    scope: "soil",
    phase: "completed",
    stage: "path_bias_suggested",
  }),
  "governance.review.requested": metadata({
    summary: "Governance review was requested.",
    scope: "governance",
    progressStatus: "in_progress",
    phase: "governance",
    stage: "governance_review_requested",
  }),
  "governance.review.completed": metadata({
    summary: "Governance review completed.",
    scope: "governance",
    phase: "governance",
    stage: "governance_review_completed",
  }),
  "error.raised": metadata({
    summary: "Runtime raised an error.",
    scope: "runtime",
    severity: "error",
    progressStatus: "failed",
    phase: "completed",
    stage: "error_raised",
  }),
} satisfies Record<ArborMessageType, EventObservationMetadata>;

export function getEventObservationMetadata(type: ArborMessageType): EventObservationMetadata {
  return EVENT_OBSERVATION_METADATA[type];
}

function metadata(input: EventObservationMetadataInput): EventObservationMetadata {
  return {
    summary: input.summary,
    scope: input.scope,
    severity: input.severity ?? "info",
    progress: {
      status: input.progressStatus ?? "completed",
      label: input.progressLabel ?? humanizeStage(input.stage),
    },
    phase: input.phase,
    stage: input.stage,
  };
}

function humanizeStage(stage: RunStage): string {
  return stage.replaceAll("_", " ");
}
