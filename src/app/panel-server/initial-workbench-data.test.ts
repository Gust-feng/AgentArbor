import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { releasePanelRuntimeResources } from "./request-handler.js";
import {
  createInitialWorkbenchDataInitializer,
  INITIAL_SPACE_ID,
  INITIAL_WORKBENCH_DATA_KEY,
} from "./initial-workbench-data.js";
import { createPanelRuntime } from "./runtime.js";

const INITIAL_MATERIAL_IDS = [
  "f1-1",
  "f2-2",
  "m-attn-pdf",
  "m-transformer-md",
  "m-loss-img",
  "m-train-code",
  "m-distill-web",
  "m-inspo-img",
].sort();
const INITIAL_ASSET_IDS = ["f1-2", "f1-5", ...INITIAL_MATERIAL_IDS].sort();

test("Panel initializes the built-in Workbench dataset exactly once", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-initial-workbench-assets-"));
  try {
    const firstRuntime = createPanelRuntime({ configDirectory: directory });
    try {
      await firstRuntime.ensureInitialWorkbenchData();
      assert.equal(firstRuntime.workbenchDatabase.hasInitialization(INITIAL_WORKBENCH_DATA_KEY), true);

      const space = await firstRuntime.spaceFeature.queries.getTree(INITIAL_SPACE_ID);
      assert.equal(space?.space.title, "学习空间");
      assert.equal(space?.entries.length, 9);
      assert.equal(space?.entries.find((entry) => entry.item.id === "f1-1")?.item.parentId, "f1");
      assert.deepEqual(space?.entries.find((entry) => entry.item.id === "f1-1")?.item.reference, { kind: "workbench_asset", assetId: "f1-1" });
      assert.deepEqual(space?.entries.filter((entry) => entry.item.parentId === undefined).map((entry) => entry.item.id), ["f1-3", "f1", "f2-3", "f2", "f4"]);
      assert.deepEqual(space?.entries.filter((entry) => entry.item.parentId === "f1").map((entry) => entry.item.id), ["f1-1", "f1-2", "f1-5"]);
      assert.deepEqual(space?.entries.filter((entry) => entry.item.parentId === "f2").map((entry) => entry.item.id), ["f2-2"]);

      const assets = await firstRuntime.workbenchAssets.list();
      assert.deepEqual(assets.map((asset) => asset.id).sort(), INITIAL_ASSET_IDS);
      assert.match(assets.find((asset) => asset.id === "m-train-code")?.code?.source ?? "", /import torch/u);

      const knowledge = await firstRuntime.personalKnowledgeFeature.queries.snapshot();
      assert.deepEqual(knowledge.pages.map((page) => page.refId).sort(), INITIAL_MATERIAL_IDS);
      assert.deepEqual(knowledge.pages.map((page) => page.kind), Array(INITIAL_MATERIAL_IDS.length).fill("material"));
      assert.deepEqual(knowledge.notes, []);
      assert.deepEqual(knowledge.themes.map(({ id, name, origin }) => ({ id, name, origin })), [
        { id: "t-inspo", name: "灵感与杂谈", origin: "agent" },
        { id: "t-method", name: "读书与方法", origin: "agent" },
        { id: "t-training", name: "训练与实践", origin: "agent" },
        { id: "t-transformer", name: "Transformer", origin: "agent" },
      ]);
      assert.equal(knowledge.assignments.length, 10);
      assert.deepEqual(
        INITIAL_MATERIAL_IDS.filter((refId) => !knowledge.assignments.some((assignment) => assignment.refId === refId)),
        [],
      );
      assert.equal(knowledge.assignments.every((assignment) => assignment.by === "agent" && !assignment.locked), true);
      assert.deepEqual(knowledge.links.map(({ from, to }) => ({ from, to })), [
        { from: "m-loss-img", to: "f1-1" },
        { from: "m-train-code", to: "m-attn-pdf" },
        { from: "m-transformer-md", to: "f2-2" },
        { from: "m-transformer-md", to: "m-attn-pdf" },
      ]);

      await assert.rejects(fs.access(path.join(directory, "runtime", "space-folders", INITIAL_SPACE_ID, "README.md")));
      await assert.rejects(fs.access(path.join(directory, "runtime", "space-folders", INITIAL_SPACE_ID, "学习路线.md")));
    } finally {
      await releasePanelRuntimeResources(firstRuntime);
    }

    const restartedRuntime = createPanelRuntime({ configDirectory: directory });
    try {
      await restartedRuntime.ensureInitialWorkbenchData();
      const knowledge = await restartedRuntime.personalKnowledgeFeature.queries.snapshot();
      assert.deepEqual(knowledge.pages.map((page) => page.refId).sort(), INITIAL_MATERIAL_IDS);
      assert.equal(knowledge.themes.length, 4);
      assert.equal(knowledge.assignments.length, 10);
      assert.equal(knowledge.links.length, 4);
      assert.equal((await restartedRuntime.spaceFeature.queries.list()).filter((space) => space.id === INITIAL_SPACE_ID).length, 1);
      assert.equal((await restartedRuntime.spaceFeature.queries.getTree(INITIAL_SPACE_ID))?.entries.length, 9);
      assert.equal((await restartedRuntime.workbenchAssets.list()).length, 10);
    } finally {
      await releasePanelRuntimeResources(restartedRuntime);
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("Initial Workbench data retries after a failed in-process attempt", async () => {
  let attempts = 0;
  const initializer = createInitialWorkbenchDataInitializer(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("transient initialization failure");
  });

  await assert.rejects(initializer.ensure(), /transient initialization failure/u);
  await initializer.ensure();
  await initializer.ensure();
  assert.equal(attempts, 2);
});
