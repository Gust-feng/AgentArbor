import assert from "node:assert/strict";
import test from "node:test";
import type { BasicAgentRunExecutionResult } from "../basic-agent-runtime/index.js";
import { createPanelRuntime } from "./runtime.js";

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

async function waitUntil(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
