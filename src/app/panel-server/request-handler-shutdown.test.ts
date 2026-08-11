import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { InMemoryToolOutputStore } from "../tool-center/tool-output-store.js";
import { closePanelServer } from "./request-handler.js";
import type { PanelRuntime } from "./runtime.js";

test("Panel shutdown clears Host-owned retained tool output after feature disposal", async () => {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const outputStore = new InMemoryToolOutputStore();
  const retained = await outputStore.retain({
    mediaType: "text/plain",
    content: "retained until host shutdown",
    sourceToolName: "fixture_tool",
    sourceCallId: "fixture-call",
    ownerId: "ordinary-run",
  });
  const disposalOrder: string[] = [];
  let processCleanupCount = 0;
  const runtime = {
    isQuiescing: false,
    activeRequestJobs: new Set<Promise<void>>(),
    ordinaryAgentFeature: {
      async release() { disposalOrder.push("ordinary"); },
    },
    pathDependencyFeature: {
      async release() { disposalOrder.push("path-dependencies"); },
    },
    releaseWorkbenchProjectionChanges() {
      disposalOrder.push("projection-changes");
    },
    async flushSpaceProcessCleanup() {
      disposalOrder.push("space-process-cleanup");
    },
    async flushSpaceKnowledgeSync() {
      disposalOrder.push("space-knowledge-sync");
    },
    personalKnowledgeFeature: {
      async release() { disposalOrder.push("personal-knowledge"); },
    },
    spaceFeature: {
      async release() { disposalOrder.push("space"); },
    },
    workbenchDatabase: {
      close() { disposalOrder.push("workbench-database"); },
    },
    async releaseAgentSessionStorage() {
      disposalOrder.push("session-storage");
    },
    processRegistry: {
      async cleanupOwnedProcesses() {
        processCleanupCount += 1;
        return undefined;
      },
    },
    processTerminator: {},
    toolOutputStore: outputStore,
  } as unknown as PanelRuntime;

  await closePanelServer(server, runtime);

  assert.equal(runtime.isQuiescing, true);
  assert.deepEqual(disposalOrder, [
    "ordinary",
    "space-process-cleanup",
    "path-dependencies",
    "projection-changes",
    "space-knowledge-sync",
    "personal-knowledge",
    "space",
    "workbench-database",
    "session-storage",
  ]);
  assert.equal(disposalOrder.at(-1), "session-storage");
  assert.equal(processCleanupCount, 1);
  assert.equal(await outputStore.read(retained.ref, { startChar: 0, maxChars: 64 }), undefined);
});

test("Panel shutdown preserves active requests beyond the short drain window", async () => {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  let releaseActiveRequest!: () => void;
  const activeRequest = new Promise<void>((resolve) => {
    releaseActiveRequest = resolve;
  });
  const activeRequestJobs = new Set<Promise<void>>();
  const trackedRequest = activeRequest.finally(() => {
    activeRequestJobs.delete(trackedRequest);
  });
  activeRequestJobs.add(trackedRequest);
  const outputStore = new InMemoryToolOutputStore();
  const runtime = {
    isQuiescing: false,
    activeRequestJobs,
    ordinaryAgentFeature: { async release() {} },
    pathDependencyFeature: { async release() {} },
    releaseWorkbenchProjectionChanges() {},
    async flushSpaceProcessCleanup() {},
    async flushSpaceKnowledgeSync() {},
    personalKnowledgeFeature: { async release() {} },
    spaceFeature: { async release() {} },
    workbenchDatabase: { close() {} },
    async releaseAgentSessionStorage() {},
    processRegistry: { async cleanupOwnedProcesses() { return undefined; } },
    processTerminator: {},
    toolOutputStore: outputStore,
  } as unknown as PanelRuntime;
  const originalCloseIdleConnections = server.closeIdleConnections.bind(server);
  const originalCloseAllConnections = server.closeAllConnections.bind(server);
  let idleConnectionsClosed!: () => void;
  const idleConnectionsClosedPromise = new Promise<void>((resolve) => {
    idleConnectionsClosed = resolve;
  });
  let closeIdleConnectionsCount = 0;
  let closeAllConnectionsCount = 0;
  server.closeIdleConnections = () => {
    closeIdleConnectionsCount += 1;
    originalCloseIdleConnections();
    // Node closes already-idle sockets when server.close() begins. The second
    // call is the explicit short-drain action for the still-active request.
    if (closeIdleConnectionsCount === 2) idleConnectionsClosed();
  };
  server.closeAllConnections = () => {
    closeAllConnectionsCount += 1;
    originalCloseAllConnections();
  };

  const closing = closePanelServer(server, runtime);
  await idleConnectionsClosedPromise;
  assert.equal(closeIdleConnectionsCount, 2);
  assert.equal(closeAllConnectionsCount, 0);
  assert.equal(activeRequestJobs.size, 1);

  releaseActiveRequest();
  await closing;

  assert.equal(activeRequestJobs.size, 0);
  assert.equal(closeAllConnectionsCount, 1);
});
