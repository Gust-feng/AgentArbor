import type {
  RunObservationEventView,
  RunObservationSnapshot,
  RunObservationSnapshotInput,
  RunObservationUndergroundView,
} from "./contracts.js";

export function createRunObservationSnapshot(input: RunObservationSnapshotInput): RunObservationSnapshot {
  const events = input.eventEntries.map(toEventView);
  const lastEvent = events.at(-1);

  const snapshot: RunObservationSnapshot = {
    traceId: input.traceId,
    goalId: input.goalId,
    currentPhase: currentPhaseFromLastEvent(lastEvent?.type),
    eventCursor: {
      eventCount: events.length,
      lastSequence: lastEvent?.sequence ?? 0,
      lastEventType: lastEvent?.type,
    },
    events,
    underground: createUndergroundView(input.undergroundReport),
    directionPackageRef: {
      packageId: input.directionHandoffPackage.manifest.packageId,
      directionId: input.directionHandoffPackage.manifest.directionId,
      version: input.directionHandoffPackage.manifest.directionVersion,
      status: input.directionHandoffPackage.manifest.status,
      validationPassed: input.directionHandoffPackage.validation.passed,
    },
    aboveground: {
      growthPlanId: input.growthPlan?.id,
      workflowId: input.workflow?.id,
      taskId: input.task?.id,
      taskStatus: input.task?.status,
      verificationGates: input.growthPlan?.verificationGates ?? [],
    },
    artifactRefs: input.artifactRefs?.map((ref) => ({ ...ref })) ?? [],
    verification: {
      reportId: input.verification?.id,
      status: input.verification?.status,
      passedChecks: input.verification?.checks.filter((check) => check.status === "passed").length ?? 0,
      totalChecks: input.verification?.checks.length ?? 0,
    },
    governance: {
      fruitId: input.fruit?.id,
      fruitStatus: input.fruit?.governanceStatus,
      runMemoryId: input.runMemory?.id,
      experienceCandidateId: input.experienceCandidate?.id,
      pathBiasId: input.pathBias?.id,
    },
  };

  return JSON.parse(JSON.stringify(snapshot)) as RunObservationSnapshot;
}

function toEventView(entry: RunObservationSnapshotInput["eventEntries"][number]): RunObservationEventView {
  return {
    sequence: entry.sequence,
    type: entry.type,
    traceId: entry.message.traceId,
    taskId: entry.message.taskId,
    intent: entry.message.intent,
    from: { ...entry.message.from },
    to: entry.message.to === undefined ? undefined : { ...entry.message.to },
    createdAt: entry.message.createdAt,
    recordedAt: entry.recordedAt,
  };
}

function createUndergroundView(report: RunObservationSnapshotInput["undergroundReport"]): RunObservationUndergroundView {
  return {
    planId: report.plan.planId,
    budget: { ...report.plan.budget },
    rootletClusters: report.plan.rootletClusters.map((cluster) => ({
      clusterId: cluster.clusterId,
      kind: cluster.kind,
      status: cluster.status,
      objective: cluster.objective,
    })),
    candidatePool: {
      poolId: report.candidatePool.poolId,
      total: report.candidatePool.counts.total,
      candidate: report.candidatePool.counts.candidate,
      accepted: report.candidatePool.counts.accepted,
      merged: report.candidatePool.counts.merged,
      rejected: report.candidatePool.counts.rejected,
      unknown: report.candidatePool.counts.unknown,
      sourceRootletOutputRefs: [...report.candidatePool.sourceRootletOutputRefs],
    },
    convergence: {
      reviewId: report.convergenceReport.reviewId,
      outcome: report.convergenceReport.outcome,
      summary: report.convergenceReport.summary,
      acceptedCandidateRefs: [...report.convergenceReport.acceptedCandidateRefs],
      mergedCandidateRefs: [...report.convergenceReport.mergedCandidateRefs],
      rejectedCandidateRefs: [...report.convergenceReport.rejectedCandidateRefs],
      unknownCandidateRefs: [...report.convergenceReport.unknownCandidateRefs],
      stopReason: report.convergenceReport.stopReason,
    },
    userEscalationRequired: report.convergenceReport.userEscalationRequired,
  };
}

function currentPhaseFromLastEvent(type: string | undefined): string {
  if (type === undefined) {
    return "not_started";
  }
  if (type === "path_bias.suggested") {
    return "completed";
  }
  if (
    type.startsWith("underground.") ||
    type.startsWith("rootlet_") ||
    type.startsWith("exploration_candidate") ||
    type.startsWith("candidate_") ||
    type.startsWith("convergence_review")
  ) {
    return "underground";
  }
  if (type.startsWith("growth_plan") || type.startsWith("workflow") || type.startsWith("task")) {
    return "aboveground";
  }
  if (type.startsWith("verification")) {
    return "verification";
  }
  if (type.startsWith("fruit") || type.startsWith("governance") || type.startsWith("run_memory")) {
    return "governance";
  }
  return "running";
}
