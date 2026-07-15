import assert from "node:assert/strict";
import test from "node:test";
import { runAgentDefinitionRef } from "../agent-definitions/agent-definition-runtime.js";
import { desktopAgentDefinitionFromConfig } from "../agent-prompts/desktop-agent-configured-definition.js";
import { DESKTOP_ROOT_AGENT } from "../agent-prompts/desktop-root-agent.js";
import { reconstructFrozenOrdinaryDefinition } from "./runtime.js";

test("frozen custom Ordinary definitions can be reconstructed after process restart", () => {
  const configured = desktopAgentDefinitionFromConfig(DESKTOP_ROOT_AGENT, {
    systemPrompt: "Use the persisted custom Ordinary instructions.",
    updatedAt: "2026-07-15T00:00:00.000Z",
    isDefault: false,
    maxSystemPromptChars: 100_000,
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
