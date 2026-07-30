import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { releasePanelRuntimeResources } from "./request-handler.js";
import { INITIAL_SPACE_ID, INITIAL_WORKBENCH_DATA_KEY } from "./initial-workbench-data.js";
import { createPanelRuntime } from "./runtime.js";

const INITIAL_MATERIAL_IDS = [
  "f1-1",
  "f2-2",
  "m-attn-pdf",
  "m-transformer-md",
  "m-loss-img",
  "m-stanford-video",
  "m-podcast-audio",
  "m-train-code",
  "m-distill-web",
  "m-inspo-img",
].sort();

test("Panel initializes the original built-in Workbench dataset exactly once", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-initial-workbench-assets-"));
  try {
    const firstRuntime = createPanelRuntime({ configDirectory: directory });
    try {
      await firstRuntime.initialWorkbenchDataReady;
      assert.equal(firstRuntime.workbenchDatabase.hasInitialization(INITIAL_WORKBENCH_DATA_KEY), true);

      const space = await firstRuntime.spaceFeature.queries.getTree(INITIAL_SPACE_ID);
      assert.equal(space?.space.title, "学习空间");
      assert.deepEqual(space?.entries, []);

      const knowledge = await firstRuntime.personalKnowledgeFeature.queries.snapshot();
      assert.deepEqual(knowledge.pages.map((page) => page.refId).sort(), INITIAL_MATERIAL_IDS);
      assert.deepEqual(knowledge.pages.map((page) => page.kind), Array(INITIAL_MATERIAL_IDS.length).fill("material"));
      assert.deepEqual(knowledge.notes, []);

      await assert.rejects(fs.access(path.join(directory, "runtime", "space-folders", INITIAL_SPACE_ID, "README.md")));
      await assert.rejects(fs.access(path.join(directory, "runtime", "space-folders", INITIAL_SPACE_ID, "学习路线.md")));
    } finally {
      await releasePanelRuntimeResources(firstRuntime);
    }

    const restartedRuntime = createPanelRuntime({ configDirectory: directory });
    try {
      await restartedRuntime.initialWorkbenchDataReady;
      const knowledge = await restartedRuntime.personalKnowledgeFeature.queries.snapshot();
      assert.deepEqual(knowledge.pages.map((page) => page.refId).sort(), INITIAL_MATERIAL_IDS);
      assert.equal((await restartedRuntime.spaceFeature.queries.list()).filter((space) => space.id === INITIAL_SPACE_ID).length, 1);
    } finally {
      await releasePanelRuntimeResources(restartedRuntime);
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
