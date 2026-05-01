import { EXPECTED_DEMO_EVENTS, runMinimalLoop } from "./minimal-loop.js";

const result = runMinimalLoop();

console.log("AgentArbor minimal runtime demo");
console.log("");
console.log("EventLog replay:");
for (const entry of result.runtime.eventLog.list()) {
  console.log(`${String(entry.sequence).padStart(2, "0")}. ${entry.type}`);
}

console.log("");
console.log("Expected order:");
console.log(EXPECTED_DEMO_EVENTS.join(" -> "));

console.log("");
console.log("Summary:");
console.log(
  JSON.stringify(
    {
      loadedDirectionPackage: {
        id: result.loadedDirectionHandoffPackage.manifest.directionId,
        version: result.loadedDirectionHandoffPackage.manifest.directionVersion,
        status: result.loadedDirectionHandoffPackage.manifest.status,
      },
      underground: {
        planId: result.undergroundReport.plan.planId,
        budget: result.undergroundReport.plan.budget,
        candidateCounts: result.undergroundReport.candidatePool.counts,
        convergence: {
          reviewId: result.undergroundReport.convergenceReport.reviewId,
          outcome: result.undergroundReport.convergenceReport.outcome,
          accepted: result.undergroundReport.convergenceReport.acceptedCandidateRefs.length,
          merged: result.undergroundReport.convergenceReport.mergedCandidateRefs.length,
          rejected: result.undergroundReport.convergenceReport.rejectedCandidateRefs.length,
          unknown: result.undergroundReport.convergenceReport.unknownCandidateRefs.length,
          userEscalationRequired: result.undergroundReport.convergenceReport.userEscalationRequired,
        },
      },
      observationSnapshot: {
        traceId: result.observationSnapshot.traceId,
        goalId: result.observationSnapshot.goalId,
        currentPhase: result.observationSnapshot.currentPhase,
        eventCursor: result.observationSnapshot.eventCursor,
        underground: result.observationSnapshot.underground,
        directionPackageRef: result.observationSnapshot.directionPackageRef,
      },
      fruit: result.fruit,
      runMemory: {
        id: result.runMemory.id,
        actualPath: result.runMemory.actualPath,
        artifactIds: result.runMemory.artifactIds,
        verificationIds: result.runMemory.verificationIds,
      },
      experienceCandidate: result.experienceCandidate,
      pathBias: result.pathBias,
    },
    null,
    2
  )
);
