import type {
  ObservationStatus,
  RunObservationAbovegroundView,
  RunObservationFruitsView,
  RunObservationGovernanceView,
  RunObservationHandoffView,
  RunObservationSnapshotInput,
  RunObservationSoilReturnStubView,
  RunObservationUndergroundView,
} from "./contracts.js";

export type RunObservationLayerViews = {
  readonly underground: RunObservationUndergroundView;
  readonly handoff: RunObservationHandoffView;
  readonly aboveground: RunObservationAbovegroundView;
  readonly fruits: RunObservationFruitsView;
  readonly governance: RunObservationGovernanceView;
  readonly soilReturnStub: RunObservationSoilReturnStubView;
};

export function createRunObservationLayerViews(input: RunObservationSnapshotInput): RunObservationLayerViews {
  return {
    underground: createUndergroundView(input.undergroundReport),
    handoff: createHandoffView(input),
    aboveground: createAbovegroundView(input),
    fruits: createFruitsView(input),
    governance: createGovernanceView(input),
    soilReturnStub: createSoilReturnStubView(input),
  };
}

function createUndergroundView(
  report: RunObservationSnapshotInput["undergroundReport"]
): RunObservationUndergroundView {
  const outputRefByClusterId = new Map(report.rootletOutputs.map((output) => [output.clusterId, output.outputId]));
  return {
    planId: report.plan.planId,
    status: statusForUnderground(report),
    budget: { ...report.plan.budget },
    rootletClusters: report.plan.rootletClusters.map((cluster) => ({
      clusterId: cluster.clusterId,
      kind: cluster.kind,
      stewardRole: cluster.stewardRole,
      status: cluster.status,
      objective: cluster.objective,
      inputRefs: [...cluster.inputRefs],
      exitCriteria: [...cluster.exitCriteria],
      budget: { ...cluster.budget },
      outputRef: outputRefByClusterId.get(cluster.clusterId),
    })),
    rootletOutputs: report.rootletOutputs.map((output) => ({
      outputId: output.outputId,
      clusterId: output.clusterId,
      kind: output.kind,
      producedByAgentId: output.producedByAgentId,
      summary: output.summary,
      sourceRefs: [...output.sourceRefs],
      evidenceRefs: [...output.evidenceRefs],
      soilAssetFitRefs: [...output.soilAssetFitRefs],
      constraintRefs: output.constraintRefs.map((constraintRef) => ({ ...constraintRef })),
      riskRefs: [...output.riskRefs],
      status: output.status,
    })),
    candidatePool: {
      poolId: report.candidatePool.poolId,
      updatedAt: report.candidatePool.updatedAt,
      counts: { ...report.candidatePool.counts },
      total: report.candidatePool.counts.total,
      candidate: report.candidatePool.counts.candidate,
      accepted: report.candidatePool.counts.accepted,
      merged: report.candidatePool.counts.merged,
      rejected: report.candidatePool.counts.rejected,
      unknown: report.candidatePool.counts.unknown,
      sourceRootletOutputRefs: [...report.candidatePool.sourceRootletOutputRefs],
      candidates: report.candidatePool.candidates.map((candidate) => ({
        id: candidate.id,
        kind: candidate.kind,
        producedByAgentId: candidate.producedByAgentId,
        clusterId: candidate.clusterId,
        sourceRefs: [...candidate.sourceRefs],
        status: candidate.status,
      })),
    },
    convergence: {
      reviewId: report.convergenceReport.reviewId,
      outcome: report.convergenceReport.outcome,
      summary: report.convergenceReport.summary,
      reviewedByAgentIds: [...report.convergenceReport.reviewedByAgentIds],
      leadAgentId: report.convergenceReport.leadAgentId,
      crossCheckedCandidateRefs: [...report.convergenceReport.crossCheckedCandidateRefs],
      deduplicatedCandidateRefs: [...report.convergenceReport.deduplicatedCandidateRefs],
      acceptedCandidateRefs: [...report.convergenceReport.acceptedCandidateRefs],
      mergedCandidateRefs: [...report.convergenceReport.mergedCandidateRefs],
      rejectedCandidateRefs: [...report.convergenceReport.rejectedCandidateRefs],
      unknownCandidateRefs: [...report.convergenceReport.unknownCandidateRefs],
      conflictResolutionRefs: [...report.convergenceReport.conflictResolutionRefs],
      provenanceRefs: [...report.convergenceReport.provenanceRefs],
      decisions: report.convergenceReport.decisions.map((decision) => ({
        ...decision,
        sourceCandidateRefs: [...decision.sourceCandidateRefs],
        provenanceRefs: [...decision.provenanceRefs],
      })),
      budgetExhausted: report.convergenceReport.budgetExhausted,
      stopReason: report.convergenceReport.stopReason,
      handoffCandidateRefs: [...report.convergenceReport.handoffCandidateRefs],
      openQuestions: report.convergenceReport.openQuestions.map((question) => ({
        ...question,
        evidenceRefs: [...question.evidenceRefs],
      })),
    },
    userEscalationRequired: report.convergenceReport.userEscalationRequired,
    userEscalation: createUserEscalationView(report),
  };
}

function createHandoffView(input: RunObservationSnapshotInput): RunObservationHandoffView {
  const pkg = input.directionHandoffPackage;
  return {
    status: statusForHandoffPackage(pkg.manifest.status, pkg.validation.passed),
    packageId: pkg.manifest.packageId,
    directionId: pkg.manifest.directionId,
    version: pkg.manifest.directionVersion,
    directionStatus: pkg.manifest.status,
    validationPassed: pkg.validation.passed,
    sourceCandidateRefs: pkg.directionHandoff.sourceCandidateRefs.map((candidate) => candidate.id),
    convergenceReviewRef: pkg.directionHandoff.convergenceReviewRef,
  };
}

function createAbovegroundView(input: RunObservationSnapshotInput): RunObservationAbovegroundView {
  return {
    status: input.growthPlan !== undefined && input.workflow !== undefined && input.task !== undefined ? "completed" : "not_started",
    growthPlanId: input.growthPlan?.id,
    workflowId: input.workflow?.id,
    taskId: input.task?.id,
    taskStatus: input.task?.status,
    verificationGates: input.growthPlan?.verificationGates ?? [],
    runtimeShape: input.growthPlan?.runtimeShape,
    pathBiasDecision: input.growthPlan?.pathBiasDecision,
    taskCount: input.growthPlan?.tasks.length ?? 0,
  };
}

function createFruitsView(input: RunObservationSnapshotInput): RunObservationFruitsView {
  return {
    status: statusForFruits(input),
    artifactRefs: input.artifactRefs?.map((ref) => ({ ...ref })) ?? [],
    verification: createVerificationView(input),
    fruitId: input.fruit?.id,
    fruitStatus: input.fruit?.governanceStatus,
  };
}

function createGovernanceView(input: RunObservationSnapshotInput): RunObservationGovernanceView {
  return {
    status: input.pathBias !== undefined ? "completed" : input.fruit !== undefined ? "in_progress" : "not_started",
    fruitId: input.fruit?.id,
    fruitStatus: input.fruit?.governanceStatus,
    runMemoryId: input.runMemory?.id,
    experienceCandidateId: input.experienceCandidate?.id,
    pathBiasId: input.pathBias?.id,
  };
}

function createSoilReturnStubView(input: RunObservationSnapshotInput): RunObservationSoilReturnStubView {
  const hasReturnCandidate =
    input.runMemory !== undefined || input.experienceCandidate !== undefined || input.pathBias !== undefined;
  return {
    status: hasReturnCandidate ? "completed" : "not_started",
    summary:
      "V0.4 exposes governed return candidates as read-model refs only; no persistent Soil asset store exists yet.",
    runMemoryId: input.runMemory?.id,
    experienceCandidateId: input.experienceCandidate?.id,
    pathBiasId: input.pathBias?.id,
    persistedSoilAssetRefs: [],
  };
}

function createVerificationView(input: RunObservationSnapshotInput): RunObservationFruitsView["verification"] {
  return {
    reportId: input.verification?.id,
    status: input.verification?.status,
    passedChecks: input.verification?.checks.filter((check) => check.status === "passed").length ?? 0,
    totalChecks: input.verification?.checks.length ?? 0,
  };
}

function statusForUnderground(report: RunObservationSnapshotInput["undergroundReport"]): ObservationStatus {
  if (report.convergenceReport.outcome === "stopped") {
    return "blocked";
  }
  if (report.convergenceReport.userEscalationRequired) {
    return "pending";
  }
  return "completed";
}

function statusForHandoffPackage(
  status: RunObservationSnapshotInput["directionHandoffPackage"]["manifest"]["status"],
  validationPassed: boolean
): ObservationStatus {
  if (status === "awaiting_user") {
    return "pending";
  }
  if (!validationPassed) {
    return "failed";
  }
  if (status === "approved") {
    return "completed";
  }
  if (status === "superseded") {
    return "skipped";
  }
  return "in_progress";
}

function createUserEscalationView(
  report: RunObservationSnapshotInput["undergroundReport"]
): RunObservationUndergroundView["userEscalation"] {
  const request = report.convergenceReport.userClarificationRequest;
  if (request === undefined) {
    return {
      required: false,
      relatedCandidateRefs: [],
      questions: [],
    };
  }

  return {
    required: true,
    reason: request.primaryReason,
    blockingLevel: request.blockingLevel,
    requestId: request.requestId,
    status: request.status,
    relatedCandidateRefs: [...request.relatedCandidateRefs],
    questions: request.questions.map((question) => ({
      ...question,
      relatedCandidateRefs: [...question.relatedCandidateRefs],
    })),
    request: {
      ...request,
      relatedCandidateRefs: [...request.relatedCandidateRefs],
      questions: request.questions.map((question) => ({
        ...question,
        relatedCandidateRefs: [...question.relatedCandidateRefs],
      })),
    },
  };
}

function statusForFruits(input: RunObservationSnapshotInput): ObservationStatus {
  if (input.verification?.status === "failed") {
    return "failed";
  }
  if ((input.artifactRefs?.length ?? 0) > 0 || input.fruit !== undefined) {
    return "completed";
  }
  return "not_started";
}
