import assert from "node:assert/strict";
import test from "node:test";
import {
  DESKTOP_ROOT_AGENT_PROMPT,
  DESKTOP_ROOT_AGENT_PROMPT_LEGACY_VERSION_V6,
} from "./desktop-root-agent-prompt.js";

test("current desktop prompt guides deliberate path-dependent memory use without rewriting v6", () => {
  assert.equal(DESKTOP_ROOT_AGENT_PROMPT.version, "v7");
  assert.match(DESKTOP_ROOT_AGENT_PROMPT.systemPrompt, /optionally use MemorySearch/u);
  assert.match(DESKTOP_ROOT_AGENT_PROMPT.systemPrompt, /use MemoryRead/u);
  assert.match(DESKTOP_ROOT_AGENT_PROMPT.systemPrompt, /use MemoryReference/u);
  assert.match(DESKTOP_ROOT_AGENT_PROMPT.systemPrompt, /use PathDependencySave/u);
  assert.match(DESKTOP_ROOT_AGENT_PROMPT.systemPrompt, /Do not save every task/u);
  assert.equal(DESKTOP_ROOT_AGENT_PROMPT_LEGACY_VERSION_V6.version, "v6");
  assert.equal(DESKTOP_ROOT_AGENT_PROMPT_LEGACY_VERSION_V6.systemPrompt.includes("MemorySearch"), false);
});
