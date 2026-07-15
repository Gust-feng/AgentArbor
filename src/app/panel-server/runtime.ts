import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveAgentArborRuntimeDatabasePaths,
  type FileSystemRuntimeDatabasePaths,
} from "../../adapters/runtime-database/index.js";
import { InMemoryEventLog } from "../../kernel/events/in-memory-event-log.js";
import { InMemoryMessageBus } from "../../kernel/messages/in-memory-message-bus.js";
import { createMinimalReadonlySoilStore } from "../../domain/soil/index.js";
import { createRuntimeAgentDefinitionCatalog } from "../agent-definition-catalog.js";
import type { AgentDefinitionRegistry } from "../agent-definition-registry.js";
import { runAgentDefinitionRef } from "../agent-definition-runtime.js";
import { agentDefinitionRefMatchesDefinition, runAgentDefinitionRefCacheKey } from "../agent-definition-ref.js";
import { desktopAgentDefinitionFromConfig } from "../agent-prompts/desktop-agent-configured-definition.js";
import type { AgentDefinition } from "../agent-prompts/contracts.js";
import {
  createMultiAgentFeature,
  MULTI_AGENT_CAPABILITY_PROFILE,
  type MultiAgentFeature,
} from "../deep/multi-agent-feature.js";
import {
  createAppUpdateService,
  createUnsupportedAppUpdateService,
  type AppUpdateServiceLike,
} from "../app-update-service.js";
import { CapabilityCenter } from "../capability/capability-center.js";
import { ConfigCenter, createLocalConfigCenter } from "../config-center.js";
import { resolveModelCapabilities } from "../model-runtime/model-capability-registry.js";
import {
  createFileSystemOrdinaryConversationControlRepository,
} from "../ordinary-agent/conversation-control-repository.js";
import { createFileSystemOrdinaryRunRepository } from "../ordinary-agent/file-system-repository.js";
import {
  createOrdinaryAgentLoopExecutionPort,
} from "../ordinary-agent/agent-loop-execution.js";
import {
  createOrdinaryAgentFeature,
  type OrdinaryAgentFeature,
  type OrdinaryRunBirth,
} from "../ordinary-agent/index.js";
import {
  createPlatformProcessTerminator,
  InMemoryProcessRegistry,
  type ProcessRegistryCleanupResult,
  type ProcessTerminator,
} from "../runtime-guard/index.js";
import {
  FileSystemSkillStateStore,
  resolveSkillStateStorePath,
  type SkillRootInput,
  type SkillStateStore,
} from "../skills/index.js";
import type { SubAgentRootInput } from "../sub-agents/sub-agent-loader.js";
import { InMemoryToolOutputStore } from "../tool-center/tool-output-store.js";
import type {
  PanelContextAttachmentMediaEntry,
  PanelContextAttachmentSelection,
  PanelModelCatalogFetch,
  PanelProviderFetch,
  PanelServerOptions,
} from "./types.js";
import { desktopCapabilitySnapshotForRunStart } from "./desktop-run-model-settings.js";
import { PanelHttpError } from "./http-utils.js";
import { createMultiAgentRunResourceAcquirer } from "./multi-agent-run-resources.js";
import { createOrdinaryAgentRunResourceAcquirer } from "./ordinary-agent-run-resources.js";
import { resolveTriggeredSkillContexts } from "./skill-service.js";
import type { PanelRunInput } from "./request-parsers.js";

export type PanelRuntime = {
  /** True once server shutdown starts; terminal callbacks must not admit new work. */
  isQuiescing: boolean;
  readonly configCenter: ConfigCenter;
  readonly capabilityCenter: CapabilityCenter;
  readonly desktopAgentDefinition: AgentDefinition;
  readonly agentDefinitions: AgentDefinitionRegistry;
  readonly agentDefinitionOverrides: Map<string, AgentDefinition>;
  readonly configDirectory?: string;
  readonly providerFetch?: PanelProviderFetch;
  readonly modelCatalogFetch?: PanelModelCatalogFetch;
  readonly workspaceDirectoryPicker?: () => Promise<string | undefined>;
  readonly contextAttachmentPicker?: () => Promise<PanelContextAttachmentSelection | undefined>;
  readonly contextAttachmentMedia: Map<string, PanelContextAttachmentMediaEntry>;
  readonly activeRequestJobs: Set<Promise<void>>;
  readonly runtimePaths?: FileSystemRuntimeDatabasePaths;
  readonly processRegistry: InMemoryProcessRegistry;
  readonly processTerminator: ProcessTerminator;
  readonly skillRoots: readonly SkillRootInput[];
  readonly subAgentRoots: readonly SubAgentRootInput[];
  readonly skillStateStore?: SkillStateStore;
  readonly appUpdateService: AppUpdateServiceLike;
  readonly multiAgentFeature: MultiAgentFeature;
  readonly ordinaryAgentFeature: OrdinaryAgentFeature;
  readonly prepareOrdinaryRunBirth: (input: PanelRunInput) => Promise<OrdinaryRunBirth>;
  readonly toolOutputStore: InMemoryToolOutputStore;
  readonly resolveSubAgentRoots?: (input: PanelSubAgentRootsInput) => readonly SubAgentRootInput[];
};

type PanelSkillRootsInput = {
  readonly workspaceDirectory?: string;
};

type PanelSubAgentRootsInput = {
  readonly workspaceDirectory?: string;
};

export function createPanelRuntime(options: PanelServerOptions): PanelRuntime {
  const agentDefinitionCatalog = createRuntimeAgentDefinitionCatalog({
    desktopAgentDefinition: options.desktopAgentDefinition,
    additionalDefinitions: options.agentDefinitions,
  });
  if (options.configCenter !== undefined) {
    const runtimePaths = resolvePanelRuntimePaths(options.configDirectory);
    return assemblePanelRuntime({
      configCenter: options.configCenter,
      desktopAgentDefinition: agentDefinitionCatalog.desktopAgentDefinition,
      agentDefinitions: agentDefinitionCatalog.registry,
      configDirectory: options.configDirectory,
      providerFetch: options.providerFetch,
      modelCatalogFetch: options.modelCatalogFetch,
      workspaceDirectoryPicker: options.workspaceDirectoryPicker,
      contextAttachmentPicker: options.contextAttachmentPicker,
      skillRoots: resolveSkillRoots(options),
      resolveSkillRoots: (input) => resolveSkillRoots(options, input),
      subAgentRoots: resolveSubAgentRoots(options),
      resolveSubAgentRoots: (input) => resolveSubAgentRoots(options, input),
      skillStateStore: resolveSkillStateStore(options.configDirectory),
      processTerminator: options.processTerminator,
      appUpdateService: resolveAppUpdateService(options),
      ordinaryAgentExecution: options.ordinaryAgentExecution,
      runtimePaths,
    });
  }
  const local = createLocalConfigCenter({ configDirectory: options.configDirectory });
  const runtimePaths = resolvePanelRuntimePaths(local.configDirectory);
  return assemblePanelRuntime({
    configCenter: local.configCenter,
    desktopAgentDefinition: agentDefinitionCatalog.desktopAgentDefinition,
    agentDefinitions: agentDefinitionCatalog.registry,
    configDirectory: local.configDirectory,
    providerFetch: options.providerFetch,
    modelCatalogFetch: options.modelCatalogFetch,
    workspaceDirectoryPicker: options.workspaceDirectoryPicker,
    contextAttachmentPicker: options.contextAttachmentPicker,
    skillRoots: resolveSkillRoots(options),
    resolveSkillRoots: (input) => resolveSkillRoots(options, input),
    subAgentRoots: resolveSubAgentRoots(options),
    resolveSubAgentRoots: (input) => resolveSubAgentRoots(options, input),
    skillStateStore: resolveSkillStateStore(local.configDirectory),
    processTerminator: options.processTerminator,
    appUpdateService: resolveAppUpdateService(options),
    ordinaryAgentExecution: options.ordinaryAgentExecution,
    runtimePaths,
  });
}

export function isPanelRuntime(value: PanelServerOptions | PanelRuntime): value is PanelRuntime {
  return (
    value.configCenter instanceof ConfigCenter &&
    "ordinaryAgentFeature" in value &&
    "activeRequestJobs" in value &&
    value.activeRequestJobs instanceof Set
  );
}

function assemblePanelRuntime(input: {
  readonly configCenter: ConfigCenter;
  readonly desktopAgentDefinition: AgentDefinition;
  readonly agentDefinitions: AgentDefinitionRegistry;
  readonly configDirectory?: string;
  readonly providerFetch?: PanelProviderFetch;
  readonly modelCatalogFetch?: PanelModelCatalogFetch;
  readonly workspaceDirectoryPicker?: () => Promise<string | undefined>;
  readonly contextAttachmentPicker?: () => Promise<PanelContextAttachmentSelection | undefined>;
  readonly runtimePaths?: FileSystemRuntimeDatabasePaths;
  readonly skillRoots: readonly SkillRootInput[];
  readonly resolveSkillRoots?: (input: PanelSkillRootsInput) => readonly SkillRootInput[];
  readonly subAgentRoots: readonly SubAgentRootInput[];
  readonly resolveSubAgentRoots?: (input: PanelSubAgentRootsInput) => readonly SubAgentRootInput[];
  readonly skillStateStore?: SkillStateStore;
  readonly processTerminator?: ProcessTerminator;
  readonly appUpdateService: AppUpdateServiceLike;
  readonly ordinaryAgentExecution?: import("../ordinary-agent/contracts.js").OrdinaryExecutionPort;
}): PanelRuntime {
  const activeRequestJobs = new Set<Promise<void>>();
  const contextAttachmentMedia = new Map<string, PanelContextAttachmentMediaEntry>();
  const agentDefinitionOverrides = new Map<string, AgentDefinition>();
  const processRegistry = new InMemoryProcessRegistry();
  const toolOutputStore = new InMemoryToolOutputStore();
  const processTerminator = input.processTerminator ?? createPlatformProcessTerminator();
  const capabilityCenter = new CapabilityCenter({
    configCenter: input.configCenter,
    skillRoots: input.skillRoots,
    resolveSkillRoots: input.resolveSkillRoots,
    skillStateStore: input.skillStateStore,
    subAgentRoots: input.subAgentRoots,
    resolveSubAgentRoots: input.resolveSubAgentRoots,
    fetch: input.providerFetch,
    toolOutputStore,
  });
  const multiAgentFeature = createMultiAgentFeature({
    runtimeHome: input.runtimePaths?.runtimeHome,
    releaseToolOutputOwner: (ownerId) => toolOutputStore.releaseOwner(ownerId).then(() => undefined),
    acquireRunResources: createMultiAgentRunResourceAcquirer({
      host: {
        configCenter: input.configCenter,
        providerFetch: input.providerFetch,
        processRegistry,
        toolOutputStore,
      },
      agentDefinition: MULTI_AGENT_CAPABILITY_PROFILE,
    }),
    resolveRunStartFacts: async ({ workspaceDirectory }) => {
      const [capabilitySnapshot, informationAccess, toolConfirmation] = await Promise.all([
        capabilityCenter.snapshot(workspaceDirectory === undefined ? {} : { workspaceDirectory }),
        input.configCenter.getInformationAccessConfig(),
        input.configCenter.getToolConfirmationConfig(),
      ]);
      return {
        capabilitySnapshot,
        informationAccess,
        confirmationPolicy: toolConfirmation.policy,
      };
    },
  });
  const ordinaryRuntimeRoot = resolveOrdinaryRuntimeRoot(input);
  const ordinaryRunResources = createOrdinaryAgentRunResourceAcquirer({
    host: {
      configCenter: input.configCenter,
      providerFetch: input.providerFetch,
      processRegistry,
      processTerminator,
      toolOutputStore,
    },
    soilStore: createMinimalReadonlySoilStore([]),
    resolveAgentDefinition: ({ ref, instructions }) =>
      agentDefinitionOverrides.get(runAgentDefinitionRefCacheKey(ref)) ??
      input.agentDefinitions.resolve(ref) ??
      reconstructFrozenOrdinaryDefinition(input.desktopAgentDefinition, ref, instructions),
    resolveSkillContexts: (context) => resolveTriggeredSkillContexts(
      { skillRoots: input.skillRoots, skillStateStore: input.skillStateStore, capabilityCenter },
      context.goal,
      context.catalog,
      context.triggerMode === "model"
        ? {
            routingMode: "model",
            intelligenceChannel: context.createIntelligenceChannel({
              bus: new InMemoryMessageBus(new InMemoryEventLog()),
            }),
            traceId: context.runId,
            callerRef: `skill-router:${context.runId}`,
            abortSignal: context.abortSignal,
          }
        : { routingMode: "keyword", abortSignal: context.abortSignal },
    ),
    resolveSubAgentRoots: (workspaceRoot) =>
      input.resolveSubAgentRoots?.({ workspaceDirectory: workspaceRoot }) ?? input.subAgentRoots,
  });
  const ordinaryAgentFeature = createOrdinaryAgentFeature({
    repository: createFileSystemOrdinaryRunRepository(ordinaryRuntimeRoot),
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(ordinaryRuntimeRoot),
    execution: input.ordinaryAgentExecution ?? createOrdinaryAgentLoopExecutionPort({
      resources: ordinaryRunResources,
      onReleaseError: (error) => console.error("[panel-server] Ordinary run resource release failed", error),
    }),
  });
  const runtime: PanelRuntime = {
    isQuiescing: false,
    configCenter: input.configCenter,
    capabilityCenter,
    desktopAgentDefinition: input.desktopAgentDefinition,
    agentDefinitions: input.agentDefinitions,
    agentDefinitionOverrides,
    configDirectory: input.configDirectory,
    providerFetch: input.providerFetch,
    modelCatalogFetch: input.modelCatalogFetch,
    workspaceDirectoryPicker: input.workspaceDirectoryPicker,
    contextAttachmentPicker: input.contextAttachmentPicker,
    contextAttachmentMedia,
    activeRequestJobs,
    runtimePaths: input.runtimePaths,
    processRegistry,
    processTerminator,
    skillRoots: input.skillRoots,
    subAgentRoots: input.subAgentRoots,
    resolveSubAgentRoots: input.resolveSubAgentRoots,
    skillStateStore: input.skillStateStore,
    appUpdateService: input.appUpdateService,
    multiAgentFeature,
    ordinaryAgentFeature,
    prepareOrdinaryRunBirth: (runInput) => prepareOrdinaryRunBirth(runtime, runInput),
    toolOutputStore,
  };
  return runtime;
}

function resolveOrdinaryRuntimeRoot(input: {
  readonly runtimePaths?: FileSystemRuntimeDatabasePaths;
  readonly configDirectory?: string;
}): string {
  const runtimeHome = input.runtimePaths?.runtimeHome ??
    (input.configDirectory === undefined ? undefined : path.join(input.configDirectory, "runtime"));
  if (runtimeHome === undefined) {
    throw new Error("Ordinary Agent requires a runtime directory.");
  }
  return path.join(runtimeHome, "ordinary");
}

export function reconstructFrozenOrdinaryDefinition(
  base: AgentDefinition,
  ref: OrdinaryRunBirth["agentDefinitionRef"],
  instructions: string,
): AgentDefinition | undefined {
  const candidate: AgentDefinition = {
    ...base,
    prompt: {
      ...base.prompt,
      promptRef: ref.promptRef,
      version: ref.promptVersion,
      systemPrompt: instructions,
    },
  };
  return agentDefinitionRefMatchesDefinition(ref, candidate) ? candidate : undefined;
}

async function prepareOrdinaryRunBirth(
  runtime: PanelRuntime,
  input: PanelRunInput,
): Promise<OrdinaryRunBirth> {
  const [informationAccess, toolConfirmation, baseCapabilitySnapshot, desktopAgentConfig] = await Promise.all([
    runtime.configCenter.getInformationAccessConfig(),
    runtime.configCenter.getToolConfirmationConfig(),
    capabilitySnapshotForRun(runtime, input.modelOverride, input.workspaceDirectory),
    runtime.configCenter.getDesktopAgentConfig(),
  ]);
  const capabilitySnapshot = desktopCapabilitySnapshotForRunStart(
    baseCapabilitySnapshot,
    input.reasoningEffort,
  );
  const definition = desktopAgentDefinitionFromConfig(runtime.desktopAgentDefinition, desktopAgentConfig);
  const agentDefinitionRef = runAgentDefinitionRef(definition);
  runtime.agentDefinitionOverrides.set(runAgentDefinitionRefCacheKey(agentDefinitionRef), definition);
  return {
    instructions: definition.prompt.systemPrompt,
    aiMode: input.aiMode ?? capabilitySnapshot.activeModel.defaultAiMode,
    config: capabilitySnapshot.activeModel,
    reasoningEffort: input.reasoningEffort,
    agentDefinitionRef,
    capabilitySnapshot,
    informationAccess,
    toolConfirmationPolicy: input.toolConfirmationPolicy ?? toolConfirmation.policy,
  };
}

function resolveAppUpdateService(options: PanelServerOptions): AppUpdateServiceLike {
  if (options.appUpdateService !== undefined) {
    return options.appUpdateService;
  }
  const manifestUrl = options.updateManifestUrl ?? process.env.AGENTARBOR_UPDATE_MANIFEST_URL;
  if (manifestUrl !== undefined) {
    return createAppUpdateService({
      manifestUrl,
      fetch: options.updateManifestFetch,
    });
  }
  return createUnsupportedAppUpdateService({
    reason: "当前运行方式不支持自动更新。请使用 Windows 打包桌面版。",
  });
}

export async function cleanupPanelRuntimeOwnedBackgroundProcesses(
  runtime: PanelRuntime
): Promise<ProcessRegistryCleanupResult | undefined> {
  try {
    return await runtime.processRegistry.cleanupOwnedBackgroundProcesses(runtime.processTerminator);
  } catch {
    return undefined;
  }
}

async function modelProviderConfigForRun(
  runtime: PanelRuntime,
  override: PanelRunInput["modelOverride"]
): Promise<import("../../domain/config/index.js").SanitizedModelProviderConfig> {
  if (override === undefined) {
    return runtime.configCenter.getModelProviderConfig();
  }
  const profile = (await runtime.configCenter.listModelProviderProfiles())
    .find((item) => item.profileId === override.profileId);
  if (profile === undefined) {
    throw new PanelHttpError(400, "model_profile_not_found", "未找到本次选择的模型服务。");
  }
  if (profile.enabled === false) {
    throw new PanelHttpError(400, "model_profile_disabled", "本次选择的模型服务已停用。");
  }
  return { ...profile, model: override.model };
}

async function capabilitySnapshotForRun(
  runtime: PanelRuntime,
  override: PanelRunInput["modelOverride"],
  workspaceDirectory: PanelRunInput["workspaceDirectory"]
): Promise<import("../../domain/config/index.js").BasicAgentCapabilitySnapshot> {
  const snapshot = workspaceDirectory === undefined
    ? await runtime.capabilityCenter.snapshot()
    : await runtime.capabilityCenter.snapshot({ workspaceDirectory });
  if (override === undefined) {
    return snapshot;
  }
  const activeModel = await modelProviderConfigForRun(runtime, override);
  const overrides = await runtime.configCenter.listModelCapabilityOverrides();
  return {
    ...snapshot,
    activeModel,
    modelCapabilities: resolveModelCapabilities({ profile: activeModel, overrides }),
  };
}

function resolveSkillRoots(
  options: PanelServerOptions,
  input: PanelSkillRootsInput = {}
): readonly SkillRootInput[] {
  if (options.skillRoots !== undefined) {
    return options.skillRoots;
  }
  return [
    ...resolveDefaultPanelSkillRoots({ workspaceDirectory: input.workspaceDirectory }),
    ...(options.additionalSkillRoots ?? []),
  ];
}

function resolveSubAgentRoots(
  options: PanelServerOptions,
  input: PanelSubAgentRootsInput = {}
): readonly SubAgentRootInput[] {
  if (options.subAgentRoots !== undefined) {
    return options.subAgentRoots;
  }
  return [
    ...resolveDefaultPanelSubAgentRoots({ workspaceDirectory: input.workspaceDirectory }),
    ...(options.additionalSubAgentRoots ?? []),
  ];
}

export function resolveDefaultPanelSkillRoots(input: {
  readonly cwd?: string;
  readonly home?: string;
  readonly workspaceDirectory?: string;
} = {}): readonly SkillRootInput[] {
  const projectBase = input.workspaceDirectory ?? input.cwd ?? process.cwd();
  const projectRoot = path.join(projectBase, ".agents", "skills");
  const userRoot = path.join(input.home ?? homeDirectory(), ".agents", "skills");
  if (path.resolve(projectRoot) === path.resolve(userRoot)) {
    return [{
      rootPath: projectRoot,
      sourceKind: "project",
      sourceRootId: "project",
      precedence: 100,
    }];
  }
  return [
    {
      rootPath: userRoot,
      sourceKind: "user",
      sourceRootId: "user",
      precedence: 10,
    },
    {
      rootPath: projectRoot,
      sourceKind: "project",
      sourceRootId: "project",
      precedence: 100,
    },
  ];
}

export function resolveDefaultPanelSubAgentRoots(input: {
  readonly cwd?: string;
  readonly home?: string;
  readonly builtinRoot?: string;
  readonly workspaceDirectory?: string;
} = {}): readonly SubAgentRootInput[] {
  const builtinRoot = input.builtinRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "sub-agents", "builtin");
  const projectBase = input.workspaceDirectory ?? input.cwd ?? process.cwd();
  const projectRoot = path.join(projectBase, ".agents", "sub-agents");
  const userRoot = path.join(input.home ?? homeDirectory(), ".agents", "sub-agents");
  const roots: SubAgentRootInput[] = [
    {
      rootPath: builtinRoot,
      sourceKind: "builtin",
      sourceRootId: "builtin",
      precedence: 1,
    },
  ];
  if (path.resolve(projectRoot) !== path.resolve(userRoot)) {
    roots.push({
      rootPath: userRoot,
      sourceKind: "user",
      sourceRootId: "user",
      precedence: 10,
    });
  }
  roots.push({
    rootPath: projectRoot,
    sourceKind: "project",
    sourceRootId: "project",
    precedence: 100,
  });
  return roots;
}

function homeDirectory(): string {
  return process.env.USERPROFILE ?? process.env.HOME ?? process.cwd();
}

function resolveSkillStateStore(configDirectory: string | undefined): SkillStateStore | undefined {
  return configDirectory === undefined ? undefined : new FileSystemSkillStateStore(resolveSkillStateStorePath(configDirectory));
}

function resolvePanelRuntimePaths(configDirectory: string | undefined): FileSystemRuntimeDatabasePaths | undefined {
  return configDirectory === undefined ? undefined : resolveAgentArborRuntimeDatabasePaths(configDirectory);
}
