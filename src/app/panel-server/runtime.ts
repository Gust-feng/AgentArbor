import path from "node:path";
import {
  FileSystemRuntimeDatabase,
  resolveAgentArborRuntimeDatabasePaths,
  type FileSystemRuntimeDatabasePaths,
} from "../../adapters/runtime-database/index.js";
import type { ModelOutputDelta } from "../../domain/intelligence/index.js";
import type { RuntimeDatabase } from "../../domain/runtime-database/index.js";
import {
  BasicAgentRunExecutor,
  type BasicAgentRunExecutionInput,
  type BasicAgentRunExecutionResult,
} from "../basic-agent-runtime/index.js";
import { CapabilityCenter } from "../capability-center.js";
import { ConfigCenter, createLocalConfigCenter } from "../config-center.js";
import { PanelConversationStore } from "../panel-conversations.js";
import { PanelRunJobStore, type PanelRunJob } from "../panel-run-jobs.js";
import {
  FileSystemSkillStateStore,
  resolveSkillStateStorePath,
  type SkillStateStore,
} from "../skills/index.js";
import type { PanelModelCatalogFetch, PanelProviderFetch, PanelServerOptions } from "./types.js";
import { syncConversationTurnForJob } from "./conversation-sync.js";
import { appendLiveModelOutputDelta } from "./live-model-stream.js";
import { persistPanelRun, persistPanelRunInBackground } from "./run-persistence.js";
import { createPanelRunJobResponse } from "./run-job-response.js";

export type PanelRuntime = {
  readonly configCenter: ConfigCenter;
  readonly capabilityCenter: CapabilityCenter;
  readonly configDirectory?: string;
  readonly providerFetch?: PanelProviderFetch;
  readonly modelCatalogFetch?: PanelModelCatalogFetch;
  readonly workspaceDirectoryPicker?: () => Promise<string | undefined>;
  readonly runJobs: PanelRunJobStore;
  readonly activeRunJobs: Set<Promise<void>>;
  readonly abortControllers: Map<string, AbortController>;
  readonly persistenceChains: Map<string, Promise<void>>;
  readonly runExecutor: BasicAgentRunExecutor;
  readonly conversations: PanelConversationStore;
  readonly runtimeDatabase?: RuntimeDatabase;
  readonly runtimePaths?: FileSystemRuntimeDatabasePaths;
  readonly skillRoots: readonly string[];
  readonly skillStateStore?: SkillStateStore;
};

export type PanelRuntimeHooks = {
  readonly executeRun: (runtime: PanelRuntime, execution: BasicAgentRunExecutionInput) => Promise<BasicAgentRunExecutionResult>;
  readonly failRun: (runtime: PanelRuntime, job: PanelRunJob, error: unknown) => Promise<void>;
  readonly scheduleNextQueuedConversationRun: (runtime: PanelRuntime, completedJob: PanelRunJob) => void;
};

export function createPanelRuntime(options: PanelServerOptions, hooks: PanelRuntimeHooks): PanelRuntime {
  if (options.configCenter !== undefined) {
    const runtimePersistence = createPanelRuntimePersistence(options.configDirectory, options.runtimeDatabase);
    return assemblePanelRuntime({
      configCenter: options.configCenter,
      configDirectory: options.configDirectory,
      providerFetch: options.providerFetch,
      modelCatalogFetch: options.modelCatalogFetch,
      workspaceDirectoryPicker: options.workspaceDirectoryPicker,
      skillRoots: resolveSkillRoots(options),
      skillStateStore: resolveSkillStateStore(options.configDirectory),
      hooks,
      ...runtimePersistence,
    });
  }
  const local = createLocalConfigCenter({ configDirectory: options.configDirectory });
  const runtimePersistence = createPanelRuntimePersistence(local.configDirectory, options.runtimeDatabase);
  return assemblePanelRuntime({
    configCenter: local.configCenter,
    configDirectory: local.configDirectory,
    providerFetch: options.providerFetch,
    modelCatalogFetch: options.modelCatalogFetch,
    workspaceDirectoryPicker: options.workspaceDirectoryPicker,
    skillRoots: resolveSkillRoots(options),
    skillStateStore: resolveSkillStateStore(local.configDirectory),
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
  readonly configDirectory?: string;
  readonly providerFetch?: PanelProviderFetch;
  readonly modelCatalogFetch?: PanelModelCatalogFetch;
  readonly workspaceDirectoryPicker?: () => Promise<string | undefined>;
  readonly runtimeDatabase?: RuntimeDatabase;
  readonly runtimePaths?: FileSystemRuntimeDatabasePaths;
  readonly skillRoots: readonly string[];
  readonly skillStateStore?: SkillStateStore;
  readonly hooks: PanelRuntimeHooks;
}): PanelRuntime {
  const runJobs = new PanelRunJobStore();
  const activeRunJobs = new Set<Promise<void>>();
  const abortControllers = new Map<string, AbortController>();
  const persistenceChains = new Map<string, Promise<void>>();
  const conversations = new PanelConversationStore();
  const capabilityCenter = new CapabilityCenter({
    configCenter: input.configCenter,
    skillRoots: input.skillRoots,
    skillStateStore: input.skillStateStore,
    fetch: input.providerFetch,
  });
  const runtime: Omit<PanelRuntime, "runExecutor"> & { runExecutor?: BasicAgentRunExecutor } = {
    configCenter: input.configCenter,
    capabilityCenter,
    configDirectory: input.configDirectory,
    providerFetch: input.providerFetch,
    modelCatalogFetch: input.modelCatalogFetch,
    workspaceDirectoryPicker: input.workspaceDirectoryPicker,
    runJobs,
    activeRunJobs,
    abortControllers,
    persistenceChains,
    conversations,
    runtimeDatabase: input.runtimeDatabase,
    runtimePaths: input.runtimePaths,
    skillRoots: input.skillRoots,
    skillStateStore: input.skillStateStore,
  };
  runtime.runExecutor = new BasicAgentRunExecutor({
    getModelProviderConfig: () => runtime.configCenter.getModelProviderConfig(),
    getInformationAccessConfig: () => runtime.configCenter.getInformationAccessConfig(),
    getCapabilitySnapshot: () => runtime.capabilityCenter.snapshot(),
    runJobs,
    activeRunJobs,
    abortControllers,
    persistRun: (job) => persistPanelRun(runtime as PanelRuntime, job as PanelRunJob),
    persistRunInBackground: (job) => persistPanelRunInBackground(runtime as PanelRuntime, job as PanelRunJob),
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

function resolveSkillRoots(options: PanelServerOptions): readonly string[] {
  return options.skillRoots ?? [path.join(process.cwd(), ".agents", "skills")];
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
