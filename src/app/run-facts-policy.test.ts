import assert from "node:assert/strict";
import test from "node:test";
import type {
  BasicAgentCapabilitySnapshot,
  RunAgentDefinitionRef,
  RunCapabilityResolution,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../domain/config/index.js";
import { resolveCompatibleRunFacts } from "./run-facts-policy.js";

test("resolveCompatibleRunFacts keeps frozen ordinary desktop facts over terminal payload facts", () => {
  const createdSnapshot = capabilitySnapshot("snapshot-created", modelConfig("created-profile", "created-model"));
  const forgedSnapshot = capabilitySnapshot("snapshot-forged", modelConfig("forged-profile", "forged-model"));
  const created = {
    runKind: "desktop" as const,
    runMode: "agent" as const,
    config: createdSnapshot.activeModel,
    informationAccess: informationAccess("web", 5),
    capabilitySnapshot: createdSnapshot,
    capabilityResolution: capabilityResolution({
      snapshotId: createdSnapshot.snapshotId,
      agentRef: agentDefinitionRef(),
      allowedTools: ["read_file"],
      toolExposures: toolExposuresFor(createdSnapshot),
    }),
    agentDefinitionRef: agentDefinitionRef(),
  };

  const resolved = resolveCompatibleRunFacts(created, {
    config: forgedSnapshot.activeModel,
    informationAccess: informationAccess("docs", 99),
    capabilitySnapshot: forgedSnapshot,
    capabilityResolution: capabilityResolution({
      snapshotId: forgedSnapshot.snapshotId,
      agentRef: {
        ...agentDefinitionRef(),
        agentId: "forged-agent",
        agentDisplayName: "Forged Agent",
      },
      allowedTools: ["shell_command"],
      toolExposures: toolExposuresFor(forgedSnapshot),
    }),
  });

  assert.equal(resolved.config.profileId, "created-profile");
  assert.equal(resolved.config.model, "created-model");
  assert.deepEqual(resolved.informationAccess.sourcePreference, ["web"]);
  assert.equal(resolved.informationAccess.web.maxResults, 5);
  assert.equal(resolved.capabilitySnapshot?.snapshotId, "snapshot-created");
  assert.deepEqual(resolved.capabilityResolution?.allowedTools, ["read_file"]);
  assert.equal(resolved.capabilityResolution?.agentId, "desktop-agent-session");
});

test("resolveCompatibleRunFacts accepts matching capability resolution refinements", () => {
  const createdSnapshot = capabilitySnapshot("snapshot-created", modelConfig("created-profile", "created-model"));
  const agentRef = agentDefinitionRef();
  const created = {
    runKind: "desktop" as const,
    runMode: "agent" as const,
    config: createdSnapshot.activeModel,
    informationAccess: informationAccess("web", 5),
    capabilitySnapshot: createdSnapshot,
    agentDefinitionRef: agentRef,
  };
  const candidateResolution = capabilityResolution({
    snapshotId: createdSnapshot.snapshotId,
    agentRef,
    allowedTools: ["read_file"],
    toolExposures: toolExposuresFor(createdSnapshot),
  });

  const resolved = resolveCompatibleRunFacts(created, {
    capabilitySnapshot: createdSnapshot,
    capabilityResolution: candidateResolution,
  });

  assert.equal(resolved.capabilitySnapshot, createdSnapshot);
  assert.deepEqual(resolved.capabilityResolution, candidateResolution);
});

function modelConfig(profileId: string, model: string): SanitizedModelProviderConfig {
  return {
    defaultAiMode: "fake",
    profileId,
    providerKind: "openai_compatible",
    protocolKind: "openai_compatible_chat_completions",
    baseUrl: `https://${profileId}.example.test`,
    model,
    secretRef: `secret://test/${profileId}`,
    secretConfigured: false,
    updatedAt: "2026-06-07T00:00:00.000Z",
  };
}

function informationAccess(source: "web" | "docs", maxResults: number): SanitizedInformationAccessConfig {
  return {
    sourcePreference: [source],
    web: {
      provider: source === "web" ? "tavily" : "none",
      providerKind: "tavily",
      maxResults,
      secretRef: "secret://test/tavily",
      secretConfigured: false,
      status: source === "web" ? "ready" : "disabled",
      updatedAt: "2026-06-07T00:00:00.000Z",
    },
    stubs: {
      docs: "stub",
      packages: "stub",
      github: "stub",
      run_memory: "stub",
    },
  };
}

function agentDefinitionRef(): RunAgentDefinitionRef {
  return {
    agentId: "desktop-agent-session",
    agentDisplayName: "Desktop Agent",
    promptRef: "prompt:desktop-root-agent:v1",
    promptVersion: "v1",
    outputContractId: "desktop.agent_response.v1",
    toolVisibilityProfileId: "desktop-root-agent:ordinary-visible-tools:v1",
  };
}

function capabilitySnapshot(snapshotId: string, activeModel: SanitizedModelProviderConfig): BasicAgentCapabilitySnapshot {
  return {
    snapshotId,
    createdAt: "2026-06-07T00:00:00.000Z",
    activeModel,
    modelCapabilities: {
      contextWindowTokens: 128_000,
      maxOutputTokens: 4_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: false,
      supportsStreaming: true,
      supportsVisionInput: false,
      supportsReasoningEffort: false,
      preferredApiStyle: "chat_completions",
      stability: "stable",
    },
    toolCatalog: {
      scope: "desktop-basic",
      allowedTools: ["read_file"],
      tools: [
        {
          name: "read_file",
          displayName: "Read file",
          displayDescription: "Read files in the current workspace.",
          description: "Read files in the current workspace.",
          category: "workspace",
          categoryLabel: "Workspace",
          enabled: true,
          scopes: ["desktop-basic", "workspace"],
          availability: "available",
          riskLevel: "low",
          riskLabel: "Low",
          operationType: "read-only",
          operationLabel: "Read only",
          requiresConfirmation: false,
          confirmationLabel: "No confirmation",
          visibleResultPolicy: {
            userVisible: "safe-preview",
            maxPreviewChars: 500,
            omitRawOutput: true,
          },
        },
        {
          name: "shell_command",
          displayName: "Shell command",
          displayDescription: "Run a shell command.",
          description: "Run a shell command.",
          category: "workspace",
          categoryLabel: "Workspace",
          enabled: true,
          scopes: ["desktop-basic", "workspace"],
          availability: "available",
          riskLevel: "high",
          riskLabel: "High",
          operationType: "execute",
          operationLabel: "Execute",
          requiresConfirmation: true,
          confirmationLabel: "Requires confirmation",
          visibleResultPolicy: {
            userVisible: "summary-only",
            maxPreviewChars: 500,
            omitRawOutput: true,
          },
        },
      ],
    },
    skillCatalog: [],
    mcpCatalog: [],
    workspace: {
      workspaceDirectory: "Z:\\AgentArbor",
      updatedAt: "2026-06-07T00:00:00.000Z",
    },
    securitySummary: "Frozen test capability snapshot.",
    warnings: [],
  };
}

function capabilityResolution(input: {
  readonly snapshotId: string;
  readonly agentRef: RunAgentDefinitionRef;
  readonly allowedTools: readonly string[];
  readonly toolExposures: RunCapabilityResolution["toolExposures"];
}): RunCapabilityResolution {
  return {
    resolutionId: `capability-resolution-${input.snapshotId}`,
    snapshotId: input.snapshotId,
    runMode: "agent",
    agentId: input.agentRef.agentId,
    agentDisplayName: input.agentRef.agentDisplayName,
    toolVisibilityProfileId: input.agentRef.toolVisibilityProfileId,
    allowedTools: input.allowedTools,
    toolExposures: input.toolExposures,
    enabledSkills: [],
    mcpDrafts: [],
    warnings: [],
    createdAt: "2026-06-07T00:00:00.000Z",
  };
}

function toolExposuresFor(snapshot: BasicAgentCapabilitySnapshot): RunCapabilityResolution["toolExposures"] {
  const allowed = new Set(snapshot.toolCatalog.allowedTools);
  return snapshot.toolCatalog.tools.map((tool) => ({
    name: tool.name,
    displayName: tool.displayName,
    enabled: tool.enabled,
    modelVisible: allowed.has(tool.name),
    scopes: tool.scopes,
    availability: tool.availability,
    riskLevel: tool.riskLevel,
    operationType: tool.operationType,
    requiresConfirmation: tool.requiresConfirmation,
    reason: allowed.has(tool.name) ? "可用。" : "当前模式不可用。",
  }));
}
