/**
 * deep-routes.ts —— `/api/deep/*` 产品 API 端点族（T3-1 / T3-2 / T3-3，闭环3 批次C-1）。
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
 *   - **EP1（严禁 mock 模型接入）**：从 PanelRuntime 取 configCenter / capabilityCenter，
 *     复用 desktop-run-resources 冻结模型环境、ToolCenter、MCP 与命令 shell 能力后构造
 *     IntelligenceChannel → AgentTurnRuntime → executeDeepRun；child 与普通桌面 Agent 共用
 *     标准模型-工具-模型循环和确认门，不绑定临时 provider 私有字段。
 *   - **EP4（controlHandle 注册表）**：MultiAgentFeature 持有每个在途 run 的控制句柄；
 *     interrupt / correct / stop 端点经其显式查询契约转发到运行侧（T2-7 control point）。
 *   - **隔离边界**：deep 端点与普通 `/api/conversations` / `/api/basic-agent/*` 物理隔离；
 *     内部映射 `runKind="underground"` / `runMode="deep"`，复用 run-mode-policy 门控口径。
 *     默认入口仍普通 agent，deep 仅显式触发，不存在自动升级。
 *   - **SSE 轮询模型**：复用 run-routes 的 `setInterval(flush, 100)` 轮询模式，轮询源为
 *     DeepRunRecordStore 中 record.eventSequence（EP3 安全投影）；事件不含 raw prompt/response。
 *
 * 命名红线：消费 contracts.ts 的 SynthesizedConclusion / DeepExplorationReport；
 * 不引入 Plan / artifact / Fruits。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
// 模型运行时统一入口：ModelRuntimeConfigurationError 经 model-runtime/index.ts
// re-export，禁止 app 层直接 import intelligence-channel-factory（panel-runtime-structure 命名中性约束）。
import { ModelRuntimeConfigurationError } from "../model-runtime/index.js";
import {
  parseDesktopTaskSoilInput,
} from "../task-soil-workspace.js";
import type { ModelRuntimeMode } from "../model-runtime/index.js";
import {
  PanelHttpError,
  readJsonBody,
  writeJson,
  writePanelError,
} from "./http-utils.js";
import { serveRunEventSse } from "./run-event-sse.js";
import { projectConversationRunEnvelopeViewBase } from "../run-read-model/envelope.js";
import type { PanelRuntime } from "./runtime.js";
import {
  type DeepRunRecord,
} from "../deep/deep-runtime.js";
import type {
  DeepChildInstructionQueueResult,
} from "../deep/deep-child-scheduler-contracts.js";
import {
  type DeepChildConfirmationDecision,
} from "../deep/deep-child-agent-runner.js";
import {
  MultiAgentFeatureError,
  type MultiAgentFeature,
} from "../deep/multi-agent-feature.js";
import {
  latestDeepRunRecordsByRoot,
  projectDeepConversation,
  projectDeepRunView,
} from "../deep/deep-read-model.js";
import {
  type DeepConversation,
} from "../deep/contracts.js";
import type { DeepRunStreamEvent } from "../deep/deep-events.js";
import {
  parseConfirmationDecision,
  parseConversationPinInput,
  parseConversationRenameInput,
} from "./request-parsers.js";
import { parseDeepRunListLimit } from "./deep-route-helpers.js";
import {
  deepRunRuntimeHealth,
  isTerminalDeepRunStatus,
  projectDeepConversationSummaryWithHealth,
  projectDeepRunSummaryWithHealth,
} from "./deep-run-health.js";

export { deriveDeepRunRuntimeHealth } from "./deep-run-health.js";
export type { DeepRunRuntimeHealthView } from "./deep-run-health.js";

// ---------------------------------------------------------------------------
// 分发入口
// ---------------------------------------------------------------------------

/**
 * deep 路由分发器。匹配 `/api/deep/` 前缀时返回 true 并处理；否则返回 false 交回主分发链。
 * 放在 handlePanelRequest 分发链靠前位置（`/api/deep` 前缀明确，不与普通路由冲突）。
 */
export async function handlePanelDeepRoute(
  runtime: PanelRuntime,
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
    if (error instanceof PanelHttpError) {
      writePanelError(response, error);
    } else {
      writePanelError(
        response,
        new PanelHttpError(500, "deep_route_internal_error", errorMessage(error)),
      );
    }
    return true;
  }
}

/** 按 pathname + method 分流到各子端点。返回 true 表示已处理。 */
async function dispatchDeepRoute(
  runtime: PanelRuntime,
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
    handleDeepRunEventsSse(state, rest[1], request, response, url);
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
  runtime: PanelRuntime,
  state: MultiAgentFeature,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readJsonBody(request);
  const record = asRecord(body);
  const message = stringField(record.message);
  if (message.length === 0) {
    throw new PanelHttpError(400, "empty_intake_message", "多 Agent 需要非空输入。");
  }

  const aiMode = await resolveDeepAiMode(runtime, record.aiMode);
  if (aiMode === "none") {
    throw new PanelHttpError(
      409,
      "deep_model_not_configured",
      "多 Agent 入口理解需要可用模型，当前未配置 AI 模式。",
    );
  }

  const taskSoilInput = hasTaskSoilPayload(record)
    ? parseDesktopTaskSoilInput(record)
    : undefined;
  const result = await state.intake({
    aiMode,
    conversationId: optionalStringField(record.conversationId),
    activeRunId: optionalStringField(record.activeRunId),
    message,
    taskSoilInput,
    workspaceDirectory: optionalStringField(record.workspaceDirectory),
  }).catch((error: unknown) => mapMultiAgentCommandError(error, "intake"));
  writeJson(response, 200, {
    ok: true,
    status: result.status,
    conversation: projectDeepConversation(result.conversation),
    intake: result.intake,
  });
}

// ---------------------------------------------------------------------------
// T3-1：POST /api/deep/conversations —— 创建独立 deep 会话
// ---------------------------------------------------------------------------

async function handleCreateDeepConversation(
  state: MultiAgentFeature,
  runtime: PanelRuntime,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readJsonBody(request);
  const record = asRecord(body);
  const goal = stringField(record.goal);
  if (goal.length === 0) {
    throw new PanelHttpError(400, "empty_goal", "多 Agent 需要非空目标。");
  }
  const aiMode = await resolveDeepAiMode(runtime, record.aiMode);
  const conversation = await state.createConversation({
    aiMode,
    title: optionalStringField(record.title),
    goal,
    birthWorkspaceDirectory: optionalStringField(record.workspaceDirectory),
    taskSoilInput: parseDesktopTaskSoilInput(record),
  });
  writeJson(response, 201, {
    ok: true,
    status: "created",
    conversation: projectDeepConversation(conversation),
  });
}

// ---------------------------------------------------------------------------
// T3-1：POST /api/deep/conversations/:id/runs —— 启动 deep run（后台执行）
// ---------------------------------------------------------------------------

async function handleStartDeepRun(
  state: MultiAgentFeature,
  runtime: PanelRuntime,
  conversationId: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readJsonBody(request);
  const record = asRecord(body);
  const aiMode = await resolveDeepAiMode(runtime, record.aiMode);
  const started = await state.startRun({
    conversationId,
    aiMode,
    intakeTurnId: optionalStringField(record.intakeTurnId),
    confirmedObjective: optionalStringField(record.confirmedObjective),
    confirmedPlan: optionalStringField(record.confirmedPlan),
    parentRunId: optionalStringField(record.parentRunId),
    workspaceDirectory: optionalStringField(record.workspaceDirectory),
  }).catch((error: unknown) => mapMultiAgentCommandError(error, "run"));

  writeJson(response, 202, {
    ok: true,
    status: "running",
    conversation: projectDeepConversation(started.conversation),
    run: projectConversationRunEnvelopeViewBase({
      runId: started.runId,
      conversationId: started.conversation.conversationId,
      status: "running",
      runKind: started.runKind,
      runMode: started.runMode,
      rootRunId: started.rootRunId,
      turnOrdinal: started.turnOrdinal,
    }),
  });
}

async function handleDeepRunFollowUp(
  runtime: PanelRuntime,
  state: MultiAgentFeature,
  runId: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readJsonBody(request);
  const record = asRecord(body);
  const message = stringField(record.message);
  if (message.length === 0) {
    throw new PanelHttpError(400, "empty_follow_up_message", "继续多 Agent 任务需要非空补充。");
  }
  const aiMode = await resolveDeepAiMode(runtime, record.aiMode);
  const started = await state.followUp({
    runId,
    aiMode,
    message,
    taskSoilInput: hasTaskSoilPayload(record) ? parseDesktopTaskSoilInput(record) : undefined,
    workspaceDirectory: optionalStringField(record.workspaceDirectory),
  }).catch((error: unknown) => mapMultiAgentCommandError(error, "run"));

  writeJson(response, 202, {
    ok: true,
    status: "running",
    conversationId: started.conversation.conversationId,
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
    conversations: await projectDeepConversationSummaries(state, limit),
  });
}

async function handleGetDeepConversation(
  state: MultiAgentFeature,
  conversationId: string,
  response: ServerResponse,
): Promise<void> {
  const conversation = await ensureDeepConversationLoaded(state, conversationId);
  const records = await state.listRunsForConversation(conversationId, 200);
  const runs = await projectLatestDeepRunSummaries(
    state,
    records,
  );
  writeJson(response, 200, {
    ok: true,
    conversation: projectDeepConversation(conversation),
    runs,
  });
}

async function handleRenameDeepConversation(
  state: MultiAgentFeature,
  request: IncomingMessage,
  conversationId: string,
  response: ServerResponse,
): Promise<void> {
  const conversation = await ensureDeepConversationLoaded(state, conversationId);
  const input = parseConversationRenameInput(await readJsonBody(request));
  const title = input.title.trim();
  if (title.length === 0) {
    throw new PanelHttpError(400, "missing_conversation_title", "会话标题不能为空。");
  }
  const updated = await state.renameConversation(conversationId, title).catch(mapMultiAgentFeatureError);
  writeJson(response, 200, {
    ok: true,
    conversation: projectDeepConversation(updated),
    conversations: await projectDeepConversationSummaries(state, 50),
  });
}

async function handlePinDeepConversation(
  state: MultiAgentFeature,
  request: IncomingMessage,
  conversationId: string,
  response: ServerResponse,
): Promise<void> {
  await ensureDeepConversationLoaded(state, conversationId);
  const input = parseConversationPinInput(await readJsonBody(request));
  const updated = await state.pinConversation(conversationId, input.pinned).catch(mapMultiAgentFeatureError);
  writeJson(response, 200, {
    ok: true,
    conversation: projectDeepConversation(updated),
    conversations: await projectDeepConversationSummaries(state, 50),
  });
}

async function handleDeleteDeepConversation(
  state: MultiAgentFeature,
  conversationId: string,
  response: ServerResponse,
): Promise<void> {
  await state.deleteConversation(conversationId).catch(mapMultiAgentFeatureError);
  writeJson(response, 200, {
    ok: true,
    deletedConversationId: conversationId,
    conversations: await projectDeepConversationSummaries(state, 50),
  });
}

async function handleListAllDeepRuns(
  state: MultiAgentFeature,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const records = await state.listRuns(parseDeepRunListLimit(url));
  const runs = await projectLatestDeepRunSummaries(state, records);
  writeJson(response, 200, { ok: true, runs });
}

async function handleListDeepRuns(
  state: MultiAgentFeature,
  conversationId: string,
  response: ServerResponse,
): Promise<void> {
  const conversation = await state.getConversation(conversationId);
  if (conversation === undefined) {
    throw new PanelHttpError(404, "deep_conversation_not_found", "未找到该多 Agent 会话。");
  }
  const records = await state.listRunsForConversation(conversationId, 200);
  const runs = await projectLatestDeepRunSummaries(
    state,
    records,
  );
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
  const record = await state.getRun(runId);
  if (record === undefined) {
    throw new PanelHttpError(404, "deep_run_not_found", "未找到该多 Agent 运行（可能仍在运行中）。");
  }
  writeJson(response, 200, { ok: true, view: await projectDeepRunViewForResponse(state, record) });
}

// ---------------------------------------------------------------------------
// T3-2：GET /api/deep/runs/:runId/events —— SSE 流式（deep.* 安全投影）
// ---------------------------------------------------------------------------

/**
 * SSE 轮询模型（复用 run-routes 口径）：每 100ms 通过 MultiAgentFeature 查询 run，
 * 增量写出 record.eventSequence 中尚未发送的事件；run 进入终态后写完剩余事件并关闭。
 *
 * 当前 deep-runtime 会在 manager 决策、child 启动/完成/失败、综合完成等节点实时 upsert
 * record.eventSequence；SSE 只负责即时触发前端刷新，权威状态仍来自 `/view`。
 * 事件均为安全投影（EP3），不含 raw prompt/response/output。
 */
function handleDeepRunEventsSse(
  state: MultiAgentFeature,
  runId: string,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): void {
  serveRunEventSse<DeepRunStreamEvent>({
    request,
    response,
    url,
    comment: `AgentArbor multi-agent run stream ${runId}`,
    poll: async () => {
      const record = await state.getRun(runId);
      if (record === undefined) {
        // run 仍在进行中：record 尚未写入，保持连接（无事件可推）。
        return { events: [], terminal: false };
      }
      return {
        events: record.eventSequence,
        terminal: isTerminalDeepRunStatus(record.run.status),
      };
    },
    onPollError: () => {
      /* 读取失败不中断流；下一轮 flush 重试。 */
    },
  });
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
  const body = await readJsonBody(request);
  const record = asRecord(body);
  const reason = optionalStringField(record.reason);
  const result = await state.requestRunControl({
    runId,
    action,
    reason,
    correctionContext: action === "correct" ? parseCorrectionContext(record) : undefined,
  }).catch(mapMultiAgentFeatureError);
  if (result.record !== undefined) {
    writeJson(response, 200, {
      ok: true,
      status: "stopped",
      runId,
      view: await projectDeepRunViewForResponse(state, result.record),
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
  const updated = await state.resumeChild({
    runId,
    childRunId,
    confirmationId,
    decision: parsed as DeepChildConfirmationDecision,
  }).catch(mapMultiAgentFeatureError);
  writeJson(response, 200, { ok: true, view: await projectDeepRunViewForResponse(state, updated) });
}

async function handleDeepChildParentMessage(
  state: MultiAgentFeature,
  runId: string,
  childRunId: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readJsonBody(request);
  const message = parseParentChildMessage(body);
  const result = await state.sendChildInstruction({
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
    view: await projectDeepRunViewForResponse(state, result.record),
  });
}

async function handleDeepRunResynthesize(
  state: MultiAgentFeature,
  runId: string,
  response: ServerResponse,
): Promise<void> {
  const updated = await state.resynthesize({
    runId,
  }).catch(mapMultiAgentFeatureError);
  writeJson(response, 200, { ok: true, view: await projectDeepRunViewForResponse(state, updated) });
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

function parseParentChildMessage(raw: unknown): string {
  const record = asRecord(raw);
  const message = optionalStringField(record.message) ?? optionalStringField(record.instruction);
  if (message === undefined) {
    throw new PanelHttpError(400, "empty_child_instruction", "子 Agent 补充要求不能为空。");
  }
  return message;
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

// ---------------------------------------------------------------------------
// 安全投影（view / list / conversation）
// ---------------------------------------------------------------------------

async function projectLatestDeepRunSummaries(
  state: MultiAgentFeature,
  records: readonly DeepRunRecord[],
): Promise<readonly Record<string, unknown>[]> {
  return Promise.all(
    latestDeepRunRecordsByRoot(records).map(async (record) => {
      const rootRecord = await rootDeepRunRecord(state, record);
      return projectDeepRunSummaryWithHealth(state, record, rootRecord);
    })
  );
}

async function latestDeepRunRecordsByConversation(
  state: MultiAgentFeature,
  records: readonly DeepRunRecord[],
): Promise<ReadonlyMap<string, { readonly record: DeepRunRecord; readonly rootRecord?: DeepRunRecord }>> {
  const selected = new Map<string, { readonly record: DeepRunRecord; readonly rootRecord?: DeepRunRecord }>();
  for (const record of latestDeepRunRecordsByRoot(records)) {
    if (selected.has(record.run.conversationId)) {
      continue;
    }
    selected.set(record.run.conversationId, {
      record,
      rootRecord: await rootDeepRunRecord(state, record),
    });
  }
  return selected;
}

async function projectDeepConversationSummaries(
  state: MultiAgentFeature,
  limit: number,
): Promise<readonly Record<string, unknown>[]> {
  const [conversations, records] = await Promise.all([
    state.listConversations(Math.max(limit, 200)),
    state.listRuns(500),
  ]);
  const latestByConversation = await latestDeepRunRecordsByConversation(state, records);
  return conversations
    .map((conversation) => {
      const latest = latestByConversation.get(conversation.conversationId);
      return projectDeepConversationSummaryWithHealth(state, conversation, latest?.record, latest?.rootRecord);
    })
    .sort((left, right) => {
      const pinned = summaryPinnedAt(right).localeCompare(summaryPinnedAt(left));
      return pinned === 0 ? summaryUpdatedAt(right).localeCompare(summaryUpdatedAt(left)) : pinned;
    })
    .slice(0, limit);
}

async function ensureDeepConversationLoaded(
  state: MultiAgentFeature,
  conversationId: string,
): Promise<DeepConversation> {
  const conversation = await state.getConversation(conversationId);
  if (conversation === undefined) {
    throw new PanelHttpError(404, "deep_conversation_not_found", "未找到该多 Agent 会话。");
  }
  return conversation;
}

async function rootDeepRunRecord(
  state: MultiAgentFeature,
  record: DeepRunRecord,
): Promise<DeepRunRecord | undefined> {
  const rootRunId = record.run.rootRunId ?? record.run.runId;
  return rootRunId === record.run.runId ? record : state.getRun(rootRunId);
}

function summaryUpdatedAt(summary: Record<string, unknown>): string {
  const candidates = [
    typeof summary.updatedAt === "string" ? summary.updatedAt : "",
    typeof summary.titleEditedAt === "string" ? summary.titleEditedAt : "",
    typeof summary.pinnedAt === "string" ? summary.pinnedAt : "",
  ];
  return candidates.sort((left, right) => right.localeCompare(left))[0] ?? "";
}

function summaryPinnedAt(summary: Record<string, unknown>): string {
  return typeof summary.pinnedAt === "string" ? summary.pinnedAt : "";
}

async function projectDeepRunViewForResponse(
  state: MultiAgentFeature,
  record: DeepRunRecord,
): Promise<Record<string, unknown>> {
  const conversation = await state.getConversation(record.run.conversationId);
  const view = projectDeepRunView(record, conversation);
  const run = asRecord(view.run);
  return {
    ...view,
    run: {
      ...run,
      runtimeHealth: deepRunRuntimeHealth(state, record),
    },
  };
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** 解析 deep 运行的 aiMode：请求体优先，否则取 configCenter 的默认 AI 模式。 */
async function resolveDeepAiMode(
  runtime: PanelRuntime,
  rawAiMode: unknown,
): Promise<ModelRuntimeMode> {
  const explicit = parseAiMode(rawAiMode);
  if (explicit !== undefined) {
    return explicit;
  }
  const config = await runtime.configCenter.getModelProviderConfig();
  return config.defaultAiMode;
}

const VALID_AI_MODES: readonly ModelRuntimeMode[] = [
  "none",
  "fake",
  "openai-compatible",
  "openai-responses",
];

function parseAiMode(value: unknown): ModelRuntimeMode | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "string" && (VALID_AI_MODES as readonly string[]).includes(value)) {
    return value as ModelRuntimeMode;
  }
  throw new PanelHttpError(400, "invalid_ai_mode", "AI 模式无效。");
}

function hasTaskSoilPayload(record: Record<string, unknown>): boolean {
  return record.taskSoilInput !== undefined ||
    record.taskSoil !== undefined ||
    record.contextRefs !== undefined ||
    record.permissionBoundaryRefs !== undefined;
}

/**
 * correct 端点的补充上下文：字符串数组（注入下一 manager 决策 step）。
 *
 * 语义划分：
 *   - 字段缺失 / null → empty_correction_context（用户未提供任何补充，提示需要填写）；
 *   - 字段存在但类型错误（非数组）→ invalid_correction_context（请求格式损坏）；
 *   - 数组但全部为空串 → empty_correction_context（同无有效补充）。
 */
function parseCorrectionContext(record: Record<string, unknown>): readonly string[] {
  const raw = record.correctionContext ?? record.context;
  if (raw === undefined || raw === null) {
    throw new PanelHttpError(400, "empty_correction_context", "补充上下文不能为空。");
  }
  if (!Array.isArray(raw)) {
    throw new PanelHttpError(400, "invalid_correction_context", "correct 需要补充上下文数组。");
  }
  const items = raw.map((item) => (typeof item === "string" ? item : String(item))).filter((item) => item.length > 0);
  if (items.length === 0) {
    throw new PanelHttpError(400, "empty_correction_context", "补充上下文不能为空。");
  }
  return items;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalStringField(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
