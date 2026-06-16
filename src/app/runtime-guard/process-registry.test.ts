import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryProcessRegistry,
  processPortFactFromLocalPortFact,
  type ProcessKillTreeResult,
  type ProcessPortFact,
  type ProcessRecord,
} from "./process-registry.js";

test("process registry registers background processes, lists by run, and appends port facts", () => {
  const registry = new InMemoryProcessRegistry({ now: fixedNow("2026-06-15T00:00:00.000Z") });

  registry.register({
    processId: "process-dev-server",
    runId: "run-a",
    toolCallId: "tool-call-a",
    pid: 12001,
    kind: "background",
    owned: true,
    commandLine: "pnpm dev -- --port 5173",
    cwd: "Z:\\AgentArbor",
    startedAt: "2026-06-15T00:00:00.000Z",
    status: "running",
    logRef: "command-log://run-a/tool-call-a",
  });
  registry.register({
    processId: "process-other-run",
    runId: "run-b",
    pid: 12002,
    kind: "background",
    owned: true,
    commandLine: "node server.js",
    cwd: "Z:\\AgentArbor",
    startedAt: "2026-06-15T00:01:00.000Z",
    status: "running",
  });

  const updated = registry.appendPortFact("process-dev-server", {
    port: 5173,
    host: "127.0.0.1",
    requestedAt: "2026-06-15T00:00:01.000Z",
    checkedAt: "2026-06-15T00:00:02.000Z",
    ready: true,
  });

  assert.equal(updated?.ports.length, 1);
  assert.deepEqual(
    registry.listByRun("run-a").map((record) => record.processId),
    ["process-dev-server"]
  );
  assert.deepEqual(registry.get("process-dev-server")?.ports, [
    {
      port: 5173,
      host: "127.0.0.1",
      requestedAt: "2026-06-15T00:00:01.000Z",
      checkedAt: "2026-06-15T00:00:02.000Z",
      ready: true,
    },
  ]);
});

test("process registry preserves local port probe facts", () => {
  const registry = new InMemoryProcessRegistry({ now: fixedNow("2026-06-15T00:02:00.000Z") });
  registerProcess(registry, {
    processId: "port-fact-process",
    runId: "run-port-fact",
    pid: 12500,
    owned: true,
    status: "running",
  });

  registry.appendPortFact(
    "port-fact-process",
    processPortFactFromLocalPortFact({
      kind: "wait",
      port: 5173,
      host: "127.0.0.1",
      status: "ready",
      ready: true,
      requestedAt: "2026-06-15T00:02:00.000Z",
      checkedAt: "2026-06-15T00:02:01.000Z",
      durationMs: 1000,
      timeoutMs: 10_000,
      probeTimeoutMs: 250,
      pollIntervalMs: 100,
      attempts: 3,
      externalOccupant: {
        pid: 34567,
        observedBy: "platform_probe",
        ownedByUs: false,
      },
    })
  );

  assert.deepEqual(registry.get("port-fact-process")?.ports, [
    {
      port: 5173,
      host: "127.0.0.1",
      requestedAt: "2026-06-15T00:02:00.000Z",
      status: "ready",
      ready: true,
      checkedAt: "2026-06-15T00:02:01.000Z",
      durationMs: 1000,
      timeoutMs: 10_000,
      externalOccupant: {
        pid: 34567,
        observedBy: "platform_probe",
        ownedByUs: false,
      },
    },
  ]);
});

test("process registry isolates nested port fact objects from caller mutation", () => {
  const registry = new InMemoryProcessRegistry({ now: fixedNow("2026-06-15T00:03:00.000Z") });
  const error = {
    name: "TimeoutError",
    message: "initial timeout",
    code: "WAIT_FOR_PORT_TIMEOUT",
  };
  const externalOccupant = {
    pid: 34567,
    observedBy: "platform_probe" as const,
    ownedByUs: false as const,
  };
  const portFact: ProcessPortFact = {
    port: 5173,
    host: "127.0.0.1",
    requestedAt: "2026-06-15T00:03:00.000Z",
    status: "timeout",
    ready: false,
    checkedAt: "2026-06-15T00:03:01.000Z",
    durationMs: 1000,
    timeoutMs: 1000,
    timedOut: true,
    error,
    externalOccupant,
  };

  registry.register({
    processId: "nested-fact-process",
    runId: "run-nested-fact",
    pid: 12501,
    kind: "background",
    owned: true,
    commandLine: "test-command nested-fact-process",
    cwd: "Z:\\AgentArbor",
    startedAt: "2026-06-15T00:00:00.000Z",
    status: "running",
    ports: [portFact],
  });

  error.message = "mutated timeout";
  externalOccupant.pid = 45678;

  const stored = registry.get("nested-fact-process")?.ports[0];
  assert.equal(stored?.error?.message, "initial timeout");
  assert.equal(stored?.externalOccupant?.pid, 34567);

  const read = registry.get("nested-fact-process")?.ports[0];
  (read?.error as { message: string } | undefined)!.message = "read mutation";
  (read?.externalOccupant as { pid?: number } | undefined)!.pid = 56789;

  const reread = registry.get("nested-fact-process")?.ports[0];
  assert.equal(reread?.error?.message, "initial timeout");
  assert.equal(reread?.externalOccupant?.pid, 34567);
});

test("cleanupByRun terminates only owned active processes for the requested run", async () => {
  const registry = new InMemoryProcessRegistry({ now: fixedNow("2026-06-15T00:05:00.000Z") });
  registerProcess(registry, {
    processId: "owned-active",
    runId: "run-cleanup",
    pid: 21001,
    owned: true,
    status: "running",
  });
  registerProcess(registry, {
    processId: "owned-foreground",
    runId: "run-cleanup",
    pid: 21005,
    owned: true,
    status: "running",
    kind: "foreground",
  });
  registerProcess(registry, {
    processId: "unowned-active",
    runId: "run-cleanup",
    pid: 21002,
    owned: false,
    status: "running",
  });
  registerProcess(registry, {
    processId: "other-run-active",
    runId: "run-other",
    pid: 21003,
    owned: true,
    status: "running",
  });
  registerProcess(registry, {
    processId: "owned-exited",
    runId: "run-cleanup",
    pid: 21004,
    owned: true,
    status: "exited",
  });

  const killedPids: number[] = [];
  const result = await registry.cleanupByRun("run-cleanup", {
    killTree(pid) {
      killedPids.push(pid);
      return {
        status: "killed",
        signal: "SIGTERM",
      };
    },
  });

  assert.deepEqual(killedPids, [21001, 21005]);
  assert.deepEqual(
    result.attempted.map((attempt) => attempt.processId),
    ["owned-active", "owned-foreground"]
  );
  assert.deepEqual(
    result.skipped.map((skip) => [skip.processId, skip.reason]),
    [
      ["unowned-active", "unowned"],
      ["owned-exited", "inactive_status"],
    ]
  );
  assert.equal(registry.get("owned-active")?.status, "killed");
  assert.equal(registry.get("owned-foreground")?.status, "killed");
  assert.deepEqual(
    result.attempted.map((attempt) => [attempt.processId, attempt.outcome]),
    [
      ["owned-active", "killed"],
      ["owned-foreground", "killed"],
    ]
  );
  assert.equal(result.fact.scope, "run");
  assert.equal(result.fact.reason, "cancel");
  assert.equal(result.fact.runId, "run-cleanup");
  assert.equal(registry.get("owned-active")?.facts[0]?.kind, "kill_tree");
  assert.equal(registry.get("owned-active")?.facts[0]?.resultStatus, "killed");
  assert.equal(result.summary.totalCount, 4);
  assert.equal(result.summary.statuses.killed, 2);
  assert.equal(result.summary.statuses.running, 1);
  assert.deepEqual(
    result.summary.processes
      .filter((process) => process.status === "killed")
      .map((process) => [process.processId, process.kind]),
    [
      ["owned-active", "background"],
      ["owned-foreground", "foreground"],
    ]
  );
  assert.equal(registry.get("unowned-active")?.status, "running");
  assert.equal(registry.get("other-run-active")?.status, "running");
  assert.equal(registry.get("owned-exited")?.status, "exited");
});

test("cleanupOwnedBackgroundProcesses terminates only owned unresolved background records on shutdown", async () => {
  const registry = new InMemoryProcessRegistry({ now: fixedNow("2026-06-15T00:06:00.000Z") });
  registerProcess(registry, {
    processId: "shutdown-owned-background",
    runId: "run-shutdown-a",
    pid: 21101,
    owned: true,
    status: "running",
  });
  registerProcess(registry, {
    processId: "shutdown-owned-unknown",
    runId: "run-shutdown-b",
    pid: 21102,
    owned: true,
    status: "unknown",
  });
  registerProcess(registry, {
    processId: "shutdown-foreground",
    runId: "run-shutdown-c",
    pid: 21103,
    owned: true,
    status: "running",
    kind: "foreground",
  });
  registerProcess(registry, {
    processId: "shutdown-unowned-background",
    runId: "run-shutdown-d",
    pid: 21104,
    owned: false,
    status: "running",
  });
  registerProcess(registry, {
    processId: "shutdown-exited-background",
    runId: "run-shutdown-e",
    pid: 21105,
    owned: true,
    status: "exited",
  });

  const killedPids: number[] = [];
  const result = await registry.cleanupOwnedBackgroundProcesses({
    killTree(pid) {
      killedPids.push(pid);
      return pid === 21101
        ? { status: "killed", signal: "SIGTERM" }
        : { status: "exited", message: `Process ${pid} was not running.` };
    },
  });

  assert.deepEqual(killedPids, [21101, 21102]);
  assert.equal(result.kind, "process_registry_cleanup");
  assert.equal(result.reason, "shutdown");
  assert.equal(result.fact.scope, "registry");
  assert.equal(result.fact.reason, "shutdown");
  assert.equal(result.fact.runId, undefined);
  assert.deepEqual(
    result.attempted.map((attempt) => [attempt.processId, attempt.outcome, attempt.afterStatus]),
    [
      ["shutdown-owned-background", "killed", "killed"],
      ["shutdown-owned-unknown", "already-exited", "exited"],
    ]
  );
  assert.deepEqual(
    result.skipped.map((skip) => [skip.processId, skip.reason]),
    [
      ["shutdown-unowned-background", "unowned"],
      ["shutdown-exited-background", "inactive_status"],
    ]
  );
  assert.equal(registry.get("shutdown-owned-background")?.status, "killed");
  assert.equal(registry.get("shutdown-owned-unknown")?.status, "exited");
  assert.equal(registry.get("shutdown-foreground")?.status, "running");
  assert.equal(registry.get("shutdown-unowned-background")?.status, "running");
  assert.equal(registry.listCleanupFacts().length, 1);
  assert.deepEqual(
    registry.listCleanupFacts()[0]?.attempted.map((attempt) => attempt.outcome),
    ["killed", "already-exited"]
  );
});

test("cleanupByRun does not kill or relabel naturally exited processes", async () => {
  const registry = new InMemoryProcessRegistry({ now: fixedNow("2026-06-15T00:10:00.000Z") });
  registerProcess(registry, {
    processId: "natural-exit",
    runId: "run-natural-exit",
    pid: 22001,
    owned: true,
    status: "running",
  });
  registry.markExited("natural-exit", {
    exitCode: 0,
    exitedAt: "2026-06-15T00:09:00.000Z",
  });

  const result = await registry.cleanupByRun("run-natural-exit", {
    killTree() {
      throw new Error("cleanup should not call killTree for exited processes");
    },
  });

  assert.deepEqual(result.attempted, []);
  assert.equal(registry.get("natural-exit")?.status, "exited");
  assert.equal(registry.get("natural-exit")?.exitCode, 0);
  assert.equal(registry.get("natural-exit")?.facts.length, 0);
});

test("cleanupByRun records already-exited kill-tree observations without claiming a kill", async () => {
  const registry = new InMemoryProcessRegistry({ now: fixedNow("2026-06-15T00:12:00.000Z") });
  registerProcess(registry, {
    processId: "already-gone",
    runId: "run-already-gone",
    pid: 22500,
    owned: true,
    status: "running",
  });

  const result = await registry.cleanupByRun("run-already-gone", {
    killTree() {
      return {
        status: "exited",
        message: "Process 22500 was not running.",
      };
    },
  });

  const record = registry.get("already-gone");
  assert.equal(result.attempted[0]?.afterStatus, "exited");
  assert.equal(result.attempted[0]?.outcome, "already-exited");
  assert.equal(record?.status, "exited");
  assert.equal(record?.endedAt, "2026-06-15T00:12:00.000Z");
  assert.equal(record?.facts[0]?.resultStatus, "exited");
  assert.equal(record?.facts[0]?.message, "Process 22500 was not running.");
  assert.equal(result.summary.statuses.exited, 1);
  assert.equal(result.summary.residualCount, 0);
});

test("cleanupByRun records unknown and failed kill-tree facts without recovery advice", async () => {
  const registry = new InMemoryProcessRegistry({ now: fixedNow("2026-06-15T00:15:00.000Z") });
  registerProcess(registry, {
    processId: "unknown-after-cleanup",
    runId: "run-unknown",
    pid: 23001,
    owned: true,
    status: "running",
  });
  registerProcess(registry, {
    processId: "failed-after-cleanup",
    runId: "run-unknown",
    pid: 23002,
    owned: true,
    status: "running",
  });

  const results = new Map<number, ProcessKillTreeResult>([
    [23001, { status: "unknown", message: "process state could not be confirmed" }],
    [23002, { status: "failed", errorMessage: "access denied" }],
  ]);

  const cleanup = await registry.cleanupByRun("run-unknown", {
    killTree(pid) {
      const result = results.get(pid);
      if (result === undefined) {
        throw new Error(`Unexpected pid: ${pid}`);
      }
      return result;
    },
  });

  const unknownRecord = registry.get("unknown-after-cleanup");
  const failedRecord = registry.get("failed-after-cleanup");

  assert.equal(unknownRecord?.status, "unknown");
  assert.equal(unknownRecord?.facts[0]?.resultStatus, "unknown");
  assert.equal(failedRecord?.status, "unknown");
  assert.equal(failedRecord?.facts[0]?.resultStatus, "failed");
  assert.equal(failedRecord?.facts[0]?.errorMessage, "access denied");
  assert.deepEqual(
    cleanup.attempted.map((attempt) => [attempt.processId, attempt.outcome]),
    [
      ["unknown-after-cleanup", "unknown"],
      ["failed-after-cleanup", "error"],
    ]
  );
  assert.equal(registry.summarizeRun("run-unknown").residualCount, 2);
  assert.deepEqual(
    registry.listUnresolvedByRun("run-unknown").map((record) => record.processId),
    ["unknown-after-cleanup", "failed-after-cleanup"]
  );
  assert.equal(JSON.stringify(failedRecord?.facts).includes("recovery"), false);
  assert.equal(JSON.stringify(failedRecord?.facts).includes("suggest"), false);

  const retriedPids: number[] = [];
  await registry.cleanupByRun("run-unknown", {
    killTree(pid) {
      retriedPids.push(pid);
      return {
        status: "exited",
      };
    },
  });

  assert.deepEqual(retriedPids, [23001, 23002]);
});

test("summarizeRun returns a read-only residue fact summary without recovery advice", () => {
  const registry = new InMemoryProcessRegistry({ now: fixedNow("2026-06-15T00:20:00.000Z") });
  registerProcess(registry, {
    processId: "summary-running",
    runId: "run-summary",
    pid: 24001,
    owned: true,
    status: "running",
  });
  registerProcess(registry, {
    processId: "summary-killing",
    runId: "run-summary",
    pid: 24002,
    owned: true,
    status: "killing",
    kind: "foreground",
  });
  registerProcess(registry, {
    processId: "summary-unknown",
    runId: "run-summary",
    pid: 24003,
    owned: true,
    status: "unknown",
  });
  registerProcess(registry, {
    processId: "summary-killed",
    runId: "run-summary",
    pid: 24004,
    owned: true,
    status: "killed",
  });
  registerProcess(registry, {
    processId: "summary-exited",
    runId: "run-summary",
    pid: 24005,
    owned: false,
    status: "exited",
  });

  const summary = registry.summarizeRun("run-summary");

  assert.equal(summary.kind, "process_run_residue_summary");
  assert.equal(summary.observedAt, "2026-06-15T00:20:00.000Z");
  assert.equal(summary.totalCount, 5);
  assert.equal(summary.ownedCount, 4);
  assert.equal(summary.unownedCount, 1);
  assert.equal(summary.residualCount, 3);
  assert.deepEqual(summary.statuses, {
    starting: 0,
    running: 1,
    exited: 1,
    killing: 1,
    killed: 1,
    unknown: 1,
  });
  assert.deepEqual(
    summary.residualProcesses.map((process) => [process.processId, process.status]),
    [
      ["summary-running", "running"],
      ["summary-killing", "killing"],
      ["summary-unknown", "unknown"],
    ]
  );
  assert.equal(JSON.stringify(summary).includes("recovery"), false);
  assert.equal(JSON.stringify(summary).includes("suggest"), false);
});

test("recordRunResidueSummary stores terminal inspection facts", () => {
  const registry = new InMemoryProcessRegistry({ now: fixedNow("2026-06-15T00:22:00.000Z") });
  registerProcess(registry, {
    processId: "inspection-running",
    runId: "run-inspection",
    pid: 25001,
    owned: true,
    status: "running",
  });

  const summary = registry.recordRunResidueSummary("run-inspection");

  assert.equal(summary.kind, "process_run_residue_summary");
  assert.equal(summary.runId, "run-inspection");
  assert.equal(summary.residualCount, 1);
  assert.deepEqual(
    registry.listRunResidueSummaries("run-inspection").map((item) => [item.runId, item.residualCount]),
    [["run-inspection", 1]]
  );
});

function registerProcess(
  registry: InMemoryProcessRegistry,
  input: {
    readonly processId: string;
    readonly runId: string;
    readonly pid: number;
    readonly owned: boolean;
    readonly status: ProcessRecord["status"];
    readonly kind?: ProcessRecord["kind"];
  }
): ProcessRecord {
  return registry.register({
    processId: input.processId,
    runId: input.runId,
    pid: input.pid,
    kind: input.kind ?? "background",
    owned: input.owned,
    commandLine: `test-command ${input.processId}`,
    cwd: "Z:\\AgentArbor",
    startedAt: "2026-06-15T00:00:00.000Z",
    status: input.status,
  });
}

function fixedNow(value: string): () => string {
  return () => value;
}
