import assert from "node:assert/strict";
import test from "node:test";
import {
  DESKTOP_ROOT_AGENT_PROMPT,
  DESKTOP_ROOT_AGENT_PROMPT_LEGACY_VERSION_V5,
} from "../agent-prompts/desktop-root-agent-prompt.js";
import {
  normalizeDesktopAgentUpdate,
  parseDesktopAgentSettings,
  toSanitizedDesktopAgentConfig,
} from "./desktop-agent-settings.js";

const NOW = "2026-08-03T00:00:00.000Z";

test("legacy built-in prompts migrate to the current built-in prompt", () => {
  const parsed = parseDesktopAgentSettings({
    systemPrompt: DESKTOP_ROOT_AGENT_PROMPT_LEGACY_VERSION_V5.systemPrompt,
    updatedAt: "2026-07-01T00:00:00.000Z",
  }, NOW);

  assert.deepEqual(parsed, {
    systemPromptMode: "built_in",
    updatedAt: "2026-07-01T00:00:00.000Z",
  });
  assert.deepEqual(toSanitizedDesktopAgentConfig(parsed), {
    systemPrompt: DESKTOP_ROOT_AGENT_PROMPT.systemPrompt,
    updatedAt: "2026-07-01T00:00:00.000Z",
    isDefault: true,
    maxSystemPromptChars: 20_000,
  });
});

test("legacy custom prompts remain explicit user overrides", () => {
  const parsed = parseDesktopAgentSettings({
    systemPrompt: "Use my explicit developer instructions.",
    updatedAt: NOW,
  }, NOW);

  assert.deepEqual(parsed, {
    systemPromptMode: "custom",
    systemPrompt: "Use my explicit developer instructions.",
    updatedAt: NOW,
  });
  assert.equal(toSanitizedDesktopAgentConfig(parsed).isDefault, false);
});

test("explicit custom mode remains an override even when its text matches a built-in prompt", () => {
  const parsed = parseDesktopAgentSettings({
    systemPromptMode: "custom",
    systemPrompt: DESKTOP_ROOT_AGENT_PROMPT_LEGACY_VERSION_V5.systemPrompt,
    updatedAt: NOW,
  }, NOW);

  assert.deepEqual(parsed, {
    systemPromptMode: "custom",
    systemPrompt: DESKTOP_ROOT_AGENT_PROMPT_LEGACY_VERSION_V5.systemPrompt,
    updatedAt: NOW,
  });
  assert.equal(toSanitizedDesktopAgentConfig(parsed).isDefault, false);
});

test("Desktop Agent updates distinguish explicit overrides from built-in reset", () => {
  const custom = normalizeDesktopAgentUpdate({ systemPrompt: "Custom prompt" }, undefined, NOW);
  const reset = normalizeDesktopAgentUpdate({ resetSystemPrompt: true }, custom, NOW);

  assert.deepEqual(custom, {
    systemPromptMode: "custom",
    systemPrompt: "Custom prompt",
    updatedAt: NOW,
  });
  assert.deepEqual(reset, {
    systemPromptMode: "built_in",
    updatedAt: NOW,
  });
});
