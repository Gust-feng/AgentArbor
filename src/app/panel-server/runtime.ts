import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FileSystemRuntimeDatabase,
  resolveAgentArborRuntimeDatabasePaths,
  type FileSystemRuntimeDatabasePaths,
} from "../../adapters/runtime-database/index.js";
import type { ModelOutputDelta } from "../../domain/intelligence/index.js";
import type { RuntimeDatabase } from "../../domain/runtime-database/index.js";
import { createRuntimeAgentDefinitionCatalog } from "../agent-definition-catalog.js";
import type { AgentDefinitionRegistry } from "../agent-definition-registry.js";
import { runAgentDefinitionRef } from "../agent-definition-runtime.js";
import { runAgentDefinitionRefCacheKey } from "../agent-definition-ref.js";
import { desktopAgentDefinitionFromConfig } from "../agent-prompts/desktop-agent-configured-definition.js";
import type { AgentDefinition } from "../agent-prompts/contracts.js";
import {
  createAppUpdateService,
  createUnsupportedAppUpdateService,
  type AppUpdateServiceLike,
} from "../app-update-service.js";
import {
  BasicAgentRunExecutor,
  type BasicAgentRunExecutionInput,
  type BasicAgentRunExecutionResult,
  type BasicAgentRunStartFacts,
  type BasicAgentRunStartInput,
} from "../basic-agent-runtime/index.js";
import { CapabilityCenter } from "../capability/capability-center.js";
import { ConfigCenter, createLocalConfigCenter } from "../config-center.js";
import { resolveModelCapabilities } from "../model-runtime/model-capability-registry.js";
import { PanelConversationStore } from "../panel-conversation/panel-conversations.js";
import { PanelRunJobStore, resolvePanelRunMode, type PanelRunJob } from "./run-jobs.js";
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
import type {
  PanelContextAttachmentMediaEntry,
  PanelContextAttachmentSelection,
  PanelModelCatalogFetch,
  PanelProviderFetch,
  PanelServerOptions,
} from "./types.js";
import { syncConversationTurnForJob } from "./conversation-sync.js";
import { appendLiveModelOutputDelta } from "./live-model-stream.js";
import { persistPanelRun, persistPanelRunInBackground } from "./run-persistence.js";
import { createPanelRunJobResponse } from "./run-job-response.js";
import { desktopCapabilitySnapshotForRunStart } from "./desktop-run-model-settings.js";
import { PanelHttpError } from "./http-utils.js";

export type PanelRuntime = {
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
  readonly runJobs: PanelRunJobStore;
  readonly activeRunJobs: Set<Promise<void>>;
  readonly abortControllers: Map<string, AbortController>;
  readonly persistenceChains: Map<string, Promise<void>>;
  readonly runExecutor: BasicAgentRunExecutor;
  readonly conversations: PanelConversationStore;
  readonly runtimeDatabase?: RuntimeDatabase;
  readonly runtimePaths?: FileSystemRuntimeDatabasePaths;
  readonly processRegistry: InMemoryProcessRegistry;
  readonly processTerminator: ProcessTerminator;
  readonly skillRoots: readonly SkillRootInput[];
  readonly subAgentRoots: readonly SubAgentRootInput[];
  readonly skillStateStore?: SkillStateStore;
  readonly appUpdateService: AppUpdateServiceLike;
  readonly resolveSubAgentRoots?: (input: PanelSubAgentRootsInput) => readonly SubAgentRootInput[];
};

type PanelSkillRootsInput = {
  readonly workspaceDirectory?: string;
};

type PanelSubAgentRootsInput = {
  readonly workspaceDirectory?: string;
};

export type PanelRuntimeHooks = {
  readonly executeRun: (runtime: PanelRuntime, execution: BasicAgentRunExecutionInput) => Promise<BasicAgentRunExecutionResult>;
  readonly failRun: (runtime: PanelRuntime, job: PanelRunJob, error: unknown) => Promise<void>;
  readonly scheduleNextQueuedConversationRun: (runtime: PanelRuntime, completedJob: PanelRunJob) => void;
};

export function createPanelRuntime(options: PanelServerOptions, hooks: PanelRuntimeHooks): PanelRuntime {
  const agentDefinitionCatalog = createRuntimeAgentDefinitionCatalog({
    desktopAgentDefinition: options.desktopAgentDefinition,
    additionalDefinitions: options.agentDefinitions,
  });
  if (options.configCenter !== undefined) {
    const runtimePersistence = createPanelRuntimePersistence(options.configDirectory, options.runtimeDatabase);
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
      hooks,
      ...runtimePersistence,
    });
  }
  const local = createLocalConfigCenter({ configDirectory: options.configDirectory });
  const runtimePersistence = createPanelRuntimePersistence(local.configDirectory, options.runtimeDatabase);
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
    hooks,
    ...runtimePersistence,
  });
}

export function isPanelRuntime(value: PanelServerOptions | PanelRuntime): value is PanelRuntime {
  return (
    value.configCenter instanceof ConfigCenter &&
    "runJobs" in value &&
    value.runJobs instanceof PanelRunJobStore &&
    "activeRunJobs" in value &&
    value.activeRunJobs instanceof Set
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
  readonly runtimeDatabase?: RuntimeDatabase;
  readonly runtimePaths?: FileSystemRuntimeDatabasePaths;
  readonly skillRoots: readonly SkillRootInput[];
  readonly resolveSkillRoots?: (input: PanelSkillRootsInput) => readonly SkillRootInput[];
  readonly subAgentRoots: readonly SubAgentRootInput[];
  readonly resolveSubAgentRoots?: (input: PanelSubAgentRootsInput) => readonly SubAgentRootInput[];
  readonly skillStateStore?: SkillStateStore;
  readonly processTerminator?: ProcessTerminator;
  readonly appUpdateService: AppUpdateServiceLike;
  readonly hooks: PanelRuntimeHooks;
}): PanelRuntime {
  const runJobs = new PanelRunJobStore();
  const activeRunJobs = new Set<Promise<void>>();
  const abortControllers = new Map<string, AbortController>();
  const persistenceChains = new Map<string, Promise<void>>();
  const contextAttachmentMedia = new Map<string, PanelContextAttachmentMediaEntry>();
  const agentDefinitionOverrides = new Map<string, AgentDefinition>();
  const conversations = new PanelConversationStore();
  const processRegistry = new InMemoryProcessRegistry();
  const processTerminator = input.processTerminator ?? createPlatformProcessTerminator();
  const capabilityCenter = new CapabilityCenter({
    configCenter: input.configCenter,
    skillRoots: input.skillRoots,
    resolveSkillRoots: input.resolveSkillRoots,
    skillStateStore: input.skillStateStore,
    subAgentRoots: input.subAgentRoots,
    resolveSubAgentRoots: input.resolveSubAgentRoots,
    fetch: input.providerFetch,
  });
  const runtime: Omit<PanelRuntime, "runExecutor"> & { runExecutor?: BasicAgentRunExecutor } = {
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
    runJobs,
    activeRunJobs,
    abortControllers,
    persistenceChains,
    conversations,
    runtimeDatabase: input.runtimeDatabase,
    runtimePaths: input.runtimePaths,
    processRegistry,
    processTerminator,
    skillRoots: input.skillRoots,
    subAgentRoots: input.subAgentRoots,
    resolveSubAgentRoots: input.resolveSubAgentRoots,
    skillStateStore: input.skillStateStore,
    appUpdateService: input.appUpdateService,
  };
  runtime.runExecutor = new BasicAgentRunExecutor({
    prepareRunStart: (startInput) => preparePanelBasicRunStart(runtime as PanelRuntime, startInput),
    runJobs,
    activeRunJobs,
    abortControllers,
    persistRun: (job) => persistPanelRun(runtime as PanelRuntime, job as PanelRunJob),
    persistRunInBackground: (job) => persistPanelRunInBackground(runtime as PanelRuntime, job as PanelRunJob),
    cleanupRunResources: (runId) =>
      runtime.processRegistry.cleanupByRun(runId, runtime.processTerminator),
    inspectRunResources: (runId) =>
      runtime.processRegistry.recordRunResidueSummary(runId),
    executionAdapter: {
      execute: (execution) => input.hooks.executeRun(runtime as PanelRuntime, execution),
    },
    failRun: (job, error) => input.hooks.failRun(runtime as PanelRuntime, job as PanelRunJob, error),
    onRuntimeReady: (runId, context) => {
      runtime.runJobs.attachRuntime({
        runId,
        runtime: context.runtime,
        traceId: context.traceId,
        goalId: context.goalId,
      });
      const job = runtime.runJobs.get(runId);
      if (job !== undefined) {
        runtime.runExecutor?.syncRun(job);
      }
    },
    onModelOutputDelta: (runId, delta: ModelOutputDelta) => appendLiveModelOutputDelta(runtime as PanelRuntime, runId, delta),
    onRunFinished: async (job) => {
      syncConversationTurnForJob({
        conversations: runtime.conversations,
        job: job as PanelRunJob,
        response: createPanelRunJobResponse(runtime as PanelRuntime, job as PanelRunJob),
      });
      input.hooks.scheduleNextQueuedConversationRun(runtime as PanelRuntime, job as PanelRunJob);
    },
  });
  return runtime as PanelRuntime;
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

async function preparePanelBasicRunStart(
  runtime: PanelRuntime,
  input: BasicAgentRunStartInput
): Promise<BasicAgentRunStartFacts> {
  const [informationAccess, toolConfirmation] = await Promise.all([
    runtime.configCenter.getInformationAccessConfig(),
    runtime.configCenter.getToolConfirmationConfig(),
  ]);
  if (input.runKind !== "desktop") {
    const config = await modelProviderConfigForRun(runtime, input.modelOverride);
    return {
      aiMode: input.aiMode ?? config.defaultAiMode,
      config,
      informationAccess,
      toolConfirmationPolicy: input.toolConfirmationPolicy ?? toolConfirmation.policy,
    };
  }

  const [baseCapabilitySnapshot, desktopAgentConfig] = await Promise.all([
    capabilitySnapshotForRun(
      runtime,
      input.modelOverride,
      input.workspaceDirectory
    ),
    runtime.configCenter.getDesktopAgentConfig(),
  ]);
  const capabilitySnapshot = desktopCapabilitySnapshotForRunStart(
    baseCapabilitySnapshot,
    input.reasoningEffort
  );
  const config = capabilitySnapshot.activeModel;
  const agentDefinition = resolvePanelRunMode(input.runKind, input.runMode) === "agent"
    ? desktopAgentDefinitionFromConfig(runtime.desktopAgentDefinition, desktopAgentConfig)
    : undefined;
  const agentDefinitionRef = agentDefinition === undefined ? undefined : runAgentDefinitionRef(agentDefinition);
  if (agentDefinition !== undefined && agentDefinitionRef !== undefined) {
    runtime.agentDefinitionOverrides.set(runAgentDefinitionRefCacheKey(agentDefinitionRef), agentDefinition);
  }
  return {
    aiMode: input.aiMode ?? config.defaultAiMode,
    config,
    informationAccess,
    capabilitySnapshot,
    toolConfirmationPolicy: input.toolConfirmationPolicy ?? toolConfirmation.policy,
    agentDefinitionRef,
  };
}

async function modelProviderConfigForRun(
  runtime: PanelRuntime,
  override: BasicAgentRunStartInput["modelOverride"]
): Promise<BasicAgentRunStartFacts["config"]> {
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
  override: BasicAgentRunStartInput["modelOverride"],
  workspaceDirectory: BasicAgentRunStartInput["workspaceDirectory"]
): Promise<NonNullable<BasicAgentRunStartFacts["capabilitySnapshot"]>> {
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

function createPanelRuntimePersistence(
  configDirectory: string | undefined,
  runtimeDatabase: RuntimeDatabase | undefined
): Pick<PanelRuntime, "runtimeDatabase" | "runtimePaths"> {
  if (configDirectory === undefined) {
    return runtimeDatabase === undefined ? {} : { runtimeDatabase };
  }
  const runtimePaths = resolveAgentArborRuntimeDatabasePaths(configDirectory);
  return {
    runtimeDatabase: runtimeDatabase ?? new FileSystemRuntimeDatabase(runtimePaths),
    runtimePaths,
  };
}
