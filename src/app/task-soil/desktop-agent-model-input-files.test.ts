import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CodedExecutionError } from "../execution-errors/index.js";
import type { ModelCapabilities } from "../../domain/config/index.js";
import type { ModelMessage } from "../../domain/intelligence/index.js";
import { createTaskSoil } from "../../domain/soil/index.js";
import { attachDesktopFileInputsToModelMessages } from "./desktop-agent-model-input-files.js";

const VISION_CAPABILITIES: ModelCapabilities = {
  contextWindowTokens: 128_000,
  maxOutputTokens: 16_384,
  supportsToolCalling: true,
  supportsParallelToolCalls: true,
  supportsStructuredOutputs: true,
  supportsStreaming: true,
  supportsVisionInput: true,
  supportsReasoningEffort: false,
  supportsReasoningOutput: false,
  preferredApiStyle: "responses",
  stability: "stable",
};

test("Desktop Agent resolves authorized local image refs into ephemeral model attachments", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-model-file-input-"));
  const imagePath = path.join(root, "screen.png");
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  await fs.writeFile(imagePath, bytes);
  try {
    const taskSoil = createTaskSoil({
      rawGoal: "describe the image",
      goalId: "goal-image",
      traceId: "trace-image",
      contextRefs: [{
        attachmentId: "ctx-screen",
        ref: `local-file:${imagePath}`,
        kind: "file",
        title: "screen.png",
        summary: "Selected image file.",
        metadata: {
          byteLength: bytes.length,
          mimeType: "image/png",
          available: true,
          truncated: false,
        },
      }],
      permissionBoundaryRefs: [`read:local-file:${imagePath}`],
    });
    const messages: readonly ModelMessage[] = [
      { role: "system", content: "You are a desktop agent." },
      { role: "user", content: "Describe the attached image.", ref: "context:goal:goal-image" },
    ];

    const resolved = await attachDesktopFileInputsToModelMessages({
      messages,
      taskSoil,
      modelCapabilities: VISION_CAPABILITIES,
      workspaceRoot: root,
    });

    const user = resolved.at(-1);
    assert.equal(user?.role, "user");
    assert.equal(user?.attachments?.length, 1);
    assert.equal(user?.attachments?.[0]?.kind, "image");
    assert.equal(user?.attachments?.[0]?.attachmentId, "ctx-screen");
    assert.equal(user?.attachments?.[0]?.inputRef, `local-file:${imagePath}`);
    assert.deepEqual(user?.attachments?.[0]?.source, {
      kind: "data",
      mimeType: "image/png",
      data: bytes.toString("base64"),
    });
    assert.equal(user?.content, "Describe the attached image.");
    assert.equal(JSON.stringify(taskSoil).includes(bytes.toString("base64")), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("Desktop Agent still resolves image bytes for non-vision models so a later vision model can read them", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-model-file-input-no-vision-"));
  const imagePath = path.join(root, "screen.png");
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  await fs.writeFile(imagePath, bytes);
  try {
    const taskSoil = createTaskSoil({
      rawGoal: "describe the image",
      goalId: "goal-no-vision",
      traceId: "trace-no-vision",
      contextRefs: [{ ref: `local-file:${imagePath}`, kind: "file", title: "screen.png" }],
      permissionBoundaryRefs: [`read:local-file:${imagePath}`],
    });
    const messages: readonly ModelMessage[] = [{ role: "user", content: "Describe the image." }];

    const resolved = await attachDesktopFileInputsToModelMessages({
      messages,
      taskSoil,
      modelCapabilities: { ...VISION_CAPABILITIES, supportsVisionInput: false },
      workspaceRoot: root,
    });

    // Bytes must still be attached: they enter the durable Pi Session and the
    // loop context boundary substitutes a text notice for this text-only run.
    const user = resolved.at(-1);
    assert.equal(user?.role, "user");
    assert.equal(user?.content, "Describe the image.");
    assert.equal(user?.attachments?.length, 1);
    assert.deepEqual(user?.attachments?.[0]?.source, {
      kind: "data",
      mimeType: "image/png",
      data: bytes.toString("base64"),
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("Desktop Agent reports unreadable image refs as a text notice for non-vision models instead of failing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-model-file-input-missing-no-vision-"));
  const imagePath = path.join(root, "missing.png");
  try {
    const taskSoil = createTaskSoil({
      rawGoal: "describe the image",
      goalId: "goal-missing-no-vision",
      traceId: "trace-missing-no-vision",
      contextRefs: [{ ref: `local-file:${imagePath}`, kind: "file", metadata: { mimeType: "image/png" } }],
      permissionBoundaryRefs: [`read:local-file:${imagePath}`],
    });

    const resolved = await attachDesktopFileInputsToModelMessages({
      messages: [{ role: "user", content: "Describe the image." }],
      taskSoil,
      modelCapabilities: { ...VISION_CAPABILITIES, supportsVisionInput: false },
      workspaceRoot: root,
    });

    const user = resolved.at(-1);
    assert.equal(user?.role, "user");
    assert.equal(user?.attachments, undefined);
    assert.equal(user?.content.includes("could not be delivered"), true);
    assert.equal(user?.content.includes(`local-file:${imagePath}`), true);
    assert.equal(user?.content.includes("Describe the image."), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("Desktop Agent does not turn Space-injected image references into automatic model attachments", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-model-file-input-space-"));
  const imagePath = path.join(root, "standing.png");
  await fs.writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  try {
    const taskSoil = createTaskSoil({
      rawGoal: "continue",
      goalId: "goal-space-injected",
      traceId: "trace-space-injected",
      contextRefs: [{
        attachmentId: "space-reference:reference-1",
        ref: `local-file:${imagePath}`,
        kind: "file",
        title: "standing.png",
        summary: "当前对话所属空间授权的本地资源。",
      }],
      permissionBoundaryRefs: [`read:local-file:${imagePath}`],
    });
    const messages: readonly ModelMessage[] = [{ role: "user", content: "Continue." }];

    const resolved = await attachDesktopFileInputsToModelMessages({
      messages,
      taskSoil,
      modelCapabilities: VISION_CAPABILITIES,
      workspaceRoot: root,
    });

    // Standing Space context must not resurface as this turn's image input.
    assert.equal(resolved, messages);
    assert.equal(resolved[0]?.attachments, undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("Desktop Agent ignores Space-injected image references for non-vision models without a notice", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-model-file-input-space-no-vision-"));
  const imagePath = path.join(root, "standing.png");
  await fs.writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  try {
    const taskSoil = createTaskSoil({
      rawGoal: "continue",
      goalId: "goal-space-injected-no-vision",
      traceId: "trace-space-injected-no-vision",
      contextRefs: [{
        attachmentId: "space-reference:reference-1",
        ref: `local-file:${imagePath}`,
        kind: "file",
        title: "standing.png",
      }],
      permissionBoundaryRefs: [`read:local-file:${imagePath}`],
    });

    const resolved = await attachDesktopFileInputsToModelMessages({
      messages: [{ role: "user", content: "Continue." }],
      taskSoil,
      modelCapabilities: { ...VISION_CAPABILITIES, supportsVisionInput: false },
      workspaceRoot: root,
    });

    assert.equal(resolved[0]?.attachments, undefined);
    assert.equal(resolved[0]?.content, "Continue.");
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("Desktop Agent rejects an image ref that becomes unreadable before model preparation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-model-file-input-missing-"));
  const imagePath = path.join(root, "missing.png");
  try {
    const taskSoil = createTaskSoil({
      rawGoal: "describe the image",
      goalId: "goal-missing-image",
      traceId: "trace-missing-image",
      contextRefs: [{ ref: `local-file:${imagePath}`, kind: "file", metadata: { mimeType: "image/png" } }],
      permissionBoundaryRefs: [`read:local-file:${imagePath}`],
    });

    await assert.rejects(
      attachDesktopFileInputsToModelMessages({
        messages: [{ role: "user", content: "Describe the image." }],
        taskSoil,
        modelCapabilities: VISION_CAPABILITIES,
        workspaceRoot: root,
      }),
      (error: unknown) => error instanceof CodedExecutionError && error.code === "model_input_attachment_unavailable",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("Desktop Agent rechecks live attachment authorization before reading a user-selected image", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-model-file-input-revoked-"));
  const imagePath = path.join(root, "replaced.png");
  await fs.writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  try {
    const taskSoil = createTaskSoil({
      rawGoal: "describe the image",
      contextRefs: [{
        attachmentId: "ctx:user-selected-image",
        ref: `local-file:${imagePath}`,
        kind: "file",
        metadata: { mimeType: "image/png" },
      }],
      permissionBoundaryRefs: [`read:local-file:${imagePath}`],
    });
    const checked: string[] = [];

    await assert.rejects(
      attachDesktopFileInputsToModelMessages({
        messages: [{ role: "user", content: "Describe the image." }],
        taskSoil,
        modelCapabilities: VISION_CAPABILITIES,
        workspaceRoot: root,
        readAuthorization: {
          assertReadAllowed(attachmentId) {
            checked.push(attachmentId);
            throw new Error("the Space reference no longer points to its original source");
          },
        },
      }),
      (error: unknown) => error instanceof CodedExecutionError &&
        error.code === "model_input_attachment_unavailable" &&
        error.message.includes("no longer points to its original source"),
    );
    assert.deepEqual(checked, ["ctx:user-selected-image"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("Desktop Agent resolves authorized managed images without persisting their storage path", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-model-managed-image-"));
  const imagePath = path.join(root, "content");
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  await fs.writeFile(imagePath, bytes);
  try {
    const taskSoil = createTaskSoil({
      rawGoal: "describe the managed image",
      goalId: "goal-managed-image",
      traceId: "trace-managed-image",
      contextRefs: [{
        attachmentId: "managed-image",
        ref: "uploaded-attachment:managed-image",
        kind: "file",
        title: "screen.png",
        metadata: { byteLength: bytes.length, mimeType: "image/png", available: true },
      }],
      permissionBoundaryRefs: ["read:uploaded-attachment:managed-image"],
    });
    const messages: readonly ModelMessage[] = [{ role: "user", content: "Describe it." }];
    const resolvedIds: string[] = [];

    const resolved = await attachDesktopFileInputsToModelMessages({
      messages,
      taskSoil,
      modelCapabilities: VISION_CAPABILITIES,
      resolveManagedAttachmentPath: async (attachmentId) => {
        resolvedIds.push(attachmentId);
        return imagePath;
      },
    });

    assert.deepEqual(resolvedIds, ["managed-image"]);
    assert.equal(resolved[0]?.attachments?.[0]?.inputRef, "uploaded-attachment:managed-image");
    assert.deepEqual(resolved[0]?.attachments?.[0]?.source, {
      kind: "data",
      mimeType: "image/png",
      data: bytes.toString("base64"),
    });
    assert.equal(JSON.stringify(taskSoil).includes(imagePath), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
