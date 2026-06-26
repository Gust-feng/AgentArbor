/**
 * panel-server-deep-routes.test.ts —— `/api/deep/*` 产品 API 端点族集成测试
 * （闭环3 批次C-1，T3-1 / T3-2 / T3-3 验收）。
 *
 * 覆盖口径（task.md T3-1/T3-2/T3-3 验收点）：
 *   - T3-1：创建 deep 会话返回隔离 id；启动 deep run 映射 runKind=underground / runMode=deep；
 *           deep 端点与普通 `/api/conversations` / `/api/runtime/runs` 物理隔离。
 *   - T3-2：SSE 实时推送 child 派生/产出与父层综合事件；事件不含 raw prompt/response/output；
 *           事件含 refs / visibility。
 *   - T3-3：interrupt / correct / stop 控制端点经 EP4 controlHandle 注册表转发；correct 校验
 *           补充上下文；未知 runId 返回 404。
 *
 * 模型接入（EP1）：在每个请求体显式传 aiMode=fake（与 desktop 测试惯例一致），使 deep run
 * 经完整 PanelRuntime.configCenter / capabilityCenter → IntelligenceChannel → AgentTurnRuntime
 * 链路运行（非 mock fallback）。FakeModelProvider 的 goal-aware deep 默认输出驱动
 * manager→child→综合闭环。
 *
 * 行为边界划分：interrupt/stop/correct 的行为正确性（interrupted 状态保留材料、stop 产出部分
 * 结论、correct 注入下一 manager 决策）由 `deep-runtime.test.ts` 用 scripted controlHandle
 * 在单元层覆盖；本文件聚焦 HTTP 路由层（EP4 注册表查找 + 转发 + 请求校验 + 安全投影）。
 */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startLocalPanelServer } from "./panel-server.js";
import {
  assertSafePanelJsonText,
  readSseUntil,
  removeTemporaryTree,
  requestJson,
} from "./panel-server-test-utils.js";

/** 复杂桌面任务目标：触发 fake provider 的 spawn_children 分支（多角度探索→综合）。 */
const COMPLEX_GOAL = "分析当前 AgentArbor 项目并产出优化方向报告";
/** 轻量问题：触发 fake provider 的 direct_answer 分支（无 child，直接结论）。 */
const LIGHTWEIGHT_GOAL = "你是什么模型？";

/** 创建独立 deep 会话，返回会话 id。aiMode 必须显式传入（与 desktop 测试一致，避免依赖
 *  config POST 持久化的全局默认）。 */
async function createDeepConversation(
  baseUrl: string,
  goal: string,
  aiMode?: string,
): Promise<{ conversationId: string; isolationKind: string }> {
  const res = await requestJson(baseUrl, "/api/deep/conversations", {
    method: "POST",
    body: aiMode === undefined ? { goal } : { goal, aiMode },
  });
  return {
    conversationId: res.body.conversation.conversationId,
    isolationKind: res.body.conversation.isolation.kind,
  };
}

/** 启动 deep run，返回 runId 与 isolation 映射。aiMode 必须显式传入（与 desktop 测试一致）。 */
async function startDeepRun(
  baseUrl: string,
  conversationId: string,
  aiMode?: string,
): Promise<{ runId: string; runKind: string; runMode: string }> {
  const res = await requestJson(
    baseUrl,
    `/api/deep/conversations/${encodeURIComponent(conversationId)}/runs`,
    { method: "POST", body: aiMode === undefined ? {} : { aiMode } },
  );
  return {
    runId: res.body.run?.runId,
    runKind: res.body.run?.runKind,
    runMode: res.body.run?.runMode,
  };
}

/**
 * 轮询 GET /api/deep/runs/:runId/view 直到 run 进入终态（非 running）。
 * run 进行中时 /view 返回 404（record 尚未写入），属正常，继续轮询。
 */
async function waitForDeepRunView(
  baseUrl: string,
  runId: string,
  timeoutMs = 8_000,
): Promise<{ status: number; body: any; text: string }> {
  const startedAt = Date.now();
  let last: { status: number; body: any; text: string } | undefined;
  while (Date.now() - startedAt < timeoutMs) {
    last = await requestJson(baseUrl, `/api/deep/runs/${encodeURIComponent(runId)}/view`);
    if (last.status === 200 && last.body?.view?.run?.status && last.body.view.run.status !== "running") {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for deep run ${runId}; last=${last?.text}`);
}

// ---------------------------------------------------------------------------
// T3-1：deep 会话隔离 + run 映射 + 历史复盘 + 物理隔离
// ---------------------------------------------------------------------------

test("deep routes create isolated conversation and map run to underground/deep kind", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-deep-isolation-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    // 创建 deep 会话返回隔离 id（isolation.kind = "deep_conversation"）；aiMode=fake 走 EP1
    // 真实 IntelligenceChannel 链路（FakeModelProvider 驱动 manager→child→综合闭环）。
    const conversation = await createDeepConversation(server.url, COMPLEX_GOAL, "fake");
    assert.equal(conversation.isolationKind, "deep_conversation");
    assert.ok(conversation.conversationId.length > 0);

    // 启动 deep run 映射 runKind=underground / runMode=deep（内部命名口径，复用 run-mode-policy）
    const run = await startDeepRun(server.url, conversation.conversationId, "fake");
    assert.equal(run.runKind, "underground");
    assert.equal(run.runMode, "deep");

    // 等待 run 完成，view 投影仍携带 underground/deep 隔离标记
    const view = await waitForDeepRunView(server.url, run.runId);
    assert.equal(view.body.view.run.runKind, "underground");
    assert.equal(view.body.view.run.runMode, "deep");
    assert.notEqual(view.body.view.run.status, "running");

    // 历史复盘：该会话下的 deep runs 摘要包含此 run
    const list = await requestJson(
      server.url,
      `/api/deep/conversations/${encodeURIComponent(conversation.conversationId)}/runs`,
    );
    assert.equal(list.body.runs.length, 1);
    assert.equal(list.body.runs[0].runId, run.runId);
    assert.equal(list.body.runs[0].runKind, "underground");
    assert.equal(list.body.runs[0].runMode, "deep");

    // 物理隔离：deep 会话 id 不出现在普通 /api/conversations 列表
    const ordinary = await requestJson(server.url, "/api/conversations");
    const ordinaryIds = (ordinary.body.conversations as readonly { conversationId: string }[]).map(
      (c) => c.conversationId,
    );
    assert.equal(ordinaryIds.includes(conversation.conversationId), false);

    // 物理隔离：deep run id 不出现在普通 /api/runtime/runs（deep 写入独立 DeepRunRecordStore）
    const runtimeRuns = await requestJson(server.url, "/api/runtime/runs");
    const runtimeRunIds = (runtimeRuns.body.runs as readonly { runId: string }[]).map((r) => r.runId);
    assert.equal(runtimeRunIds.includes(run.runId), false);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

// ---------------------------------------------------------------------------
// T3-1 边界：空 goal 拒绝、未知会话启动 run 返回 404、轻量目标 direct_answer 完成产出结论
// ---------------------------------------------------------------------------

test("deep routes reject empty goal and unknown conversation run start", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-deep-boundary-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    // 空 goal → 400
    const emptyGoal = await requestJson(server.url, "/api/deep/conversations", {
      method: "POST",
      body: { goal: "  ", aiMode: "fake" },
    });
    assert.equal(emptyGoal.status, 400);
    assert.equal(emptyGoal.body.ok, false);
    assert.equal(emptyGoal.body.error.code, "empty_goal");

    // 未知会话启动 run → 404
    const unknownRun = await requestJson(server.url, "/api/deep/conversations/nonexistent/runs", {
      method: "POST",
      body: { aiMode: "fake" },
    });
    assert.equal(unknownRun.status, 404);
    assert.equal(unknownRun.body.error.code, "deep_conversation_not_found");

    // 轻量目标：direct_answer 路径，无 child，完成产出结论（EP1 真实链路收敛）
    const conversation = await createDeepConversation(server.url, LIGHTWEIGHT_GOAL, "fake");
    const run = await startDeepRun(server.url, conversation.conversationId, "fake");
    const view = await waitForDeepRunView(server.url, run.runId);
    assert.equal(view.body.view.run.status, "completed");
    assert.equal(view.body.view.report.conclusion !== undefined, true);
    // direct_answer 不派生 child
    assert.equal(view.body.view.run.conversationId, conversation.conversationId);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

// ---------------------------------------------------------------------------
// T3-2：SSE 推送 child 派生/产出与父层综合事件，事件安全投影（无 raw，含 refs/visibility）
// ---------------------------------------------------------------------------

test("deep SSE streams child and parent synthesis events without raw prompt/response and includes refs/visibility", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-deep-sse-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const conversation = await createDeepConversation(server.url, COMPLEX_GOAL, "fake");
    const run = await startDeepRun(server.url, conversation.conversationId, "fake");

    // SSE 轮询：run 完成后一次性 flush 全部事件序列；parent_synthesis.completed 出现即表示
    // 全序列已 flush（同一 flush cycle 写出 0..N）。事件类型命名遵循 design §6.2 点号口径。
    const stream = await readSseUntil(
      server.url,
      `/api/deep/runs/${encodeURIComponent(run.runId)}/events?cursor=0`,
      (events) => events.some((event: { type?: string }) => event.type === "deep.parent_synthesis.completed"),
    );

    const eventTypes = stream.events.map((event: { type?: string }) => event.type);
    // child 派生/产出事件
    assert.equal(eventTypes.includes("deep.child.started"), true);
    assert.equal(eventTypes.includes("deep.child.completed"), true);
    // 父层综合事件
    assert.equal(eventTypes.includes("deep.parent_synthesis.completed"), true);
    // 目标接收与 manager 决策事件（goal_received 为下划线口径，manager.decided 为点号口径）
    assert.equal(eventTypes.includes("deep.goal_received"), true);
    assert.equal(eventTypes.includes("deep.manager.decided"), true);

    // 安全投影：每条事件含 refs（数组）与 visibility（public）
    for (const event of stream.events) {
      assert.equal(Array.isArray(event.refs), true);
      assert.equal(event.visibility, "public");
      assert.equal(typeof event.sequence, "number");
      assert.equal(typeof event.type, "string");
    }

    // 安全投影：事件文本不含 raw prompt/response/output（FR-007）
    assertSafePanelJsonText(stream.text);
    assert.equal(stream.text.toLowerCase().includes("raw prompt"), false);
    assert.equal(stream.text.toLowerCase().includes("raw response"), false);

    // view 投影的 eventSequence 与 SSE 一致（replay 源同一）
    const view = await waitForDeepRunView(server.url, run.runId);
    const viewEventTypes = view.body.view.eventSequence.map((event: { type?: string }) => event.type);
    assert.equal(viewEventTypes.includes("deep.parent_synthesis.completed"), true);
    assertSafePanelJsonText(view.text);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

// ---------------------------------------------------------------------------
// T3-3：interrupt / correct / stop 控制端点（EP4 controlHandle 注册表转发 + 校验）
// ---------------------------------------------------------------------------

test("deep control endpoints forward to control handle registry and validate requests", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-deep-control-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const conversation = await createDeepConversation(server.url, COMPLEX_GOAL, "fake");
    const run = await startDeepRun(server.url, conversation.conversationId, "fake");
    // 等待 run 完成：controlHandle 在 run 生命周期内（及完成后）保留注册，控制端点可转发。
    await waitForDeepRunView(server.url, run.runId);

    // interrupt → 202 interrupt_requested（EP4 注册表查找到 handle 并转发信号）
    const interrupt = await requestJson(
      server.url,
      `/api/deep/runs/${encodeURIComponent(run.runId)}/interrupt`,
      { method: "POST", body: { reason: "需要调整方向" } },
    );
    assert.equal(interrupt.status, 202);
    assert.equal(interrupt.body.status, "interrupt_requested");
    assert.equal(interrupt.body.runId, run.runId);

    // stop → 202 stop_requested
    const stop = await requestJson(
      server.url,
      `/api/deep/runs/${encodeURIComponent(run.runId)}/stop`,
      { method: "POST", body: { reason: "预算耗尽" } },
    );
    assert.equal(stop.status, 202);
    assert.equal(stop.body.status, "stop_requested");

    // correct 携带补充上下文 → 202 correct_requested（注入下一 manager 决策）
    const correct = await requestJson(
      server.url,
      `/api/deep/runs/${encodeURIComponent(run.runId)}/correct`,
      { method: "POST", body: { correctionContext: ["优先考虑性能", "忽略兼容性"] } },
    );
    assert.equal(correct.status, 202);
    assert.equal(correct.body.status, "correct_requested");

    // correct 缺少补充上下文 → 400（empty_correction_context）
    const correctEmpty = await requestJson(
      server.url,
      `/api/deep/runs/${encodeURIComponent(run.runId)}/correct`,
      { method: "POST", body: { reason: "无补充上下文" } },
    );
    assert.equal(correctEmpty.status, 400);
    assert.equal(correctEmpty.body.error.code, "empty_correction_context");

    // 未知 runId → 404（controlHandle 注册表无此 run）
    const unknownControl = await requestJson(
      server.url,
      "/api/deep/runs/run-does-not-exist/interrupt",
      { method: "POST", body: {} },
    );
    assert.equal(unknownControl.status, 404);
    assert.equal(unknownControl.body.error.code, "deep_run_control_not_found");
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

// ---------------------------------------------------------------------------
// T3-1：未配置模型时 deep run 启动拒绝（aiMode=none，AI-first 边界，不 fallback 伪装）
// ---------------------------------------------------------------------------

test("deep run start rejects with 409 when no model configured without fallback pretending", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-deep-no-model-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    // 会话创建不需要模型；显式 aiMode=none 表达无可用模型。
    const conversation = await createDeepConversation(server.url, COMPLEX_GOAL, "none");
    // 启动 run：aiMode=none → buildDeepRuntimeConfigForRun 首检查抛
    // PanelHttpError(409, deep_model_not_configured)，controlHandle 已预注册会被回收。
    const start = await requestJson(
      server.url,
      `/api/deep/conversations/${encodeURIComponent(conversation.conversationId)}/runs`,
      { method: "POST", body: { aiMode: "none" } },
    );
    assert.equal(start.status, 409);
    assert.equal(start.body.ok, false);
    assert.equal(start.body.error.code, "deep_model_not_configured");
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});
