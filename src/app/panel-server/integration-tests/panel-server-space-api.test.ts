import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SqliteRuntimeDatabase } from "../../../adapters/runtime-storage/index.js";
import { createSqlitePersonalKnowledgeRepository } from "../../personal-knowledge/index.js";
import {
  SPACE_TREE_SCHEMA_VERSION,
  createFileSystemSpaceReferenceDeletionJournal,
  createSqliteSpaceRepository,
  SpaceFeatureError,
  type SpaceReferenceItem,
} from "../../spaces/index.js";
import { closePanelServer, createPanelRequestHandler, startLocalPanelServer } from "../request-handler.js";
import { createPanelRuntime, type PanelRuntime } from "../runtime.js";
import { readSseUntil, removeTemporaryTree, requestJson } from "./panel-server-test-utils.js";

async function startSpaceTestServer(directory: string): Promise<{
  readonly baseUrl: string;
  readonly runtime: PanelRuntime;
  readonly httpServer: Server;
}> {
  const runtime = createPanelRuntime({ configDirectory: directory, testOnlySkipInitialWorkbenchData: true });
  await runtime.spaceFeature.ready();
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

test("Panel streams feature and filesystem invalidations for Agent-side mutations", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-projection-change-stream-"));
  const { baseUrl, runtime, httpServer } = await startSpaceTestServer(directory);
  try {
    const cursor = runtime.workbenchProjectionChanges.replay().cursor;
    const space = await runtime.spaceFeature.commands.createSpace({ title: "Agent 空间" });
    const reference = await runtime.spaceFeature.commands.addReference({
      spaceId: space.id,
      title: "Agent 资料",
      reference: { kind: "web_page", url: "https://example.com/agent" },
    });
    const note = await runtime.personalKnowledgeFeature.commands.createNote({
      spaceId: space.id,
      title: "Agent 笔记",
    });
    await runtime.personalKnowledgeFeature.commands.deleteNote({ id: note.id, expectedRevision: 1 });
    await runtime.fileMutationCoordinator.run(path.join(directory, "mounted", "created.md"), async () => undefined);

    const streamed = await readSseUntil(
      baseUrl,
      `/api/workbench/projection-changes?cursor=${cursor}`,
      (events) => events.length >= 5,
    );
    assert.equal(streamed.status, 200);
    assert.match(String(streamed.headers["content-type"]), /^text\/event-stream/u);
    assert.equal(streamed.events.some((event) => event.owners?.includes("spaces") && event.referenceIds?.includes(reference.id)), true);
    assert.equal(streamed.events.some((event) => event.owners?.includes("personal_knowledge") && event.noteIds?.includes(note.id)), true);
    assert.equal(streamed.events.some((event) => event.owners?.includes("mounted_files")), true);
  } finally {
    await closePanelServer(httpServer, runtime);
    await removeTemporaryTree(directory);
  }
});

test("Space API exposes Conversation ownership created by the conversation workflow", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-api-"));
  const { baseUrl, runtime, httpServer } = await startSpaceTestServer(directory);
  try {
    const created = await requestJson(baseUrl, "/api/spaces", { method: "POST", body: { title: "研究" } });
    assert.equal(created.status, 201);
    const spaceId = created.body.space.id as string;

    const createdConversation = await requestJson(baseUrl, "/api/conversations", {
      method: "POST",
      body: { goal: "架构讨论", submissionId: "ordinary-conversation-1", spaceId },
    });
    assert.equal(createdConversation.status, 202);
    const conversationId = createdConversation.body.conversation.conversationId as string;

    const tree = await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(spaceId)}`);
    assert.equal(tree.status, 200);
    assert.equal(tree.body.tree.entries[0].kind, "reference");
    assert.equal(tree.body.tree.entries[0].item.reference.conversationId, conversationId);

    const deleted = await requestJson(baseUrl, `/api/conversations/${encodeURIComponent(conversationId)}`, { method: "DELETE" });
    assert.equal(deleted.status, 200);
    assert.equal((await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(spaceId)}`)).body.tree.entries.length, 0);
    assert.equal((await runtime.ordinaryAgentFeature.queries.listConversations()).length, 0);
  } finally {
    await closePanelServer(httpServer, runtime);
    await removeTemporaryTree(directory);
  }
});

test("Space API deletes a Space and its links without deleting referenced sources", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-delete-api-"));
  const { baseUrl, runtime, httpServer } = await startSpaceTestServer(directory);
  try {
    const created = await requestJson(baseUrl, "/api/spaces", { method: "POST", body: { title: "临时空间" } });
    const spaceId = created.body.space.id as string;
    const createdConversation = await requestJson(baseUrl, "/api/conversations", {
      method: "POST",
      body: { goal: "保留的讨论", submissionId: "ordinary-conversation-delete", spaceId },
    });
    assert.equal(createdConversation.status, 202);

    const removed = await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(spaceId)}`, { method: "DELETE" });
    assert.equal(removed.status, 200);
    const spaces = await requestJson(baseUrl, "/api/spaces");
    assert.equal((spaces.body.spaces as Array<{ id: string }>).some((space) => space.id === spaceId), false);
    assert.equal((await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(spaceId)}`)).status, 404);
    assert.equal((await runtime.ordinaryAgentFeature.queries.listConversations()).length, 0);
    assert.equal((await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(spaceId)}`, { method: "DELETE" })).status, 404);
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

test("Space API creates and physically deletes app-owned folders and files", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-managed-folder-"));
  const { baseUrl, runtime, httpServer } = await startSpaceTestServer(directory);
  try {
    const created = await requestJson(baseUrl, "/api/spaces", { method: "POST", body: { title: "本地资料" } });
    const spaceId = created.body.space.id as string;
    const folder = await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(spaceId)}/managed-folders`, {
      method: "POST",
      body: { title: "我的文件" },
    });
    assert.equal(folder.status, 201);
    assert.equal(folder.body.item.reference.kind, "managed_folder");
    const orderedTree = await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(spaceId)}`);
    assert.deepEqual(orderedTree.body.tree.entries.map((entry: { readonly item: { readonly title: string } }) => entry.item.title), ["我的文件"]);
    const itemId = folder.body.item.id as string;
    const folderPath = folder.body.item.reference.path as string;
    assert.equal(await fs.stat(folderPath).then((stat) => stat.isDirectory()), true);

    const file = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(itemId)}/entry`, {
      method: "POST",
      body: { parentRelativePath: "", name: "draft.md", kind: "file" },
    });
    assert.equal(file.status, 201);
    assert.equal(await fs.readFile(path.join(folderPath, "draft.md"), "utf8"), "");

    const deletedFile = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(itemId)}/entry`, {
      method: "DELETE",
      body: { relativePath: "draft.md" },
    });
    assert.equal(deletedFile.status, 200);
    assert.equal(await fs.stat(path.join(folderPath, "draft.md")).then(() => true, () => false), false);

    const deletedFolder = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(itemId)}`, { method: "DELETE" });
    assert.equal(deletedFolder.status, 200);
    assert.equal(await fs.stat(folderPath).then(() => true, () => false), false);
    assert.deepEqual((await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(spaceId)}`)).body.tree.entries, []);
  } finally {
    await closePanelServer(httpServer, runtime);
    await removeTemporaryTree(directory);
  }
});

test("Space API only unlinks external files and folders without deleting sources", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-delete-reference-"));
  const linkedFile = path.join(directory, "linked.md");
  const linkedFolder = path.join(directory, "linked-folder");
  await fs.writeFile(linkedFile, "delete me", "utf8");
  await fs.mkdir(linkedFolder);
  const { baseUrl, runtime, httpServer } = await startSpaceTestServer(directory);
  try {
    const created = await requestJson(baseUrl, "/api/spaces", { method: "POST", body: { title: "文件删除" } });
    const spaceId = created.body.space.id as string;
    const fileReference = await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(spaceId)}/references`, {
      method: "POST",
      body: { title: "linked.md", reference: { kind: "local_file", path: linkedFile } },
    });

    const unlinkedFile = await requestJson(
      baseUrl,
      `/api/spaces/references/${encodeURIComponent(fileReference.body.item.id as string)}/unlink`,
      { method: "POST", body: {} },
    );
    assert.equal(unlinkedFile.status, 200);
    assert.equal(await fs.readFile(linkedFile, "utf8"), "delete me");

    const deletableFileReference = await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(spaceId)}/references`, {
      method: "POST",
      body: { title: "linked.md", reference: { kind: "local_file", path: linkedFile } },
    });
    const folderReference = await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(spaceId)}/references`, {
      method: "POST",
      body: { title: "linked-folder", reference: { kind: "workspace_folder", path: linkedFolder } },
    });

    const rejectedDelete = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(deletableFileReference.body.item.id as string)}`, { method: "DELETE" });
    assert.equal(rejectedDelete.status, 409);
    assert.equal(await fs.readFile(linkedFile, "utf8"), "delete me");
    const unlinkedAgain = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(deletableFileReference.body.item.id as string)}/unlink`, { method: "POST", body: {} });
    assert.equal(unlinkedAgain.status, 200);
    assert.equal(await fs.readFile(linkedFile, "utf8"), "delete me");

    const staleFileReference = await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(spaceId)}/references`, {
      method: "POST",
      body: { title: "already-missing.md", reference: { kind: "local_file", path: path.join(directory, "already-missing.md") } },
    });
    assert.equal(staleFileReference.status, 400);
    assert.equal(staleFileReference.body.error.code, "space_invalid_input");

    const unlinkedFolder = await requestJson(
      baseUrl,
      `/api/spaces/references/${encodeURIComponent(folderReference.body.item.id as string)}/unlink`,
      { method: "POST", body: {} },
    );
    assert.equal(unlinkedFolder.status, 200);
    assert.equal(await fs.stat(linkedFolder).then((stat) => stat.isDirectory(), () => false), true);
  } finally {
    await closePanelServer(httpServer, runtime);
    await removeTemporaryTree(directory);
  }
});

test("Panel startup restores staged Space content when deletion metadata was not committed", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-recover-uncommitted-"));
  const sourcePath = path.join(directory, "outside", "note.md");
  await fs.mkdir(path.dirname(sourcePath), { recursive: true });
  await fs.writeFile(sourcePath, "original", "utf8");
  const first = await startSpaceTestServer(directory);
  let firstClosed = false;
  let restarted: Awaited<ReturnType<typeof startLocalPanelServer>> | undefined;
  try {
    const created = await requestJson(first.baseUrl, "/api/spaces", { method: "POST", body: { title: "恢复" } });
    const spaceId = created.body.space.id as string;
    const linked = await requestJson(first.baseUrl, `/api/spaces/${encodeURIComponent(spaceId)}/references`, {
      method: "POST",
      body: { title: "note.md", reference: { kind: "local_file", path: sourcePath } },
    });
    const item = linked.body.item as SpaceReferenceItem;
    const staged = await stageSpaceDeletionCrash(first.runtime, item, "restart-uncommitted");

    await closePanelServer(first.httpServer, first.runtime);
    firstClosed = true;
    restarted = await startLocalPanelServer({
      port: 0,
      configDirectory: directory,
      testOnlySkipInitialWorkbenchData: true,
    });

    assert.equal(await fs.readFile(sourcePath, "utf8"), "original");
    assert.equal(await pathExists(staged.stagedPath), false);
    assert.deepEqual(await staged.journal.list(), []);
    const tree = await requestJson(restarted.url, `/api/spaces/${encodeURIComponent(spaceId)}`);
    assert.equal(tree.status, 200);
    assert.equal(
      (tree.body.tree.entries as Array<{ item: { id: string } }>).some((entry) => entry.item.id === item.id),
      true,
    );
  } finally {
    await restarted?.close().catch(() => undefined);
    if (!firstClosed) await closePanelServer(first.httpServer, first.runtime).catch(() => undefined);
    await removeTemporaryTree(directory);
  }
});

test("Panel resolves an old Space deletion before applying a pending Workbench restore", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-before-workbench-restore-"));
  const runtimeHome = path.join(directory, "runtime");
  const sourcePath = path.join(directory, "outside", "note.md");
  const deletionId = "before-workbench-restore";
  const stagedPath = path.join(
    path.dirname(sourcePath),
    `.${path.basename(sourcePath)}.agentarbor-delete-${deletionId}-0`,
  );
  const createdAt = "2026-08-03T00:00:00.000Z";
  const item: SpaceReferenceItem = {
    id: "old-reference",
    spaceId: "old-space",
    title: "note.md",
    reference: { kind: "local_file", path: sourcePath },
    createdAt,
    updatedAt: createdAt,
  };
  let restarted: Awaited<ReturnType<typeof startLocalPanelServer>> | undefined;
  try {
    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.writeFile(sourcePath, "old generation content", "utf8");
    const current = new SqliteRuntimeDatabase(path.join(runtimeHome, "workbench.sqlite3"));
    const currentSpaces = createSqliteSpaceRepository(current);
    createSqlitePersonalKnowledgeRepository(current);
    await currentSpaces.write({
      schemaVersion: SPACE_TREE_SCHEMA_VERSION,
      spaces: [{ id: "old-space", title: "Old generation", createdAt, updatedAt: createdAt }],
      referenceItems: [item],
    });
    current.close();

    await fs.rename(sourcePath, stagedPath);
    const journal = createFileSystemSpaceReferenceDeletionJournal(
      path.join(runtimeHome, "space-reference-deletions"),
    );
    await journal.save({
      schemaVersion: "space-reference-deletion/v1",
      deletionId,
      phase: "files_staged",
      rootReferenceId: item.id,
      removedReferences: [item],
      targets: [{
        referenceId: item.id,
        kind: "local_file",
        sourcePath: path.resolve(sourcePath),
        stagedPath,
      }],
      createdAt,
    });

    const pending = new SqliteRuntimeDatabase(
      path.join(runtimeHome, "workbench.restore-pending.sqlite3"),
    );
    createSqliteSpaceRepository(pending);
    createSqlitePersonalKnowledgeRepository(pending);
    pending.close();
    await fs.mkdir(
      path.join(runtimeHome, "workbench.restore-pending.assets", "knowledge-assets"),
      { recursive: true },
    );
    await fs.mkdir(
      path.join(runtimeHome, "workbench.restore-pending.assets", "space-folders"),
      { recursive: true },
    );

    restarted = await startLocalPanelServer({
      port: 0,
      configDirectory: directory,
      testOnlySkipInitialWorkbenchData: true,
    });

    assert.equal(await fs.readFile(sourcePath, "utf8"), "old generation content");
    assert.equal(await pathExists(stagedPath), false);
    assert.deepEqual(await journal.list(), []);
    assert.equal(await pathExists(path.join(runtimeHome, "workbench.restore-pending.sqlite3")), false);
    const oldTree = await requestJson(restarted.url, "/api/spaces/old-space");
    assert.equal(oldTree.status, 404);
  } finally {
    await restarted?.close().catch(() => undefined);
    await removeTemporaryTree(directory);
  }
});

test("Panel startup finalizes committed Space deletion without overwriting a recreated source", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-recover-committed-"));
  const sourcePath = path.join(directory, "outside", "note.md");
  await fs.mkdir(path.dirname(sourcePath), { recursive: true });
  await fs.writeFile(sourcePath, "old content", "utf8");
  const first = await startSpaceTestServer(directory);
  let firstClosed = false;
  let restarted: Awaited<ReturnType<typeof startLocalPanelServer>> | undefined;
  try {
    const created = await requestJson(first.baseUrl, "/api/spaces", { method: "POST", body: { title: "恢复" } });
    const spaceId = created.body.space.id as string;
    const linked = await requestJson(first.baseUrl, `/api/spaces/${encodeURIComponent(spaceId)}/references`, {
      method: "POST",
      body: { title: "note.md", reference: { kind: "local_file", path: sourcePath } },
    });
    const item = linked.body.item as SpaceReferenceItem;
    const staged = await stageSpaceDeletionCrash(first.runtime, item, "restart-committed");
    await first.runtime.spaceFeature.commands.unlinkReference(item.id);
    await fs.writeFile(sourcePath, "new content", "utf8");

    await closePanelServer(first.httpServer, first.runtime);
    firstClosed = true;
    restarted = await startLocalPanelServer({
      port: 0,
      configDirectory: directory,
      testOnlySkipInitialWorkbenchData: true,
    });

    assert.equal(await fs.readFile(sourcePath, "utf8"), "new content");
    assert.equal(await pathExists(staged.stagedPath), false);
    assert.deepEqual(await staged.journal.list(), []);
    const tree = await requestJson(restarted.url, `/api/spaces/${encodeURIComponent(spaceId)}`);
    assert.equal(
      (tree.body.tree.entries as Array<{ item: { id: string } }>).some((entry) => entry.item.id === item.id),
      false,
    );
  } finally {
    await restarted?.close().catch(() => undefined);
    if (!firstClosed) await closePanelServer(first.httpServer, first.runtime).catch(() => undefined);
    await removeTemporaryTree(directory);
  }
});

test("Panel refuses to listen when the Space deletion journal is corrupt and releases startup resources", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-corrupt-startup-"));
  const seed = await startSpaceTestServer(directory);
  const runtimeHome = requireRuntimeHome(seed.runtime);
  await closePanelServer(seed.httpServer, seed.runtime);
  const journalRoot = path.join(runtimeHome, "space-reference-deletions");
  await fs.mkdir(journalRoot, { recursive: true });
  const corruptPath = path.join(journalRoot, "broken.json");
  await fs.writeFile(corruptPath, "{not-json", "utf8");
  let restarted: Awaited<ReturnType<typeof startLocalPanelServer>> | undefined;
  try {
    await assert.rejects(
      startLocalPanelServer({
        port: 0,
        configDirectory: directory,
        testOnlySkipInitialWorkbenchData: true,
      }),
      (error: unknown) => error instanceof SpaceFeatureError && error.code === "space_deletion_journal_failure",
    );

    await fs.rm(corruptPath);
    restarted = await startLocalPanelServer({
      port: 0,
      configDirectory: directory,
      testOnlySkipInitialWorkbenchData: true,
    });
    assert.match(restarted.url, /^http:\/\/127\.0\.0\.1:\d+\/$/u);
  } finally {
    await restarted?.close().catch(() => undefined);
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
    const reference = await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(sourceId)}/references`, {
      method: "POST",
      body: { title: "待移动", reference: { kind: "web_page", url: "https://example.com/move-me" } },
    });
    const target = { kind: "reference", id: reference.body.item.id as string };

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

async function stageSpaceDeletionCrash(
  runtime: PanelRuntime,
  item: SpaceReferenceItem,
  deletionId: string,
) {
  assert.equal(item.reference.kind, "local_file");
  if (item.reference.kind !== "local_file") throw new Error("Test requires a local file reference");
  const runtimeHome = requireRuntimeHome(runtime);
  const journal = createFileSystemSpaceReferenceDeletionJournal(
    path.join(runtimeHome, "space-reference-deletions"),
  );
  const sourcePath = path.resolve(item.reference.path);
  const stagedPath = path.join(
    path.dirname(sourcePath),
    `.${path.basename(sourcePath)}.agentarbor-delete-${deletionId}-0`,
  );
  await fs.rename(sourcePath, stagedPath);
  await journal.save({
    schemaVersion: "space-reference-deletion/v1",
    deletionId,
    phase: "files_staged",
    rootReferenceId: item.id,
    removedReferences: [item],
    targets: [{
      referenceId: item.id,
      kind: "local_file",
      sourcePath,
      stagedPath,
    }],
    createdAt: "2026-08-02T00:00:00.000Z",
  });
  return { journal, stagedPath };
}

function requireRuntimeHome(runtime: PanelRuntime): string {
  const runtimeHome = runtime.runtimePaths?.runtimeHome;
  assert.ok(runtimeHome, "Panel test runtime must expose its runtime home");
  return runtimeHome;
}

async function pathExists(targetPath: string): Promise<boolean> {
  return await fs.lstat(targetPath).then(() => true, () => false);
}

test("Space API previews referenced files without copying them", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-preview-"));
  const sourcePath = path.join(directory, "reference.md");
  await fs.writeFile(sourcePath, "# 引用正文\n\n来自原始文件。", "utf8");
  const { baseUrl, runtime, httpServer } = await startSpaceTestServer(directory);
  try {
    const created = await requestJson(baseUrl, "/api/spaces", { method: "POST", body: { title: "预览" } });
    const reference = await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(created.body.space.id as string)}/references`, {
      method: "POST",
      body: { title: "reference.md", reference: { kind: "local_file", path: sourcePath } },
    });
    const itemId = reference.body.item.id as string;

    const preview = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(itemId)}/preview`);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.preview.status, "ready");
    assert.equal(preview.body.preview.content.kind, "text");
    assert.match(preview.body.preview.content.text as string, /来自原始文件/u);

    const ranged = await fetch(`${baseUrl}/api/spaces/references/${encodeURIComponent(itemId)}/content`, {
      headers: { range: "bytes=0-2" },
    });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get("content-range")?.startsWith("bytes 0-2/"), true);
    assert.equal((await ranged.arrayBuffer()).byteLength, 3);

    const tree = await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(created.body.space.id as string)}`);
    assert.deepEqual(tree.body.tree.entries[0].item.reference, { kind: "local_file", path: sourcePath });
  } finally {
    await closePanelServer(httpServer, runtime);
    await removeTemporaryTree(directory);
  }
});

test("Space API edits Workbench text assets through the shared revision contract", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-workbench-asset-"));
  const { baseUrl, runtime, httpServer } = await startSpaceTestServer(directory);
  try {
    await runtime.workbenchAssetFeature.commands.replace({
      id: "asset-note",
      kind: "markdown",
      title: "共享笔记.md",
      markdown: "# 初稿",
    });
    const space = await runtime.spaceFeature.commands.createSpace({ title: "资产编辑" });
    const folder = await runtime.spaceFeature.commands.addReference({
      spaceId: space.id,
      title: "资料",
      reference: { kind: "asset_folder" },
    });
    const item = await runtime.spaceFeature.commands.addReference({
      spaceId: space.id,
      parentId: folder.id,
      title: "共享笔记.md",
      reference: { kind: "workbench_asset", assetId: "asset-note" },
    });

    const preview = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(item.id)}/preview`);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.preview.itemId, item.id);
    assert.equal(preview.body.preview.content.editable, true);

    const saved = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(item.id)}/content`, {
      method: "PUT",
      body: { relativePath: "", expectedFingerprint: preview.body.preview.fingerprint, text: "# 定稿" },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.preview.itemId, item.id);
    assert.equal((await runtime.workbenchAssetFeature.queries.get("asset-note"))?.markdown, "# 定稿");

    const direct = await requestJson(baseUrl, "/api/workbench-assets/asset-note/preview");
    assert.equal(direct.body.preview.content.text, "# 定稿");
    assert.equal(direct.body.preview.fingerprint, saved.body.preview.fingerprint);
  } finally {
    await closePanelServer(httpServer, runtime);
    await removeTemporaryTree(directory);
  }
});

test("Space API browses and edits text inside a referenced folder without escaping its root", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-folder-preview-"));
  const sourceRoot = path.join(directory, "source");
  await fs.mkdir(path.join(sourceRoot, "notes"), { recursive: true });
  await fs.writeFile(path.join(sourceRoot, "notes", "idea.md"), "# 初稿", "utf8");
  const { baseUrl, runtime, httpServer } = await startSpaceTestServer(directory);
  try {
    const created = await requestJson(baseUrl, "/api/spaces", { method: "POST", body: { title: "文件夹" } });
    const reference = await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(created.body.space.id as string)}/references`, {
      method: "POST",
      body: { title: "source", reference: { kind: "workspace_folder", path: sourceRoot } },
    });
    const itemId = reference.body.item.id as string;

    const root = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(itemId)}/preview`);
    assert.deepEqual(root.body.preview.content.entries, [{ name: "notes", relativePath: "notes", kind: "directory" }]);
    await fs.writeFile(path.join(sourceRoot, ".gitignore"), "dist/\n.env\n", "utf8");
    await fs.writeFile(path.join(sourceRoot, "fetch_page.py"), "import requests\n", "utf8");
    await fs.writeFile(path.join(sourceRoot, "diagram.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await fs.writeFile(path.join(sourceRoot, "NOTICE"), "无扩展名 UTF-8 文本", "utf8");
    await fs.writeFile(path.join(sourceRoot, "legacy.ini"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("标题=配置", "utf16le")]));
    await fs.writeFile(path.join(sourceRoot, "archive.zip"), Buffer.from("PK\x03\x04binary", "latin1"));
    await fs.writeFile(path.join(sourceRoot, "large.log"), `${"a".repeat(512 * 1024 - 1)}中`);
    await fs.mkdir(path.join(sourceRoot, "z-folder"));

    const sortedRoot = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(itemId)}/preview`);
    assert.deepEqual((sortedRoot.body.preview.content.entries as Array<{ name: string; kind: string }>).slice(0, 2), [
      { name: "notes", relativePath: "notes", kind: "directory" },
      { name: "z-folder", relativePath: "z-folder", kind: "directory" },
    ]);

    const gitignore = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(itemId)}/preview?path=${encodeURIComponent(".gitignore")}`);
    assert.equal(gitignore.body.preview.content.text, "dist/\n.env\n");
    assert.equal(gitignore.body.preview.content.language, "gitignore");
    assert.deepEqual(gitignore.body.preview.presentation, { kind: "code", editable: true, sourceMode: false });
    assert.equal(gitignore.body.preview.content.encoding, "UTF-8");
    assert.equal(gitignore.body.preview.content.editable, true);

    const python = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(itemId)}/preview?path=${encodeURIComponent("fetch_page.py")}`);
    assert.equal(python.body.preview.content.language, "python");
    assert.deepEqual(python.body.preview.presentation, { kind: "code", editable: true, sourceMode: false });

    const notice = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(itemId)}/preview?path=${encodeURIComponent("NOTICE")}`);
    assert.equal(notice.body.preview.content.text, "无扩展名 UTF-8 文本");
    assert.equal(notice.body.preview.content.language, "plaintext");
    assert.deepEqual(notice.body.preview.presentation, { kind: "text", editable: true, sourceMode: false });

    const legacy = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(itemId)}/preview?path=${encodeURIComponent("legacy.ini")}`);
    assert.equal(legacy.body.preview.content.text, "标题=配置");
    assert.equal(legacy.body.preview.content.encoding, "UTF-16LE");
    assert.equal(legacy.body.preview.content.editable, false);

    const archive = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(itemId)}/preview?path=${encodeURIComponent("archive.zip")}`);
    assert.equal(archive.body.preview.status, "unsupported");
    assert.equal(archive.body.preview.content.kind, "unavailable");

    const large = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(itemId)}/preview?path=${encodeURIComponent("large.log")}`);
    assert.equal(large.body.preview.content.kind, "text");
    assert.equal(large.body.preview.content.encoding, "UTF-8");
    assert.equal(large.body.preview.content.truncated, true);
    assert.equal((large.body.preview.content.text as string).endsWith("�"), false);

    const file = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(itemId)}/preview?path=${encodeURIComponent("notes/idea.md")}`);
    assert.equal(file.body.preview.content.text, "# 初稿");
    assert.equal(file.body.preview.content.editable, true);
    assert.deepEqual(file.body.preview.presentation, { kind: "markdown", editable: true, sourceMode: true });

    const unchangedName = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(itemId)}/entry`, {
      method: "PATCH",
      body: { relativePath: "notes/idea.md", name: "idea.md" },
    });
    assert.equal(unchangedName.status, 200);
    assert.equal(unchangedName.body.entry.relativePath, "notes/idea.md");

    const saved = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(itemId)}/content`, {
      method: "PUT",
      body: { relativePath: "notes/idea.md", expectedFingerprint: file.body.preview.fingerprint, text: "# 完整想法" },
    });
    assert.equal(saved.status, 200);
    assert.equal(await fs.readFile(path.join(sourceRoot, "notes", "idea.md"), "utf8"), "# 完整想法");

    await fs.writeFile(path.join(sourceRoot, "notes", "idea.md"), "外部更新且长度不同", "utf8");
    const conflict = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(itemId)}/content`, {
      method: "PUT",
      body: { relativePath: "notes/idea.md", expectedFingerprint: saved.body.preview.fingerprint, text: "不应覆盖" },
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error.code, "space_reference_revision_conflict");
    assert.equal(await fs.readFile(path.join(sourceRoot, "notes", "idea.md"), "utf8"), "外部更新且长度不同");

    const createdFile = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(itemId)}/entry`, {
      method: "POST",
      body: { parentRelativePath: "notes", name: "new.md", kind: "file" },
    });
    assert.equal(createdFile.status, 201);
    assert.equal(createdFile.body.entry.relativePath, "notes/new.md");
    assert.equal(await fs.readFile(path.join(sourceRoot, "notes", "new.md"), "utf8"), "");

    const duplicateFile = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(itemId)}/entry`, {
      method: "POST",
      body: { parentRelativePath: "notes", name: "new.md", kind: "file" },
    });
    assert.equal(duplicateFile.status, 409);

    await fs.mkdir(path.join(sourceRoot, "other"));
    await fs.writeFile(path.join(sourceRoot, "other", "renamed.md"), "另一个文件夹允许同名", "utf8");

    const renamed = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(itemId)}/entry`, {
      method: "PATCH",
      body: { relativePath: "notes/idea.md", name: "renamed.md" },
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.entry.relativePath, "notes/renamed.md");
    assert.equal(await fs.readFile(path.join(sourceRoot, "notes", "renamed.md"), "utf8"), "外部更新且长度不同");

    const trueConflict = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(itemId)}/entry`, {
      method: "PATCH",
      body: { relativePath: "notes/renamed.md", name: "new.md" },
    });
    assert.equal(trueConflict.status, 409);
    assert.equal(trueConflict.body.error.code, "space_reference_entry_exists");

    const removed = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(itemId)}/entry`, {
      method: "DELETE",
      body: { relativePath: "notes" },
    });
    assert.equal(removed.status, 200);
    assert.equal(await fs.stat(path.join(sourceRoot, "notes")).then(() => true, () => false), false);

    const rootDelete = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(itemId)}/entry`, {
      method: "DELETE",
      body: { relativePath: "" },
    });
    assert.equal(rootDelete.status, 400);
    assert.equal(await fs.stat(sourceRoot).then(() => true, () => false), true);

    const escaped = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(itemId)}/preview?path=${encodeURIComponent("../outside.md")}`);
    assert.equal(escaped.status, 400);
    assert.equal(escaped.body.error.code, "invalid_space_reference_path");

    const collected = await requestJson(baseUrl, "/api/personal-knowledge/collect-space-reference", {
      method: "POST",
      body: { referenceId: itemId },
    });
    assert.equal(collected.status, 201);
    const knowledgeRefId = collected.body.page.refId as string;
    await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(itemId)}`, { method: "DELETE" });
    assert.equal(await fs.stat(sourceRoot).then((stat) => stat.isDirectory()), true);

    const knowledge = await requestJson(baseUrl, "/api/personal-knowledge");
    const knowledgePage = (knowledge.body.snapshot.pages as Array<{ refId: string; asset?: { status: string } }>).find((page) => page.refId === knowledgeRefId);
    assert.equal(knowledgePage?.asset?.status, "managed");
    const managedPreview = await requestJson(baseUrl, `/api/personal-knowledge/assets/${encodeURIComponent(knowledgeRefId)}/preview?path=${encodeURIComponent(".gitignore")}`);
    assert.equal(managedPreview.body.preview.content.text, "dist/\n.env\n");
    assert.equal(managedPreview.body.preview.content.language, "gitignore");
    assert.deepEqual(managedPreview.body.preview.presentation, { kind: "code", editable: true, sourceMode: false });
    assert.equal(managedPreview.body.preview.sourceKind, "knowledge_asset");
    const managedPython = await requestJson(baseUrl, `/api/personal-knowledge/assets/${encodeURIComponent(knowledgeRefId)}/preview?path=${encodeURIComponent("fetch_page.py")}`);
    assert.equal(managedPython.body.preview.content.language, "python");
    assert.deepEqual(managedPython.body.preview.presentation, { kind: "code", editable: true, sourceMode: false });
    const managedImage = await requestJson(baseUrl, `/api/personal-knowledge/assets/${encodeURIComponent(knowledgeRefId)}/preview?path=${encodeURIComponent("diagram.png")}`);
    assert.equal(managedImage.body.preview.content.mediaKind, "image");
    assert.equal(managedImage.body.preview.presentation.kind, "image");

    await requestJson(baseUrl, "/api/personal-knowledge/commands", {
      method: "POST",
      body: { type: "knowledge.uncollect", refId: knowledgeRefId },
    });
    const removedAsset = await requestJson(baseUrl, `/api/personal-knowledge/assets/${encodeURIComponent(knowledgeRefId)}/preview`);
    assert.equal(removedAsset.status, 404);
  } finally {
    await closePanelServer(httpServer, runtime);
    await removeTemporaryTree(directory);
  }
});

test("Space API keeps one workspace mount writable when several Spaces reference it", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-shared-mounts-"));
  const sourceRoot = path.join(directory, "source");
  await fs.mkdir(sourceRoot);
  await fs.writeFile(path.join(sourceRoot, "note.md"), "original", "utf8");
  const { baseUrl, runtime, httpServer } = await startSpaceTestServer(directory);
  try {
    const firstSpace = await requestJson(baseUrl, "/api/spaces", { method: "POST", body: { title: "项目" } });
    const secondSpace = await requestJson(baseUrl, "/api/spaces", { method: "POST", body: { title: "学习" } });
    const firstReference = await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(firstSpace.body.space.id as string)}/references`, {
      method: "POST",
      body: { title: "source", reference: { kind: "workspace_folder", path: sourceRoot } },
    });
    const secondReference = await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(secondSpace.body.space.id as string)}/references`, {
      method: "POST",
      body: { title: "同一个 source", reference: { kind: "workspace_folder", path: sourceRoot } },
    });
    assert.equal(secondReference.status, 201);

    const itemId = firstReference.body.item.id as string;
    const secondReferenceId = secondReference.body.item.id as string;
    assert.notEqual(itemId, secondReferenceId);

    const created = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(itemId)}/entry`, {
      method: "POST", body: { parentRelativePath: "", name: "new.md", kind: "file" },
    });
    assert.equal(created.status, 201);

    const preview = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(secondReferenceId)}/preview?path=note.md`);
    assert.equal(preview.status, 200);
    const written = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(secondReferenceId)}/content`, {
      method: "PUT",
      body: { relativePath: "note.md", expectedFingerprint: preview.body.preview.fingerprint, text: "changed" },
    });
    assert.equal(written.status, 200);

    assert.equal(await fs.readFile(path.join(sourceRoot, "note.md"), "utf8"), "changed");
    assert.equal(await fs.stat(path.join(sourceRoot, "new.md")).then(() => true, () => false), true);

    const unlinked = await requestJson(
      baseUrl,
      `/api/spaces/references/${encodeURIComponent(secondReferenceId)}/unlink`,
      { method: "POST", body: {} },
    );
    assert.equal(unlinked.status, 200);
    assert.equal(await fs.readFile(path.join(sourceRoot, "note.md"), "utf8"), "changed");

    const survivor = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(itemId)}/entry`, {
      method: "PATCH", body: { relativePath: "note.md", name: "renamed.md" },
    });
    assert.equal(survivor.status, 200);
    assert.equal(await fs.readFile(path.join(sourceRoot, "renamed.md"), "utf8"), "changed");
  } finally {
    await closePanelServer(httpServer, runtime);
    await removeTemporaryTree(directory);
  }
});

test("Space API removes vanished references and requires a fresh re-add", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-availability-"));
  const sourceRoot = path.join(directory, "source");
  const keptRoot = path.join(directory, "kept");
  await fs.mkdir(sourceRoot, { recursive: true });
  await fs.mkdir(keptRoot, { recursive: true });
  const { baseUrl, runtime, httpServer } = await startSpaceTestServer(directory);
  try {
    const created = await requestJson(baseUrl, "/api/spaces", { method: "POST", body: { title: "对账" } });
    const spaceId = created.body.space.id as string;
    const referencesPath = `/api/spaces/${encodeURIComponent(spaceId)}/references`;
    const vanishing = await requestJson(baseUrl, referencesPath, {
      method: "POST", body: { title: "source", reference: { kind: "workspace_folder", path: sourceRoot } },
    });
    const kept = await requestJson(baseUrl, referencesPath, {
      method: "POST", body: { title: "kept", reference: { kind: "workspace_folder", path: keptRoot } },
    });
    const vanishingId = vanishing.body.item.id as string;
    const keptId = kept.body.item.id as string;
    const treePath = `/api/spaces/${encodeURIComponent(spaceId)}`;
    const hasReference = (tree: { body: { tree: { entries: readonly { item: { id: string } }[] } } }, id: string) =>
      tree.body.tree.entries.some((entry) => entry.item.id === id);

    const initial = await requestJson(baseUrl, treePath);
    assert.equal(hasReference(initial, vanishingId), true);
    assert.equal(hasReference(initial, keptId), true);

    await removeTemporaryTree(sourceRoot);
    await fs.mkdir(sourceRoot, { recursive: true });
    const missingPreview = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(vanishingId)}/preview`);
    assert.equal(missingPreview.status, 410);
    assert.equal(missingPreview.body.error.code, "space_reference_source_missing");
    const afterLoss = await requestJson(baseUrl, treePath);

    assert.equal(hasReference(afterLoss, vanishingId), false);
    assert.equal(hasReference(afterLoss, keptId), true);

    const afterRestore = await requestJson(baseUrl, treePath);

    assert.equal(hasReference(afterRestore, vanishingId), false);

    const readded = await requestJson(baseUrl, referencesPath, {
      method: "POST", body: { title: "replacement", reference: { kind: "workspace_folder", path: sourceRoot } },
    });
    assert.equal(readded.status, 201);
    const replacementId = readded.body.item.id as string;
    assert.notEqual(replacementId, vanishingId);
    assert.equal(hasReference(await requestJson(baseUrl, treePath), replacementId), true);

    await removeTemporaryTree(sourceRoot);
    const missingMutation = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(replacementId)}/entry`, {
      method: "POST",
      body: { parentRelativePath: "", name: "new.md", kind: "file" },
    });
    assert.equal(missingMutation.status, 410);
    assert.equal(missingMutation.body.error.code, "space_reference_source_missing");
    assert.equal(hasReference(await requestJson(baseUrl, treePath), replacementId), false);
  } finally {
    await closePanelServer(httpServer, runtime);
    await removeTemporaryTree(directory);
  }
});

test("Space API rejects overlapping workspace mounts inside one Space", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-overlapping-mounts-"));
  const sourceRoot = path.join(directory, "source");
  const nestedRoot = path.join(sourceRoot, "nested");
  await fs.mkdir(nestedRoot, { recursive: true });
  const { baseUrl, runtime, httpServer } = await startSpaceTestServer(directory);
  try {
    const space = await requestJson(baseUrl, "/api/spaces", { method: "POST", body: { title: "项目" } });
    const referencesPath = `/api/spaces/${encodeURIComponent(space.body.space.id as string)}/references`;
    await requestJson(baseUrl, referencesPath, {
      method: "POST", body: { title: "source", reference: { kind: "workspace_folder", path: sourceRoot } },
    });

    const nested = await requestJson(baseUrl, referencesPath, {
      method: "POST", body: { title: "nested", reference: { kind: "workspace_folder", path: nestedRoot } },
    });
    assert.equal(nested.status, 409);
    assert.equal(nested.body.error.code, "space_workspace_mount_conflict");

    const duplicate = await requestJson(baseUrl, referencesPath, {
      method: "POST", body: { title: "duplicate", reference: { kind: "workspace_folder", path: sourceRoot } },
    });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error.code, "space_workspace_mount_conflict");
  } finally {
    await closePanelServer(httpServer, runtime);
    await removeTemporaryTree(directory);
  }
});