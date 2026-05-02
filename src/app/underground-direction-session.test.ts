import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
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
});

test("underground-only session does not write repo-root .agentarbor assets", () => {
  const repoRootAgentArbor = resolve(process.cwd(), ".agentarbor");
  const before = snapshotTree(repoRootAgentArbor);

  runUndergroundDirectionSession("Build a small deterministic helper.");

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
