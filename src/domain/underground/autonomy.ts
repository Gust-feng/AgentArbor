import type { ModelCallRef } from "../intelligence/model-call-ref.js";
import type { RootletClusterKind } from "./rootlet-contracts.js";

export const UNDERGROUND_AUTONOMY_ACTIONS = [
  "continue_exploration",
  "request_convergence",
  "request_user_clarification",
  "stop",
] as const;

export type UndergroundAutonomyAction = (typeof UNDERGROUND_AUTONOMY_ACTIONS)[number];

export type UndergroundAutonomyStopReason =
  | "ai_required_for_autonomy"
  | "autonomy_decision_failed"
  | "autonomy_stopped"
  | "autonomy_cycle_guard_exceeded";

export type UndergroundAutonomySpawnRequest = {
  readonly requestId: string;
  readonly rootletKind: RootletClusterKind;
  readonly specialistLabel?: string;
  readonly objective: string;
  readonly informationNeeds: readonly string[];
  readonly sourceHints: readonly string[];
  readonly expectedEvidence: readonly string[];
  readonly rationale: string;
};

export type UndergroundAutonomyDecision = {
  readonly decisionId: string;
  readonly cycleId: string;
  readonly action: UndergroundAutonomyAction;
  readonly completionAssessment: string;
  readonly informationGaps: readonly string[];
  readonly spawnRequests: readonly UndergroundAutonomySpawnRequest[];
  readonly rationale: string;
  readonly sourceRefs: readonly string[];
  readonly modelCallRefs: readonly ModelCallRef[];
  readonly status: "completed" | "failed";
  readonly stopReason?: UndergroundAutonomyStopReason;
};

export type UndergroundExplorationCycle = {
  readonly explorationCycleId: string;
  readonly cycleIndex: number;
  readonly rootletKinds: readonly RootletClusterKind[];
  readonly candidatePoolId?: string;
  readonly autonomyDecisionId?: string;
  readonly action?: UndergroundAutonomyAction;
  readonly spawnedRootletCount: number;
  readonly stopReason?: UndergroundAutonomyStopReason;
  readonly status: "running" | "completed" | "stopped" | "failed";
};

export type UndergroundAutonomyReview = {
  readonly enabled: boolean;
  readonly latestDecision?: UndergroundAutonomyDecision;
  readonly decisions: readonly UndergroundAutonomyDecision[];
  readonly cycles: readonly UndergroundExplorationCycle[];
  readonly stopReason?: UndergroundAutonomyStopReason;
};

export function isUndergroundAutonomyAction(value: string): value is UndergroundAutonomyAction {
  return (UNDERGROUND_AUTONOMY_ACTIONS as readonly string[]).includes(value);
}
