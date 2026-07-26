import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { toolExecutionModelAttachments } from "./tool-result-test-support.js";
import {
  asRecord,
  contextAttachmentToolCenter,
  createTinyPngBuffer,
  taskSoilWithContext,
  TOOL_CONTEXT,
} from "./context-attachment-test-support.js";
test("context attachment image tool reads selected local image as ephemeral model attachment", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-workspace-"));
  const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-image-"));
  const imageFile = path.join(localRoot, "screenshot.png");
  const image = createTinyPngBuffer();
  await fs.writeFile(imageFile, image);
  try {
    const taskSoil = taskSoilWithContext({
      contextRefs: [
        {
          attachmentId: "ctx_screenshot",
          ref: `local-file:${imageFile}`,
          kind: "file",
          title: "screenshot.png",
          summary: "Selected screenshot.",
          metadata: {
            byteLength: image.length,
            mimeType: "image/png",
            available: true,
          },
        },
      ],
      permissionBoundaryRefs: [`read:local-file:${imageFile}`],
    });
    const center = contextAttachmentToolCenter({ taskSoil, workspaceRoot: workspace, supportsVisionInput: true });
    const permission = {
      callerAgentId: TOOL_CONTEXT.callerAgentId,
      allowedTools: [
        "AttachmentList",
        "AttachmentReadImage",
      ],
    };
    const listed = await center.execute(
      {
        callId: "call:list-image",
        toolName: "AttachmentList",
        input: {},
      },
      TOOL_CONTEXT,
      permission
    );
    const read = await center.execute(
      {
        callId: "call:read-image",
        toolName: "AttachmentReadImage",
        input: { attachmentId: "ctx_screenshot", detail: "high" },
      },
      TOOL_CONTEXT,
      permission
    );
    const projected = JSON.stringify([listed.output, read.output]);
    const output = JSON.stringify(read.output);
    const attachment = toolExecutionModelAttachments(read)?.[0];

    assert.equal(listed.status, "completed");
    assert.equal(read.status, "completed");
    assertDirectAttachmentFacts(read.output);
    assert.equal(projected.includes("\"format\":\"image\""), true);
    assert.equal(projected.includes("\"canReadImage\":true"), true);
    assert.equal(projected.includes("\"attached\":true"), true);
    assert.equal(projected.includes(imageFile), false);
    assert.equal(projected.includes("local-file:"), false);
    assert.equal(output.includes(image.toString("base64")), false);
    assert.equal(attachment?.kind, "image");
    assert.equal(attachment?.attachmentId, "ctx_screenshot");
    assert.equal(attachment?.inputRef?.includes("local-file:"), false);
    assert.equal(attachment?.inputRef?.includes(imageFile), false);
    assert.equal(attachment?.filename, "screenshot.png");
    assert.equal(attachment?.detail, "high");
    assert.equal(attachment?.byteLength, image.length);
    assert.equal(attachment?.source.kind, "data");
    if (attachment?.source.kind === "data") {
      assert.equal(attachment.source.mimeType, "image/png");
      assert.equal(attachment.source.data, image.toString("base64"));
    }
  } finally {
    await fs.rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await fs.rm(localRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("context attachment image tool reads image inside selected local project by relative path", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-workspace-"));
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-image-project-"));
  const image = createTinyPngBuffer();
  await fs.mkdir(path.join(projectRoot, "assets"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "assets", "screen.jpg"), image);
  try {
    const taskSoil = taskSoilWithContext({
      contextRefs: [
        {
          attachmentId: "ctx_project",
          ref: `local-project:${projectRoot}`,
          kind: "project",
          title: "image-project",
          metadata: { available: true },
        },
      ],
      permissionBoundaryRefs: [`read:local-project:${projectRoot}`],
    });
    const center = contextAttachmentToolCenter({ taskSoil, workspaceRoot: workspace, supportsVisionInput: true });
    const result = await center.execute(
      {
        callId: "call:read-project-image",
        toolName: "AttachmentReadImage",
        input: { attachmentId: "ctx_project", path: "assets/screen.jpg" },
      },
      TOOL_CONTEXT,
      {
        callerAgentId: TOOL_CONTEXT.callerAgentId,
        allowedTools: ["AttachmentReadImage"],
      }
    );
    const modelVisible = JSON.stringify(result.output);
    const attachment = toolExecutionModelAttachments(result)?.[0];

    assert.equal(result.status, "completed");
    assertDirectAttachmentFacts(result.output);
    assert.equal(modelVisible.includes("assets/screen.jpg"), true);
    assert.equal(modelVisible.includes(projectRoot), false);
    assert.equal(modelVisible.includes("local-project:"), false);
    assert.equal(attachment?.kind, "image");
    assert.equal(attachment?.filename, "screen.jpg");
    assert.equal(attachment?.source.kind, "data");
    if (attachment?.source.kind === "data") {
      assert.equal(attachment.source.mimeType, "image/jpeg");
      assert.equal(attachment.source.data, image.toString("base64"));
    }
  } finally {
    await fs.rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await fs.rm(projectRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("context attachment image tool reports unsupported when model lacks vision input", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-workspace-"));
  const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-no-vision-"));
  const imageFile = path.join(localRoot, "diagram.png");
  const image = createTinyPngBuffer();
  await fs.writeFile(imageFile, image);
  try {
    const taskSoil = taskSoilWithContext({
      contextRefs: [
        {
          attachmentId: "ctx_diagram",
          ref: `local-file:${imageFile}`,
          kind: "file",
          title: "diagram.png",
          metadata: { available: true, mimeType: "image/png", byteLength: image.length },
        },
      ],
      permissionBoundaryRefs: [`read:local-file:${imageFile}`],
    });
    const center = contextAttachmentToolCenter({ taskSoil, workspaceRoot: workspace, supportsVisionInput: false });
    const result = await center.execute(
      {
        callId: "call:no-vision",
        toolName: "AttachmentReadImage",
        input: { attachmentId: "ctx_diagram" },
      },
      TOOL_CONTEXT,
      {
        callerAgentId: TOOL_CONTEXT.callerAgentId,
        allowedTools: ["AttachmentReadImage"],
      }
    );
    const modelVisible = JSON.stringify(result.output);

    assert.equal(result.status, "completed");
    assertDirectAttachmentFacts(result.output);
    assert.equal(modelVisible.includes("model_does_not_support_vision_input"), true);
    assert.equal(modelVisible.includes("\"attached\":false"), true);
    assert.equal(modelVisible.includes(imageFile), false);
    assert.equal(toolExecutionModelAttachments(result), undefined);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await fs.rm(localRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

function assertDirectAttachmentFacts(value: unknown): void {
  const output = asRecord(value);
  for (const legacyField of ["action", "status", "summary", "result"]) {
    assert.equal(legacyField in output, false, `image output must not contain ${legacyField}`);
  }
}
