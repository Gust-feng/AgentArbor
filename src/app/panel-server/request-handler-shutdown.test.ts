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
    multiAgentFeature: {
      async dispose() { disposalOrder.push("multi-agent"); },
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
  assert.deepEqual(disposalOrder.sort(), ["multi-agent", "ordinary"]);
  assert.equal(processCleanupCount, 1);
  assert.equal(await outputStore.read(retained.ref, { startChar: 0, maxChars: 64 }), undefined);
});
