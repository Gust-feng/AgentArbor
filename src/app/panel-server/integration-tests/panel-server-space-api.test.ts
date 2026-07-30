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

test("Space API organizes reference metadata without altering the referenced conversation", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-api-"));
  const { baseUrl, runtime, httpServer } = await startSpaceTestServer(directory);
  try {
    const created = await requestJson(baseUrl, "/api/spaces", { method: "POST", body: { title: "研究" } });
    assert.equal(created.status, 201);
    const spaceId = created.body.space.id as string;

    const reference = await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(spaceId)}/references`, {
      method: "POST",
      body: {
        title: "架构讨论",
        reference: { kind: "conversation", conversationId: "ordinary-conversation-1", conversationTitle: "架构讨论" },
      },
    });
    assert.equal(reference.status, 201);

    const tree = await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(spaceId)}`);
    assert.equal(tree.status, 200);
    assert.equal(tree.body.tree.entries[0].kind, "reference");
    assert.equal(tree.body.tree.entries[0].item.reference.conversationId, "ordinary-conversation-1");

    const removed = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(reference.body.item.id)}`, { method: "DELETE" });
    assert.equal(removed.status, 200);
    const afterRemoval = await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(spaceId)}`);
    assert.equal(afterRemoval.body.tree.entries.length, 0);
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

test("Space API creates and physically deletes app-owned folders and files", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-managed-folder-"));
  const { baseUrl, runtime, httpServer } = await startSpaceTestServer(directory);
  try {
    const created = await requestJson(baseUrl, "/api/spaces", { method: "POST", body: { title: "本地资料" } });
    const spaceId = created.body.space.id as string;
    const existing = await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(spaceId)}/references`, {
      method: "POST",
      body: { title: "已有资料", reference: { kind: "conversation", conversationId: "existing-reference" } },
    });
    const folder = await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(spaceId)}/managed-folders`, {
      method: "POST",
      body: { title: "我的文件" },
    });
    assert.equal(folder.status, 201);
    assert.equal(folder.body.item.reference.kind, "managed_folder");
    const orderedTree = await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(spaceId)}`);
    assert.deepEqual(orderedTree.body.tree.entries.map((entry: { readonly item: { readonly title: string } }) => entry.item.title), ["我的文件", "已有资料"]);
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
    const removedExisting = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(existing.body.item.id as string)}`, { method: "DELETE" });
    assert.equal(removedExisting.status, 200);
    assert.deepEqual((await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(spaceId)}`)).body.tree.entries, []);
  } finally {
    await closePanelServer(httpServer, runtime);
    await removeTemporaryTree(directory);
  }
});

test("Space API deletes a linked file but only unlinks a linked folder", async () => {
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
    const folderReference = await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(spaceId)}/references`, {
      method: "POST",
      body: { title: "linked-folder", reference: { kind: "workspace_folder", path: linkedFolder } },
    });

    const deletedFile = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(fileReference.body.item.id as string)}`, { method: "DELETE" });
    assert.equal(deletedFile.status, 200);
    assert.equal(await fs.stat(linkedFile).then(() => true, () => false), false);

    const unlinkedFolder = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(folderReference.body.item.id as string)}`, { method: "DELETE" });
    assert.equal(unlinkedFolder.status, 200);
    assert.equal(await fs.stat(linkedFolder).then((stat) => stat.isDirectory(), () => false), true);
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
    const reference = await requestJson(baseUrl, `/api/spaces/${encodeURIComponent(sourceId)}/references`, {
      method: "POST",
      body: { title: "待移动", reference: { kind: "conversation", conversationId: "move-me" } },
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
    assert.equal(gitignore.body.preview.content.encoding, "UTF-8");
    assert.equal(gitignore.body.preview.content.editable, true);

    const notice = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(itemId)}/preview?path=${encodeURIComponent("NOTICE")}`);
    assert.equal(notice.body.preview.content.text, "无扩展名 UTF-8 文本");
    assert.equal(notice.body.preview.content.language, "plaintext");

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

    const renamed = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(itemId)}/entry`, {
      method: "PATCH",
      body: { relativePath: "notes/idea.md", name: "renamed.md" },
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.entry.relativePath, "notes/renamed.md");
    assert.equal(await fs.readFile(path.join(sourceRoot, "notes", "renamed.md"), "utf8"), "外部更新且长度不同");

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

test("Space API blocks every disk mutation when historical Spaces share one workspace mount", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-conflicting-mounts-"));
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
    const secondReferenceId = "historical-duplicate-reference";
    runtime.workbenchDatabase.connection.prepare(`
      INSERT INTO space_references(id, space_id, title, reference_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      secondReferenceId,
      secondSpace.body.space.id,
      "source duplicate",
      JSON.stringify({ kind: "workspace_folder", path: sourceRoot }),
      new Date().toISOString(),
      new Date().toISOString(),
    );

    const itemId = firstReference.body.item.id as string;
    const attempts = [
      await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(itemId)}/entry`, {
        method: "POST", body: { parentRelativePath: "", name: "new.md", kind: "file" },
      }),
      await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(itemId)}/entry`, {
        method: "PATCH", body: { relativePath: "note.md", name: "renamed.md" },
      }),
      await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(itemId)}/content`, {
        method: "PUT", body: { relativePath: "note.md", expectedFingerprint: "stale", text: "changed" },
      }),
      await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(itemId)}/entry`, {
        method: "DELETE", body: { relativePath: "note.md" },
      }),
    ];
    for (const attempt of attempts) {
      assert.equal(attempt.status, 409);
      assert.equal(attempt.body.error.code, "space_workspace_mount_conflict");
    }
    assert.equal(await fs.readFile(path.join(sourceRoot, "note.md"), "utf8"), "original");
    assert.equal(await fs.stat(path.join(sourceRoot, "new.md")).then(() => true, () => false), false);
    assert.equal(await fs.stat(path.join(sourceRoot, "renamed.md")).then(() => true, () => false), false);

    const unlinked = await requestJson(baseUrl, `/api/spaces/references/${encodeURIComponent(secondReferenceId)}`, { method: "DELETE" });
    assert.equal(unlinked.status, 200);
    assert.equal(await fs.readFile(path.join(sourceRoot, "note.md"), "utf8"), "original");
  } finally {
    await closePanelServer(httpServer, runtime);
    await removeTemporaryTree(directory);
  }
});
