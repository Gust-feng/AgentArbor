import assert from "node:assert/strict";
import test from "node:test";
import type { BasicAgentCapabilitySnapshot, ModelCapabilities } from "../../domain/config/index.js";
import { modelCapabilitiesForDesktopRun } from "./desktop-agent-loop-preparation.js";

const directModelCapabilities: ModelCapabilities = {
  contextWindowTokens: 4_000,
  maxOutputTokens: 512,
  supportsToolCalling: false,
  supportsParallelToolCalls: false,
  supportsStructuredOutputs: false,
  supportsStreaming: false,
  supportsVisionInput: false,
  supportsReasoningEffort: false,
  preferredApiStyle: "chat_completions",
  stability: "unknown",
};

const frozenModelCapabilities: ModelCapabilities = {
  contextWindowTokens: 128_000,
  maxOutputTokens: 16_000,
  supportsToolCalling: false,
  supportsParallelToolCalls: true,
  supportsStructuredOutputs: true,
  supportsStreaming: true,
  supportsVisionInput: false,
  supportsReasoningEffort: false,
  preferredApiStyle: "openai_compatible",
  stability: "stable",
};

test("desktop agent loop preparation prefers frozen snapshot model capabilities", () => {
  const resolved = modelCapabilitiesForDesktopRun("fake", {
    capabilitySnapshot: capabilitySnapshot(frozenModelCapabilities),
    modelCapabilities: directModelCapabilities,
  });

  assert.equal(resolved?.maxOutputTokens, 16_000);
  assert.equal(resolved?.contextWindowTokens, 128_000);
  assert.equal(resolved?.supportsToolCalling, false);
});

test("desktop agent loop preparation only widens fake tool calling without a frozen snapshot", () => {
  const resolved = modelCapabilitiesForDesktopRun("fake", {
    modelCapabilities: directModelCapabilities,
  });

  assert.equal(resolved?.supportsToolCalling, true);
  assert.equal(resolved?.maxOutputTokens, 512);
});

test("desktop agent loop preparation keeps real model capabilities unchanged", () => {
  const resolved = modelCapabilitiesForDesktopRun("openai-compatible", {
    modelCapabilities: directModelCapabilities,
  });

  assert.equal(resolved?.supportsToolCalling, false);
});

function capabilitySnapshot(modelCapabilities: ModelCapabilities): BasicAgentCapabilitySnapshot {
  return {
    snapshotId: "capability-snapshot:test",
    createdAt: new Date(0).toISOString(),
    activeModel: {
      profileId: "default",
      label: "Default",
      providerKind: "openai_compatible",
      protocolKind: "openai_compatible_chat_completions",
      baseUrl: "https://provider.example",
      model: "snapshot-model",
      defaultAiMode: "fake",
      secretRef: "env:AGENTARBOR_MODEL_API_KEY",
      enabled: true,
      secretConfigured: true,
      updatedAt: "2026-05-13T00:00:00.000Z",
    },
    modelCapabilities,
    toolCatalog: {
      scope: "desktop-basic",
      tools: [],
      allowedTools: [],
    },
    skillCatalog: [],
    subAgentCatalog: [],
    mcpCatalog: [],
    workspace: {
      workspaceDirectory: process.cwd(),
      updatedAt: "2026-05-13T00:00:00.000Z",
    },
    securitySummary: "test",
    warnings: [],
  };
}
