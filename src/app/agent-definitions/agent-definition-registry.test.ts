import assert from "node:assert/strict";
import test from "node:test";
import { AgentDefinitionRegistry } from "./agent-definition-registry.js";
import { agentDefinitionHash, runAgentDefinitionRef } from "./agent-definition-runtime.js";
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

test("AgentDefinitionRegistry resolves definitions by exact safe run ref", () => {
  const customAgent: AgentDefinition = {
    ...DESKTOP_ROOT_AGENT,
    agentId: "custom-registry-agent",
    displayName: "Custom Registry Agent",
    prompt: {
      promptRef: "prompt:custom-registry-agent:v1",
      version: "1",
      systemPrompt: "Registry test prompt must not be part of the safe ref.",
    },
    toolVisibilityProfile: {
      profileId: "custom-registry-agent:ordinary-visible-tools:v1",
      runMode: "agent",
      visibleToolScopes: ["desktop-basic"],
    },
  };
  const registry = new AgentDefinitionRegistry([DESKTOP_ROOT_AGENT, customAgent]);
  const ref = runAgentDefinitionRef(customAgent);

  assert.equal(registry.resolve(ref), customAgent);
  assert.equal(registry.resolve({ ...ref, promptVersion: "2" }), undefined);
  assert.deepEqual(Object.keys(ref).sort(), [
    "agentDisplayName",
    "agentId",
    "definitionHash",
    "outputContractId",
    "promptRef",
    "promptVersion",
    "toolVisibilityProfileId",
  ]);
  assert.equal(ref.definitionHash?.startsWith("sha256:"), true);
  assert.equal(JSON.stringify(ref).includes(customAgent.prompt.systemPrompt), false);
  assert.equal(JSON.stringify(ref).includes("systemPrompt"), false);
  assert.equal(JSON.stringify(ref).includes("turnPolicy"), false);
});

test("AgentDefinitionRegistry resolves current and legacy desktop root prompt versions", () => {
  const registry = new AgentDefinitionRegistry([
    DESKTOP_ROOT_AGENT,
    DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V5,
    DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V4,
    DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V3,
    DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V2,
    DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V1,
    DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_1,
  ]);
  const currentRef = runAgentDefinitionRef(DESKTOP_ROOT_AGENT);
  const legacyV5Ref = runAgentDefinitionRef(DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V5);
  const legacyV4Ref = runAgentDefinitionRef(DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V4);
  const legacyV3Ref = runAgentDefinitionRef(DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V3);
  const legacyV2Ref = runAgentDefinitionRef(DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V2);
  const legacyV1Ref = runAgentDefinitionRef(DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V1);
  const legacyRef = runAgentDefinitionRef(DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_1);

  assert.equal(currentRef.promptVersion, "v6");
  assert.equal(legacyV5Ref.promptVersion, "v5");
  assert.equal(legacyV4Ref.promptVersion, "v4");
  assert.equal(legacyV3Ref.promptVersion, "v3");
  assert.equal(legacyV2Ref.promptVersion, "v2");
  assert.equal(legacyV1Ref.promptVersion, "v1");
  assert.equal(legacyRef.promptVersion, "1");
  assert.notEqual(agentDefinitionHash(DESKTOP_ROOT_AGENT), agentDefinitionHash(DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V5));
  assert.notEqual(
    agentDefinitionHash(DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V5),
    agentDefinitionHash(DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V4)
  );
  assert.notEqual(
    agentDefinitionHash(DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V4),
    agentDefinitionHash(DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V3)
  );
  assert.notEqual(
    agentDefinitionHash(DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V3),
    agentDefinitionHash(DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V2)
  );
  assert.notEqual(
    agentDefinitionHash(DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V2),
    agentDefinitionHash(DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V1)
  );
  assert.notEqual(
    agentDefinitionHash(DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V1),
    agentDefinitionHash(DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_1)
  );
  assert.equal(registry.resolve(currentRef), DESKTOP_ROOT_AGENT);
  assert.equal(registry.resolve(legacyV5Ref), DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V5);
  assert.equal(registry.resolve(legacyV4Ref), DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V4);
  assert.equal(registry.resolve(legacyV3Ref), DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V3);
  assert.equal(registry.resolve(legacyV2Ref), DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V2);
  assert.equal(registry.resolve(legacyV1Ref), DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V1);
  assert.equal(registry.resolve(legacyRef), DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_1);
});

test("AgentDefinitionRegistry keeps display names out of execution identity", () => {
  const customAgent: AgentDefinition = {
    ...DESKTOP_ROOT_AGENT,
    agentId: "renamable-registry-agent",
    displayName: "Renamable Registry Agent",
    prompt: {
      promptRef: "prompt:renamable-registry-agent:v1",
      version: "1",
      systemPrompt: "Renamable registry prompt must not be part of the safe ref.",
    },
    toolVisibilityProfile: {
      profileId: "renamable-registry-agent:ordinary-visible-tools:v1",
      runMode: "agent",
      visibleToolScopes: ["desktop-basic"],
    },
  };
  const registry = new AgentDefinitionRegistry([DESKTOP_ROOT_AGENT, customAgent]);
  const ref = runAgentDefinitionRef(customAgent);

  assert.equal(registry.resolve({ ...ref, agentDisplayName: "Renamed Ordinary Agent" }), customAgent);
  assert.equal(
    registry.resolve({
      ...ref,
      agentDisplayName: "Renamed Ordinary Agent",
      outputContractId: "different-output-contract",
    }),
    undefined
  );
});

test("AgentDefinitionRegistry rejects semantic drift for hashed refs", () => {
  const customAgent: AgentDefinition = {
    ...DESKTOP_ROOT_AGENT,
    agentId: "drift-checked-registry-agent",
    displayName: "Drift Checked Registry Agent",
    prompt: {
      promptRef: "prompt:drift-checked-registry-agent:v1",
      version: "1",
      systemPrompt: "Original registry prompt.",
    },
    toolVisibilityProfile: {
      profileId: "drift-checked-registry-agent:ordinary-visible-tools:v1",
      runMode: "agent",
      visibleToolScopes: ["desktop-basic"],
    },
  };
  const ref = runAgentDefinitionRef(customAgent);
  const changedAgent: AgentDefinition = {
    ...customAgent,
    prompt: {
      ...customAgent.prompt,
      systemPrompt: "Changed registry prompt.",
    },
  };
  const registry = new AgentDefinitionRegistry([changedAgent]);

  assert.equal(registry.resolve(ref), undefined);
});

test("AgentDefinitionRegistry rejects turn policy drift for hashed refs", () => {
  const customAgent: AgentDefinition = {
    ...DESKTOP_ROOT_AGENT,
    agentId: "turn-policy-drift-agent",
    displayName: "Turn Policy Drift Agent",
    prompt: {
      promptRef: "prompt:turn-policy-drift-agent:v1",
      version: "1",
      systemPrompt: "Turn policy drift registry prompt.",
    },
    toolVisibilityProfile: {
      profileId: "turn-policy-drift-agent:ordinary-visible-tools:v1",
      runMode: "agent",
      visibleToolScopes: ["desktop-basic"],
    },
  };
  const ref = runAgentDefinitionRef(customAgent);
  const changedAgent: AgentDefinition = {
    ...customAgent,
    turnPolicy: {
      ...customAgent.turnPolicy,
      maxModelRounds: 0,
    },
  };
  const registry = new AgentDefinitionRegistry([changedAgent]);

  assert.notEqual(agentDefinitionHash(customAgent), agentDefinitionHash(changedAgent));
  assert.equal(registry.resolve(ref), undefined);
});

test("AgentDefinitionRegistry rejects output contract drift for hashed refs", () => {
  const customAgent: AgentDefinition = {
    ...DESKTOP_ROOT_AGENT,
    agentId: "output-contract-drift-agent",
    displayName: "Output Contract Drift Agent",
    prompt: {
      promptRef: "prompt:output-contract-drift-agent:v1",
      version: "1",
      systemPrompt: "Output contract drift registry prompt.",
    },
    toolVisibilityProfile: {
      profileId: "output-contract-drift-agent:ordinary-visible-tools:v1",
      runMode: "agent",
      visibleToolScopes: ["desktop-basic"],
    },
  };
  const ref = runAgentDefinitionRef(customAgent);
  const changedAgent: AgentDefinition = {
    ...customAgent,
    outputContract: {
      ...customAgent.outputContract,
      requiredFields: [...(customAgent.outputContract.requiredFields ?? []), "extra_field"],
    },
  };
  const registry = new AgentDefinitionRegistry([changedAgent]);

  assert.notEqual(agentDefinitionHash(customAgent), agentDefinitionHash(changedAgent));
  assert.equal(registry.resolve(ref), undefined);
});

test("AgentDefinitionRegistry rejects tool visibility drift for hashed refs", () => {
  const customAgent: AgentDefinition = {
    ...DESKTOP_ROOT_AGENT,
    agentId: "tool-visibility-drift-agent",
    displayName: "Tool Visibility Drift Agent",
    prompt: {
      promptRef: "prompt:tool-visibility-drift-agent:v1",
      version: "1",
      systemPrompt: "Tool visibility drift registry prompt.",
    },
    toolVisibilityProfile: {
      profileId: "tool-visibility-drift-agent:ordinary-visible-tools:v1",
      runMode: "agent",
      visibleToolScopes: ["desktop-basic"],
    },
  };
  const ref = runAgentDefinitionRef(customAgent);
  const changedAgent: AgentDefinition = {
    ...customAgent,
    toolVisibilityProfile: {
      ...customAgent.toolVisibilityProfile,
      hiddenToolNames: ["shell"],
    },
  };
  const registry = new AgentDefinitionRegistry([changedAgent]);

  assert.notEqual(agentDefinitionHash(customAgent), agentDefinitionHash(changedAgent));
  assert.equal(registry.resolve(ref), undefined);
});

test("AgentDefinitionRegistry keeps legacy refs without definition hashes compatible", () => {
  const customAgent: AgentDefinition = {
    ...DESKTOP_ROOT_AGENT,
    agentId: "legacy-registry-agent",
    displayName: "Legacy Registry Agent",
    prompt: {
      promptRef: "prompt:legacy-registry-agent:v1",
      version: "1",
      systemPrompt: "Legacy registry prompt.",
    },
    toolVisibilityProfile: {
      profileId: "legacy-registry-agent:ordinary-visible-tools:v1",
      runMode: "agent",
      visibleToolScopes: ["desktop-basic"],
    },
  };
  const ref = runAgentDefinitionRef(customAgent);
  const legacyRef = {
    agentId: ref.agentId,
    agentDisplayName: ref.agentDisplayName,
    promptRef: ref.promptRef,
    promptVersion: ref.promptVersion,
    outputContractId: ref.outputContractId,
    toolVisibilityProfileId: ref.toolVisibilityProfileId,
  };
  const changedAgent: AgentDefinition = {
    ...customAgent,
    prompt: {
      ...customAgent.prompt,
      systemPrompt: "Changed legacy registry prompt.",
    },
  };
  const registry = new AgentDefinitionRegistry([changedAgent]);

  assert.equal(registry.resolve(legacyRef), changedAgent);
});

test("AgentDefinitionRegistry rejects duplicate safe run refs without exposing prompts", () => {
  const duplicate: AgentDefinition = {
    ...DESKTOP_ROOT_AGENT,
    prompt: {
      ...DESKTOP_ROOT_AGENT.prompt,
      systemPrompt: "Duplicate registry prompt must not leak.",
    },
  };

  assert.throws(
    () => new AgentDefinitionRegistry([DESKTOP_ROOT_AGENT, duplicate]),
    (error) => {
      assert.equal(error instanceof Error, true);
      const message = error instanceof Error ? error.message : String(error);
      assert.equal(message.includes("Duplicate AgentDefinition run ref"), true);
      assert.equal(message.includes(duplicate.prompt.systemPrompt), false);
      return true;
    }
  );
});