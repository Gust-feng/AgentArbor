/**
 * @deprecated 测试废弃候选（T4-1 / ADR-0025 deep 一期）— 随被测 ①/②/②' 废弃候选代码一并退役。
 *
 * 闭环4 §8.1 阶段②：被测代码迁移到 DeepRuntime 后，本测试随之迁移或退役；
 * 当前保持运行不阻塞构建。
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { createRunObservationEventViews, resolveRunObservationPosition } from "../../../domain/observation/index.js";
import { EXPECTED_DEMO_EVENTS, runMinimalLoop } from "./minimal-loop.js";

test("runs the fake-AI desktop agent event sequence in product order", async () => {
  const result = await runMinimalLoop();

  assertIncludesInOrder(result.eventTypes, EXPECTED_DEMO_EVENTS);
  assertIncludesInOrder(
    result.runtime.eventLog.replay().map((message) => message.type),
    EXPECTED_DEMO_EVENTS
  );
  assert.equal(result.eventTypes.includes("model.requested"), true);
  assert.equal(result.eventTypes.includes("agent.delegation.planned"), true);
  assert.equal(result.eventTypes.includes("agent.parent_synthesis.completed"), true);
});

test("returns the minimal loop result with task soil, plan package, artifact, verification, and governed memory", async () => {
  const result = await runMinimalLoop();

  assert.equal(result.taskSoil.goalId, result.observationSnapshot.goalId);
  assert.equal(result.taskSoil.contextRefs.length >= 1, true);
  assert.equal(result.globalSoilView.constraints.length >= 1, true);
  assert.equal(result.loadedDirectionHandoffPackage.manifest.directionId, result.directionHandoff.id);
  assert.equal(result.loadedDirectionHandoffPackage.manifest.directionVersion, result.directionHandoff.version);
  assert.equal(result.loadedDirectionHandoffPackage.manifest.status, "approved");
  assert.equal(result.loadedDirectionHandoffPackage.validation.passed, true);
  assert.equal(result.loadedDirectionHandoffPackage.lineage.revisionReason, "initial");
  assert.equal(result.loadedDirectionHandoffPackage.lineage.current.version, 1);
  assert.equal(result.loadedDirectionHandoffPackage.lineage.previous, undefined);
  assert.deepEqual(result.undergroundReport.candidatePool.counts, {
    total: 2,
    candidate: 0,
    accepted: 1,
    merged: 1,
    rejected: 0,
    unknown: 0,
  });
  assert.equal(result.undergroundReport.plan.rootletClusters.length, 1);
  assert.deepEqual(
    result.undergroundReport.plan.rootletClusters.map((cluster) => cluster.kind),
    ["option"]
  );
  assert.equal(result.undergroundReport.convergenceReport.decisions.length, 2);
  assert.equal(result.undergroundReport.convergenceReport.handoffCandidateRefs.length, 2);
  assert.notEqual(result.undergroundReport.convergenceReport.recommendedOptionId, undefined);
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
  assert.equal(result.runtime.artifactStore.get(result.artifact.ref.id).content.includes("Minimal desktop-agent artifact"), true);
  assert.equal(result.verification.status, "passed");
  assert.equal(result.verification.checks.every((check) => check.status === "passed"), true);
  assert.equal((result.undergroundReport.agentRunTree?.childRuns.length ?? 0) >= 1, true);
  assert.equal((result.undergroundReport.agentRunTree?.parentSyntheses.length ?? 0) >= 1, true);
  assert.equal(result.runMemory.sourceGoalId, result.directionHandoff.sourceGoalId);
  assert.deepEqual(result.runMemory.artifactIds, [result.artifact.ref.id]);
  assertIncludesInOrder(result.runMemory.actualPath as typeof result.eventTypes, EXPECTED_DEMO_EVENTS);
  assert.equal(result.experienceCandidate.sourceRunMemoryId, result.runMemory.id);
  assert.equal(result.pathBias.sourceExperienceCandidateId, result.experienceCandidate.id);
  assert.deepEqual(result.pathBias.requiredVerificationGates, result.growthPlan.verificationGates);
});

test("RunObservationSnapshot is serializable and reflects underground state", async () => {
  const result = await runMinimalLoop();

  const parsed = JSON.parse(JSON.stringify(result.observationSnapshot)) as typeof result.observationSnapshot;

  assert.deepEqual(parsed, result.observationSnapshot);
  assert.equal(parsed.traceId, result.runtime.eventLog.list()[0]?.message.traceId);
  assert.equal(parsed.currentPhase, "completed");
  assert.equal(parsed.currentStage, "path_bias_suggested");
  assert.equal(parsed.eventCursor.eventCount, result.eventTypes.length);
  assert.equal(parsed.handoff.status, "completed");
  assert.equal(parsed.handoff.packageId, result.loadedDirectionHandoffPackage.manifest.packageId);
  assert.equal(parsed.handoff.validationPassed, true);
  assert.equal(parsed.handoff.lineage.revisionReason, "initial");
  assert.equal(parsed.underground.candidatePool.total, 2);
  assert.equal(parsed.underground.candidatePool.accepted, 1);
  assert.equal(parsed.underground.candidatePool.merged, 1);
  assert.equal(parsed.underground.candidatePool.candidatesByKind.option.length, 2);
  assert.equal(parsed.underground.evidenceLedger.totalEntries > 0, true);
  assert.equal(parsed.underground.evidenceLedger.countsByKind.goal_intent, 1);
  assert.equal(parsed.underground.evidenceLedger.countsByKind.rootlet_output, 2);
  assert.equal(parsed.underground.evidenceLedger.countsByKind.candidate_comparison, 2);
  assert.equal(parsed.underground.evidenceLedger.countsByKind.convergence_decision, 2);
  assert.equal(parsed.underground.evidenceLedger.recommendedEvidenceRefs.length > 0, true);
  assert.equal(parsed.underground.agentRunTree?.childRuns.length, result.undergroundReport.plan.rootletClusters.length);
  assert.equal((parsed.underground.agentRunTree?.parentSyntheses.length ?? 0) >= 1, true);
  assert.equal(parsed.underground.convergence.outcome, "approved");
  assert.equal(parsed.underground.convergence.candidateComparisons.length, 2);
  assert.notEqual(parsed.underground.convergence.recommendedOptionId, undefined);
  assert.equal(parsed.underground.userEscalationRequired, false);
  assert.deepEqual(parsed.underground.clarificationResponses, []);
  assert.equal(parsed.directionPackageRef.status, "approved");
  assert.equal(parsed.aboveground.taskStatus, "Assigned");
  assert.equal(parsed.verification.status, "passed");
  assert.equal(parsed.governance.pathBiasId, result.pathBias.id);
  assert.equal(parsed.soilReturnStub.pathBiasId, result.pathBias.id);
});

test("RunObservationSnapshot phase and stage are derived from the EventLog cursor", async () => {
  const result = await runMinimalLoop();
  const entries = result.runtime.eventLog.list();

  assert.deepEqual(resolveRunObservationPosition([]), {
    currentPhase: "not_started",
    currentStage: "not_started",
  });
  const planCompletedIndex = entries.findIndex((entry) => entry.type === "direction_handoff.completed");
  assert.equal(planCompletedIndex >= 0, true);
  assert.deepEqual(resolveRunObservationPosition(entries.slice(0, planCompletedIndex + 1)), {
    currentPhase: "handoff",
    currentStage: "direction_handoff_completed",
  });
  assert.deepEqual(resolveRunObservationPosition(entries), {
    currentPhase: "completed",
    currentStage: "path_bias_suggested",
  });
});

test("RunObservationEventView adds frontend-readable metadata from EventLog entries only", async () => {
  const result = await runMinimalLoop();
  const eventViews = createRunObservationEventViews(result.runtime.eventLog.list());
  const firstEvent = eventViews[0];
  const handoffEvent = eventViews.find((event) => event.type === "direction_handoff.completed");
  const artifactEvent = eventViews.find((event) => event.type === "artifact.produced");

  assert.equal(eventViews.length, result.eventTypes.length);
  assert.equal(firstEvent?.summary, "User goal entered the runtime.");
  assert.equal(firstEvent?.scope, "soil");
  assert.equal(firstEvent?.severity, "info");
  assert.equal(firstEvent?.progress.status, "completed");
  assert.equal(firstEvent?.progress.step, 1);
  assert.equal(firstEvent?.progress.total, result.eventTypes.length);
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

test("RunObservationSnapshot exposes every underground rootlet, candidate, and convergence decision", async () => {
  const result = await runMinimalLoop();
  const underground = result.observationSnapshot.underground;

  assert.equal(underground.rootletClusters.length, result.undergroundReport.plan.rootletClusters.length);
  assert.equal(underground.rootletOutputs.length, result.undergroundReport.rootletOutputs.length);
  assert.equal(underground.agentCluster?.invocations.length, result.undergroundReport.agentClusterRun?.invocations.length);
  assert.equal(underground.candidatePool.candidates.length, result.undergroundReport.candidatePool.candidates.length);
  assert.equal(underground.convergence.decisions.length, result.undergroundReport.convergenceReport.decisions.length);
  assert.equal(
    underground.evidenceLedger.totalEntries,
    result.undergroundReport.evidenceLedger?.entries.length
  );
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
  assert.equal((underground.agentRunTree?.parentSyntheses.length ?? 0) >= 1, true);
});

test("Observation Kernel preserves Plan Package, aboveground load, and EventLog regressions", async () => {
  const result = await runMinimalLoop();
  const snapshot = result.observationSnapshot;

  assertIncludesInOrder(result.eventTypes, EXPECTED_DEMO_EVENTS);
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

test("default demo path keeps Plan Package in memory and does not create repo-root .agentarbor assets", async () => {
  const repoRootAgentArbor = resolve(process.cwd(), ".agentarbor");
  const before = snapshotTree(repoRootAgentArbor);

  const result = await runMinimalLoop();

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

function assertIncludesInOrder(actual: readonly string[], expected: readonly string[]): void {
  let cursor = 0;
  for (const item of actual) {
    if (item === expected[cursor]) {
      cursor += 1;
    }
    if (cursor === expected.length) {
      return;
    }
  }
  assert.fail(`Expected sequence ${expected.join(" -> ")} inside ${actual.join(" -> ")}`);
}
