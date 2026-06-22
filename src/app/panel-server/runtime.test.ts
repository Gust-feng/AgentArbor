import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import type { BasicAgentRunExecutionResult } from "../basic-agent-runtime/index.js";
import { createPanelRuntime } from "./runtime.js";

test("panel runtime appends explicit additional skill roots without replacing default roots", () => {
  const runtime = createPanelRuntime({
    additionalSkillRoots: [
      { rootPath: path.join("C:", "managed", "skills"), sourceKind: "admin", sourceRootId: "admin", precedence: 1_000 },
      { rootPath: path.join("Z:", "plugin", "skills"), sourceKind: "plugin", sourceRootId: "plugin:repo-tools", precedence: 500 },
    ],
  }, noopHooks());

  assert.equal(runtime.skillRoots.length, 4);
  assert.deepEqual(runtime.skillRoots.slice(2), [
    { rootPath: path.join("C:", "managed", "skills"), sourceKind: "admin", sourceRootId: "admin", precedence: 1_000 },
    { rootPath: path.join("Z:", "plugin", "skills"), sourceKind: "plugin", sourceRootId: "plugin:repo-tools", precedence: 500 },
  ]);
});

test("panel runtime skillRoots remains a full override for tests and custom hosts", () => {
  const runtime = createPanelRuntime({
    skillRoots: [{ rootPath: path.join("Z:", "custom", "skills"), sourceKind: "custom", sourceRootId: "custom", precedence: 1 }],
    additionalSkillRoots: [{ rootPath: path.join("Z:", "ignored", "skills"), sourceKind: "plugin", sourceRootId: "plugin:ignored", precedence: 500 }],
  }, noopHooks());

  assert.deepEqual(runtime.skillRoots, [
    { rootPath: path.join("Z:", "custom", "skills"), sourceKind: "custom", sourceRootId: "custom", precedence: 1 },
  ]);
});

test("panel runtime records process residue summaries when ordinary runs reach terminal status", async () => {
  const runtime = createPanelRuntime({}, {
    async executeRun(_runtime, _execution): Promise<BasicAgentRunExecutionResult> {
      return { completed: true };
    },
    async failRun(): Promise<void> {
      throw new Error("runtime residue test should not fail a run");
    },
    scheduleNextQueuedConversationRun(): void {
      return undefined;
    },
  });

  const run = await runtime.runExecutor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "complete with residue inspection",
    aiMode: "fake",
  });
  await waitUntil(() => runtime.runJobs.get(run.runId)?.status === "completed");

  const summaries = runtime.processRegistry.listRunResidueSummaries(run.runId);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]?.kind, "process_run_residue_summary");
  assert.equal(summaries[0]?.runId, run.runId);
});

function noopHooks() {
  return {
    async executeRun(_runtime: unknown, _execution: unknown): Promise<BasicAgentRunExecutionResult> {
      return { completed: true };
    },
    async failRun(): Promise<void> {
      throw new Error("noop runtime should not fail a run");
    },
    scheduleNextQueuedConversationRun(): void {
      return undefined;
    },
  };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
