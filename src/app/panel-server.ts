import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import {
  FileSystemRuntimeDatabase,
  resolveAgentArborRuntimeDatabasePaths,
  type FileSystemRuntimeDatabasePaths,
} from "../adapters/runtime-database/index.js";
import {
  createConfiguredToolCenterFactory,
  createUndergroundAiRuntimeConfig,
  createUndergroundAiDisabledConfigurationError,
  UndergroundAiConfigurationError,
  type UndergroundAiMode,
} from "./intelligence-channel-factory.js";
import {
  runDesktopAgentSession,
  type DesktopAgentConversationMessage,
  type DesktopAgentSessionRuntimeContext,
} from "./desktop-agent-session.js";
import type { DesktopAgentSkillContext } from "./desktop-agent-prompts.js";
import {
  explainDesktopIntentDecision,
  type DesktopIntentDecision,
  type DesktopIntentRoute,
} from "./desktop-intent-router.js";
import {
  runUndergroundDirectionSessionWithIntelligence,
  type UndergroundDirectionSessionRuntimeContext,
} from "./underground-direction-session.js";
import { createUndergroundDemoSummary, type UndergroundDemoAiInput, type UndergroundDemoSummary } from "./underground-demo-summary.js";
import { ConfigCenter, WorkspaceDirectoryValidationError, createLocalConfigCenter } from "./config-center.js";
import { createPanelHtml } from "./panel-assets.js";
import type { BasicAgentRun, ConfirmationDecision, RunEvent } from "../domain/basic-agent/index.js";
import {
  BasicAgentRunExecutor,
  type BasicAgentPendingToolContinuation,
  type BasicAgentRunExecutionInput,
} from "./basic-agent-run-executor.js";
import type { BasicAgentRunReplay } from "./basic-agent-run-event-hub.js";
import type {
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
  SanitizedWorkspaceConfig,
  SanitizedWebSearchConfig,
  UpdateInformationAccessConfigInput,
  UpdateModelProviderConfigInput,
  UpdateWorkspaceConfigInput,
  UpdateWebSearchConfigInput,
} from "../domain/config/index.js";
import type { ModelOutputDelta } from "../domain/intelligence/index.js";
import type {
  RuntimeArtifactRecord,
  RuntimeConfirmationRecord,
  RuntimeDatabase,
  RuntimeEventRecord,
  RuntimeModelCallRecord,
  RuntimeRunRecord,
  RuntimeRunSnapshot,
  RuntimeToolCallRecord,
  RuntimeWorkspaceRecord,
} from "../domain/runtime-database/index.js";
import {
  createPanelRunTrace,
  createPanelRunStreamEvents,
  createPanelRunTracking,
  createPanelRunTranscript,
  toPanelObservation,
  type PanelObservationReadModel,
  type PanelRunStreamCursor,
  type PanelRunStreamEvent,
  type PanelRunStatus,
  type PanelRunTraceReadModel,
  type PanelRunTrackingReadModel,
  type PanelRunTranscript,
} from "./panel-run-read-model.js";
import {
  createDesktopAgentCanvas,
  createUndergroundDeepCanvas,
  createPanelRunCanvas,
  type PanelRunCanvasReadModel,
} from "./panel-canvas-read-model.js";
import { PanelRunJobStore, type PanelDesktopRunMode, type PanelRunJob, type PanelRunKind } from "./panel-run-jobs.js";
import {
  PanelConversationStore,
  toRuntimeConversationRecord,
  type PanelConversationReadModel,
  type PanelConversationSummaryReadModel,
} from "./panel-conversations.js";
import type { EventLogEntry } from "../kernel/events/in-memory-event-log.js";
import type { AgentRunTree } from "../domain/underground/index.js";
import {
  parseDesktopTaskSoilInput,
  TaskSoilInputValidationError,
  type DesktopTaskSoilInput,
} from "./task-soil-workspace.js";
import { createMinimalRuntime } from "./runtime.js";
import { safeCommandToolPreview, safeReadFileToolPreview } from "./safe-tool-preview.js";
import {
  friendlyUserFacingFailureText,
  sanitizeAssistantVisibleText,
  sanitizeConversationHistoryText,
} from "./visible-text-safety.js";
import {
  FileSystemSkillStateStore,
  discoverSkills,
  loadSkillBody,
  resolveSkillStateStorePath,
  selectTriggeredSkills,
  type SkillStateStore,
} from "./skills/index.js";
import { redactSensitiveText } from "../kernel/redaction.js";

export type PanelServerOptions = {
  readonly host?: string;
  readonly port?: number;
  readonly configDirectory?: string;
  readonly configCenter?: ConfigCenter;
  readonly runtimeDatabase?: RuntimeDatabase;
  readonly providerFetch?: PanelProviderFetch;
  readonly workspaceDirectoryPicker?: () => Promise<string | undefined>;
  readonly skillRoots?: readonly string[];
};

export type PanelProviderFetch = (
  url: string,
  init: {
    readonly method: "POST";
    readonly headers: Record<string, string>;
    readonly body: string;
    readonly signal?: AbortSignal;
  }
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly body?: unknown;
  readonly json: () => Promise<unknown>;
  readonly text?: () => Promise<string>;
}>;

export type StartedPanelServer = {
  readonly url: string;
  readonly configDirectory?: string;
  readonly runtimeDirectory?: string;
  close(): Promise<void>;
};

type PanelRuntime = {
  readonly configCenter: ConfigCenter;
  readonly configDirectory?: string;
  readonly providerFetch?: PanelProviderFetch;
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

type PanelRunResponse = {
  readonly ok: true;
  readonly runKind: PanelRunKind;
  readonly runMode: PanelDesktopRunMode;
  readonly status: "completed";
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly summary?: UndergroundDemoSummary;
  readonly observation?: PanelObservationReadModel;
  readonly tracking: PanelRunTrackingReadModel;
  readonly trace: PanelRunTraceReadModel;
  readonly transcript: PanelRunTranscript;
  readonly workNotes: PanelRunTranscript["workNotes"];
  readonly steps: PanelRunTranscript["steps"];
  readonly streamCursor: PanelRunStreamCursor;
  readonly canvas?: PanelRunCanvasReadModel;
};

type PanelRunJobResponse = {
  readonly ok: true;
  readonly runId: string;
  readonly runKind: PanelRunKind;
  readonly runMode: PanelDesktopRunMode;
  readonly status: PanelRunStatus;
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly trace: PanelRunTraceReadModel;
  readonly tracking: PanelRunTrackingReadModel;
  readonly transcript: PanelRunTranscript;
  readonly workNotes: PanelRunTranscript["workNotes"];
  readonly steps: PanelRunTranscript["steps"];
  readonly streamCursor: PanelRunStreamCursor;
  readonly summary?: UndergroundDemoSummary | { readonly ai: UndergroundDemoSummary["ai"] };
  readonly observation?: PanelObservationReadModel;
  readonly canvas?: PanelRunCanvasReadModel;
  readonly route?: PanelDesktopRouteReadModel;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
  readonly conversation?: PanelConversationReadModel;
  readonly restoredFromSnapshot?: true;
  readonly restoredResult?: {
    readonly title: string;
    readonly summary: string;
  };
  readonly snapshot?: {
    readonly run: RuntimeRunRecord;
    readonly workspace?: RuntimeWorkspaceRecord;
    readonly toolCalls: readonly RuntimeToolCallRecord[];
    readonly artifacts: readonly RuntimeArtifactRecord[];
    readonly confirmations: readonly RuntimeConfirmationRecord[];
  };
};

type PanelRunExecutionResult = {
  readonly summary?: UndergroundDemoSummary;
  readonly observation?: PanelObservationReadModel;
  readonly eventEntries: readonly EventLogEntry[];
  readonly agentRunTree?: AgentRunTree;
  readonly canvas?: PanelRunCanvasReadModel;
  readonly pendingApproval?: BasicAgentPendingToolContinuation;
};

type PanelRunExecutionOptions = {
  readonly conversationHistory?: readonly DesktopAgentConversationMessage[];
  readonly abortSignal?: AbortSignal;
  readonly onRuntimeReady?: (context: PanelRuntimeReadyContext) => void;
  readonly onModelOutputDelta?: (delta: ModelOutputDelta) => void;
};

type PanelDesktopRouteReadModel = {
  readonly route: DesktopIntentRoute;
  readonly reason: string;
  readonly title: string;
  readonly summary: string;
};

type PanelToolsConfig = {
  readonly webSearch: SanitizedWebSearchConfig;
};

type PanelRuntimeReadyContext =
  | UndergroundDirectionSessionRuntimeContext
  | DesktopAgentSessionRuntimeContext;

class PanelHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "PanelHttpError";
  }
}

export async function startLocalPanelServer(options: PanelServerOptions = {}): Promise<StartedPanelServer> {
  const runtime = createPanelRuntime(options);
  const server = createServer(createPanelRequestHandler(runtime));
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 9090;

  await listen(server, port, host);
  const address = server.address() as AddressInfo;
  return {
    url: `http://${host}:${address.port}/`,
    configDirectory: runtime.configDirectory,
    runtimeDirectory: runtime.runtimePaths?.runtimeHome,
    close: () => closePanelServer(server, runtime),
  };
}

export function createPanelRequestHandler(options: PanelServerOptions | PanelRuntime = {}): (request: IncomingMessage, response: ServerResponse) => void {
  const runtime = isPanelRuntime(options) ? options : createPanelRuntime(options);

  return (request, response) => {
    handlePanelRequest(runtime, request, response).catch((error) => {
      if (error instanceof PanelHttpError) {
        writePanelError(response, error);
        return;
      }
      writePanelError(response, new PanelHttpError(500, "panel_internal_error", "面板请求失败。"));
    });
  };
}

function createPanelRuntime(options: PanelServerOptions): PanelRuntime {
  if (options.configCenter !== undefined) {
    const runtimePersistence = createPanelRuntimePersistence(options.configDirectory, options.runtimeDatabase);
    return assemblePanelRuntime({
      configCenter: options.configCenter,
      configDirectory: options.configDirectory,
      providerFetch: options.providerFetch,
      workspaceDirectoryPicker: options.workspaceDirectoryPicker,
      skillRoots: resolveSkillRoots(options),
      skillStateStore: resolveSkillStateStore(options.configDirectory),
      ...runtimePersistence,
    });
  }
  const local = createLocalConfigCenter({ configDirectory: options.configDirectory });
  const runtimePersistence = createPanelRuntimePersistence(local.configDirectory, options.runtimeDatabase);
  return assemblePanelRuntime({
    configCenter: local.configCenter,
    configDirectory: local.configDirectory,
    providerFetch: options.providerFetch,
    workspaceDirectoryPicker: options.workspaceDirectoryPicker,
    skillRoots: resolveSkillRoots(options),
    skillStateStore: resolveSkillStateStore(local.configDirectory),
    ...runtimePersistence,
  });
}

function assemblePanelRuntime(input: {
  readonly configCenter: ConfigCenter;
  readonly configDirectory?: string;
  readonly providerFetch?: PanelProviderFetch;
  readonly workspaceDirectoryPicker?: () => Promise<string | undefined>;
  readonly runtimeDatabase?: RuntimeDatabase;
  readonly runtimePaths?: FileSystemRuntimeDatabasePaths;
  readonly skillRoots: readonly string[];
  readonly skillStateStore?: SkillStateStore;
}): PanelRuntime {
  const runJobs = new PanelRunJobStore();
  const activeRunJobs = new Set<Promise<void>>();
  const abortControllers = new Map<string, AbortController>();
  const persistenceChains = new Map<string, Promise<void>>();
  const conversations = new PanelConversationStore();
  const runtime: Omit<PanelRuntime, "runExecutor"> & { runExecutor?: BasicAgentRunExecutor } = {
    configCenter: input.configCenter,
    configDirectory: input.configDirectory,
    providerFetch: input.providerFetch,
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
    runJobs,
    activeRunJobs,
    abortControllers,
    persistRun: (job) => persistPanelRun(runtime as PanelRuntime, job),
    executionAdapter: {
      execute: (execution) => executeBasicPanelRun(runtime as PanelRuntime, execution),
    },
    failRun: (job, error) => failPanelRunJob(runtime as PanelRuntime, job, error),
    onRuntimeReady: (runId, context) => {
      runtime.runJobs.attachRuntime({
        runId,
        runtime: context.runtime,
        traceId: context.traceId,
        goalId: context.goalId,
      });
    },
    onModelOutputDelta: (runId, delta) => appendLiveModelOutputDelta(runtime as PanelRuntime, runId, delta),
    onRunFinished: async (job) => {
      syncConversationTurnForJob(runtime as PanelRuntime, job);
      scheduleNextQueuedConversationRun(runtime as PanelRuntime, job);
    },
    onGuidanceSubmitted: async ({ job, guidance }) => {
      await startGuidanceFollowUpRun(runtime as PanelRuntime, job, guidance);
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

async function handlePanelRequest(
  runtime: PanelRuntime,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (request.method === "GET" && url.pathname === "/") {
    writeHtml(response, createPanelHtml());
    return;
  }

  if (request.method === "GET" && url.pathname === "/favicon.ico") {
    response.writeHead(204, { "cache-control": "no-store" });
    response.end();
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    writeJson(response, 200, {
      ok: true,
      status: "completed",
      config: await runtime.configCenter.getModelProviderConfig(),
      informationAccess: await runtime.configCenter.getInformationAccessConfig(),
      configDirectory: runtime.configDirectory,
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/config") {
    const config = await runtime.configCenter.getModelProviderConfig();
    const apiKey = await runtime.configCenter.getModelProviderApiKey();
    writeJson(response, 200, {
      ok: true,
      status: "completed",
      config: { ...config, apiKey: apiKey ?? "" },
      informationAccess: await runtime.configCenter.getInformationAccessConfig(),
      workspace: await runtime.configCenter.getWorkspaceConfig(),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/config/tools") {
    const tools: PanelToolsConfig = {
      webSearch: await runtime.configCenter.getWebSearchConfig(),
    };
    writeJson(response, 200, {
      ok: true,
      status: "completed",
      tools,
      informationAccess: await runtime.configCenter.getInformationAccessConfig(),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/config/model-provider") {
    const body = await readJsonBody(request);
    const config = await runtime.configCenter.updateModelProviderConfig(parseConfigUpdate(body));
    writeJson(response, 200, {
      ok: true,
      status: "completed",
      config,
      informationAccess: await runtime.configCenter.getInformationAccessConfig(),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/config/information-sources") {
    const body = await readJsonBody(request);
    const informationAccess = await runtime.configCenter.updateInformationAccessConfig(parseInformationAccessUpdate(body));
    writeJson(response, 200, {
      ok: true,
      status: "completed",
      informationAccess,
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/config/tools/web-search") {
    const body = await readJsonBody(request);
    const webSearch = await runtime.configCenter.updateWebSearchConfig(parseWebSearchUpdate(body));
    writeJson(response, 200, {
      ok: true,
      status: "completed",
      tools: { webSearch },
      informationAccess: await runtime.configCenter.getInformationAccessConfig(),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/config/workspace") {
    const body = await readJsonBody(request);
    let workspace;
    try {
      workspace = await runtime.configCenter.updateWorkspaceConfig(parseWorkspaceUpdate(body));
    } catch (error) {
      if (error instanceof WorkspaceDirectoryValidationError) {
        throw new PanelHttpError(400, "invalid_workspace_directory", "工作目录必须是已存在的文件夹。");
      }
      throw error;
    }
    writeJson(response, 200, {
      ok: true,
      status: "completed",
      workspace,
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/config/workspace/select-directory") {
    if (runtime.workspaceDirectoryPicker === undefined) {
      throw new PanelHttpError(501, "workspace_picker_unavailable", "当前环境不支持系统文件夹选择器，请手动输入工作文件夹路径。");
    }
    const selectedDirectory = await runtime.workspaceDirectoryPicker();
    if (selectedDirectory === undefined) {
      writeJson(response, 200, {
        ok: true,
        status: "cancelled",
        message: "已取消选择文件夹。",
        workspace: await runtime.configCenter.getWorkspaceConfig(),
      });
      return;
    }
    let workspace;
    try {
      workspace = await runtime.configCenter.updateWorkspaceConfig({ workspaceDirectory: selectedDirectory });
    } catch (error) {
      if (error instanceof WorkspaceDirectoryValidationError) {
        throw new PanelHttpError(400, "invalid_workspace_directory", "工作目录必须是已存在的文件夹。");
      }
      throw error;
    }
    writeJson(response, 200, {
      ok: true,
      status: "completed",
      workspace,
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/underground/run") {
    await handleRunRequest(runtime, request, response, "underground");
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/underground/runs") {
    await handleStartRunRequest(runtime, request, response, "underground");
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/desktop/runs") {
    await handleStartRunRequest(runtime, request, response, "desktop");
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/conversations") {
    writeJson(response, 200, {
      ok: true,
      conversations: await listPanelConversations(runtime),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/conversations") {
    await handleConversationMessageRequest(runtime, request, response, undefined);
    return;
  }

  const conversationMatch = /^\/api\/conversations\/([^/]+)$/.exec(url.pathname);
  if (request.method === "GET" && conversationMatch !== null) {
    const conversationId = decodeURIComponent(conversationMatch[1] ?? "");
    const conversation = await getPanelConversation(runtime, conversationId);
    if (conversation === undefined) {
      throw new PanelHttpError(404, "conversation_not_found", "未找到对话。");
    }
    writeJson(response, 200, {
      ok: true,
      conversation,
    });
    return;
  }

  const conversationMessagesMatch = /^\/api\/conversations\/([^/]+)\/messages$/.exec(url.pathname);
  if (request.method === "POST" && conversationMessagesMatch !== null) {
    await handleConversationMessageRequest(
      runtime,
      request,
      response,
      decodeURIComponent(conversationMessagesMatch[1] ?? "")
    );
    return;
  }

  const runMatch = /^\/api\/underground\/runs\/([^/]+)$/.exec(url.pathname);
  if (request.method === "GET" && runMatch !== null) {
    await handleGetRunRequest(runtime, decodeURIComponent(runMatch[1] ?? ""), "underground", response);
    return;
  }

  const desktopRunMatch = /^\/api\/desktop\/runs\/([^/]+)$/.exec(url.pathname);
  if (request.method === "GET" && desktopRunMatch !== null) {
    await handleGetRunRequest(runtime, decodeURIComponent(desktopRunMatch[1] ?? ""), "desktop", response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/runtime/runs") {
    const limit = Number(url.searchParams.get("limit") ?? 50);
    writeJson(response, 200, {
      ok: true,
      runs: (await runtime.runtimeDatabase?.listRuns(Number.isFinite(limit) ? limit : 50)) ?? [],
    });
    return;
  }

  const runtimeRunMatch = /^\/api\/runtime\/runs\/([^/]+)$/.exec(url.pathname);
  if (request.method === "GET" && runtimeRunMatch !== null) {
    const runId = decodeURIComponent(runtimeRunMatch[1] ?? "");
    const snapshot = await runtime.runtimeDatabase?.getRun(runId);
    if (snapshot === undefined) {
      throw new PanelHttpError(404, "run_not_found", "未找到持久化运行记录。");
    }
    writeJson(response, 200, await createPersistedRunResponse(runtime, snapshot));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/skills") {
    writeJson(response, 200, {
      ok: true,
      skills: await discoverSkills({ roots: runtime.skillRoots, stateStore: runtime.skillStateStore }),
    });
    return;
  }

  const skillStateMatch = /^\/api\/skills\/([^/]+)\/state$/.exec(url.pathname);
  if (request.method === "POST" && skillStateMatch !== null) {
    await handleUpdateSkillStateRequest(runtime, decodeURIComponent(skillStateMatch[1] ?? ""), request, response);
    return;
  }

  const basicRunEventsMatch = /^\/api\/basic-agent\/runs\/([^/]+)\/events$/.exec(url.pathname);
  if (request.method === "GET" && basicRunEventsMatch !== null) {
    await handleGetBasicRunEventsRequest(
      runtime,
      decodeURIComponent(basicRunEventsMatch[1] ?? ""),
      url,
      request,
      response
    );
    return;
  }

  const basicRunMatch = /^\/api\/basic-agent\/runs\/([^/]+)$/.exec(url.pathname);
  if (request.method === "GET" && basicRunMatch !== null) {
    await handleGetBasicRunRequest(runtime, decodeURIComponent(basicRunMatch[1] ?? ""), response);
    return;
  }

  const basicRunCancelMatch = /^\/api\/basic-agent\/runs\/([^/]+)\/cancel$/.exec(url.pathname);
  if (request.method === "POST" && basicRunCancelMatch !== null) {
    await handleCancelBasicRunRequest(runtime, decodeURIComponent(basicRunCancelMatch[1] ?? ""), response);
    return;
  }

  const confirmationDecisionMatch = /^\/api\/basic-agent\/runs\/([^/]+)\/confirmations\/([^/]+)\/decision$/.exec(url.pathname);
  if (request.method === "POST" && confirmationDecisionMatch !== null) {
    await handleConfirmationDecisionRequest(
      runtime,
      decodeURIComponent(confirmationDecisionMatch[1] ?? ""),
      decodeURIComponent(confirmationDecisionMatch[2] ?? ""),
      request,
      response
    );
    return;
  }

  const runStreamMatch = /^\/api\/underground\/runs\/([^/]+)\/stream$/.exec(url.pathname);
  if (request.method === "GET" && runStreamMatch !== null) {
    handleGetRunStreamRequest(runtime, decodeURIComponent(runStreamMatch[1] ?? ""), "underground", url, request, response);
    return;
  }

  const desktopRunStreamMatch = /^\/api\/desktop\/runs\/([^/]+)\/stream$/.exec(url.pathname);
  if (request.method === "GET" && desktopRunStreamMatch !== null) {
    handleGetRunStreamRequest(runtime, decodeURIComponent(desktopRunStreamMatch[1] ?? ""), "desktop", url, request, response);
    return;
  }

  writeJson(response, 404, {
    ok: false,
    status: "failed",
    error: {
      code: "not_found",
      message: "未找到面板路由。",
    },
  });
}

async function handleRunRequest(
  runtime: PanelRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  runKind: PanelRunKind
): Promise<void> {
  const body = await readJsonBody(request);
  const config = await runtime.configCenter.getModelProviderConfig();
  const informationAccess = await runtime.configCenter.getInformationAccessConfig();
  const runInput = parseRunInput(body, defaultAiModeForRunKind(runKind, config.defaultAiMode));

  try {
    const run = await runForPanel(runtime, runKind, runInput.goal, runInput.aiMode, runInput.taskSoilInput, runInput.runMode);
    const currentConfig = await runtime.configCenter.getModelProviderConfig();
    const currentInformationAccess = await runtime.configCenter.getInformationAccessConfig();
    const trace = createPanelRunTrace({ status: "completed", eventEntries: run.eventEntries });
    const tracking = createPanelRunTracking({
      status: "completed",
      config: currentConfig,
      informationAccess: currentInformationAccess,
      requestedMode: runInput.aiMode,
      summary: run.summary,
      observation: run.observation,
      agentRunTree: run.agentRunTree,
      eventEntries: run.eventEntries,
    });
    const responseRunId = run.observation?.traceId ?? canvasTraceId(run.canvas) ?? "panel-sync-run";
    const transcript = createPanelRunTranscript({
      runId: responseRunId,
      status: "completed",
      eventEntries: run.eventEntries,
      summary: run.summary,
      observation: run.observation,
      agentRunTree: run.agentRunTree,
      desktopMode: runKind === "desktop" ? runInput.runMode : undefined,
      createdAt: run.eventEntries[0]?.recordedAt ?? new Date(0).toISOString(),
      updatedAt: run.eventEntries.at(-1)?.recordedAt ?? new Date(0).toISOString(),
    });
    writeJson(response, 200, {
      ok: true,
      runKind,
      runMode: runInput.runMode,
      status: "completed",
      config: currentConfig,
      informationAccess: currentInformationAccess,
      summary: run.summary,
      observation: run.observation,
      tracking,
      trace,
      transcript,
      workNotes: transcript.workNotes,
      steps: transcript.steps,
      streamCursor: {
        runId: responseRunId,
        lastSequence: transcript.events.at(-1)?.sequence ?? 0,
      },
      canvas: run.canvas,
    } satisfies PanelRunResponse);
  } catch (error) {
    if (error instanceof UndergroundAiConfigurationError) {
      const message = panelConfigurationErrorMessage(error.issue.code);
      const ai = createConfigurationFailedAiSummary(error.issue.summaryInput, error, message);
      writeJson(response, 400, {
        ok: false,
        status: "failed",
        config,
        informationAccess,
        error: {
          code: error.issue.code,
          message,
        },
        summary: { ai },
      });
      return;
    }
    if (error instanceof PanelHttpError) {
      writePanelError(response, error, { config, informationAccess });
      return;
    }
    throw error;
  }
}

async function handleStartRunRequest(
  runtime: PanelRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  runKind: PanelRunKind
): Promise<void> {
  const body = await readJsonBody(request);
  const config = await runtime.configCenter.getModelProviderConfig();
  const runInput = parseRunInput(body, defaultAiModeForRunKind(runKind, config.defaultAiMode));
  const basicRun = await runtime.runExecutor.start({
    runKind,
    runMode: runInput.runMode,
    goal: runInput.goal,
    aiMode: runInput.aiMode,
    routeDecision: undefined,
    taskSoilInput: runInput.taskSoilInput,
  });
  const job = requirePanelRunJob(runtime, basicRun.runId);

  writeJson(response, 202, createPanelRunJobResponse(runtime, job));
}

async function handleConversationMessageRequest(
  runtime: PanelRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  conversationId: string | undefined
): Promise<void> {
  const body = await readJsonBody(request);
  const config = await runtime.configCenter.getModelProviderConfig();
  const informationAccess = await runtime.configCenter.getInformationAccessConfig();
  const runInput = parseRunInput(body, defaultAiModeForRunKind("desktop", config.defaultAiMode));
  const runAfterRunId = runtime.conversations.nextQueuePredecessor(conversationId);
  const shouldQueue = runAfterRunId !== undefined;
  const mergedTaskSoilInput = runInput.taskSoilInput;

  let started;
  try {
    started = runtime.conversations.startDesktopMessage({
      goal: runInput.goal,
      taskSoilInput: mergedTaskSoilInput,
      conversationId,
      queueBehindRunId: runAfterRunId,
    });
  } catch (error) {
    const message = "无法创建对话消息。";
    throw new PanelHttpError(409, "conversation_busy", message);
  }

  const basicRun = await runtime.runExecutor.start({
    runKind: "desktop",
    runMode: runInput.runMode,
    goal: runInput.goal,
    aiMode: runInput.aiMode,
    conversationId: started.conversation.conversationId,
    assistantTurnId: started.assistantTurn.turnId,
    runAfterRunId,
    routeDecision: undefined,
    taskSoilInput: mergedTaskSoilInput,
    startImmediately: !shouldQueue,
  });
  const job = requirePanelRunJob(runtime, basicRun.runId);
  if (shouldQueue) {
    runtime.conversations.queueRun({
      conversationId: started.conversation.conversationId,
      assistantTurnId: started.assistantTurn.turnId,
      runId: job.runId,
    });
    if (queuedRunCanStartNow(runtime, runAfterRunId)) {
      schedulePanelRunJob(runtime, job.runId);
    }
  } else {
    runtime.conversations.attachRun({
      conversationId: started.conversation.conversationId,
      assistantTurnId: started.assistantTurn.turnId,
      runId: job.runId,
    });
  }
  await persistPanelRun(runtime, job);

  writeJson(response, 202, {
    ok: true,
    conversation: runtime.conversations.getReadModel(started.conversation.conversationId),
    run: createPanelRunJobResponse(runtime, job),
  });
}

async function startGuidanceFollowUpRun(
  runtime: PanelRuntime,
  job: PanelRunJob,
  guidance: string
): Promise<void> {
  if (job.conversationId === undefined || guidance.trim().length === 0) {
    return;
  }
  const started = runtime.conversations.startDesktopMessage({
    goal: guidance,
    taskSoilInput: job.taskSoilInput,
    conversationId: job.conversationId,
  });
  const basicRun = await runtime.runExecutor.start({
    runKind: "desktop",
    runMode: job.runMode,
    goal: guidance,
    aiMode: job.aiMode,
    conversationId: started.conversation.conversationId,
    assistantTurnId: started.assistantTurn.turnId,
    routeDecision: undefined,
    taskSoilInput: job.taskSoilInput,
    startImmediately: true,
  });
  const followUpJob = requirePanelRunJob(runtime, basicRun.runId);
  runtime.conversations.attachRun({
    conversationId: started.conversation.conversationId,
    assistantTurnId: started.assistantTurn.turnId,
    runId: followUpJob.runId,
  });
  await persistPanelRun(runtime, followUpJob);
  await persistPanelConversation(runtime, started.conversation.conversationId);
}

function queuedRunCanStartNow(runtime: PanelRuntime, predecessorRunId: string | undefined): boolean {
  if (predecessorRunId === undefined) {
    return true;
  }
  const predecessor = runtime.runJobs.get(predecessorRunId);
  return predecessor === undefined || isTerminalPanelRunStatus(predecessor.status);
}

function requirePanelRunJob(runtime: PanelRuntime, runId: string): PanelRunJob {
  const job = runtime.runJobs.get(runId);
  if (job === undefined) {
    throw new PanelHttpError(404, "run_not_found", "未找到基础 Agent 运行。");
  }
  return job;
}

function requireBasicRun(runtime: PanelRuntime, runId: string): BasicAgentRun {
  const run = runtime.runExecutor.get(runId);
  if (run === undefined) {
    throw new PanelHttpError(404, "run_not_found", "未找到基础 Agent 运行。");
  }
  return run;
}

async function handleGetRunRequest(
  runtime: PanelRuntime,
  runId: string,
  expectedRunKind: PanelRunKind,
  response: ServerResponse
): Promise<void> {
  const job = runtime.runJobs.get(runId);
  if (job !== undefined && job.runKind === expectedRunKind) {
    if (isTerminalPanelRunStatus(job.status)) {
      await persistPanelRun(runtime, job);
    }
    writeJson(response, 200, createPanelRunJobResponse(runtime, job));
    return;
  }
  const snapshot = await runtime.runtimeDatabase?.getRun(runId);
  if (snapshot === undefined || snapshot.run.runKind !== expectedRunKind) {
    throw new PanelHttpError(404, "run_not_found", runNotFoundMessage(expectedRunKind));
  }
  writeJson(response, 200, await createPersistedRunResponse(runtime, snapshot));
}

function handleGetRunStreamRequest(
  runtime: PanelRuntime,
  runId: string,
  expectedRunKind: PanelRunKind,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse
): void {
  const job = runtime.runJobs.get(runId);
  if (job === undefined || job.runKind !== expectedRunKind) {
    throw new PanelHttpError(404, "run_not_found", runNotFoundMessage(expectedRunKind));
  }

  let lastSequence = parseStreamCursor(url.searchParams.get("cursor"), request.headers["last-event-id"]);
  let closed = false;
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store, no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  response.write(`: AgentArbor panel run stream ${runId}\n\n`);

  const flush = (): void => {
    if (closed) {
      return;
    }
    const current = runtime.runJobs.get(runId);
    if (current === undefined) {
      writeSseEvent(response, {
        eventId: `${runId}:run.failed:not-found`,
        runId,
        sequence: lastSequence + 1,
        type: "run.failed",
        createdAt: new Date().toISOString(),
        agentLabel: "AgentArbor Runtime",
        summary: "运行已不存在。",
        status: "failed",
        sourceRefs: [],
        modelCallRefs: [],
        toolCallRefs: [],
      });
      cleanup();
      return;
    }
    const events = syncPanelRunStreamEventsForJob(runtime, current);
    for (const event of events) {
      if (event.sequence <= lastSequence) {
        continue;
      }
      writeSseEvent(response, event);
      lastSequence = event.sequence;
    }
    if (isTerminalPanelRunStatus(current.status)) {
      cleanup();
    }
  };

  const cleanup = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    clearInterval(interval);
    response.end();
  };

  const interval = setInterval(flush, 100);
  request.on("close", cleanup);
  flush();
}

function handleGetBasicRunEventsRequest(
  runtime: PanelRuntime,
  runId: string,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> | void {
  const job = runtime.runJobs.get(runId);
  if (job !== undefined) {
    syncPanelRunStreamEventsForJob(runtime, job);
  }
  const cursor = parseStreamCursor(url.searchParams.get("cursor"), request.headers["last-event-id"]);
  const replay = runtime.runExecutor.replayEvents(runId, cursor);
  if (replay === undefined) {
    return runtime.runtimeDatabase?.getRun(runId).then((snapshot) => {
      if (snapshot === undefined) {
        throw new PanelHttpError(404, "run_not_found", "未找到基础 Agent 运行事件。");
      }
      const restored = basicRunReplayFromSnapshot(snapshot);
      writeJson(response, 200, {
        ok: true,
        runId,
        cursor: restored.cursor,
        events: restored.events.filter((event: RunEvent) => event.sequence > cursor),
      });
    }) ?? (() => {
      throw new PanelHttpError(404, "run_not_found", "未找到基础 Agent 运行事件。");
    })();
  }
  writeJson(response, 200, {
    ok: true,
    runId,
    cursor: replay.cursor,
    events: replay.events,
  });
}

async function handleGetBasicRunRequest(
  runtime: PanelRuntime,
  runId: string,
  response: ServerResponse
): Promise<void> {
  const job = runtime.runJobs.get(runId);
  if (job !== undefined) {
    syncPanelRunStreamEventsForJob(runtime, job);
    writeJson(response, 200, {
      ok: true,
      run: requireBasicRun(runtime, runId),
    });
    return;
  }
  const snapshot = await runtime.runtimeDatabase?.getRun(runId);
  if (snapshot === undefined) {
    throw new PanelHttpError(404, "run_not_found", "未找到基础 Agent 运行。");
  }
  writeJson(response, 200, {
    ok: true,
    run: basicRunFromSnapshot(snapshot),
  });
}

async function handleCancelBasicRunRequest(
  runtime: PanelRuntime,
  runId: string,
  response: ServerResponse
): Promise<void> {
  const run = await runtime.runExecutor.cancel(runId).catch((error: unknown) => {
    if (error instanceof Error && error.message.includes("not found")) {
      throw new PanelHttpError(404, "run_not_found", "未找到基础 Agent 运行。");
    }
    throw error;
  });
  writeJson(response, 200, { ok: true, run });
}

async function handleConfirmationDecisionRequest(
  runtime: PanelRuntime,
  runId: string,
  confirmationId: string,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const body = await readJsonBody(request);
  const decision = parseConfirmationDecision(body);
  const run = await runtime.runExecutor.submitConfirmationDecision({
    runId,
    confirmationId,
    decision: decision.decision,
    guidance: decision.guidance,
  }).catch(async (error: unknown) => {
    if (error instanceof Error && error.message.includes("not found")) {
      const restored = await submitRestoredConfirmationDecision(runtime, runId, confirmationId, decision);
      if (restored !== undefined) {
        return restored;
      }
      throw new PanelHttpError(404, "run_not_found", "未找到基础 Agent 运行。");
    }
    throw error;
  });
  writeJson(response, 200, { ok: true, run });
}

async function submitRestoredConfirmationDecision(
  runtime: PanelRuntime,
  runId: string,
  confirmationId: string,
  decision: Pick<ConfirmationDecision, "decision" | "guidance">
): Promise<BasicAgentRun | undefined> {
  const snapshot = await runtime.runtimeDatabase?.getRun(runId);
  if (runtime.runtimeDatabase === undefined || snapshot === undefined) {
    return undefined;
  }
  const decidedAt = new Date().toISOString();
  const blockedByMissingContinuation = decision.decision === "approve_once";
  const nextRun: RuntimeRunRecord = {
    ...snapshot.run,
    status: decision.decision === "guidance" ? snapshot.run.status : "blocked",
    updatedAt: decidedAt,
    completedAt: decision.decision === "guidance" ? snapshot.run.completedAt : decidedAt,
    error: decision.decision === "guidance"
      ? snapshot.run.error
      : {
          code: blockedByMissingContinuation ? "confirmation_continuation_lost" : "confirmation_denied",
          message: blockedByMissingContinuation
            ? "运行已中断，需要重新发起或继续处理。"
            : "用户已拒绝本次操作，运行已暂停。",
        },
  };
  const nextConfirmations = upsertRestoredConfirmation({
    snapshot,
    confirmationId,
    decision,
    decidedAt,
  });
  const events = [
    ...snapshot.basicEvents,
    restoredConfirmationDecisionEvent({
      runId,
      confirmationId,
      decision,
      decidedAt,
      sequence: nextBasicEventSequence(snapshot.basicEvents),
    }),
  ];
  const blockedEvents = decision.decision === "guidance"
    ? events
    : [
        ...events,
        restoredBlockedEvent({
          runId,
          decidedAt,
          sequence: nextBasicEventSequence(events),
          summary: nextRun.error?.message ?? "运行已中断，需要重新发起或继续处理。",
        }),
      ];
  const nextSnapshot: RuntimeRunSnapshot = {
    ...snapshot,
    run: nextRun,
    basicEvents: blockedEvents,
    confirmations: nextConfirmations,
  };
  const basicRun = basicRunFromSnapshot(nextSnapshot);

  await runtime.runtimeDatabase.upsertRun(nextRun);
  await runtime.runtimeDatabase.replaceConfirmations(runId, nextConfirmations);
  await runtime.runtimeDatabase.replaceBasicRunEvents(runId, blockedEvents);
  await runtime.runtimeDatabase.upsertBasicRun(basicRun);
  return basicRun;
}

function upsertRestoredConfirmation(input: {
  readonly snapshot: RuntimeRunSnapshot;
  readonly confirmationId: string;
  readonly decision: Pick<ConfirmationDecision, "decision" | "guidance">;
  readonly decidedAt: string;
}): readonly RuntimeConfirmationRecord[] {
  const status =
    input.decision.decision === "approve_once"
      ? "approved"
      : input.decision.decision === "deny"
        ? "denied"
        : "guidance";
  const previous = input.snapshot.confirmations.find((confirmation) => confirmation.confirmationId === input.confirmationId);
  const next: RuntimeConfirmationRecord = {
    confirmationId: input.confirmationId,
    runId: input.snapshot.run.runId,
    conversationId: previous?.conversationId ?? input.snapshot.run.conversationId,
    status,
    title: previous?.title ?? "用户确认",
    actionSummary: previous?.actionSummary ?? "用户已补充确认或指导。",
    affectedResources: previous?.affectedResources ?? [],
    riskLevel: previous?.riskLevel ?? "medium",
    requestedAt: previous?.requestedAt ?? input.decidedAt,
    expiresAt: previous?.expiresAt,
    decidedAt: input.decidedAt,
    guidance:
      input.decision.guidance === undefined
        ? previous?.guidance
        : compactRuntimeText(input.decision.guidance, 500),
    eventRefs: unique([...(previous?.eventRefs ?? []), `confirmation:${input.confirmationId}`]),
  };
  return [
    ...input.snapshot.confirmations.filter((confirmation) => confirmation.confirmationId !== input.confirmationId),
    next,
  ];
}

function restoredConfirmationDecisionEvent(input: {
  readonly runId: string;
  readonly confirmationId: string;
  readonly decision: Pick<ConfirmationDecision, "decision" | "guidance">;
  readonly decidedAt: string;
  readonly sequence: number;
}): RunEvent {
  const guidance = input.decision.guidance === undefined ? undefined : compactRuntimeText(input.decision.guidance, 240);
  return {
    id: `${input.runId}:restored:confirmation:${input.confirmationId}:${input.decision.decision}`,
    runId: input.runId,
    sequence: input.sequence,
    type: input.decision.decision === "guidance" ? "user.guidance" : "user_approval.received",
    title: input.decision.decision === "guidance" ? "收到用户指导" : "收到确认结果",
    summary:
      input.decision.decision === "approve_once"
        ? "已批准本次操作，但运行已中断，需要重新发起或继续处理。"
        : input.decision.decision === "deny"
          ? "已拒绝本次操作，运行不会继续执行该动作。"
          : guidance === undefined
            ? "已收到补充指导。"
            : `已收到补充指导：${guidance}`,
    status:
      input.decision.decision === "guidance"
        ? "needs_input"
        : "blocked",
    timestamp: input.decidedAt,
    refs: [{ kind: "event", id: `confirmation:${input.confirmationId}` }],
    visibility: "expanded",
  };
}

function restoredBlockedEvent(input: {
  readonly runId: string;
  readonly decidedAt: string;
  readonly sequence: number;
  readonly summary: string;
}): RunEvent {
  return {
    id: `${input.runId}:restored:run.blocked`,
    runId: input.runId,
    sequence: input.sequence,
    type: "run.blocked",
    title: "任务已暂停",
    summary: compactRuntimeText(input.summary, 500),
    status: "blocked",
    timestamp: input.decidedAt,
    refs: [],
    visibility: "compact",
  };
}

function nextBasicEventSequence(events: readonly RunEvent[]): number {
  return (events.at(-1)?.sequence ?? 0) + 1;
}

async function handleUpdateSkillStateRequest(
  runtime: PanelRuntime,
  skillId: string,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  if (runtime.skillStateStore === undefined) {
    throw new PanelHttpError(501, "skill_state_unavailable", "当前环境没有可用的技能状态存储。");
  }
  const body = await readJsonBody(request);
  const record = asRecord(body);
  if (typeof record.enabled !== "boolean") {
    throw new PanelHttpError(400, "invalid_skill_state", "技能状态必须包含 enabled 布尔值。");
  }
  await runtime.skillStateStore.setEnabled(skillId, record.enabled);
  writeJson(response, 200, {
    ok: true,
    skills: await discoverSkills({ roots: runtime.skillRoots, stateStore: runtime.skillStateStore }),
  });
}

function parseConfirmationDecision(raw: unknown): Pick<ConfirmationDecision, "decision" | "guidance"> {
  const record = asRecord(raw);
  const decision = optionalString(record.decision);
  if (decision !== "approve_once" && decision !== "deny" && decision !== "guidance") {
    throw new PanelHttpError(400, "invalid_confirmation_decision", "确认决定必须是 approve_once、deny 或 guidance。");
  }
  const guidance = optionalString(record.guidance);
  if (decision === "guidance" && guidance === undefined) {
    throw new PanelHttpError(400, "missing_confirmation_guidance", "补充指导不能为空。");
  }
  return {
    decision,
    guidance: guidance === undefined ? undefined : compactRuntimeText(guidance, 800),
  };
}

async function listPanelConversations(
  runtime: PanelRuntime,
  limit = 50
): Promise<readonly PanelConversationSummaryReadModel[]> {
  const persisted = (await runtime.runtimeDatabase?.listConversations(limit)) ?? [];
  for (const record of persisted) {
    runtime.conversations.restore(record);
  }
  return runtime.conversations.list().slice(0, Math.max(0, Math.floor(limit)));
}

async function getPanelConversation(
  runtime: PanelRuntime,
  conversationId: string
): Promise<PanelConversationReadModel | undefined> {
  const memory = runtime.conversations.getReadModel(conversationId);
  if (memory !== undefined) {
    return memory;
  }
  const persisted = await runtime.runtimeDatabase?.getConversation(conversationId);
  return persisted === undefined ? undefined : runtime.conversations.restore(persisted);
}

async function executeBasicPanelRun(
  runtime: PanelRuntime,
  input: BasicAgentRunExecutionInput
): Promise<PanelRunExecutionResult> {
  const job = input.job;
  if (job.conversationId !== undefined && job.runAfterRunId !== undefined) {
    runtime.conversations.activateQueuedRun(job.conversationId, job.runId);
  }
  const taskSoilInput = job.taskSoilInput;
  const conversationHistory = buildConversationHistoryMessages(
    runtime,
    job.conversationId,
    job.assistantTurnId
  );
  return runForPanel(runtime, job.runKind, job.goal, job.aiMode, taskSoilInput, job.runMode, {
    conversationHistory,
    abortSignal: input.abortSignal,
    onRuntimeReady: input.onRuntimeReady,
    onModelOutputDelta: input.onModelOutputDelta,
  });
}

async function failPanelRunJob(runtime: PanelRuntime, job: PanelRunJob, error: unknown): Promise<void> {
  const config = await runtime.configCenter.getModelProviderConfig().catch(() => job.config);
  const informationAccess = await runtime.configCenter.getInformationAccessConfig().catch(() => job.informationAccess);
  if (error instanceof UndergroundAiConfigurationError) {
    const message = panelConfigurationErrorMessage(error.issue.code);
    runtime.runJobs.fail(job.runId, {
      config,
      informationAccess,
      error: {
        code: error.issue.code,
        message,
      },
      summary: {
        ai: createConfigurationFailedAiSummary(error.issue.summaryInput, error, message),
      },
    });
    return;
  }
  if (error instanceof PanelHttpError) {
    runtime.runJobs.fail(job.runId, {
      config,
      informationAccess,
      error: {
        code: error.code,
        message: panelJobErrorMessage(error),
      },
    });
    return;
  }
  const eventEntries = job.runtime?.eventLog.list() ?? [];
  const modelFailureMessage = latestModelFailureMessage(eventEntries);
  runtime.runJobs.fail(job.runId, {
    config,
    informationAccess,
    error: {
      code: "panel_internal_error",
      message: friendlyUserFacingFailureText(
        modelFailureMessage ??
          (job.runKind === "desktop" ? "Desktop Shell 运行 job 失败。" : "地下兼容运行 job 失败。")
      ),
    },
  });
}

function schedulePanelRunJob(runtime: PanelRuntime, runId: string): void {
  runtime.runExecutor.schedule(runId);
}

function scheduleNextQueuedConversationRun(runtime: PanelRuntime, completedJob: PanelRunJob): void {
  if (completedJob.conversationId === undefined) {
    return;
  }
  const nextRunId = runtime.conversations.peekNextQueuedRunId(completedJob.conversationId);
  if (nextRunId === undefined) {
    return;
  }
  const nextJob = runtime.runJobs.get(nextRunId);
  if (nextJob === undefined || nextJob.status !== "pending") {
    return;
  }
  schedulePanelRunJob(runtime, nextRunId);
}

function createPanelRunJobResponse(runtime: PanelRuntime, job: PanelRunJob): PanelRunJobResponse {
  const eventEntries = job.runtime?.eventLog.list() ?? [];
  const config = job.completed?.config ?? job.failed?.config ?? job.cancelled?.config ?? job.blocked?.config ?? job.config;
  const informationAccess =
    job.completed?.informationAccess ??
    job.failed?.informationAccess ??
    job.cancelled?.informationAccess ??
    job.blocked?.informationAccess ??
    job.informationAccess;
  const summary = job.completed?.summary;
  const observation = job.completed?.observation;
  const agentRunTree = job.completed?.agentRunTree;
  const trace = createPanelRunTrace({ status: job.status, eventEntries });
  const tracking = createPanelRunTracking({
    status: job.status,
    config,
    informationAccess,
    requestedMode: job.aiMode,
    summary,
    observation,
    agentRunTree,
    eventEntries,
  });
  const streamEvents = syncPanelRunStreamEventsForJob(runtime, job);
  const transcript = {
    ...createPanelRunTranscript({
      runId: job.runId,
      status: job.status,
      eventEntries,
      summary,
      observation,
      agentRunTree,
      routeDecision: job.routeDecision,
      desktopMode: job.runKind === "desktop" ? job.runMode : undefined,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    }),
    events: streamEvents,
  };

  return {
    ok: true,
    runId: job.runId,
    runKind: job.runKind,
    runMode: job.runMode,
    status: job.status,
    config,
    informationAccess,
    trace,
    tracking,
    transcript,
    workNotes: transcript.workNotes,
    steps: transcript.steps,
    streamCursor: {
      runId: job.runId,
      lastSequence: transcript.events.at(-1)?.sequence ?? 0,
    },
    summary: job.completed?.summary ?? job.failed?.summary,
    observation: job.completed?.observation,
    canvas: job.completed?.canvas,
    route: routeReadModel(job.routeDecision),
    error: job.failed?.error ?? job.cancelled?.reason ?? job.blocked?.reason,
    conversation:
      job.conversationId === undefined
        ? undefined
        : runtime.conversations.getReadModel(job.conversationId),
  };
}

async function createPersistedRunResponse(
  runtime: PanelRuntime,
  snapshot: RuntimeRunSnapshot
): Promise<PanelRunJobResponse> {
  const status = panelStatusFromRuntimeStatus(snapshot.run.status);
  const config = await runtime.configCenter.getModelProviderConfig();
  const informationAccess = await runtime.configCenter.getInformationAccessConfig();
  const trace = createPersistedRunTrace(snapshot, status);
  const trackingBase = createPanelRunTracking({
    status,
    config,
    informationAccess,
    requestedMode: snapshot.run.aiMode,
    eventEntries: [],
  });
  const streamEvents = createPersistedStreamEvents(snapshot, status);
  const conversation =
    snapshot.run.conversationId === undefined
      ? undefined
      : await getPanelConversation(runtime, snapshot.run.conversationId);
  return {
    ok: true,
    runId: snapshot.run.runId,
    runKind: snapshot.run.runKind,
    runMode: snapshot.run.runMode,
    status,
    config,
    informationAccess,
    trace,
    tracking: {
      ...trackingBase,
      run: {
        ...trackingBase.run,
        status,
        phase: trace.currentPhase,
        stage: trace.currentStage,
        eventCount: trace.eventCursor.eventCount,
        lastEventType: trace.eventCursor.lastEventType,
        waitingPoint: trace.waitingPoint,
      },
      modelTotals: countPersistedModelCalls(snapshot.modelCalls),
      toolTotals: countPersistedToolCalls(snapshot.toolCalls),
    },
    transcript: {
      runId: snapshot.run.runId,
      status,
      updatedAt: snapshot.run.updatedAt,
      events: streamEvents,
      steps: [],
      workNotes: [],
      modelCalls: snapshot.modelCalls.map((call) => ({
        requestId: call.requestId,
        responseId: call.responseId,
        status: call.status,
        purpose: call.purpose,
        outputContractId: call.outputContractId,
        providerKind: call.providerKind,
        protocolKind: call.protocolKind,
        model: call.model,
        outputKind: call.outputKind,
        validationStatus: call.validationStatus,
        failureKind: call.failureKind,
        retryable: call.retryable,
        candidateRefs: [],
        eventRefs: [...call.eventRefs],
      })),
    },
    workNotes: [],
    steps: [],
    streamCursor: {
      runId: snapshot.run.runId,
      lastSequence: streamEvents.at(-1)?.sequence ?? 0,
    },
    error: snapshot.run.error,
    conversation,
    restoredFromSnapshot: true,
    restoredResult:
      snapshot.run.resultTitle === undefined && snapshot.run.resultSummary === undefined
        ? undefined
        : {
            title: snapshot.run.resultTitle ?? "上次结果",
            summary: snapshot.run.resultSummary ?? "结果已经整理完成。",
          },
    snapshot: {
      run: snapshot.run,
      workspace: snapshot.workspace,
      toolCalls: snapshot.toolCalls,
      artifacts: snapshot.artifacts,
      confirmations: snapshot.confirmations,
    },
  };
}

function createPersistedRunTrace(
  snapshot: RuntimeRunSnapshot,
  status: PanelRunStatus
): PanelRunTraceReadModel {
  const events = snapshot.events.map((event) => ({
    sequence: event.sequence,
    type: event.type,
    summary: event.summary,
    scope: event.scope,
    severity: event.severity,
    progress: event.progress,
    refs: event.refs,
    traceId: event.traceId,
    taskId: event.taskId,
    intent: event.intent,
    from: { id: "runtime-database", role: "runtime" },
    createdAt: event.createdAt,
    recordedAt: event.recordedAt,
  }));
  const lastEvent = snapshot.events.at(-1);
  return {
    status,
    currentPhase: persistedPhaseFor(lastEvent?.type, status),
    currentStage: persistedStageFor(lastEvent?.type, status),
    eventCursor: {
      eventCount: events.length,
      lastSequence: lastEvent?.sequence ?? 0,
      lastEventType: lastEvent?.type,
    },
    waitingPoint: persistedWaitingPoint(status),
    events,
  };
}

function createPersistedStreamEvents(
  snapshot: RuntimeRunSnapshot,
  status: PanelRunStatus
): readonly PanelRunStreamEvent[] {
  const startedStatus: NonNullable<PanelRunStreamEvent["status"]> =
    status === "pending"
      ? "pending"
      : status === "completed" || status === "running"
        ? "running"
        : status;
  const suppressOrdinaryChatProgress =
    snapshot.run.runMode === "agent" && !hasPersistedUserVisibleWorkActivity(snapshot.events);
  const events: PanelRunStreamEvent[] = [
    {
      eventId: `${snapshot.run.runId}:restored:run.started`,
      runId: snapshot.run.runId,
      sequence: 1,
      type: "run.started",
      createdAt: snapshot.run.createdAt,
      agentLabel: "AgentArbor",
      summary: "已从本地记录恢复这次运行。",
      status: startedStatus,
      sourceRefs: [],
      modelCallRefs: [],
      toolCallRefs: [],
    },
  ];
  for (const record of snapshot.events) {
    if (snapshot.run.runMode === "agent" && record.type === "goal.received") {
      continue;
    }
    if (suppressOrdinaryChatProgress && shouldSuppressPersistedOrdinaryChatEvent(record.type)) {
      continue;
    }
    const streamType = streamTypeForRuntimeEvent(record.type);
    if (streamType === undefined) {
      continue;
    }
    const toolCall = toolCallForPersistedEvent(record, snapshot.toolCalls);
    events.push({
      eventId: `${snapshot.run.runId}:restored:event:${record.sequence}:${streamType}`,
      runId: snapshot.run.runId,
      sequence: events.length + 1,
      type: streamType,
      createdAt: record.recordedAt,
      agentLabel: persistedStreamAgentLabel(streamType),
      summary: record.summary,
      status: streamStatusFor(streamType),
      toolName: toolCall?.toolName,
      detail: toolCall === undefined ? undefined : persistedToolStreamDetail(toolCall),
      sourceRefs: record.refs
        .filter((ref) => ref.kind !== "model_call" && ref.kind !== "tool_call")
        .map((ref) => `${ref.kind}:${ref.id}`),
      modelCallRefs: record.refs.filter((ref) => ref.kind === "model_call").map((ref) => ref.id),
      toolCallRefs: record.refs.filter((ref) => ref.kind === "tool_call").map((ref) => ref.id),
    });
  }
  for (const confirmation of snapshot.confirmations) {
    if (confirmation.decidedAt === undefined) {
      continue;
    }
    const type: PanelRunStreamEvent["type"] =
      confirmation.status === "approved"
        ? "run.resumed"
        : confirmation.status === "denied"
          ? "user_approval.received"
          : "user.guidance";
    events.push({
      eventId: `${snapshot.run.runId}:restored:confirmation:${confirmation.confirmationId}:${confirmation.status}`,
      runId: snapshot.run.runId,
      sequence: events.length + 1,
      type,
      createdAt: confirmation.decidedAt,
      agentLabel: type === "run.resumed" ? "AgentArbor" : type === "user_approval.received" ? "用户确认" : "用户指导",
      summary: restoredConfirmationDecisionSummary(confirmation),
      status: confirmation.status === "denied" ? "blocked" : confirmation.status === "guidance" ? "pending" : "completed",
      sourceRefs: [`confirmation:${confirmation.confirmationId}`],
      modelCallRefs: [],
      toolCallRefs: [],
    });
  }
  if (status === "completed") {
    events.push({
      eventId: `${snapshot.run.runId}:restored:final.result`,
      runId: snapshot.run.runId,
      sequence: events.length + 1,
      type: "final.result",
      createdAt: snapshot.run.updatedAt,
      agentLabel: "AgentArbor",
      summary: snapshot.run.resultSummary ?? "结果已经整理完成。",
      status: "completed",
      sourceRefs: [],
      modelCallRefs: [],
      toolCallRefs: snapshot.toolCalls.map((call) => call.callId),
    });
  }
  if (status === "failed") {
    events.push({
      eventId: `${snapshot.run.runId}:restored:run.failed`,
      runId: snapshot.run.runId,
      sequence: events.length + 1,
      type: "run.failed",
      createdAt: snapshot.run.updatedAt,
      agentLabel: "AgentArbor",
      summary: friendlyUserFacingFailureText(snapshot.run.error?.message ?? snapshot.run.resultSummary),
      status: "failed",
      sourceRefs: [],
      modelCallRefs: [],
      toolCallRefs: snapshot.toolCalls.map((call) => call.callId),
    });
  }
  if (status === "cancelled") {
    events.push({
      eventId: `${snapshot.run.runId}:restored:run.cancelled`,
      runId: snapshot.run.runId,
      sequence: events.length + 1,
      type: "run.cancelled",
      createdAt: snapshot.run.updatedAt,
      agentLabel: "AgentArbor",
      summary: snapshot.run.resultSummary ?? "运行已取消。",
      status: "cancelled",
      sourceRefs: [],
      modelCallRefs: [],
      toolCallRefs: snapshot.toolCalls.map((call) => call.callId),
    });
  }
  if (status === "blocked") {
    events.push({
      eventId: `${snapshot.run.runId}:restored:run.blocked`,
      runId: snapshot.run.runId,
      sequence: events.length + 1,
      type: "run.blocked",
      createdAt: snapshot.run.updatedAt,
      agentLabel: "AgentArbor",
      summary: snapshot.run.resultSummary ?? snapshot.run.error?.message ?? "运行已中断，需要重新发起或继续处理。",
      status: "blocked",
      sourceRefs: [],
      modelCallRefs: [],
      toolCallRefs: snapshot.toolCalls.map((call) => call.callId),
    });
  }
  return events;
}

function restoredConfirmationDecisionSummary(confirmation: RuntimeConfirmationRecord): string {
  if (confirmation.status === "approved") {
    return "已批准本次操作。";
  }
  if (confirmation.status === "denied") {
    return "已拒绝本次操作，运行不会继续执行该动作。";
  }
  return confirmation.guidance === undefined || confirmation.guidance.trim().length === 0
    ? "已收到补充指导。"
    : `已收到补充指导：${compactRuntimeText(confirmation.guidance, 240)}`;
}

function basicRunReplayFromSnapshot(snapshot: RuntimeRunSnapshot): BasicAgentRunReplay {
  const events = restoredBasicEvents(snapshot);
  return {
    cursor: {
      runId: snapshot.run.runId,
      lastSequence: events.at(-1)?.sequence ?? 0,
      eventCount: events.length,
    },
    events,
  };
}

function restoredBasicEvents(snapshot: RuntimeRunSnapshot): readonly RunEvent[] {
  const status = agentTaskStatusFromSnapshot(snapshot);
  const persisted = snapshot.basicEvents.length > 0
    ? snapshot.basicEvents.filter((event) => event.visibility !== "debug")
    : createPersistedStreamEvents(snapshot, panelStatusFromRuntimeStatus(snapshot.run.status))
      .map(toBasicRunEventFromPanelStreamEvent)
      .filter((event) => event.visibility !== "debug");
  const terminalType = status === "blocked"
    ? "run.blocked"
    : status === "cancelled"
      ? "run.cancelled"
      : status === "failed"
        ? "run.failed"
        : status === "completed"
          ? "final.result"
          : undefined;
  if (terminalType === undefined || persisted.some((event) => event.type === terminalType)) {
    return persisted;
  }
  const terminal = createRestoredBasicTerminalEvent(snapshot, status, terminalType, persisted.at(-1)?.sequence ?? 0);
  return [...persisted, terminal];
}

function createRestoredBasicTerminalEvent(
  snapshot: RuntimeRunSnapshot,
  status: BasicAgentRun["status"],
  type: string,
  lastSequence: number
): RunEvent {
  return {
    id: `${snapshot.run.runId}:restored:basic:${type}`,
    runId: snapshot.run.runId,
    sequence: lastSequence + 1,
    type,
    title: basicRunTitleFromStatus(status, undefined),
    summary:
      status === "blocked"
        ? "运行已中断，需要重新发起或继续处理。"
        : snapshot.run.error?.message ?? snapshot.run.resultSummary,
    status,
    timestamp: snapshot.run.updatedAt,
    refs: [],
    visibility: "compact",
  };
}

function toBasicRunEventFromPanelStreamEvent(event: PanelRunStreamEvent): BasicAgentRunReplay["events"][number] {
  const summary = event.detail?.preview ?? event.delta ?? event.summary;
  return {
    id: event.eventId,
    runId: event.runId,
    sequence: event.sequence,
    type: event.type,
    title: basicEventTitleFromStreamType(event.type),
    summary,
    status: agentTaskStatusFromPanelStreamEvent(event),
    timestamp: event.createdAt,
    refs: [
      { kind: "event", id: event.eventId },
      ...event.modelCallRefs.map((id) => ({ kind: "model_call" as const, id })),
      ...event.toolCallRefs.map((id) => ({ kind: "tool_call" as const, id })),
    ],
    visibility: event.type.startsWith("tool.") || event.type === "confirmation.needed" ? "expanded" : "compact",
  };
}

function basicEventTitleFromStreamType(type: PanelRunStreamEvent["type"]): string {
  if (type === "run.started") return "任务已开始";
  if (type === "run.cancelled") return "任务已取消";
  if (type === "run.blocked") return "任务已暂停";
  if (type === "run.resumed") return "任务继续";
  if (type === "tool.requested") return "正在使用工具";
  if (type === "tool.completed") return "工具已完成";
  if (type === "tool.failed") return "工具未完成";
  if (type === "confirmation.needed") return "需要确认";
  if (type === "user_approval.received") return "收到确认结果";
  if (type === "user.guidance") return "收到用户指导";
  if (type === "final.result") return "结果已生成";
  if (type === "run.failed") return "运行未完成";
  return "工作状态更新";
}

function agentTaskStatusFromPanelStreamEvent(event: PanelRunStreamEvent): BasicAgentRun["status"] {
  if (event.type === "confirmation.needed") return "approval_needed";
  if (event.type === "user.guidance") return "needs_input";
  if (event.type === "user_approval.received") return "blocked";
  if (event.type === "run.cancelled" || event.status === "cancelled") return "cancelled";
  if (event.type === "run.blocked" || event.status === "blocked") return "blocked";
  if (event.type === "run.failed" || event.status === "failed") return "failed";
  if (event.type === "final.result" || event.status === "completed") return "completed";
  if (event.status === "pending") return "queued";
  return "running";
}

function hasPersistedUserVisibleWorkActivity(events: readonly RuntimeEventRecord[]): boolean {
  return events.some((event) => {
    if (event.type === "tool.requested" || event.type === "tool.completed" || event.type === "tool.failed") {
      return true;
    }
    if (event.type === "user_approval.requested" || event.type === "user_approval.received") {
      return true;
    }
    return (
      event.type === "agent.delegation.planned" ||
      event.type === "agent.child.started" ||
      event.type === "agent.child.completed" ||
      event.type === "agent.child.waiting" ||
      event.type === "agent.parent_synthesis.completed"
    );
  });
}

function shouldSuppressPersistedOrdinaryChatEvent(type: RuntimeEventRecord["type"]): boolean {
  return type === "goal.received" || type === "model.requested" || type === "model.completed";
}

function persistedStreamAgentLabel(type: PanelRunStreamEvent["type"]): string {
  if (type.startsWith("tool.")) {
    return "工具";
  }
  if (type === "confirmation.needed") {
    return "待确认";
  }
  if (type === "user_approval.received") {
    return "用户确认";
  }
  if (type === "user.guidance") {
    return "用户指导";
  }
  if (type === "agent.note.delta" || type === "agent.note.completed" || type === "model.output.completed") {
    return "模型";
  }
  return "AgentArbor";
}

function panelStatusFromRuntimeStatus(status: RuntimeRunRecord["status"]): PanelRunStatus {
  if (status === "pending" || status === "completed" || status === "failed" || status === "cancelled" || status === "blocked") {
    return status;
  }
  if (status === "running") {
    return "blocked";
  }
  return "failed";
}

function persistedPhaseFor(
  type: RuntimeEventRecord["type"] | undefined,
  status: PanelRunStatus
): PanelRunTraceReadModel["currentPhase"] {
  if (type === undefined) {
    return status === "completed" ? "completed" : status === "blocked" || status === "cancelled" || status === "failed" ? "verification" : "not_started";
  }
  if (status === "completed") {
    return "completed";
  }
  if (status === "blocked" || status === "cancelled" || status === "failed") {
    return "verification";
  }
  if (type.startsWith("direction_handoff.")) {
    return "handoff";
  }
  if (
    type.startsWith("artifact.") ||
    type.startsWith("task.") ||
    type.startsWith("workflow.") ||
    type.startsWith("growth_plan.")
  ) {
    return "aboveground";
  }
  if (type.startsWith("verification.") || type.startsWith("acceptance.")) {
    return "verification";
  }
  if (type.startsWith("fruit.") || type.startsWith("run_memory.") || type.startsWith("experience_candidate.") || type.startsWith("path_bias.")) {
    return "fruits";
  }
  if (type.startsWith("governance.")) {
    return "governance";
  }
  return type === "goal.received" ? "not_started" : "underground";
}

function persistedStageFor(
  type: RuntimeEventRecord["type"] | undefined,
  status: PanelRunStatus
): PanelRunTraceReadModel["currentStage"] {
  if (type === undefined) {
    return status === "running" ? "running" : "not_started";
  }
  const normalized = type.replaceAll(".", "_");
  if (isPersistedRunStage(normalized)) {
    return normalized;
  }
  return status === "running" ? "running" : "not_started";
}

function isPersistedRunStage(value: string): value is PanelRunTraceReadModel["currentStage"] {
  return [
    "not_started",
    "goal_received",
    "model_requested",
    "model_completed",
    "model_failed",
    "tool_requested",
    "tool_completed",
    "tool_failed",
    "agent_delegation_planned",
    "agent_child_started",
    "agent_child_completed",
    "agent_child_interrupted",
    "agent_child_resumed",
    "agent_child_waiting",
    "agent_parent_synthesis_completed",
    "direction_handoff_completed",
    "user_approval_requested",
    "user_approval_received",
    "artifact_produced",
    "task_completed",
    "task_failed",
    "path_bias_suggested",
    "running",
  ].includes(value);
}

function persistedWaitingPoint(status: PanelRunStatus): string {
  if (status === "pending") {
    return "等待开始。";
  }
  if (status === "running") {
    return "运行记录显示仍在进行；如这是重启后的历史记录，需要重新发起后续任务。";
  }
  if (status === "cancelled") {
    return "运行已取消。";
  }
  if (status === "blocked") {
    return "运行已中断，需要重新发起或继续处理。";
  }
  if (status === "failed") {
    return "运行失败，详情保存在安全摘要中。";
  }
  return "运行已完成。";
}

function streamTypeForRuntimeEvent(type: RuntimeEventRecord["type"]): PanelRunStreamEvent["type"] | undefined {
  if (type === "model.requested") {
    return "agent.note.delta";
  }
  if (type === "model.completed") {
    return "model.output.completed";
  }
  if (type === "model.failed") {
    return "agent.note.completed";
  }
  if (type === "tool.requested" || type === "tool.completed" || type === "tool.failed") {
    return type;
  }
  if (
    type === "agent.delegation.planned" ||
    type === "agent.child.started" ||
    type === "agent.child.completed" ||
    type === "agent.child.waiting" ||
    type === "agent.parent_synthesis.completed"
  ) {
    return type;
  }
  if (type === "user_approval.requested") {
    return "confirmation.needed";
  }
  if (type === "user_approval.received") {
    return "user.guidance";
  }
  return "agent.note.completed";
}

function streamStatusFor(type: PanelRunStreamEvent["type"]): NonNullable<PanelRunStreamEvent["status"]> {
  if (type === "tool.requested" || type === "agent.note.delta" || type === "agent.child.started" || type === "agent.child.waiting") {
    return "running";
  }
  if (type === "confirmation.needed") {
    return "pending";
  }
  if (type === "user_approval.received") {
    return "completed";
  }
  if (type === "run.cancelled") {
    return "cancelled";
  }
  if (type === "run.blocked") {
    return "blocked";
  }
  if (type === "tool.failed" || type === "run.failed") {
    return "failed";
  }
  return "completed";
}

function toolCallForPersistedEvent(
  event: RuntimeEventRecord,
  toolCalls: readonly RuntimeToolCallRecord[]
): RuntimeToolCallRecord | undefined {
  const toolRef = event.refs.find((ref) => ref.kind === "tool_call");
  return toolRef === undefined ? undefined : toolCalls.find((call) => call.callId === toolRef.id);
}

function persistedToolStreamDetail(call: RuntimeToolCallRecord): PanelRunStreamEvent["detail"] {
  return {
    kind: "tool",
    action: call.action ?? call.toolName,
    path: call.path,
    query: call.query,
    command: call.command,
    exitCode: call.exitCode,
    preview: call.error ?? call.preview ?? call.summary,
    truncated: call.truncated,
    error: call.error,
  };
}

function countPersistedModelCalls(
  calls: readonly RuntimeModelCallRecord[]
): PanelRunTrackingReadModel["modelTotals"] {
  return {
    requested: calls.length,
    completed: calls.filter((call) => call.status === "completed").length,
    failed: calls.filter((call) => call.status === "failed").length,
  };
}

function countPersistedToolCalls(
  calls: readonly RuntimeToolCallRecord[]
): PanelRunTrackingReadModel["toolTotals"] {
  return {
    requested: calls.length,
    completed: calls.filter((call) => call.status === "completed").length,
    failed: calls.filter((call) => call.status === "failed").length,
  };
}

async function persistPanelRun(runtime: PanelRuntime, job: PanelRunJob): Promise<void> {
  if (runtime.runtimeDatabase === undefined || runtime.runtimePaths === undefined) {
    return;
  }
  const previous = runtime.persistenceChains.get(job.runId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(() => persistPanelRunNow(runtime, job));
  const tracked = current.then(() => undefined, () => undefined);
  runtime.persistenceChains.set(job.runId, tracked);
  try {
    await current;
  } finally {
    if (runtime.persistenceChains.get(job.runId) === tracked) {
      runtime.persistenceChains.delete(job.runId);
    }
  }
}

async function persistPanelRunNow(runtime: PanelRuntime, job: PanelRunJob): Promise<void> {
  if (runtime.runtimeDatabase === undefined || runtime.runtimePaths === undefined) {
    return;
  }
  if (job.conversationId !== undefined) {
    await persistPanelConversation(runtime, job.conversationId);
  }
  const workspace = await runtime.configCenter.getWorkspaceConfig().catch(() => undefined);
  const workspaceRecord = workspace === undefined ? undefined : createRuntimeWorkspaceRecord(workspace, job.updatedAt);
  if (workspaceRecord !== undefined) {
    await runtime.runtimeDatabase.upsertWorkspace(workspaceRecord);
  }
  await runtime.runtimeDatabase.upsertRun(createRuntimeRunRecord(runtime, job, workspaceRecord));

  const eventEntries = job.runtime?.eventLog.list() ?? [];
  const trace = createPanelRunTrace({ status: job.status, eventEntries });
  const streamEvents = syncPanelRunStreamEventsForJob(runtime, job);
  const basicRun = runtime.runExecutor.get(job.runId);
  const basicReplay = runtime.runExecutor.replayEvents(job.runId, 0);
  const transcript = createPanelRunTranscript({
    runId: job.runId,
    status: job.status,
    eventEntries,
    summary: job.completed?.summary,
    observation: job.completed?.observation,
    agentRunTree: job.completed?.agentRunTree,
    routeDecision: job.routeDecision,
    desktopMode: job.runKind === "desktop" ? job.runMode : undefined,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
  if (basicRun !== undefined) {
    await runtime.runtimeDatabase.upsertBasicRun(basicRun);
  }
  if (basicReplay !== undefined) {
    await runtime.runtimeDatabase.replaceBasicRunEvents(job.runId, basicReplay.events);
  }
  await runtime.runtimeDatabase.replaceRunEvents(job.runId, trace.events.map((event) => toRuntimeEventRecord(job.runId, event)));
  await runtime.runtimeDatabase.replaceModelCalls(
    job.runId,
    transcript.modelCalls.map((call) => toRuntimeModelCallRecord(job.runId, call))
  );
  await runtime.runtimeDatabase.replaceToolCalls(job.runId, toRuntimeToolCallRecords(job.runId, streamEvents, eventEntries));
  await runtime.runtimeDatabase.replaceArtifacts(job.runId, toRuntimeArtifactRecords(job));
  await runtime.runtimeDatabase.replaceConfirmations(job.runId, toRuntimeConfirmationRecords(job, eventEntries));
}

async function persistPanelConversation(runtime: PanelRuntime, conversationId: string): Promise<void> {
  const conversation = runtime.conversations.getReadModel(conversationId);
  if (conversation === undefined || runtime.runtimeDatabase === undefined) {
    return;
  }
  await runtime.runtimeDatabase.upsertConversation(toRuntimeConversationRecord(conversation));
}

function createRuntimeWorkspaceRecord(
  workspace: SanitizedWorkspaceConfig,
  selectedAt: string
): RuntimeWorkspaceRecord {
  return {
    workspaceId: "workspace:current",
    kind: "local_directory",
    path: workspace.workspaceDirectory,
    label: path.basename(workspace.workspaceDirectory) || workspace.workspaceDirectory,
    selectedAt,
    updatedAt: workspace.updatedAt,
  };
}

function createRuntimeRunRecord(
  runtime: PanelRuntime,
  job: PanelRunJob,
  workspace: RuntimeWorkspaceRecord | undefined
): RuntimeRunRecord {
  const appHome = runtime.runtimePaths?.appHome ?? "";
  const runHome =
    runtime.runtimePaths === undefined
      ? ""
      : path.join(runtime.runtimePaths.runtimeHome, "runs", encodeURIComponent(job.runId));
  const restoredResult = resultSummaryForJob(job);
  return {
    runId: job.runId,
    profile: "lite",
    runKind: job.runKind,
    runMode: job.runMode,
    status: job.status,
    goalSummary: compactRuntimeText(job.goal, 300),
    aiMode: job.aiMode,
    workspaceId: workspace?.workspaceId,
    workspacePath: workspace?.path,
    conversationId: job.conversationId,
    traceId: job.traceId ?? job.completed?.observation?.traceId ?? canvasTraceId(job.completed?.canvas),
    goalId: job.goalId ?? job.completed?.observation?.goalId,
    appHome,
    runHome,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: isTerminalPanelRunStatus(job.status) ? job.updatedAt : undefined,
    resultTitle: restoredResult?.title,
    resultSummary: restoredResult?.summary,
    error: job.failed?.error ?? job.cancelled?.reason ?? job.blocked?.reason,
  };
}

function isTerminalPanelRunStatus(status: PanelRunStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "blocked";
}

function resultSummaryForJob(job: PanelRunJob): { readonly title: string; readonly summary: string } | undefined {
  if (job.failed !== undefined) {
    return {
      title: "这次没有完成",
      summary: compactRuntimeText(job.failed.error.message, 900),
    };
  }
  if (job.cancelled !== undefined) {
    return {
      title: "已取消",
      summary: compactRuntimeText(job.cancelled.reason.message, 900),
    };
  }
  if (job.blocked !== undefined) {
    return {
      title: "需要处理",
      summary: compactRuntimeText(job.blocked.reason.message, 900),
    };
  }
  const canvas = job.completed?.canvas;
  if (canvas?.kind === "desktop_agent_canvas" && canvas.agent.answer !== undefined) {
    return {
      title: canvas.agent.pendingConfirmation === undefined ? "已完成" : "需要确认",
      summary: compactRuntimeText(canvas.agent.answer.answer, 900),
    };
  }
  if (canvas?.kind === "desktop_agent_canvas" && canvas.agent.pendingConfirmation !== undefined) {
    return {
      title: "需要确认",
      summary: compactRuntimeText(
        `${canvas.agent.pendingConfirmation.question} ${canvas.agent.pendingConfirmation.consequence}`,
        900
      ),
    };
  }
  if (canvas?.kind === "work_session_canvas" && canvas.workSession.directAnswer !== undefined) {
    return {
      title: "已回答",
      summary: compactRuntimeText(canvas.workSession.directAnswer.answer, 900),
    };
  }
  if (canvas?.kind === "work_session_canvas" && canvas.workSession.report !== undefined) {
    return {
      title: canvas.workSession.report.title,
      summary: compactRuntimeText(canvas.workSession.report.decisionSummary, 900),
    };
  }
  if (canvas?.kind === "underground_deep_canvas") {
    return {
      title: canvas.underground.status === "approved_package_created" ? "方向已形成" : "深度模式已停止",
      summary: compactRuntimeText(
        canvas.underground.recommendedDirection.reason || canvas.underground.convergenceSummary,
        900
      ),
    };
  }
  if (job.status === "completed") {
    return {
      title: "结果已生成",
      summary: "结果已经整理完成。",
    };
  }
  return undefined;
}

function toRuntimeEventRecord(
  runId: string,
  event: PanelRunTraceReadModel["events"][number]
): RuntimeEventRecord {
  return {
    eventId: `${runId}:event:${event.sequence}`,
    runId,
    sequence: event.sequence,
    type: event.type,
    summary: compactRuntimeText(event.summary, 800),
    scope: event.scope,
    severity: event.severity,
    progress: event.progress,
    refs: event.refs,
    traceId: event.traceId,
    taskId: event.taskId,
    intent: event.intent,
    createdAt: event.createdAt,
    recordedAt: event.recordedAt,
  };
}

function toRuntimeModelCallRecord(
  runId: string,
  call: PanelRunTranscript["modelCalls"][number]
): RuntimeModelCallRecord {
  return {
    requestId: call.requestId,
    runId,
    responseId: call.responseId,
    status: call.status,
    purpose: call.purpose,
    outputContractId: call.outputContractId,
    providerKind: call.providerKind,
    protocolKind: call.protocolKind,
    model: call.model,
    outputKind: call.outputKind,
    validationStatus: call.validationStatus,
    failureKind: call.failureKind,
    retryable: call.retryable,
    eventRefs: call.eventRefs,
  };
}

function toRuntimeToolCallRecords(
  runId: string,
  events: readonly PanelRunStreamEvent[],
  eventEntries: readonly EventLogEntry[]
): readonly RuntimeToolCallRecord[] {
  const detailsByCallId = localToolDetailsByCallId(eventEntries);
  const calls = new Map<string, RuntimeToolCallRecord>();
  for (const event of events) {
    if (!event.type.startsWith("tool.") && event.type !== "confirmation.needed") {
      continue;
    }
    for (const callId of event.toolCallRefs) {
      const previous = calls.get(callId);
      const detail = detailsByCallId.get(callId);
      calls.set(callId, {
        callId,
        runId,
        toolName: event.toolName ?? previous?.toolName,
        status: mergeToolStatus(previous?.status, event.type),
        action: event.detail?.action ?? detail?.action ?? previous?.action,
        path: event.detail?.path ?? detail?.path ?? previous?.path,
        query: event.detail?.query ?? detail?.query ?? previous?.query,
        command: event.detail?.command ?? detail?.command ?? previous?.command,
        exitCode: event.detail?.exitCode ?? detail?.exitCode ?? previous?.exitCode,
        summary: detail?.summary ?? event.summary ?? previous?.summary,
        preview: event.detail?.preview ?? detail?.preview ?? previous?.preview,
        truncated: event.detail?.truncated ?? detail?.truncated ?? previous?.truncated,
        error: event.detail?.error ?? detail?.error ?? previous?.error,
        eventRefs: unique([...(previous?.eventRefs ?? []), event.eventId]),
        createdAt: previous?.createdAt ?? event.createdAt,
      });
    }
  }
  return [...calls.values()];
}

function localToolDetailsByCallId(
  eventEntries: readonly EventLogEntry[]
): Map<string, Pick<RuntimeToolCallRecord, "action" | "path" | "query" | "command" | "exitCode" | "summary" | "preview" | "truncated" | "error">> {
  const details = new Map<string, Pick<RuntimeToolCallRecord, "action" | "path" | "query" | "command" | "exitCode" | "summary" | "preview" | "truncated" | "error">>();
  for (const entry of eventEntries) {
    if (entry.type !== "tool.completed" && entry.type !== "tool.failed") {
      continue;
    }
    const payload = asRecord(entry.message.payload);
    const callId = optionalString(payload.callId);
    if (callId === undefined) {
      continue;
    }
    const output = asRecord(payload.output);
    const input = asRecord(payload.input);
    const result = asRecord(output.result);
    const pathValue = optionalString(result.path) ?? optionalString(input.path);
    const command = optionalString(result.command) ?? optionalString(input.command);
    const args = Array.isArray(result.args) ? result.args : Array.isArray(input.args) ? input.args : [];
    details.set(callId, {
      action: optionalString(output.action) ?? optionalString(payload.toolName),
      path: pathValue,
      query: optionalString(result.query) ?? optionalString(input.query),
      command: command === undefined ? undefined : [command, ...args.filter((value): value is string => typeof value === "string")].join(" ").trim(),
      exitCode: typeof result.exitCode === "number" ? result.exitCode : undefined,
      summary: optionalString(output.summary),
      preview: persistedToolPreview(optionalString(payload.toolName), output, result, payload),
      truncated: output.truncated === true,
      error: optionalString(payload.error),
    });
  }
  return details;
}

function persistedToolPreview(
  toolName: string | undefined,
  output: Readonly<Record<string, unknown>>,
  result: Readonly<Record<string, unknown>>,
  payload: Readonly<Record<string, unknown>>
): string | undefined {
  const error = optionalString(payload.error);
  if (error !== undefined) {
    return compactRuntimeText(error, 800);
  }
  if (toolName === "read_file") {
    return persistedReadFilePreview(output, result);
  }
  if (toolName === "list_dir") {
    const entries = Array.isArray(result.entries) ? result.entries : [];
    const lines = entries.slice(0, 12).map((entry) => {
      const record = asRecord(entry);
      const name = optionalString(record.name) ?? "unknown";
      const kind = optionalString(record.kind) ?? "entry";
      const bytes = typeof record.bytes === "number" ? ` · ${record.bytes} bytes` : "";
      return `${kind} ${name}${bytes}`;
    });
    return lines.length === 0 ? optionalString(output.summary) : lines.join("\n");
  }
  if (toolName === "grep_files") {
    const matches = Array.isArray(result.matches) ? result.matches : [];
    const lines = matches.slice(0, 12).map((match) => {
      const record = asRecord(match);
      const path = optionalString(record.path) ?? "unknown";
      const line = typeof record.line === "number" ? record.line : "?";
      const preview = optionalString(record.preview) ?? "";
      return `${path}:${line} ${preview}`;
    });
    return lines.length === 0 ? optionalString(output.summary) : lines.join("\n");
  }
  if (toolName === "run_command") {
    return persistedCommandPreview(output, result);
  }
  return optionalString(output.summary);
}

function persistedReadFilePreview(
  output: Readonly<Record<string, unknown>>,
  result: Readonly<Record<string, unknown>>
): string | undefined {
  return safeReadFileToolPreview({
    summary: optionalString(output.summary),
    path: optionalString(result.path),
    bytes: typeof result.bytes === "number" ? result.bytes : undefined,
  });
}

function persistedCommandPreview(
  output: Readonly<Record<string, unknown>>,
  result: Readonly<Record<string, unknown>>
): string | undefined {
  return safeCommandToolPreview({
    summary: optionalString(output.summary),
    command: optionalString(result.command),
    exitCode: typeof result.exitCode === "number" ? result.exitCode : undefined,
  });
}

function toRuntimeArtifactRecords(job: PanelRunJob): readonly RuntimeArtifactRecord[] {
  return (job.runtime?.artifactStore.list() ?? []).map((artifact) => ({
    runId: job.runId,
    ref: artifact.ref,
    summary: compactRuntimeText(artifact.summary, 800),
  }));
}

function toRuntimeConfirmationRecords(
  job: PanelRunJob,
  eventEntries: readonly EventLogEntry[]
): readonly RuntimeConfirmationRecord[] {
  const confirmations = new Map<string, RuntimeConfirmationRecord>();
  for (const entry of eventEntries) {
    if (entry.type !== "user_approval.requested" && entry.type !== "user_approval.received") {
      continue;
    }
    const payload = asRecord(entry.message.payload);
    const confirmationId =
      optionalString(payload.confirmationId) ??
      optionalString(payload.requestId) ??
      `confirmation-${entry.sequence}`;
    const previous = confirmations.get(confirmationId);
    const eventRef = `${job.runId}:event:${entry.sequence}`;
    if (entry.type === "user_approval.requested") {
      const question = optionalString(payload.question);
      const consequence = optionalString(payload.consequence);
      confirmations.set(confirmationId, {
        confirmationId,
        runId: job.runId,
        conversationId: job.conversationId,
        status: previous?.status ?? "pending",
        title: compactRuntimeText(optionalString(payload.title) ?? "需要确认", 160),
        actionSummary: compactRuntimeText(
          [question, consequence].filter((value): value is string => value !== undefined).join(" ") ||
            "继续前需要用户确认。",
          500
        ),
        affectedResources: affectedResourcesFrom(payload),
        riskLevel: riskLevelFrom(payload.riskLevel),
        requestedAt: entry.recordedAt,
        expiresAt: optionalString(payload.expiresAt),
        decidedAt: previous?.decidedAt,
        guidance: previous?.guidance,
        eventRefs: unique([...(previous?.eventRefs ?? []), eventRef]),
      });
      continue;
    }
    confirmations.set(confirmationId, {
      confirmationId,
      runId: job.runId,
      conversationId: job.conversationId,
      status: decisionStatusFrom(payload),
      title: previous?.title ?? "用户指导",
      actionSummary: previous?.actionSummary ?? "用户已补充确认或指导。",
      affectedResources: previous?.affectedResources ?? affectedResourcesFrom(payload),
      riskLevel: previous?.riskLevel ?? "medium",
      requestedAt: previous?.requestedAt ?? entry.recordedAt,
      expiresAt: previous?.expiresAt,
      decidedAt: optionalString(payload.answeredAt) ?? entry.recordedAt,
      guidance: guidanceFrom(payload),
      eventRefs: unique([...(previous?.eventRefs ?? []), eventRef]),
    });
  }
  for (const decision of job.confirmationDecisions) {
    const previous = confirmations.get(decision.confirmationId);
    confirmations.set(decision.confirmationId, {
      confirmationId: decision.confirmationId,
      runId: job.runId,
      conversationId: job.conversationId,
      status:
        decision.decision === "approve_once"
          ? "approved"
          : decision.decision === "deny"
            ? "denied"
            : "guidance",
      title: previous?.title ?? "用户确认",
      actionSummary: previous?.actionSummary ?? "用户已补充确认或指导。",
      affectedResources: previous?.affectedResources ?? [],
      riskLevel: previous?.riskLevel ?? "medium",
      requestedAt: previous?.requestedAt ?? decision.decidedAt,
      expiresAt: previous?.expiresAt,
      decidedAt: decision.decidedAt,
      guidance: decision.guidance === undefined ? previous?.guidance : compactRuntimeText(decision.guidance, 500),
      eventRefs: unique([...(previous?.eventRefs ?? []), `confirmation:${decision.confirmationId}`]),
    });
  }
  return [...confirmations.values()];
}

function affectedResourcesFrom(payload: Readonly<Record<string, unknown>>): readonly string[] {
  const explicit = stringArrayFrom(payload.affectedResources);
  if (explicit.length > 0) {
    return explicit.slice(0, 12).map((value) => compactRuntimeText(value, 240));
  }
  const sourceRefs = stringArrayFrom(payload.sourceRefs);
  if (sourceRefs.length > 0) {
    return sourceRefs.slice(0, 12).map((value) => compactRuntimeText(value, 240));
  }
  const evidenceRefs = stringArrayFrom(payload.evidenceRefs);
  return evidenceRefs.slice(0, 12).map((value) => compactRuntimeText(value, 240));
}

function riskLevelFrom(value: unknown): RuntimeConfirmationRecord["riskLevel"] {
  return value === "low" || value === "medium" || value === "high" ? value : "medium";
}

function decisionStatusFrom(payload: Readonly<Record<string, unknown>>): RuntimeConfirmationRecord["status"] {
  const decision = (optionalString(payload.decision) ?? optionalString(payload.status) ?? "").toLowerCase();
  if (decision.includes("approve") || decision.includes("allow") || decision.includes("同意") || decision.includes("允许")) {
    return "approved";
  }
  if (decision.includes("deny") || decision.includes("reject") || decision.includes("refuse") || decision.includes("拒绝")) {
    return "denied";
  }
  return "guidance";
}

function guidanceFrom(payload: Readonly<Record<string, unknown>>): string | undefined {
  const direct = optionalString(payload.guidance) ?? optionalString(payload.note);
  if (direct !== undefined) {
    return compactRuntimeText(direct, 500);
  }
  const answers = Array.isArray(payload.answers) ? payload.answers : undefined;
  if (answers !== undefined) {
    return `用户已补充 ${answers.length} 项说明。`;
  }
  return undefined;
}

function stringArrayFrom(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function mergeToolStatus(
  previous: RuntimeToolCallRecord["status"] | undefined,
  eventType: PanelRunStreamEvent["type"]
): RuntimeToolCallRecord["status"] {
  if (previous === "failed" || eventType === "tool.failed") {
    return "failed";
  }
  if (previous === "completed" || eventType === "tool.completed") {
    return "completed";
  }
  if (previous === "cancelled") {
    return "cancelled";
  }
  if (eventType === "confirmation.needed" || previous === "approval_required") {
    return "approval_required";
  }
  return "requested";
}

function syncConversationTurnForJob(runtime: PanelRuntime, job: PanelRunJob): void {
  if (job.conversationId === undefined || job.assistantTurnId === undefined) {
    return;
  }
  const response = createPanelRunJobResponse(runtime, job);
  if (response.status === "failed") {
    runtime.conversations.completeAssistantTurn({
      conversationId: job.conversationId,
      assistantTurnId: job.assistantTurnId,
      runId: job.runId,
      title: "这次没有完成",
      content: friendlyAssistantFailureText(response.error?.message),
      status: "failed",
    });
    return;
  }
  if (response.status === "cancelled") {
    runtime.conversations.completeAssistantTurn({
      conversationId: job.conversationId,
      assistantTurnId: job.assistantTurnId,
      runId: job.runId,
      title: "已取消",
      content: "运行已取消。",
      status: "failed",
    });
    return;
  }
  if (response.status === "blocked") {
    runtime.conversations.completeAssistantTurn({
      conversationId: job.conversationId,
      assistantTurnId: job.assistantTurnId,
      runId: job.runId,
      title: "需要处理",
      content: sanitizeAssistantVisibleText(response.error?.message ?? "运行已中断，需要重新发起或继续处理。"),
      status: "completed",
    });
    return;
  }
  const turn = assistantTurnFromResponse(response);
  runtime.conversations.completeAssistantTurn({
    conversationId: job.conversationId,
    assistantTurnId: job.assistantTurnId,
    runId: job.runId,
    title: turn.title,
    content: turn.content,
    status: "completed",
  });
}

function assistantTurnFromResponse(
  response: PanelRunJobResponse
): { readonly title: string; readonly content: string } {
  const canvas = response.canvas;
  if (canvas?.kind === "desktop_agent_canvas" && canvas.agent.answer !== undefined) {
    return {
      title: canvas.agent.pendingConfirmation === undefined ? "已完成" : "需要确认",
      content: sanitizeAssistantVisibleText(canvas.agent.answer.answer),
    };
  }
  if (canvas?.kind === "desktop_agent_canvas" && canvas.agent.pendingConfirmation !== undefined) {
    return {
      title: "需要确认",
      content: sanitizeAssistantVisibleText(`${canvas.agent.pendingConfirmation.question}\n${canvas.agent.pendingConfirmation.consequence}`),
    };
  }
  if (canvas?.kind === "work_session_canvas" && canvas.workSession.directAnswer !== undefined) {
    return {
      title: "已回答",
      content: sanitizeAssistantVisibleText(canvas.workSession.directAnswer.answer),
    };
  }
  if (canvas?.kind === "work_session_canvas" && canvas.workSession.report !== undefined) {
    const report = canvas.workSession.report;
    const summary = report.decisionSummary.trim().length > 0 ? report.decisionSummary : `已生成：${report.title}`;
    const nextAction = report.nextActions[0];
    return {
      title: "结果已生成",
      content: sanitizeAssistantVisibleText(nextAction === undefined ? summary : `${summary}\n下一步：${nextAction}`),
    };
  }
  if (canvas?.kind === "underground_deep_canvas") {
    const summary = canvas.underground.recommendedDirection.reason.trim().length > 0
      ? canvas.underground.recommendedDirection.reason
      : canvas.underground.convergenceSummary;
    const uncertainty = canvas.underground.uncertainty[0];
    return {
      title: canvas.underground.status === "approved_package_created" ? "方向已形成" : "深度模式已停止",
      content: sanitizeAssistantVisibleText(uncertainty === undefined ? summary : `${summary}\n不确定性：${uncertainty}`),
    };
  }
  return {
    title: "结果已生成",
    content: "结果已经整理完成。",
  };
}

function syncPanelRunStreamEventsForJob(runtime: PanelRuntime, job: PanelRunJob): readonly PanelRunStreamEvent[] {
  const derived = createPanelRunStreamEvents({
    runId: job.runId,
    status: job.status,
    eventEntries: job.runtime?.eventLog.list() ?? [],
    summary: job.completed?.summary ?? job.failed?.summary,
    observation: job.completed?.observation,
    routeDecision: job.routeDecision,
    desktopMode: job.runKind === "desktop" ? job.runMode : undefined,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    error: job.failed?.error ?? job.cancelled?.reason ?? job.blocked?.reason,
  });
  return runtime.runJobs.syncStreamEvents(job.runId, derived);
}

function basicRunFromSnapshot(snapshot: RuntimeRunSnapshot): BasicAgentRun {
  const status = agentTaskStatusFromSnapshot(snapshot);
  const events = restoredBasicEvents(snapshot);
  const latestEvent = [...events].reverse().find((event) => event.summary !== undefined);
  const persisted = snapshot.basicRun;
  return {
    runId: persisted?.runId ?? snapshot.run.runId,
    conversationId: persisted?.conversationId ?? snapshot.run.conversationId,
    title: basicRunTitleFromStatus(status, snapshot.run.resultTitle),
    goalSummary: persisted?.goalSummary ?? snapshot.run.goalSummary,
    status,
    runMode: persisted?.runMode ?? snapshot.run.runMode,
    createdAt: persisted?.createdAt ?? snapshot.run.createdAt,
    updatedAt: persisted?.updatedAt ?? snapshot.run.updatedAt,
    currentStep: status === "blocked" && snapshot.run.status === "running"
      ? "运行已中断，需要重新发起或继续处理。"
      : latestEvent?.summary ?? persisted?.currentStep,
    nextStep: basicRunNextStepFromStatus(status),
    requiresUserAction: status === "approval_needed" || status === "blocked" || status === "needs_input",
    eventCursor: {
      lastSequence: events.at(-1)?.sequence ?? 0,
      eventCount: events.length,
    },
  };
}

function agentTaskStatusFromRuntimeStatus(status: RuntimeRunRecord["status"]): BasicAgentRun["status"] {
  if (status === "pending") return "queued";
  if (status === "running" || status === "stopped") return "blocked";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "blocked") return "blocked";
  return "failed";
}

function agentTaskStatusFromSnapshot(snapshot: RuntimeRunSnapshot): BasicAgentRun["status"] {
  const denied = snapshot.confirmations.some((confirmation) => confirmation.status === "denied");
  if (denied) {
    return "blocked";
  }
  const guidance = snapshot.confirmations.some((confirmation) => confirmation.status === "guidance");
  if (guidance) {
    return "needs_input";
  }
  const pendingConfirmation = snapshot.confirmations.some((confirmation) => confirmation.status === "pending");
  if (pendingConfirmation && snapshot.run.status !== "failed" && snapshot.run.status !== "cancelled" && snapshot.run.status !== "blocked") {
    return "approval_needed";
  }
  return agentTaskStatusFromRuntimeStatus(snapshot.run.status);
}

function basicRunTitleFromStatus(status: BasicAgentRun["status"], resultTitle: string | undefined): string {
  if (resultTitle !== undefined && resultTitle.trim().length > 0) {
    return compactRuntimeText(resultTitle, 120);
  }
  if (status === "queued") return "等待开始";
  if (status === "approval_needed") return "需要确认";
  if (status === "needs_input") return "需要补充";
  if (status === "blocked") return "需要处理";
  if (status === "cancelled") return "已取消";
  if (status === "failed") return "未完成";
  if (status === "completed") return "已完成";
  return "正在处理";
}

function basicRunNextStepFromStatus(status: BasicAgentRun["status"]): string | undefined {
  if (status === "queued") return "等待前一个任务完成。";
  if (status === "approval_needed") return "等待你确认或补充材料。";
  if (status === "needs_input") return "等待你补充指导后继续。";
  if (status === "blocked") return "运行已中断，需要重新发起或继续处理。";
  if (status === "running" || status === "planning") return "继续整理结果。";
  return undefined;
}

function appendLiveModelOutputDelta(runtime: PanelRuntime, runId: string, delta: ModelOutputDelta): void {
  if (delta.delta.length === 0) {
    return;
  }
  const job = runtime.runJobs.get(runId);
  if (job === undefined) {
    return;
  }
  const purpose = delta.purpose ?? modelPurposeForRequest(job, delta.requestId);
  if (!isUserFacingStreamingPurpose(purpose)) {
    return;
  }
  runtime.runJobs.appendStreamEvent(runId, {
    eventId: `${runId}:live:model.output.delta:${delta.requestId}:${delta.index}`,
    runId,
    type: "model.output.delta",
    createdAt: delta.createdAt,
    agentLabel: "助手",
    delta: delta.delta,
    status: "running",
    sourceRefs: [],
    modelCallRefs: [delta.requestId],
    toolCallRefs: [],
  });
}

function modelPurposeForRequest(job: PanelRunJob, requestId: string): string | undefined {
  const requested = job.runtime?.eventLog.list().find((entry) => {
    if (entry.type !== "model.requested") {
      return false;
    }
    return optionalString(asRecord(entry.message.payload).requestId) === requestId;
  });
  return requested === undefined ? undefined : optionalString(asRecord(requested.message.payload).purpose);
}

function isUserFacingStreamingPurpose(purpose: string | undefined): boolean {
  return purpose === "desktop_agent" || purpose === "desktop_chat" || purpose === "work_session_direct_answer";
}

async function runForPanel(
  runtime: PanelRuntime,
  runKind: PanelRunKind,
  goal: string,
  aiMode: UndergroundAiMode,
  taskSoilInput: DesktopTaskSoilInput | undefined,
  runMode: PanelDesktopRunMode = "agent",
  options: PanelRunExecutionOptions = {}
): Promise<PanelRunExecutionResult> {
  throwIfAborted(options.abortSignal);
  return runKind === "desktop"
    ? runDesktopForPanel(runtime, goal, aiMode, taskSoilInput, runMode, options)
    : runUndergroundForPanel(runtime, goal, aiMode, options);
}

async function runDesktopForPanel(
  runtime: PanelRuntime,
  goal: string,
  aiMode: UndergroundAiMode,
  taskSoilInput: DesktopTaskSoilInput | undefined,
  runMode: PanelDesktopRunMode,
  options: PanelRunExecutionOptions = {}
): Promise<PanelRunExecutionResult> {
  throwIfAborted(options.abortSignal);
  if (aiMode === "none") {
    throw createUndergroundAiDisabledConfigurationError();
  }

  const aiEnvironment = await runtime.configCenter.createUndergroundAiEnvironment();
  const aiConfig =
    aiMode === "fake"
      ? createUndergroundAiRuntimeConfig({ mode: "fake", env: aiEnvironment, onModelOutputDelta: options.onModelOutputDelta })
      : createUndergroundAiRuntimeConfig({
          mode: "openai-compatible",
          env: aiEnvironment,
          fetch: runtime.providerFetch,
          onModelOutputDelta: options.onModelOutputDelta,
        });

  if (!aiConfig.enabled) {
    throw createUndergroundAiDisabledConfigurationError(aiConfig.summaryInput);
  }

  const workspaceRoot = (await runtime.configCenter.getWorkspaceConfig()).workspaceDirectory;
  if (runMode === "deep") {
    const createToolCenter = await createConfiguredToolCenterFactory(runtime.configCenter, {
      fetch: runtime.providerFetch,
      workspaceRoot,
    });
    throwIfAborted(options.abortSignal);
    const result = await runUndergroundDirectionSessionWithIntelligence(goal, {
      createIntelligenceChannel: aiConfig.createIntelligenceChannel,
      createToolCenter,
      onRuntimeReady: options.onRuntimeReady,
    });
    throwIfAborted(options.abortSignal);
    const summary = createUndergroundDemoSummary(result, undefined, aiConfig.summaryInput);
    const observation = toPanelObservation(result.observationSnapshot);
    const eventEntries = result.runtime.eventLog.list();
    const transcript = createPanelRunTranscript({
      runId: result.traceId,
      status: "completed",
      eventEntries,
      summary,
      observation,
      agentRunTree: result.undergroundOrchestratorRun.agentRunTree,
      desktopMode: "deep",
      createdAt: eventEntries[0]?.recordedAt ?? new Date(0).toISOString(),
      updatedAt: eventEntries.at(-1)?.recordedAt ?? new Date(0).toISOString(),
    });

    return {
      summary,
      observation,
      eventEntries,
      agentRunTree: result.undergroundOrchestratorRun.agentRunTree,
      canvas: createUndergroundDeepCanvas({
        result,
        transcript,
      }),
    };
  }

  const agent = await runDesktopAgentSession(goal, {
    aiMode,
    createIntelligenceChannel: aiConfig.createIntelligenceChannel,
    createToolCenter: await createConfiguredToolCenterFactory(runtime.configCenter, {
      fetch: runtime.providerFetch,
      workspaceRoot,
    }),
    taskSoilInput,
    conversationHistory: options.conversationHistory,
    skillContexts: await resolveTriggeredSkillContexts(runtime, goal),
    abortSignal: options.abortSignal,
    onRuntimeReady: options.onRuntimeReady,
    onModelOutputDelta: options.onModelOutputDelta,
    allowWorkSessionUpgrade: false,
  });
  return desktopPanelResultFromAgent(agent);
}

function desktopPanelResultFromAgent(
  agent: Awaited<ReturnType<typeof runDesktopAgentSession>>
): PanelRunExecutionResult {
  if (agent.status === "completed" || agent.status === "confirmation_needed") {
    const eventEntries = agent.runtime.eventLog.list();
    const transcript = createPanelRunTranscript({
      runId: agent.traceId,
      status: "completed",
      eventEntries,
      desktopMode: "agent",
      createdAt: eventEntries[0]?.recordedAt ?? new Date(0).toISOString(),
      updatedAt: eventEntries.at(-1)?.recordedAt ?? new Date(0).toISOString(),
    });
    return {
      eventEntries,
      canvas: createDesktopAgentCanvas({
        result: agent,
        transcript,
      }),
      pendingApproval:
        agent.pendingApproval === undefined
          ? undefined
          : {
              confirmationId: agent.pendingApproval.confirmationId,
              resume: async (resumeInput) => {
                const resumed = await agent.pendingApproval!.resume(resumeInput);
                return desktopPanelResultFromAgent(resumed);
              },
            },
    };
  }

  throw new PanelHttpError(500, "desktop_agent_failed", agent.failureMessage ?? "桌面 Agent 没有形成结果。");
}

async function resolveTriggeredSkillContexts(
  runtime: PanelRuntime,
  goal: string
): Promise<readonly DesktopAgentSkillContext[]> {
  const skills = await discoverSkills({ roots: runtime.skillRoots, stateStore: runtime.skillStateStore });
  const triggered = selectTriggeredSkills(goal, skills, 4);
  const contexts = await Promise.all(triggered.map(async (skill): Promise<DesktopAgentSkillContext> => {
    const body = await loadSkillBody(skill);
    await runtime.skillStateStore?.markUsed(skill.id);
    return {
      skill,
      body,
      triggerReason: skill.triggers.length === 0
        ? "技能名称或描述匹配当前任务。"
        : `触发词：${skill.triggers.join(" / ")}`,
    };
  }));
  return contexts;
}

async function runUndergroundForPanel(
  runtime: PanelRuntime,
  goal: string,
  aiMode: UndergroundAiMode,
  options: PanelRunExecutionOptions = {}
): Promise<PanelRunExecutionResult> {
  throwIfAborted(options.abortSignal);
  if (aiMode === "none") {
    throw createUndergroundAiDisabledConfigurationError();
  }

  const aiEnvironment = await runtime.configCenter.createUndergroundAiEnvironment();
  const aiConfig =
    aiMode === "fake"
      ? createUndergroundAiRuntimeConfig({ mode: "fake", env: aiEnvironment, onModelOutputDelta: options.onModelOutputDelta })
      : createUndergroundAiRuntimeConfig({
          mode: "openai-compatible",
          env: aiEnvironment,
          fetch: runtime.providerFetch,
          onModelOutputDelta: options.onModelOutputDelta,
        });

  if (!aiConfig.enabled) {
    throw createUndergroundAiDisabledConfigurationError(aiConfig.summaryInput);
  }

  const workspaceRoot = (await runtime.configCenter.getWorkspaceConfig()).workspaceDirectory;
  const createToolCenter = await createConfiguredToolCenterFactory(runtime.configCenter, {
    fetch: runtime.providerFetch,
    workspaceRoot,
  });
  throwIfAborted(options.abortSignal);
  const result = await runUndergroundDirectionSessionWithIntelligence(goal, {
    createIntelligenceChannel: aiConfig.createIntelligenceChannel,
    createToolCenter,
    onRuntimeReady: options.onRuntimeReady,
  });
  throwIfAborted(options.abortSignal);
  const summary = createUndergroundDemoSummary(result, undefined, aiConfig.summaryInput);
  return {
    summary,
    observation: toPanelObservation(result.observationSnapshot),
    eventEntries: result.runtime.eventLog.list(),
  };
}

function createConfigurationFailedAiSummary(
  input: UndergroundDemoAiInput,
  error: UndergroundAiConfigurationError,
  message: string
): UndergroundDemoSummary["ai"] {
  return {
    ...input,
    status: "configuration_failed",
    eventCounts: { requested: 0, completed: 0, failed: 0 },
    aiCandidateCount: 0,
    fallbackCount: 0,
    aiFallbackUsed: false,
    rootletKinds: [],
    modelCallRefs: [],
    configurationError: {
      code: error.issue.code,
      message,
    },
  };
}

function parseConfigUpdate(raw: unknown): UpdateModelProviderConfigInput {
  const record = asRecord(raw);
  return {
    baseUrl: optionalString(record.baseUrl),
    model: optionalString(record.model),
    defaultAiMode: parseOptionalAiMode(record.defaultAiMode, "默认 AI 模式无效。"),
    apiKey: optionalString(record.apiKey),
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new PanelHttpError(499, "run_cancelled", "运行已取消。");
  }
}

function parseWorkspaceUpdate(raw: unknown): UpdateWorkspaceConfigInput {
  const record = asRecord(raw);
  const workspaceDirectory = optionalString(record.workspaceDirectory);
  if (workspaceDirectory === undefined) {
    throw new PanelHttpError(400, "missing_workspace_directory", "工作目录不能为空。");
  }
  return { workspaceDirectory };
}

function parseInformationAccessUpdate(raw: unknown): UpdateInformationAccessConfigInput {
  const record = asRecord(raw);
  return {
    tavilyApiKey: optionalString(record.tavilyApiKey),
    tavilyMaxResults: numberOrUndefined(record.tavilyMaxResults),
    sourcePreference: informationSourcePreferenceOrUndefined(record.sourcePreference),
  };
}

function parseWebSearchUpdate(raw: unknown): UpdateWebSearchConfigInput {
  const record = asRecord(raw);
  return {
    provider: parseOptionalWebSearchProvider(record.provider),
    apiKey: optionalString(record.apiKey),
    tavilyApiKey: optionalString(record.tavilyApiKey),
    maxResults: numberOrUndefined(record.maxResults),
    tavilyMaxResults: numberOrUndefined(record.tavilyMaxResults),
  };
}

function parseOptionalWebSearchProvider(value: unknown): UpdateWebSearchConfigInput["provider"] {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value === "tavily" || value === "none") {
    return value;
  }
  throw new PanelHttpError(400, "invalid_web_search_provider", "搜索工具 provider 无效。");
}

function informationSourcePreferenceOrUndefined(
  value: unknown
): UpdateInformationAccessConfigInput["sourcePreference"] {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const sources = value.filter(isInformationSourceKind);
  return sources.length === 0 ? undefined : [...new Set(sources)];
}

function parseRunInput(raw: unknown, defaultAiMode: UndergroundAiMode): {
  readonly goal: string;
  readonly aiMode: UndergroundAiMode;
  readonly runMode: PanelDesktopRunMode;
  readonly taskSoilInput?: DesktopTaskSoilInput;
} {
  const record = asRecord(raw);
  const goal = optionalString(record.goal);
  if (goal === undefined) {
    throw new PanelHttpError(400, "missing_goal", "运行需要填写目标。");
  }
  let taskSoilInput: DesktopTaskSoilInput;
  try {
    taskSoilInput = parseDesktopTaskSoilInput(raw);
  } catch (error) {
    if (error instanceof TaskSoilInputValidationError) {
      throw new PanelHttpError(400, error.code, error.message);
    }
    throw error;
  }
  return {
    goal,
    aiMode: parseOptionalAiMode(record.aiMode, "AI 模式无效。") ?? defaultAiMode,
    runMode: parseOptionalDesktopRunMode(record.runMode) ?? "agent",
    taskSoilInput,
  };
}

function parseOptionalDesktopRunMode(value: unknown): PanelDesktopRunMode | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value === "agent" || value === "deep") {
    return value;
  }
  if (value === "work_session") {
    return "deep";
  }
  throw new PanelHttpError(400, "invalid_run_mode", "运行模式无效。");
}

function defaultAiModeForRunKind(runKind: PanelRunKind, configuredDefault: UndergroundAiMode): UndergroundAiMode {
  return runKind === "desktop" ? "openai-compatible" : configuredDefault;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of request) {
    raw += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    if (raw.length > 128_000) {
      throw new PanelHttpError(413, "request_body_too_large", "面板请求体过大。");
    }
  }
  if (raw.trim().length === 0) {
    return {};
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new PanelHttpError(400, "invalid_json", "请求 JSON 格式无效。");
  }
}

function writeHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'",
  });
  response.end(html);
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`${JSON.stringify(body)}\n`);
}

function writeSseEvent(response: ServerResponse, event: PanelRunStreamEvent): void {
  response.write(`id: ${event.sequence}\n`);
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function writePanelError(response: ServerResponse, error: PanelHttpError, extra?: Record<string, unknown>): void {
  writeJson(response, error.statusCode, {
    ok: false,
    status: "failed",
    ...extra,
    error: {
      code: error.code,
      message: error.message,
    },
  });
}

function parseOptionalAiMode(value: unknown, invalidMessage: string): UndergroundAiMode | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = parseAiMode(value);
  if (parsed === undefined) {
    throw new PanelHttpError(400, "invalid_ai_mode", invalidMessage);
  }
  return parsed;
}

function parseStreamCursor(queryValue: string | null, lastEventId: string | string[] | undefined): number {
  const raw = queryValue ?? (Array.isArray(lastEventId) ? lastEventId[0] : lastEventId);
  const parsed = raw === undefined ? 0 : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function parseAiMode(value: unknown): UndergroundAiMode | undefined {
  if (value === "none" || value === "fake" || value === "openai-compatible") {
    return value;
  }
  return undefined;
}

function panelConfigurationErrorMessage(code: UndergroundAiConfigurationError["issue"]["code"]): string {
  if (code === "ai_disabled") {
    return "Underground Cognitive Runtime 方向智能阶段需要 AI；AI 禁用模式只作为边界检查，未启动运行。";
  }
  if (code === "missing_api_key") {
    return "OpenAI-compatible 模式缺少 API key，已在发起网络请求前停止。";
  }
  return "OpenAI-compatible 模式缺少模型名，已在发起网络请求前停止。";
}

function latestModelFailureMessage(eventEntries: readonly EventLogEntry[]): string | undefined {
  const latestFailure = [...eventEntries].reverse().find((entry) => entry.type === "model.failed");
  if (latestFailure === undefined) {
    return undefined;
  }
  const failurePayload = asRecord(latestFailure.message.payload);
  const requestId = optionalString(failurePayload.requestId);
  const responseId = optionalString(failurePayload.responseId);
  const requestedPayload = requestId === undefined ? {} : modelRequestedPayloadFor(eventEntries, requestId);
  const purpose = optionalString(requestedPayload.purpose) ?? "unknown purpose";
  const outputContract = asRecord(requestedPayload.outputContract);
  const contractId = optionalString(outputContract.contractId) ?? "unknown contract";
  const failureKind = optionalString(failurePayload.failureKind) ?? "model_failed";
  const validationStatus = optionalString(failurePayload.validationStatus) ?? "unknown";
  const retryable = failurePayload.retryable === true ? "可重试" : "不可重试";
  const callRef = [requestId, responseId].filter((value): value is string => value !== undefined).join(" / ");
  const location = callRef.length > 0 ? `；调用 ${callRef}` : "";

  if (failureKind === "output_validation") {
    return `真实 AI 输出未通过契约校验：${purpose} / ${contractId}；validation ${validationStatus}，${retryable}${location}。运行已停止，没有生成 completed artifact。`;
  }
  return `真实 AI 调用失败：${purpose} / ${contractId}；原因 ${failureKind}，validation ${validationStatus}，${retryable}${location}。运行已停止，没有生成 completed artifact。`;
}

function modelRequestedPayloadFor(eventEntries: readonly EventLogEntry[], requestId: string): Record<string, unknown> {
  const requested = eventEntries.find((entry) => {
    if (entry.type !== "model.requested") {
      return false;
    }
    return optionalString(asRecord(entry.message.payload).requestId) === requestId;
  });
  return requested === undefined ? {} : asRecord(requested.message.payload);
}

function runNotFoundMessage(runKind: PanelRunKind): string {
  return runKind === "desktop" ? "未找到 Desktop Shell 运行 job。" : "未找到地下兼容运行 job。";
}

function routeReadModel(decision: DesktopIntentDecision | undefined): PanelDesktopRouteReadModel | undefined {
  if (decision === undefined) {
    return undefined;
  }
  const explanation = explainDesktopIntentDecision(decision);
  return {
    route: decision.route,
    reason: decision.reason,
    title: explanation.title,
    summary: explanation.summary,
  };
}

function canvasTraceId(canvas: PanelRunCanvasReadModel | undefined): string | undefined {
  if (canvas === undefined) {
    return undefined;
  }
  if (canvas.kind === "underground_deep_canvas") {
    return canvas.task.traceId;
  }
  return canvas.taskSoil.traceId;
}

function compactRuntimeText(value: string, maxLength: number): string {
  const normalized = redactSensitiveText(sanitizeAssistantVisibleText(value))
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function buildConversationHistoryMessages(
  runtime: PanelRuntime,
  conversationId: string | undefined,
  assistantTurnId: string | undefined
): readonly DesktopAgentConversationMessage[] {
  if (conversationId === undefined) {
    return [];
  }
  const conversation = runtime.conversations.get(conversationId);
  if (conversation === undefined) {
    return [];
  }
  const assistantIndex =
    assistantTurnId === undefined
      ? conversation.turns.length
      : conversation.turns.findIndex((turn) => turn.turnId === assistantTurnId);
  if (assistantTurnId !== undefined && assistantIndex < 0) {
    return [];
  }
  const currentUserIndex =
    assistantIndex > 0 && conversation.turns[assistantIndex - 1]?.role === "user"
      ? assistantIndex - 1
      : assistantIndex;
  const historyTurns = conversation.turns
    .slice(0, currentUserIndex)
    .filter((turn) => turn.status !== "pending" && turn.status !== "running")
    .map((turn): DesktopAgentConversationMessage | undefined => {
      const content = compactConversationHistoryText(sanitizeConversationHistoryText(turn.content), 1_200);
      if (content.length === 0) {
        return undefined;
      }
      return {
        role: turn.role,
        content,
        ref: `conversation:${conversation.conversationId}:turn:${turn.turnId}`,
      };
    })
    .filter((message): message is DesktopAgentConversationMessage => message !== undefined);
  return historyTurns.slice(-8);
}

function friendlyAssistantFailureText(message: string | undefined): string {
  return friendlyUserFacingFailureText(message);
}

function panelJobErrorMessage(error: PanelHttpError): string {
  if (error.code === "desktop_agent_failed" || error.code === "desktop_chat_failed" || error.statusCode >= 500) {
    return friendlyUserFacingFailureText(error.message);
  }
  return error.message;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function compactConversationHistoryText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isInformationSourceKind(
  value: unknown
): value is NonNullable<UpdateInformationAccessConfigInput["sourcePreference"]>[number] {
  return (
    value === "web" ||
    value === "page" ||
    value === "codebase" ||
    value === "soil" ||
    value === "run_memory" ||
    value === "docs" ||
    value === "packages" ||
    value === "github"
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function isPanelRuntime(value: PanelServerOptions | PanelRuntime): value is PanelRuntime {
  return (
    value.configCenter instanceof ConfigCenter &&
    "runJobs" in value &&
    value.runJobs instanceof PanelRunJobStore &&
    "activeRunJobs" in value &&
    value.activeRunJobs instanceof Set
  );
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function closePanelServer(server: Server, runtime: PanelRuntime): Promise<void> {
  await close(server);
  await waitForPanelRuntimeIdle(runtime);
  await waitForPanelPersistenceIdle(runtime);
}

async function waitForPanelRuntimeIdle(runtime: PanelRuntime): Promise<void> {
  while (runtime.activeRunJobs.size > 0) {
    await Promise.allSettled([...runtime.activeRunJobs]);
  }
}

async function waitForPanelPersistenceIdle(runtime: PanelRuntime): Promise<void> {
  while (runtime.persistenceChains.size > 0) {
    await Promise.allSettled([...runtime.persistenceChains.values()]);
  }
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
