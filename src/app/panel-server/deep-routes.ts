/**
 * deep-routes.ts —— `/api/deep/*` 产品 API 端点族（T3-1 / T3-2 / T3-3，闭环3 批次C-1）。
 *
 * 端点族（design §6.1 / §6.3，落地 FR-001 / FR-002 / FR-007 / FR-008）：
 *   POST   /api/deep/conversations              创建独立 deep 会话（携带 workspace 上下文）
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
 *   - **EP4（controlHandle 注册表）**：`Map<runId, DeepRunControlHandle>` 持有每个在途 run 的
 *     handle；interrupt / correct / stop 端点经此转发到运行侧（T2-7 control point）。
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
import { createId, nowIso } from "../../kernel/id.js";
import type { MinimalRuntime } from "../runtime.js";
import { createMinimalRuntime } from "../runtime.js";
// 模型运行时统一入口：ModelRuntimeConfigurationError 经 model-runtime/index.ts
// re-export，禁止 app 层直接 import intelligence-channel-factory（panel-runtime-structure 命名中性约束）。
import { ModelRuntimeConfigurationError } from "../model-runtime/index.js";
import {
  createDesktopToolCenterFactory,
  prepareDesktopRunResources,
} from "./desktop-run-resources.js";
import {
  resolveRunModeForKind,
  assertRunModeForKind,
  type AgentArborRunKind,
  type AgentArborRunMode,
} from "../run-mode-policy.js";
import {
  createTaskSoilFromDesktopInput,
  parseDesktopTaskSoilInput,
  type DesktopTaskSoilInput,
} from "../task-soil-workspace.js";
import type { ModelRuntimeMode } from "../model-runtime/index.js";
import {
  PanelHttpError,
  readJsonBody,
  writeJson,
  writeSseEvent,
  writePanelError,
  parseStreamCursor,
} from "./http-utils.js";
import type { PanelRuntime } from "./runtime.js";
import {
  InMemoryDeepConversationStore,
  createFileSystemDeepConversationStore,
  createDeepConversationService,
  type DeepConversationStore,
} from "../deep/deep-conversation.js";
import {
  executeDeepRun,
  buildDeepManagerSpec,
  InMemoryDeepRunRecordStore,
  createFileSystemDeepRunRecordStore,
  type DeepRuntimeConfig,
  type DeepRunRecord,
  type DeepRunRecordStore,
  type StartDeepRuntimeInput,
} from "../deep/deep-runtime.js";
import type {
  DeepChildInstructionQueueHandle,
  DeepChildInstructionQueueResult,
} from "../deep/deep-child-scheduler.js";
import {
  createDeepRunControlHandle,
  DEEP_MANAGER_MAX_MODEL_ROUNDS,
  DEEP_MANAGER_MAX_TOOL_ROUNDS,
  type DeepRunControlHandle,
} from "../deep/deep-run-executor.js";
import { createDeepTurnRuntime, executeDeepTurn } from "../deep/deep-turn.js";
import { synthesizeDeepConclusion } from "../deep/parent-synthesis.js";
import {
  deepIntakeMessages,
  deepIntakeOutputContract,
  extractStructuredOutput,
  parseDeepIntake,
} from "../deep/deep-model-io.js";
import { DeepChildPendingContinuationStore } from "../deep/deep-child-continuations.js";
import {
  continueDeepChildAgent,
  resumeDeepChildAgent,
  type DeepChildParentMessageContext,
  type DeepChildConfirmationDecision,
  type DeepChildAgentRunResult,
} from "../deep/deep-child-agent-runner.js";
import {
  InMemoryDeepChildMessageStore,
  createDeepChildMessageRecord,
  createDeepChildMessageRef,
  createFileSystemDeepChildMessageStore,
  summarizeDeepChildMessage,
  type DeepChildMessageInput,
  type DeepChildMessageStore,
} from "../deep/deep-child-messages.js";
import {
  buildDeepFollowUpContext,
  fallbackLiveProjectionForRecord,
  latestDeepRunRecordsByRoot,
  liveParentOperationFromInstruction,
  projectDeepConversation,
  projectDeepRunSummary,
  projectDeepRunView,
  summarizeTaskSoilInputForIntake,
  summarizeTerminalDeepRunForIntake,
  workspaceDirectoryFromDeepRunRecord,
} from "../deep/deep-read-model.js";
import {
  DEEP_RUN_KIND,
  DEEP_RUN_MODE,
  type DeepChildSpec,
  type DeepChildSummary,
  type DeepConversation,
  type DeepFollowUpContext,
  type DeepIntakeContext,
  type DeepIntakeTurn,
  type DeepLiveProjection,
  type DeepRunStatus,
  type SynthesizedConclusion,
} from "../deep/contracts.js";
import type { DeepRunStreamEvent } from "../deep/deep-events.js";
import {
  appendDelegationDecisionToTree,
  appendParentSynthesisToTree,
  createAgentRunTree,
  recordChildAgentRunParentInstruction,
  replaceChildRunInTree,
  type ChildAgentRun,
  type ParentSynthesisResult,
} from "../../domain/underground/agent-fabric.js";
import type { ObservationRef } from "../../domain/observation/contracts.js";
import { parseConfirmationDecision } from "./request-parsers.js";
import { parseDeepRunListLimit } from "./deep-route-helpers.js";
// ---------------------------------------------------------------------------
// 路由状态（EP4 注册表 + 隔离 store + 后台 run 追踪）
// ---------------------------------------------------------------------------

/**
 * 每个 PanelRuntime 绑定一份 deep 路由状态。controlHandles 是 EP4 注册表；
 * conversationStore / runRecordStore 是 deep 隔离分区（内存态，C-1 口径）；
 * activeRuns 追踪后台执行中的 deep run，便于服务器优雅退出与错误归因；
 * minimalRuntime 是 deep 模块自有的 MinimalRuntime（事件 bus + soil/constraints），
 * 因 PanelRuntime 不暴露 bus / soilStore / constraints（survey 结论 C.3）。
 */
type DeepRouteState = {
  readonly minimalRuntime: MinimalRuntime;
  readonly conversationStore: DeepConversationStore;
  readonly runRecordStore: DeepRunRecordStore;
  readonly childMessageStore: DeepChildMessageStore;
  readonly controlHandles: Map<string, DeepRunControlHandle>;
  readonly childContinuations: DeepChildPendingContinuationStore;
  readonly childInstructionQueues: DeepChildInstructionQueueStore;
  readonly runFacts: Map<string, DeepRouteRunFacts>;
  readonly activeRuns: Set<Promise<void>>;
};

type DeepRouteRunFacts = {
  readonly aiMode: ModelRuntimeMode;
  readonly informationAccess: Awaited<ReturnType<PanelRuntime["configCenter"]["getInformationAccessConfig"]>>;
  readonly taskSoil: StartDeepRuntimeInput["taskSoil"];
  readonly permissionBoundaryRefs: readonly string[];
  readonly confirmationPolicy: NonNullable<StartDeepRuntimeInput["confirmationPolicy"]>;
};

/** PanelRuntime → DeepRouteState 绑定。WeakMap 使状态随 runtime 回收，避免跨实例泄漏。 */
const deepRouteStates = new WeakMap<PanelRuntime, DeepRouteState>();

/** 取或创建 PanelRuntime 绑定的 deep 路由状态（幂等，首次访问时惰性装配）。 */
function getDeepRouteState(runtime: PanelRuntime): DeepRouteState {
  let state = deepRouteStates.get(runtime);
  if (state !== undefined) {
    return state;
  }
  state = {
    minimalRuntime: createMinimalRuntime(),
    conversationStore: createDeepConversationStoreForRuntime(runtime),
    runRecordStore: createDeepRunRecordStoreForRuntime(runtime),
    childMessageStore: createDeepChildMessageStoreForRuntime(runtime),
    controlHandles: new Map(),
    childContinuations: new DeepChildPendingContinuationStore(),
    childInstructionQueues: new DeepChildInstructionQueueStore(),
    runFacts: new Map(),
    activeRuns: new Set(),
  };
  deepRouteStates.set(runtime, state);
  return state;
}

function createDeepConversationStoreForRuntime(runtime: PanelRuntime): DeepConversationStore {
  const runtimeHome = runtime.runtimePaths?.runtimeHome;
  return runtimeHome === undefined
    ? new InMemoryDeepConversationStore()
    : createFileSystemDeepConversationStore(runtimeHome);
}

function createDeepRunRecordStoreForRuntime(runtime: PanelRuntime): DeepRunRecordStore {
  const runtimeHome = runtime.runtimePaths?.runtimeHome;
  return runtimeHome === undefined
    ? new InMemoryDeepRunRecordStore()
    : createFileSystemDeepRunRecordStore(runtimeHome);
}

function createDeepChildMessageStoreForRuntime(runtime: PanelRuntime): DeepChildMessageStore {
  const runtimeHome = runtime.runtimePaths?.runtimeHome;
  return runtimeHome === undefined
    ? new InMemoryDeepChildMessageStore()
    : createFileSystemDeepChildMessageStore(runtimeHome);
}

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
  const state = getDeepRouteState(runtime);
  try {
    return await dispatchDeepRoute(runtime, state, request, response, url);
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
  state: DeepRouteState,
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
      runtime,
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
    await handleDeepChildParentMessage(runtime, state, rest[1], rest[3], request, response);
    return true;
  }

  // POST /api/deep/runs/:runId/resynthesize
  if (rest.length === 3 && rest[0] === "runs" && rest[2] === "resynthesize" && method === "POST") {
    await handleDeepRunResynthesize(runtime, state, rest[1], response);
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
// POST /api/deep/intake —— 先理解目标，再决定追问、直接回答或启动协作
// ---------------------------------------------------------------------------

async function handleDeepIntake(
  runtime: PanelRuntime,
  state: DeepRouteState,
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

  const activeRunId = optionalStringField(record.activeRunId);
  const previousRun = activeRunId === undefined
    ? undefined
    : await state.runRecordStore.get(activeRunId);
  if (activeRunId !== undefined && previousRun === undefined) {
    throw new PanelHttpError(404, "deep_run_not_found", "未找到该多 Agent 运行。");
  }
  if (previousRun !== undefined && !isTerminalDeepRunStatus(previousRun.run.status)) {
    throw new PanelHttpError(
      409,
      "deep_intake_active_run_not_terminal",
      "当前多 Agent 运行仍在进行中，请直接补充要求。",
    );
  }

  const requestedConversationId =
    optionalStringField(record.conversationId) ?? previousRun?.run.conversationId;
  const taskSoilInput = hasTaskSoilPayload(record)
    ? parseDesktopTaskSoilInput(record)
    : undefined;
  const workspaceDirectory = previousRun === undefined
    ? optionalStringField(record.workspaceDirectory)
    : workspaceDirectoryFromDeepRunRecord(previousRun) ?? optionalStringField(record.workspaceDirectory);
  const conversation = await resolveDeepIntakeConversation({
    runtime,
    state,
    aiMode,
    conversationId: requestedConversationId,
    message,
    taskSoilInput,
    workspaceDirectory,
  });

  const intake = await executeDeepIntakeTurn({
    runtime,
    state,
    aiMode,
    conversation,
    message,
    terminalRun: previousRun,
  });

  const conversationWithTurn = await state.conversationStore.upsert(
    appendDeepIntakeTurn(
      mergeDeepConversationTaskSoil(conversation, taskSoilInput),
      intake,
    ),
  );

  if (intake.action === "ask_user") {
    writeJson(response, 200, {
      ok: true,
      status: "needs_input",
      conversation: projectDeepConversation(conversationWithTurn),
      intake,
    });
    return;
  }

  if (intake.action === "direct_answer") {
    writeJson(response, 200, {
      ok: true,
      status: "answered",
      conversation: projectDeepConversation(conversationWithTurn),
      intake,
    });
    return;
  }

  const normalizedObjective = intake.normalizedObjective;
  if (normalizedObjective === undefined) {
    throw new PanelHttpError(
      500,
      "deep_intake_missing_objective",
      "入口理解已要求协作，但缺少标准化目标。",
    );
  }
  const collaborationConversation: DeepConversation = await state.conversationStore.upsert({
    ...conversationWithTurn,
    currentObjective: normalizedObjective,
    updatedAt: nowIso(),
  });
  const intakeContext = intakeContextFromTurn(intake);
  const startInput =
    previousRun === undefined
      ? {
          state,
          runtime,
          conversation: collaborationConversation,
          aiMode,
          intakeContext,
        }
      : {
          state,
          runtime,
          conversation: collaborationConversation,
          aiMode,
          parentRunId: previousRun.run.runId,
          rootRunId: previousRun.run.rootRunId ?? previousRun.run.runId,
          turnOrdinal: await nextDeepRunTurnOrdinal(state, previousRun.run.rootRunId ?? previousRun.run.runId),
          followUpContext: buildDeepFollowUpContext(previousRun, message),
          intakeContext,
        };
  const started = await startDeepRunBackground(startInput);

  writeJson(response, 202, {
    ok: true,
    status: "running",
    conversation: projectDeepConversation(collaborationConversation),
    intake,
    run: {
      runId: started.runId,
      conversationId: collaborationConversation.conversationId,
      status: "running",
      runKind: started.runKind,
      runMode: started.runMode,
      rootRunId: started.rootRunId,
      turnOrdinal: started.turnOrdinal,
    },
  });
}

// ---------------------------------------------------------------------------
// T3-1：POST /api/deep/conversations —— 创建独立 deep 会话
// ---------------------------------------------------------------------------

async function handleCreateDeepConversation(
  state: DeepRouteState,
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
  // DeepConversationService 复用 task-soil-workspace 的授权校验（拒绝未授权引用）。
  const service = createDeepConversationService({
    store: state.conversationStore,
    runtime: state.minimalRuntime,
    aiMode,
  });
  const conversation = await service.create({
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
  state: DeepRouteState,
  runtime: PanelRuntime,
  conversationId: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  let conversation = await state.conversationStore.get(conversationId);
  if (conversation === undefined) {
    throw new PanelHttpError(404, "deep_conversation_not_found", "未找到该多 Agent 会话。");
  }
  const body = await readJsonBody(request);
  const record = asRecord(body);
  const aiMode = await resolveDeepAiMode(runtime, record.aiMode);
  conversation = await applyDeepBirthWorkspace(
    state,
    conversation,
    optionalStringField(record.workspaceDirectory),
  );

  const started = await startDeepRunBackground({
    state,
    runtime,
    conversation,
    aiMode,
  });

  writeJson(response, 202, {
    ok: true,
    status: "running",
    run: {
      runId: started.runId,
      conversationId: conversation.conversationId,
      status: "running",
      runKind: started.runKind,
      runMode: started.runMode,
      rootRunId: started.rootRunId,
      turnOrdinal: started.turnOrdinal,
    },
  });
}

async function startDeepRunBackground(input: {
  readonly state: DeepRouteState;
  readonly runtime: PanelRuntime;
  readonly conversation: DeepConversation;
  readonly aiMode: ModelRuntimeMode;
  readonly parentRunId?: string;
  readonly rootRunId?: string;
  readonly turnOrdinal?: number;
  readonly followUpContext?: DeepFollowUpContext;
  readonly intakeContext?: DeepIntakeContext;
}): Promise<{
  readonly runId: string;
  readonly runKind: AgentArborRunKind;
  readonly runMode: AgentArborRunMode;
  readonly rootRunId: string;
  readonly turnOrdinal: number;
}> {
  const { state, runtime, conversation, aiMode } = input;
  // 复用 run-mode-policy 门控：underground → deep（survey 结论 A/B）。
  const runKind: AgentArborRunKind = "underground";
  const runMode: AgentArborRunMode = resolveRunModeForKind(runKind, undefined);
  assertRunModeForKind(runKind, runMode);

  // EP4：预创建 controlHandle 并注册，使 interrupt/correct/stop 可在 run 生命周期内转发。
  const runId = createId("deep-run");
  const controlHandle = createDeepRunControlHandle();
  state.controlHandles.set(runId, controlHandle);

  // 重新派生 TaskSoil（会话创建时已校验并写入 soil；此处为 run 输入构造 TaskSoil 对象）。
  const goalId = createId("goal");
  const traceId = createId("trace");
  const createdAt = nowIso();
  const [capabilitySnapshot, informationAccess, toolConfirmation] = await Promise.all([
    runtime.capabilityCenter.snapshot(workspaceSnapshotInput(conversation.birthWorkspaceDirectory)),
    runtime.configCenter.getInformationAccessConfig(),
    runtime.configCenter.getToolConfirmationConfig(),
  ]);
  const taskSoil = createTaskSoilFromDesktopInput({
    goal: deepConversationGoal(conversation),
    goalId,
    traceId,
    aiMode,
    constraints: state.minimalRuntime.constraints,
    soilStore: state.minimalRuntime.soilStore,
    taskSoilInput: conversation.taskSoilInput,
    createdAt,
  });

  // EP1：构造真实模型接入 + 桌面 ToolCenter 的 DeepRuntimeConfig（严禁 mock fallback 伪装完成）。
  const deepRuntime = await buildDeepRuntimeConfigForRun({
    runtime,
    state,
    aiMode,
    controlHandle,
    taskSoil,
    capabilitySnapshot,
    informationAccess,
  }).catch((error: unknown) => {
    state.controlHandles.delete(runId);
    throw error;
  });
  state.runFacts.set(runId, {
    aiMode,
    informationAccess,
    taskSoil,
    permissionBoundaryRefs: conversation.permissionBoundaryRefs,
    confirmationPolicy: toolConfirmation.policy,
  });

  const startInput: StartDeepRuntimeInput = {
    conversation,
    taskSoil,
    permissionBoundaryRefs: conversation.permissionBoundaryRefs,
    confirmationPolicy: toolConfirmation.policy,
    aiMode,
    capabilitySnapshot,
    modelAvailable: aiMode !== "none",
    traceId,
    goalId,
    runId,
    parentRunId: input.parentRunId,
    rootRunId: input.rootRunId ?? runId,
    turnOrdinal: input.turnOrdinal ?? 1,
    followUpContext: input.followUpContext,
    intakeContext: input.intakeContext,
  };

  // 后台执行：不阻塞 HTTP；run 完成后 record 写入 store，供 /view 与 /events 轮询读取。
  const runPromise = executeDeepRun(startInput, deepRuntime.config).then(
    () => {
      /* run 完成：record 已由 executeDeepRun 写入 runRecordStore；controlHandle 保留以便
         后续 interrupt/correct/stop 端点对已完成 run 返回明确状态（终态后请求为 no-op）。 */
    },
    (error: unknown) => {
      // 后台 run 失败：记录失败 record（若有 result）或写入最小失败投影，保证 /view 可见终态。
      void writeFailureRecord(state, runId, conversation, error, {
        parentRunId: input.parentRunId,
        rootRunId: input.rootRunId ?? runId,
        turnOrdinal: input.turnOrdinal ?? 1,
      });
    },
  );
  runPromise.finally(() => {
    deepRuntime.releaseResources();
    state.activeRuns.delete(runPromise);
  });
  state.activeRuns.add(runPromise);

  return {
    runId,
    runKind,
    runMode,
    rootRunId: input.rootRunId ?? runId,
    turnOrdinal: input.turnOrdinal ?? 1,
  };
}

async function handleDeepRunFollowUp(
  runtime: PanelRuntime,
  state: DeepRouteState,
  runId: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const previous = await requireDeepRunRecord(state, runId);
  if (!isTerminalDeepRunStatus(previous.run.status)) {
    throw new PanelHttpError(
      409,
      "deep_follow_up_requires_terminal_run",
      "当前多 Agent 运行仍在进行中，请直接补充要求。",
    );
  }
  const conversation = await state.conversationStore.get(previous.run.conversationId);
  if (conversation === undefined) {
    throw new PanelHttpError(404, "deep_conversation_not_found", "未找到该多 Agent 会话。");
  }
  const body = await readJsonBody(request);
  const record = asRecord(body);
  const message = stringField(record.message);
  if (message.length === 0) {
    throw new PanelHttpError(400, "empty_follow_up_message", "继续多 Agent 任务需要非空补充。");
  }
  const aiMode = await resolveDeepAiMode(runtime, record.aiMode);
  const taskSoilInput = hasTaskSoilPayload(record)
    ? parseDesktopTaskSoilInput(record)
    : conversation.taskSoilInput;
  const birthWorkspaceDirectory =
    conversation.birthWorkspaceDirectory ??
    workspaceDirectoryFromDeepRunRecord(previous) ??
    optionalStringField(record.workspaceDirectory);
  const updatedConversation: DeepConversation = {
    ...conversation,
    birthWorkspaceDirectory,
    taskSoilInput,
    permissionBoundaryRefs: taskSoilInput?.permissionBoundaryRefs ?? conversation.permissionBoundaryRefs,
    updatedAt: nowIso(),
  };
  await state.conversationStore.upsert(updatedConversation);

  const rootRunId = previous.run.rootRunId ?? previous.run.runId;
  const turnOrdinal = await nextDeepRunTurnOrdinal(state, rootRunId);
  const followUpContext = buildDeepFollowUpContext(previous, message);
  const started = await startDeepRunBackground({
    state,
    runtime,
    conversation: updatedConversation,
    aiMode,
    parentRunId: previous.run.runId,
    rootRunId,
    turnOrdinal,
    followUpContext,
  });

  writeJson(response, 202, {
    ok: true,
    status: "running",
    conversationId: updatedConversation.conversationId,
    runId: started.runId,
    parentRunId: previous.run.runId,
  });
}

// ---------------------------------------------------------------------------
// T3-1：GET /api/deep/conversations/:id/runs —— 历史复盘
// ---------------------------------------------------------------------------

async function handleListAllDeepRuns(
  state: DeepRouteState,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const records = await state.runRecordStore.list(parseDeepRunListLimit(url));
  const runs = await projectLatestDeepRunSummaries(state, records);
  writeJson(response, 200, { ok: true, runs });
}

async function handleListDeepRuns(
  state: DeepRouteState,
  conversationId: string,
  response: ServerResponse,
): Promise<void> {
  const conversation = await state.conversationStore.get(conversationId);
  if (conversation === undefined) {
    throw new PanelHttpError(404, "deep_conversation_not_found", "未找到该多 Agent 会话。");
  }
  const records = await state.runRecordStore.list(200);
  const runs = await projectLatestDeepRunSummaries(
    state,
    records.filter((record) => record.run.conversationId === conversationId),
  );
  writeJson(response, 200, { ok: true, conversationId, runs });
}

// ---------------------------------------------------------------------------
// T3-1：GET /api/deep/runs/:runId/view —— run tree 投影 + 结论 + replay
// ---------------------------------------------------------------------------

async function handleGetDeepRunView(
  state: DeepRouteState,
  runId: string,
  response: ServerResponse,
): Promise<void> {
  const record = await state.runRecordStore.get(runId);
  if (record === undefined) {
    throw new PanelHttpError(404, "deep_run_not_found", "未找到该多 Agent 运行（可能仍在运行中）。");
  }
  writeJson(response, 200, { ok: true, view: await projectDeepRunViewForResponse(state, record) });
}

// ---------------------------------------------------------------------------
// T3-2：GET /api/deep/runs/:runId/events —— SSE 流式（deep.* 安全投影）
// ---------------------------------------------------------------------------

/**
 * SSE 轮询模型（复用 run-routes 口径）：每 100ms 轮询 runRecordStore.get(runId)，
 * 增量写出 record.eventSequence 中尚未发送的事件；run 进入终态后写完剩余事件并关闭。
 *
 * 当前 deep-runtime 会在 manager 决策、child 启动/完成/失败、综合完成等节点实时 upsert
 * record.eventSequence；SSE 只负责即时触发前端刷新，权威状态仍来自 `/view`。
 * 事件均为安全投影（EP3），不含 raw prompt/response/output。
 */
function handleDeepRunEventsSse(
  state: DeepRouteState,
  runId: string,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): void {
  let lastSequence = parseStreamCursor(
    url.searchParams.get("cursor"),
    request.headers["last-event-id"],
  );
  let closed = false;
  let flushing = false;

  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store, no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  response.write(`: AgentArbor multi-agent run stream ${runId}\n\n`);

  const cleanup = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    clearInterval(interval);
    response.end();
  };

  const flush = (): void => {
    if (closed || flushing) {
      return;
    }
    flushing = true;
    state.runRecordStore
      .get(runId)
      .then((record) => {
        if (closed) {
          return;
        }
        if (record === undefined) {
          // run 仍在进行中：record 尚未写入，保持连接（无事件可推）。
          return;
        }
        for (const event of record.eventSequence) {
          if (event.sequence <= lastSequence) {
            continue;
          }
          writeSseEvent(response, event);
          lastSequence = event.sequence;
        }
        if (isTerminalDeepRunStatus(record.run.status)) {
          cleanup();
        }
      })
      .catch(() => {
        /* 读取失败不中断流；下一轮 flush 重试。 */
      })
      .finally(() => {
        flushing = false;
      });
  };

  const interval = setInterval(flush, 100);
  request.on("close", cleanup);
  flush();
}

// ---------------------------------------------------------------------------
// T3-3：POST /api/deep/runs/:runId/interrupt|correct|stop —— 控制端点
// ---------------------------------------------------------------------------

async function handleDeepRunControl(
  state: DeepRouteState,
  runId: string,
  action: "interrupt" | "correct" | "stop",
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const handle = state.controlHandles.get(runId);
  if (handle === undefined) {
    throw new PanelHttpError(
      404,
      "deep_run_control_not_found",
      "未找到该 run 的控制句柄（run 不存在或已被回收）。",
    );
  }
  const body = await readJsonBody(request);
  const record = asRecord(body);
  const reason = optionalStringField(record.reason);
  if (action === "interrupt") {
    handle.requestInterrupt(reason);
  } else if (action === "stop") {
    handle.requestStop(reason);
  } else {
    // correct：必须携带补充上下文（注入下一 manager 决策 step）。
    const correctionContext = parseCorrectionContext(record);
    handle.requestCorrect(correctionContext, reason);
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
  runtime: PanelRuntime,
  state: DeepRouteState,
  runId: string,
  childRunId: string,
  confirmationId: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readJsonBody(request);
  const parsed = parseConfirmationDecision(body);
  const continuation = state.childContinuations.consume(runId, childRunId, confirmationId);
  if (continuation === undefined) {
    throw new PanelHttpError(
      409,
      "confirmation_continuation_lost",
      "该子 Agent 的确认上下文已不可恢复，请让父 Agent 补充指令后继续该子任务。",
    );
  }
  const record = await requireDeepRunRecord(state, runId);
  const childRuntime = await createTurnRuntimeForExistingDeepRun(runtime, state, record);
  let result: DeepChildAgentRunResult;
  try {
    result = await resumeDeepChildAgent({
      childRun: continuation.childRun,
      childSpec: continuation.childSpec,
      pendingApproval: continuation.pendingApproval,
      decision: parsed as DeepChildConfirmationDecision,
      turnRuntime: childRuntime.turnRuntime,
    });
  } finally {
    childRuntime.releaseResources();
  }
  state.childContinuations.remember(runId, result.pendingContinuation);
  const updated = await applyChildOperationResult(state, record, result, {
    eventTitle: result.completedRun.status === "completed" ? "子 Agent 已继续" : "子 Agent 继续受阻",
    eventSummary:
      result.completedRun.status === "completed"
        ? result.summary.summary
        : result.completedRun.failureReason ?? result.summary.uncertainty ?? "子 Agent 需要继续处理。",
  });
  writeJson(response, 200, { ok: true, view: await projectDeepRunViewForResponse(state, updated) });
}

async function handleDeepChildParentMessage(
  runtime: PanelRuntime,
  state: DeepRouteState,
  runId: string,
  childRunId: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readJsonBody(request);
  const record = await requireDeepRunRecord(state, runId);
  const message = parseParentChildMessage(body);
  const queueHandle = state.childInstructionQueues.get(runId);
  if (queueHandle !== undefined) {
    const queued = queueHandle.queueChildInstruction({
      childRunId,
      instruction: message,
    });
    if (queued.status === "queued") {
      await recordDeepChildMessage(state, {
        runId,
        childRunId,
        instructionId: queued.instructionId,
        messageRef: queued.messageRef,
        source: "control_api",
        status: "queued",
        content: message,
        requestedAt: queued.queuedAt,
        queuedAt: queued.queuedAt,
      });
      writeJson(response, 202, {
        ok: true,
        status: "queued",
        runId,
        childRunId,
        messageRef: queued.messageRef,
        childStatus: queued.childStatus,
        queuedCount: queued.queuedCount,
        queuedAt: queued.queuedAt,
        view: await projectDeepRunViewForResponse(state, record),
      });
      return;
    }
    if (isTerminalChildInstructionRejection(queued)) {
      const continued = await queueHandle.continueChildInstruction({
        childRunId,
        instruction: message,
      });
      if (continued.status === "continued") {
        const latest = await state.runRecordStore.get(runId);
        await recordDeepChildMessageForResult(state, runId, message, continued.material.completedRun);
        writeJson(response, 200, {
          ok: true,
          status: "continued",
          runId,
          childRunId,
          messageRef: continued.material.completedRun.parentInstructions?.at(-1)?.messageRef,
          view: await projectDeepRunViewForResponse(state, latest ?? record),
        });
        return;
      }
      throwDeepChildInstructionQueueRejection(continued);
    }
    throwDeepChildInstructionQueueRejection(queued);
  }
  const childState = resolveChildOperationTarget(state, record, childRunId);
  state.childContinuations.deleteForChildRun(runId, childRunId);
  const childRuntime = await createTurnRuntimeForExistingDeepRun(runtime, state, record);
  let result: DeepChildAgentRunResult;
  try {
    const requestedAt = nowIso();
    const instructionId = createId("deep-child-instruction");
    const messageRef = parentInstructionMessageRef(instructionId);
    const childRunWithInstruction = recordChildAgentRunParentInstruction(
      childState.childRun,
      {
        instructionId,
        messageRef,
        source: "control_api",
        status: "executed",
        instructionSummary: parentInstructionSummary(message),
        requestedAt,
        executedAt: requestedAt,
      },
    );
    result = await continueDeepChildAgent({
      childRun: childRunWithInstruction,
      childSpec: childState.childSpec,
      previousSummary: childState.previousSummary,
      parentInstruction: message,
      currentParentInstructionRef: messageRef,
      parentMessageHistory: await loadDeepChildParentMessageContext(state, runId, childRunId),
      goal: record.run.goal,
      permissionBoundaryRefs: state.runFacts.get(runId)?.permissionBoundaryRefs ?? [],
      turnRuntime: childRuntime.turnRuntime,
      traceId: runId,
      goalId: record.run.conversationId,
      confirmationPolicy: state.runFacts.get(runId)?.confirmationPolicy ?? "prompt",
      capabilitySnapshot: record.run.capabilitySnapshot,
    });
    await recordDeepChildMessage(state, {
      runId,
      childRunId,
      instructionId,
      messageRef,
      source: "control_api",
      status: "executed",
      content: message,
      requestedAt,
      executedAt: requestedAt,
    });
  } finally {
    childRuntime.releaseResources();
  }
  state.childContinuations.remember(runId, result.pendingContinuation);
  const updated = await applyChildOperationResult(state, record, result, {
    eventTitle: "父 Agent 已补充子任务",
    eventSummary: result.summary.summary,
  });
  writeJson(response, 200, {
    ok: true,
    status: "continued",
    runId,
    childRunId,
    messageRef: result.completedRun.parentInstructions?.at(-1)?.messageRef,
    view: await projectDeepRunViewForResponse(state, updated),
  });
}

async function handleDeepRunResynthesize(
  runtime: PanelRuntime,
  state: DeepRouteState,
  runId: string,
  response: ServerResponse,
): Promise<void> {
  const record = await requireDeepRunRecord(state, runId);
  const childSummaries = record.report?.childSummaries;
  if (childSummaries === undefined || childSummaries.length === 0) {
    throw new PanelHttpError(
      409,
      "deep_resynthesis_no_child_material",
      "该多 Agent 运行没有可供父层重新综合的子 Agent 材料。",
    );
  }
  const childRuns = record.agentRunTree.childRuns;
  if (childRuns.length === 0) {
    throw new PanelHttpError(
      409,
      "deep_resynthesis_no_child_runs",
      "该多 Agent 运行缺少子 Agent run 记录，无法重新综合。",
    );
  }
  const childRuntime = await createTurnRuntimeForExistingDeepRun(runtime, state, record);
  let synthesis: {
    readonly conclusion: SynthesizedConclusion;
    readonly synthesisRecord: ParentSynthesisResult;
  };
  try {
    synthesis = await synthesizeDeepConclusion({
      turnRuntime: childRuntime.turnRuntime,
      traceId: childRuntime.taskSoil.traceId ?? record.run.runId,
      goalId: childRuntime.taskSoil.goalId ?? record.run.conversationId,
      runId: record.run.runId,
      goal: record.run.goal,
      taskSoil: childRuntime.taskSoil,
      childSummaries,
      completedChildRuns: childRuns,
      evidenceRefs: collectChildEvidenceRefs(childSummaries),
      inputRefs: buildResynthesisInputRefs(record),
      maxModelRounds: DEEP_MANAGER_MAX_MODEL_ROUNDS,
      maxToolRounds: DEEP_MANAGER_MAX_TOOL_ROUNDS,
      createdAt: nowIso(),
    });
  } finally {
    childRuntime.releaseResources();
  }
  const updated = await applyResynthesisResult(state, record, synthesis);
  writeJson(response, 200, { ok: true, view: await projectDeepRunViewForResponse(state, updated) });
}

// ---------------------------------------------------------------------------
// Intake 辅助：会话解析 / 模型 turn / 安全上下文
// ---------------------------------------------------------------------------

async function resolveDeepIntakeConversation(input: {
  readonly runtime: PanelRuntime;
  readonly state: DeepRouteState;
  readonly aiMode: ModelRuntimeMode;
  readonly conversationId?: string;
  readonly message: string;
  readonly taskSoilInput?: DesktopTaskSoilInput;
  readonly workspaceDirectory?: string;
}): Promise<DeepConversation> {
  if (input.conversationId !== undefined) {
    const existing = await input.state.conversationStore.get(input.conversationId);
    if (existing === undefined) {
      throw new PanelHttpError(404, "deep_conversation_not_found", "未找到该多 Agent 会话。");
    }
    return mergeDeepConversationTaskSoil(existing, input.taskSoilInput, input.workspaceDirectory);
  }
  const service = createDeepConversationService({
    store: input.state.conversationStore,
    runtime: input.state.minimalRuntime,
    aiMode: input.aiMode,
  });
  return service.create({
    title: optionalStringField(input.message),
    goal: input.message,
    birthWorkspaceDirectory: input.workspaceDirectory,
    taskSoilInput: input.taskSoilInput,
  });
}

async function executeDeepIntakeTurn(input: {
  readonly runtime: PanelRuntime;
  readonly state: DeepRouteState;
  readonly aiMode: ModelRuntimeMode;
  readonly conversation: DeepConversation;
  readonly message: string;
  readonly terminalRun?: DeepRunRecord;
}): Promise<DeepIntakeTurn> {
  const [capabilitySnapshot, informationAccess] = await Promise.all([
    input.runtime.capabilityCenter.snapshot(workspaceSnapshotInput(input.conversation.birthWorkspaceDirectory)),
    input.runtime.configCenter.getInformationAccessConfig(),
  ]);
  const resources = await prepareDesktopRunResources(input.runtime, input.aiMode, {
    capabilitySnapshot,
    informationAccess,
  }).catch((error: unknown) => {
    if (error instanceof ModelRuntimeConfigurationError) {
      throw new PanelHttpError(
        409,
        "deep_model_not_configured",
        `多 Agent 入口理解所需模型未就绪：${error.issue.message}`,
      );
    }
    throw error;
  });
  try {
    const turnRuntime = createDeepTurnRuntime({
      intelligenceChannel: resources.aiConfig.createIntelligenceChannel(input.state.minimalRuntime),
    });
    const traceId = createId("trace");
    const goalId = createId("goal");
    const callerRef: ObservationRef = {
      kind: "agent_run",
      id: `deep-intake:${input.conversation.conversationId}`,
      label: "deep-intake",
    };
    const turn = await executeDeepTurn({
      turnRuntime,
      traceId,
      goalId,
      callerAgentId: "deep-intake",
      callerRef,
      purpose: "deep_intake",
      outputContract: deepIntakeOutputContract(),
      inputRefs: [
        { kind: "trace", id: traceId },
        { kind: "goal", id: goalId, label: input.conversation.conversationId },
      ],
      messages: deepIntakeMessages({
        message: input.message,
        conversationGoal: input.conversation.goal,
        currentObjective: input.conversation.currentObjective,
        intakeTurns: input.conversation.intakeTurns,
        terminalRunSummary: input.terminalRun === undefined
          ? undefined
          : summarizeTerminalDeepRunForIntake(input.terminalRun),
        taskSoilSummary: summarizeTaskSoilInputForIntake(input.conversation.taskSoilInput),
      }),
      allowedTools: [],
      maxModelRounds: 1,
      maxToolRounds: 0,
    });
    return parseDeepIntake({
      value: extractStructuredOutput(turn.finalOutput),
      userMessage: input.message,
      createdAt: nowIso(),
    });
  } finally {
    void resources.mcpManager?.disconnectAll?.().catch(() => undefined);
  }
}

function mergeDeepConversationTaskSoil(
  conversation: DeepConversation,
  taskSoilInput: DesktopTaskSoilInput | undefined,
  birthWorkspaceDirectory?: string,
): DeepConversation {
  const nextBirthWorkspaceDirectory =
    conversation.birthWorkspaceDirectory ?? optionalStringField(birthWorkspaceDirectory);
  if (
    taskSoilInput === undefined &&
    nextBirthWorkspaceDirectory === conversation.birthWorkspaceDirectory
  ) {
    return conversation;
  }
  return {
    ...conversation,
    birthWorkspaceDirectory: nextBirthWorkspaceDirectory,
    taskSoilInput: taskSoilInput ?? conversation.taskSoilInput,
    permissionBoundaryRefs: taskSoilInput?.permissionBoundaryRefs ?? conversation.permissionBoundaryRefs,
    updatedAt: nowIso(),
  };
}

async function applyDeepBirthWorkspace(
  state: DeepRouteState,
  conversation: DeepConversation,
  birthWorkspaceDirectory: string | undefined,
): Promise<DeepConversation> {
  const updated = mergeDeepConversationTaskSoil(conversation, undefined, birthWorkspaceDirectory);
  return updated === conversation ? conversation : state.conversationStore.upsert(updated);
}

function workspaceSnapshotInput(
  workspaceDirectory: string | undefined,
): { readonly workspaceDirectory?: string } {
  const normalized = optionalStringField(workspaceDirectory);
  return normalized === undefined ? {} : { workspaceDirectory: normalized };
}

function appendDeepIntakeTurn(
  conversation: DeepConversation,
  intake: DeepIntakeTurn,
): DeepConversation {
  return {
    ...conversation,
    intakeTurns: [...(conversation.intakeTurns ?? []), intake],
    updatedAt: intake.createdAt,
  };
}

function intakeContextFromTurn(intake: DeepIntakeTurn): DeepIntakeContext {
  return {
    normalizedObjective: intake.normalizedObjective,
    plan: intake.plan,
    assistantMessage: intake.assistantMessage,
    uncertainty: intake.uncertainty,
    confidence: intake.confidence,
  };
}

function deepConversationGoal(conversation: DeepConversation): string {
  return conversation.currentObjective ?? conversation.goal;
}

// ---------------------------------------------------------------------------
// EP1：DeepRuntimeConfig 构造链（严禁 mock）
// ---------------------------------------------------------------------------

/**
 * 从 PanelRuntime 的冻结 capability/information facts 构造真实模型接入的 DeepRuntimeConfig。
 * 复用 desktop-run-resources 链路：prepareDesktopRunResources → ToolCenter →
 * IntelligenceChannel → createDeepTurnRuntime。这样 manager 与 child 都走同一套模型、
 * 工具、MCP 和确认门边界。
 */
async function buildDeepRuntimeConfigForRun(input: {
  readonly runtime: PanelRuntime;
  readonly state: DeepRouteState;
  readonly aiMode: ModelRuntimeMode;
  readonly controlHandle: DeepRunControlHandle;
  readonly taskSoil: StartDeepRuntimeInput["taskSoil"];
  readonly capabilitySnapshot: NonNullable<StartDeepRuntimeInput["capabilitySnapshot"]>;
  readonly informationAccess: Awaited<ReturnType<PanelRuntime["configCenter"]["getInformationAccessConfig"]>>;
}): Promise<{ readonly config: DeepRuntimeConfig; readonly releaseResources: () => void }> {
  const { runtime, state, aiMode, controlHandle } = input;
  if (aiMode === "none") {
    // AI-first 边界（需求 A3）：显式 none 模式 = 无可用模型，拒绝启动 deep run，
    // 返回明确客户端错误，不 fallback 伪装完成，也不以 500 internal error 暴露。
    throw new PanelHttpError(
      409,
      "deep_model_not_configured",
      "多 Agent 运行需要可用模型，当前未配置 AI 模式。",
    );
  }
  const resources = await prepareDesktopRunResources(runtime, aiMode, {
    capabilitySnapshot: input.capabilitySnapshot,
    informationAccess: input.informationAccess,
  }).catch((error: unknown) => {
    if (error instanceof ModelRuntimeConfigurationError) {
      throw new PanelHttpError(
        409,
        "deep_model_not_configured",
        `多 Agent 运行所需模型未就绪：${error.issue.message}`,
      );
    }
    throw error;
  });
  // prepareDesktopRunResources 统一处理 fake/real provider、MCP、命令 shell 与
  // ToolCenter 资源；配置错误统一归一为客户端可恢复的 deep_model_not_configured。
  const toolCenter = createDesktopToolCenterFactory(runtime.providerFetch, resources)(
    state.minimalRuntime,
    {
      runtime: state.minimalRuntime,
      traceId: input.taskSoil.traceId ?? "deep-run",
      goalId: input.taskSoil.goalId ?? "deep-goal",
      skillContexts: [],
      taskSoil: input.taskSoil,
    },
  );
  const intelligenceChannel = resources.aiConfig.createIntelligenceChannel(state.minimalRuntime);
  const turnRuntime = createDeepTurnRuntime({ intelligenceChannel, toolCenter });
  return {
    config: {
      turnRuntime,
      runtime: state.minimalRuntime,
      store: state.runRecordStore,
      controlHandle,
      childContinuations: state.childContinuations,
      childInstructionQueues: state.childInstructionQueues,
      childMessageStore: state.childMessageStore,
    },
    releaseResources: () => {
      void resources.mcpManager?.disconnectAll?.().catch(() => undefined);
    },
  };
}

async function createTurnRuntimeForExistingDeepRun(
  runtime: PanelRuntime,
  state: DeepRouteState,
  record: DeepRunRecord,
): Promise<{
  readonly turnRuntime: ReturnType<typeof createDeepTurnRuntime>;
  readonly taskSoil: StartDeepRuntimeInput["taskSoil"];
  readonly releaseResources: () => void;
}> {
  const capabilitySnapshot = record.run.capabilitySnapshot;
  if (capabilitySnapshot === undefined) {
    throw new PanelHttpError(
      409,
      "deep_capability_snapshot_missing",
      "该多 Agent 运行缺少冻结能力快照，无法继续子 Agent。",
    );
  }
  const facts = state.runFacts.get(record.run.runId);
  const informationAccess = facts?.informationAccess ?? await runtime.configCenter.getInformationAccessConfig();
  const aiMode = facts?.aiMode ?? record.run.aiMode ?? capabilitySnapshot.activeModel.defaultAiMode;
  const taskSoil = facts?.taskSoil ?? createTaskSoilFromDesktopInput({
    goal: record.run.goal,
    goalId: record.run.conversationId,
    traceId: record.run.runId,
    aiMode,
    constraints: state.minimalRuntime.constraints,
    soilStore: state.minimalRuntime.soilStore,
  });
  const resources = await prepareDesktopRunResources(runtime, aiMode, {
    capabilitySnapshot,
    informationAccess,
  });
  const toolCenter = createDesktopToolCenterFactory(runtime.providerFetch, resources)(
    state.minimalRuntime,
    {
      runtime: state.minimalRuntime,
      traceId: taskSoil.traceId ?? record.run.runId,
      goalId: taskSoil.goalId ?? record.run.conversationId,
      skillContexts: [],
      taskSoil,
    },
  );
  return {
    turnRuntime: createDeepTurnRuntime({
      intelligenceChannel: resources.aiConfig.createIntelligenceChannel(state.minimalRuntime),
      toolCenter,
    }),
    taskSoil,
    releaseResources: () => {
      void resources.mcpManager?.disconnectAll?.().catch(() => undefined);
    },
  };
}

async function requireDeepRunRecord(
  state: DeepRouteState,
  runId: string,
): Promise<DeepRunRecord> {
  const record = await state.runRecordStore.get(runId);
  if (record === undefined) {
    throw new PanelHttpError(404, "deep_run_not_found", "未找到该多 Agent 运行。");
  }
  return record;
}

function parseParentChildMessage(raw: unknown): string {
  const record = asRecord(raw);
  const message = optionalStringField(record.message) ?? optionalStringField(record.instruction);
  if (message === undefined) {
    throw new PanelHttpError(400, "empty_child_instruction", "子 Agent 补充要求不能为空。");
  }
  return message;
}

function parentInstructionSummary(instruction: string): string {
  return summarizeDeepChildMessage(instruction);
}

function parentInstructionMessageRef(instructionId: string): string {
  return createDeepChildMessageRef(instructionId);
}

function throwDeepChildInstructionQueueRejection(
  result: Exclude<DeepChildInstructionQueueResult, { readonly status: "queued" }>,
): never {
  throw deepChildInstructionQueueRejectionError(result);
}

function isTerminalChildInstructionRejection(
  result: Exclude<DeepChildInstructionQueueResult, { readonly status: "queued" }>,
): boolean {
  return result.status === "not_accepting" &&
    (
      result.childStatus === "completed" ||
      result.childStatus === "failed" ||
      result.childStatus === "blocked" ||
      result.childStatus === "interrupted"
    );
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

function resolveChildOperationTarget(
  state: DeepRouteState,
  record: DeepRunRecord,
  childRunId: string,
): {
  readonly childRun: ChildAgentRun;
  readonly childSpec: DeepChildSpec | undefined;
  readonly previousSummary: DeepChildSummary | undefined;
} {
  const previousSummary = findChildSummary(record, childRunId);
  const childRun = findChildRun(record, childRunId);
  if (childRun !== undefined) {
    return {
      childRun,
      childSpec: previousSummary?.spec ?? childRunSpecFromRun(childRun),
      previousSummary,
    };
  }
  const continuation = findContinuationForChild(state, record.run.runId, childRunId);
  if (continuation !== undefined) {
    return {
      childRun: continuation.childRun,
      childSpec: continuation.childSpec,
      previousSummary,
    };
  }
  throw new PanelHttpError(404, "deep_child_run_not_found", "未找到该子 Agent。");
}

function findChildRun(record: DeepRunRecord, childRunId: string): ChildAgentRun | undefined {
  const childRun = record.agentRunTree.childRuns.find((run) => run.childRunId === childRunId);
  return childRun;
}

function findChildSummary(
  record: DeepRunRecord,
  childRunId: string,
): DeepChildSummary | undefined {
  return record.report?.childSummaries.find((summary) => summary.childRunId === childRunId);
}

function findContinuationForChild(
  state: DeepRouteState,
  runId: string,
  childRunId: string,
): ReturnType<DeepChildPendingContinuationStore["findByChildRun"]> {
  return state.childContinuations.findByChildRun(runId, childRunId);
}

function childRunSpecFromRun(childRun: ChildAgentRun): DeepChildSpec {
  return {
    specId: childRun.spec.specId,
    displayName: childRun.spec.displayName,
    role: childRun.spec.role,
    objective: childRun.spec.instructions?.objective ?? childRun.spec.role,
    allowedTools: [...childRun.spec.permissions.allowedTools],
    inputRefs: [...childRun.spec.inputRefs],
    maxModelRounds: childRun.spec.permissions.maxModelRounds,
    maxToolRounds: childRun.spec.permissions.maxToolRounds,
  };
}

async function recordDeepChildMessageForResult(
  state: DeepRouteState,
  runId: string,
  content: string,
  childRun: ChildAgentRun,
): Promise<void> {
  const instruction = childRun.parentInstructions?.at(-1);
  if (instruction === undefined) {
    return;
  }
  await recordDeepChildMessage(state, {
    runId,
    childRunId: childRun.childRunId,
    instructionId: instruction.instructionId,
    messageRef: instruction.messageRef ?? parentInstructionMessageRef(instruction.instructionId),
    source: instruction.source,
    status: instruction.status,
    content,
    requestedAt: instruction.requestedAt,
    queuedAt: instruction.queuedAt,
    executedAt: instruction.executedAt,
    cancelledAt: instruction.cancelledAt,
  });
}

async function loadDeepChildParentMessageContext(
  state: DeepRouteState,
  runId: string,
  childRunId: string,
): Promise<readonly DeepChildParentMessageContext[]> {
  const records = await state.childMessageStore.listForChild(runId, childRunId);
  return records
    .filter((record) => record.status === "executed")
    .map((record) => ({
      messageRef: record.messageRef,
      source: record.source,
      status: record.status,
      content: record.content,
      updatedAt: record.updatedAt,
    }));
}

async function recordDeepChildMessage(
  state: DeepRouteState,
  input: DeepChildMessageInput,
): Promise<void> {
  await state.childMessageStore.upsert(createDeepChildMessageRecord(input));
}

async function applyChildOperationResult(
  state: DeepRouteState,
  record: DeepRunRecord,
  result: DeepChildAgentRunResult,
  copy: {
    readonly eventTitle: string;
    readonly eventSummary: string;
  },
): Promise<DeepRunRecord> {
  const updatedAt = nowIso();
  const replacedTree = replaceChildRunInTree(record.agentRunTree, result.completedRun, updatedAt);
  const latestParentInstruction = result.completedRun.parentInstructions?.at(-1);
  const childInstructionRef =
    latestParentInstruction === undefined
      ? undefined
      : latestParentInstruction.messageRef ?? parentInstructionMessageRef(latestParentInstruction.instructionId);
  const agentRunTree = appendDelegationDecisionToTree(
    replacedTree,
    {
      decisionId: createId("deep-decision"),
      parentAgentId: result.completedRun.parentAgentId,
      action: "resume_child",
      childSpecIds: [result.completedRun.spec.specId],
      childRunIds: [result.completedRun.childRunId],
      inputRefs: [
        `child_run:${result.completedRun.childRunId}`,
        ...(childInstructionRef === undefined ? [] : [childInstructionRef]),
      ],
      rationale: copy.eventTitle,
      uncertainty: result.summary.uncertainty ?? result.completedRun.failureReason ?? "",
      source: "control_api",
      confidence: result.summary.confidence ?? result.completedRun.confidence ?? 0.5,
      reasoningTraceRefs: [
        ...(childInstructionRef === undefined ? [] : [childInstructionRef]),
        `child_run:${result.completedRun.childRunId}`,
      ],
      createdAt: latestParentInstruction?.requestedAt ?? updatedAt,
    },
    updatedAt,
  );
  const report = record.report === undefined
    ? undefined
    : {
        ...record.report,
        agentRunTree,
        childSummaries: replaceChildSummary(record.report.childSummaries, result.summary),
      };
  const liveProjection = updateLiveProjectionForChild(
    record.liveProjection ?? fallbackLiveProjectionForRecord(record),
    result,
    updatedAt,
    { markSynthesisPending: record.report?.conclusion !== undefined },
  );
  const eventSequence = appendChildOperationEvent(record, result.completedRun, {
    title: copy.eventTitle,
    summary: copy.eventSummary,
    timestamp: updatedAt,
  });
  const updated: DeepRunRecord = {
    ...record,
    run: {
      ...record.run,
      updatedAt,
    },
    agentRunTree,
    report,
    eventSequence,
    liveProjection,
    updatedAt,
  };
  await state.runRecordStore.upsert(updated);
  return updated;
}

async function applyResynthesisResult(
  state: DeepRouteState,
  record: DeepRunRecord,
  synthesis: {
    readonly conclusion: SynthesizedConclusion;
    readonly synthesisRecord: ParentSynthesisResult;
  },
): Promise<DeepRunRecord> {
  const updatedAt = nowIso();
  const agentRunTree = appendParentSynthesisToTree(
    record.agentRunTree,
    synthesis.synthesisRecord,
    updatedAt,
  );
  const report = record.report === undefined
    ? undefined
    : {
        ...record.report,
        agentRunTree,
        synthesisRecords: [...record.report.synthesisRecords, synthesis.synthesisRecord],
        conclusion: synthesis.conclusion,
      };
  const liveProjection = updateLiveProjectionForResynthesis(
    record.liveProjection ?? fallbackLiveProjectionForRecord(record),
    synthesis,
    updatedAt,
  );
  const eventSequence = appendResynthesisEvents(record, synthesis, updatedAt);
  const updated: DeepRunRecord = {
    ...record,
    run: {
      ...record.run,
      updatedAt,
    },
    agentRunTree,
    report,
    eventSequence,
    liveProjection,
    updatedAt,
  };
  await state.runRecordStore.upsert(updated);
  return updated;
}

function updateLiveProjectionForResynthesis(
  projection: DeepLiveProjection,
  synthesis: {
    readonly conclusion: SynthesizedConclusion;
    readonly synthesisRecord: ParentSynthesisResult;
  },
  updatedAt: string,
): DeepLiveProjection {
  return {
    ...projection,
    phase: "completed",
    activeNodeId: "conclusion",
    synthesis: {
      synthesisId: synthesis.synthesisRecord.synthesisId,
      status: "completed",
      summary: synthesis.synthesisRecord.decisionSummary,
      confidence: synthesis.synthesisRecord.confidence,
      updatedAt,
    },
    conclusion: {
      conclusionId: synthesis.conclusion.conclusionId,
      oneLineRationale: synthesis.conclusion.oneLineRationale,
      confidence: synthesis.conclusion.confidence,
      updatedAt,
    },
    updatedAt,
  };
}

function appendResynthesisEvents(
  record: DeepRunRecord,
  synthesis: {
    readonly conclusion: SynthesizedConclusion;
    readonly synthesisRecord: ParentSynthesisResult;
  },
  timestamp: string,
): readonly DeepRunStreamEvent[] {
  const baseSequence = record.eventSequence.at(-1)?.sequence ?? 0;
  const synthesisEvent: DeepRunStreamEvent = {
    id: createId("deep-evt"),
    runId: record.run.runId,
    sequence: baseSequence + 1,
    type: "deep.parent_synthesis.completed",
    title: "父层已重新综合",
    summary: synthesis.synthesisRecord.decisionSummary,
    status: "completed",
    timestamp,
    refs: [
      { kind: "parent_synthesis", refId: synthesis.synthesisRecord.synthesisId },
      ...synthesis.synthesisRecord.childRunIds.map((childRunId) => ({
        kind: "child_run" as const,
        refId: childRunId,
      })),
      { kind: "agent_run_tree", refId: record.agentRunTree.treeId },
    ],
    visibility: "public",
  };
  const conclusionEvent: DeepRunStreamEvent = {
    id: createId("deep-evt"),
    runId: record.run.runId,
    sequence: baseSequence + 2,
    type: "deep.conclusion.produced",
    title: "重新综合结论",
    summary: synthesis.conclusion.oneLineRationale,
    status: "completed",
    timestamp,
    refs: [
      { kind: "conclusion", refId: synthesis.conclusion.conclusionId },
      { kind: "parent_synthesis", refId: synthesis.synthesisRecord.synthesisId },
    ],
    visibility: "public",
  };
  return [...record.eventSequence, synthesisEvent, conclusionEvent];
}

function collectChildEvidenceRefs(childSummaries: readonly DeepChildSummary[]): string[] {
  const refs = new Set<string>();
  for (const summary of childSummaries) {
    for (const ref of summary.evidenceRefs) {
      const trimmed = ref.trim();
      if (trimmed.length > 0) {
        refs.add(trimmed);
      }
    }
  }
  return [...refs];
}

function buildResynthesisInputRefs(record: DeepRunRecord): ObservationRef[] {
  const refs: ObservationRef[] = [
    { kind: "trace", id: record.run.runId },
    { kind: "goal", id: record.run.conversationId },
    { kind: "agent_run", id: record.run.runId, label: "deep-manager-resynthesis" },
  ];
  for (const decision of record.agentRunTree.delegationDecisions) {
    refs.push({ kind: "agent_delegation", id: decision.decisionId });
  }
  for (const childRun of record.agentRunTree.childRuns) {
    refs.push({ kind: "agent_run", id: childRun.childRunId, label: childRun.spec.displayName });
  }
  return refs;
}

function replaceChildSummary(
  summaries: readonly DeepChildSummary[],
  summary: DeepChildSummary,
): readonly DeepChildSummary[] {
  const found = summaries.some((item) => item.childRunId === summary.childRunId);
  if (!found) {
    return [...summaries, summary];
  }
  return summaries.map((item) => item.childRunId === summary.childRunId ? summary : item);
}

function updateLiveProjectionForChild(
  projection: DeepLiveProjection,
  result: DeepChildAgentRunResult,
  updatedAt: string,
  options?: { readonly markSynthesisPending?: boolean },
): DeepLiveProjection {
  const child = {
    childRunId: result.completedRun.childRunId,
    displayName: result.summary.spec.displayName,
    objective: result.summary.spec.objective,
    role: result.summary.spec.role,
    status: result.completedRun.status,
    updatedAt,
    summary: result.summary.summary,
    confidence: result.summary.confidence,
    uncertainty: result.summary.uncertainty,
    pendingApproval: result.completedRun.pendingApproval,
    parentOperation: liveParentOperationFromInstruction(
      result.completedRun.parentInstructions?.at(-1),
    ),
  };
  const found = projection.children.some((item) => item.childRunId === child.childRunId);
  const children = found
    ? projection.children.map((item) => item.childRunId === child.childRunId ? child : item)
    : [...projection.children, child];
  const synthesis =
    options?.markSynthesisPending === true
      ? {
          ...(projection.synthesis ?? { status: "pending" as const }),
          status: "pending" as const,
          summary: "子 Agent 已更新，等待父层重新综合。",
          updatedAt,
        }
      : projection.synthesis;
  return {
    ...projection,
    phase: result.completedRun.status === "blocked" ? "needs_input" : projection.phase,
    activeNodeId:
      options?.markSynthesisPending === true && result.completedRun.status !== "blocked"
        ? "synthesis"
        : result.completedRun.status === "completed"
          ? "synthesis"
          : "children",
    children,
    synthesis,
    updatedAt,
  };
}

function appendChildOperationEvent(
  record: DeepRunRecord,
  childRun: ChildAgentRun,
  copy: {
    readonly title: string;
    readonly summary: string;
    readonly timestamp: string;
  },
): readonly DeepRunStreamEvent[] {
  const lastSequence = record.eventSequence.at(-1)?.sequence ?? 0;
  const type =
    childRun.status === "completed"
      ? "deep.child.completed"
      : childRun.status === "blocked"
        ? "deep.child.blocked"
        : childRun.status === "interrupted"
          ? "deep.child.interrupted"
          : "deep.child.failed";
  const event: DeepRunStreamEvent = {
    id: createId("deep-evt"),
    runId: record.run.runId,
    sequence: lastSequence + 1,
    type,
    title: copy.title,
    summary: copy.summary,
    status: childRun.status,
    timestamp: copy.timestamp,
    refs: [
      { kind: "child_run", refId: childRun.childRunId },
      { kind: "agent_run_tree", refId: record.agentRunTree.treeId },
    ],
    visibility: "public",
  };
  return [...record.eventSequence, event];
}

// ---------------------------------------------------------------------------
// 安全投影（view / list / conversation）
// ---------------------------------------------------------------------------

async function projectLatestDeepRunSummaries(
  state: DeepRouteState,
  records: readonly DeepRunRecord[],
): Promise<readonly Record<string, unknown>[]> {
  return Promise.all(
    latestDeepRunRecordsByRoot(records).map(async (record) => {
      const rootRecord = await rootDeepRunRecord(state, record);
      return projectDeepRunSummary(record, rootRecord);
    })
  );
}

async function rootDeepRunRecord(
  state: DeepRouteState,
  record: DeepRunRecord,
): Promise<DeepRunRecord | undefined> {
  const rootRunId = record.run.rootRunId ?? record.run.runId;
  return rootRunId === record.run.runId ? record : state.runRecordStore.get(rootRunId);
}

async function projectDeepRunViewForResponse(
  state: DeepRouteState,
  record: DeepRunRecord,
): Promise<Record<string, unknown>> {
  const conversation = await state.conversationStore.get(record.run.conversationId);
  return projectDeepRunView(record, conversation);
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

class DeepChildInstructionQueueStore {
  private readonly handles = new Map<string, DeepChildInstructionQueueHandle>();

  register(runId: string, handle: DeepChildInstructionQueueHandle): void {
    this.handles.set(runId, handle);
  }

  unregister(runId: string, handle: DeepChildInstructionQueueHandle): void {
    if (this.handles.get(runId) === handle) {
      this.handles.delete(runId);
    }
  }

  get(runId: string): DeepChildInstructionQueueHandle | undefined {
    return this.handles.get(runId);
  }
}

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

async function nextDeepRunTurnOrdinal(
  state: DeepRouteState,
  rootRunId: string,
): Promise<number> {
  const records = await state.runRecordStore.list(500);
  const maxOrdinal = records.reduce((max, record) => {
    const sameChain = (record.run.rootRunId ?? record.run.runId) === rootRunId;
    if (!sameChain) {
      return max;
    }
    const ordinal = record.run.turnOrdinal ?? (record.run.runId === rootRunId ? 1 : 0);
    return Math.max(max, ordinal);
  }, 0);
  return Math.max(1, maxOrdinal + 1);
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

/** 后台 run 失败时写入最小失败 record，保证 /view 可见终态（status=failed）。 */
async function writeFailureRecord(
  state: DeepRouteState,
  runId: string,
  conversation: DeepConversation,
  error: unknown,
  lineage?: {
    readonly parentRunId?: string;
    readonly rootRunId?: string;
    readonly turnOrdinal?: number;
  },
): Promise<void> {
  try {
    const now = nowIso();
    await state.runRecordStore.upsert({
      run: {
        runId,
        conversationId: conversation.conversationId,
        parentRunId: lineage?.parentRunId,
        rootRunId: lineage?.rootRunId ?? runId,
        turnOrdinal: lineage?.turnOrdinal ?? 1,
        goal: deepConversationGoal(conversation),
        status: "failed",
        isolation: {
          kind: "deep_conversation",
          runKind: DEEP_RUN_KIND,
          runMode: DEEP_RUN_MODE,
        },
        capabilitySnapshot: undefined,
        startedAt: now,
        updatedAt: now,
      },
      agentRunTree: {
        ...createAgentRunTree({
          treeId: createId("deep-tree"),
          rootRunId: runId,
          rootAgentId: "deep-manager",
          rootSpec: buildDeepManagerSpec(now),
          createdAt: now,
        }),
        status: "failed",
      },
      report: undefined,
      controlEvents: [],
      eventSequence: [
        {
          id: createId("deep-event"),
          runId,
          sequence: 0,
          type: "deep.stopped",
          title: "运行失败",
          summary: errorMessage(error),
          status: "failed",
          timestamp: now,
          refs: [],
          visibility: "public",
        },
      ],
      liveProjection: {
        phase: "failed",
        activeNodeId: "decision",
        children: [],
        updatedAt: now,
      },
      updatedAt: now,
    });
  } catch {
    /* 写失败 record 本身失败时不影响主流程（已记录原始错误）。 */
  }
}

function isTerminalDeepRunStatus(status: DeepRunStatus): boolean {
  return status !== "running";
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
