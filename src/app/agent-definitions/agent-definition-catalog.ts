import { AgentDefinitionRegistry } from "./agent-definition-registry.js";
import { runAgentDefinitionRef } from "./agent-definition-ref.js";
import type { AgentDefinition } from "../agent-prompts/contracts.js";
import {
  DESKTOP_ROOT_AGENT,
  DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_1,
  DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V5,
  DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V4,
  DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V3,
  DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V2,
  DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V1,
} from "../agent-prompts/desktop-root-agent.js";

export type RuntimeAgentDefinitionCatalogInput = {
  readonly desktopAgentDefinition?: AgentDefinition;
  readonly additionalDefinitions?: readonly AgentDefinition[];
};

export type RuntimeAgentDefinitionCatalog = {
  readonly desktopAgentDefinition: AgentDefinition;
  readonly registry: AgentDefinitionRegistry;
};

export function createRuntimeAgentDefinitionCatalog(
  input: RuntimeAgentDefinitionCatalogInput = {}
): RuntimeAgentDefinitionCatalog {
  const desktopAgentDefinition = input.desktopAgentDefinition ?? DESKTOP_ROOT_AGENT;
  assertOrdinaryDesktopAgentDefinition(desktopAgentDefinition);
  const builtInDefinitions = definitionsNotAlreadyIncluded(
    [
      DESKTOP_ROOT_AGENT,
      DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V5,
      DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V4,
      DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V3,
      DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V2,
      DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V1,
      DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_1,
    ],
    [desktopAgentDefinition]
  );
  return {
    desktopAgentDefinition,
    registry: new AgentDefinitionRegistry([
      desktopAgentDefinition,
      ...builtInDefinitions,
      ...(input.additionalDefinitions ?? []),
    ]),
  };
}

function assertOrdinaryDesktopAgentDefinition(definition: AgentDefinition): void {
  if (definition.toolVisibilityProfile.runMode !== "agent") {
    throw new Error(
      `Desktop default AgentDefinition must use ordinary agent mode: ${definition.agentId} declares ${definition.toolVisibilityProfile.runMode}.`
    );
  }
  if (definition.turnPolicy.purpose !== "desktop_agent") {
    throw new Error(
      `Desktop default AgentDefinition must use desktop_agent purpose: ${definition.agentId} declares ${definition.turnPolicy.purpose}.`
    );
  }
}

function definitionsNotAlreadyIncluded(
  candidates: readonly AgentDefinition[],
  existing: readonly AgentDefinition[]
): readonly AgentDefinition[] {
  return candidates.filter(
    (candidate) => !existing.some((definition) => sameAgentDefinitionRunRef(candidate, definition))
  );
}

function sameAgentDefinitionRunRef(left: AgentDefinition, right: AgentDefinition): boolean {
  const leftRef = runAgentDefinitionRef(left);
  const rightRef = runAgentDefinitionRef(right);
  return (
    leftRef.agentId === rightRef.agentId &&
    leftRef.promptRef === rightRef.promptRef &&
    leftRef.promptVersion === rightRef.promptVersion &&
    leftRef.outputContractId === rightRef.outputContractId &&
    leftRef.toolVisibilityProfileId === rightRef.toolVisibilityProfileId &&
    leftRef.definitionHash === rightRef.definitionHash
  );
}
