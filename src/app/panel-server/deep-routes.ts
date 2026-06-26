/**
 * deep-routes.ts —— `/api/deep/*` 产品 API 端点族（T3-1 / T3-2 / T3-3，闭环3 批次C-1）。
 *
 * 端点族（design §6.1 / §6.3，落地 FR-001 / FR-002 / FR-007 / FR-008）：
 *   POST   /api/deep/conversations              创建独立 deep 会话（携带 workspace 上下文）
 *   POST   /api/deep/conversations/:id/runs     启动 deep run（后台执行，立即返回 runId）
 *   GET    /api/deep/conversations/:id/runs     历史复盘（该会话下的 deep runs 摘要）
 *   GET    /api/deep/runs/:runId/view           run tree 投影 + 结论 + 事件 replay
 *   GET    /api/deep/runs/:runId/events         SSE 流式（deep.* 安全投影）
 *   POST   /api/deep/runs/:runId/interrupt      打断（保留已产出材料）
 *   POST   /api/deep/runs/:runId/correct        纠正（携带补充上下文注入下一 manager 决策）
 *   POST   /api/deep/runs/:runId/stop           停止（尝试产出部分结论）
 *
 * 工程要点：
 *   - **EP1（严禁 mock 模型接入）**：从 PanelRuntime 取 configCenter / capabilityCenter，
 *     独立构造 MinimalRuntime → ModelRuntimeConfig → IntelligenceChannel → AgentTurnRuntime
 *     → executeDeepRun。复用 desktop-run-resources 的 aiMode 解析与 createModelRuntimeConfig 链，
 *     不绑定临时 provider 私有字段。
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
// 模型运行时统一入口：createModelRuntimeConfig / ModelRuntimeConfigurationError /
// ModelRuntimeConfig 经 model-runtime/index.ts re-export，禁止 app 层直接 import
// intelligence-channel-factory（panel-runtime-structure 命名中性约束）。
import {
  createModelRuntimeConfig,
  ModelRuntimeConfigurationError,
  type ModelRuntimeConfig,
} from "../model-runtime/index.js";
import { desktopRuntimeMode } from "./desktop-run-resources.js";
import {
  resolveRunModeForKind,
  assertRunModeForKind,
  type AgentArborRunKind,
  type AgentArborRunMode,
} from "../run-mode-policy.js";
import {
  createTaskSoilFromDesktopInput,
  parseDesktopTaskSoilInput,
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
  createDeepConversationService,
  type DeepConversationStore,
} from "../deep/deep-conversation.js";
import {
  executeDeepRun,
  buildDeepManagerSpec,
  InMemoryDeepRunRecordStore,
  type DeepRuntimeConfig,
  type DeepRunRecord,
  type DeepRunRecordStore,
  type StartDeepRuntimeInput,
} from "../deep/deep-runtime.js";
import {
  createDeepRunControlHandle,
  type DeepRunControlHandle,
} from "../deep/deep-run-executor.js";
import { createDeepTurnRuntime } from "../deep/deep-turn.js";
import {
  DEEP_RUN_KIND,
  DEEP_RUN_MODE,
  type DeepConversation,
  type DeepRunStatus,
} from "../deep/contracts.js";
import { createAgentRunTree } from "../../domain/underground/agent-fabric.js";
import { safeAgentRunTreeRef } from "../underground-events.js";
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
  readonly controlHandles: Map<string, DeepRunControlHandle>;
  readonly activeRuns: Set<Promise<void>>;
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
    conversationStore: new InMemoryDeepConversationStore(),
    runRecordStore: new InMemoryDeepRunRecordStore(),
    controlHandles: new Map(),
    activeRuns: new Set(),
  };
  deepRouteStates.set(runtime, state);
  return state;
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

  // POST /api/deep/conversations
  if (rest.length === 1 && rest[0] === "conversations" && method === "POST") {
    await handleCreateDeepConversation(state, runtime, request, response);
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

  // POST /api/deep/runs/:runId/interrupt|correct|stop
  if (rest.length === 3 && rest[0] === "runs" && method === "POST") {
    const action = rest[2];
    if (action === "interrupt" || action === "correct" || action === "stop") {
      await handleDeepRunControl(state, rest[1], action, request, response);
      return true;
    }
  }

  throw new PanelHttpError(404, "deep_route_not_found", "未找到对应的 deep 端点。");
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
    throw new PanelHttpError(400, "empty_goal", "deep 会话需要非空 goal。");
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
  const conversation = await state.conversationStore.get(conversationId);
  if (conversation === undefined) {
    throw new PanelHttpError(404, "deep_conversation_not_found", "未找到该 deep 会话。");
  }
  const body = await readJsonBody(request);
  const record = asRecord(body);
  const aiMode = await resolveDeepAiMode(runtime, record.aiMode);

  // 复用 run-mode-policy 门控：underground → deep（survey 结论 A/B）。
  const runKind: AgentArborRunKind = "underground";
  const runMode: AgentArborRunMode = resolveRunModeForKind(runKind, undefined);
  assertRunModeForKind(runKind, runMode);

  // EP4：预创建 controlHandle 并注册，使 interrupt/correct/stop 可在 run 生命周期内转发。
  const runId = createId("deep-run");
  const controlHandle = createDeepRunControlHandle();
  state.controlHandles.set(runId, controlHandle);

  // EP1：构造真实模型接入的 DeepRuntimeConfig（严禁 mock fallback 伪装完成）。
  const deepConfig = await buildDeepRuntimeConfigForRun({
    runtime,
    state,
    aiMode,
    controlHandle,
  }).catch((error: unknown) => {
    state.controlHandles.delete(runId);
    throw error;
  });

  // 重新派生 TaskSoil（会话创建时已校验并写入 soil；此处为 run 输入构造 TaskSoil 对象）。
  const goalId = createId("goal");
  const traceId = createId("trace");
  const createdAt = nowIso();
  const taskSoil = createTaskSoilFromDesktopInput({
    goal: conversation.goal,
    goalId,
    traceId,
    aiMode,
    constraints: state.minimalRuntime.constraints,
    soilStore: state.minimalRuntime.soilStore,
    taskSoilInput: conversation.taskSoilInput,
    createdAt,
  });

  const capabilitySnapshot = await runtime.capabilityCenter.snapshot();
  const startInput: StartDeepRuntimeInput = {
    conversation,
    taskSoil,
    permissionBoundaryRefs: conversation.permissionBoundaryRefs,
    capabilitySnapshot,
    modelAvailable: aiMode !== "none",
    traceId,
    goalId,
    runId,
  };

  // 后台执行：不阻塞 HTTP；run 完成后 record 写入 store，供 /view 与 /events 轮询读取。
  const runPromise = executeDeepRun(startInput, deepConfig).then(
    () => {
      /* run 完成：record 已由 executeDeepRun 写入 runRecordStore；controlHandle 保留以便
         后续 interrupt/correct/stop 端点对已完成 run 返回明确状态（终态后请求为 no-op）。 */
    },
    (error: unknown) => {
      // 后台 run 失败：记录失败 record（若有 result）或写入最小失败投影，保证 /view 可见终态。
      void writeFailureRecord(state, runId, conversation, error);
    },
  );
  runPromise.finally(() => {
    state.activeRuns.delete(runPromise);
  });
  state.activeRuns.add(runPromise);

  writeJson(response, 202, {
    ok: true,
    status: "running",
    run: {
      runId,
      conversationId: conversation.conversationId,
      status: "running",
      runKind,
      runMode,
    },
  });
}

// ---------------------------------------------------------------------------
// T3-1：GET /api/deep/conversations/:id/runs —— 历史复盘
// ---------------------------------------------------------------------------

async function handleListDeepRuns(
  state: DeepRouteState,
  conversationId: string,
  response: ServerResponse,
): Promise<void> {
  const conversation = await state.conversationStore.get(conversationId);
  if (conversation === undefined) {
    throw new PanelHttpError(404, "deep_conversation_not_found", "未找到该 deep 会话。");
  }
  const records = await state.runRecordStore.list(200);
  const runs = records
    .filter((record) => record.run.conversationId === conversationId)
    .map((record) => projectDeepRunSummary(record));
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
    throw new PanelHttpError(404, "deep_run_not_found", "未找到该 deep run（可能仍在运行中）。");
  }
  writeJson(response, 200, { ok: true, view: projectDeepRunView(record) });
}

// ---------------------------------------------------------------------------
// T3-2：GET /api/deep/runs/:runId/events —— SSE 流式（deep.* 安全投影）
// ---------------------------------------------------------------------------

/**
 * SSE 轮询模型（复用 run-routes 口径）：每 100ms 轮询 runRecordStore.get(runId)，
 * 增量写出 record.eventSequence 中尚未发送的事件；run 进入终态后写完剩余事件并关闭。
 *
 * 说明：当前 deep-runtime 在 run 完成后一次性构建事件序列（EP2 路径①），故 SSE 在 run
 * 进行期间保持连接（keep-alive 注释），run 完成后推送全部事件并收尾。事件均为安全投影
 * （EP3），不含 raw prompt/response/output。
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
  response.write(`: AgentArbor deep run stream ${runId}\n\n`);

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
// EP1：DeepRuntimeConfig 构造链（严禁 mock）
// ---------------------------------------------------------------------------

/**
 * 从 PanelRuntime 的 configCenter / capabilityCenter 构造真实模型接入的 DeepRuntimeConfig。
 * 复用 desktop-run-resources 的 aiMode 解析与 createModelRuntimeConfig → IntelligenceChannel 链：
 *   capabilityCenter.snapshot() → activeModel
 *   configCenter.createModelRuntimeEnvironment({modelProvider, informationAccess}) → aiEnvironment
 *   createModelRuntimeConfig({mode, env, modelProvider, fetch, streamingMode}) → aiConfig
 *   aiConfig.createIntelligenceChannel(minimalRuntime) → IntelligenceChannel
 *   createDeepTurnRuntime({intelligenceChannel}) → AgentTurnRuntime
 */
async function buildDeepRuntimeConfigForRun(input: {
  readonly runtime: PanelRuntime;
  readonly state: DeepRouteState;
  readonly aiMode: ModelRuntimeMode;
  readonly controlHandle: DeepRunControlHandle;
}): Promise<DeepRuntimeConfig> {
  const { runtime, state, aiMode, controlHandle } = input;
  if (aiMode === "none") {
    // AI-first 边界（需求 A3）：显式 none 模式 = 无可用模型，拒绝启动 deep run，
    // 返回明确客户端错误，不 fallback 伪装完成，也不以 500 internal error 暴露。
    throw new PanelHttpError(
      409,
      "deep_model_not_configured",
      "deep 运行需要可用模型，当前未配置 AI 模式。",
    );
  }
  const capabilitySnapshot = await runtime.capabilityCenter.snapshot();
  const informationAccess = await runtime.configCenter.getInformationAccessConfig();
  const aiEnvironment = await runtime.configCenter.createModelRuntimeEnvironment({
    modelProvider: capabilitySnapshot.activeModel,
    informationAccess,
  });
  // 与 desktop-run-resources 对齐的分支：fake 模式不需要 modelProvider / fetch /
  // streamingMode（createModelRuntimeConfig 的 fake 分支只用 env + onModelOutputDelta），
  // 避免在 fake 模式下无条件访问 capabilitySnapshot.modelCapabilities。
  // 真实模式但 provider 未配置（如缺 API key）时 createModelRuntimeConfig 抛
  // ModelRuntimeConfigurationError；统一归一为 409 deep_model_not_configured，
  // 表达"deep 需要可用模型，当前 provider 不可用"的客户端可恢复错误。
  let aiConfig: ModelRuntimeConfig;
  try {
    // 与 desktop-run-resources 对齐的分支：fake 模式不需要 modelProvider / fetch /
    // streamingMode（createModelRuntimeConfig 的 fake 分支只用 env），避免在 fake 模式下
    // 无条件访问 capabilitySnapshot.modelCapabilities。
    aiConfig =
      aiMode === "fake"
        ? createModelRuntimeConfig({ mode: "fake", env: aiEnvironment })
        : createModelRuntimeConfig({
            mode: desktopRuntimeMode(aiMode, capabilitySnapshot.activeModel),
            env: aiEnvironment,
            modelProvider: capabilitySnapshot.activeModel,
            fetch: runtime.providerFetch,
            streamingMode: capabilitySnapshot.modelCapabilities.supportsStreaming
              ? "force_live"
              : "respect_profile",
          });
  } catch (error) {
    if (error instanceof ModelRuntimeConfigurationError) {
      throw new PanelHttpError(
        409,
        "deep_model_not_configured",
        `deep 运行所需模型未就绪：${error.issue.message}`,
      );
    }
    throw error;
  }
  if (!aiConfig.enabled) {
    throw new PanelHttpError(
      409,
      "deep_model_not_configured",
      "deep 运行所需模型运行时未启用，请先配置模型 provider。",
    );
  }
  const intelligenceChannel = aiConfig.createIntelligenceChannel(state.minimalRuntime);
  const turnRuntime = createDeepTurnRuntime({ intelligenceChannel });
  return {
    turnRuntime,
    runtime: state.minimalRuntime,
    store: state.runRecordStore,
    controlHandle,
  };
}

// ---------------------------------------------------------------------------
// 安全投影（view / list / conversation）
// ---------------------------------------------------------------------------

function projectDeepConversation(conversation: DeepConversation): Record<string, unknown> {
  return {
    conversationId: conversation.conversationId,
    title: conversation.title,
    goal: conversation.goal,
    isolation: conversation.isolation,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

function projectDeepRunSummary(record: DeepRunRecord): Record<string, unknown> {
  return {
    runId: record.run.runId,
    conversationId: record.run.conversationId,
    goal: record.run.goal,
    status: record.run.status,
    runKind: record.run.isolation.runKind,
    runMode: record.run.isolation.runMode,
    startedAt: record.run.startedAt,
    updatedAt: record.run.updatedAt,
    hasConclusion: record.report?.conclusion !== undefined,
    childCount: record.agentRunTree.childRuns.length,
    eventCount: record.eventSequence.length,
  };
}

/**
 * run view 安全投影（FR-009 可复盘证据链 + FR-006 可解释结论）：
 *   - run 摘要 + isolation（runKind/runMode）
 *   - agentRunTreeRef（safeAgentRunTreeRef 安全投影：结构计数，不含 raw）
 *   - report 结论 + childSummaries + synthesisRecords（结构化分析，可解释）
 *   - eventSequence（EP3 安全投影，SSE replay 源）
 * 不暴露 raw prompt / response / output。
 */
function projectDeepRunView(record: DeepRunRecord): Record<string, unknown> {
  return {
    run: {
      runId: record.run.runId,
      conversationId: record.run.conversationId,
      goal: record.run.goal,
      status: record.run.status,
      runKind: record.run.isolation.runKind,
      runMode: record.run.isolation.runMode,
      startedAt: record.run.startedAt,
      updatedAt: record.run.updatedAt,
    },
    agentRunTree: safeAgentRunTreeRef(record.agentRunTree),
    report: record.report,
    eventSequence: record.eventSequence,
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
): Promise<void> {
  try {
    const now = nowIso();
    await state.runRecordStore.upsert({
      run: {
        runId,
        conversationId: conversation.conversationId,
        goal: conversation.goal,
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
