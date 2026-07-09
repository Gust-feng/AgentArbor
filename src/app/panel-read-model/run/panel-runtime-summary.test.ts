import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryProcessRegistry } from "../../runtime-guard/index.js";
import { summarizePanelRuntimeVisibility } from "./panel-runtime-summary.js";

test("panel runtime visibility summary projects process registry facts without recovery advice", async () => {
  const registry = new InMemoryProcessRegistry({ now: () => "2026-06-16T00:00:00.000Z" });
  registry.register({
    processId: "process-dev-server",
    runId: "run-runtime-summary",
    toolCallId: "tool-shell-dev",
    pid: 51730,
    kind: "background",
    owned: true,
    commandLine: "pnpm dev -- --port 5173",
    cwd: "Z:\\AgentArbor",
    startedAt: "2026-06-16T00:00:00.000Z",
    status: "running",
    logRef: "command-log://run-runtime-summary/tool-shell-dev",
    logPath: "C:\\Temp\\agentarbor-command-logs\\dev.log",
    stopCommand: "taskkill /pid 51730 /T /F",
    ports: [
      {
        port: 5173,
        host: "127.0.0.1",
        requestedAt: "2026-06-16T00:00:01.000Z",
        status: "ready",
        ready: true,
        checkedAt: "2026-06-16T00:00:02.000Z",
        durationMs: 1000,
        timeoutMs: 10_000,
      },
    ],
  });
  registry.register({
    processId: "process-cleanup-unknown",
    runId: "run-runtime-summary",
    pid: 51731,
    kind: "foreground",
    owned: true,
    commandLine: "pnpm test",
    cwd: "Z:\\AgentArbor",
    startedAt: "2026-06-16T00:01:00.000Z",
    status: "running",
  });
  await registry.cleanupByRun("run-runtime-summary", {
    killTree(pid) {
      return pid === 51731
        ? { status: "unknown", message: "process state could not be confirmed" }
        : { status: "killed", signal: "SIGTERM" };
    },
  }, { statuses: ["running"] });

  const summary = summarizePanelRuntimeVisibility({
    runId: "run-runtime-summary",
    processRegistry: registry,
  });

  assert.equal(summary?.kind, "panel_runtime_visibility_summary");
  assert.equal(summary?.totalCount, 2);
  assert.equal(summary?.residualCount, 1);
  assert.equal(summary?.statuses.killed, 1);
  assert.equal(summary?.statuses.unknown, 1);
  assert.equal(summary?.processes[0]?.pid, 51730);
  assert.equal(summary?.processes[0]?.ports[0]?.ready, true);
  assert.equal(summary?.processes[0]?.logRef, "command-log://run-runtime-summary/tool-shell-dev");
  assert.equal(summary?.processes[0]?.logPath, "C:\\Temp\\agentarbor-command-logs\\dev.log");
  const latestFact = summary?.processes[1]?.latestFact;
  assert.equal(latestFact?.kind, "kill_tree");
  assert.equal(latestFact?.kind === "kill_tree" ? latestFact.resultStatus : undefined, "unknown");
  assert.equal(JSON.stringify(summary).includes("recovery"), false);
  assert.equal(JSON.stringify(summary).includes("suggest"), false);
});

test("panel runtime visibility summary is omitted when the registry has no run facts", () => {
  const registry = new InMemoryProcessRegistry({ now: () => "2026-06-16T00:00:00.000Z" });

  assert.equal(summarizePanelRuntimeVisibility({ runId: "run-empty", processRegistry: registry }), undefined);
});
