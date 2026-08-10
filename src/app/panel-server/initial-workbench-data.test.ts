import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { releasePanelRuntimeResources } from "./request-handler.js";
import {
  createInitialWorkbenchDataInitializer,
  INITIAL_DEMO_DATA_KEY,
  INITIAL_SPACE_ID,
  INITIAL_WORKBENCH_DATA_KEY,
} from "./initial-workbench-data.js";
import { createPanelRuntime } from "./runtime.js";

test("Panel 首次启动只创建一个普通的我的空间", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-initial-space-"));
  try {
    const firstRuntime = createPanelRuntime({ configDirectory: directory });
    try {
      await firstRuntime.ensureInitialWorkbenchData();
      assert.equal(firstRuntime.workbenchDatabase.hasInitialization(INITIAL_WORKBENCH_DATA_KEY), true);
      assert.equal(firstRuntime.workbenchDatabase.hasInitialization(INITIAL_DEMO_DATA_KEY), false);

      const space = await firstRuntime.spaceFeature.queries.getTree(INITIAL_SPACE_ID);
      assert.equal(space?.space.title, "我的空间");
      assert.deepEqual(space?.entries, []);
      assert.deepEqual((await firstRuntime.spaceFeature.queries.list()).map(({ id, title }) => ({ id, title })), [
        { id: INITIAL_SPACE_ID, title: "我的空间" },
      ]);
      await fs.access(path.join(directory, "runtime", "spaces", INITIAL_SPACE_ID, "files"));
      assert.deepEqual(await firstRuntime.workbenchAssets.list(), []);
      const knowledge = await firstRuntime.personalKnowledgeFeature.queries.snapshot();
      assert.deepEqual(knowledge.pages, []);
      assert.deepEqual(knowledge.notes, []);
      assert.deepEqual(knowledge.themes, []);
      assert.deepEqual(knowledge.assignments, []);
      assert.deepEqual(knowledge.links, []);
    } finally {
      await releasePanelRuntimeResources(firstRuntime);
    }

    const restartedRuntime = createPanelRuntime({ configDirectory: directory });
    try {
      await restartedRuntime.ensureInitialWorkbenchData();
      assert.equal((await restartedRuntime.spaceFeature.queries.list()).length, 1);
      assert.deepEqual((await restartedRuntime.spaceFeature.queries.getTree(INITIAL_SPACE_ID))?.entries, []);
      assert.deepEqual(await restartedRuntime.workbenchAssets.list(), []);
    } finally {
      await releasePanelRuntimeResources(restartedRuntime);
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("示例数据只有显式测试开关才会导入", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-initial-demo-"));
  try {
    const runtime = createPanelRuntime({
      configDirectory: directory,
      testOnlySeedInitialWorkbenchDemoData: true,
    });
    try {
      await runtime.ensureInitialWorkbenchData();
      assert.equal(runtime.workbenchDatabase.hasInitialization(INITIAL_DEMO_DATA_KEY), true);
      assert.equal((await runtime.spaceFeature.queries.getTree("space-learning"))?.entries.length, 9);
      assert.equal((await runtime.workbenchAssets.list()).length, 10);
      assert.equal((await runtime.personalKnowledgeFeature.queries.snapshot()).pages.length, 8);
    } finally {
      await releasePanelRuntimeResources(runtime);
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
