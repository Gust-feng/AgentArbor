import { EXPECTED_DEMO_EVENTS, runMinimalLoop } from "./minimal-loop.js";

const result = await runMinimalLoop("Design a daily AI model trend monitoring plan.");

console.log("AgentArbor desktop agent minimal demo");
console.log("");
console.log("EventLog replay:");
for (const entry of result.runtime.eventLog.list()) {
  console.log(`${String(entry.sequence).padStart(2, "0")}. ${entry.type}`);
}

console.log("");
console.log("Required product path:");
console.log(EXPECTED_DEMO_EVENTS.join(" -> "));

console.log("");
console.log("Summary:");
console.log(
  JSON.stringify(
    {
      taskSoil: {
        id: result.taskSoil.taskSoilId,
        goalId: result.taskSoil.goalId,
        contextRefs: result.taskSoil.contextRefs.map((ref) => ref.ref),
        globalSoilRefs: result.taskSoil.globalSoilRefs,
      },
      planPackage: {
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
        agentRunTree: {
          rootAgentId: result.undergroundReport.agentRunTree?.rootAgentId,
          childRuns: result.undergroundReport.agentRunTree?.childRuns.length,
          parentSyntheses: result.undergroundReport.agentRunTree?.parentSyntheses.length,
        },
      },
      observationSnapshot: {
        traceId: result.observationSnapshot.traceId,
        goalId: result.observationSnapshot.goalId,
        currentPhase: result.observationSnapshot.currentPhase,
        currentStage: result.observationSnapshot.currentStage,
        eventCursor: result.observationSnapshot.eventCursor,
        layerStatuses: {
          underground: result.observationSnapshot.underground.status,
          plan: result.observationSnapshot.handoff.status,
          aboveground: result.observationSnapshot.aboveground.status,
          fruits: result.observationSnapshot.fruits.status,
          governance: result.observationSnapshot.governance.status,
          soilReturnStub: result.observationSnapshot.soilReturnStub.status,
        },
        underground: {
          planId: result.observationSnapshot.underground.planId,
          budget: result.observationSnapshot.underground.budget,
          candidateCounts: result.observationSnapshot.underground.candidatePool.counts,
          candidates: result.observationSnapshot.underground.candidatePool.candidates.map((candidate) => ({
            id: candidate.id,
            clusterId: candidate.clusterId,
            kind: candidate.kind,
            status: candidate.status,
          })),
          convergence: {
            reviewId: result.observationSnapshot.underground.convergence.reviewId,
            outcome: result.observationSnapshot.underground.convergence.outcome,
            decisions: result.observationSnapshot.underground.convergence.decisions.map((decision) => ({
              candidateId: decision.candidateId,
              status: decision.status,
              reason: decision.reason,
            })),
            userEscalationRequired: result.observationSnapshot.underground.userEscalationRequired,
          },
        },
        planPackage: result.observationSnapshot.handoff,
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
