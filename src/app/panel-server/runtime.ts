import { createHash, randomUUID } from "node:crypto";
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
import {
  captureKnowledgeAsset,
  managedKnowledgeDocumentTarget,
  reconcileKnowledgeAssets,
  removeKnowledgeAsset,
  stageKnowledgeAssetRemoval,
} from "./knowledge-asset-store.js";
import { updateLocalDocumentText } from "./local-document-preview.js";
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
  createFileSystemOrdinaryManagedAttachmentRepository,
  OrdinaryManagedAttachmentRepositoryError,
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
  canonicalSpacePathIdentity,
  createSpaceRunPathAuthorization,
  createSpaceRevocationOverlay,
  createFileSystemSpaceReferenceDeletionJournal,
  createSqliteSpaceRepository,
  createSpaceFeature,
  inspectSpaceExternalSource,
  inspectFileSystemSpaceReferenceDeletionJournal,
  spaceReferenceIdFromAttachmentId,
  spaceExternalReferenceStatus,
  type SpaceEvent,
  type SpaceFeature,
} from "../spaces/index.js";
import {
  createPersonalKnowledgeFeature,
  createSqlitePersonalKnowledgeRepository,
  PersonalKnowledgeError,
  type PersonalKnowledgeEvent,
  type PersonalKnowledgeFeature,
} from "../personal-knowledge/index.js";
import {
  createSqliteWorkspaceRepository,
  createWorkspaceFeature,
  type WorkspaceFeature,
} from "../workspaces/index.js";
import {
  applyPendingWorkbenchRestore,
  createWorkbenchDataMaintenance,
  hasUnappliedPendingWorkbenchRestore,
  WorkbenchDataMaintenanceError,
  type WorkbenchDataMaintenance,
} from "./workbench-data-maintenance.js";
import { createSpaceReferenceDeletionFilePort } from "./space-reference-deletion.js";
import {
  createPlatformProcessTerminator,
  InMemoryProcessRegistry,
  processCleanupHasUnresolvedStops,
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
import {
  createWorkbenchProjectionChangeFeed,
  type WorkbenchProjectionChangeFeed,
} from "./workbench-projection-change-feed.js";
import {
  createSpaceConversationDeletionCoordinator,
  type SpaceConversationDeletionCoordinator,
  createSpaceConversationLinkCoordinator,
  type SpaceConversationLinkCoordinator,
} from "./space-conversation-coordinator.js";
import { createSqliteSpaceConversationDeletionJournal } from "./space-conversation-deletion-journal.js";
import { createSqliteSpaceConversationLinkJournal } from "./space-conversation-link-journal.js";

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
  readonly resolveManagedAttachmentPath: (attachmentId: string) => Promise<string | undefined>;
  readonly agentNotesFeature: AgentNotesFeature;
  readonly spaceFeature: SpaceFeature;
  readonly spaceConversationLink: SpaceConversationLinkCoordinator;
  readonly spaceConversationDeletion: SpaceConversationDeletionCoordinator;
  readonly personalKnowledgeFeature: PersonalKnowledgeFeature<import("../panel-api-contracts.js").DocumentPreview>;
  readonly workbenchDataMaintenance: WorkbenchDataMaintenance;
  readonly pathMemoryFeature: PathMemoryFeature;
  readonly experienceCandidateFeature: ExperienceCandidateFeature;
  readonly ordinaryPathMemoryConnector: OrdinaryPathMemoryConnector;
  readonly prepareOrdinaryRunBirth: (input: PanelRunInput) => Promise<OrdinaryRunBirth>;
  readonly toolOutputStore: ToolOutputStore;
  readonly workbenchDatabase: SqliteRuntimeDatabase;
  readonly workbenchAssets: WorkbenchAssetRepository;
  readonly fileMutationCoordinator: LocalWorkspaceMutationCoordinator;
  readonly workbenchProjectionChanges: WorkbenchProjectionChangeFeed;
  readonly releaseWorkbenchProjectionChanges: () => void;
  readonly knowledgeAssetRoot?: string;
  /** Host-owned root for physical directories created from Space. */
  readonly managedSpaceFolderRoot: string;
  readonly knowledgeAssetsReady: Promise<void>;
  readonly ensureInitialWorkbenchData: () => Promise<void>;
  readonly flushSpaceKnowledgeSync: () => Promise<void>;
  readonly flushSpaceProcessCleanup: () => Promise<void>;
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

export async function preparePanelRuntimeStorageForStartup(runtimeHome: string): Promise<void> {
  const journalRoot = path.join(runtimeHome, "space-reference-deletions");
  if (!hasUnappliedPendingWorkbenchRestore(runtimeHome) ||
    inspectFileSystemSpaceReferenceDeletionJournal(journalRoot) === "idle") return;

  const databasePath = path.join(runtimeHome, "workbench.sqlite3");
  try {
    await fs.access(databasePath);
  } catch (error) {
    throw new WorkbenchDataMaintenanceError(
      "data_maintenance_failed",
      "Workbench 恢复前无法读取保存 Space 删除身份的当前数据库；恢复未修改任何数据。",
      { cause: error },
    );
  }
  const database = new SqliteRuntimeDatabase(databasePath);
  let spaceFeature: SpaceFeature | undefined;
  let startupError: unknown;
  try {
    const workbenchAssets = createSqliteWorkbenchAssetRepository(database);
    spaceFeature = createSpaceFeature({
      repository: createSqliteSpaceRepository(database),
      ownedAssetDeletion: {
        deleteWorkbenchAssets: async (assetIds) => await workbenchAssets.removeMany(assetIds),
      },
      referenceDeletion: {
        journal: createFileSystemSpaceReferenceDeletionJournal(journalRoot),
        files: createSpaceReferenceDeletionFilePort(path.join(runtimeHome, "space-folders")),
        leases: new InMemoryLocalWorkspaceMutationCoordinator(),
        deleteOwnedAssets: async (assetIds) => await workbenchAssets.removeMany(assetIds),
      },
    });
    await spaceFeature.ready();
  } catch (error) {
    startupError = error;
  }

  const cleanupErrors: unknown[] = [];
  if (spaceFeature !== undefined) {
    try { await spaceFeature.release(); } catch (error) { cleanupErrors.push(error); }
  }
  try { database.close(); } catch (error) { cleanupErrors.push(error); }
  if (startupError !== undefined) {
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [startupError, ...cleanupErrors],
        "Space deletion recovery before Workbench restore and cleanup both failed.",
      );
    }
    throw startupError;
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, "Space deletion recovery cleanup before Workbench restore failed.");
  }
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
  const workbenchProjectionChanges = createWorkbenchProjectionChangeFeed();
  const toolOutputStore = new FileSystemToolOutputStore(resolveToolEvidenceRoot(input));
  const processTerminator = input.processTerminator ?? createPlatformProcessTerminator();
  const runtimeHome = resolveRuntimeHome(input);
  const knowledgeAssetRoot = path.join(runtimeHome, "knowledge-assets");
  const managedSpaceFolderRoot = path.join(runtimeHome, "space-folders");
  let knowledgeAssetsReady = Promise.resolve();
  applyPendingWorkbenchRestore(runtimeHome, {
    assertSpaceDeletionIdle: () => assertSpaceDeletionJournalIdle(runtimeHome),
  });
  const {
    database: workbenchDatabase,
    workbenchAssets,
    spaceRepository,
    personalKnowledgeRepository,
  } = openPanelWorkbenchStorage(runtimeHome);
  const spaceConversationDeletionJournal = createSqliteSpaceConversationDeletionJournal(workbenchDatabase);
  const spaceConversationLinkJournal = createSqliteSpaceConversationLinkJournal(workbenchDatabase);
  let beforeWorkbenchRestoreStage: (() => Promise<void>) | undefined;
  const workbenchDataMaintenance = createWorkbenchDataMaintenance({
    database: workbenchDatabase,
    runtimeHome,
    restorePicker: input.workbenchRestorePicker,
    beforeRestoreStage: async () => {
      if (beforeWorkbenchRestoreStage === undefined) {
        throw new Error("Panel runtime restore preparation is not initialized.");
      }
      await beforeWorkbenchRestoreStage();
    },
    runOwnedStorageSnapshot: async (operation) => {
      await knowledgeAssetsReady;
      return await fileMutationCoordinator.runExclusive(runtimeHome, async () => {
        if ((await spaceReferenceDeletionJournal.list()).length > 0) {
          throw new Error("Workbench storage cannot be snapshotted while a Space deletion journal is pending.");
        }
        if ((await spaceConversationDeletionJournal.list()).length > 0) {
          throw new Error("Workbench storage cannot be snapshotted while a Space Conversation deletion is pending.");
        }
        if ((await spaceConversationLinkJournal.list()).length > 0) {
          throw new Error("Workbench storage cannot be snapshotted while a Conversation link lifecycle is pending.");
        }
        return await operation();
      });
    },
  });
  const spaceReferenceDeletionJournal = createFileSystemSpaceReferenceDeletionJournal(
    path.join(runtimeHome, "space-reference-deletions"),
  );
  const ordinaryRuntimeRoot = resolveOrdinaryRuntimeRoot(input);
  const managedAttachmentInstanceId = randomUUID();
  const managedAttachmentRepository = createFileSystemOrdinaryManagedAttachmentRepository(
    path.join(ordinaryRuntimeRoot, "managed-attachments"),
  );
  const resolveManagedAttachmentPath = async (attachmentId: string): Promise<string | undefined> => {
    try {
      return await managedAttachmentRepository.resolveContentPath(attachmentId);
    } catch (error) {
      if (error instanceof OrdinaryManagedAttachmentRepositoryError &&
        error.code === "ordinary_managed_attachment_not_found") return undefined;
      throw error;
    }
  };
  const agentNotesFeature = createAgentNotesFeature({
    repository: createFileSystemAgentNoteRepository(resolveAgentNotesRoot(input)),
  });
  const spaceFeature = createSpaceFeature({
    repository: spaceRepository,
    workspaceMountIdentity: canonicalWorkspaceMountIdentity,
    externalSourceInspector: inspectSpaceExternalSource,
    ownedAssetDeletion: {
      deleteWorkbenchAssets: async (assetIds) => await workbenchAssets.removeMany(assetIds),
    },
    referenceDeletion: {
      journal: spaceReferenceDeletionJournal,
      files: createSpaceReferenceDeletionFilePort(managedSpaceFolderRoot),
      leases: fileMutationCoordinator,
      onDiagnostic: (diagnostic) => {
        console.error(
          `[panel-server] Committed Space deletion ${diagnostic.deletionId} cleanup reported a failure; any retained journal state will be reconciled on the next startup`,
          diagnostic.error,
        );
      },
      deleteOwnedAssets: async (assetIds) => await workbenchAssets.removeMany(assetIds),
    },
  });
  const unlinkSpaceExternalReference = async (referenceId: string): Promise<void> => {
    try {
      await spaceFeature.commands.unlinkReference(referenceId);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "space_reference_not_found")) throw error;
    }
  };
  const workspaceFeature: WorkspaceFeature = createWorkspaceFeature({
    repository: createSqliteWorkspaceRepository(workbenchDatabase),
  });
  const personalKnowledgeFeature = createPersonalKnowledgeFeature({
    repository: personalKnowledgeRepository,
    spaceExists: async (spaceId) => await spaceFeature.queries.getTree(spaceId) !== undefined,
    runManagedAssetMutation: async (operation) => {
      await knowledgeAssetsReady;
      return await fileMutationCoordinator.runExclusive(knowledgeAssetRoot, operation);
    },
    captureSpaceReference: async ({ assetId, referenceId, relativePath }) => {
      const item = await spaceFeature.queries.getReference(referenceId);
      if (item === undefined) return undefined;
      if (await spaceExternalReferenceStatus(item) !== "current") {
        await unlinkSpaceExternalReference(referenceId);
        return undefined;
      }
      const asset = await captureKnowledgeAsset(knowledgeAssetRoot, assetId, item, relativePath);
      if (await spaceExternalReferenceStatus(item) === "current") return asset;
      await removeKnowledgeAsset(knowledgeAssetRoot, assetId);
      await unlinkSpaceExternalReference(referenceId);
      return undefined;
    },
    removeManagedAsset: async (itemId) => await removeKnowledgeAsset(knowledgeAssetRoot, itemId),
    stageManagedAssetRemoval: async (itemId) => await stageKnowledgeAssetRemoval(knowledgeAssetRoot, itemId),
    writeManagedAssetText: async ({ page, relativePath, expectedFingerprint, text }) => {
      await knowledgeAssetsReady;
      const target = managedKnowledgeDocumentTarget(knowledgeAssetRoot, page);
      return await fileMutationCoordinator.runExclusive(target.mutationKey, async () =>
        await updateLocalDocumentText(
          target.rootDir,
          relativePath,
          { expectedFingerprint, text },
          target.meta,
          {
            contentBaseUrl: `/api/personal-knowledge/assets/${encodeURIComponent(page.refId)}/content`,
            contentTypeHintPath: target.contentTypeHintPath(relativePath),
          },
        ).catch((error: unknown) => {
          throw managedKnowledgeAssetWriteError(error);
        }));
    },
  });
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
  knowledgeAssetsReady = personalKnowledgeFeature.queries.snapshot().then(async (snapshot) => {
    await fileMutationCoordinator.runExclusive(knowledgeAssetRoot, async () => await reconcileKnowledgeAssets(
      knowledgeAssetRoot,
      new Set(snapshot.pages.filter((page) => page.asset?.status === "managed").map((page) => page.refId)),
    ));
  });
  // Warm the formal initial dataset after owned storage reconciliation has started.
  void initialWorkbenchData.ensure().catch(() => undefined);
  const spaceKnowledgeSync = Promise.resolve();
  const spaceRevocationOverlay = createSpaceRevocationOverlay(spaceFeature.events);
  const contextAttachmentReadAuthorization = {
    async assertReadAllowed(attachmentId: string): Promise<void> {
      spaceRevocationOverlay.assertReadAllowed(attachmentId);
      const referenceId = spaceReferenceIdFromAttachmentId(attachmentId);
      if (referenceId === undefined) return;
      const item = await spaceFeature.queries.getReference(referenceId);
      if (item === undefined) {
        throw new Error(`Space reference ${referenceId} was removed and is no longer readable.`);
      }
      if (await spaceExternalReferenceStatus(item) === "current") return;
      await unlinkSpaceExternalReference(referenceId);
      throw new Error(`Space reference ${referenceId} no longer points to its original source and was removed.`);
    },
  };
  const activeSpaceProcessCleanups = new Set<Promise<void>>();
  const trackSpaceProcessCleanup = (
    cleanup: Promise<ProcessRegistryCleanupResult>,
    referenceId: string,
  ): void => {
    let tracked: Promise<void>;
    tracked = cleanup.then((result) => {
      if (processCleanupHasUnresolvedStops(result)) {
        console.error(
          `[panel-server] Space reference ${referenceId} was revoked but one or more managed processes remain stop_pending`,
          result.fact,
        );
      }
    }, (error: unknown) => {
      console.error(`[panel-server] Space reference ${referenceId} process cleanup failed`, error);
    }).finally(() => {
      activeSpaceProcessCleanups.delete(tracked);
    });
    activeSpaceProcessCleanups.add(tracked);
  };
  const spaceProcessLifecycleUnsubscribe = spaceFeature.events.subscribe((event) => {
    if (event.type !== "space.reference_removed") return;
    for (const referenceId of event.removedItemIds) {
      // revokeByReference marks matching records before its first await.
      trackSpaceProcessCleanup(
        processRegistry.revokeByReference(referenceId, processTerminator),
        referenceId,
      );
    }
  });
  const resolveFeatureToolContributions = createHostFeatureAgentToolContributionResolver({
    agentNotes: agentNotesFeature,
    spaces: spaceFeature,
    personalKnowledge: personalKnowledgeFeature,
    revocationOverlay: spaceRevocationOverlay,
    assertSpaceAvailable: (spaceId) => spaceConversationDeletion.assertAvailable(spaceId),
    deleteSpace: (spaceId) => spaceConversationDeletion.deleteSpace(spaceId),
    deleteConversation: (conversationId) => spaceConversationLink.deleteConversation(conversationId),
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
      resolveManagedAttachmentPath,
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
    contextAttachmentReadAuthorization,
    resolveWorkspacePathAuthorization: ({ taskSoil, workspaceRoot }) =>
      createSpaceRunPathAuthorization({
        taskSoil,
        workspaceRoot,
        revocationOverlay: spaceRevocationOverlay,
        onInvalidReference: unlinkSpaceExternalReference,
      }),
    resolveSubAgentRoots: (workspaceRoot) =>
      input.resolveSubAgentRoots?.({ workspaceDirectory: workspaceRoot }) ?? input.subAgentRoots,
  });
  const ordinaryAgentFeature = createOrdinaryAgentFeature({
    repository: createFileSystemOrdinaryRunRepository(ordinaryRuntimeRoot),
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(ordinaryRuntimeRoot),
    sessionRepository: agentSessionRepository,
    releaseToolEvidenceOwner: (ownerId) => toolOutputStore.releaseOwner(ownerId).then(() => undefined),
    managedAttachmentRepository,
    managedAttachmentInstanceId,
    onDiagnostic: (diagnostic) => {
      if (diagnostic.kind === "session_finalization_failed") {
        console.error(`[panel-server] Ordinary run ${diagnostic.runId} Session finalization failed; the conversation queue stays paused until a retry succeeds`, diagnostic.error);
      } else if (diagnostic.kind === "conversation_unavailable") {
        console.error(`[panel-server] Ordinary conversation ${diagnostic.conversationId} is unavailable after startup recovery; its data remains on disk for diagnosis`, diagnostic.error);
      } else if (diagnostic.kind === "successor_activation_failed") {
        const activationOwner = diagnostic.predecessorRunId ?? diagnostic.conversationId;
        console.error(`[panel-server] Ordinary successor activation attempt ${diagnostic.consecutiveFailures} failed for ${activationOwner}; retrying in ${diagnostic.retryDelayMs}ms`, diagnostic.error);
      } else if (diagnostic.kind === "cancellation_cleanup_failed") {
        console.error(`[panel-server] Ordinary run ${diagnostic.runId} cancellation cleanup failed during ${diagnostic.phase}; its durable cancelled fact remains authoritative`, diagnostic.error);
      } else if (diagnostic.kind === "conversation_cleanup_failed") {
        const resourceOwner = diagnostic.runId ?? diagnostic.conversationId;
        console.error(`[panel-server] Ordinary conversation ${diagnostic.conversationId} cleanup failed during ${diagnostic.phase} for ${resourceOwner}; the durable state remains available for diagnosis or retry`, diagnostic.error);
      } else if (diagnostic.kind === "managed_attachment_cleanup_failed") {
        console.error(`[panel-server] Ordinary conversation ${diagnostic.conversationId} managed attachment cleanup failed; startup will retry`, diagnostic.error);
      } else if (diagnostic.kind === "managed_attachment_recovery_issue") {
        console.error(`[panel-server] Ordinary managed attachment ${diagnostic.identity ?? "storage"} recovery was isolated`, diagnostic.error);
      } else if (diagnostic.kind === "managed_attachment_claim_rollback_failed") {
        console.error(`[panel-server] Ordinary run ${diagnostic.runId} could not roll back managed attachment claims; the feature will retry and startup reconciliation remains the final fallback`, diagnostic.error);
      } else if (diagnostic.kind === "completion_commit_failed") {
        console.error(`[panel-server] Ordinary run ${diagnostic.runId} completed in Pi but its terminal snapshot could not be committed; the run remains blocked instead of being rewritten as failed`, diagnostic.error);
      } else {
        console.error(`[panel-server] Ordinary startup recovery could not enumerate ${diagnostic.source}; new live conversations remain available`, diagnostic.error);
      }
    },
    execution: input.ordinaryAgentExecution ?? createOrdinaryAgentLoopExecutionPort({
      resources: ordinaryRunResources,
      onReleaseError: (error) => console.error("[panel-server] Ordinary run resource release failed", error),
    }),
    ...(input.ordinaryAgentExecution === undefined ? {} : { testOnlyAllowSessionlessExecution: true }),
  });
  const spaceConversationDeletion = createSpaceConversationDeletionCoordinator({
    spaces: spaceFeature,
    ordinary: ordinaryAgentFeature,
    personalKnowledge: personalKnowledgeFeature,
    processes: processRegistry,
    processTerminator,
    journal: spaceConversationDeletionJournal,
    runExclusive: async (operation) => await fileMutationCoordinator.runExclusive(runtimeHome, operation),
  });
  const spaceConversationLink = createSpaceConversationLinkCoordinator({
    spaces: spaceFeature,
    ordinary: ordinaryAgentFeature,
    workspaces: { queries: workspaceFeature.queries },
    processes: processRegistry,
    processTerminator,
    journal: spaceConversationLinkJournal,
    runExclusive: async (operation) => await fileMutationCoordinator.runExclusive(runtimeHome, operation),
  });
  const projectionChangeUnsubscribers = [
    spaceFeature.events.subscribe((event) => {
      workbenchProjectionChanges.publish(projectionChangeFromSpace(event));
    }),
    personalKnowledgeFeature.events.subscribe((event) => {
      workbenchProjectionChanges.publish(projectionChangeFromPersonalKnowledge(event));
    }),
    fileMutationCoordinator.events.subscribe(() => {
      workbenchProjectionChanges.publish({ owners: ["mounted_files"] });
    }),
    ordinaryAgentFeature.events.subscribeStableTerminalRuns(() => {
      // A terminal run invalidates only the mounted-file projection. Missing Space sources are
      // reported by the actual preview/tool access and are never discovered by a background scan.
      workbenchProjectionChanges.publish({ owners: ["mounted_files"] });
    }),
  ];
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
    resolveManagedAttachmentPath,
    agentNotesFeature,
    spaceFeature,
    spaceConversationLink,
    spaceConversationDeletion,
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
    workbenchProjectionChanges,
    releaseWorkbenchProjectionChanges: () => {
      for (const unsubscribe of projectionChangeUnsubscribers.splice(0)) unsubscribe();
      spaceProcessLifecycleUnsubscribe();
      spaceRevocationOverlay.dispose();
      workbenchProjectionChanges.release();
    },
    knowledgeAssetRoot,
    managedSpaceFolderRoot,
    knowledgeAssetsReady,
    ensureInitialWorkbenchData: () => initialWorkbenchData.ensure(),
    flushSpaceKnowledgeSync: () => spaceKnowledgeSync,
    flushSpaceProcessCleanup: async () => {
      while (activeSpaceProcessCleanups.size > 0) {
        await Promise.all([...activeSpaceProcessCleanups]);
      }
    },
    releaseAgentSessionStorage: () => agentSessionEnvironment.cleanup(),
  };
  let restorePreparation: Promise<void> | undefined;
  beforeWorkbenchRestoreStage = () => restorePreparation ??= (async () => {
    runtime.isQuiescing = true;
    await ordinaryAgentFeature.release();
    await initialWorkbenchData.ensure();
    await personalKnowledgeFeature.release();
    await spaceFeature.release();
  })();
  return runtime;
}

function openPanelWorkbenchStorage(runtimeHome: string) {
  const database = new SqliteRuntimeDatabase(path.join(runtimeHome, "workbench.sqlite3"));
  try {
    return {
      database,
      workbenchAssets: createSqliteWorkbenchAssetRepository(database),
      spaceRepository: createSqliteSpaceRepository(database),
      personalKnowledgeRepository: createSqlitePersonalKnowledgeRepository(database),
    };
  } catch (startupError) {
    try {
      database.close();
    } catch (cleanupError) {
      throw new AggregateError(
        [startupError, cleanupError],
        "Workbench storage initialization and cleanup both failed.",
      );
    }
    throw startupError;
  }
}

function assertSpaceDeletionJournalIdle(runtimeHome: string): void {
  const status = inspectFileSystemSpaceReferenceDeletionJournal(
    path.join(runtimeHome, "space-reference-deletions"),
  );
  if (status !== "idle") throw new Error("Space deletion recovery is still pending.");
}

function projectionChangeFromSpace(event: SpaceEvent) {
  switch (event.type) {
    case "space.created":
      return { owners: ["spaces"] as const, spaceIds: [event.space.id] };
    case "space.deleted":
      return {
        owners: ["spaces"] as const,
        spaceIds: [event.spaceId],
        referenceIds: event.removedReferenceIds,
      };
    case "space.reference_added":
      return {
        owners: ["spaces"] as const,
        spaceIds: [event.item.spaceId],
        referenceIds: [event.item.id],
      };
    case "space.renamed":
      return {
        owners: ["spaces"] as const,
        spaceIds: [event.spaceId],
        ...(event.target.kind === "reference" ? { referenceIds: [event.target.id] } : {}),
      };
    case "space.moved":
      return {
        owners: ["spaces"] as const,
        spaceIds: [event.sourceSpaceId, event.destinationSpaceId],
        referenceIds: [event.target.id],
      };
    case "space.reference_removed":
      return {
        owners: ["spaces"] as const,
        spaceIds: [event.spaceId],
        referenceIds: event.removedItemIds,
      };
  }
}

function projectionChangeFromPersonalKnowledge(event: PersonalKnowledgeEvent) {
  switch (event.type) {
    case "personal_knowledge.note_created":
      return {
        owners: ["personal_knowledge"] as const,
        spaceIds: [event.spaceId],
        noteIds: [event.noteId],
      };
    case "personal_knowledge.note_updated":
    case "personal_knowledge.note_deleted":
      return {
        owners: ["personal_knowledge"] as const,
        noteIds: [event.noteId],
      };
    case "personal_knowledge.changed":
      return {
        owners: ["personal_knowledge"] as const,
        ...(event.refIds === undefined ? {} : { referenceIds: event.refIds }),
      };
  }
}

function managedKnowledgeAssetWriteError(error: unknown): unknown {
  if (!(error instanceof PanelHttpError)) return error;
  switch (error.code) {
    case "space_reference_revision_conflict":
      return new PersonalKnowledgeError("knowledge_asset_revision_conflict", error.message, { cause: error });
    case "space_reference_source_missing":
      return new PersonalKnowledgeError("knowledge_asset_source_missing", error.message, { cause: error });
    case "space_reference_not_editable":
      return new PersonalKnowledgeError("knowledge_asset_not_editable", error.message, { cause: error });
    default:
      return new PersonalKnowledgeError("knowledge_asset_write_failed", error.message, { cause: error });
  }
}

/**
 * 挂载身份统一使用斜杠分隔，使同 Space 的父子重叠检测可以按路径段边界比较。
 * Windows 走不区分大小写的规范形式，Unix 保留大小写语义。
 */
async function canonicalWorkspaceMountIdentity(value: string): Promise<string> {
  return await canonicalSpacePathIdentity(value, (target) => fs.realpath(target));
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
    capabilitySnapshotForRun(runtime, input.modelOverride),
    runtime.configCenter.getDesktopAgentConfig(),
  ]);
  const capabilitySnapshot = desktopCapabilitySnapshotForRunStart(
    baseCapabilitySnapshot,
    input.reasoningEffort,
  );
  const configuredDefinition = desktopAgentDefinitionFromConfig(runtime.desktopAgentDefinition, desktopAgentConfig);
  const workspaceRoot = capabilitySnapshot.workspace.workspaceDirectory;
  const noteSnapshot = await runtime.agentNotesFeature.queries.startupSnapshot(workspaceRoot);
  // The injected note is frozen with this run's definition. This preserves the
  // existing definition/hash invariant: a restarted run uses exactly the notes
  // it saw at birth, while the next run sees any later model-written revision.
  const definition = definitionWithAgentNotes(configuredDefinition, noteSnapshot.injection);
  const agentDefinitionRef = runAgentDefinitionRef(definition);
  runtime.agentDefinitionOverrides.set(runAgentDefinitionRefCacheKey(agentDefinitionRef), definition);
  return {
    instructions: definition.prompt.systemPrompt,
    aiMode: input.aiMode ?? capabilitySnapshot.activeModel.defaultAiMode,
    config: capabilitySnapshot.activeModel,
    reasoningEffort: input.reasoningEffort,
    agentDefinitionRef,
    capabilitySnapshot,
    agentNoteVersions: noteSnapshot.versions,
    workspaceSelection: "default",
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
  await runtime.flushSpaceProcessCleanup();
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
): Promise<import("../../domain/config/index.js").BasicAgentCapabilitySnapshot> {
  const snapshot = await runtime.capabilityCenter.snapshot();
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
