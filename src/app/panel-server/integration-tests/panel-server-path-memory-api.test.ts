import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { PathMemory, PathMemoryCaptureInput, PathMemoryCaptureResult } from "../../path-memory/contracts.js";
import { closePanelServer, createPanelRequestHandler } from "../request-handler.js";
import { createPanelRuntime, type PanelRuntime } from "../runtime.js";
import { removeTemporaryTree, requestJson } from "./panel-server-test-utils.js";

function captureInputFixture(
  runId: string,
  overrides: {
    readonly conversationId?: string;
    readonly workspaceRoot?: string;
    readonly terminalStatus?: "completed" | "failed";
  } = {},
): PathMemoryCaptureInput {
  const terminal = overrides.terminalStatus ?? "completed";
  return {
    source: {
      feature: "ordinary",
      runId,
      sourceRevision: 2,
      conversationId: overrides.conversationId ?? `conversation-${runId}`,
      userTurnId: `${runId}-user`,
      assistantTurnId: `${runId}-assistant`,
      runCreatedAt: "2026-07-26T09:00:00.000Z",
      terminalAt: "2026-07-26T09:00:04.000Z",
    },
    scope: {
      workspaceRoot: overrides.workspaceRoot ?? "C:/workspace/demo",
      workspaceSelection: "default",
    },
    goal: { userRequest: "检查构建", taskContextRefs: [] },
    path: {
      executionStarted: true,
      toolSteps: [{
        ordinal: 1,
        toolFactId: `${runId}-tool-1`,
        toolName: "run_command",
        status: "completed",
        durationMs: 40,
        resultRef: `ordinary-run:${runId}#tool:${runId}-tool-1`,
      }],
    },
    outcome: terminal === "completed"
      ? { terminalStatus: "completed", answerRef: `ordinary-run:${runId}#answer` }
      : { terminalStatus: "failed", error: { code: "run_failed", message: "boom" } },
    verification: { status: "not_recorded", evidenceRefs: [] },
    evidenceRefs: [`ordinary-run:${runId}`],
  };
}

function capturedMemory(result: PathMemoryCaptureResult): PathMemory {
  assert.notEqual(result.status, "suppressed");
  if (result.status === "suppressed") throw new Error("unexpected suppressed capture");
  return result.memory;
}

async function startPathMemoryTestServer(directory: string): Promise<{
  readonly baseUrl: string;
  readonly runtime: PanelRuntime;
  readonly httpServer: Server;
}> {
  const runtime = createPanelRuntime({ configDirectory: directory });
  const httpServer = createServer(createPanelRequestHandler(runtime));
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => {
      httpServer.off("error", reject);
      resolve();
    });
  });
  const address = httpServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("Panel test server did not expose a TCP port");
  }
  return { baseUrl: `http://127.0.0.1:${address.port}`, runtime, httpServer };
}

test("PathMemory list endpoint returns records with filters and validates query input", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-path-memory-api-list-"));
  const { baseUrl, runtime, httpServer } = await startPathMemoryTestServer(directory);
  try {
    await runtime.pathMemoryFeature.commands.capture(captureInputFixture("run-a"));
    await runtime.pathMemoryFeature.commands.capture(captureInputFixture("run-b", {
      conversationId: "conversation-shared",
      terminalStatus: "failed",
    }));
    await runtime.pathMemoryFeature.commands.capture(captureInputFixture("run-c", {
      conversationId: "conversation-shared",
      workspaceRoot: "C:/workspace/other",
    }));

    const all = await requestJson(baseUrl, "/api/path-memory/records");
    assert.equal(all.status, 200);
    assert.equal(all.body.ok, true);
    assert.equal(all.body.memories.length, 3);

    const byConversation = await requestJson(
      baseUrl,
      "/api/path-memory/records?conversationId=conversation-shared",
    );
    assert.equal(byConversation.status, 200);
    assert.deepEqual(
      byConversation.body.memories
        .map((memory: { source: { runId: string } }) => memory.source.runId)
        .sort(),
      ["run-b", "run-c"],
    );

    const byTerminalStatus = await requestJson(
      baseUrl,
      "/api/path-memory/records?terminalStatus=failed",
    );
    assert.equal(byTerminalStatus.status, 200);
    assert.equal(byTerminalStatus.body.memories.length, 1);
    assert.equal(byTerminalStatus.body.memories[0].source.runId, "run-b");
    assert.equal(byTerminalStatus.body.memories[0].outcome.terminalStatus, "failed");

    const byWorkspace = await requestJson(
      baseUrl,
      `/api/path-memory/records?workspaceRoot=${encodeURIComponent("C:/workspace/other")}`,
    );
    assert.equal(byWorkspace.status, 200);
    assert.deepEqual(
      byWorkspace.body.memories.map((memory: { source: { runId: string } }) => memory.source.runId),
      ["run-c"],
    );

    const limited = await requestJson(baseUrl, "/api/path-memory/records?limit=1");
    assert.equal(limited.status, 200);
    assert.equal(limited.body.memories.length, 1);

    const invalidStatus = await requestJson(
      baseUrl,
      "/api/path-memory/records?terminalStatus=exploded",
    );
    assert.equal(invalidStatus.status, 400);
    assert.equal(invalidStatus.body.error.code, "invalid_path_memory_terminal_status");

    const invalidLimit = await requestJson(baseUrl, "/api/path-memory/records?limit=zero");
    assert.equal(invalidLimit.status, 400);
    assert.equal(invalidLimit.body.error.code, "invalid_path_memory_limit");

    const negativeLimit = await requestJson(baseUrl, "/api/path-memory/records?limit=-3");
    assert.equal(negativeLimit.status, 400);
    assert.equal(negativeLimit.body.error.code, "invalid_path_memory_limit");
  } finally {
    await closePanelServer(httpServer, runtime);
    await removeTemporaryTree(directory);
  }
});

test("PathMemory search endpoint scores records and validates query input", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-path-memory-api-search-"));
  const { baseUrl, runtime, httpServer } = await startPathMemoryTestServer(directory);
  try {
    await runtime.pathMemoryFeature.commands.capture(captureInputFixture("run-s1"));
    await runtime.pathMemoryFeature.commands.capture(captureInputFixture("run-s2", {
      terminalStatus: "failed",
    }));
    await runtime.pathMemoryFeature.commands.capture(captureInputFixture("run-s3", {
      workspaceRoot: "C:/workspace/other",
    }));

    const matched = await requestJson(
      baseUrl,
      `/api/path-memory/search?q=${encodeURIComponent("构建")}`,
    );
    assert.equal(matched.status, 200);
    assert.equal(matched.body.ok, true);
    assert.equal(matched.body.results.length, 3);
    for (const result of matched.body.results) {
      assert.equal(result.score, 3);
      assert.deepEqual(result.matchedFields, ["userRequest"]);
    }

    const byStatus = await requestJson(
      baseUrl,
      `/api/path-memory/search?q=${encodeURIComponent("构建")}&terminalStatus=failed`,
    );
    assert.equal(byStatus.status, 200);
    assert.deepEqual(
      byStatus.body.results.map((result: { memory: { source: { runId: string } } }) => result.memory.source.runId),
      ["run-s2"],
    );

    const noMatch = await requestJson(baseUrl, "/api/path-memory/search?q=nomatchtoken");
    assert.equal(noMatch.status, 200);
    assert.deepEqual(noMatch.body.results, []);

    const missingQuery = await requestJson(baseUrl, "/api/path-memory/search");
    assert.equal(missingQuery.status, 400);
    assert.equal(missingQuery.body.error.code, "invalid_path_memory_search_query");

    const blankQuery = await requestJson(
      baseUrl,
      `/api/path-memory/search?q=${encodeURIComponent("   ")}`,
    );
    assert.equal(blankQuery.status, 400);
    assert.equal(blankQuery.body.error.code, "invalid_path_memory_search_query");

    const invalidStatus = await requestJson(
      baseUrl,
      `/api/path-memory/search?q=${encodeURIComponent("构建")}&terminalStatus=exploded`,
    );
    assert.equal(invalidStatus.status, 400);
    assert.equal(invalidStatus.body.error.code, "invalid_path_memory_terminal_status");

    const invalidLimit = await requestJson(
      baseUrl,
      `/api/path-memory/search?q=${encodeURIComponent("构建")}&limit=zero`,
    );
    assert.equal(invalidLimit.status, 400);
    assert.equal(invalidLimit.body.error.code, "invalid_path_memory_limit");

    const oversizedLimit = await requestJson(
      baseUrl,
      `/api/path-memory/search?q=${encodeURIComponent("构建")}&limit=101`,
    );
    assert.equal(oversizedLimit.status, 400);
    assert.equal(oversizedLimit.body.error.code, "invalid_path_memory_limit");
  } finally {
    await closePanelServer(httpServer, runtime);
    await removeTemporaryTree(directory);
  }
});

test("PathMemory get endpoint decodes colon-bearing ids and reports missing records", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-path-memory-api-get-"));
  const { baseUrl, runtime, httpServer } = await startPathMemoryTestServer(directory);
  try {
    const created = await runtime.pathMemoryFeature.commands.capture(captureInputFixture("run-get"));
    assert.equal(capturedMemory(created).id, "path-memory:ordinary:run-get");

    const found = await requestJson(
      baseUrl,
      `/api/path-memory/records/${encodeURIComponent(capturedMemory(created).id)}`,
    );
    assert.equal(found.status, 200);
    assert.equal(found.body.ok, true);
    assert.deepEqual(found.body.memory, JSON.parse(JSON.stringify(capturedMemory(created))));

    const missing = await requestJson(
      baseUrl,
      `/api/path-memory/records/${encodeURIComponent("path-memory:ordinary:missing")}`,
    );
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, "path_memory_not_found");
  } finally {
    await closePanelServer(httpServer, runtime);
    await removeTemporaryTree(directory);
  }
});

test("PathMemory diagnostics endpoint reports connector counters and record total", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-path-memory-api-diagnostics-"));
  const { baseUrl, runtime, httpServer } = await startPathMemoryTestServer(directory);
  try {
    await runtime.pathMemoryFeature.commands.capture(captureInputFixture("run-diag-a"));
    await runtime.pathMemoryFeature.commands.capture(captureInputFixture("run-diag-b", {
      terminalStatus: "failed",
    }));

    const result = await requestJson(baseUrl, "/api/path-memory/diagnostics");
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);

    const diagnostics = result.body.diagnostics;
    assert.ok(["running", "completed", "failed"].includes(diagnostics.reconciliation.status));
    assert.equal(diagnostics.records.total, 2);
    for (const key of ["captured", "existing", "skippedUnstable", "skippedDeleted", "failures"] as const) {
      assert.equal(typeof diagnostics.realtime[key], "number");
      assert.equal(typeof diagnostics.reconciliation[key], "number");
    }
    assert.equal(typeof diagnostics.reconciliation.scannedTerminalRuns, "number");
  } finally {
    await closePanelServer(httpServer, runtime);
    await removeTemporaryTree(directory);
  }
});

test("PathMemory delete endpoint removes the record exactly once", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-path-memory-api-delete-"));
  const { baseUrl, runtime, httpServer } = await startPathMemoryTestServer(directory);
  try {
    const created = await runtime.pathMemoryFeature.commands.capture(captureInputFixture("run-delete"));
    const encodedId = encodeURIComponent(capturedMemory(created).id);

    const deleted = await requestJson(baseUrl, `/api/path-memory/records/${encodedId}`, {
      method: "DELETE",
    });
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleted.body, { ok: true });

    const afterDelete = await requestJson(baseUrl, `/api/path-memory/records/${encodedId}`);
    assert.equal(afterDelete.status, 404);
    assert.equal(afterDelete.body.error.code, "path_memory_not_found");

    const repeated = await requestJson(baseUrl, `/api/path-memory/records/${encodedId}`, {
      method: "DELETE",
    });
    assert.equal(repeated.status, 404);
    assert.equal(repeated.body.error.code, "path_memory_not_found");

    const remaining = await requestJson(baseUrl, "/api/path-memory/records");
    assert.equal(remaining.body.memories.length, 0);
  } finally {
    await closePanelServer(httpServer, runtime);
    await removeTemporaryTree(directory);
  }
});
