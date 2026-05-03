import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { runUndergroundDirectionSession } from "./underground-direction-session.js";
import { recoverUndergroundDirectionSession } from "./underground-direction-recovery.js";
import { createUndergroundDemoSummary } from "./underground-demo-summary.js";

test("createUndergroundDemoSummary reports an approved underground package", () => {
  const result = runUndergroundDirectionSession("Build a small deterministic helper.");
  const summary = createUndergroundDemoSummary(result);

  assert.equal(summary.terminalStatus, "approved_package_created");
  assert.equal(summary.directionPackage.status, "approved");
  assert.equal(summary.directionPackage.version, 1);
  assert.deepEqual(summary.versions, [1]);
  assert.equal(summary.lineage.revisionReason, "initial");
  assert.equal(summary.recoveredPackage, undefined);
  assert.equal(summary.writtenPackagePath, undefined);
  assert.equal(summary.directionPackage.validation.passed, true);
  assert.equal(summary.ai.enabled, false);
  assert.equal(summary.ai.status, "disabled");
  assert.deepEqual(summary.ai.eventCounts, { requested: 0, completed: 0, failed: 0 });
  assert.deepEqual(summary.ai.modelCallRefs, []);
  assert.deepEqual(summary.underground.rootletKinds, ["option"]);
  assert.equal(summary.underground.candidateCounts.accepted, 1);
  assert.equal(summary.underground.candidateCounts.merged, 1);
  assert.equal(summary.underground.convergence.outcome, "approved");
  assert.equal(summary.userEscalation, undefined);
  assert.equal(summary.observationSnapshot.layerStatuses.aboveground, "not_started");
  assert.equal(summary.eventLog.includes("direction_handoff.completed"), true);
  assert.equal(summary.eventLog.includes("growth_plan.completed"), false);
});

test("createUndergroundDemoSummary reports auto-answer recovery as approved v2", () => {
  const result = runUndergroundDirectionSession(
    "Build the helper, but permission boundary and hard constraint are unknown and must be confirmed."
  );
  const recovery = recoverUndergroundDirectionSession(result);
  const summary = createUndergroundDemoSummary(result, recovery);

  assert.equal(summary.terminalStatus, "approved_package_created");
  assert.equal(summary.directionPackage.status, "approved");
  assert.equal(summary.directionPackage.version, 2);
  assert.equal(summary.recoveredPackage?.version, 2);
  assert.deepEqual(summary.versions, [1, 2]);
  assert.equal(summary.lineage.previous?.version, 1);
  assert.equal(summary.lineage.revisionReason, "user_clarification_answered");
  assert.equal(summary.underground.convergence.outcome, "approved");
  assert.equal(summary.underground.convergence.userEscalationRequired, false);
  assert.equal(summary.eventLog.includes("user_approval.received"), true);
  assert.equal(summary.eventLog.includes("direction_handoff.completed"), true);
  assert.equal(summary.observationSnapshot.layerStatuses.aboveground, "not_started");
});

test("createUndergroundDemoSummary reports model events and candidate-layer refs without model content", async () => {
  const { createUndergroundAiRuntimeConfig } = await import("./intelligence-channel-factory.js");
  const { runUndergroundDirectionSessionWithIntelligence } = await import("./underground-direction-session.js");

  const aiConfig = createUndergroundAiRuntimeConfig({ mode: "fake" });
  if (!aiConfig.enabled) {
    throw new Error("Expected fake AI config to be enabled.");
  }
  const result = await runUndergroundDirectionSessionWithIntelligence("Build a small deterministic helper.", {
    createIntelligenceChannel: aiConfig.createIntelligenceChannel,
  });
  const summary = createUndergroundDemoSummary(result, undefined, aiConfig.summaryInput);

  assert.equal(summary.ai.enabled, true);
  assert.equal(summary.ai.mode, "fake");
  assert.equal(summary.ai.status, "completed");
  assert.deepEqual(summary.ai.eventCounts, { requested: 1, completed: 1, failed: 0 });
  assert.equal(summary.ai.providerKind, "fake");
  assert.equal(summary.ai.protocolKind, "openai_compatible_chat_completions");
  assert.equal(summary.ai.model, "fake-deterministic-model");
  assert.equal(summary.ai.modelCallRefs.length, 1);
  assert.equal(summary.ai.modelCallRefs[0]?.rootletOutputRefs.length, 1);
  assert.equal(summary.ai.modelCallRefs[0]?.candidateRefs.length, 1);
  assert.equal(JSON.stringify(summary).includes("Fake model candidate advice"), false);
});

test("createUndergroundDemoSummary exposes awaiting-user escalation without entering Aboveground", () => {
  const result = runUndergroundDirectionSession(
    "Build the helper, but permission boundary and hard constraint are unknown and must be confirmed."
  );
  const summary = createUndergroundDemoSummary(result);

  assert.equal(summary.terminalStatus, "awaiting_user");
  assert.equal(summary.directionPackage.status, "awaiting_user");
  assert.equal(summary.directionPackage.validation.passed, false);
  assert.equal(summary.underground.convergence.outcome, "awaiting_user");
  assert.equal(summary.underground.convergence.userEscalationRequired, true);
  assert.notEqual(summary.userEscalation, undefined);
  assert.equal((summary.userEscalation?.questionCount ?? 0) > 0, true);
  assert.equal(summary.eventLog.includes("user_approval.requested"), true);
  assert.equal(summary.eventLog.includes("growth_plan.completed"), false);
});

test("createUndergroundDemoSummary reports stopped runs without fabricating approval", () => {
  const result = runUndergroundDirectionSession("Stop because no viable candidate should be produced.");
  const summary = createUndergroundDemoSummary(result);

  assert.equal(summary.terminalStatus, "stopped");
  assert.equal(summary.directionPackage.status, "draft");
  assert.equal(summary.directionPackage.validation.passed, false);
  assert.equal(summary.underground.convergence.outcome, "stopped");
  assert.equal(summary.underground.convergence.stopReason, "budget_exhausted_without_converged_candidates");
  assert.equal(summary.userEscalation, undefined);
  assert.equal(summary.eventLog.includes("direction_handoff.completed"), false);
});

test("underground demo summary does not write repo-root .agentarbor assets", () => {
  const repoRootAgentArbor = resolve(process.cwd(), ".agentarbor");
  const before = snapshotTree(repoRootAgentArbor);

  const result = runUndergroundDirectionSession("Build a small deterministic helper.");
  createUndergroundDemoSummary(result);

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
