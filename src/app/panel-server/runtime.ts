import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import {
  FileSystemAgentSessionRepository,
} from "../../adapters/intelligence/index.js";
import {
  FileSystemToolOutputStore,
  resolveAgentArborRuntimePaths,
  SqliteRuntimeDatabase,
  type AgentArborRuntimePaths,
} from "../../adapters/runtime-storage/index.js";
import { InMemoryEventLog } from "../../kernel/events/in-memory-event-log.js";
import { InMemoryMessageBus } from "../../kernel/messages/in-memory-message-bus.js";
import { createMinimalReadonlySoilStore } from "../../domain/soil/index.js";
import { createRuntimeAgentDefinitionCatalog } from "../agent-definitions/agent-definition-catalog.js";
import { agentDefinitionRefMatchesDefinition, runAgentDefinitionRefCacheKey } from "../agent-definitions/agent-definition-ref.js";
import type { AgentDefinitionRegistry } from "../agent-definitions/agent-definition-registry.js";
import { runAgentDefinitionRef } from "../agent-definitions/agent-definition-runtime.js";
import { desktopAgentDefinitionFromConfig } from "../agent-prompts/desktop-agent-configured-definition.js";
import type { AgentDefinition } from "../agent-prompts/contracts.js";
import {
  createAppUpdateService,
  createUnsupportedAppUpdateService,
  type AppUpdateServiceLike,
} from "../app-update/app-update-service.js";
import { CapabilityCenter } from "../capability/capability-center.js";
import { captureKnowledgeAsset, reconcileKnowledgeAssets, removeKnowledgeAsset } from "./knowledge-asset-store.js";
import { ConfigCenter, createLocalConfigCenter } from "../config-center/index.js";
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
  createFileSystemPathMemoryRepository,
  createPathMemoryFeature,
  type PathMemoryFeature,
} from "../path-memory/index.js";
import {
  createOrdinaryPathMemoryConnector,
  type OrdinaryPathMemoryConnector,
} from "../path-memory/ordinary-path-memory-connector.js";
import {
  createExperienceCandidateFeature,
  createFileSystemExperienceCandidateRepository,
  type ExperienceCandidateFeature,
} from "../experience-candidate/index.js";
import {
  createAgentNotesFeature,
  createFileSystemAgentNoteRepository,
  type AgentNotesFeature,
} from "../agent-notes/index.js";
import {
  createSqliteSpaceRepository,
  createSpaceFeature,
  type SpaceFeature,
  type SpaceTreeEntry,
} from "../spaces/index.js";
import {
  createPersonalKnowledgeFeature,
  createSqlitePersonalKnowledgeRepository,
  type PersonalKnowledgeFeature,
} from "../personal-knowledge/index.js";
import {
  applyPendingWorkbenchRestore,
  createWorkbenchDataMaintenance,
  type WorkbenchDataMaintenance,
} from "./workbench-data-maintenance.js";
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
import type { ToolOutputStore } from "../tool-center/tool-output-store.js";
import type {
  PanelContextAttachmentMediaEntry,
  PanelContextAttachmentSelection,
  PanelExternalResourceTarget,
  PanelModelCatalogFetch,
  PanelProviderFetch,
  PanelServerOptions,
} from "./types.js";
import { desktopCapabilitySnapshotForRunStart } from "./desktop-run-model-settings.js";
import { PanelHttpError } from "./http-utils.js";
import { createOrdinaryAgentRunResourceAcquirer } from "./ordinary-agent-run-resources.js";
import { createHostFeatureAgentToolContributionResolver } from "./agent-tool-contributions.js";
import { resolveTriggeredSkillContexts } from "./skill-service.js";
import type { PanelRunInput } from "./request-parsers.js";
import { InMemoryLocalWorkspaceMutationCoordinator } from "../tool-center/adapters/local-workspace-mutation-coordinator.js";
import type { LocalWorkspaceMutationCoordinator } from "../tool-center/adapters/local-workspace-mutation-coordinator.js";
import { createInitialWorkbenchDataInitializer, initializeInitialWorkbenchData } from "./initial-workbench-data.js";
import { createSqliteWorkbenchAssetRepository, type WorkbenchAssetRepository } from "../workbench-assets/index.js";

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
  readonly externalResourceOpener?: (target: PanelExternalResourceTarget) => Promise<void>;
  readonly contextAttachmentMedia: Map<string, PanelContextAttachmentMediaEntry>;
  readonly activeRequestJobs: Set<Promise<void>>;
  readonly runtimePaths?: AgentArborRuntimePaths;
  readonly processRegistry: InMemoryProcessRegistry;
  readonly processTerminator: ProcessTerminator;
  readonly skillRoots: readonly SkillRootInput[];
  readonly subAgentRoots: readonly SubAgentRootInput[];
  readonly skillStateStore?: SkillStateStore;
  readonly appUpdateService: AppUpdateServiceLike;
  readonly ordinaryAgentFeature: OrdinaryAgentFeature;
  readonly agentNotesFeature: AgentNotesFeature;
  readonly spaceFeature: SpaceFeature;
  readonly personalKnowledgeFeature: PersonalKnowledgeFeature;
  readonly workbenchDataMaintenance: WorkbenchDataMaintenance;
  readonly pathMemoryFeature: PathMemoryFeature;
  readonly experienceCandidateFeature: ExperienceCandidateFeature;
  readonly ordinaryPathMemoryConnector: OrdinaryPathMemoryConnector;
  readonly prepareOrdinaryRunBirth: (input: PanelRunInput) => Promise<OrdinaryRunBirth>;
  readonly toolOutputStore: ToolOutputStore;
  readonly workbenchDatabase: SqliteRuntimeDatabase;
  readonly workbenchAssets: WorkbenchAssetRepository;
  readonly fileMutationCoordinator: LocalWorkspaceMutationCoordinator;
  readonly knowledgeAssetRoot?: string;
  /** Host-owned root for physical directories created from Space. */
  readonly managedSpaceFolderRoot: string;
  readonly knowledgeAssetsReady: Promise<void>;
  readonly ensureInitialWorkbenchData: () => Promise<void>;
  readonly flushSpaceKnowledgeSync: () => Promise<void>;
  readonly releaseAgentSessionStorage: () => Promise<void>;
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
      workbenchRestorePicker: options.workbenchRestorePicker,
      externalResourceOpener: options.externalResourceOpener,
      skillRoots: resolveSkillRoots(options),
      resolveSkillRoots: (input) => resolveSkillRoots(options, input),
      subAgentRoots: resolveSubAgentRoots(options),
      resolveSubAgentRoots: (input) => resolveSubAgentRoots(options, input),
      skillStateStore: resolveSkillStateStore(options.configDirectory),
      processTerminator: options.processTerminator,
      appUpdateService: resolveAppUpdateService(options),
      ordinaryAgentExecution: options.ordinaryAgentExecution,
      testOnlyAllowFakeModel: options.testOnlyAllowFakeModel,
      testOnlySkipInitialWorkbenchData: options.testOnlySkipInitialWorkbenchData,
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
    workbenchRestorePicker: options.workbenchRestorePicker,
    externalResourceOpener: options.externalResourceOpener,
    skillRoots: resolveSkillRoots(options),
    resolveSkillRoots: (input) => resolveSkillRoots(options, input),
    subAgentRoots: resolveSubAgentRoots(options),
    resolveSubAgentRoots: (input) => resolveSubAgentRoots(options, input),
    skillStateStore: resolveSkillStateStore(local.configDirectory),
    processTerminator: options.processTerminator,
    appUpdateService: resolveAppUpdateService(options),
    ordinaryAgentExecution: options.ordinaryAgentExecution,
    testOnlyAllowFakeModel: options.testOnlyAllowFakeModel,
    testOnlySkipInitialWorkbenchData: options.testOnlySkipInitialWorkbenchData,
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
  readonly workbenchRestorePicker?: () => Promise<string | undefined>;
  readonly externalResourceOpener?: (target: PanelExternalResourceTarget) => Promise<void>;
  readonly runtimePaths?: AgentArborRuntimePaths;
  readonly skillRoots: readonly SkillRootInput[];
  readonly resolveSkillRoots?: (input: PanelSkillRootsInput) => readonly SkillRootInput[];
  readonly subAgentRoots: readonly SubAgentRootInput[];
  readonly resolveSubAgentRoots?: (input: PanelSubAgentRootsInput) => readonly SubAgentRootInput[];
  readonly skillStateStore?: SkillStateStore;
  readonly processTerminator?: ProcessTerminator;
  readonly appUpdateService: AppUpdateServiceLike;
  readonly ordinaryAgentExecution?: import("../ordinary-agent/contracts.js").OrdinaryExecutionPort;
  readonly testOnlyAllowFakeModel?: boolean;
  readonly testOnlySkipInitialWorkbenchData?: boolean;
}): PanelRuntime {
  const activeRequestJobs = new Set<Promise<void>>();
  const contextAttachmentMedia = new Map<string, PanelContextAttachmentMediaEntry>();
  const agentDefinitionOverrides = new Map<string, AgentDefinition>();
  const processRegistry = new InMemoryProcessRegistry();
  const fileMutationCoordinator = new InMemoryLocalWorkspaceMutationCoordinator();
  const toolOutputStore = new FileSystemToolOutputStore(resolveToolEvidenceRoot(input));
  const processTerminator = input.processTerminator ?? createPlatformProcessTerminator();
  const runtimeHome = resolveRuntimeHome(input);
  applyPendingWorkbenchRestore(runtimeHome);
  const workbenchDatabase = new SqliteRuntimeDatabase(path.join(runtimeHome, "workbench.sqlite3"));
  const workbenchAssets = createSqliteWorkbenchAssetRepository(workbenchDatabase);
  const workbenchDataMaintenance = createWorkbenchDataMaintenance({
    database: workbenchDatabase,
    runtimeHome,
    restorePicker: input.workbenchRestorePicker,
  });
  const spaceRepository = createSqliteSpaceRepository(workbenchDatabase);
  const ordinaryRuntimeRoot = resolveOrdinaryRuntimeRoot(input);
  const agentNotesFeature = createAgentNotesFeature({
    repository: createFileSystemAgentNoteRepository(resolveAgentNotesRoot(input)),
  });
  const spaceFeature = createSpaceFeature({
    repository: spaceRepository,
    workspaceMountIdentity: canonicalWorkspaceMountIdentity,
  });
  let knowledgeAssetsReady = Promise.resolve();
  const personalKnowledgeFeature = createPersonalKnowledgeFeature({
    repository: createSqlitePersonalKnowledgeRepository(workbenchDatabase),
    spaceExists: async (spaceId) => await spaceFeature.queries.getTree(spaceId) !== undefined,
    spaceReferenceExists: async (itemId) => {
      for (const space of await spaceFeature.queries.list()) {
        const tree = await spaceFeature.queries.getTree(space.id);
        if (tree !== undefined && tree.entries.some((entry) => spaceTreeEntryContainsReference(entry, itemId))) return true;
      }
      return false;
    },
    captureSpaceReference: async ({ assetId, referenceId, relativePath }) => {
      await knowledgeAssetsReady;
      const item = await spaceFeature.queries.getReference(referenceId);
      if (item === undefined) throw new Error(`Space reference ${referenceId} does not exist.`);
      return await captureKnowledgeAsset(path.join(runtimeHome, "knowledge-assets"), assetId, item, relativePath);
    },
    removeManagedAsset: async (itemId) => await removeKnowledgeAsset(path.join(runtimeHome, "knowledge-assets"), itemId),
  });
  const knowledgeAssetRoot = path.join(runtimeHome, "knowledge-assets");
  const managedSpaceFolderRoot = path.join(runtimeHome, "space-folders");
  const initialWorkbenchData = createInitialWorkbenchDataInitializer(
    input.testOnlySkipInitialWorkbenchData
      ? async () => undefined
      : async () => await initializeInitialWorkbenchData({
          database: workbenchDatabase,
          spaceFeature,
          personalKnowledgeFeature,
          workbenchAssets,
      }),
  );
  // Warm the formal initial dataset without making a transient failure fatal to the Panel process.
  void initialWorkbenchData.ensure().catch(() => undefined);
  knowledgeAssetsReady = personalKnowledgeFeature.queries.snapshot().then(async (snapshot) => {
    await reconcileKnowledgeAssets(knowledgeAssetRoot, new Set(snapshot.pages.filter((page) => page.asset?.status === "managed").map((page) => page.refId)));
  });
  const spaceKnowledgeSync = Promise.resolve();
  const resolveFeatureToolContributions = createHostFeatureAgentToolContributionResolver({
    agentNotes: agentNotesFeature,
    spaces: spaceFeature,
    personalKnowledge: personalKnowledgeFeature,
  });
  const capabilityCenter = new CapabilityCenter({
    configCenter: input.configCenter,
    skillRoots: input.skillRoots,
    resolveSkillRoots: input.resolveSkillRoots,
    skillStateStore: input.skillStateStore,
    subAgentRoots: input.subAgentRoots,
    resolveSubAgentRoots: input.resolveSubAgentRoots,
    fetch: input.providerFetch,
    toolOutputStore,
    resolveToolContributions: resolveFeatureToolContributions,
  });
  const agentSessionEnvironment = new NodeExecutionEnv({ cwd: ordinaryRuntimeRoot });
  const agentSessionRepository = new FileSystemAgentSessionRepository({
    fileSystem: agentSessionEnvironment,
    sessionsRoot: path.join(ordinaryRuntimeRoot, "agent-sessions"),
  });
  const ordinaryRunResources = createOrdinaryAgentRunResourceAcquirer({
    host: {
      configCenter: input.configCenter,
      providerFetch: input.providerFetch,
      processRegistry,
      processTerminator,
      toolOutputStore,
      fileMutationCoordinator,
      testOnlyAllowFakeModel: input.testOnlyAllowFakeModel,
    },
    sessionRepository: agentSessionRepository,
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
    resolveFeatureToolContributions,
    resolveSubAgentRoots: (workspaceRoot) =>
      input.resolveSubAgentRoots?.({ workspaceDirectory: workspaceRoot }) ?? input.subAgentRoots,
  });
  const ordinaryAgentFeature = createOrdinaryAgentFeature({
    repository: createFileSystemOrdinaryRunRepository(ordinaryRuntimeRoot),
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(ordinaryRuntimeRoot),
    sessionRepository: agentSessionRepository,
    releaseToolEvidenceOwner: (ownerId) => toolOutputStore.releaseOwner(ownerId).then(() => undefined),
    onDiagnostic: (diagnostic) => {
      if (diagnostic.kind === "session_finalization_failed") {
        console.error(`[panel-server] Ordinary run ${diagnostic.runId} Session finalization failed; the conversation queue stays paused until a retry succeeds`, diagnostic.error);
      } else {
        console.error(`[panel-server] Ordinary conversation ${diagnostic.conversationId} is unavailable after startup recovery; its data remains on disk for diagnosis`, diagnostic.error);
      }
    },
    execution: input.ordinaryAgentExecution ?? createOrdinaryAgentLoopExecutionPort({
      resources: ordinaryRunResources,
      onReleaseError: (error) => console.error("[panel-server] Ordinary run resource release failed", error),
    }),
    ...(input.ordinaryAgentExecution === undefined ? {} : { testOnlyAllowSessionlessExecution: true }),
  });
  const pathMemoryFeature = createPathMemoryFeature({
    repository: createFileSystemPathMemoryRepository(resolvePathMemoryRoot(input)),
  });
  const experienceCandidateFeature = createExperienceCandidateFeature({
    repository: createFileSystemExperienceCandidateRepository(resolveExperienceCandidateRoot(input)),
    // Narrow cross-feature port: candidates only reference PathMemory records
    // that exist at proposal time; no feature object crosses the boundary.
    pathMemoryLookup: async (memoryId) => await pathMemoryFeature.queries.get(memoryId) !== undefined,
  });
  // Wiring adapter only: memory capture failures are diagnostics and never
  // block or rewrite the user's Ordinary runs.
  const ordinaryPathMemoryConnector = createOrdinaryPathMemoryConnector({
    ordinary: ordinaryAgentFeature,
    pathMemory: pathMemoryFeature,
    onDiagnostic: (diagnostic) => console.error(
      `[panel-server] PathMemory ${diagnostic.source} capture failed`,
      diagnostic.runId,
      diagnostic.error,
    ),
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
    externalResourceOpener: input.externalResourceOpener,
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
    ordinaryAgentFeature,
    agentNotesFeature,
    spaceFeature,
    personalKnowledgeFeature,
    workbenchDataMaintenance,
    pathMemoryFeature,
    experienceCandidateFeature,
    ordinaryPathMemoryConnector,
    prepareOrdinaryRunBirth: (runInput) => prepareOrdinaryRunBirth(runtime, runInput),
    toolOutputStore,
    workbenchDatabase,
    workbenchAssets,
    fileMutationCoordinator,
    knowledgeAssetRoot,
    managedSpaceFolderRoot,
    knowledgeAssetsReady,
    ensureInitialWorkbenchData: () => initialWorkbenchData.ensure(),
    flushSpaceKnowledgeSync: () => spaceKnowledgeSync,
    releaseAgentSessionStorage: () => agentSessionEnvironment.cleanup(),
  };
  return runtime;
}

async function canonicalWorkspaceMountIdentity(value: string): Promise<string> {
  const absolute = path.resolve(value);
  const canonical = await fs.realpath(absolute).catch(() => absolute);
  return process.platform === "win32" ? canonical.toLocaleLowerCase("en-US") : canonical;
}

function resolveRuntimeHome(input: {
  readonly runtimePaths?: AgentArborRuntimePaths;
  readonly configDirectory?: string;
}): string {
  const runtimeHome = input.runtimePaths?.runtimeHome ??
    (input.configDirectory === undefined ? undefined : path.join(input.configDirectory, "runtime"));
  if (runtimeHome === undefined) throw new Error("Panel runtime requires a runtime directory.");
  return runtimeHome;
}

function resolveOrdinaryRuntimeRoot(input: {
  readonly runtimePaths?: AgentArborRuntimePaths;
  readonly configDirectory?: string;
}): string {
  const runtimeHome = input.runtimePaths?.runtimeHome ??
    (input.configDirectory === undefined ? undefined : path.join(input.configDirectory, "runtime"));
  if (runtimeHome === undefined) {
    throw new Error("Ordinary Agent requires a runtime directory.");
  }
  return path.join(runtimeHome, "ordinary-agent");
}

function resolvePathMemoryRoot(input: {
  readonly runtimePaths?: AgentArborRuntimePaths;
  readonly configDirectory?: string;
}): string {
  const runtimeHome = input.runtimePaths?.runtimeHome ??
    (input.configDirectory === undefined ? undefined : path.join(input.configDirectory, "runtime"));
  if (runtimeHome === undefined) {
    throw new Error("PathMemory requires a runtime directory.");
  }
  return path.join(runtimeHome, "path-memory");
}

function resolveAgentNotesRoot(input: {
  readonly runtimePaths?: AgentArborRuntimePaths;
  readonly configDirectory?: string;
}): string {
  const runtimeHome = input.runtimePaths?.runtimeHome ??
    (input.configDirectory === undefined ? undefined : path.join(input.configDirectory, "runtime"));
  if (runtimeHome === undefined) {
    throw new Error("Agent notes require a runtime directory.");
  }
  return path.join(runtimeHome, "agent-notes");
}

function resolveExperienceCandidateRoot(input: {
  readonly runtimePaths?: AgentArborRuntimePaths;
  readonly configDirectory?: string;
}): string {
  const runtimeHome = input.runtimePaths?.runtimeHome ??
    (input.configDirectory === undefined ? undefined : path.join(input.configDirectory, "runtime"));
  if (runtimeHome === undefined) {
    throw new Error("ExperienceCandidate requires a runtime directory.");
  }
  return path.join(runtimeHome, "experience-candidates");
}

function resolveToolEvidenceRoot(input: {
  readonly runtimePaths?: AgentArborRuntimePaths;
  readonly configDirectory?: string;
}): string {
  const runtimeHome = input.runtimePaths?.runtimeHome ??
    (input.configDirectory === undefined ? undefined : path.join(input.configDirectory, "runtime"));
  if (runtimeHome === undefined) {
    throw new Error("Tool evidence requires a runtime directory.");
  }
  return path.join(runtimeHome, "tool-evidence");
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
  const configuredDefinition = desktopAgentDefinitionFromConfig(runtime.desktopAgentDefinition, desktopAgentConfig);
  const workspaceRoot = input.workspaceDirectory ?? process.cwd();
  const noteInjection = await runtime.agentNotesFeature.queries.startupInjection(workspaceRoot);
  // The injected note is frozen with this run's definition. This preserves the
  // existing definition/hash invariant: a restarted run uses exactly the notes
  // it saw at birth, while the next run sees any later model-written revision.
  const definition = definitionWithAgentNotes(configuredDefinition, noteInjection);
  const agentDefinitionRef = runAgentDefinitionRef(definition);
  runtime.agentDefinitionOverrides.set(runAgentDefinitionRefCacheKey(agentDefinitionRef), definition);
  return {
    instructions: definition.prompt.systemPrompt,
    aiMode: input.aiMode ?? capabilitySnapshot.activeModel.defaultAiMode,
    config: capabilitySnapshot.activeModel,
    reasoningEffort: input.reasoningEffort,
    agentDefinitionRef,
    capabilitySnapshot,
    workspaceSelection: input.workspaceDirectory === undefined ? "default" : "explicit",
    informationAccess,
    toolConfirmationPolicy: input.toolConfirmationPolicy ?? toolConfirmation.policy,
  };
}

function definitionWithAgentNotes(
  definition: AgentDefinition,
  noteInjection: string | undefined,
): AgentDefinition {
  if (noteInjection === undefined) return definition;
  const systemPrompt = `${definition.prompt.systemPrompt}\n\n<agent_notes>\n${noteInjection}\n</agent_notes>`;
  const fingerprint = createHash("sha256").update(systemPrompt, "utf8").digest("hex").slice(0, 12);
  return {
    ...definition,
    prompt: {
      ...definition.prompt,
      promptRef: `${definition.prompt.promptRef}:agent-notes`,
      version: `${definition.prompt.version}:notes-${fingerprint}`,
      systemPrompt,
    },
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

export async function cleanupPanelRuntimeOwnedProcesses(
  runtime: PanelRuntime
): Promise<ProcessRegistryCleanupResult> {
  return runtime.processRegistry.cleanupOwnedProcesses(runtime.processTerminator);
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

function resolvePanelRuntimePaths(configDirectory: string | undefined): AgentArborRuntimePaths | undefined {
  return configDirectory === undefined ? undefined : resolveAgentArborRuntimePaths(configDirectory);
}

function spaceTreeEntryContainsReference(entry: SpaceTreeEntry, itemId: string): boolean {
  return entry.item.id === itemId;
}
