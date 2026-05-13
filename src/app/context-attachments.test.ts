import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ContextAttachmentPreviewError,
  createContextAttachmentPreview,
} from "./context-attachments.js";

test("context attachment preview creates safe file refs without file body", async () => {
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
    assert.equal(text.includes(secretBody), false);
    assert.equal(text.includes("sk-context-secret"), false);
    assert.equal(text.includes("Bearer live-token"), false);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("context attachment preview rejects unsafe and outside-workspace refs", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-context-reject-"));
  try {
    await assert.rejects(
      () => createContextAttachmentPreview({ workspaceRoot: workspace, raw: { kind: "file", value: "..\\outside.md" } }),
      (error: unknown) => error instanceof ContextAttachmentPreviewError && error.code === "context_path_outside_workspace"
    );
    await assert.rejects(
      () => createContextAttachmentPreview({ workspaceRoot: workspace, raw: { kind: "web", value: "https://example.com/?access_token=abc" } }),
      (error: unknown) => error instanceof ContextAttachmentPreviewError && error.code === "unsafe_context_reference"
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
