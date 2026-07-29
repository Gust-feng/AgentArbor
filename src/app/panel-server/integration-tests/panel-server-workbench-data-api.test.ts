import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { closePanelServer, createPanelRequestHandler } from "../request-handler.js";
import { createPanelRuntime } from "../runtime.js";
import { removeTemporaryTree, requestJson } from "./panel-server-test-utils.js";

test("Workbench data API reports health and creates a verified backup", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-workbench-data-api-"));
  const runtime = createPanelRuntime({ configDirectory: directory });
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

    const unavailable = await requestJson(baseUrl, "/api/workbench-data/restore/select", { method: "POST", body: {} });
    assert.equal(unavailable.status, 501);
    assert.equal(unavailable.body.error.code, "restore_picker_unavailable");
  } finally {
    await closePanelServer(server, runtime);
    await removeTemporaryTree(directory);
  }
});
