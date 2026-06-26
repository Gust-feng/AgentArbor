import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ModelCapabilities } from "../domain/config/index.js";
import type { ModelMessage } from "../domain/intelligence/index.js";
import { createTaskSoil } from "../domain/soil/index.js";
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
    assert.equal(user?.content.includes("attachment_id=ctx-screen"), true);
    assert.equal(user?.content.includes(imagePath), false);
    assert.equal(user?.content.includes(bytes.toString("base64")), false);
    assert.equal(JSON.stringify(taskSoil).includes(bytes.toString("base64")), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Desktop Agent does not attach image payloads for non-vision models", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-model-file-input-no-vision-"));
  const imagePath = path.join(root, "screen.png");
  await fs.writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  try {
    const taskSoil = createTaskSoil({
      rawGoal: "describe the image",
      goalId: "goal-no-vision",
      traceId: "trace-no-vision",
      contextRefs: [{ ref: `local-file:${imagePath}`, kind: "file" }],
      permissionBoundaryRefs: [`read:local-file:${imagePath}`],
    });
    const messages: readonly ModelMessage[] = [{ role: "user", content: "Describe the image." }];

    const resolved = await attachDesktopFileInputsToModelMessages({
      messages,
      taskSoil,
      modelCapabilities: { ...VISION_CAPABILITIES, supportsVisionInput: false },
      workspaceRoot: root,
    });

    assert.equal(resolved[0]?.attachments, undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
