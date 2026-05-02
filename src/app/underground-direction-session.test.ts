import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import {
  FileSystemDirectionHandoffPackageStore,
  InMemoryDirectionHandoffPackageStore,
} from "../domain/agentarbor/direction-handoff-package.js";
import { EXPECTED_CLARIFICATION_RECOVERY_EVENTS } from "./clarification-flow.js";
import { recoverUndergroundDirectionSession } from "./underground-direction-recovery.js";
import { runUndergroundDirectionSession } from "./underground-direction-session.js";

test("runUndergroundDirectionSession creates an approved package without entering Aboveground", () => {
  const result = runUndergroundDirectionSession("Build a small deterministic helper.");

  assert.equal(result.terminalStatus, "approved_package_created");
  assert.equal(result.loadedDirectionHandoffPackage.manifest.status, "approved");
  assert.equal(result.loadedDirectionHandoffPackage.validation.passed, true);
  assert.equal(result.directionHandoff?.clarifiedGoal, "Build a small deterministic helper");
  assert.deepEqual(
    result.undergroundReport.plan.rootletClusters.map((cluster) => cluster.kind),
    ["option"]
  );
  assert.equal(result.undergroundReport.convergenceReport.candidateComparisons?.length, 1);
  assert.notEqual(result.undergroundReport.evidenceLedger, undefined);
  assert.equal((result.undergroundReport.evidenceLedger?.entries.length ?? 0) > 0, true);
  assert.equal(result.eventTypes.includes("direction_handoff.completed"), true);
  assert.equal(result.eventTypes.includes("growth_plan.completed"), false);
  assert.equal(result.observationSnapshot.aboveground.status, "not_started");
  const plannedPayload = result.runtime.eventLog
    .list()
    .find((entry) => entry.type === "underground.exploration_planned")?.message.payload as
    | { agentCluster?: { plan?: { rootletKinds?: readonly string[] } } }
    | undefined;
  const producedPayload = result.runtime.eventLog
    .list()
    .find((entry) => entry.type === "exploration_candidate.produced")?.message.payload as
    | { agentCluster?: { invocations?: readonly { role: string; outputRefs: readonly string[] }[] } }
    | undefined;
  assert.deepEqual(plannedPayload?.agentCluster?.plan?.rootletKinds, ["option"]);
  assert.equal(
    producedPayload?.agentCluster?.invocations?.some(
      (invocation) => invocation.role === "rootlet_agent" && invocation.outputRefs.length > 0
    ),
    true
  );
  assert.equal(result.undergroundReport.agentClusterRun?.terminalStatus, "approved_package_created");
  assert.equal(result.observationSnapshot.underground.agentCluster?.terminalStatus, "approved_package_created");
  assert.deepEqual(result.observationSnapshot.underground.agentCluster?.plan.rootletKinds, ["option"]);
  assert.equal(
    result.observationSnapshot.underground.agentCluster?.invocations.some(
      (invocation) => invocation.role === "rootlet_agent" && invocation.outputRefs.length > 0
    ),
    true
  );
  assert.equal(
    result.undergroundReport.rootletOutputs.every((output) =>
      result.undergroundReport.agentClusterRun?.invocations.some(
        (invocation) =>
          invocation.invocationId === output.invocationId &&
          invocation.role === "rootlet_agent" &&
          invocation.status === "completed" &&
          invocation.outputRefs.includes(output.outputId)
      )
    ),
    true
  );
});

test("runUndergroundDirectionSession derives handoff fields from goal intent profile", () => {
  const result = runUndergroundDirectionSession(
    "实现地下闭环，必须有验收证据；不要接 UI，不需要数据库；默认使用内存实现。"
  );
  const handoff = result.directionHandoff;

  assert.equal(result.terminalStatus, "approved_package_created");
  assert.notEqual(handoff, undefined);
  assert.equal(handoff?.clarifiedGoal.includes("实现地下闭环"), true);
  assert.equal(handoff?.nonGoals.some((nonGoal) => nonGoal.includes("不要接 UI")), true);
  assert.equal(handoff?.assumptions.some((assumption) => assumption.includes("默认使用内存实现")), true);
  assert.equal(handoff?.options[0]?.directionSummary.includes("实现地下闭环"), true);
  assert.equal(
    handoff?.candidateConstraintRefs.some((ref) => ref.enforcementGate === "soil_promotion"),
    true
  );
  assert.notDeepEqual(handoff?.nonGoals, ["real_llm", "real_agentarbor_assets", "ui", "database", "external_adapters"]);
});

test("runUndergroundDirectionSession waits for user when blocking unknown exists", () => {
  const result = runUndergroundDirectionSession(
    "Build the helper, but permission boundary and hard constraint are unknown and must be confirmed."
  );

  assert.equal(result.terminalStatus, "awaiting_user");
  assert.equal(result.undergroundReport.convergenceReport.outcome, "awaiting_user");
  assert.equal(result.undergroundReport.convergenceReport.userEscalationRequired, true);
  assert.equal(result.loadedDirectionHandoffPackage.manifest.status, "awaiting_user");
  assert.equal(result.loadedDirectionHandoffPackage.validation.passed, false);
  assert.equal(result.eventTypes.includes("user_approval.requested"), true);
  assert.equal(result.eventTypes.includes("growth_plan.completed"), false);
  assert.equal(result.observationSnapshot.underground.userEscalation.required, true);
  assert.equal(result.observationSnapshot.underground.agentCluster?.terminalStatus, "awaiting_user");
  assert.equal(result.observationSnapshot.aboveground.status, "not_started");
});

test("runUndergroundDirectionSession schedules rootlet agent invocations for dynamic rootlet selection", () => {
  const result = runUndergroundDirectionSession(
    "需要风险、安全、资产、证据、约束和反驳，并且权限未知待确认。"
  );
  const rootletKinds = result.undergroundReport.plan.rootletClusters.map((cluster) => cluster.kind);
  const rootletInvocations = result.observationSnapshot.underground.agentCluster?.invocations.filter(
    (invocation) => invocation.role === "rootlet_agent"
  );

  assert.deepEqual(rootletKinds, ["option", "risk", "asset_fit", "evidence", "constraint", "counterfactual"]);
  assert.deepEqual(result.observationSnapshot.underground.agentCluster?.plan.rootletKinds, rootletKinds);
  assert.equal(rootletInvocations?.length, rootletKinds.length);
  assert.equal(rootletInvocations?.every((invocation) => invocation.status === "completed"), true);
  assert.deepEqual(
    result.observationSnapshot.underground.rootletClusters.map((cluster) => cluster.invocationStatus),
    rootletKinds.map(() => "completed")
  );
});

test("recoverUndergroundDirectionSession turns awaiting_user into approved v2 without entering Aboveground", () => {
  const awaiting = runUndergroundDirectionSession(
    "Build the helper, but permission boundary and hard constraint are unknown and must be confirmed."
  );
  const recovery = recoverUndergroundDirectionSession(awaiting);

  assert.equal(recovery.terminalStatus, "approved_package_created");
  assert.deepEqual(recovery.eventTypes, EXPECTED_CLARIFICATION_RECOVERY_EVENTS);
  assert.equal(recovery.awaitingUserDirectionHandoffPackage.manifest.status, "awaiting_user");
  assert.equal(recovery.awaitingUserDirectionHandoffPackage.validation.passed, false);
  assert.equal(recovery.loadedApprovedDirectionHandoffPackage.manifest.status, "approved");
  assert.equal(recovery.loadedApprovedDirectionHandoffPackage.validation.passed, true);
  assert.equal(
    recovery.loadedApprovedDirectionHandoffPackage.manifest.directionId,
    awaiting.loadedDirectionHandoffPackage.manifest.directionId
  );
  assert.equal(recovery.loadedApprovedDirectionHandoffPackage.manifest.directionVersion, 2);
  assert.deepEqual(recovery.packageVersions, [1, 2]);
  assert.equal(recovery.loadedApprovedDirectionHandoffPackage.lineage.previous?.version, 1);
  assert.equal(recovery.loadedApprovedDirectionHandoffPackage.lineage.revisionReason, "user_clarification_answered");
  assert.equal(recovery.observationSnapshot.aboveground.status, "not_started");
  const handoffInvocation = recovery.recoveredUndergroundReport.agentClusterRun?.invocations.find(
    (invocation) => invocation.role === "handoff_steward"
  );
  assert.equal(handoffInvocation?.agentId, "underground-handoff-steward");
  assert.equal(handoffInvocation?.outputRefs.includes(recovery.directionHandoffPackageRef.packageId), true);
  const completedEvents = recovery.runtime.eventLog
    .list()
    .filter((entry) => entry.type === "direction_handoff.completed");
  const finalCompletedEvent = completedEvents[completedEvents.length - 1];
  assert.equal(finalCompletedEvent?.message.from.id, "underground-handoff-steward");
});

test("runUndergroundDirectionSession stops without fabricating an approved package", () => {
  const result = runUndergroundDirectionSession("Stop because no viable candidate should be produced.");

  assert.equal(result.terminalStatus, "stopped");
  assert.equal(result.undergroundReport.convergenceReport.outcome, "stopped");
  assert.equal(result.loadedDirectionHandoffPackage.manifest.status, "draft");
  assert.equal(result.loadedDirectionHandoffPackage.validation.passed, false);
  assert.equal(result.eventTypes.includes("direction_handoff.completed"), false);
  assert.equal(result.eventTypes.includes("user_approval.requested"), false);
  assert.equal(result.observationSnapshot.currentPhase, "underground");
  assert.equal(result.observationSnapshot.handoff.directionStatus, "draft");
  assert.equal(result.observationSnapshot.underground.agentCluster?.terminalStatus, "stopped");
  assert.equal(result.observationSnapshot.aboveground.status, "not_started");
});

test("underground-only session does not write repo-root .agentarbor assets", () => {
  const repoRootAgentArbor = resolve(process.cwd(), ".agentarbor");
  const before = snapshotTree(repoRootAgentArbor);

  runUndergroundDirectionSession("Build a small deterministic helper.");

  assert.deepEqual(snapshotTree(repoRootAgentArbor), before);
});

test("underground session recovery does not write repo-root .agentarbor without explicit output", () => {
  const repoRootAgentArbor = resolve(process.cwd(), ".agentarbor");
  const before = snapshotTree(repoRootAgentArbor);

  const awaiting = runUndergroundDirectionSession(
    "Build the helper, but permission boundary and hard constraint are unknown and must be confirmed."
  );
  recoverUndergroundDirectionSession(awaiting);

  assert.deepEqual(snapshotTree(repoRootAgentArbor), before);
});

test("runUndergroundDirectionSession can use an injected package store", () => {
  const packageStore = new InMemoryDirectionHandoffPackageStore();
  const result = runUndergroundDirectionSession("Build a small deterministic helper.", { packageStore });

  assert.deepEqual(packageStore.listVersions(result.loadedDirectionHandoffPackage.manifest.directionId), [1]);
  assert.deepEqual(result.packageVersions, [1]);
});

test("runUndergroundDirectionSession writes and round-trips packages only with explicit output directory", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "agentarbor-direction-package-"));
  try {
    const result = runUndergroundDirectionSession("Build a small deterministic helper.", {
      outputDirectory: tempRoot,
    });

    assert.notEqual(result.writtenPackagePath, undefined);
    assert.equal(existsSync(result.writtenPackagePath ?? ""), true);

    const meta = JSON.parse(readFileSync(result.writtenPackagePath ?? "", "utf8")) as {
      manifest: { packageId: string; directionId: string; directionVersion: number };
    };
    assert.equal(meta.manifest.packageId, result.loadedDirectionHandoffPackage.manifest.packageId);

    const store = new FileSystemDirectionHandoffPackageStore(tempRoot);
    const loaded = store.load(meta.manifest.directionId, meta.manifest.directionVersion);
    assert.equal(loaded.manifest.packageId, result.loadedDirectionHandoffPackage.manifest.packageId);
    assert.deepEqual(store.listVersions(meta.manifest.directionId), [1]);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
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
