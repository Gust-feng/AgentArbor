import type { IncomingMessage, ServerResponse } from "node:http";
import {
  ModelRuntimeConfigurationError,
} from "../model-runtime/index.js";
import type { RuntimeRunSnapshot } from "../../domain/runtime-database/index.js";
import type { PanelRunJob, PanelRunKind } from "./run-jobs.js";
import { getPanelConversation } from "./conversation-routes.js";
import {
  PanelHttpError,
  readJsonBody,
  writeJson,
  writePanelError,
} from "./http-utils.js";
import { serveRunEventSse } from "./run-event-sse.js";
import { createPersistedPanelRunResponse } from "./persisted-run-response.js";
import { createPanelUsageStatistics } from "./panel-usage-statistics.js";
import type { PanelRunStreamEvent } from "../panel-read-model/run/panel-run-stream-contracts.js";
import { parseRunInput } from "./request-parsers.js";
import { projectRunEnvelopeViewBase } from "../run-read-model/envelope.js";
import { projectSharedRunSummaryBase } from "../run-read-model/summary.js";
import {
  createPanelRunResponse,
  createConfigurationFailedAiSummary,
  panelConfigurationErrorMessage,
  runForPanel,
  type PanelRunResponse,
} from "./run-execution.js";
import { createPanelRunJobResponse, type PanelRunJobResponse } from "./run-job-response.js";
import { resolvePanelRouteRunMode } from "./run-mode-routing.js";
import { isTerminalPanelRunStatus } from "./runtime-records.js";
import type { PanelRuntime } from "./runtime.js";
import { appRunEventsAfterSequence } from "../run-runtime-core/event-stream.js";

export type RuntimeRunSummaryView = ReturnType<typeof projectRuntimeRunSummary>;

export type RuntimeRunListResponse = {
  readonly ok: true;
  readonly runs: readonly RuntimeRunSummaryView[];
};

export async function handlePanelRunRoute(
  runtime: PanelRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL
): Promise<boolean> {
  // ── 废弃候选（T3-5 / ADR-0025 deep 一期）──────────────────────────────────
  // 正式 deep HTTP 入口为 /api/deep/*（见 src/app/panel-server/deep-routes.ts）：
  //   POST /api/deep/conversations + POST /api/deep/conversations/:id/runs +
  //   GET /api/deep/conversations/:id/runs/:runId/view + SSE + control。
  // 下列 /api/underground/* 兼容路由驱动旧 UndergroundAgentOrchestrator 固定拓扑
  // （与 directionHandoffPackage / Plan 强耦合），非正式 DeepRuntime。
  // 退役前置 = 调用方迁移到 /api/deep/* + 等价能力验证完成（闭环4）。当前保持运行不阻塞。
  // ──────────────────────────────────────────────────────────────────────────
  if (request.method === "POST" && url.pathname === "/api/underground/run") {
    await handleRunRequest(runtime, request, response, "underground");
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/underground/runs") {
    await handleStartRunRequest(runtime, request, response, "underground");
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/desktop/runs") {
    await handleStartRunRequest(runtime, request, response, "desktop");
    return true;
  }

  const runMatch = /^\/api\/underground\/runs\/([^/]+)$/.exec(url.pathname);
  if (request.method === "GET" && runMatch !== null) {
    await handleGetRunRequest(runtime, decodeURIComponent(runMatch[1] ?? ""), "underground", response);
    return true;
  }

  const desktopRunMatch = /^\/api\/desktop\/runs\/([^/]+)$/.exec(url.pathname);
  if (request.method === "GET" && desktopRunMatch !== null) {
    await handleGetRunRequest(runtime, decodeURIComponent(desktopRunMatch[1] ?? ""), "desktop", response);
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/runtime/runs") {
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const runs = ((await runtime.runtimeDatabase?.listRuns(Number.isFinite(limit) ? limit : 50)) ?? []).map((run) =>
      projectRuntimeRunSummary(run)
    );
    writeJson(response, 200, {
      ok: true,
      runs,
    } satisfies RuntimeRunListResponse);
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/runtime/usage-statistics") {
    writeJson(response, 200, await createPanelUsageStatistics({ runtimeDatabase: runtime.runtimeDatabase }));
    return true;
  }

  const runtimeRunMatch = /^\/api\/runtime\/runs\/([^/]+)$/.exec(url.pathname);
  if (request.method === "GET" && runtimeRunMatch !== null) {
    const runId = decodeURIComponent(runtimeRunMatch[1] ?? "");
    if (isTerminalPanelRunStatus(runtime.runJobs.get(runId)?.status ?? "running")) {
      await runtime.runExecutor.waitForTerminalCommit(runId);
    }
    const snapshot = await runtime.runtimeDatabase?.getRun(runId);
    if (snapshot === undefined) {
      throw new PanelHttpError(404, "run_not_found", "未找到持久化运行记录。");
    }
    writeJson(response, 200, await createPersistedRunResponse(runtime, snapshot));
    return true;
  }

  const runStreamMatch = /^\/api\/underground\/runs\/([^/]+)\/stream$/.exec(url.pathname);
  if (request.method === "GET" && runStreamMatch !== null) {
    handleGetRunStreamRequest(runtime, decodeURIComponent(runStreamMatch[1] ?? ""), "underground", url, request, response);
    return true;
  }

  const desktopRunStreamMatch = /^\/api\/desktop\/runs\/([^/]+)\/stream$/.exec(url.pathname);
  if (request.method === "GET" && desktopRunStreamMatch !== null) {
    handleGetRunStreamRequest(runtime, decodeURIComponent(desktopRunStreamMatch[1] ?? ""), "desktop", url, request, response);
    return true;
  }

  return false;
}

async function handleRunRequest(
  runtime: PanelRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  runKind: PanelRunKind
): Promise<void> {
  if (runKind === "desktop") {
    throw new PanelHttpError(
      400,
      "desktop_sync_run_not_supported",
      "Desktop 默认运行入口必须创建异步普通 agent run。"
    );
  }
  const body = await readJsonBody(request);
  const config = await runtime.configCenter.getModelProviderConfig();
  const informationAccess = await runtime.configCenter.getInformationAccessConfig();
  const runInput = parseRunInput(body);
  const runMode = resolveRunModeForRoute(runKind, runInput.requestedRunMode);
  const aiMode = runInput.aiMode ?? config.defaultAiMode;

  try {
    // Legacy synchronous underground route. Desktop routes must use
    // BasicAgentRunExecutor.start so run birth facts are frozen before execution.
    const run = await runForPanel(runtime, runKind, runInput.goal, aiMode, runInput.taskSoilInput, runMode, {
      config,
      informationAccess,
      reasoningEffort: runInput.reasoningEffort,
    });
    writeJson(response, 200, await createPanelRunResponse({
      runtime,
      runKind,
      runMode,
      requestedMode: aiMode,
      reasoningEffort: runInput.reasoningEffort,
      run,
    }) satisfies PanelRunResponse);
  } catch (error) {
    if (error instanceof ModelRuntimeConfigurationError) {
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
  const runInput = parseRunInput(body);
  const runMode = resolveRunModeForRoute(runKind, runInput.requestedRunMode);
  const basicRun = await runtime.runExecutor.start({
    runKind,
    runMode,
    goal: runInput.goal,
    aiMode: runInput.aiMode,
    taskSoilInput: runInput.taskSoilInput,
    workspaceDirectory: runInput.workspaceDirectory,
    reasoningEffort: runInput.reasoningEffort,
    toolConfirmationPolicy: runInput.toolConfirmationPolicy,
    modelOverride: runInput.modelOverride,
    deferSchedule: true,
  });
  const job = requirePanelRunJob(runtime, basicRun.runId);

  writeJson(response, 202, createPanelRunJobResponse(runtime, job));
  runtime.runExecutor.schedule(job.runId);
}

function requirePanelRunJob(runtime: PanelRuntime, runId: string): PanelRunJob {
  const job = runtime.runJobs.get(runId);
  if (job === undefined) {
    throw new PanelHttpError(404, "run_not_found", "未找到基础 Agent 运行。");
  }
  return job;
}

function projectRuntimeRunSummary(run: RuntimeRunSnapshot["run"]): {
  readonly runId: string;
  readonly status: RuntimeRunSnapshot["run"]["status"];
  readonly runKind: RuntimeRunSnapshot["run"]["runKind"];
  readonly runMode: RuntimeRunSnapshot["run"]["runMode"];
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly goalSummary: string;
  readonly completedAt?: string;
  readonly resultTitle?: string;
  readonly resultSummary?: string;
  readonly conversationId?: string;
  readonly workspacePath?: string;
} {
  return {
    ...projectSharedRunSummaryBase({
      ...projectRunEnvelopeViewBase({
        runId: run.runId,
        status: run.status,
        runKind: run.runKind,
        runMode: run.runMode,
      }),
      startedAt: run.createdAt,
      updatedAt: run.updatedAt,
    }),
    goalSummary: run.goalSummary,
    completedAt: run.completedAt,
    resultTitle: run.resultTitle,
    resultSummary: run.resultSummary,
    conversationId: run.conversationId,
    workspacePath: run.workspacePath,
  };
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
      await runtime.runExecutor.waitForTerminalCommit(runId);
    }
    writeJson(response, 200, createPanelRunJobResponse(runtime, runtime.runJobs.get(runId) ?? job));
    return;
  }
  const snapshot = await runtime.runtimeDatabase?.getRun(runId);
  if (snapshot === undefined || snapshot.run.runKind !== expectedRunKind) {
    throw new PanelHttpError(404, "run_not_found", runNotFoundMessage());
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
    throw new PanelHttpError(404, "run_not_found", runNotFoundMessage());
  }

  serveRunEventSse<PanelRunStreamEvent>({
    request,
    response,
    url,
    comment: `AgentArbor panel run stream ${runId}`,
    poll: (lastSequence) => {
      const current = runtime.runJobs.get(runId);
      if (current === undefined) {
        return {
          terminal: true,
          events: [
            {
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
            },
          ],
        };
      }
      return {
        events: appRunEventsAfterSequence(current.streamEvents, lastSequence),
        terminal: isTerminalPanelRunStatus(current.status),
      };
    },
  });
}

async function createPersistedRunResponse(
  runtime: PanelRuntime,
  snapshot: RuntimeRunSnapshot
): Promise<PanelRunJobResponse> {
  const config =
    snapshot.run.capabilitySnapshot?.activeModel ??
    await runtime.configCenter.getModelProviderConfig();
  const informationAccess =
    snapshot.run.informationAccess ??
    await runtime.configCenter.getInformationAccessConfig();
  const conversation =
    snapshot.run.conversationId === undefined
      ? undefined
      : await getPanelConversation(runtime, snapshot.run.conversationId);
  return createPersistedPanelRunResponse({
    snapshot,
    config,
    informationAccess,
    conversation,
  });
}

function runNotFoundMessage(): string {
  return "未找到运行。";
}

function resolveRunModeForRoute(
  runKind: PanelRunKind,
  requestedRunMode: PanelRunJobResponse["runMode"] | undefined
): PanelRunJobResponse["runMode"] {
  return resolvePanelRouteRunMode({ runKind, requestedRunMode });
}
