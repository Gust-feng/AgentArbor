import assert from "node:assert/strict";
import test from "node:test";
import { createTaskSoil } from "../../domain/soil/index.js";
import { createAgentToolRegistry } from "./builtin-tool-runtime.js";

test("C05 production registry keeps the minimal workspace tool surface", () => {
  const registry = createAgentToolRegistry({ env: {}, playwrightAvailable: false });
  const names = new Set([
    ...registry.catalog("agent-basic").allowedTools,
    ...registry.catalog("workspace").allowedTools,
  ]);

  for (const required of ["Read", "Glob", "Grep", "Write", "Edit", "Shell", "ProcessRead", "ProcessStop"]) {
    assert.equal(names.has(required), true, `${required} must remain registered.`);
  }
  assert.equal(names.has("List"), false);
  assert.equal(names.has("Delete"), false);
});

test("context attachment tools stay hidden for an attachment-less run unless the Host declares exposure", () => {
  const emptyTaskSoil = createTaskSoil({
    rawGoal: "no attachments",
    contextRefs: [],
    permissionBoundaryRefs: [],
  });
  const hidden = createAgentToolRegistry({ env: {}, playwrightAvailable: false, taskSoil: emptyTaskSoil }).createToolCenter("agent-basic");
  assert.equal(hidden.has("AttachmentList"), false, "a run with no attachments must not expose empty attachment tools by default");

  const exposed = createAgentToolRegistry({
    env: {},
    playwrightAvailable: false,
    taskSoil: emptyTaskSoil,
    exposeContextAttachmentToolsWhenEmpty: true,
  }).createToolCenter("agent-basic");
  assert.equal(exposed.has("AttachmentList"), true, "a Host-declared run keeps AttachmentList visible with zero attachments");
});
