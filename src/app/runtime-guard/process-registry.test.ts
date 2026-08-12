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

test("process registry appends command log capacity facts without changing process state", () => {
  const registry = new InMemoryProcessRegistry({ now: fixedNow("2026-06-15T00:01:00.000Z") });
  registerProcess(registry, {
    processId: "log-limited-process",
    runId: "run-log-limit",
    pid: 12003,
    owned: true,
    status: "running",
  });

  const updated = registry.appendFact("log-limited-process", {
    kind: "command_log_limit",
    observedAt: "2026-06-15T00:01:01.000Z",
    limitBytes: 1_024,
    observedBytes: 1_100,
    action: "terminate_process",
  });

  assert.equal(updated?.status, "running");
  assert.deepEqual(registry.get("log-limited-process")?.facts, [{
    kind: "command_log_limit",
    observedAt: "2026-06-15T00:01:01.000Z",
    limitBytes: 1_024,
    observedBytes: 1_100,
    action: "terminate_process",
  }]);
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
  assert.equal(result.fact.reason, "run_release");
  assert.equal(result.fact.runId, "run-cleanup");
  assert.equal(firstKillTreeFact(registry.get("owned-active")).resultStatus, "killed");
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

test("cleanupByRun preserves workspace-session services until registry shutdown", async () => {
  const registry = new InMemoryProcessRegistry({ now: fixedNow("2026-06-15T00:05:30.000Z") });
  registry.register({
    processId: "workspace-service",
    runId: "run-service",
    pid: 21006,
    kind: "background",
    lifetime: "workspace_session",
    owned: true,
    commandLine: "pnpm dev",
    cwd: "Z:\\AgentArbor",
    startedAt: "2026-06-15T00:00:00.000Z",
    status: "running",
  });

  const killedPids: number[] = [];
  const terminator = {
    killTree(pid: number) {
      killedPids.push(pid);
      return { status: "killed" as const };
    },
  };

  const runCleanup = await registry.cleanupByRun("run-service", terminator);
  assert.deepEqual(runCleanup.attempted, []);
  assert.equal(registry.get("workspace-service")?.status, "running");

  const shutdownCleanup = await registry.cleanupOwnedBackgroundProcesses(terminator);
  assert.deepEqual(killedPids, [21006]);
  assert.equal(shutdownCleanup.attempted[0]?.processId, "workspace-service");
  assert.equal(registry.get("workspace-service")?.status, "killed");
});

test("stopOwned terminates one stable managed process without touching siblings", async () => {
  const registry = new InMemoryProcessRegistry({ now: fixedNow("2026-06-15T00:05:45.000Z") });
  registerProcess(registry, {
    processId: "managed-target",
    runId: "run-managed",
    pid: 21007,
    owned: true,
    status: "running",
  });
  registerProcess(registry, {
    processId: "managed-sibling",
    runId: "run-managed",
    pid: 21008,
    owned: true,
    status: "running",
  });

  const result = await registry.stopOwned("managed-target", {
    killTree(pid) {
      assert.equal(pid, 21007);
      return { status: "killed", signal: "SIGTERM" };
    },
  });

  assert.equal(result.status, "stopped");
  assert.equal(result.process.status, "killed");
  assert.equal(registry.get("managed-target")?.status, "killed");
  assert.equal(registry.get("managed-sibling")?.status, "running");
});

test("revokeByReference marks permission synchronously and keeps failed stops pending", async () => {
  const registry = new InMemoryProcessRegistry({ now: fixedNow("2026-06-15T00:05:50.000Z") });
  registerProcess(registry, {
    processId: "reference-process",
    runId: "run-reference",
    pid: 21009,
    owned: true,
    status: "running",
    referenceId: "reference-a",
    permissionState: "active",
  });
  let finishStop: ((result: ProcessKillTreeResult) => void) | undefined;

  const cleanup = registry.revokeByReference("reference-a", {
    killTree() {
      return new Promise<ProcessKillTreeResult>((resolve) => { finishStop = resolve; });
    },
  });

  assert.equal(registry.get("reference-process")?.permissionState, "revoked");
  if (finishStop === undefined) throw new Error("Expected the stop attempt to start synchronously.");
  finishStop({ status: "failed", errorMessage: "access denied" });
  const failed = await cleanup;

  assert.equal(failed.fact.scope, "reference");
  assert.equal(failed.fact.reason, "reference_revoked");
  assert.equal(failed.fact.referenceId, "reference-a");
  assert.equal(registry.get("reference-process")?.permissionState, "stop_pending");

  await registry.revokeByReference("reference-a", {
    killTree() { return { status: "killed" }; },
  });
  assert.equal(registry.get("reference-process")?.permissionState, "stopped");
});

test("resource cleanup selects processes by explicit Space and Conversation facts", async () => {
  const registry = new InMemoryProcessRegistry({ now: fixedNow("2026-06-15T00:05:55.000Z") });
  registerProcess(registry, {
    processId: "space-a-conversation-a",
    runId: "run-a",
    pid: 21010,
    owned: true,
    status: "running",
    spaceId: "space-a",
    conversationId: "conversation-a",
    permissionState: "active",
  });
  registerProcess(registry, {
    processId: "space-a-conversation-b",
    runId: "run-b",
    pid: 21011,
    owned: true,
    status: "running",
    spaceId: "space-a",
    conversationId: "conversation-b",
    permissionState: "active",
  });
  registerProcess(registry, {
    processId: "space-b-conversation-a",
    runId: "run-c",
    pid: 21012,
    owned: true,
    status: "running",
    spaceId: "space-b",
    conversationId: "conversation-a",
    permissionState: "active",
  });
  const stopped: number[] = [];
  const terminator = {
    killTree(pid: number) {
      stopped.push(pid);
      return { status: "killed" as const };
    },
  };

  const conversationCleanup = await registry.cleanupByConversation("conversation-a", terminator);
  assert.deepEqual(stopped, [21010, 21012]);
  assert.equal(conversationCleanup.fact.scope, "conversation");
  assert.equal(conversationCleanup.fact.conversationId, "conversation-a");
  assert.equal(registry.get("space-a-conversation-b")?.permissionState, "active");

  const spaceCleanup = await registry.cleanupBySpace("space-a", terminator);
  assert.deepEqual(stopped, [21010, 21012, 21011]);
  assert.equal(spaceCleanup.fact.scope, "space");
  assert.equal(spaceCleanup.fact.spaceId, "space-a");
  assert.equal(registry.get("space-a-conversation-b")?.permissionState, "stopped");
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

test("cleanupOwnedProcesses closes registration and terminates all owned unresolved processes", async () => {
  const registry = new InMemoryProcessRegistry({ now: fixedNow("2026-06-15T00:06:30.000Z") });
  registerProcess(registry, {
    processId: "shutdown-all-background",
    runId: "run-shutdown-all-a",
    pid: 21201,
    owned: true,
    status: "running",
  });
  registerProcess(registry, {
    processId: "shutdown-all-foreground",
    runId: "run-shutdown-all-b",
    pid: 21202,
    owned: true,
    status: "running",
    kind: "foreground",
  });
  registerProcess(registry, {
    processId: "shutdown-all-unowned",
    runId: "run-shutdown-all-c",
    pid: 21203,
    owned: false,
    status: "running",
  });

  const killedPids: number[] = [];
  const result = await registry.cleanupOwnedProcesses({
    killTree(pid) {
      killedPids.push(pid);
      return { status: "killed" };
    },
  });

  assert.deepEqual(killedPids, [21201, 21202]);
  assert.deepEqual(result.attempted.map((attempt) => attempt.processId), [
    "shutdown-all-background",
    "shutdown-all-foreground",
  ]);
  assert.deepEqual(result.skipped.map((skip) => [skip.processId, skip.reason]), [
    ["shutdown-all-unowned", "unowned"],
  ]);
  assert.equal(registry.get("shutdown-all-background")?.status, "killed");
  assert.equal(registry.get("shutdown-all-foreground")?.status, "killed");
  assert.throws(
    () => registry.register({
      processId: "late-process",
      pid: 21204,
      kind: "background",
      owned: true,
      commandLine: "late-process",
      cwd: "Z:\\AgentArbor",
      startedAt: "2026-06-15T00:06:31.000Z",
      status: "running",
    }),
    /no longer accepts registrations/
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
  const killTreeFact = firstKillTreeFact(record);
  assert.equal(killTreeFact.resultStatus, "exited");
  assert.equal(killTreeFact.message, "Process 22500 was not running.");
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
  assert.equal(firstKillTreeFact(unknownRecord).resultStatus, "unknown");
  assert.equal(failedRecord?.status, "unknown");
  const failedKillTreeFact = firstKillTreeFact(failedRecord);
  assert.equal(failedKillTreeFact.resultStatus, "failed");
  assert.equal(failedKillTreeFact.errorMessage, "access denied");
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
    readonly conversationId?: string;
    readonly spaceId?: string;
    readonly referenceId?: string;
    readonly permissionState?: ProcessRecord["permissionState"];
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
    ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
    ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
    ...(input.referenceId === undefined ? {} : { referenceId: input.referenceId }),
    ...(input.permissionState === undefined ? {} : { permissionState: input.permissionState }),
  });
}

function firstKillTreeFact(record: ProcessRecord | undefined) {
  const fact = record?.facts[0];
  assert.equal(fact?.kind, "kill_tree");
  if (fact?.kind !== "kill_tree") {
    throw new Error("Expected the first process fact to be a kill-tree fact.");
  }
  return fact;
}

function fixedNow(value: string): () => string {
  return () => value;
}