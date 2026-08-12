import assert from "node:assert/strict";
import test from "node:test";
import { runAgentDefinitionRef } from "../agent-definitions/agent-definition-runtime.js";
import { desktopAgentDefinitionFromConfig } from "../agent-prompts/desktop-agent-configured-definition.js";
import {
  DESKTOP_ROOT_AGENT,
  DESKTOP_ROOT_AGENT_ZH,
} from "../agent-prompts/desktop-root-agent.js";
import { DESKTOP_ROOT_AGENT_PROMPT_ZH } from "../agent-prompts/desktop-root-agent-prompt.js";
import { reconstructFrozenOrdinaryDefinition } from "./runtime.js";

test("frozen custom Ordinary definitions can be reconstructed after process restart", () => {
  const configured = desktopAgentDefinitionFromConfig(DESKTOP_ROOT_AGENT, {
    systemPrompt: "Use the persisted custom Ordinary instructions.",
    systemPromptVariant: "latest",
    promptRef: "prompt:desktop-root-agent:user-configured",
    promptVersion: "user-a1b2c3d4e5f6",
    updatedAt: "2026-07-15T00:00:00.000Z",
    isDefault: false,
    maxSystemPromptChars: 100_000,
    variants: [],
  });
  const ref = runAgentDefinitionRef(configured);

  assert.deepEqual(
    reconstructFrozenOrdinaryDefinition(DESKTOP_ROOT_AGENT, ref, configured.prompt.systemPrompt),
    configured,
  );
  assert.equal(
    reconstructFrozenOrdinaryDefinition(DESKTOP_ROOT_AGENT, ref, "different instructions"),
    undefined,
  );
});

test("the zh built-in variant builds the frozen Chinese definition and matches the catalog definition", () => {
  const configured = desktopAgentDefinitionFromConfig(DESKTOP_ROOT_AGENT, {
    systemPrompt: DESKTOP_ROOT_AGENT_PROMPT_ZH.systemPrompt,
    systemPromptVariant: "zh-v1",
    promptRef: "prompt:desktop-root-agent:zh-v1",
    promptVersion: "zh-v1",
    updatedAt: "2026-08-13T00:00:00.000Z",
    isDefault: true,
    maxSystemPromptChars: 20_000,
    variants: [],
  });

  assert.equal(configured.prompt.systemPrompt, DESKTOP_ROOT_AGENT_PROMPT_ZH.systemPrompt);
  assert.equal(configured.prompt.promptRef, "prompt:desktop-root-agent:zh-v1");
  assert.deepEqual(
    runAgentDefinitionRef(configured),
    runAgentDefinitionRef(DESKTOP_ROOT_AGENT_ZH),
  );
});

test("the current default built-in config keeps the base definition", () => {
  const configured = desktopAgentDefinitionFromConfig(DESKTOP_ROOT_AGENT, {
    systemPrompt: DESKTOP_ROOT_AGENT.prompt.systemPrompt,
    systemPromptVariant: "latest",
    promptRef: DESKTOP_ROOT_AGENT.prompt.promptRef,
    promptVersion: DESKTOP_ROOT_AGENT.prompt.version,
    updatedAt: "2026-08-13T00:00:00.000Z",
    isDefault: true,
    maxSystemPromptChars: 20_000,
    variants: [],
  });

  assert.equal(configured, DESKTOP_ROOT_AGENT);
});
