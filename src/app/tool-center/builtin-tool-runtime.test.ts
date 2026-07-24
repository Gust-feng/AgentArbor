import assert from "node:assert/strict";
import test from "node:test";
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
