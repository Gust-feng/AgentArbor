import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ContextAttachmentPreviewError,
  createContextAttachmentPreview,
} from "./context-attachments.js";

test("context attachment preview creates file refs with bounded file preview", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-context-preview-"));
  const secretBody = "private note with sk-context-secret and Bearer live-token";
  await fs.writeFile(path.join(workspace, "notes.md"), secretBody, "utf8");
  try {
    const attachment = await createContextAttachmentPreview({
      workspaceRoot: workspace,
      raw: { kind: "file", value: "notes.md" },
    });
    const text = JSON.stringify(attachment);

    assert.equal(attachment.kind, "file");
    assert.equal(attachment.ref, "file:notes.md");
    assert.equal(attachment.status, "ready");
    assert.equal(attachment.permissionRefs.includes("read:file:notes.md"), true);
    assert.equal(attachment.readonlyPreviewMeta.byteLength, Buffer.byteLength(secretBody));
    assert.equal(attachment.readonlyPreviewMeta.mimeType, "text/markdown");
    assert.equal(text.includes(secretBody), true);
    assert.equal(text.includes("sk-context-secret"), true);
    assert.equal(text.includes("Bearer live-token"), true);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("context attachment preview rejects outside-workspace refs and accepts token-like URLs", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-context-reject-"));
  try {
    await assert.rejects(
      () => createContextAttachmentPreview({ workspaceRoot: workspace, raw: { kind: "file", value: "..\\outside.md" } }),
      (error: unknown) => error instanceof ContextAttachmentPreviewError && error.code === "context_path_outside_workspace"
    );
    const web = await createContextAttachmentPreview({ workspaceRoot: workspace, raw: { kind: "web", value: "https://example.com/?access_token=abc" } });
    assert.equal(web.ref, "web:https://example.com/?access_token=abc");
  } finally {
    await fs.rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
