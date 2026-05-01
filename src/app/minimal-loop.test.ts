import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { createRunObservationEventViews, resolveRunObservationPosition } from "../domain/observation/index.js";
import { EXPECTED_DEMO_EVENTS, runMinimalLoop } from "./minimal-loop.js";

test("runs the fixed minimal event sequence in order", () => {
  const result = runMinimalLoop();

  assert.deepEqual(result.eventTypes, EXPECTED_DEMO_EVENTS);
  assert.deepEqual(
    result.runtime.eventLog.replay().map((message) => message.type),
    EXPECTED_DEMO_EVENTS
  );
});

test("returns the minimal loop result with package, artifact, verification, and governed memory", () => {
  const result = runMinimalLoop();

  assert.equal(result.loadedDirectionHandoffPackage.manifest.directionId, result.directionHandoff.id);
  assert.equal(result.loadedDirectionHandoffPackage.manifest.directionVersion, result.directionHandoff.version);
  assert.equal(result.loadedDirectionHandoffPackage.manifest.status, "approved");
  assert.equal(result.loadedDirectionHandoffPackage.validation.passed, true);
  assert.equal(result.loadedDirectionHandoffPackage.lineage.revisionReason, "initial");
  assert.equal(result.loadedDirectionHandoffPackage.lineage.current.version, 1);
  assert.equal(result.loadedDirectionHandoffPackage.lineage.previous, undefined);
  assert.deepEqual(result.undergroundReport.candidatePool.counts, {
    total: 6,
    candidate: 0,
    accepted: 2,
    merged: 2,
    rejected: 2,
    unknown: 0,
  });
  assert.equal(result.undergroundReport.convergenceReport.decisions.length, 6);
  assert.equal(result.undergroundReport.convergenceReport.handoffCandidateRefs.length, 4);
  assert.equal(
    result.directionHandoff.sourceCandidateRefs.every(
      (candidate) => candidate.status === "accepted" || candidate.status === "merged"
    ),
    true
  );
  assert.deepEqual(
    result.loadedDirectionHandoffPackage.candidateReferenceIndex.map((candidate) => candidate.candidateId),
    result.undergroundReport.convergenceReport.handoffCandidateRefs
  );
  assert.equal(result.artifact.ref.type, "document");
  assert.equal(result.runtime.artifactStore.get(result.artifact.ref.id).content.includes("Minimal AgentApp"), true);
  assert.equal(result.verification.status, "passed");
  assert.equal(result.verification.checks.every((check) => check.status === "passed"), true);
  assert.equal(result.runMemory.sourceGoalId, result.directionHandoff.sourceGoalId);
  assert.deepEqual(result.runMemory.artifactIds, [result.artifact.ref.id]);
  assert.deepEqual(result.runMemory.actualPath, EXPECTED_DEMO_EVENTS);
  assert.equal(result.experienceCandidate.sourceRunMemoryId, result.runMemory.id);
  assert.equal(result.pathBias.sourceExperienceCandidateId, result.experienceCandidate.id);
  assert.deepEqual(result.pathBias.requiredVerificationGates, result.growthPlan.verificationGates);
});

test("RunObservationSnapshot is serializable and reflects underground state", () => {
  const result = runMinimalLoop();

  const parsed = JSON.parse(JSON.stringify(result.observationSnapshot)) as typeof result.observationSnapshot;

  assert.deepEqual(parsed, result.observationSnapshot);
  assert.equal(parsed.traceId, result.runtime.eventLog.list()[0]?.message.traceId);
  assert.equal(parsed.currentPhase, "completed");
  assert.equal(parsed.currentStage, "path_bias_suggested");
  assert.equal(parsed.eventCursor.eventCount, EXPECTED_DEMO_EVENTS.length);
  assert.equal(parsed.handoff.status, "completed");
  assert.equal(parsed.handoff.packageId, result.loadedDirectionHandoffPackage.manifest.packageId);
  assert.equal(parsed.handoff.validationPassed, true);
  assert.equal(parsed.handoff.lineage.revisionReason, "initial");
  assert.equal(parsed.underground.candidatePool.total, 6);
  assert.equal(parsed.underground.candidatePool.accepted, 2);
  assert.equal(parsed.underground.candidatePool.merged, 2);
  assert.equal(parsed.underground.convergence.outcome, "approved");
  assert.equal(parsed.underground.userEscalationRequired, false);
  assert.deepEqual(parsed.underground.clarificationResponses, []);
  assert.equal(parsed.directionPackageRef.status, "approved");
  assert.equal(parsed.aboveground.taskStatus, "Assigned");
  assert.equal(parsed.verification.status, "passed");
  assert.equal(parsed.governance.pathBiasId, result.pathBias.id);
  assert.equal(parsed.soilReturnStub.pathBiasId, result.pathBias.id);
});

test("RunObservationSnapshot phase and stage are derived from the EventLog cursor", () => {
  const result = runMinimalLoop();
  const entries = result.runtime.eventLog.list();

  assert.deepEqual(resolveRunObservationPosition([]), {
    currentPhase: "not_started",
    currentStage: "not_started",
  });
  assert.deepEqual(resolveRunObservationPosition(entries.slice(0, 7)), {
    currentPhase: "handoff",
    currentStage: "direction_handoff_completed",
  });
  assert.deepEqual(resolveRunObservationPosition(entries), {
    currentPhase: "completed",
    currentStage: "path_bias_suggested",
  });
});

test("RunObservationEventView adds frontend-readable metadata from EventLog entries only", () => {
  const result = runMinimalLoop();
  const eventViews = createRunObservationEventViews(result.runtime.eventLog.list());
  const firstEvent = eventViews[0];
  const handoffEvent = eventViews.find((event) => event.type === "direction_handoff.completed");
  const artifactEvent = eventViews.find((event) => event.type === "artifact.produced");

  assert.equal(eventViews.length, EXPECTED_DEMO_EVENTS.length);
  assert.equal(firstEvent?.summary, "User goal entered the runtime.");
  assert.equal(firstEvent?.scope, "soil");
  assert.equal(firstEvent?.severity, "info");
  assert.equal(firstEvent?.progress.status, "completed");
  assert.equal(firstEvent?.progress.step, 1);
  assert.equal(firstEvent?.progress.total, EXPECTED_DEMO_EVENTS.length);
  assert.equal(firstEvent?.refs.some((ref) => ref.kind === "goal" && ref.id === result.observationSnapshot.goalId), true);
  assert.equal(handoffEvent?.scope, "handoff");
  assert.equal(
    handoffEvent?.refs.some(
      (ref) =>
        ref.kind === "direction_package" && ref.id === result.loadedDirectionHandoffPackage.manifest.packageId
    ),
    true
  );
  assert.equal(
    artifactEvent?.refs.some(
      (ref) => ref.kind === "artifact" && ref.id === result.artifact.ref.id && ref.version === result.artifact.ref.version
    ),
    true
  );
});

test("RunObservationSnapshot exposes every underground rootlet, candidate, and convergence decision", () => {
  const result = runMinimalLoop();
  const underground = result.observationSnapshot.underground;

  assert.equal(underground.rootletClusters.length, result.undergroundReport.plan.rootletClusters.length);
  assert.equal(underground.rootletOutputs.length, result.undergroundReport.rootletOutputs.length);
  assert.equal(underground.candidatePool.candidates.length, result.undergroundReport.candidatePool.candidates.length);
  assert.equal(underground.convergence.decisions.length, result.undergroundReport.convergenceReport.decisions.length);
  assert.deepEqual(
    underground.rootletClusters.map((cluster) => cluster.clusterId),
    result.undergroundReport.plan.rootletClusters.map((cluster) => cluster.clusterId)
  );
  assert.deepEqual(
    underground.candidatePool.candidates.map((candidate) => candidate.id),
    result.undergroundReport.candidatePool.candidates.map((candidate) => candidate.id)
  );
  assert.deepEqual(
    underground.convergence.decisions.map((decision) => decision.decisionId),
    result.undergroundReport.convergenceReport.decisions.map((decision) => decision.decisionId)
  );
  assert.deepEqual(
    underground.convergence.handoffCandidateRefs,
    result.undergroundReport.convergenceReport.handoffCandidateRefs
  );
});

test("Observation Kernel preserves handoff, aboveground load, and fixed EventLog regressions", () => {
  const result = runMinimalLoop();
  const snapshot = result.observationSnapshot;

  assert.deepEqual(result.eventTypes, EXPECTED_DEMO_EVENTS);
  assert.equal(snapshot.handoff.directionId, result.loadedDirectionHandoffPackage.manifest.directionId);
  assert.equal(snapshot.handoff.version, result.loadedDirectionHandoffPackage.manifest.directionVersion);
  assert.deepEqual(
    snapshot.handoff.sourceCandidateRefs,
    result.directionHandoff.sourceCandidateRefs.map((candidate) => candidate.id)
  );
  assert.equal(snapshot.aboveground.status, "completed");
  assert.equal(snapshot.aboveground.growthPlanId, result.growthPlan.id);
  assert.equal(snapshot.aboveground.workflowId, result.workflow.id);
  assert.equal(snapshot.aboveground.taskId, result.task.id);
  assert.equal(snapshot.fruits.verification.reportId, result.verification.id);
  assert.equal(snapshot.governance.status, "completed");
});

test("default demo path keeps DirectionHandoffPackage in memory and does not create repo-root .agentarbor assets", () => {
  const repoRootAgentArbor = resolve(process.cwd(), ".agentarbor");
  const before = snapshotTree(repoRootAgentArbor);

  const result = runMinimalLoop();

  assert.equal(result.runtime.directionHandoffPackageStore.constructor.name, "InMemoryDirectionHandoffPackageStore");
  assert.deepEqual(snapshotTree(repoRootAgentArbor), before);
});

function snapshotTree(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }

  const entries: string[] = [];
  const walk = (current: string, relativePrefix: string): void => {
    for (const name of readdirSync(current).sort()) {
      const absolutePath = join(current, name);
      const relativePath = relativePrefix === "" ? name : `${relativePrefix}/${name}`;
      const stats = statSync(absolutePath);
      entries.push(`${relativePath}:${stats.isDirectory() ? "dir" : "file"}:${stats.size}:${stats.mtimeMs}`);
      if (stats.isDirectory()) {
        walk(absolutePath, relativePath);
      }
    }
  };

  walk(root, "");
  return entries;
}
