/**
 * deep-routes.ts —— 延期的 `/api/deep/*` 重建适配器。
 *
 * 端点族（design §6.1 / §6.3，落地 FR-001 / FR-002 / FR-007 / FR-008）：
 *   POST   /api/deep/conversations              创建独立 deep 会话（携带 workspace 上下文）
 *   GET    /api/deep/conversations              全局最近 deep 会话摘要（含尚未启动 run 的 intake）
 *   GET    /api/deep/conversations/:id          deep 会话详情（用于恢复 intake-only 会话）
 *   POST   /api/deep/conversations/:id/rename   重命名 deep 会话
 *   POST   /api/deep/conversations/:id/pin      置顶/取消置顶 deep 会话
 *   DELETE /api/deep/conversations/:id          删除 deep 会话及其历史 run
 *   POST   /api/deep/conversations/:id/runs     启动 deep run（后台执行，立即返回 runId）
 *   GET    /api/deep/runs                       全局最近 deep runs 摘要（跨会话恢复入口）
 *   GET    /api/deep/conversations/:id/runs     历史复盘（该会话下的 deep runs 摘要）
 *   GET    /api/deep/runs/:runId/view           run tree 投影 + 结论 + 事件 replay
 *   GET    /api/deep/runs/:runId/events         SSE 流式（deep.* 安全投影）
 *   POST   /api/deep/runs/:runId/interrupt      打断（保留已产出材料）
 *   POST   /api/deep/runs/:runId/correct        纠正（携带补充上下文注入下一 manager 决策）
 *   POST   /api/deep/runs/:runId/stop           停止（尝试产出部分结论）
 *
 * 工程要点：
 *   - 当前生产 Panel 不导入也不调用本模块；恢复前必须用独立方案重新装配模型、工具、
 *     确认与持久化边界，不能把历史实现直接接回 Ordinary runtime。
 *   - **EP4（controlHandle 注册表）**：MultiAgentFeature 持有每个在途 run 的控制句柄；
 *     interrupt / correct / stop 端点经其显式查询契约转发到运行侧（T2-7 control point）。
 *   - **隔离边界**：deep 端点与普通 `/api/conversations` / `/api/basic-agent/*` 物理隔离；
 *     内部映射 `runKind="underground"` / `runMode="deep"`，复用 run-mode-policy 门控口径。
 *     默认入口仍普通 agent，deep 仅显式触发，不存在自动升级。
 *   - **SSE 事件模型**：订阅 Multi-Agent feature 的 durable event facade，先订阅再 replay，
 *     只用低频 heartbeat 保持连接；事件不含 raw prompt/response/output。
 *
 * 命名红线：消费 contracts.ts 的 SynthesizedConclusion / DeepExplorationReport；
 * 不引入 Plan / artifact / Fruits。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
// 模型运行时统一入口：ModelRuntimeConfigurationError 经 model-runtime/index.ts
// re-export，禁止 app 层直接 import intelligence-channel-factory（panel-runtime-structure 命名中性约束）。
import { ModelRuntimeConfigurationError } from "../model-runtime/index.js";
import type { ModelRuntimeMode } from "../model-runtime/index.js";
import {
  PanelHttpError,
  parseStreamCursor,
  readJsonBody,
  writeJson,
  writePanelError,
  writeSseEvent,
} from "./http-utils.js";
import { deepConversationRunEnvelope } from "../deep/deep-run-view-base.js";
import type { ConfigCenter } from "../config-center/index.js";
import type {
  DeepChildInstructionQueueResult,
} from "../deep/deep-child-scheduler-contracts.js";
import {
  type DeepChildConfirmationDecision,
} from "../deep/deep-child-agent-runner.js";
import {
  MultiAgentFeatureError,
  type MultiAgentFeature,
  type MultiAgentRunEventUpdate,
} from "../deep/multi-agent-feature.js";
import {
  parseConfirmationDecision,
  parseConversationPinInput,
  parseConversationRenameInput,
  parseDeepChildMessageRequest,
  parseDeepConversationCreateRequest,
  parseDeepIntakeRequest,
  parseDeepRunControlRequest,
  parseDeepRunFollowUpRequest,
  parseDeepRunStartRequest,
} from "./request-parsers.js";
import { parseDeepRunListLimit } from "./deep-route-helpers.js";
import { errorMessage } from "../../kernel/values/index.js";

const DEEP_STREAM_HEARTBEAT_INTERVAL_MS = 15_000;

// ---------------------------------------------------------------------------
// 分发入口
// ---------------------------------------------------------------------------

/**
 * 延期路由分发器。未来重建时可匹配 `/api/deep/` 前缀；当前主分发链不调用它。
 */
/**
 * Kept as a future reconstruction seam. The active Panel runtime deliberately
 * does not satisfy this contract and never calls this route family.
 */
export type DeferredMultiAgentRouteRuntime = {
  readonly configCenter: ConfigCenter;
  readonly multiAgentFeature: MultiAgentFeature;
};

export async function handlePanelDeepRoute(
  runtime: DeferredMultiAgentRouteRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (!url.pathname.startsWith("/api/deep/")) {
    return false;
  }
  const feature = runtime.multiAgentFeature;
  try {
    return await dispatchDeepRoute(runtime, feature, request, response, url);
  } catch (error) {
    let routeError: unknown = error;
    if (error instanceof MultiAgentFeatureError) {
      try {
        mapMultiAgentFeatureError(error);
      } catch (mappedError) {
        routeError = mappedError;
      }
    }
    if (routeError instanceof PanelHttpError) {
      writePanelError(response, routeError);
    } else {
      writePanelError(
        response,
        new PanelHttpError(500, "deep_route_internal_error", errorMessage(routeError)),
      );
    }
    return true;
  }
}

/** 按 pathname + method 分流到各子端点。返回 true 表示已处理。 */
async function dispatchDeepRoute(
  runtime: DeferredMultiAgentRouteRuntime,
  state: MultiAgentFeature,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  const method = request.method ?? "GET";
  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  // segments 形如 ["api", "deep", ...]
  if (segments[0] !== "api" || segments[1] !== "deep") {
    return false;
  }
  const rest = segments.slice(2);

  // POST /api/deep/intake
  if (rest.length === 1 && rest[0] === "intake" && method === "POST") {
    await handleDeepIntake(runtime, state, request, response);
    return true;
  }

  // POST /api/deep/conversations
  if (rest.length === 1 && rest[0] === "conversations" && method === "POST") {
    await handleCreateDeepConversation(state, runtime, request, response);
    return true;
  }

  // GET /api/deep/conversations?limit=50
  if (rest.length === 1 && rest[0] === "conversations" && method === "GET") {
    await handleListDeepConversations(state, response, url);
    return true;
  }

  // GET /api/deep/conversations/:id
  if (rest.length === 2 && rest[0] === "conversations" && method === "GET") {
    await handleGetDeepConversation(state, rest[1], response);
    return true;
  }

  // DELETE /api/deep/conversations/:id
  if (rest.length === 2 && rest[0] === "conversations" && method === "DELETE") {
    await handleDeleteDeepConversation(state, rest[1], response);
    return true;
  }

  // POST /api/deep/conversations/:id/rename
  if (rest.length === 3 && rest[0] === "conversations" && rest[2] === "rename" && method === "POST") {
    await handleRenameDeepConversation(state, request, rest[1], response);
    return true;
  }

  // POST /api/deep/conversations/:id/pin
  if (rest.length === 3 && rest[0] === "conversations" && rest[2] === "pin" && method === "POST") {
    await handlePinDeepConversation(state, request, rest[1], response);
    return true;
  }

  // GET /api/deep/runs?limit=50
  if (rest.length === 1 && rest[0] === "runs" && method === "GET") {
    await handleListAllDeepRuns(state, response, url);
    return true;
  }

  // POST|GET /api/deep/conversations/:id/runs
  if (rest.length === 3 && rest[0] === "conversations" && rest[2] === "runs") {
    const conversationId = rest[1];
    if (method === "POST") {
      await handleStartDeepRun(state, runtime, conversationId, request, response);
    } else if (method === "GET") {
      await handleListDeepRuns(state, conversationId, response);
    } else {
      throw new PanelHttpError(405, "method_not_allowed", "该端点不支持此方法。");
    }
    return true;
  }

  // GET /api/deep/runs/:runId/view
  if (rest.length === 3 && rest[0] === "runs" && rest[2] === "view" && method === "GET") {
    await handleGetDeepRunView(state, rest[1], response);
    return true;
  }

  // GET /api/deep/runs/:runId/events（SSE）
  if (rest.length === 3 && rest[0] === "runs" && rest[2] === "events" && method === "GET") {
    await handleDeepRunEventsSse(state, rest[1], request, response, url);
    return true;
  }

  // POST /api/deep/runs/:runId/children/:childRunId/confirmations/:confirmationId/decision
  if (
    rest.length === 7 &&
    rest[0] === "runs" &&
    rest[2] === "children" &&
    rest[4] === "confirmations" &&
    rest[6] === "decision" &&
    method === "POST"
  ) {
    await handleDeepChildConfirmationDecision(
      state,
      rest[1],
      rest[3],
      rest[5],
      request,
      response,
    );
    return true;
  }

  // POST /api/deep/runs/:runId/children/:childRunId/messages
  if (
    rest.length === 5 &&
    rest[0] === "runs" &&
    rest[2] === "children" &&
    rest[4] === "messages" &&
    method === "POST"
  ) {
    await handleDeepChildParentMessage(state, rest[1], rest[3], request, response);
    return true;
  }

  // POST /api/deep/runs/:runId/resynthesize
  if (rest.length === 3 && rest[0] === "runs" && rest[2] === "resynthesize" && method === "POST") {
    await handleDeepRunResynthesize(state, rest[1], response);
    return true;
  }

  // POST /api/deep/runs/:runId/follow-up
  if (rest.length === 3 && rest[0] === "runs" && rest[2] === "follow-up" && method === "POST") {
    await handleDeepRunFollowUp(runtime, state, rest[1], request, response);
    return true;
  }

  // POST /api/deep/runs/:runId/interrupt|correct|stop
  if (rest.length === 3 && rest[0] === "runs" && method === "POST") {
    const action = rest[2];
    if (action === "interrupt" || action === "correct" || action === "stop") {
      await handleDeepRunControl(state, rest[1], action, request, response);
      return true;
    }
  }

  throw new PanelHttpError(404, "deep_route_not_found", "未找到对应的多 Agent 端点。");
}

// ---------------------------------------------------------------------------
// POST /api/deep/intake —— 先理解目标，再决定追问、直接回答或生成待确认计划
// ---------------------------------------------------------------------------

async function handleDeepIntake(
  runtime: DeferredMultiAgentRouteRuntime,
  state: MultiAgentFeature,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const input = parseDeepIntakeRequest(await readJsonBody(request));
  const aiMode = await resolveDeepAiMode(runtime, input.aiMode);
  if (aiMode === "none") {
    throw new PanelHttpError(
      409,
      "deep_model_not_configured",
      "多 Agent 入口理解需要可用模型，当前未配置 AI 模式。",
    );
  }

  const result = await state.commands.intake({
    aiMode,
    conversationId: input.conversationId,
    activeRunId: input.activeRunId,
    message: input.message,
    taskSoilInput: input.taskSoilInput,
    workspaceDirectory: input.workspaceDirectory,
  }).catch((error: unknown) => mapMultiAgentCommandError(error, "intake"));
  writeJson(response, 200, {
    ok: true,
    status: result.status,
    conversation: result.conversation,
    intake: result.intake,
  });
}

// ---------------------------------------------------------------------------
// T3-1：POST /api/deep/conversations —— 创建独立 deep 会话
// ---------------------------------------------------------------------------

async function handleCreateDeepConversation(
  state: MultiAgentFeature,
  runtime: DeferredMultiAgentRouteRuntime,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const input = parseDeepConversationCreateRequest(await readJsonBody(request));
  const aiMode = await resolveDeepAiMode(runtime, input.aiMode);
  const conversation = await state.commands.createConversation({
    aiMode,
    title: input.title,
    goal: input.goal,
    birthWorkspaceDirectory: input.workspaceDirectory,
    taskSoilInput: input.taskSoilInput,
  });
  writeJson(response, 201, {
    ok: true,
    status: "created",
    conversation,
  });
}

// ---------------------------------------------------------------------------
// T3-1：POST /api/deep/conversations/:id/runs —— 启动 deep run（后台执行）
// ---------------------------------------------------------------------------

async function handleStartDeepRun(
  state: MultiAgentFeature,
  runtime: DeferredMultiAgentRouteRuntime,
  conversationId: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const input = parseDeepRunStartRequest(await readJsonBody(request));
  const aiMode = await resolveDeepAiMode(runtime, input.aiMode);
  const started = await state.commands.startRun({
    conversationId,
    aiMode,
    intakeTurnId: input.intakeTurnId,
    confirmedObjective: input.confirmedObjective,
    confirmedPlan: input.confirmedPlan,
    parentRunId: input.parentRunId,
    workspaceDirectory: input.workspaceDirectory,
  }).catch((error: unknown) => mapMultiAgentCommandError(error, "run"));

  writeJson(response, 202, {
    ok: true,
    status: "running",
    conversation: started.conversation,
    run: deepConversationRunEnvelope({
      runId: started.runId,
      conversationId: started.conversationId,
      status: "running",
      runKind: started.runKind,
      runMode: started.runMode,
      rootRunId: started.rootRunId,
      turnOrdinal: started.turnOrdinal,
    }),
  });
}

async function handleDeepRunFollowUp(
  runtime: DeferredMultiAgentRouteRuntime,
  state: MultiAgentFeature,
  runId: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const input = parseDeepRunFollowUpRequest(await readJsonBody(request));
  const aiMode = await resolveDeepAiMode(runtime, input.aiMode);
  const started = await state.commands.followUp({
    runId,
    aiMode,
    message: input.message,
    taskSoilInput: input.taskSoilInput,
    workspaceDirectory: input.workspaceDirectory,
  }).catch((error: unknown) => mapMultiAgentCommandError(error, "run"));

  writeJson(response, 202, {
    ok: true,
    status: "running",
    conversationId: started.conversationId,
    runId: started.runId,
    parentRunId: started.parentRunId,
  });
}

// ---------------------------------------------------------------------------
// T3-1：GET /api/deep/conversations* / runs —— 历史复盘与侧栏恢复
// ---------------------------------------------------------------------------

async function handleListDeepConversations(
  state: MultiAgentFeature,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const limit = parseDeepRunListLimit(url);
  writeJson(response, 200, {
    ok: true,
    conversations: await state.queries.listConversationSummaries(limit),
  });
}

async function handleGetDeepConversation(
  state: MultiAgentFeature,
  conversationId: string,
  response: ServerResponse,
): Promise<void> {
  const detail = await state.queries.getConversationDetail(conversationId, 200);
  if (detail === undefined) {
    throw new PanelHttpError(404, "deep_conversation_not_found", "未找到该多 Agent 会话。");
  }
  writeJson(response, 200, {
    ok: true,
    conversation: detail.conversation,
    runs: detail.runs,
  });
}

async function handleRenameDeepConversation(
  state: MultiAgentFeature,
  request: IncomingMessage,
  conversationId: string,
  response: ServerResponse,
): Promise<void> {
  await ensureDeepConversationExists(state, conversationId);
  const input = parseConversationRenameInput(await readJsonBody(request));
  const title = input.title.trim();
  if (title.length === 0) {
    throw new PanelHttpError(400, "missing_conversation_title", "会话标题不能为空。");
  }
  const updated = await state.commands.renameConversation(conversationId, title).catch(mapMultiAgentFeatureError);
  writeJson(response, 200, {
    ok: true,
    conversation: updated,
    conversations: await state.queries.listConversationSummaries(50),
  });
}

async function handlePinDeepConversation(
  state: MultiAgentFeature,
  request: IncomingMessage,
  conversationId: string,
  response: ServerResponse,
): Promise<void> {
  await ensureDeepConversationExists(state, conversationId);
  const input = parseConversationPinInput(await readJsonBody(request));
  const updated = await state.commands.pinConversation(conversationId, input.pinned).catch(mapMultiAgentFeatureError);
  writeJson(response, 200, {
    ok: true,
    conversation: updated,
    conversations: await state.queries.listConversationSummaries(50),
  });
}

async function handleDeleteDeepConversation(
  state: MultiAgentFeature,
  conversationId: string,
  response: ServerResponse,
): Promise<void> {
  await state.commands.deleteConversation(conversationId).catch(mapMultiAgentFeatureError);
  writeJson(response, 200, {
    ok: true,
    deletedConversationId: conversationId,
    conversations: await state.queries.listConversationSummaries(50),
  });
}

async function handleListAllDeepRuns(
  state: MultiAgentFeature,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const runs = await state.queries.listRunSummaries(parseDeepRunListLimit(url));
  writeJson(response, 200, { ok: true, runs });
}

async function handleListDeepRuns(
  state: MultiAgentFeature,
  conversationId: string,
  response: ServerResponse,
): Promise<void> {
  const runs = await state.queries.listConversationRunSummaries(conversationId, 200);
  if (runs === undefined) {
    throw new PanelHttpError(404, "deep_conversation_not_found", "未找到该多 Agent 会话。");
  }
  writeJson(response, 200, { ok: true, conversationId, runs });
}

// ---------------------------------------------------------------------------
// T3-1：GET /api/deep/runs/:runId/view —— run tree 投影 + 结论 + replay
// ---------------------------------------------------------------------------

async function handleGetDeepRunView(
  state: MultiAgentFeature,
  runId: string,
  response: ServerResponse,
): Promise<void> {
  const view = await state.queries.getRunView(runId);
  if (view === undefined) {
    throw new PanelHttpError(404, "deep_run_not_found", "未找到该多 Agent 运行（可能仍在运行中）。");
  }
  writeJson(response, 200, { ok: true, view });
}

// ---------------------------------------------------------------------------
// T3-2：GET /api/deep/runs/:runId/events —— SSE 流式（deep.* 安全投影）
// ---------------------------------------------------------------------------

/**
 * Subscribe before replay so a durable write that lands during replay is
 * buffered and de-duplicated by sequence. Heartbeats keep the transport
 * observable without re-reading the complete run record.
 */
async function handleDeepRunEventsSse(
  state: MultiAgentFeature,
  runId: string,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  let lastSequence = parseStreamCursor(
    url.searchParams.get("cursor"),
    request.headers["last-event-id"],
  );
  let initialized = false;
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const buffered: MultiAgentRunEventUpdate[] = [];

  const unsubscribe = state.events.subscribe(runId, (update) => {
    if (!initialized) {
      buffered.push(update);
      return;
    }
    try {
      writeUpdate(update);
    } catch {
      cleanup();
    }
  });
  const onTransportClosed = (): void => cleanup();
  request.once("close", onTransportClosed);
  request.once("error", onTransportClosed);
  response.once("close", onTransportClosed);
  response.once("error", onTransportClosed);

  try {
    const admission = await state.events.admit(runId, lastSequence);
    if (admission.kind === "missing") {
      cleanup(false);
      throw new PanelHttpError(404, "deep_run_not_found", "未找到该多 Agent 运行。");
    }
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    response.write(`: AgentArbor multi-agent run stream ${runId}\n\n`);
    heartbeat = setInterval(() => {
      if (!closed && !response.writableEnded) {
        response.write(`: heartbeat ${runId} ${lastSequence}\n\n`);
      }
    }, DEEP_STREAM_HEARTBEAT_INTERVAL_MS);
    heartbeat.unref?.();

    if (admission.kind === "replay") {
      writeEvents(admission.replay.events);
    }
    initialized = true;
    for (const update of buffered.splice(0)) {
      writeUpdate(update);
    }
    if (admission.kind === "replay" && admission.replay.terminal) {
      cleanup();
    }
  } catch (error) {
    cleanup(response.headersSent);
    throw error;
  }

  function writeEvents(events: readonly {
    readonly sequence: number;
    readonly type: string;
    readonly [key: string]: unknown;
  }[]): void {
    for (const event of events) {
      if (closed || event.sequence <= lastSequence) {
        continue;
      }
      writeSseEvent(response, event);
      lastSequence = event.sequence;
    }
  }

  function writeUpdate(update: MultiAgentRunEventUpdate): void {
    if (closed) {
      return;
    }
    if (update.kind === "deleted") {
      cleanup();
      return;
    }
    writeEvents(update.events);
    if (update.terminal) {
      cleanup();
    }
  }

  function cleanup(endResponse = true): void {
    if (closed) {
      return;
    }
    closed = true;
    if (heartbeat !== undefined) {
      clearInterval(heartbeat);
      heartbeat = undefined;
    }
    unsubscribe();
    request.off("close", onTransportClosed);
    request.off("error", onTransportClosed);
    response.off("close", onTransportClosed);
    response.off("error", onTransportClosed);
    if (endResponse && !response.writableEnded) {
      response.end();
    }
  }
}

// ---------------------------------------------------------------------------
// T3-3：POST /api/deep/runs/:runId/interrupt|correct|stop —— 控制端点
// ---------------------------------------------------------------------------

async function handleDeepRunControl(
  state: MultiAgentFeature,
  runId: string,
  action: "interrupt" | "correct" | "stop",
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const input = parseDeepRunControlRequest(await readJsonBody(request), action);
  const result = await state.commands.requestRunControl({
    runId,
    action,
    reason: input.reason,
    correctionContext: input.correctionContext,
  }).catch(mapMultiAgentFeatureError);
  if (result.view !== undefined) {
    writeJson(response, 200, {
      ok: true,
      status: "stopped",
      runId,
      view: result.view,
    });
    return;
  }
  writeJson(response, 202, {
    ok: true,
    status: `${action}_requested`,
    runId,
  });
}

// ---------------------------------------------------------------------------
// Child Agent operation endpoints: confirmation resume + parent follow-up
// ---------------------------------------------------------------------------

async function handleDeepChildConfirmationDecision(
  state: MultiAgentFeature,
  runId: string,
  childRunId: string,
  confirmationId: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readJsonBody(request);
  const parsed = parseConfirmationDecision(body);
  const view = await state.commands.resumeChild({
    runId,
    childRunId,
    confirmationId,
    decision: parsed as DeepChildConfirmationDecision,
  }).catch(mapMultiAgentFeatureError);
  writeJson(response, 200, { ok: true, view });
}

async function handleDeepChildParentMessage(
  state: MultiAgentFeature,
  runId: string,
  childRunId: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const message = parseDeepChildMessageRequest(await readJsonBody(request));
  const result = await state.commands.sendChildInstruction({
    runId,
    childRunId,
    message,
  }).catch(mapMultiAgentFeatureError);
  if (result.status === "rejected") {
    throwDeepChildInstructionQueueRejection(result.result);
  }
  writeJson(response, result.status === "queued" ? 202 : 200, {
    ok: true,
    status: result.status,
    runId,
    childRunId,
    messageRef: result.messageRef,
    ...(result.status === "queued" ? {
      childStatus: result.childStatus,
      queuedCount: result.queuedCount,
      queuedAt: result.queuedAt,
    } : {}),
    view: result.view,
  });
}

async function handleDeepRunResynthesize(
  state: MultiAgentFeature,
  runId: string,
  response: ServerResponse,
): Promise<void> {
  const view = await state.commands.resynthesize({
    runId,
  }).catch(mapMultiAgentFeatureError);
  writeJson(response, 200, { ok: true, view });
}

function mapMultiAgentCommandError(error: unknown, operation: "intake" | "run"): never {
  if (error instanceof ModelRuntimeConfigurationError) {
    throw new PanelHttpError(
      409,
      "deep_model_not_configured",
      operation === "intake"
        ? `多 Agent 入口理解所需模型未就绪：${error.issue.message}`
        : `多 Agent 运行所需模型未就绪：${error.issue.message}`,
    );
  }
  return mapMultiAgentFeatureError(error);
}

function mapMultiAgentFeatureError(error: unknown): never {
  if (!(error instanceof MultiAgentFeatureError)) {
    throw error;
  }
  switch (error.code) {
    case "feature_quiescing":
      throw new PanelHttpError(503, "deep_feature_quiescing", "多 Agent 功能正在关闭，不能接受新的命令。");
    case "conversation_not_found":
      throw new PanelHttpError(404, "deep_conversation_not_found", "未找到该多 Agent 会话。");
    case "conversation_busy":
      throw new PanelHttpError(409, "deep_conversation_busy", "多 Agent 会话仍有运行中的协作，暂不能删除。");
    case "intake_active_run_not_terminal":
      throw new PanelHttpError(
        409,
        "deep_intake_active_run_not_terminal",
        "当前多 Agent 运行仍在进行中，请直接补充要求。",
      );
    case "intake_missing_objective":
      throw new PanelHttpError(
        500,
        "deep_intake_missing_objective",
        "入口理解已要求协作，但缺少标准化目标。",
      );
    case "run_not_found":
      throw new PanelHttpError(404, "deep_run_not_found", "未找到该多 Agent 运行。");
    case "run_not_active":
      throw new PanelHttpError(
        409,
        "deep_run_not_active",
        "该多 Agent 运行已结束，不能再接收运行控制请求。",
      );
    case "run_ai_mode_missing":
      throw new PanelHttpError(
        409,
        "deep_run_ai_mode_missing",
        "该多 Agent 运行缺少冻结的模型运行模式，属于失效开发期数据，无法继续执行。",
      );
    case "run_continuation_facts_missing":
      throw new PanelHttpError(
        409,
        "deep_run_continuation_facts_missing",
        "该多 Agent 运行缺少冻结的继续执行事实，无法安全恢复子 Agent 或重新综合。",
      );
    case "run_control_not_found":
      throw new PanelHttpError(
        404,
        "deep_run_control_not_found",
        "未找到该 run 的控制句柄（run 不存在或已被回收）。",
      );
    case "parent_run_conversation_mismatch":
      throw new PanelHttpError(
        409,
        "deep_parent_run_conversation_mismatch",
        "上一轮运行不属于当前多 Agent 会话。",
      );
    case "follow_up_requires_terminal_run":
      throw new PanelHttpError(
        409,
        "deep_follow_up_requires_terminal_run",
        "当前多 Agent 运行仍在进行中，请直接补充要求。",
      );
    case "child_not_found":
      throw new PanelHttpError(404, "deep_child_run_not_found", "未找到该子 Agent。");
    case "confirmation_continuation_lost":
      throw new PanelHttpError(
        409,
        "confirmation_continuation_lost",
        "该子 Agent 的确认上下文已不可恢复，请让父 Agent 补充指令后继续该子任务。",
      );
    case "confirmation_in_progress":
      throw new PanelHttpError(
        409,
        "confirmation_in_progress",
        "该子 Agent 的确认正在处理中，请等待当前操作完成。",
      );
    case "confirmation_outcome_unknown":
      throw new PanelHttpError(
        409,
        "confirmation_outcome_unknown",
        "该确认的执行结果无法确定，系统不会自动重复可能已经产生副作用的操作。",
      );
    case "child_instruction_outcome_unknown":
      throw new PanelHttpError(
        409,
        "child_instruction_outcome_unknown",
        "上一条子任务指令缺少可确认的持久化结果，系统不会自动重复可能已经执行的操作。",
      );
    case "capability_snapshot_missing":
      throw new PanelHttpError(
        409,
        "deep_capability_snapshot_missing",
        "该多 Agent 运行缺少冻结能力快照，无法继续子 Agent。",
      );
    case "resynthesis_no_child_material":
      throw new PanelHttpError(
        409,
        "deep_resynthesis_no_child_material",
        "该多 Agent 运行没有可供父层重新综合的子 Agent 材料。",
      );
    case "resynthesis_no_child_runs":
      throw new PanelHttpError(
        409,
        "deep_resynthesis_no_child_runs",
        "该多 Agent 运行缺少子 Agent run 记录，无法重新综合。",
      );
    default:
      throw new PanelHttpError(500, "deep_feature_unavailable", error.message);
  }
}

function throwDeepChildInstructionQueueRejection(
  result: Exclude<DeepChildInstructionQueueResult, { readonly status: "queued" }>,
): never {
  throw deepChildInstructionQueueRejectionError(result);
}

export function deepChildInstructionQueueRejectionError(
  result: Exclude<DeepChildInstructionQueueResult, { readonly status: "queued" }>,
): PanelHttpError {
  if (result.status === "child_not_found") {
    return new PanelHttpError(404, "deep_child_run_not_found", "未找到该子 Agent。");
  }
  if (result.reason === "child scheduler is stopped") {
    return new PanelHttpError(
      409,
      "deep_child_scheduler_stopped",
      "该多 Agent 运行正在停止或已经停止，不能继续子 Agent。",
    );
  }
  if (result.childStatus === "cancelled") {
    return new PanelHttpError(
      409,
      "deep_child_not_continuable",
      "该子 Agent 已取消，不能继续。",
    );
  }
  return new PanelHttpError(
    409,
    "deep_child_instruction_not_accepted",
    "该子 Agent 当前状态不能接收运行中追加，请等待最新运行状态后重试。",
  );
}

async function ensureDeepConversationExists(
  state: MultiAgentFeature,
  conversationId: string,
): Promise<void> {
  if (await state.queries.getConversation(conversationId) === undefined) {
    throw new PanelHttpError(404, "deep_conversation_not_found", "未找到该多 Agent 会话。");
  }
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** 解析 deep 运行的 aiMode：请求体优先，否则取 configCenter 的默认 AI 模式。 */
async function resolveDeepAiMode(
  runtime: DeferredMultiAgentRouteRuntime,
  requestedAiMode: ModelRuntimeMode | undefined,
): Promise<ModelRuntimeMode> {
  if (requestedAiMode !== undefined) {
    return requestedAiMode;
  }
  const config = await runtime.configCenter.getModelProviderConfig();
  return config.defaultAiMode;
}

