import assert from "node:assert/strict";
import test from "node:test";
import type {
  BasicAgentCapabilitySnapshot,
  ModelCapabilities,
  SanitizedInformationAccessConfig,
} from "../domain/config/index.js";
import { createMinimalRuntime } from "./runtime.js";
import { createDesktopToolCenterFactory, prepareDesktopRunResources } from "./panel-server/desktop-run-resources.js";
import { PanelHttpError } from "./panel-server/http-utils.js";
import type { PanelRuntime } from "./panel-server/runtime.js";

test("desktop run resources require the run-created capability snapshot", async () => {
  await assert.rejects(
    () => prepareDesktopRunResources({} as PanelRuntime, "fake", {}),
    (error) =>
      error instanceof PanelHttpError &&
      error.code === "desktop_capability_snapshot_required" &&
      error.message.includes("capability snapshot")
  );
});

test("desktop run resources require the run-created information access settings", async () => {
  await assert.rejects(
    () =>
      prepareDesktopRunResources({} as PanelRuntime, "fake", {
        capabilitySnapshot: {
          ...capabilitySnapshot(),
        },
      }),
    (error) =>
      error instanceof PanelHttpError &&
      error.code === "desktop_information_access_required" &&
      error.message.includes("information access")
  );
});

test("desktop run resources carry the run-created information access settings", async () => {
  const frozenInformationAccess = informationAccess();
  const resources = await prepareDesktopRunResources(runtimeWithAiEnvironment(), "fake", {
    capabilitySnapshot: capabilitySnapshot(),
    informationAccess: frozenInformationAccess,
  });

  assert.equal(resources.informationAccess, frozenInformationAccess);
});

test("desktop run resources remove unsupported saved OpenAI request settings from the frozen run model", async () => {
  const runtime = runtimeWithAiEnvironment();
  const resources = await prepareDesktopRunResources(runtime, "openai-compatible", {
    capabilitySnapshot: capabilitySnapshot({
      activeModel: {
        openAI: {
          temperature: 0.2,
          maxOutputTokens: 800,
          reasoningEffort: "high",
          reasoningSummary: "auto",
          parallelToolCalls: true,
          stream: true,
          store: false,
        },
      },
      modelCapabilities: {
        supportsParallelToolCalls: false,
        supportsStreaming: false,
        supportsReasoningEffort: false,
      },
    }),
    informationAccess: informationAccess(),
    onModelOutputDelta: () => undefined,
  });

  assert.deepEqual(resources.capabilitySnapshot.activeModel.openAI, {
    temperature: 0.2,
    maxOutputTokens: 800,
    stream: false,
    store: false,
  });
});

test("desktop run resources keep supported OpenAI request settings and explicit run reasoning effort", async () => {
  const runtime = runtimeWithAiEnvironment();
  const resources = await prepareDesktopRunResources(runtime, "openai-responses", {
    capabilitySnapshot: capabilitySnapshot({
      activeModel: {
        protocolKind: "openai_responses",
        defaultAiMode: "openai-responses",
        openAI: {
          temperature: 0.2,
          maxOutputTokens: 800,
          reasoningEffort: "medium",
          reasoningSummary: "concise",
          parallelToolCalls: true,
          stream: true,
          store: true,
        },
      },
      modelCapabilities: {
        supportsParallelToolCalls: true,
        supportsStreaming: true,
        supportsReasoningEffort: true,
      },
    }),
    informationAccess: informationAccess(),
    reasoningEffort: "high",
    onModelOutputDelta: () => undefined,
  });

  assert.deepEqual(resources.capabilitySnapshot.activeModel.openAI, {
    temperature: 0.2,
    maxOutputTokens: 800,
    reasoningSummary: "concise",
    parallelToolCalls: true,
    stream: true,
    store: true,
    reasoningEffort: "high",
  });
});

test("desktop run resources reject explicit reasoning effort when the frozen model cannot support it", async () => {
  await assert.rejects(
    () =>
      prepareDesktopRunResources(runtimeWithAiEnvironment(), "openai-responses", {
        capabilitySnapshot: capabilitySnapshot({
          activeModel: {
            protocolKind: "openai_responses",
            defaultAiMode: "openai-responses",
          },
          modelCapabilities: { supportsReasoningEffort: false },
        }),
        informationAccess: informationAccess(),
        reasoningEffort: "high",
      }),
    (error) => error instanceof PanelHttpError && error.code === "unsupported_model_reasoning_effort"
  );
});

test("desktop tool center factory uses frozen run resources instead of rereading current model environment", async () => {
  const resources = await prepareDesktopRunResources(runtimeWithAiEnvironment(), "fake", {
    capabilitySnapshot: capabilitySnapshot({
      toolCatalog: {
        scope: "desktop-basic",
        allowedTools: [],
        tools: [
          {
            name: "search",
            displayName: "Search",
            displayDescription: "Search disabled by the frozen run snapshot.",
            description: "Search disabled by the frozen run snapshot.",
            category: "research",
            categoryLabel: "Research",
            riskLevel: "low",
            riskLabel: "Low",
            operationType: "read-only",
            operationLabel: "Read only",
            requiresConfirmation: false,
            confirmationLabel: "No confirmation",
            visibleResultPolicy: {
              userVisible: "summary-only",
              maxPreviewChars: 0,
              omitRawOutput: true,
            },
            scopes: ["desktop-basic", "research"],
            enabled: false,
            availability: "available",
          },
        ],
      },
    }),
    informationAccess: informationAccess(),
  });
  const factory = createDesktopToolCenterFactory(undefined, resources);
  const toolCenter = factory(createMinimalRuntime());

  assert.equal(toolCenter.list().some((tool) => tool.name === "search"), false);
});

test("desktop tool center factory restricts executors to the frozen run tool catalog", async () => {
  const resources = await prepareDesktopRunResources(runtimeWithAiEnvironment(), "fake", {
    capabilitySnapshot: capabilitySnapshot({
      toolCatalog: {
        scope: "desktop-basic",
        allowedTools: ["read_file"],
        tools: [
          {
            name: "read_file",
            displayName: "Read file",
            displayDescription: "Read file from the frozen run snapshot.",
            description: "Read file from the frozen run snapshot.",
            category: "filesystem",
            categoryLabel: "Filesystem",
            riskLevel: "low",
            riskLabel: "Low",
            operationType: "read-only",
            operationLabel: "Read only",
            requiresConfirmation: false,
            confirmationLabel: "No confirmation",
            visibleResultPolicy: {
              userVisible: "summary-only",
              maxPreviewChars: 800,
              omitRawOutput: true,
            },
            scopes: ["desktop-basic", "workspace"],
            enabled: true,
            availability: "available",
          },
        ],
      },
    }),
    informationAccess: informationAccess(),
  });
  const factory = createDesktopToolCenterFactory(undefined, resources);
  const toolCenter = factory(createMinimalRuntime());

  assert.deepEqual(toolCenter.list().map((tool) => tool.name), ["read_file"]);
  assert.equal(toolCenter.has("read_file"), true);
  assert.equal(toolCenter.has("search"), false);
  assert.equal(toolCenter.has("run_command"), false);
});

function runtimeWithAiEnvironment(): PanelRuntime {
  return {
    configCenter: {
      createModelRuntimeEnvironment: async () => ({
        AGENTARBOR_MODEL_API_KEY: "sk-test",
        AGENTARBOR_MODEL_BASE_URL: "https://provider.example",
        AGENTARBOR_MODEL_NAME: "test-model",
      }),
    },
  } as unknown as PanelRuntime;
}

function capabilitySnapshot(
  overrides: {
    readonly activeModel?: Partial<BasicAgentCapabilitySnapshot["activeModel"]>;
    readonly modelCapabilities?: Partial<ModelCapabilities>;
    readonly toolCatalog?: BasicAgentCapabilitySnapshot["toolCatalog"];
  } = {}
): BasicAgentCapabilitySnapshot {
  return {
    snapshotId: "snapshot-test",
    createdAt: "2026-06-06T00:00:00.000Z",
    activeModel: {
      profileId: "default",
      providerKind: "openai_compatible",
      protocolKind: "openai_compatible_chat_completions",
      baseUrl: "https://provider.example",
      model: "test-model",
      defaultAiMode: "openai-compatible",
      secretRef: "secret://test/model",
      secretConfigured: true,
      updatedAt: "2026-06-06T00:00:00.000Z",
      ...overrides.activeModel,
    },
    modelCapabilities: {
      contextWindowTokens: 16_000,
      maxOutputTokens: 1_024,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: false,
      supportsStreaming: true,
      supportsVisionInput: false,
      supportsReasoningEffort: false,
      preferredApiStyle: "chat_completions",
      stability: "stable",
      ...overrides.modelCapabilities,
    },
    toolCatalog: overrides.toolCatalog ?? { scope: "desktop-basic", tools: [], allowedTools: [] },
    skillCatalog: [],
    mcpCatalog: [],
    workspace: {
      workspaceDirectory: process.cwd(),
      updatedAt: "2026-06-06T00:00:00.000Z",
    },
    securitySummary: "test snapshot",
    warnings: [],
  };
}

function informationAccess(): SanitizedInformationAccessConfig {
  return {
    sourcePreference: ["web", "codebase"],
    web: {
      provider: "none",
      providerKind: "tavily",
      maxResults: 3,
      secretRef: "secret://test/tavily",
      secretConfigured: false,
      status: "disabled",
      updatedAt: "2026-06-06T00:00:00.000Z",
    },
    stubs: {
      docs: "readonly_stub",
      packages: "readonly_stub",
      github: "readonly_stub",
      run_memory: "readonly_stub",
    },
  };
}
