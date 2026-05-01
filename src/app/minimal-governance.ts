import { assertDirectionHandoffConverged } from "../domain/agentarbor/direction-handoff.js";
import type {
  DirectionHandoff,
  ExperienceCandidate,
  FruitCandidate,
  GrowthPlan,
  PathBias,
  RunMemory,
  TaskSpec,
  VerificationReport,
} from "../domain/contracts.js";
import { createId, nowIso } from "../kernel/id.js";
import type { GovernanceOutput } from "./agents/types.js";

export function createMinimalGovernanceOutput(input: {
  directionHandoff: DirectionHandoff;
  growthPlan: GrowthPlan;
  task: TaskSpec;
  artifactIds: string[];
  verification: VerificationReport;
  reviewingAgentId: string;
  finalEventTypes: string[];
}): GovernanceOutput {
  assertDirectionHandoffConverged(input.directionHandoff, {
    reviewId: input.directionHandoff.convergenceReviewRef,
    reviewedByAgentIds: ["underground-analyzer"],
    leadAgentId: "underground-analyzer",
    crossCheckedCandidateRefs: input.directionHandoff.sourceCandidateRefs.map((candidate) => candidate.id),
    deduplicatedCandidateRefs: input.directionHandoff.sourceCandidateRefs.map((candidate) => candidate.id),
    acceptedCandidateRefs: input.directionHandoff.sourceCandidateRefs.map((candidate) => candidate.id),
    rejectedCandidateRefs: [],
    conflictResolutionRefs: [],
    provenanceRefs: input.directionHandoff.evidenceRefs,
  });

  const fruit = createMinimalFruitCandidate(input);
  const runMemory = createMinimalRunMemory({ ...input, fruit });
  const experienceCandidate = createMinimalExperienceCandidate(runMemory, input.growthPlan);
  const pathBias = createMinimalPathBias(experienceCandidate, input.growthPlan);

  return { fruit, runMemory, experienceCandidate, pathBias };
}

function createMinimalFruitCandidate(input: {
  directionHandoff: DirectionHandoff;
  artifactIds: string[];
  verification: VerificationReport;
  reviewingAgentId: string;
}): FruitCandidate {
  return {
    id: createId("fruit"),
    sourceGoalId: input.directionHandoff.sourceGoalId,
    artifactIds: input.artifactIds,
    verificationIds: [input.verification.id],
    proposedBy: input.reviewingAgentId,
    governanceStatus: "proposed",
    createdAt: nowIso(),
  };
}

function createMinimalRunMemory(input: {
  directionHandoff: DirectionHandoff;
  growthPlan: GrowthPlan;
  task: TaskSpec;
  artifactIds: string[];
  verification: VerificationReport;
  finalEventTypes: string[];
  fruit: FruitCandidate;
}): RunMemory {
  return {
    id: createId("run-memory"),
    sourceGoalId: input.directionHandoff.sourceGoalId,
    directionHandoffId: input.directionHandoff.id,
    directionHandoffVersion: input.directionHandoff.version,
    growthPlanId: input.growthPlan.id,
    nutrientRequestIds: [],
    nutrientPatchIds: [],
    growthPlanRevisionIds: [],
    sourceTaskIds: [input.task.id],
    sourceAgentIds: ["underground-analyzer", "aboveground-planner", "worker-agent", "verifier", "governance-review"],
    artifactIds: input.artifactIds,
    verificationIds: [input.verification.id],
    actualPath: input.finalEventTypes,
    deviations: [],
    successPatterns: ["approved_direction_to_verified_artifact_to_governed_memory"],
    failurePatterns: [],
    reusableSignals: ["minimal_loop_event_order", "task_assignment_requires_growth_plan"],
    riskNotes: ["Fake agents are demo-only and not governed Capability Assets."],
    createdAt: nowIso(),
  };
}

function createMinimalExperienceCandidate(runMemory: RunMemory, growthPlan: GrowthPlan): ExperienceCandidate {
  return {
    id: createId("experience-candidate"),
    sourceRunMemoryId: runMemory.id,
    appliesToGoalTypes: ["minimal-runtime-kernel"],
    reusablePattern: "Use deterministic in-memory contracts to prove loop integrity before adding adapters.",
    preconditions: ["approved DirectionHandoff", "GrowthPlan", "explicit verification gate"],
    requiredVerificationGates: growthPlan.verificationGates,
    doNotApplyWhen: ["real model calls or persistent assets are in scope"],
    confidence: "high",
    governanceStatus: "captured",
  };
}

function createMinimalPathBias(experienceCandidate: ExperienceCandidate, growthPlan: GrowthPlan): PathBias {
  return {
    id: createId("path-bias"),
    sourceExperienceCandidateId: experienceCandidate.id,
    appliesToGoalTypes: ["minimal-runtime-kernel"],
    preconditions: experienceCandidate.preconditions,
    preferredNodes: ["generate", "verify", "memory", "govern"],
    preferredCapabilities: ["artifact.produce", "artifact.verify", "fruit.review"],
    requiredVerificationGates: growthPlan.verificationGates,
    knownFailureModes: ["hard_constraint_violation", "unapproved_direction_handoff"],
    doNotApplyWhen: experienceCandidate.doNotApplyWhen,
    confidence: "high",
  };
}
