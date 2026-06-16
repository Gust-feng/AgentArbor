import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import type { BasicAgentRunExecutionInput, BasicAgentRunExecutionResult } from "../basic-agent-runtime/index.js";
import type { PanelRunJob } from "../panel-run-jobs.js";
import { closePanelServer } from "./request-handler.js";
import { createPanelRuntime, type PanelRuntime } from "./runtime.js";

test("panel server close aborts active runs and cleans owned background processes", async () => {
  const killedPids: number[] = [];
  const runtime = createPanelRuntime({
    processTerminator: {
      killTree(pid) {
        killedPids.push(pid);
        return pid === 32001
          ? { status: "killed", signal: "SIGTERM" }
          : { status: "exited", message: `Process ${pid} was not running.` };
      },
    },
  }, panelRuntimeHooks());
  const abort = new AbortController();
  runtime.abortControllers.set("run-shutdown-a", abort);
  runtime.processRegistry.register({
    processId: "shutdown-owned-background",
    runId: "run-shutdown-a",
    pid: 32001,
    kind: "background",
    owned: true,
    commandLine: "pnpm dev",
    cwd: "Z:\\AgentArbor",
    startedAt: "2026-06-15T00:00:00.000Z",
    status: "running",
  });
  runtime.processRegistry.register({
    processId: "shutdown-owned-unknown",
    runId: "run-shutdown-b",
    pid: 32002,
    kind: "background",
    owned: true,
    commandLine: "node server.js",
    cwd: "Z:\\AgentArbor",
    startedAt: "2026-06-15T00:00:00.000Z",
    status: "unknown",
  });
  runtime.processRegistry.register({
    processId: "shutdown-unowned-background",
    runId: "run-shutdown-c",
    pid: 32003,
    kind: "background",
    owned: false,
    commandLine: "external server",
    cwd: "Z:\\AgentArbor",
    startedAt: "2026-06-15T00:00:00.000Z",
    status: "running",
  });
  runtime.processRegistry.register({
    processId: "shutdown-owned-foreground",
    runId: "run-shutdown-d",
    pid: 32004,
    kind: "foreground",
    owned: true,
    commandLine: "node long-task.js",
    cwd: "Z:\\AgentArbor",
    startedAt: "2026-06-15T00:00:00.000Z",
    status: "running",
  });
  const server = createServer((_request, response) => {
    response.end("ok");
  });
  await listen(server);

  await closePanelServer(server, runtime);

  assert.equal(abort.signal.aborted, true);
  assert.deepEqual(killedPids, [32001, 32002]);
  assert.equal(runtime.processRegistry.get("shutdown-owned-background")?.status, "killed");
  assert.equal(runtime.processRegistry.get("shutdown-owned-unknown")?.status, "exited");
  assert.equal(runtime.processRegistry.get("shutdown-unowned-background")?.status, "running");
  assert.equal(runtime.processRegistry.get("shutdown-owned-foreground")?.status, "running");
  const cleanupFacts = runtime.processRegistry.listCleanupFacts();
  assert.equal(cleanupFacts[0]?.scope, "registry");
  assert.equal(cleanupFacts[0]?.reason, "shutdown");
  assert.deepEqual(
    cleanupFacts[0]?.attempted.map((attempt) => [attempt.processId, attempt.outcome]),
    [
      ["shutdown-owned-background", "killed"],
      ["shutdown-owned-unknown", "already-exited"],
    ]
  );
});

function panelRuntimeHooks() {
  return {
    async executeRun(_runtime: PanelRuntime, _execution: BasicAgentRunExecutionInput): Promise<BasicAgentRunExecutionResult> {
      throw new Error("request-handler cleanup test should not execute a run");
    },
    async failRun(): Promise<void> {
      throw new Error("request-handler cleanup test should not fail a run");
    },
    scheduleNextQueuedConversationRun(_runtime: PanelRuntime, _completedJob: PanelRunJob): void {
      return undefined;
    },
  };
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}
