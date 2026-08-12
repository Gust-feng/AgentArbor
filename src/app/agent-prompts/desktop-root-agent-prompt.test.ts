import assert from "node:assert/strict";
import test from "node:test";
import {
  DESKTOP_ROOT_AGENT_PROMPT,
  DESKTOP_ROOT_AGENT_PROMPT_LEGACY_VERSION_V7,
  DESKTOP_ROOT_AGENT_PROMPT_LEGACY_VERSION_V6,
} from "./desktop-root-agent-prompt.js";

test("current desktop prompt guides deliberate personal knowledge use without rewriting v7", () => {
  assert.equal(DESKTOP_ROOT_AGENT_PROMPT.version, "v8");
  assert.match(DESKTOP_ROOT_AGENT_PROMPT.systemPrompt, /Use the user's personal knowledge deliberately/u);
  assert.match(DESKTOP_ROOT_AGENT_PROMPT.systemPrompt, /enumerate with KnowledgeList/u);
  assert.match(DESKTOP_ROOT_AGENT_PROMPT.systemPrompt, /search with KnowledgeSearch/u);
  assert.match(DESKTOP_ROOT_AGENT_PROMPT.systemPrompt, /read with KnowledgeRead or KnowledgeReadPage/u);
  assert.match(DESKTOP_ROOT_AGENT_PROMPT.systemPrompt, /distinct from the <agent_notes> working context/u);
  assert.match(DESKTOP_ROOT_AGENT_PROMPT.systemPrompt, /report conflicts instead of overwriting newer content/u);
  assert.equal(DESKTOP_ROOT_AGENT_PROMPT_LEGACY_VERSION_V7.version, "v7");
  assert.equal(DESKTOP_ROOT_AGENT_PROMPT_LEGACY_VERSION_V7.systemPrompt.includes("KnowledgeList"), false);
  assert.equal(DESKTOP_ROOT_AGENT_PROMPT_LEGACY_VERSION_V6.systemPrompt.includes("MemorySearch"), false);
});
