import type {
  ObservationStatus,
  RunObservationEventEntry,
  RunObservationAbovegroundView,
  RunObservationFruitsView,
  RunObservationGovernanceView,
  RunObservationHandoffView,
  RunObservationSnapshotInput,
  RunObservationSoilReturnStubView,
  RunObservationUndergroundView,
} from "./contracts.js";
import type { UserClarificationResponse } from "../underground/index.js";

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
    underground: createUndergroundView(input),
    handoff: createHandoffView(input),
    aboveground: createAbovegroundView(input),
    fruits: createFruitsView(input),
    governance: createGovernanceView(input),
    soilReturnStub: createSoilReturnStubView(input),
  };
}

function createUndergroundView(input: RunObservationSnapshotInput): RunObservationUndergroundView {
  const report = input.undergroundReport;
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
        evidenceRefs: [...(decision.evidenceRefs ?? [])],
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
    clarificationResponses: createClarificationResponses(input.eventEntries),
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
    lineage: {
      current: { ...pkg.lineage.current },
      previous: pkg.lineage.previous === undefined ? undefined : { ...pkg.lineage.previous },
      revisionReason: pkg.lineage.revisionReason,
      sourceRefs: [...pkg.lineage.sourceRefs],
      createdAt: pkg.lineage.createdAt,
    },
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

function createClarificationResponses(
  eventEntries: readonly RunObservationEventEntry[]
): UserClarificationResponse[] {
  const responses: UserClarificationResponse[] = [];
  for (const entry of eventEntries) {
    if (entry.type !== "user_approval.received") {
      continue;
    }
    const response = parseClarificationResponse(entry.message.payload);
    if (response !== undefined) {
      responses.push(response);
    }
  }
  return responses;
}

function parseClarificationResponse(payload: unknown): UserClarificationResponse | undefined {
  const payloadRecord = asRecord(payload);
  const response = asRecord(payloadRecord.clarificationResponse);
  if (
    typeof response.requestId !== "string" ||
    typeof response.goalId !== "string" ||
    typeof response.answeredAt !== "string" ||
    response.status !== "answered" ||
    !Array.isArray(response.answers)
  ) {
    return undefined;
  }

  return {
    requestId: response.requestId,
    goalId: response.goalId,
    answeredAt: response.answeredAt,
    status: "answered",
    answers: response.answers.flatMap((answer) => {
      const record = asRecord(answer);
      if (typeof record.questionId !== "string" || typeof record.answer !== "string") {
        return [];
      }
      return [
        {
          questionId: record.questionId,
          answer: record.answer,
          selectedOptionId:
            typeof record.selectedOptionId === "string" ? record.selectedOptionId : undefined,
          evidenceRefs: stringArray(record.evidenceRefs),
        },
      ];
    }),
    evidenceRefs: stringArray(response.evidenceRefs),
  };
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  return {};
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
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
