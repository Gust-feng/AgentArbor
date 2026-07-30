import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPanelRuntime } from "./runtime.js";

test("Panel composition keeps Host-owned tool evidence readable after runtime recreation", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-tool-evidence-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const first = createPanelRuntime({ configDirectory: directory, testOnlySkipInitialWorkbenchData: true });
  const retained = await first.toolOutputStore.retain({
    mediaType: "text/plain",
    content: "durable panel evidence",
    sourceToolName: "fixture_tool",
    sourceCallId: "call-panel-evidence",
    ownerId: "ordinary-run-evidence",
  });
  assert.equal(retained.availability, "durable");
  await first.ordinaryAgentFeature.release();
  await first.toolOutputStore.close?.();

  const restarted = createPanelRuntime({ configDirectory: directory, testOnlySkipInitialWorkbenchData: true });
  try {
    const restored = await restarted.toolOutputStore.read(retained.ref, { startChar: 0, maxChars: 100 });
    assert.equal(restored?.content, "durable panel evidence");
    assert.equal(restored?.availability, "durable");
  } finally {
    await restarted.ordinaryAgentFeature.release();
    await restarted.toolOutputStore.clear();
  }
});
