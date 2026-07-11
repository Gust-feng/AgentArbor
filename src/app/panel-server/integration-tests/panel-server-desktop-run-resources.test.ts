import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type {
  BasicAgentCapabilitySnapshot,
  CapabilityToolCatalogItem,
  ModelCapabilities,
  SanitizedInformationAccessConfig,
} from "../../../domain/config/index.js";
import { createMinimalRuntime } from "../../runtime.js";
import {
  createDesktopToolCenterFactory,
  prepareDesktopRunResources,
} from "../desktop-run-resources.js";
import { desktopCapabilitySnapshotForRunStart } from "../desktop-run-model-settings.js";
import { PanelHttpError } from "../http-utils.js";
import type { PanelRuntime } from "../runtime.js";

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

test("desktop run start snapshot freezes supported request settings without rejecting unsupported effort early", () => {
  const supported = desktopCapabilitySnapshotForRunStart(
    capabilitySnapshot({
      activeModel: {
        protocolKind: "openai_responses",
        defaultAiMode: "openai-responses",
        openAI: {
          temperature: 0.2,
          reasoningSummary: "auto",
          parallelToolCalls: true,
          stream: true,
        },
      },
      modelCapabilities: {
        supportsParallelToolCalls: true,
        supportsStreaming: true,
        supportsReasoningEffort: true,
      },
    }),
    "high"
  );
  const unsupported = desktopCapabilitySnapshotForRunStart(
    capabilitySnapshot({
      activeModel: {
        protocolKind: "openai_responses",
        defaultAiMode: "openai-responses",
        openAI: {
          reasoningEffort: "medium",
          reasoningSummary: "auto",
          parallelToolCalls: true,
          stream: true,
        },
      },
      modelCapabilities: {
        supportsParallelToolCalls: false,
        supportsStreaming: false,
        supportsReasoningEffort: false,
      },
    }),
    "high"
  );

  assert.deepEqual(supported.activeModel.openAI, {
    temperature: 0.2,
    reasoningSummary: "auto",
    parallelToolCalls: true,
    stream: true,
    reasoningEffort: "high",
  });
  assert.deepEqual(unsupported.activeModel.openAI, {
    stream: false,
  });
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

test("desktop tool center factory keeps frozen unavailable tools unavailable", async () => {
  const resources = await prepareDesktopRunResources(runtimeWithAiEnvironment(), "fake", {
    capabilitySnapshot: capabilitySnapshot({
      toolCatalog: {
        scope: "desktop-basic",
        allowedTools: [],
        tools: [
          {
            name: "read_file",
            displayName: "Read file",
            displayDescription: "Read file unavailable in the frozen run snapshot.",
            description: "Read file unavailable in the frozen run snapshot.",
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
            availability: "unavailable",
            disabledReason: "Workspace access was unavailable when the run started.",
          },
        ],
      },
    }),
    informationAccess: informationAccess(),
  });
  const factory = createDesktopToolCenterFactory(undefined, resources);
  const toolCenter = factory(createMinimalRuntime());

  assert.deepEqual(resources.toolCatalogAvailability, [
    {
      name: "read_file",
      availability: "unavailable",
      disabledReason: "Workspace access was unavailable when the run started.",
    },
  ]);
  assert.equal(toolCenter.has("read_file"), false);
});

test("desktop tool center factory rebuilds executable MCP tools only from the frozen run snapshot", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-mcp-run-resources-"));
  const mcpHome = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-mcp-run-home-"));
  const serverPath = path.join(directory, "server.mjs");
  await fs.writeFile(serverPath, mcpServerSource(), "utf8");
  let disconnectAll: (() => Promise<void>) | undefined;
  try {
    const lookup = mcpCapabilityTool("frozen__lookup", "read-only");
    const mutate = mcpCapabilityTool("frozen__mutate", "read-write");
    const resources = await prepareDesktopRunResources(runtimeWithAiEnvironment({
      createMcpRuntimeEnvironment: async (input) => ({
        ...(input?.baseEnv ?? {}),
        // MCP stdio startup may import process.execPath into the managed runtime bin.
        // Keep that write isolated from the real user profile so full-suite runs do not share state.
        AGENTARBOR_HOME: mcpHome,
        USERPROFILE: mcpHome,
        HOME: mcpHome,
      }),
    }), "fake", {
      capabilitySnapshot: capabilitySnapshot({
        toolCatalog: {
          scope: "desktop-basic",
          allowedTools: ["frozen__lookup", "frozen__mutate"],
          tools: [lookup, mutate],
        },
        mcpCatalog: [
          {
            serverId: "frozen",
            label: "Frozen MCP",
            transport: "stdio",
            enabled: true,
            confirmationMode: "unsafe_only",
            availability: "configured",
            runtimeStatus: "configured",
            commandSummary: `${process.execPath} server.mjs`,
            envSecretRefCount: 0,
            authSecretRefCount: 0,
            toolExposureMode: "selected",
            enabledTools: ["lookup", "mutate"],
            autoApprovedTools: ["mutate"],
            cachedTools: [
              {
                name: "lookup",
                description: "Lookup frozen MCP data.",
                inputSchema: {
                  type: "object",
                  properties: { query: { type: "string" } },
                  required: ["query"],
                },
                annotations: { readOnlyHint: true },
              },
              {
                name: "mutate",
                description: "Mutate frozen MCP data.",
                inputSchema: {
                  type: "object",
                  properties: { value: { type: "string" } },
                  required: ["value"],
                },
                annotations: { destructiveHint: true },
              },
            ],
            runtimeConfig: {
              transport: "stdio",
              command: process.execPath,
              args: [serverPath],
              envSecretRefs: [],
              confirmationMode: "unsafe_only",
              toolExposureMode: "selected",
              enabledTools: ["lookup", "mutate"],
              autoApprovedTools: ["mutate"],
            },
            tools: [lookup, mutate],
            exposedTools: [lookup, mutate],
            updatedAt: "2026-06-06T00:00:00.000Z",
          },
        ],
      }),
      informationAccess: informationAccess(),
    });
    disconnectAll = resources.mcpManager?.disconnectAll?.bind(resources.mcpManager);
    const factory = createDesktopToolCenterFactory(undefined, resources);
    const toolCenter = factory(createMinimalRuntime());

    assert.deepEqual(toolCenter.list().map((tool) => tool.name).sort(), ["frozen__lookup", "frozen__mutate"]);

    const readResult = await toolCenter.execute(
      { callId: "call-read", toolName: "frozen__lookup", input: { query: "agent" } },
      { callerAgentId: "agent", traceId: "trace", goalId: "goal" },
      { callerAgentId: "agent", allowedTools: ["frozen__lookup"] }
    );
    assert.equal(readResult.status, "completed");
    assert.match(JSON.stringify(readResult.output), /Frozen: agent/);

    const denied = await toolCenter.execute(
      { callId: "call-denied", toolName: "frozen__lookup", input: { query: "agent" } },
      { callerAgentId: "agent", traceId: "trace", goalId: "goal" },
      { callerAgentId: "agent", allowedTools: [] }
    );
    assert.equal(denied.status, "failed");
    assert.match(denied.error ?? "", /未授权/);

    const mutation = await toolCenter.execute(
      { callId: "call-write", toolName: "frozen__mutate", input: { value: "change" } },
      { callerAgentId: "agent", traceId: "trace", goalId: "goal" },
      { callerAgentId: "agent", allowedTools: ["frozen__mutate"] }
    );
    assert.equal(mutation.status, "completed");
    assert.match(JSON.stringify(mutation.output), /Mutated: change/);
  } finally {
    await disconnectAll?.();
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rm(mcpHome, { recursive: true, force: true });
  }
});

function runtimeWithAiEnvironment(overrides: {
  readonly createMcpRuntimeEnvironment?: (
    input?: { readonly baseEnv?: Readonly<Record<string, string | undefined>> }
  ) => Promise<Readonly<Record<string, string | undefined>>>;
} = {}): PanelRuntime {
  return {
    configCenter: {
      createModelRuntimeEnvironment: async () => ({
        AGENTARBOR_MODEL_API_KEY: "sk-test",
        AGENTARBOR_MODEL_BASE_URL: "https://provider.example",
        AGENTARBOR_MODEL_NAME: "test-model",
      }),
      createMcpRuntimeEnvironment: overrides.createMcpRuntimeEnvironment,
    },
  } as unknown as PanelRuntime;
}

function capabilitySnapshot(
  overrides: {
    readonly activeModel?: Partial<BasicAgentCapabilitySnapshot["activeModel"]>;
    readonly modelCapabilities?: Partial<ModelCapabilities>;
    readonly toolCatalog?: BasicAgentCapabilitySnapshot["toolCatalog"];
    readonly mcpCatalog?: BasicAgentCapabilitySnapshot["mcpCatalog"];
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
    subAgentCatalog: [],
    mcpCatalog: overrides.mcpCatalog ?? [],
    workspace: {
      workspaceDirectory: process.cwd(),
      updatedAt: "2026-06-06T00:00:00.000Z",
    },
    securitySummary: "test snapshot",
    warnings: [],
  };
}

function mcpCapabilityTool(
  name: string,
  operationType: CapabilityToolCatalogItem["operationType"]
): CapabilityToolCatalogItem {
  const readOnly = operationType === "read-only";
  return {
    name,
    displayName: name,
    displayDescription: "MCP test tool.",
    description: "MCP test tool.",
    category: "mcp",
    categoryLabel: "MCP",
    riskLevel: readOnly ? "low" : "high",
    riskLabel: readOnly ? "Low" : "High",
    operationType,
    operationLabel: readOnly ? "Read only" : "Write",
    requiresConfirmation: !readOnly,
    confirmationLabel: readOnly ? "No confirmation" : "Requires confirmation",
    visibleResultPolicy: {
      userVisible: "safe-preview",
      maxPreviewChars: 800,
      omitRawOutput: true,
    },
    scopes: ["mcp"],
    enabled: true,
    availability: "available",
  };
}

function mcpServerSource(): string {
  const mcpServerModule = import.meta.resolve("@modelcontextprotocol/sdk/server/mcp.js");
  const stdioTransportModule = import.meta.resolve("@modelcontextprotocol/sdk/server/stdio.js");
  const zodModule = import.meta.resolve("zod");
  return [
    `import { McpServer } from ${JSON.stringify(mcpServerModule)};`,
    `import { StdioServerTransport } from ${JSON.stringify(stdioTransportModule)};`,
    `import { z } from ${JSON.stringify(zodModule)};`,
    'const server = new McpServer({ name: "frozen-test", version: "1.0.0" });',
    'server.registerTool("lookup", { description: "Lookup frozen docs.", inputSchema: { query: z.string() }, annotations: { readOnlyHint: true } }, async (args) => ({ content: [{ type: "text", text: `Frozen: ${args.query}` }] }));',
    'server.registerTool("mutate", { description: "Mutate external state.", inputSchema: { value: z.string() }, annotations: { destructiveHint: true } }, async (args) => ({ content: [{ type: "text", text: `Mutated: ${args.value}` }] }));',
    "await server.connect(new StdioServerTransport());",
    "",
  ].join("\n");
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
