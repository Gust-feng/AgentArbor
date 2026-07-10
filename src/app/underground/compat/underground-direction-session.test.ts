/**
 * @deprecated 测试废弃候选（T4-1 / ADR-0025 deep 一期）— 随被测 ①/②/②' 废弃候选代码一并退役。
 *
 * 闭环4 §8.1 阶段②：被测代码迁移到 DeepRuntime 后，本测试随之迁移或退役；
 * 当前保持运行不阻塞构建。
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import {
  FileSystemDirectionHandoffPackageStore,
  InMemoryDirectionHandoffPackageStore,
} from "../../../domain/agentarbor/direction-handoff-package.js";
import { createUndergroundAiRuntimeConfig } from "../../underground-ai-runtime.js";
import { recoverUndergroundDirectionSession } from "./underground-direction-recovery.js";
import {
  runUndergroundDirectionSession,
  runUndergroundDirectionSessionWithIntelligence,
  type RunUndergroundDirectionSessionOptions,
} from "./underground-direction-session.js";

test("fake AI underground session creates an approved package without entering Aboveground", async () => {
  const result = await runFakeUndergroundDirectionSession("Build a small deterministic helper.");

  assert.equal(result.terminalStatus, "approved_package_created");
  assert.equal(result.loadedDirectionHandoffPackage.manifest.status, "approved");
  assert.equal(result.loadedDirectionHandoffPackage.validation.passed, true);
  assert.equal(result.directionHandoff?.clarifiedGoal.includes("Build a small deterministic helper"), true);
  assert.equal(
    result.undergroundReport.plan.rootletClusters.map((cluster) => cluster.kind).includes("option"),
    true
  );
  assert.equal(
    result.undergroundReport.convergenceReport.candidateComparisons?.length,
    result.undergroundReport.candidatePool.counts.total
  );
  assert.equal(result.undergroundReport.candidatePool.candidatesByKind.option.length, 2);
  assert.equal(result.undergroundReport.convergenceReport.mergedCandidateRefs.length >= 1, true);
  assert.notEqual(result.undergroundReport.evidenceLedger, undefined);
  assert.equal((result.undergroundReport.evidenceLedger?.entries.length ?? 0) > 0, true);
  assert.equal(
    result.undergroundReport.convergenceReport.evidenceLedgerRef,
    result.undergroundReport.evidenceLedger?.ledgerId
  );
  const evidenceEntryIds = new Set(
    result.undergroundReport.evidenceLedger?.entries.map((entry) => entry.evidenceId)
  );
  assert.equal(
    result.undergroundReport.rootletOutputs.every((output) =>
      output.evidenceRefs.some((evidenceRef) => evidenceEntryIds.has(evidenceRef))
    ),
    true
  );
  assert.equal(
    result.undergroundReport.convergenceReport.candidateComparisons?.every(
      (comparison) =>
        comparison.goalMatchBasis.length > 0 &&
        comparison.evidenceSupportBasis.length > 0 &&
        comparison.constraintImpactBasis.length > 0 &&
        comparison.riskCoverage.length > 0 &&
        comparison.evidenceRefs.some((evidenceRef) => evidenceEntryIds.has(evidenceRef))
    ),
    true
  );
  assert.equal(
    result.undergroundReport.convergenceReport.decisions.every((decision) =>
      decision.evidenceRefs.some((evidenceRef) => evidenceEntryIds.has(evidenceRef))
    ),
    true
  );
  assert.equal(
    result.directionHandoff?.evidenceRefs.includes(result.undergroundReport.evidenceLedger?.ledgerId ?? ""),
    true
  );
  assert.equal(result.observationSnapshot.underground.evidenceLedger.totalEntries, evidenceEntryIds.size);
  assert.equal(result.observationSnapshot.underground.evidenceLedger.countsByKind.rootlet_output, 2);
  assert.equal(result.observationSnapshot.underground.evidenceLedger.recommendedEvidenceRefs.length > 0, true);
  assert.equal(
    result.observationSnapshot.underground.evidenceLedger.recommendedEvidenceRefs
      .filter((ref) => ref !== result.undergroundReport.convergenceReport.evidenceLedgerRef)
      .every((ref) => evidenceEntryIds.has(ref)),
    true
  );
  assert.equal(result.eventTypes.includes("direction_handoff.completed"), true);
  assert.equal(result.eventTypes.includes("growth_plan.completed"), false);
  assert.equal(result.observationSnapshot.aboveground.status, "not_started");
  assert.equal(result.directionHandoff?.options.length, 2);
  assert.equal(
    result.directionHandoff?.decisionRecord.mergedOptionIds.length ?? 0,
    1
  );
  assert.deepEqual(
    result.directionHandoff?.decisionRecord.abovegroundReferenceOptionIds,
    result.undergroundReport.convergenceReport.abovegroundReferenceOptionIds
  );
  assert.equal(result.undergroundReport.agentClusterRun, undefined);
  assert.equal(result.observationSnapshot.underground.agentCluster, undefined);
});

test("fake AI underground session derives handoff fields from goal intent profile", async () => {
  const result = await runFakeUndergroundDirectionSession(
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

test("fake AI underground session waits for user when blocking unknown exists", async () => {
  const result = await runFakeUndergroundDirectionSession(
    "Build the helper, but permission boundary and hard constraint are unknown and must be confirmed."
  );

  assert.equal(result.terminalStatus, "awaiting_user");
  assert.equal(result.undergroundReport.convergenceReport.outcome, "awaiting_user");
  assert.equal(result.undergroundReport.convergenceReport.userEscalationRequired, true);
  assert.equal(result.loadedDirectionHandoffPackage.manifest.status, "awaiting_user");
  assert.equal(result.loadedDirectionHandoffPackage.validation.passed, false);
  assert.equal(result.eventTypes.includes("growth_plan.completed"), false);
  assert.equal(result.observationSnapshot.underground.userEscalation.required, true);
  assert.equal(result.observationSnapshot.underground.evidenceLedger.countsByKind.user_clarification, 1);
  assert.equal(result.observationSnapshot.aboveground.status, "not_started");
});

test("fake AI underground session schedules rootlet agent invocations for dynamic rootlet selection", async () => {
  const result = await runFakeUndergroundDirectionSession(
    "需要风险、安全、资产、证据、约束和反驳，并且权限未知待确认。"
  );
  const rootletKinds = result.undergroundReport.plan.rootletClusters.map((cluster) => cluster.kind);

  assert.deepEqual(rootletKinds, ["option", "risk", "asset_fit", "evidence", "constraint", "counterfactual"]);
  assert.equal(result.undergroundReport.rootletOutputs.length >= rootletKinds.length, true);
  assert.equal(
    result.undergroundReport.rootletOutputs.every((output) => output.status === "produced"),
    true
  );
});

test("recoverUndergroundDirectionSession turns awaiting_user into approved v2 without entering Aboveground", async () => {
  const awaiting = await runFakeUndergroundDirectionSession(
    "Build the helper, but permission boundary and hard constraint are unknown and must be confirmed."
  );
  const recovery = recoverUndergroundDirectionSession(awaiting);

  assert.equal(recovery.terminalStatus, "approved_package_created");
  assert.equal(recovery.eventTypes.includes("direction_handoff.completed"), true);
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
  assert.equal(
    recovery.recoveredUndergroundReport.convergenceReport.evidenceLedgerRef,
    awaiting.undergroundReport.convergenceReport.evidenceLedgerRef
  );
  assert.equal(recovery.observationSnapshot.aboveground.status, "not_started");
  assert.equal(recovery.recoveredUndergroundReport.agentClusterRun, undefined);
  const completedEvents = recovery.runtime.eventLog
    .list()
    .filter((entry) => entry.type === "direction_handoff.completed");
  const finalCompletedEvent = completedEvents[completedEvents.length - 1];
  assert.equal(finalCompletedEvent?.message.from.id, "underground-handoff-steward");
});

test("runUndergroundDirectionSession without AgentTurnRuntime stops without fabricating an approved package", async () => {
  const result = await runUndergroundDirectionSession("Stop because no viable candidate should be produced.");

  assert.equal(result.terminalStatus, "stopped");
  assert.equal(result.undergroundReport.convergenceReport.outcome, "stopped");
  assert.equal(result.loadedDirectionHandoffPackage.manifest.status, "draft");
  assert.equal(result.loadedDirectionHandoffPackage.validation.passed, false);
  assert.equal(result.eventTypes.includes("growth_plan.completed"), false);
  assert.equal(result.observationSnapshot.handoff.directionStatus, "draft");
  assert.equal(result.undergroundReport.convergenceReport.stopReason, "ai_required_for_autonomy");
  assert.equal(result.observationSnapshot.underground.evidenceLedger.countsByKind.stop_reason, 1);
  assert.equal(
    result.observationSnapshot.underground.evidenceLedger.insufficientEvidenceRefs.every((ref) =>
      result.undergroundReport.evidenceLedger?.entries.some((entry) => entry.evidenceId === ref)
    ),
    true
  );
  assert.equal(result.observationSnapshot.aboveground.status, "not_started");
});

test("underground-only session does not write repo-root .agentarbor assets", async () => {
  const repoRootAgentArbor = resolve(process.cwd(), ".agentarbor");
  const before = snapshotTree(repoRootAgentArbor);

  await runFakeUndergroundDirectionSession("Build a small deterministic helper.");

  assert.deepEqual(snapshotTree(repoRootAgentArbor), before);
});

test("underground session recovery does not write repo-root .agentarbor without explicit output", async () => {
  const repoRootAgentArbor = resolve(process.cwd(), ".agentarbor");
  const before = snapshotTree(repoRootAgentArbor);

  const awaiting = await runFakeUndergroundDirectionSession(
    "Build the helper, but permission boundary and hard constraint are unknown and must be confirmed."
  );
  recoverUndergroundDirectionSession(awaiting);

  assert.deepEqual(snapshotTree(repoRootAgentArbor), before);
});

test("runUndergroundDirectionSession can use an injected package store", async () => {
  const packageStore = new InMemoryDirectionHandoffPackageStore();
  const result = await runFakeUndergroundDirectionSession("Build a small deterministic helper.", { packageStore });

  assert.deepEqual(packageStore.listVersions(result.loadedDirectionHandoffPackage.manifest.directionId), [1]);
  assert.deepEqual(result.packageVersions, [1]);
});

test("runUndergroundDirectionSession writes and round-trips packages only with explicit output directory", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "agentarbor-direction-package-"));
  try {
    const result = await runFakeUndergroundDirectionSession("Build a small deterministic helper.", {
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
    const evidenceIndex = readFileSync(
      join(
        tempRoot,
        "directions",
        encodeURIComponent(meta.manifest.directionId),
        `v${meta.manifest.directionVersion}`,
        "evidence-index.md"
      ),
      "utf8"
    );
    assert.equal(evidenceIndex.includes("## Candidate Comparisons"), true);
    assert.equal(evidenceIndex.includes("## Convergence Decisions"), true);
    assert.equal(evidenceIndex.includes("candidate-"), true);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

async function runFakeUndergroundDirectionSession(
  goal: string,
  options: RunUndergroundDirectionSessionOptions = {}
) {
  const aiConfig = createUndergroundAiRuntimeConfig({ mode: "fake" });
  if (!aiConfig.enabled) {
    throw new Error("Expected fake AI runtime config to be enabled.");
  }
  return runUndergroundDirectionSessionWithIntelligence(goal, {
    ...options,
    createIntelligenceChannel: aiConfig.createIntelligenceChannel,
    createToolCenter: aiConfig.createToolCenter,
  });
}

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
