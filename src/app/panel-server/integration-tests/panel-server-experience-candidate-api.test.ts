import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { closePanelServer, createPanelRequestHandler } from "../request-handler.js";
import { createPanelRuntime, type PanelRuntime } from "../runtime.js";
import { removeTemporaryTree, requestJson } from "./panel-server-test-utils.js";

test("legacy ExperienceCandidate HTTP endpoints are no longer exposed", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-experience-candidate-api-disabled-"));
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

    const list = await requestJson(baseUrl, "/api/experience-candidates");
    assert.equal(list.status, 404);
    assert.equal(list.body.error.code, "not_found");

    const propose = await requestJson(baseUrl, "/api/experience-candidates", {
      method: "POST",
      body: {
        sourcePathMemoryIds: ["path-memory:ordinary:legacy"],
        title: "legacy",
        statement: "legacy",
        appliesWhen: ["legacy"],
        confidence: "low",
      },
    });
    assert.equal(propose.status, 404);
    assert.equal(propose.body.error.code, "not_found");
  } finally {
    if (httpServer !== undefined && runtime !== undefined) {
      await closePanelServer(httpServer, runtime);
    }
    await removeTemporaryTree(directory);
  }
});
