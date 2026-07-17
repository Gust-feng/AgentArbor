import type { RunCapabilityResolution } from "../../domain/config/index.js";
import type { OrdinaryRunBirth, OrdinaryRunTurn } from "./contracts.js";

export function ordinaryRunBirth(): OrdinaryRunBirth {
  const config = {
    profileId: "openai-default",
    providerKind: "openai_compatible",
    protocolKind: "openai_responses",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5",
    defaultAiMode: "openai-responses",
    secretRef: "secret:openai-default",
    secretConfigured: true,
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as const;
  return {
    instructions: "You are an agent.",
    aiMode: "openai-responses",
    config,
    reasoningEffort: "medium",
    agentDefinitionRef: {
      agentId: "ordinary-agent",
      agentDisplayName: "Ordinary Agent",
      promptRef: "prompt:ordinary",
      promptVersion: "1",
      outputContractId: "ordinary-text/v1",
      toolVisibilityProfileId: "desktop-basic",
    },
    capabilitySnapshot: {
      snapshotId: "capability-snapshot-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      activeModel: config,
      modelCapabilities: {
        contextWindowTokens: 128_000,
        maxOutputTokens: 16_384,
        supportsToolCalling: true,
        supportsParallelToolCalls: true,
        supportsStructuredOutputs: true,
        supportsStreaming: true,
        supportsVisionInput: true,
        supportsReasoningEffort: true,
        preferredApiStyle: "responses",
        stability: "stable",
      },
      toolCatalog: { scope: "desktop-basic", tools: [], allowedTools: ["read_file"] },
      skillCatalog: [],
      subAgentCatalog: [],
      mcpCatalog: [],
      workspace: { workspaceDirectory: "Z:/workspace", updatedAt: "2026-01-01T00:00:00.000Z" },
      securitySummary: "command confirmation enabled",
      warnings: [],
    },
    workspaceSelection: "explicit",
    informationAccess: {
      sourcePreference: ["codebase"],
      web: {
        provider: "none",
        maxResults: 10,
        secretConfigured: false,
        status: "no-provider",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      stubs: { docs: "readonly_stub", packages: "readonly_stub", github: "readonly_stub", run_memory: "stub" },
    },
    toolConfirmationPolicy: "prompt",
  };
}

export function ordinaryRunTurn(runId: string): OrdinaryRunTurn {
  return {
    conversationId: "conversation-1",
    lineageId: "lineage-1",
    ordinal: 1,
    userTurnId: `${runId}-user-turn`,
    assistantTurnId: `${runId}-assistant-turn`,
  };
}

export function ordinaryCapabilityResolution(): RunCapabilityResolution {
  const birth = ordinaryRunBirth();
  return {
    resolutionId: "resolution-1",
    snapshotId: birth.capabilitySnapshot.snapshotId,
    runMode: "agent",
    agentId: birth.agentDefinitionRef.agentId,
    agentDisplayName: birth.agentDefinitionRef.agentDisplayName,
    toolVisibilityProfileId: birth.agentDefinitionRef.toolVisibilityProfileId,
    capabilityPlan: {
      protocolToolCallCapabilities: {
        protocolKind: birth.config.protocolKind,
        canSendToolDefinitions: true,
        canReceiveToolCalls: true,
        canRoundTripToolResults: true,
      },
      modelCapabilities: birth.capabilitySnapshot.modelCapabilities,
      canExposeModelTools: true,
      allowedTools: [],
      warnings: [],
    },
    allowedTools: [],
    toolExposures: [],
    enabledSkills: [],
    mcpDrafts: [],
    warnings: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}
