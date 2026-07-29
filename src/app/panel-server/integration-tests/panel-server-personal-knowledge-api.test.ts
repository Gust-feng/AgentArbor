import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { closePanelServer, createPanelRequestHandler } from "../request-handler.js";
import { createPanelRuntime, type PanelRuntime } from "../runtime.js";
import { removeTemporaryTree, requestJson } from "./panel-server-test-utils.js";

test("Personal Knowledge and Space references persist, open and clean up consistently", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-personal-knowledge-api-"));
  const opened: Array<{ readonly kind: "path" | "url"; readonly value: string }> = [];
  let server = await start(directory, async (target) => { opened.push(target); });
  try {
    const space = await requestJson(server.baseUrl, "/api/spaces", { method: "POST", body: { title: "学习空间" } });
    const created = await requestJson(server.baseUrl, "/api/personal-knowledge/notes", {
      method: "POST",
      body: { spaceId: space.body.space.id, title: "第一篇笔记", bodyMarkdown: "# 正文" },
    });
    assert.equal(created.status, 201);
    const noteId = created.body.note.id as string;
    const updated = await requestJson(server.baseUrl, `/api/personal-knowledge/notes/${encodeURIComponent(noteId)}`, {
      method: "PATCH",
      body: { expectedRevision: 1, bodyMarkdown: "# 更新" },
    });
    assert.equal(updated.status, 200);
    const revisions = await requestJson(
      server.baseUrl,
      `/api/personal-knowledge/notes/${encodeURIComponent(noteId)}/revisions`,
    );
    assert.deepEqual(revisions.body.revisions.map((revision: any) => ({
      revision: revision.revision,
      baseRevision: revision.baseRevision,
      operation: revision.operation,
      actor: revision.actor,
    })), [{ revision: 2, baseRevision: 1, operation: "update", actor: { kind: "user" } }, {
      revision: 1, baseRevision: undefined, operation: "create", actor: { kind: "user" },
    }]);
    const stale = await requestJson(server.baseUrl, `/api/personal-knowledge/notes/${encodeURIComponent(noteId)}`, {
      method: "PATCH",
      body: { expectedRevision: 1, title: "过期标题" },
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, "personal_note_revision_conflict");
    const searched = await requestJson(
      server.baseUrl,
      `/api/personal-knowledge/search?q=${encodeURIComponent("更新")}&limit=10`,
    );
    assert.equal(searched.status, 200);
    assert.equal(searched.body.results[0].note.id, noteId);

    const sourcePath = path.join(directory, "研究.md");
    await fs.writeFile(sourcePath, "# 托管正文", "utf8");
    const reference = await requestJson(server.baseUrl, `/api/spaces/${encodeURIComponent(space.body.space.id as string)}/references`, {
      method: "POST",
      body: { title: "研究资料", reference: { kind: "local_file", path: sourcePath } },
    });
    const referenceId = reference.body.item.id as string;
    const collected = await requestJson(server.baseUrl, "/api/personal-knowledge/collect-space-reference", {
      method: "POST",
      body: { referenceId },
    });
    assert.equal(collected.status, 201);
    const knowledgeRefId = collected.body.page.refId as string;
    const openedReference = await requestJson(server.baseUrl, `/api/spaces/references/${encodeURIComponent(referenceId)}/open`, {
      method: "POST",
      body: {},
    });
    assert.equal(openedReference.status, 200);
    assert.deepEqual(opened, [{ kind: "path", value: sourcePath }]);

    const generatedReference = await requestJson(server.baseUrl, `/api/spaces/${encodeURIComponent(space.body.space.id as string)}/references`, {
      method: "POST",
      body: { title: "生成报告", reference: { kind: "generated_artifact", artifactRef: "artifact-report" } },
    });
    const generatedOpen = await requestJson(
      server.baseUrl,
      `/api/spaces/references/${encodeURIComponent(generatedReference.body.item.id as string)}/open`,
      { method: "POST", body: {} },
    );
    assert.equal(generatedOpen.status, 409);
    assert.equal(generatedOpen.body.error.code, "space_reference_not_openable");
    assert.deepEqual(opened, [{ kind: "path", value: sourcePath }]);

    const missingReference = await requestJson(server.baseUrl, "/api/personal-knowledge/commands", {
      method: "POST",
      body: { type: "knowledge.collect", page: { refId: "missing-reference", kind: "space_reference", collectedAt: 2 } },
    });
    assert.equal(missingReference.status, 400);

    const removed = await requestJson(server.baseUrl, `/api/spaces/references/${encodeURIComponent(referenceId)}`, { method: "DELETE" });
    assert.equal(removed.status, 200);
    const afterRemoval = await requestJson(server.baseUrl, "/api/personal-knowledge");
    assert.equal(afterRemoval.body.snapshot.pages[0].refId, knowledgeRefId);

    await closePanelServer(server.httpServer, server.runtime);
    server = await start(directory);
    const snapshot = await requestJson(server.baseUrl, "/api/personal-knowledge");
    assert.equal(snapshot.body.snapshot.notes[0].bodyMarkdown, "# 更新");
    assert.equal(snapshot.body.snapshot.notes[0].revision, 2);
    assert.equal(snapshot.body.snapshot.notes[0].title, "第一篇笔记");
    assert.equal(snapshot.body.snapshot.pages[0].refId, knowledgeRefId);
    const managed = await requestJson(server.baseUrl, `/api/personal-knowledge/assets/${encodeURIComponent(knowledgeRefId)}/preview`);
    assert.equal(managed.body.preview.content.text, "# 托管正文");
    assert.equal(managed.body.preview.content.language, "md");
    const managedContent = await fetch(`${server.baseUrl}/api/personal-knowledge/assets/${encodeURIComponent(knowledgeRefId)}/content`);
    assert.equal(managedContent.headers.get("content-type"), "text/markdown; charset=utf-8");

    const restartedSearch = await requestJson(
      server.baseUrl,
      `/api/personal-knowledge/search?q=${encodeURIComponent("更新")}&limit=10`,
    );
    assert.equal(restartedSearch.body.results[0].note.id, noteId);
    const restartedSpaces = await requestJson(server.baseUrl, "/api/spaces");
    assert.equal(restartedSpaces.body.spaces[0].id, space.body.space.id);

    const deletedNote = await requestJson(server.baseUrl, `/api/personal-knowledge/notes/${encodeURIComponent(noteId)}?expectedRevision=2`, {
      method: "DELETE",
    });
    assert.equal(deletedNote.status, 200);
    const uncollected = await requestJson(server.baseUrl, "/api/personal-knowledge/commands", {
      method: "POST",
      body: { type: "knowledge.uncollect", refId: knowledgeRefId },
    });
    assert.equal(uncollected.status, 200);
    const removedAsset = await requestJson(server.baseUrl, `/api/personal-knowledge/assets/${encodeURIComponent(knowledgeRefId)}/preview`);
    assert.equal(removedAsset.status, 404);

    await closePanelServer(server.httpServer, server.runtime);
    server = await start(directory);
    const afterSecondRestart = await requestJson(server.baseUrl, "/api/personal-knowledge");
    assert.deepEqual(afterSecondRestart.body.snapshot.notes, []);
    assert.deepEqual(afterSecondRestart.body.snapshot.pages, []);
    const emptySearch = await requestJson(
      server.baseUrl,
      `/api/personal-knowledge/search?q=${encodeURIComponent("更新")}&limit=10`,
    );
    assert.deepEqual(emptySearch.body.results, []);
    const persistedTree = await requestJson(
      server.baseUrl,
      `/api/spaces/${encodeURIComponent(space.body.space.id as string)}`,
    );
    assert.equal(treeContainsItem(persistedTree.body.tree.entries, referenceId), false);
  } finally {
    await closePanelServer(server.httpServer, server.runtime).catch(() => undefined);
    await removeTemporaryTree(directory);
  }
});

function treeContainsItem(entries: readonly any[], itemId: string): boolean {
  return entries.some((entry) => entry.kind === "reference"
    ? entry.item.id === itemId
    : treeContainsItem(entry.children, itemId));
}

async function start(
  directory: string,
  externalResourceOpener?: (target: { readonly kind: "path" | "url"; readonly value: string }) => Promise<void>,
): Promise<{ readonly baseUrl: string; readonly runtime: PanelRuntime; readonly httpServer: Server }> {
  const runtime = createPanelRuntime({ configDirectory: directory, externalResourceOpener });
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
