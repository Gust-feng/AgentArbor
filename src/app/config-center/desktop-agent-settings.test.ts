import assert from "node:assert/strict";
import test from "node:test";
import {
  DESKTOP_ROOT_AGENT_PROMPT,
  DESKTOP_ROOT_AGENT_PROMPT_ZH,
  DESKTOP_ROOT_AGENT_PROMPT_LEGACY_VERSION_V6,
  DESKTOP_ROOT_AGENT_PROMPT_LEGACY_VERSION_V5,
} from "../agent-prompts/desktop-root-agent-prompt.js";
import {
  normalizeDesktopAgentUpdate,
  parseDesktopAgentSettings,
  toSanitizedDesktopAgentConfig,
  USER_CONFIGURED_DESKTOP_PROMPT_REF,
} from "./desktop-agent-settings.js";

const NOW = "2026-08-03T00:00:00.000Z";

test("the preceding built-in prompt migrates to the current built-in prompt", () => {
  const parsed = parseDesktopAgentSettings({
    systemPrompt: DESKTOP_ROOT_AGENT_PROMPT_LEGACY_VERSION_V6.systemPrompt,
    updatedAt: "2026-07-01T00:00:00.000Z",
  }, NOW);

  assert.deepEqual(parsed, {
    systemPromptMode: "built_in",
    systemPromptVariant: "en",
    updatedAt: "2026-07-01T00:00:00.000Z",
  });
  assert.deepEqual(toSanitizedDesktopAgentConfig(parsed), {
    systemPrompt: DESKTOP_ROOT_AGENT_PROMPT.systemPrompt,
    systemPromptVariant: "en",
    promptRef: "prompt:desktop-root-agent:v8",
    promptVersion: "v8",
    updatedAt: "2026-07-01T00:00:00.000Z",
    isDefault: true,
    maxSystemPromptChars: 20_000,
    variants: [
      { id: "en", label: "English", description: "英文提示词，回答跟随用户使用的语言" },
      { id: "zh-v1", label: "简体中文", description: "中文提示词，回答默认使用简体中文" },
    ],
  });
});

test("the zh built-in prompt variant resolves to the frozen Chinese prompt", () => {
  const parsed = parseDesktopAgentSettings({
    systemPromptMode: "built_in",
    systemPromptVariant: "zh-v1",
    updatedAt: NOW,
  }, NOW);

  assert.deepEqual(parsed, {
    systemPromptMode: "built_in",
    systemPromptVariant: "zh-v1",
    updatedAt: NOW,
  });
  assert.deepEqual(toSanitizedDesktopAgentConfig(parsed), {
    systemPrompt: DESKTOP_ROOT_AGENT_PROMPT_ZH.systemPrompt,
    systemPromptVariant: "zh-v1",
    promptRef: "prompt:desktop-root-agent:zh-v1",
    promptVersion: "zh-v1",
    updatedAt: NOW,
    isDefault: true,
    maxSystemPromptChars: 20_000,
    variants: [
      { id: "en", label: "English", description: "英文提示词，回答跟随用户使用的语言" },
      { id: "zh-v1", label: "简体中文", description: "中文提示词，回答默认使用简体中文" },
    ],
  });
});

test("unknown built-in prompt variants normalize to the English default", () => {
  const parsed = parseDesktopAgentSettings({
    systemPromptMode: "built_in",
    systemPromptVariant: "unknown-variant",
    updatedAt: NOW,
  }, NOW);

  assert.equal(parsed?.systemPromptVariant, "en");
  assert.equal(toSanitizedDesktopAgentConfig(parsed).promptRef, "prompt:desktop-root-agent:v8");
});

test("legacy custom prompts remain explicit user overrides", () => {
  const parsed = parseDesktopAgentSettings({
    systemPrompt: "Use my explicit developer instructions.",
    updatedAt: NOW,
  }, NOW);

  assert.deepEqual(parsed, {
    systemPromptMode: "custom",
    systemPrompt: "Use my explicit developer instructions.",
    systemPromptVariant: "en",
    updatedAt: NOW,
  });
  assert.equal(toSanitizedDesktopAgentConfig(parsed).isDefault, false);
  assert.equal(toSanitizedDesktopAgentConfig(parsed).promptRef, USER_CONFIGURED_DESKTOP_PROMPT_REF);
  assert.match(toSanitizedDesktopAgentConfig(parsed).promptVersion, /^user-[0-9a-f]{12}$/u);
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
    systemPromptVariant: "en",
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
    systemPromptVariant: "en",
    updatedAt: NOW,
  });
  assert.deepEqual(reset, {
    systemPromptMode: "built_in",
    systemPromptVariant: "en",
    updatedAt: NOW,
  });
});

test("variant updates switch the built-in prompt and reset preserves the chosen variant", () => {
  const zh = normalizeDesktopAgentUpdate({ systemPromptVariant: "zh-v1" }, undefined, NOW);
  assert.deepEqual(zh, {
    systemPromptMode: "built_in",
    systemPromptVariant: "zh-v1",
    updatedAt: NOW,
  });
  assert.equal(toSanitizedDesktopAgentConfig(zh).systemPrompt, DESKTOP_ROOT_AGENT_PROMPT_ZH.systemPrompt);

  const custom = normalizeDesktopAgentUpdate({ systemPrompt: "Custom prompt" }, zh, NOW);
  assert.equal(custom.systemPromptMode, "custom");
  assert.equal(custom.systemPromptVariant, "zh-v1");

  const reset = normalizeDesktopAgentUpdate({ resetSystemPrompt: true }, custom, NOW);
  assert.deepEqual(reset, {
    systemPromptMode: "built_in",
    systemPromptVariant: "zh-v1",
    updatedAt: NOW,
  });
});
