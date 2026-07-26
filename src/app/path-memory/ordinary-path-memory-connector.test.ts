import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type {
  OrdinaryRunSummary,
  OrdinaryStableTerminalRunFacts,
} from "../ordinary-agent/contracts.js";
import { PathMemoryFeatureError, type PathMemoryRepository } from "./contracts.js";
import { createFileSystemPathMemoryRepository } from "./file-system-repository.js";
import { createOrdinaryPathMemoryConnector } from "./ordinary-path-memory-connector.js";
import { createPathMemoryFeature } from "./path-memory-feature.js";

type OrdinaryStub = {
  readonly queries: {
    listRuns(limit?: number): Promise<readonly OrdinaryRunSummary[]>;
    getStableTerminalRunFacts(runId: string): Promise<OrdinaryStableTerminalRunFacts | undefined>;
  } & Record<string, unknown>;
  readonly events: {
    subscribeStableTerminalRuns(listener: (runId: string) => void): () => void;
  } & Record<string, unknown>;
};

function stableFactsFixture(runId: string): OrdinaryStableTerminalRunFacts {
  return {
    runId,
    sourceRevision: 4,
    turn: {
      conversationId: `conversation-${runId}`,
      ordinal: 1,
      userTurnId: `${runId}-user`,
      assistantTurnId: `${runId}-assistant`,
    },
    userMessage: `请完成 ${runId}`,
    taskContextRefs: [],
    workspaceRoot: "C:/workspace/demo",
    workspaceSelection: "default",
    executionStarted: true,
    toolFacts: [
      {
        toolFactId: `${runId}-tool-1`,
        toolName: "read_file",
        status: "completed",
        durationMs: 8,
      },
      {
        toolFactId: `${runId}-tool-2`,
        parentToolFactId: `${runId}-tool-1`,
        toolName: "run_command",
        status: "cancelled",
        durationMs: 90,
      },
    ],
    status: { kind: "completed", answer: "done" },
    createdAt: "2026-07-26T08:00:00.000Z",
    terminalAt: "2026-07-26T08:00:09.000Z",
  };
}

function summaryFor(runId: string, status: OrdinaryRunSummary["status"]): OrdinaryRunSummary {
  return {
    runId,
    conversationId: `conversation-${runId}`,
    userTurnId: `${runId}-user`,
    assistantTurnId: `${runId}-assistant`,
    status,
    createdAt: "2026-07-26T08:00:00.000Z",
    updatedAt: "2026-07-26T08:00:09.000Z",
  };
}

function ordinaryStub(input: {
  readonly summaries?: readonly OrdinaryRunSummary[];
  readonly facts?: ReadonlyMap<string, OrdinaryStableTerminalRunFacts>;
}): OrdinaryStub & { notify(runId: string): void; readonly listenerCount: () => number } {
  const listeners = new Set<(runId: string) => void>();
  return {
    queries: {
      async listRuns() {
        return input.summaries ?? [];
      },
      async getStableTerminalRunFacts(runId: string) {
        return input.facts?.get(runId);
      },
    },
    events: {
      subscribeStableTerminalRuns(listener: (runId: string) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    notify(runId: string) {
      for (const listener of [...listeners]) listener(runId);
    },
    listenerCount: () => listeners.size,
  };
}

async function tempRepository(t: test.TestContext): Promise<PathMemoryRepository> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-connector-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  return createFileSystemPathMemoryRepository(root);
}

test("realtime capture maps stable facts into one PathMemory per run", async (t) => {
  const repository = await tempRepository(t);
  const feature = createPathMemoryFeature({ repository });
  const facts = stableFactsFixture("run-rt");
  const ordinary = ordinaryStub({ facts: new Map([["run-rt", facts]]) });
  const connector = createOrdinaryPathMemoryConnector({ ordinary, pathMemory: feature });
  t.after(async () => { await connector.release(); await feature.release(); });

  ordinary.notify("run-rt");
  ordinary.notify("run-rt");
  await connector.ready();

  const memory = await repository.findBySource({ feature: "ordinary", runId: "run-rt" });
  assert.notEqual(memory, undefined);
  assert.equal(memory?.id, "path-memory:ordinary:run-rt");
  assert.equal(memory?.source.sourceRevision, 4);
  assert.equal(memory?.goal.userRequest, "请完成 run-rt");
  assert.equal(memory?.scope.workspaceRoot, "C:/workspace/demo");
  assert.equal(memory?.outcome.terminalStatus, "completed");
  assert.equal(memory?.verification.status, "not_recorded");
  assert.deepEqual(memory?.path.toolSteps.map((step) => step.ordinal), [1, 2]);
  assert.equal(memory?.path.toolSteps[1]?.parentToolFactId, "run-rt-tool-1");
  assert.equal(memory?.path.toolSteps[0]?.resultRef, "ordinary-run:run-rt#tool:run-rt-tool-1");
  assert.equal((await repository.list()).length, 1);
});

test("startup reconciliation captures missing terminal runs and skips unstable or live ones", async (t) => {
  const repository = await tempRepository(t);
  const feature = createPathMemoryFeature({ repository });
  const stable = stableFactsFixture("run-old");
  const ordinary = ordinaryStub({
    summaries: [
      summaryFor("run-old", "completed"),
      summaryFor("run-live", "running"),
      summaryFor("run-unstable", "cancelled"),
    ],
    // run-unstable is terminal by summary but its facts have not settled yet.
    facts: new Map([["run-old", stable]]),
  });
  const connector = createOrdinaryPathMemoryConnector({ ordinary, pathMemory: feature });
  t.after(async () => { await connector.release(); await feature.release(); });

  await connector.ready();
  assert.notEqual(await repository.findBySource({ feature: "ordinary", runId: "run-old" }), undefined);
  assert.equal(await repository.findBySource({ feature: "ordinary", runId: "run-live" }), undefined);
  assert.equal(await repository.findBySource({ feature: "ordinary", runId: "run-unstable" }), undefined);
});

test("realtime and reconciliation racing on one run converge to a single record", async (t) => {
  const repository = await tempRepository(t);
  const feature = createPathMemoryFeature({ repository });
  const facts = stableFactsFixture("run-race");
  const ordinary = ordinaryStub({
    summaries: [summaryFor("run-race", "completed")],
    facts: new Map([["run-race", facts]]),
  });
  const connector = createOrdinaryPathMemoryConnector({ ordinary, pathMemory: feature });
  t.after(async () => { await connector.release(); await feature.release(); });

  ordinary.notify("run-race");
  await connector.ready();
  assert.equal((await repository.list()).length, 1);
});

test("capture failures surface as diagnostics and never throw into the notifier", async (t) => {
  const repository = await tempRepository(t);
  const failing: PathMemoryRepository = {
    ...repository,
    create() {
      return Promise.reject(new PathMemoryFeatureError("path_memory_repository_failure", "disk full"));
    },
  };
  const feature = createPathMemoryFeature({ repository: failing });
  const facts = stableFactsFixture("run-fail");
  const diagnostics: { source: string; runId?: string }[] = [];
  const ordinary = ordinaryStub({ facts: new Map([["run-fail", facts]]) });
  const connector = createOrdinaryPathMemoryConnector({
    ordinary,
    pathMemory: feature,
    onDiagnostic: (diagnostic) => diagnostics.push({ source: diagnostic.source, runId: diagnostic.runId }),
  });
  t.after(async () => { await connector.release(); await feature.release(); });

  ordinary.notify("run-fail");
  await connector.ready();
  assert.deepEqual(diagnostics, [{ source: "realtime", runId: "run-fail" }]);
  assert.equal(await repository.findBySource({ feature: "ordinary", runId: "run-fail" }), undefined);
});

test("release unsubscribes, drains accepted captures and ignores later notifications", async (t) => {
  const repository = await tempRepository(t);
  const feature = createPathMemoryFeature({ repository });
  const facts = stableFactsFixture("run-drain");
  const ordinary = ordinaryStub({ facts: new Map([["run-drain", facts]]) });
  const connector = createOrdinaryPathMemoryConnector({ ordinary, pathMemory: feature });

  ordinary.notify("run-drain");
  await connector.release();
  assert.equal(ordinary.listenerCount(), 0);
  assert.notEqual(await repository.findBySource({ feature: "ordinary", runId: "run-drain" }), undefined);

  ordinary.notify("run-drain-late");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal((await repository.list()).length, 1);
  await feature.release();
});

test("blocked, failed and cancelled outcomes map their reason facts", async (t) => {
  const repository = await tempRepository(t);
  const feature = createPathMemoryFeature({ repository });
  const blocked: OrdinaryStableTerminalRunFacts = {
    ...stableFactsFixture("run-blocked"),
    status: { kind: "blocked", reason: { code: "continuation_lost", message: "restarted" }, continueBy: "new_turn" },
  };
  const failed: OrdinaryStableTerminalRunFacts = {
    ...stableFactsFixture("run-failed"),
    status: { kind: "failed", error: { code: "provider_failed", message: "disconnected" } },
  };
  const cancelled: OrdinaryStableTerminalRunFacts = {
    ...stableFactsFixture("run-cancelled"),
    status: { kind: "cancelled", reason: "cancelled_by_user" },
  };
  const ordinary = ordinaryStub({
    facts: new Map([
      ["run-blocked", blocked],
      ["run-failed", failed],
      ["run-cancelled", cancelled],
    ]),
  });
  const connector = createOrdinaryPathMemoryConnector({ ordinary, pathMemory: feature });
  t.after(async () => { await connector.release(); await feature.release(); });

  ordinary.notify("run-blocked");
  ordinary.notify("run-failed");
  ordinary.notify("run-cancelled");
  await connector.ready();

  const blockedMemory = await repository.findBySource({ feature: "ordinary", runId: "run-blocked" });
  assert.deepEqual(blockedMemory?.outcome, {
    terminalStatus: "blocked",
    reason: { code: "continuation_lost", message: "restarted" },
    continueBy: "new_turn",
  });
  const failedMemory = await repository.findBySource({ feature: "ordinary", runId: "run-failed" });
  assert.deepEqual(failedMemory?.outcome, {
    terminalStatus: "failed",
    error: { code: "provider_failed", message: "disconnected" },
  });
  const cancelledMemory = await repository.findBySource({ feature: "ordinary", runId: "run-cancelled" });
  assert.deepEqual(cancelledMemory?.outcome, { terminalStatus: "cancelled", reason: "cancelled_by_user" });
});

test("diagnostics counts realtime captured, existing, skipped and failed captures", async (t) => {
  const repository = await tempRepository(t);
  let failNext = false;
  const flaky: PathMemoryRepository = {
    ...repository,
    create(memory) {
      if (failNext) {
        failNext = false;
        return Promise.reject(new PathMemoryFeatureError("path_memory_repository_failure", "disk full"));
      }
      return repository.create(memory);
    },
  };
  const feature = createPathMemoryFeature({ repository: flaky });
  const facts = stableFactsFixture("run-diag");
  const failFacts = stableFactsFixture("run-diag-fail");
  const ordinary = ordinaryStub({
    facts: new Map([
      ["run-diag", facts],
      ["run-diag-fail", failFacts],
    ]),
  });
  const connector = createOrdinaryPathMemoryConnector({ ordinary, pathMemory: feature });
  t.after(async () => { await connector.release(); await feature.release(); });

  ordinary.notify("run-diag");
  await connector.ready();
  ordinary.notify("run-diag"); // idempotent repeat resolves as existing
  ordinary.notify("run-diag-unstable"); // no facts yet -> skipped
  await connector.ready();
  failNext = true;
  ordinary.notify("run-diag-fail");
  await connector.ready();

  const snapshot = connector.diagnostics();
  assert.deepEqual(snapshot.realtime, { captured: 1, existing: 1, replaced: 0, skippedUnstable: 1, skippedDeleted: 0, failures: 1 });
});

test("a deleted memory is not resurrected by realtime repeats or a restarted reconciliation", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-connector-tombstone-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  const repository = createFileSystemPathMemoryRepository(root);
  const feature = createPathMemoryFeature({ repository });
  const facts = stableFactsFixture("run-forgotten");
  const ordinary = ordinaryStub({
    summaries: [summaryFor("run-forgotten", "completed")],
    facts: new Map([["run-forgotten", facts]]),
  });
  const connector = createOrdinaryPathMemoryConnector({ ordinary, pathMemory: feature });

  ordinary.notify("run-forgotten");
  await connector.ready();
  await feature.commands.delete("path-memory:ordinary:run-forgotten");

  // Realtime repeat after delete must not rebuild the record.
  ordinary.notify("run-forgotten");
  await connector.ready();
  assert.equal(await repository.findBySource({ feature: "ordinary", runId: "run-forgotten" }), undefined);
  assert.equal(connector.diagnostics().realtime.skippedDeleted, 1);
  await connector.release();
  await feature.release();

  // Full restart: rebuilt repository/feature/connector reconcile without resurrecting.
  const rebuiltRepository = createFileSystemPathMemoryRepository(root);
  const rebuiltFeature = createPathMemoryFeature({ repository: rebuiltRepository });
  const rebuiltConnector = createOrdinaryPathMemoryConnector({ ordinary, pathMemory: rebuiltFeature });
  t.after(async () => { await rebuiltConnector.release(); await rebuiltFeature.release(); });

  await rebuiltConnector.ready();
  assert.equal(await rebuiltRepository.findBySource({ feature: "ordinary", runId: "run-forgotten" }), undefined);
  assert.equal((await rebuiltRepository.list()).length, 0);
  const snapshot = rebuiltConnector.diagnostics();
  assert.equal(snapshot.reconciliation.status, "completed");
  assert.equal(snapshot.reconciliation.skippedDeleted, 1);
  assert.equal(snapshot.reconciliation.failures, 0);
});

test("diagnostics counts a superseded record as replaced", async (t) => {
  const repository = await tempRepository(t);
  const feature = createPathMemoryFeature({ repository });
  const facts = stableFactsFixture("run-revised");
  // A mutable map lets the source restate the run between notifications.
  const factsByRunId = new Map([["run-revised", facts]]);
  const ordinary = ordinaryStub({ facts: factsByRunId });
  const connector = createOrdinaryPathMemoryConnector({ ordinary, pathMemory: feature });
  t.after(async () => { await connector.release(); await feature.release(); });

  ordinary.notify("run-revised");
  await connector.ready();

  factsByRunId.set("run-revised", {
    ...facts,
    sourceRevision: facts.sourceRevision + 1,
    userMessage: "restated by the source",
  });
  ordinary.notify("run-revised");
  await connector.ready();

  const snapshot = connector.diagnostics();
  assert.equal(snapshot.realtime.captured, 1);
  assert.equal(snapshot.realtime.replaced, 1);
  assert.equal(snapshot.realtime.failures, 0);
});

test("diagnostics reports completed reconciliation with scanned count and duration", async (t) => {
  const repository = await tempRepository(t);
  const feature = createPathMemoryFeature({ repository });
  const stable = stableFactsFixture("run-recon");
  const ticks = [1000, 1500, 2000, 2500];
  let tickIndex = 0;
  const now = () => new Date(ticks[Math.min(tickIndex++, ticks.length - 1)] ?? 0);
  const ordinary = ordinaryStub({
    summaries: [
      summaryFor("run-recon", "completed"),
      summaryFor("run-live", "running"),
      summaryFor("run-recon-unstable", "cancelled"),
    ],
    facts: new Map([["run-recon", stable]]),
  });
  const connector = createOrdinaryPathMemoryConnector({ ordinary, pathMemory: feature, now });
  t.after(async () => { await connector.release(); await feature.release(); });

  await connector.ready();
  const snapshot = connector.diagnostics();
  assert.equal(snapshot.reconciliation.status, "completed");
  assert.equal(snapshot.reconciliation.scannedTerminalRuns, 2); // running summaries stay unscanned
  assert.equal(snapshot.reconciliation.captured, 1);
  assert.equal(snapshot.reconciliation.skippedUnstable, 1);
  assert.equal(typeof snapshot.reconciliation.durationMs, "number");
  assert.ok((snapshot.reconciliation.durationMs ?? -1) >= 0);
  assert.equal(snapshot.lastFailure, undefined);
});

test("diagnostics lastFailure carries source, runId, message and injected timestamp", async (t) => {
  const repository = await tempRepository(t);
  const failing: PathMemoryRepository = {
    ...repository,
    create() {
      return Promise.reject(new PathMemoryFeatureError("path_memory_repository_failure", "disk full"));
    },
  };
  const feature = createPathMemoryFeature({ repository: failing });
  const facts = stableFactsFixture("run-last-fail");
  const ordinary = ordinaryStub({ facts: new Map([["run-last-fail", facts]]) });
  const connector = createOrdinaryPathMemoryConnector({
    ordinary,
    pathMemory: feature,
    now: () => new Date("2026-07-26T09:30:00.000Z"),
  });
  t.after(async () => { await connector.release(); await feature.release(); });

  ordinary.notify("run-last-fail");
  await connector.ready();

  const snapshot = connector.diagnostics();
  assert.deepEqual(snapshot.lastFailure, {
    source: "realtime",
    runId: "run-last-fail",
    message: "disk full",
    occurredAt: "2026-07-26T09:30:00.000Z",
  });
  assert.equal(snapshot.realtime.failures, 1);
});

test("diagnostics returns detached snapshots; mutating one never leaks back", async (t) => {
  const repository = await tempRepository(t);
  const feature = createPathMemoryFeature({ repository });
  const facts = stableFactsFixture("run-snapshot");
  const ordinary = ordinaryStub({ facts: new Map([["run-snapshot", facts]]) });
  const connector = createOrdinaryPathMemoryConnector({ ordinary, pathMemory: feature });
  t.after(async () => { await connector.release(); await feature.release(); });

  ordinary.notify("run-snapshot");
  await connector.ready();

  const first = connector.diagnostics();
  (first.realtime as { captured: number }).captured = 999;
  (first.reconciliation as { scannedTerminalRuns: number }).scannedTerminalRuns = 999;

  const second = connector.diagnostics();
  assert.equal(second.realtime.captured, 1);
  assert.equal(second.reconciliation.scannedTerminalRuns, 0);
  assert.notEqual(first.realtime, second.realtime);
  assert.notEqual(first.reconciliation, second.reconciliation);
});
