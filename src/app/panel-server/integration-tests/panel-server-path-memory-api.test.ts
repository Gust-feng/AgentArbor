import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { closePanelServer, createPanelRequestHandler } from "../request-handler.js";
import { createPanelRuntime, type PanelRuntime } from "../runtime.js";
import { removeTemporaryTree, requestJson } from "./panel-server-test-utils.js";

test("legacy PathMemory HTTP endpoints are no longer exposed", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-path-memory-api-disabled-"));
  let runtime: PanelRuntime | undefined;
  let httpServer: Server | undefined;
  try {
    runtime = createPanelRuntime({ configDirectory: directory, testOnlySkipInitialWorkbenchData: true });
    httpServer = createServer(createPanelRequestHandler(runtime));
    await new Promise<void>((resolve, reject) => {
      httpServer?.once("error", reject);
      httpServer?.listen(0, "127.0.0.1", () => {
        httpServer?.off("error", reject);
        resolve();
      });
    });
    const address = httpServer.address();
    if (address === null || typeof address === "string") {
      throw new Error("Panel test server did not expose a TCP port");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const list = await requestJson(baseUrl, "/api/path-memory/records");
    assert.equal(list.status, 404);
    assert.equal(list.body.error.code, "not_found");

    const deletion = await requestJson(
      baseUrl,
      "/api/path-memory/records/path-memory%3Aordinary%3Alegacy",
      { method: "DELETE" },
    );
    assert.equal(deletion.status, 404);
    assert.equal(deletion.body.error.code, "not_found");
  } finally {
    if (httpServer !== undefined && runtime !== undefined) {
      await closePanelServer(httpServer, runtime);
    }
    await removeTemporaryTree(directory);
  }
});
