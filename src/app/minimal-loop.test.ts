import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
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
