import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createMinimalReadonlySoilStore } from "../../domain/soil/index.js";
import { createMinimalSoilConstraints } from "../../domain/soil/index.js";
import {
  createTaskSoilFromDesktopInput,
  parseDesktopTaskSoilInput,
  TaskSoilInputValidationError,
} from "./task-soil-workspace.js";

test("Desktop Task Soil input keeps goal-only requests compatible", () => {
  const constraints = createMinimalSoilConstraints();
  const soilStore = createMinimalReadonlySoilStore(constraints);
  const taskSoil = createTaskSoilFromDesktopInput({
    goal: "Build a Desktop Shell run.",
    goalId: "goal-test",
    traceId: "trace-test",
    aiMode: "fake",
    constraints,
    soilStore,
    createdAt: "2026-05-07T00:00:00.000Z",
  });

  assert.equal(taskSoil.contextRefs.some((ref) => ref.kind === "user_goal"), true);
  assert.equal(taskSoil.contextRefs.some((ref) => ref.ref === "workspace:goal-test"), true);
  assert.equal(taskSoil.permissionBoundaryRefs.includes("execute:fake-ai"), true);
});

test("Desktop Task Soil input accepts refs, permission refs, and truncated readonly previews", () => {
  const parsed = parseDesktopTaskSoilInput({
    taskSoilInput: {
      contextRefs: [
        {
          attachmentId: "ctx-panel-assets",
          ref: "file:src/app/panel-assets.ts",
          kind: "file",
          title: "panel-assets.ts",
          summary: "Panel UI source.",
          metadata: {
            byteLength: 1234,
            mimeType: "text/typescript",
            available: true,
            truncated: false,
          },
          readonlyPreview: {
            title: "Panel asset",
            text: "safe preview ".repeat(100),
          },
        },
      ],
      permissionBoundaryRefs: ["read:file:src/app/panel-assets.ts", "ask:before-write"],
    },
  });
  const constraints = createMinimalSoilConstraints();
  const soilStore = createMinimalReadonlySoilStore(constraints);
  const taskSoil = createTaskSoilFromDesktopInput({
    goal: "Use the provided context.",
    goalId: "goal-preview",
    traceId: "trace-preview",
    aiMode: "openai-compatible",
    constraints,
    soilStore,
    taskSoilInput: parsed,
    createdAt: "2026-05-07T00:00:00.000Z",
  });
  const fileRef = taskSoil.contextRefs.find((ref) => ref.ref === "file:src/app/panel-assets.ts");

  assert.notEqual(fileRef, undefined);
  assert.equal(fileRef?.attachmentId, "ctx-panel-assets");
  assert.equal(fileRef?.title, "panel-assets.ts");
  assert.deepEqual(fileRef?.metadata, {
    byteLength: 1234,
    mimeType: "text/typescript",
    available: true,
    truncated: false,
  });
  assert.equal(fileRef?.readonlyPreview?.title, "Panel asset");
  assert.equal(fileRef?.readonlyPreview?.text.length <= 640, true);
  assert.equal(fileRef?.readonlyPreview?.truncated, true);
  assert.equal(taskSoil.permissionBoundaryRefs.includes("execute:responses-ai"), true);
  assert.equal(taskSoil.permissionBoundaryRefs.includes("read:file:src/app/panel-assets.ts"), true);
});

test("Desktop Task Soil input rejects unsupported write refs but accepts token-like read refs", () => {
  assert.deepEqual(parseDesktopTaskSoilInput({
    contextRefs: [{ ref: "workspace:secret-notes", kind: "workspace" }],
  }).contextRefs?.[0]?.ref, "workspace:secret-notes");
  assert.throws(
    () =>
      parseDesktopTaskSoilInput({
        permissionBoundaryRefs: ["write:file:src/app/panel-assets.ts"],
      }),
    (error) =>
      error instanceof TaskSoilInputValidationError && error.code === "unauthorized_permission_ref"
  );
  assert.deepEqual(parseDesktopTaskSoilInput({
    permissionBoundaryRefs: ["read:secret:local-dev/model-provider", "execute:runtime:store/live", "ask:token:local-value"],
  }).permissionBoundaryRefs, ["read:secret:local-dev/model-provider", "execute:runtime:store/live", "ask:token:local-value"]);
});

test("Desktop selected local paths become model-visible from matching read permissions", () => {
  const selectedFile = path.resolve("selected/report.md");
  const selectedProject = path.resolve("selected/project");
  const parsed = parseDesktopTaskSoilInput({
    contextRefs: [
      { ref: `local-file:${selectedFile}`, kind: "file" },
      { ref: `local-project:${selectedProject}`, kind: "project" },
    ],
    permissionBoundaryRefs: [
      `read:local-file:${selectedFile}`,
      `read:local-project:${selectedProject}`,
    ],
  });
  const constraints = createMinimalSoilConstraints();
  const taskSoil = createTaskSoilFromDesktopInput({
    goal: "Inspect selected paths.",
    goalId: "goal-selected-paths",
    traceId: "trace-selected-paths",
    aiMode: "fake",
    constraints,
    soilStore: createMinimalReadonlySoilStore(constraints),
    taskSoilInput: parsed,
  });

  assert.equal(taskSoil.contextRefs.find((ref) => ref.ref === `local-file:${selectedFile}`)?.pathGranted, true);
  assert.equal(taskSoil.contextRefs.find((ref) => ref.ref === `local-project:${selectedProject}`)?.pathGranted, true);
});

test("Desktop Task Soil input preserves summaries and previews", () => {
  const parsed = parseDesktopTaskSoilInput({
    taskSoil: {
      contextRefs: [
        {
          ref: "file:notes/context.md",
          kind: "file",
          summary: "Contains api_key=plain-api-value and token: summary-token-value",
          readonlyPreview: {
            title: "Authorization: Bearer title-token-value",
            text: "Preview has Authorization: Bearer preview-token-value and password=plain-password-value.",
          },
        },
      ],
      permissionBoundaryRefs: ["read:file:notes/context.md"],
    },
  });
  const constraints = createMinimalSoilConstraints();
  const soilStore = createMinimalReadonlySoilStore(constraints);
  const taskSoil = createTaskSoilFromDesktopInput({
    goal: "Keep context preview.",
    goalId: "goal-redact",
    traceId: "trace-redact",
    aiMode: "fake",
    constraints,
    soilStore,
    taskSoilInput: parsed,
    createdAt: "2026-05-07T00:00:00.000Z",
  });
  const serialized = JSON.stringify(taskSoil);

  assert.equal(serialized.includes("plain-api-value"), true);
  assert.equal(serialized.includes("summary-token-value"), true);
  assert.equal(serialized.includes("title-token-value"), true);
  assert.equal(serialized.includes("preview-token-value"), true);
  assert.equal(serialized.includes("plain-password-value"), true);
  assert.equal(serialized.includes("[redacted-secret]"), false);
  assert.equal(serialized.includes("[redacted-token]"), false);
});