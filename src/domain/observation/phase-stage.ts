import type { ArborMessageType } from "../contracts.js";
import type { RunObservationEventEntry, RunPhase, RunStage } from "./contracts.js";

export type RunObservationPosition = {
  readonly currentPhase: RunPhase;
  readonly currentStage: RunStage;
};

export function resolveRunObservationPosition(
  entries: readonly Pick<RunObservationEventEntry, "type">[]
): RunObservationPosition {
  const lastEventType = entries.at(-1)?.type;
  if (lastEventType === undefined) {
    return { currentPhase: "not_started", currentStage: "not_started" };
  }
  return {
    currentPhase: phaseForEvent(lastEventType),
    currentStage: stageForEvent(lastEventType),
  };
}

export function phaseForEvent(type: ArborMessageType): RunPhase {
  if (
    type.startsWith("underground.") ||
    type.startsWith("rootlet_") ||
    type.startsWith("exploration_candidate") ||
    type.startsWith("candidate_") ||
    type.startsWith("convergence_review") ||
    type === "goal.received"
  ) {
    return "underground";
  }
  if (type.startsWith("direction_handoff") || type.startsWith("user_approval")) {
    return "handoff";
  }
  if (type.startsWith("growth_plan") || type.startsWith("workflow") || type.startsWith("task")) {
    return "aboveground";
  }
  if (type.startsWith("verification") || type.startsWith("acceptance")) {
    return "verification";
  }
  if (type.startsWith("artifact") || type.startsWith("fruit")) {
    return "fruits";
  }
  if (type.startsWith("governance")) {
    return "governance";
  }
  if (type.startsWith("run_memory") || type.startsWith("experience_candidate")) {
    return "soil_return";
  }
  if (type === "path_bias.suggested") {
    return "completed";
  }
  if (type === "error.raised") {
    return "completed";
  }
  return "aboveground";
}

export function stageForEvent(type: ArborMessageType): RunStage {
  switch (type) {
    case "goal.received":
      return "goal_received";
    case "underground.exploration_planned":
      return "underground_exploration_planned";
    case "rootlet_cluster.started":
      return "rootlet_clusters_started";
    case "exploration_candidate.produced":
      return "exploration_candidates_produced";
    case "candidate_pool.updated":
      return "candidate_pool_updated";
    case "convergence_review.completed":
      return "convergence_review_completed";
    case "direction_handoff.requested":
      return "direction_handoff_requested";
    case "direction_handoff.completed":
      return "direction_handoff_completed";
    case "direction_handoff.revision_requested":
      return "direction_handoff_revision_requested";
    case "user_approval.requested":
      return "user_approval_requested";
    case "user_approval.received":
      return "user_approval_received";
    case "nutrient_request.requested":
      return "nutrient_request_requested";
    case "nutrient_patch.supplied":
      return "nutrient_patch_supplied";
    case "growth_plan.requested":
      return "growth_plan_requested";
    case "growth_plan.completed":
      return "growth_plan_completed";
    case "growth_plan.revision_requested":
      return "growth_plan_revision_requested";
    case "growth_plan.revised":
      return "growth_plan_revised";
    case "workflow.created":
      return "workflow_created";
    case "task.created":
      return "task_created";
    case "task.assigned":
      return "task_assigned";
    case "task.started":
      return "task_started";
    case "task.progress":
      return "task_progress";
    case "task.blocked":
      return "task_blocked";
    case "task.completed":
      return "task_completed";
    case "task.failed":
      return "task_failed";
    case "artifact.produced":
      return "artifact_produced";
    case "artifact.updated":
      return "artifact_updated";
    case "verification.requested":
      return "verification_requested";
    case "verification.completed":
      return "verification_completed";
    case "verification.failed":
      return "verification_failed";
    case "acceptance.requested":
      return "acceptance_requested";
    case "acceptance.completed":
      return "acceptance_completed";
    case "acceptance.rejected":
      return "acceptance_rejected";
    case "fruit.proposed":
      return "fruit_proposed";
    case "run_memory.captured":
      return "run_memory_captured";
    case "experience_candidate.proposed":
      return "experience_candidate_proposed";
    case "path_bias.suggested":
      return "path_bias_suggested";
    case "governance.review.requested":
      return "governance_review_requested";
    case "governance.review.completed":
      return "governance_review_completed";
    case "error.raised":
      return "error_raised";
  }
}
