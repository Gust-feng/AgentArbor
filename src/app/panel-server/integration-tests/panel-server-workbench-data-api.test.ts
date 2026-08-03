import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { closePanelServer, createPanelRequestHandler, startLocalPanelServer } from "../request-handler.js";
import { createPanelRuntime } from "../runtime.js";
import { removeTemporaryTree, requestJson } from "./panel-server-test-utils.js";

test("Workbench data API reports health and creates a verified backup", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-workbench-data-api-"));
  const runtime = createPanelRuntime({ configDirectory: directory, testOnlySkipInitialWorkbenchData: true });
  await runtime.spaceFeature.ready();
  const server = createServer(createPanelRequestHandler(runtime));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Panel test server did not expose a TCP port");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const health = await requestJson(baseUrl, "/api/workbench-data/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.health.ok, true);

    const backup = await requestJson(baseUrl, "/api/workbench-data/backups", { method: "POST", body: {} });
    assert.equal(backup.status, 201);
    assert.equal(await fs.stat(backup.body.backup.filePath as string).then((value) => value.size > 0), true);

    const runtimeHome = runtime.runtimePaths?.runtimeHome;
    assert.ok(runtimeHome);
    const journalRoot = path.join(runtimeHome, "space-reference-deletions");
    const pendingJournal = path.join(journalRoot, "pending.json");
    await fs.mkdir(journalRoot, { recursive: true });
    await fs.writeFile(pendingJournal, "{}", "utf8");
    const blockedBackup = await requestJson(baseUrl, "/api/workbench-data/backups", { method: "POST", body: {} });
    assert.equal(blockedBackup.status, 500);
    assert.equal(blockedBackup.body.error.code, "data_maintenance_failed");
    await fs.rm(pendingJournal);

    const unavailable = await requestJson(baseUrl, "/api/workbench-data/restore/select", { method: "POST", body: {} });
    assert.equal(unavailable.status, 501);
    assert.equal(unavailable.body.error.code, "restore_picker_unavailable");
  } finally {
    await closePanelServer(server, runtime);
    await removeTemporaryTree(directory);
  }
});

test("Workbench restore staging quiesces the current Panel before the pending bundle is applied", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-workbench-restore-quiesce-"));
  let selectedBackupPath: string | undefined;
  let server: Awaited<ReturnType<typeof startLocalPanelServer>> | undefined;
  let restarted: Awaited<ReturnType<typeof startLocalPanelServer>> | undefined;
  try {
    server = await startLocalPanelServer({
      port: 0,
      configDirectory: directory,
      testOnlySkipInitialWorkbenchData: true,
      workbenchRestorePicker: async () => selectedBackupPath,
    });
    const backup = await requestJson(server.url, "/api/workbench-data/backups", { method: "POST", body: {} });
    assert.equal(backup.status, 201);
    selectedBackupPath = backup.body.backup.filePath as string;

    const staged = await requestJson(server.url, "/api/workbench-data/restore/select", { method: "POST", body: {} });
    assert.equal(staged.status, 200);
    assert.equal(staged.body.result.status, "staged");
    assert.equal(staged.body.result.restartRequired, true);

    const rejected = await requestJson(server.url, "/api/spaces");
    assert.equal(rejected.status, 503);
    assert.equal(rejected.body.error.code, "panel_runtime_quiescing");
    await server.close();
    server = undefined;

    restarted = await startLocalPanelServer({
      port: 0,
      configDirectory: directory,
      testOnlySkipInitialWorkbenchData: true,
    });
    const health = await requestJson(restarted.url, "/api/workbench-data/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.health.pendingRestore, false);
  } finally {
    await restarted?.close().catch(() => undefined);
    await server?.close().catch(() => undefined);
    await removeTemporaryTree(directory);
  }
});
