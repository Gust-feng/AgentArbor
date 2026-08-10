import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { closePanelServer, createPanelRequestHandler } from "../request-handler.js";
import { createPanelRuntime, type PanelRuntime } from "../runtime.js";
import { removeTemporaryTree, requestJson } from "./panel-server-test-utils.js";
import { agentNoteContentVersion } from "../../agent-notes/index.js";

test("Memory Center validates an explicitly selected registered owner before managing its memories", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-memory-center-api-"));
  const server = await start(directory);
  try {
    const space = await server.runtime.spaceFeature.commands.createSpace({ title: "视频实验" });
    const workspaceRoot = path.join(directory, "workspace");
    await fs.mkdir(workspaceRoot, { recursive: true });
    const { workspace } = await server.runtime.workspaceFeature.commands.registerWorkspace({
      rootPath: workspaceRoot,
      sourceIdentity: "test:memory-center",
      title: "下载工具",
    });

    const initial = await requestJson(server.baseUrl, "/api/memory");
    assert.equal(initial.status, 200);
    assert.deepEqual(initial.body.owner, null);
    assert.deepEqual(initial.body.owners.map((owner: { readonly kind: string; readonly id?: string; readonly title?: string }) => ({
      kind: owner.kind,
      id: owner.id,
      title: owner.title,
    })), [
      { kind: "global", id: undefined, title: undefined },
      { kind: "space", id: space.id, title: "视频实验" },
      { kind: "workspace", id: workspace.id, title: "下载工具" },
    ]);

    const created = await requestJson(server.baseUrl, "/api/memory/path-dependencies", {
      method: "POST",
      body: {
        ownerKind: "space",
        ownerId: space.id,
        scope: "owner",
        title: "下载短视频的稳定方法",
        methodology: "确认来源，使用可验证入口，完成后检查文件可播放。",
        tags: ["video", "download"],
        verification: { status: "observed", evidenceRefs: [] },
      },
    });
    assert.equal(created.status, 201);
    const memoryId = created.body.result.dependency.id as string;

    const selected = await requestJson(
      server.baseUrl,
      `/api/memory?ownerKind=space&ownerId=${encodeURIComponent(space.id)}`,
    );
    assert.equal(selected.status, 200);
    assert.deepEqual(selected.body.owner, { kind: "space", id: space.id });
    assert.equal(selected.body.pathDependencies.length, 1);
    assert.equal(selected.body.pathDependencies[0].id, memoryId);
    assert.equal(selected.body.pathDependencies[0].readCount, 0);
    assert.equal(selected.body.pathDependencies[0].useCount, 0);

    const unrelated = await requestJson(server.baseUrl, "/api/memory/path-dependencies", {
      method: "POST",
      body: {
        ownerKind: "space",
        ownerId: "unregistered-space",
        scope: "owner",
        title: "不应保存",
        methodology: "这条记录不应写入。",
      },
    });
    assert.equal(unrelated.status, 404);
    assert.equal(unrelated.body.error.code, "space_not_found");

    const deleted = await requestJson(server.baseUrl, `/api/memory/path-dependencies/${encodeURIComponent(memoryId)}`, {
      method: "DELETE",
      body: { ownerKind: "space", ownerId: space.id, expectedRevision: 1 },
    });
    assert.equal(deleted.status, 200);
    const afterDelete = await requestJson(
      server.baseUrl,
      `/api/memory/path-dependencies?ownerKind=space&ownerId=${encodeURIComponent(space.id)}`,
    );
    assert.deepEqual(afterDelete.body.pathDependencies, []);
  } finally {
    await closePanelServer(server.httpServer, server.runtime).catch(() => undefined);
    await removeTemporaryTree(directory);
  }
});

test("Memory Center deletes a note body directly with a current-version check", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-memory-note-delete-api-"));
  const server = await start(directory);
  try {
    const written = await requestJson(server.baseUrl, "/api/memory/notes/global", {
      method: "PUT",
      body: {
        content: "- 这条全局记忆将直接删除。",
        expectedVersion: agentNoteContentVersion(""),
      },
    });
    assert.equal(written.status, 200);
    const deleted = await requestJson(server.baseUrl, "/api/memory/notes/global", {
      method: "DELETE",
      body: { expectedVersion: written.body.notebook.version },
    });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.notebook.content, "");
    const snapshot = await requestJson(server.baseUrl, "/api/memory");
    assert.equal(snapshot.body.globalNote.content, "");
  } finally {
    await closePanelServer(server.httpServer, server.runtime).catch(() => undefined);
    await removeTemporaryTree(directory);
  }
});

async function start(directory: string): Promise<{ readonly baseUrl: string; readonly runtime: PanelRuntime; readonly httpServer: Server }> {
  const runtime = createPanelRuntime({ configDirectory: directory, testOnlySkipInitialWorkbenchData: true });
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
