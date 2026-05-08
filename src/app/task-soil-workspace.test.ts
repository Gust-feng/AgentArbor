import assert from "node:assert/strict";
import test from "node:test";
import { createMinimalReadonlySoilStore } from "../domain/soil/index.js";
import { createMinimalSoilConstraints } from "../domain/soil/index.js";
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
    taskSoil: {
      contextRefs: [
        {
          ref: "file:src/app/panel-assets.ts",
          kind: "file",
          summary: "Panel UI source.",
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
  assert.equal(fileRef?.readonlyPreview?.title, "Panel asset");
  assert.equal(fileRef?.readonlyPreview?.text.length <= 640, true);
  assert.equal(fileRef?.readonlyPreview?.truncated, true);
  assert.equal(taskSoil.permissionBoundaryRefs.includes("execute:openai-compatible-ai"), true);
  assert.equal(taskSoil.permissionBoundaryRefs.includes("read:file:src/app/panel-assets.ts"), true);
});

test("Desktop Task Soil input rejects runtime, secret, and write refs", () => {
  assert.throws(
    () =>
      parseDesktopTaskSoilInput({
        contextRefs: [{ ref: "runtime:store/live", kind: "workspace" }],
      }),
    (error) =>
      error instanceof TaskSoilInputValidationError && error.code === "unauthorized_context_ref"
  );
  assert.throws(
    () =>
      parseDesktopTaskSoilInput({
        permissionBoundaryRefs: ["write:file:src/app/panel-assets.ts"],
      }),
    (error) =>
      error instanceof TaskSoilInputValidationError && error.code === "unauthorized_permission_ref"
  );
  assert.throws(
    () =>
      parseDesktopTaskSoilInput({
        permissionBoundaryRefs: ["read:secret:local-dev/model-provider"],
      }),
    (error) =>
      error instanceof TaskSoilInputValidationError && error.code === "unauthorized_permission_ref"
  );
  assert.throws(
    () =>
      parseDesktopTaskSoilInput({
        permissionBoundaryRefs: ["execute:runtime:store/live"],
      }),
    (error) =>
      error instanceof TaskSoilInputValidationError && error.code === "unauthorized_permission_ref"
  );
  assert.throws(
    () =>
      parseDesktopTaskSoilInput({
        permissionBoundaryRefs: ["ask:token:local-value"],
      }),
    (error) =>
      error instanceof TaskSoilInputValidationError && error.code === "unauthorized_permission_ref"
  );
});

test("Desktop Task Soil input redacts common secret shapes from summaries and previews", () => {
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
    goal: "Redact context preview.",
    goalId: "goal-redact",
    traceId: "trace-redact",
    aiMode: "fake",
    constraints,
    soilStore,
    taskSoilInput: parsed,
    createdAt: "2026-05-07T00:00:00.000Z",
  });
  const serialized = JSON.stringify(taskSoil);

  assert.equal(serialized.includes("plain-api-value"), false);
  assert.equal(serialized.includes("summary-token-value"), false);
  assert.equal(serialized.includes("title-token-value"), false);
  assert.equal(serialized.includes("preview-token-value"), false);
  assert.equal(serialized.includes("plain-password-value"), false);
  assert.equal(serialized.includes("[redacted-secret]"), true);
  assert.equal(serialized.includes("[redacted-token]"), true);
});
