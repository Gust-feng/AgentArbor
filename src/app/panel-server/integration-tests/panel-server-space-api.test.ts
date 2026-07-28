import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { closePanelServer, createPanelRequestHandler } from "../request-handler.js";
import { createPanelRuntime, type PanelRuntime } from "../runtime.js";
import { removeTemporaryTree, requestJson } from "./panel-server-test-utils.js";

async function startSpaceTestServer(directory: string): Promise<{
  readonly baseUrl: string;
  readonly runtime: PanelRuntime;
  readonly httpServer: Server;
}> {
  const runtime = createPanelRuntime({ configDirectory: directory });
  const httpServer = createServer(createPanelRequestHandler(runtime));
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => {
      httpServer.off("error", reject);
      resolve();
    });
  });
  const address = httpServer.address();
  if (address === null || typeof address === "string") throw new Error("Panel test server did not expose a TCP port");
  return { baseUrl: `http://127.0.0.1:${address.port}`, runtime, httpServer };
}

test("Space API organizes reference metadata without altering the referenced conversation", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-api-"));
  const { baseUrl, runtime, httpServer } = await startSpaceTestServer(directory);
  try {
    const created = await requestJson(baseUrl, "/api/spaces", { method: "POST", body: { title: "研究" } });
    assert.equal(created.status, 201);
    const spaceId = created.body.space.id as string;

    const folder = await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(spaceId)}/folders`, {
      method: "POST",
      body: { title: "材料" },
    });
    assert.equal(folder.status, 201);

    const reference = await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(spaceId)}/references`, {
      method: "POST",
      body: {
        parentFolderId: folder.body.folder.id,
        title: "架构讨论",
        reference: { kind: "conversation", conversationId: "ordinary-conversation-1", conversationTitle: "架构讨论" },
      },
    });
    assert.equal(reference.status, 201);

    const tree = await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(spaceId)}`);
    assert.equal(tree.status, 200);
    assert.equal(tree.body.tree.entries[0].kind, "folder");
    assert.equal(tree.body.tree.entries[0].children[0].item.reference.conversationId, "ordinary-conversation-1");

    const removed = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(reference.body.item.id)}`, { method: "DELETE" });
    assert.equal(removed.status, 200);
    const afterRemoval = await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(spaceId)}`);
    assert.equal(afterRemoval.body.tree.entries[0].children.length, 0);
    // Space removal is strictly metadata-only: the feature never consults or deletes Ordinary state.
    assert.equal((await runtime.ordinaryAgentFeature.queries.listConversations()).length, 0);
  } finally {
    await closePanelServer(httpServer, runtime);
    await removeTemporaryTree(directory);
  }
});

test("Space API rejects malformed references and reports missing entries", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-api-errors-"));
  const { baseUrl, runtime, httpServer } = await startSpaceTestServer(directory);
  try {
    const created = await requestJson(baseUrl, "/api/spaces", { method: "POST", body: { title: "收集" } });
    const invalid = await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(created.body.space.id as string)}/references`, {
      method: "POST",
      body: { title: "坏链接", reference: { kind: "web_page", url: "not a URL" } },
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, "invalid_space_input");

    const missing = await requestJson(baseUrl, "/api/spaces/references/not-present", { method: "DELETE" });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, "space_reference_not_found");
  } finally {
    await closePanelServer(httpServer, runtime);
    await removeTemporaryTree(directory);
  }
});

test("Space API validates the source Space when moving an entry", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-api-move-"));
  const { baseUrl, runtime, httpServer } = await startSpaceTestServer(directory);
  try {
    const source = await requestJson(baseUrl, "/api/spaces", { method: "POST", body: { title: "来源" } });
    const destination = await requestJson(baseUrl, "/api/spaces", { method: "POST", body: { title: "目标" } });
    const sourceId = source.body.space.id as string;
    const destinationId = destination.body.space.id as string;
    const folder = await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(sourceId)}/folders`, {
      method: "POST",
      body: { title: "待移动" },
    });
    const target = { kind: "folder", id: folder.body.folder.id as string };

    const wrongSource = await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(destinationId)}/move`, {
      method: "POST",
      body: { target, destinationSpaceId: destinationId },
    });
    assert.equal(wrongSource.status, 409);
    assert.equal(wrongSource.body.error.code, "space_invalid_move");

    const moved = await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(sourceId)}/move`, {
      method: "POST",
      body: { target, destinationSpaceId: destinationId },
    });
    assert.equal(moved.status, 200);
  } finally {
    await closePanelServer(httpServer, runtime);
    await removeTemporaryTree(directory);
  }
});
