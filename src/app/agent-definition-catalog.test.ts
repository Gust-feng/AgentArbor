import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimeAgentDefinitionCatalog } from "./agent-definition-catalog.js";
import { runAgentDefinitionRef } from "./agent-definition-runtime.js";
import type { AgentDefinition } from "./agent-prompts/contracts.js";
import {
  DESKTOP_ROOT_AGENT,
  DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_1,
} from "./agent-prompts/desktop-root-agent.js";

test("runtime AgentDefinition catalog owns the default desktop definition and extra definitions", () => {
  const extraDefinition: AgentDefinition = {
    ...DESKTOP_ROOT_AGENT,
    agentId: "catalog-extra-agent",
    displayName: "Catalog Extra Agent",
    prompt: {
      promptRef: "prompt:catalog-extra-agent:v1",
      version: "1",
      systemPrompt: "Extra catalog prompt must remain outside safe refs.",
    },
    toolVisibilityProfile: {
      profileId: "catalog-extra-agent:ordinary-visible-tools:v1",
      runMode: "agent",
      visibleToolScopes: ["desktop-basic"],
    },
  };

  const catalog = createRuntimeAgentDefinitionCatalog({
    additionalDefinitions: [extraDefinition],
  });

  assert.equal(catalog.desktopAgentDefinition, DESKTOP_ROOT_AGENT);
  assert.equal(runAgentDefinitionRef(catalog.desktopAgentDefinition).promptVersion, "v1");
  assert.equal(catalog.registry.resolve(runAgentDefinitionRef(DESKTOP_ROOT_AGENT)), DESKTOP_ROOT_AGENT);
  assert.equal(
    catalog.registry.resolve(runAgentDefinitionRef(DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_1)),
    DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_1
  );
  assert.equal(catalog.registry.resolve(runAgentDefinitionRef(extraDefinition)), extraDefinition);
});

test("runtime AgentDefinition catalog treats custom desktop definition as the run default", () => {
  const desktopDefinition: AgentDefinition = {
    ...DESKTOP_ROOT_AGENT,
    agentId: "catalog-custom-desktop-agent",
    displayName: "Catalog Custom Desktop Agent",
    prompt: {
      promptRef: "prompt:catalog-custom-desktop-agent:v1",
      version: "1",
      systemPrompt: "Custom desktop catalog prompt.",
    },
    toolVisibilityProfile: {
      profileId: "catalog-custom-desktop-agent:ordinary-visible-tools:v1",
      runMode: "agent",
      visibleToolScopes: ["desktop-basic"],
    },
  };

  const catalog = createRuntimeAgentDefinitionCatalog({ desktopAgentDefinition: desktopDefinition });

  assert.equal(catalog.desktopAgentDefinition, desktopDefinition);
  assert.equal(catalog.registry.resolve(runAgentDefinitionRef(desktopDefinition)), desktopDefinition);
  assert.equal(catalog.registry.resolve(runAgentDefinitionRef(DESKTOP_ROOT_AGENT)), DESKTOP_ROOT_AGENT);
  assert.equal(
    catalog.registry.resolve(runAgentDefinitionRef(DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_1)),
    DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_1
  );
});

test("runtime AgentDefinition catalog rejects deep definitions as the desktop default", () => {
  const deepDefinition: AgentDefinition = {
    ...DESKTOP_ROOT_AGENT,
    agentId: "catalog-deep-agent",
    displayName: "Catalog Deep Agent",
    prompt: {
      promptRef: "prompt:catalog-deep-agent:v1",
      version: "1",
      systemPrompt: "Deep catalog prompt.",
    },
    toolVisibilityProfile: {
      profileId: "catalog-deep-agent:deep-visible-tools:v1",
      runMode: "deep",
      visibleToolScopes: ["underground"],
    },
  };

  assert.throws(
    () => createRuntimeAgentDefinitionCatalog({ desktopAgentDefinition: deepDefinition }),
    /Desktop default AgentDefinition must use ordinary agent mode/
  );
});

test("runtime AgentDefinition catalog can register deep definitions without making them default", () => {
  const deepDefinition: AgentDefinition = {
    ...DESKTOP_ROOT_AGENT,
    agentId: "catalog-extra-deep-agent",
    displayName: "Catalog Extra Deep Agent",
    prompt: {
      promptRef: "prompt:catalog-extra-deep-agent:v1",
      version: "1",
      systemPrompt: "Extra deep catalog prompt.",
    },
    toolVisibilityProfile: {
      profileId: "catalog-extra-deep-agent:deep-visible-tools:v1",
      runMode: "deep",
      visibleToolScopes: ["underground"],
    },
  };

  const catalog = createRuntimeAgentDefinitionCatalog({
    additionalDefinitions: [deepDefinition],
  });

  assert.equal(catalog.desktopAgentDefinition, DESKTOP_ROOT_AGENT);
  assert.equal(catalog.registry.resolve(runAgentDefinitionRef(deepDefinition)), deepDefinition);
});
