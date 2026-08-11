import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import {
  createSqliteWorkbenchAssetRepository,
  type WorkbenchAssetRepository,
  workbenchAssetTextFingerprint,
} from "../workbench-assets/index.js";
import { workbenchAssetCaptionFingerprint } from "../workbench-assets/index.js";
import { PanelHttpError, writeJson, writePanelError } from "./http-utils.js";
import { handlePanelWorkbenchAssetRoute } from "./workbench-asset-routes.js";

type TestResponseBody = {
  readonly preview?: {
    readonly sourceKind?: string;
    readonly fingerprint?: string;
    readonly presentation?: { readonly kind?: string; readonly editable?: boolean; readonly sourceMode?: boolean };
    readonly content?: { readonly editable?: boolean; readonly text?: string; readonly caption?: string; readonly captionEditable?: boolean; readonly captionFingerprint?: string };
  };
  readonly error?: { readonly code?: string };
};

test("Workbench asset routes return editable previews and enforce SQLite fingerprint conflicts", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentarbor-workbench-asset-routes-"));
  const database = new SqliteRuntimeDatabase(path.join(directory, "workbench.sqlite3"));
  const repository = createSqliteWorkbenchAssetRepository(database);
  await repository.upsertMany([{
    id: "note-one",
    kind: "markdown",
    title: "研究笔记.md",
    markdown: "# 初稿",
  }, {
    id: "paper-one",
    kind: "pdf",
    title: "论文.pdf",
    pdf: { pages: ["只读正文"] },
  }, {
    id: "image-one",
    kind: "image",
    title: "结构图.png",
    image: { src: "/image.png", alt: "结构图", caption: "初始说明" },
  }]);
  const server = await startServer(repository);
  const baseUrl = serverBaseUrl(server);
  t.after(async () => {
    await closeServer(server);
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  const initial = await request(baseUrl, "/api/workbench-assets/note-one/preview");
  assert.equal(initial.status, 200);
  assert.equal(initial.body.preview?.sourceKind, "workbench_asset");
  assert.deepEqual(initial.body.preview?.presentation, { kind: "markdown", editable: true, sourceMode: true });
  assert.equal(initial.body.preview?.content?.editable, true);
  assert.equal(initial.body.preview?.content?.text, "# 初稿");
  assert.equal(initial.body.preview?.fingerprint, workbenchAssetTextFingerprint("# 初稿"));

  const saved = await request(baseUrl, "/api/workbench-assets/note-one/content", {
    method: "PUT",
    body: {
      itemId: "note-one",
      relativePath: "",
      expectedFingerprint: initial.body.preview?.fingerprint,
      text: "# 定稿",
    },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.preview?.content?.text, "# 定稿");
  assert.equal(saved.body.preview?.fingerprint, workbenchAssetTextFingerprint("# 定稿"));
  assert.equal((await repository.get("note-one"))?.markdown, "# 定稿");

  const conflict = await request(baseUrl, "/api/workbench-assets/note-one/content", {
    method: "PUT",
    body: {
      expectedFingerprint: initial.body.preview?.fingerprint,
      text: "不应覆盖",
    },
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error?.code, "workbench_asset_revision_conflict");
  assert.equal((await repository.get("note-one"))?.markdown, "# 定稿");

  const readOnly = await request(baseUrl, "/api/workbench-assets/paper-one/content", {
    method: "PUT",
    body: { expectedFingerprint: "asset:paper-one", text: "不允许写入" },
  });
  assert.equal(readOnly.status, 409);
  assert.equal(readOnly.body.error?.code, "workbench_asset_not_editable");
  assert.deepEqual((await repository.get("paper-one"))?.pdf?.pages, ["只读正文"]);

  const image = await request(baseUrl, "/api/workbench-assets/image-one/preview");
  assert.equal(image.body.preview?.fingerprint, "asset:image-one");
  assert.equal(image.body.preview?.content?.captionFingerprint, workbenchAssetCaptionFingerprint("初始说明"));
  const caption = await request(baseUrl, "/api/workbench-assets/image-one/caption", {
    method: "PUT",
    body: { expectedFingerprint: image.body.preview?.content?.captionFingerprint, caption: "更新说明" },
  });
  assert.equal(caption.status, 200);
  assert.equal((await repository.get("image-one"))?.image?.caption, "更新说明");
  assert.equal(caption.body.preview?.fingerprint, "asset:image-one");
  assert.equal(caption.body.preview?.content?.captionFingerprint, workbenchAssetCaptionFingerprint("更新说明"));
});

async function startServer(repository: WorkbenchAssetRepository): Promise<Server> {
  const runtime = { ensureInitialWorkbenchData: async () => undefined, workbenchAssets: repository };
  const server = createServer((incoming, response) => {
    const url = new URL(incoming.url ?? "/", "http://127.0.0.1");
    void handlePanelWorkbenchAssetRoute(runtime, incoming, response, url).then((handled) => {
      if (!handled) writeJson(response, 404, { ok: false });
    }).catch((error: unknown) => {
      if (error instanceof PanelHttpError) writePanelError(response, error);
      else writePanelError(response, new PanelHttpError(500, "test_internal_error", String(error)));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}

function serverBaseUrl(server: Server): string {
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Test server did not expose a TCP port");
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
}

async function request(
  baseUrl: string,
  pathname: string,
  input?: { readonly method: "PUT"; readonly body: Record<string, unknown> },
): Promise<{ readonly status: number; readonly body: TestResponseBody }> {
  const response = await fetch(`${baseUrl}${pathname}`, input === undefined ? undefined : {
    method: input.method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input.body),
  });
  return { status: response.status, body: await response.json() as TestResponseBody };
}
