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
import { resolveAgentArborRuntimePaths } from "../../../adapters/runtime-storage/index.js";
import { createAgentRunTree, type AgentSpec } from "../../../domain/underground/agent-fabric.js";
import {
  DEEP_RUN_KIND,
  DEEP_RUN_MODE,
  type DeepConversation,
  type DeepRun,
  type DeepRunContinuationFacts,
} from "../../deep/contracts.js";
import type { DeepRunStreamEvent } from "../../deep/deep-events.js";
import { createFileSystemDeepConversationStore } from "../../deep/deep-conversation.js";
import { createFileSystemDeepRunRecordStore, type DeepRunRecord } from "../../deep/deep-runtime.js";
import { startLocalPanelServer, type PanelProviderFetch } from "../../panel-server.js";
import { createFileSystemDeepChildMessageStore } from "../../deep/deep-child-messages.js";
import {
  deepChildInstructionQueueRejectionError,
  deriveDeepRunRuntimeHealth,
} from "../deep-routes.js";
import {
  assertSafePanelJsonText,
  readSseUntil,
  removeTemporaryTree,
  requestJson,
  requestSse,
} from "./panel-server-test-utils.js";

/** 复杂桌面任务目标：触发 fake provider 的 spawn_children 分支（多角度探索→综合）。 */
const COMPLEX_GOAL = "分析当前 AgentArbor 项目并产出优化方向报告";
/** 轻量问题：触发 fake provider 的 direct_answer 分支（无 child，直接结论）。 */
const LIGHTWEIGHT_GOAL = "你是什么模型？";
// The package runner isolates this timing-sensitive integration file from the
// parallel unit/component batch. Keep a generous local deadline as a diagnostic
// boundary for genuinely slow CI hosts, not as a substitute for that isolation.
const DEEP_RUN_VIEW_TIMEOUT_MS = 60_000;

/** 创建独立 deep 会话，返回会话 id。aiMode 必须显式传入（与 desktop 测试一致，避免依赖
 *  config POST 持久化的全局默认）。 */
async function createDeepConversation(
  baseUrl: string,
  goal: string,
  aiMode?: string,
  workspaceDirectory?: string,
): Promise<{ conversationId: string; isolationKind: string }> {
  const res = await requestJson(baseUrl, "/api/deep/conversations", {
    method: "POST",
    body: { goal, aiMode, workspaceDirectory },
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
  workspaceDirectory?: string,
  options?: {
    readonly parentRunId?: string;
    readonly intakeTurnId?: string;
    readonly confirmedObjective?: string;
    readonly confirmedPlan?: string;
  },
): Promise<{ runId: string; runKind: string; runMode: string; rootRunId?: string; turnOrdinal?: number }> {
  const res = await requestJson(
    baseUrl,
    `/api/deep/conversations/${encodeURIComponent(conversationId)}/runs`,
    {
      method: "POST",
      body: {
        aiMode,
        workspaceDirectory,
        parentRunId: options?.parentRunId,
        intakeTurnId: options?.intakeTurnId,
        confirmedObjective: options?.confirmedObjective,
        confirmedPlan: options?.confirmedPlan,
      },
    },
  );
  return {
    runId: res.body.run?.runId,
    runKind: res.body.run?.runKind,
    runMode: res.body.run?.runMode,
    rootRunId: res.body.run?.rootRunId,
    turnOrdinal: res.body.run?.turnOrdinal,
  };
}

async function followUpDeepRun(
  baseUrl: string,
  runId: string,
  message: string,
  aiMode?: string,
  workspaceDirectory?: string,
): Promise<{ runId: string; conversationId: string; parentRunId: string }> {
  const res = await requestJson(
    baseUrl,
    `/api/deep/runs/${encodeURIComponent(runId)}/follow-up`,
    {
      method: "POST",
      body: { message, aiMode, workspaceDirectory },
    },
  );
  return {
    runId: res.body.runId,
    conversationId: res.body.conversationId,
    parentRunId: res.body.parentRunId,
  };
}

async function intakeDeep(
  baseUrl: string,
  input: {
    readonly message: string;
    readonly aiMode?: string;
    readonly conversationId?: string;
    readonly activeRunId?: string;
  },
): Promise<{ status: number; body: any; text: string }> {
  return requestJson(baseUrl, "/api/deep/intake", {
    method: "POST",
    body: {
      message: input.message,
      aiMode: input.aiMode,
      conversationId: input.conversationId,
      activeRunId: input.activeRunId,
    },
  });
}

/**
 * 轮询 GET /api/deep/runs/:runId/view 直到 run 进入终态（非 running）。
 * run 进行中时 /view 返回 404（record 尚未写入），属正常，继续轮询。
 */
async function waitForDeepRunView(
  baseUrl: string,
  runId: string,
  timeoutMs = DEEP_RUN_VIEW_TIMEOUT_MS,
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
  const view = last?.body?.view;
  const lastEvent = Array.isArray(view?.eventSequence)
    ? view.eventSequence.at(-1)
    : undefined;
  throw new Error(`Timed out waiting for deep run view; diagnostics=${JSON.stringify({
    runId,
    httpStatus: last?.status,
    status: view?.run?.status,
    phase: view?.run?.phase ?? view?.liveProjection?.phase ?? view?.liveProjection?.taskBoard?.phase,
    lastEvent: lastEvent === undefined
      ? undefined
      : {
          sequence: lastEvent.sequence,
          type: lastEvent.type,
          timestamp: lastEvent.timestamp,
        },
  })}`);
}

async function persistOrphanedDeepRunFixture(
  configDirectory: string,
): Promise<{ readonly conversationId: string; readonly runId: string }> {
  const runtimeHome = resolveAgentArborRuntimePaths(configDirectory).runtimeHome;
  const conversationStore = createFileSystemDeepConversationStore(runtimeHome);
  const runStore = createFileSystemDeepRunRecordStore(runtimeHome);
  const createdAt = "2026-01-01T00:00:00.000Z";
  const conversationId = "deep-conversation-orphaned-fixture";
  const runId = "deep-run-orphaned-fixture";
  const isolation = {
    kind: "deep_conversation" as const,
    runKind: DEEP_RUN_KIND,
    runMode: DEEP_RUN_MODE,
  };
  const conversation: DeepConversation = {
    conversationId,
    title: "失联运行测试",
    goal: "验证失联运行收口",
    currentObjective: "验证失联运行收口",
    isolation,
    permissionBoundaryRefs: [],
    createdAt,
    updatedAt: createdAt,
  };
  const run: DeepRun = {
    runId,
    conversationId,
    rootRunId: runId,
    turnOrdinal: 1,
    goal: conversation.goal,
    status: "running",
    isolation,
    aiMode: "fake",
    startedAt: createdAt,
    updatedAt: createdAt,
  };
  const rootSpec = testDeepManagerSpec(createdAt);
  const agentRunTree = createAgentRunTree({
    treeId: "deep-run-tree-orphaned-fixture",
    rootRunId: runId,
    rootAgentId: rootSpec.agentId,
    rootSpec,
    createdAt,
  });
  const goalEvent: DeepRunStreamEvent = {
    id: "deep-event-orphaned-goal",
    runId,
    sequence: 1,
    type: "deep.goal_received",
    title: "目标已接收",
    summary: conversation.goal,
    status: "received",
    timestamp: createdAt,
    refs: [{ kind: "conversation", refId: conversationId }],
    visibility: "public",
  };
  const record: DeepRunRecord = {
    run,
    agentRunTree,
    controlEvents: [],
    eventSequence: [goalEvent],
    liveProjection: {
      phase: "deciding",
      activeNodeId: "manager",
      children: [],
      updatedAt: createdAt,
    },
    updatedAt: createdAt,
  };
  await conversationStore.upsert(conversation);
  await runStore.upsert(record);
  return { conversationId, runId };
}

function testDeepManagerSpec(createdAt: string): AgentSpec {
  return {
    specId: "deep-manager-spec-orphaned-fixture",
    agentId: "deep-manager-orphaned-fixture",
    displayName: "Deep Manager",
    agentKind: "manager",
    role: "多 Agent manager",
    protocol: {
      inputs: [],
      outputs: [{ type: "deep.decision", payloadSchema: "DeepDelegationDecision" }],
    },
    promptRef: "prompt:deep.manager.test",
    outputContractRef: "contract:deep.manager.test",
    permissions: {
      allowModel: true,
      allowedTools: [],
      fallback: "disabled",
    },
    budget: {
      maxModelRounds: 1,
      maxToolRounds: 0,
      maxChildRuns: 0,
      maxOutputRefs: 1,
    },
    inputRefs: [],
    createdAt,
  };
}

// ---------------------------------------------------------------------------
// T3-1：deep 会话隔离 + run 映射 + 历史复盘 + 物理隔离
// ---------------------------------------------------------------------------

test("deep intake asks for clarification for low-information input without creating a run", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-deep-intake-ask-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const res = await intakeDeep(server.url, { message: "嗯", aiMode: "fake" });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.status, "needs_input");
    assert.equal(res.body.intake.action, "ask_user");
    assert.equal(res.body.conversation.intakeTurns.length, 1);

    const runs = await requestJson(server.url, "/api/deep/runs");
    assert.equal(runs.status, 200, runs.text);
    assert.equal(runs.body.runs.length, 0);
    const conversations = await requestJson(server.url, "/api/deep/conversations?limit=50");
    assert.equal(conversations.status, 200, conversations.text);
    assert.equal(conversations.body.conversations.length, 1);
    assert.equal(conversations.body.conversations[0].conversationId, res.body.conversation.conversationId);
    assert.equal(conversations.body.conversations[0].intakeStatus, "needs_input");
    assert.equal(conversations.body.conversations[0].latestRun, undefined);
    const restored = await requestJson(
      server.url,
      `/api/deep/conversations/${encodeURIComponent(res.body.conversation.conversationId)}`,
    );
    assert.equal(restored.status, 200, restored.text);
    assert.equal(restored.body.conversation.intakeTurns.length, 1);
    assert.equal(restored.body.runs.length, 0);
    assertSafePanelJsonText(res.text);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("deep intake answers simple questions without starting collaboration", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-deep-intake-answer-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const res = await intakeDeep(server.url, { message: "你是什么模型？", aiMode: "fake" });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.status, "answered");
    assert.equal(res.body.intake.action, "direct_answer");
    assert.equal(typeof res.body.intake.assistantMessage, "string");
    assert.equal(res.body.conversation.intakeTurns.length, 1);

    const runs = await requestJson(server.url, "/api/deep/runs");
    assert.equal(runs.body.runs.length, 0);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("deep intake prepares a confirmable collaboration plan before starting a run", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-deep-intake-run-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const res = await intakeDeep(server.url, { message: COMPLEX_GOAL, aiMode: "fake" });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.status, "plan_ready");
    assert.equal(res.body.intake.action, "start_collaboration");
    assert.equal(typeof res.body.intake.plan, "string");
    assert.equal(res.body.conversation.currentObjective, COMPLEX_GOAL);

    const runsBeforeConfirm = await requestJson(server.url, "/api/deep/runs");
    assert.equal(runsBeforeConfirm.body.runs.length, 0);

    const confirmedObjective = `${COMPLEX_GOAL}（确认版）`;
    const confirmedPlan = `${res.body.intake.plan}\n补充：优先比较当前架构边界。`;
    const run = await startDeepRun(
      server.url,
      res.body.conversation.conversationId,
      "fake",
      undefined,
      {
        intakeTurnId: res.body.intake.turnId,
        confirmedObjective,
        confirmedPlan,
      },
    );

    const view = await waitForDeepRunView(server.url, run.runId);
    assert.equal(view.body.view.run.status, "completed");
    assert.equal(view.body.view.run.goal, confirmedObjective);
    assert.equal(view.body.view.conversation.conversationId, res.body.conversation.conversationId);
    assert.equal(view.body.view.conversation.currentObjective, confirmedObjective);
    assert.equal(view.body.view.brief !== undefined, true);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("deep intake after terminal run can answer or ask without creating follow-up run", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-deep-intake-terminal-answer-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const conversation = await createDeepConversation(server.url, COMPLEX_GOAL, "fake");
    const firstRun = await startDeepRun(server.url, conversation.conversationId, "fake");
    const firstView = await waitForDeepRunView(server.url, firstRun.runId);
    assert.equal(firstView.body.view.run.status, "completed");

    const res = await intakeDeep(server.url, {
      message: "谢谢",
      aiMode: "fake",
      activeRunId: firstRun.runId,
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.status, "needs_input");
    assert.equal(res.body.intake.action, "ask_user");

    const list = await requestJson(server.url, "/api/deep/runs");
    assert.equal(list.body.runs.length, 1);
    assert.equal(list.body.runs[0].runId, firstRun.runId);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("deep intake explains terminal conclusion in the same conversation without starting follow-up", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-deep-intake-terminal-explain-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const conversation = await createDeepConversation(server.url, COMPLEX_GOAL, "fake");
    const firstRun = await startDeepRun(server.url, conversation.conversationId, "fake");
    const firstView = await waitForDeepRunView(server.url, firstRun.runId);
    assert.equal(firstView.body.view.run.status, "completed");
    assert.equal(firstView.body.view.conversation.conversationId, conversation.conversationId);

    const res = await intakeDeep(server.url, {
      message: "解释一下第二点",
      aiMode: "fake",
      activeRunId: firstRun.runId,
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.status, "answered");
    assert.equal(res.body.intake.action, "direct_answer");
    assert.equal(res.body.conversation.conversationId, conversation.conversationId);
    assert.equal(res.body.conversation.intakeTurns.length, 1);

    const list = await requestJson(server.url, "/api/deep/runs");
    assert.equal(list.body.runs.length, 1);
    assert.equal(list.body.runs[0].runId, firstRun.runId);

    const conversations = await requestJson(server.url, "/api/deep/conversations?limit=50");
    assert.equal(conversations.status, 200, conversations.text);
    assert.equal(conversations.body.conversations[0].conversationId, conversation.conversationId);
    assert.equal(conversations.body.conversations[0].intakeStatus, "answered");
    assert.equal(conversations.body.conversations[0].latestRun, undefined);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("deep intake after terminal run prepares a confirmable follow-up plan for new complex goals", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-deep-intake-terminal-run-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const conversation = await createDeepConversation(server.url, "评估多 Agent 入口语义", "fake");
    const firstRun = await startDeepRun(server.url, conversation.conversationId, "fake");
    const firstView = await waitForDeepRunView(server.url, firstRun.runId);
    assert.equal(firstView.body.view.run.status, "completed");

    const res = await intakeDeep(server.url, {
      message: "再从成本角度继续调研",
      aiMode: "fake",
      activeRunId: firstRun.runId,
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.status, "plan_ready");
    assert.equal(res.body.intake.action, "start_collaboration");
    assert.notEqual(res.body.conversation.currentObjective, "再从成本角度继续调研");
    assert.match(res.body.conversation.currentObjective, /评估多 Agent 入口语义/);
    assert.match(res.body.conversation.currentObjective, /成本角度/);

    const listBeforeConfirm = await requestJson(server.url, "/api/deep/runs");
    assert.equal(listBeforeConfirm.body.runs.length, 1);

    const conversations = await requestJson(server.url, "/api/deep/conversations?limit=50");
    assert.equal(conversations.status, 200, conversations.text);
    assert.equal(conversations.body.conversations[0].conversationId, conversation.conversationId);
    assert.equal(conversations.body.conversations[0].intakeStatus, "plan_ready");
    assert.equal(conversations.body.conversations[0].latestRun, undefined);

    const followUpRun = await startDeepRun(
      server.url,
      conversation.conversationId,
      "fake",
      undefined,
      {
        parentRunId: firstRun.runId,
        intakeTurnId: res.body.intake.turnId,
        confirmedObjective: res.body.conversation.currentObjective,
        confirmedPlan: res.body.intake.plan,
      },
    );
    assert.equal(followUpRun.rootRunId, firstRun.runId);
    assert.equal(followUpRun.turnOrdinal, 2);

    const followUpView = await waitForDeepRunView(server.url, followUpRun.runId);
    assert.equal(followUpView.body.view.run.parentRunId, firstRun.runId);
    assert.equal(followUpView.body.view.run.rootRunId, firstRun.runId);
    assert.equal(followUpView.body.view.run.turnOrdinal, 2);
    assert.equal(followUpView.body.view.conversation.conversationId, conversation.conversationId);
    assert.equal(followUpView.body.view.run.goal, res.body.conversation.currentObjective);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

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
    assert.equal(view.body.view.report !== undefined, true);
    assert.equal(view.body.view.brief !== undefined, true);
    assert.equal(view.body.view.brief.goal, COMPLEX_GOAL);
    assert.equal(Array.isArray(view.body.view.brief.plannedAngles), true);
    const firstChild = view.body.view.report?.agentRunTree?.childRuns?.[0];
    assert.equal(typeof firstChild?.spec?.instructions?.objective, "string");
    assert.match(firstChild.spec.instructions.objective, /风险角度探索/);
    assert.equal(firstChild.spec.instructions.objective.includes("Explore from angle"), false);
    assert.equal(firstChild.spec.instructions.systemPromptRef, "prompt:deep.child.agent.standard.v1");
    assert.equal(typeof firstChild.execution?.modelRounds, "number");
    assert.equal(typeof firstChild.execution?.toolRounds, "number");
    assert.equal(Array.isArray(firstChild.execution?.toolCalls), true);

    // 历史复盘：该会话下的 deep runs 摘要包含此 run
    const list = await requestJson(
      server.url,
      `/api/deep/conversations/${encodeURIComponent(conversation.conversationId)}/runs`,
    );
    assert.equal(list.body.runs.length, 1);
    assert.equal(list.body.runs[0].runId, run.runId);
    assert.equal(list.body.runs[0].runKind, "underground");
    assert.equal(list.body.runs[0].runMode, "deep");
    assert.equal(list.body.runs[0].brief !== undefined, true);
    assert.equal(list.body.runs[0].brief.goal, COMPLEX_GOAL);

    // 物理隔离：deep 会话 id 不出现在普通 /api/conversations 列表
    const ordinary = await requestJson(server.url, "/api/conversations");
    const ordinaryIds = (ordinary.body.conversations as readonly { conversationId: string }[]).map(
      (c) => c.conversationId,
    );
    assert.equal(ordinaryIds.includes(conversation.conversationId), false);

    // 旧的全局 runtime run 聚合入口已经退役；Deep 仍只通过自己的 feature API 暴露。
    const runtimeRuns = await requestJson(server.url, "/api/runtime/runs");
    assert.equal(runtimeRuns.status, 404);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("deep routes list recent runs globally across conversations after restart", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-deep-global-list-"));
  let server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const firstConversation = await createDeepConversation(server.url, "第一轮多 Agent 历史恢复验证", "fake");
    const firstRun = await startDeepRun(server.url, firstConversation.conversationId, "fake");
    const firstView = await waitForDeepRunView(server.url, firstRun.runId);
    assert.equal(firstView.body.view.run.status, "completed");

    await new Promise((resolve) => setTimeout(resolve, 5));

    const secondConversation = await createDeepConversation(server.url, "第二轮多 Agent 历史恢复验证", "fake");
    const secondRun = await startDeepRun(server.url, secondConversation.conversationId, "fake");
    const secondView = await waitForDeepRunView(server.url, secondRun.runId);
    assert.equal(secondView.body.view.run.status, "completed");

    await server.close();
    server = await startLocalPanelServer({ port: 0, configDirectory: directory });

    const list = await requestJson(server.url, "/api/deep/runs?limit=50");
    assert.equal(list.status, 200, list.text);
    assert.equal(list.body.ok, true);
    const runIds = list.body.runs.map((run: { runId: string }) => run.runId);
    assert.equal(runIds.includes(firstRun.runId), true);
    assert.equal(runIds.includes(secondRun.runId), true);
    assert.equal(runIds.indexOf(secondRun.runId) < runIds.indexOf(firstRun.runId), true);

    const latest = list.body.runs[0];
    assert.equal(latest.runId, secondRun.runId);
    assert.equal(latest.conversationId, secondConversation.conversationId);
    assert.equal(latest.goal, "第二轮多 Agent 历史恢复验证");
    assert.equal(latest.runKind, "underground");
    assert.equal(latest.runMode, "deep");
    assert.equal(typeof latest.hasConclusion, "boolean");
    assert.equal(typeof latest.childCount, "number");
    assert.equal(typeof latest.eventCount, "number");
    assert.equal("report" in latest, false);
    assert.equal("agentRunTree" in latest, false);
    assert.equal("eventSequence" in latest, false);
    assertSafePanelJsonText(list.text);

    const conversations = await requestJson(server.url, "/api/deep/conversations?limit=50");
    assert.equal(conversations.status, 200, conversations.text);
    const conversationIds = conversations.body.conversations.map(
      (conversation: { conversationId: string }) => conversation.conversationId,
    );
    assert.equal(conversationIds.includes(firstConversation.conversationId), true);
    assert.equal(conversationIds.includes(secondConversation.conversationId), true);
    assert.equal(conversations.body.conversations[0].conversationId, secondConversation.conversationId);
    assert.equal(conversations.body.conversations[0].latestRun.runId, secondRun.runId);

    const limited = await requestJson(server.url, "/api/deep/runs?limit=1");
    assert.equal(limited.status, 200);
    assert.equal(limited.body.runs.length, 1);
    assert.equal(limited.body.runs[0].runId, secondRun.runId);

    const invalid = await requestJson(server.url, "/api/deep/runs?limit=0");
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, "invalid_deep_run_limit");
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("deep follow-up starts a new run in the same task chain", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-deep-follow-up-"));
  const rootWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-deep-root-workspace-"));
  const followUpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-deep-follow-up-workspace-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const conversation = await createDeepConversation(
      server.url,
      "评估多 Agent 续聊语义",
      "fake",
      rootWorkspace,
    );
    const firstRun = await startDeepRun(server.url, conversation.conversationId, "fake");
    const firstView = await waitForDeepRunView(server.url, firstRun.runId);
    assert.equal(firstView.body.view.run.status, "completed");
    assert.equal(firstView.body.view.run.rootRunId, firstRun.runId);
    assert.equal(firstView.body.view.run.turnOrdinal, 1);
    assert.equal(firstView.body.view.run.workspaceFolder.label, path.basename(rootWorkspace));
    assert.equal(firstView.body.view.run.workspaceFolder.path, path.resolve(rootWorkspace));

    const followUp = await followUpDeepRun(
      server.url,
      firstRun.runId,
      "继续补充成本和失败恢复路径，不要开启全新任务。",
      "fake",
      followUpWorkspace,
    );
    assert.equal(followUp.conversationId, conversation.conversationId);
    assert.equal(followUp.parentRunId, firstRun.runId);
    assert.notEqual(followUp.runId, firstRun.runId);

    const secondView = await waitForDeepRunView(server.url, followUp.runId);
    assert.equal(secondView.body.view.run.conversationId, conversation.conversationId);
    assert.equal(secondView.body.view.run.parentRunId, firstRun.runId);
    assert.equal(secondView.body.view.run.rootRunId, firstRun.runId);
    assert.equal(secondView.body.view.run.turnOrdinal, 2);
    assert.notEqual(secondView.body.view.run.status, "running");
    assert.equal(secondView.body.view.run.workspaceFolder.label, path.basename(rootWorkspace));
    assert.equal(secondView.body.view.run.workspaceFolder.path, path.resolve(rootWorkspace));
    assertSafePanelJsonText(secondView.text);

    const conversationRuns = await requestJson(
      server.url,
      `/api/deep/conversations/${encodeURIComponent(conversation.conversationId)}/runs`,
    );
    assert.equal(conversationRuns.status, 200, conversationRuns.text);
    assert.equal(conversationRuns.body.runs.length, 1);
    assert.equal(conversationRuns.body.runs[0].runId, followUp.runId);
    assert.equal(conversationRuns.body.runs[0].parentRunId, firstRun.runId);
    assert.equal(conversationRuns.body.runs[0].rootRunId, firstRun.runId);
    assert.equal(conversationRuns.body.runs[0].turnOrdinal, 2);
    assert.equal(conversationRuns.body.runs[0].workspaceFolder.label, path.basename(rootWorkspace));
    assert.equal(conversationRuns.body.runs[0].workspaceFolder.path, path.resolve(rootWorkspace));

    const globalRuns = await requestJson(server.url, "/api/deep/runs?limit=50");
    const sameChain = globalRuns.body.runs.filter((run: { rootRunId?: string; runId: string }) =>
      (run.rootRunId ?? run.runId) === firstRun.runId
    );
    assert.equal(sameChain.length, 1);
    assert.equal(sameChain[0].runId, followUp.runId);
    assert.equal(sameChain[0].workspaceFolder.label, path.basename(rootWorkspace));
    assert.equal(sameChain[0].workspaceFolder.path, path.resolve(rootWorkspace));

  } finally {
    await server.close();
    await removeTemporaryTree(directory);
    await removeTemporaryTree(rootWorkspace);
    await removeTemporaryTree(followUpWorkspace);
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

    const invalidAiMode = await requestJson(server.url, "/api/deep/conversations", {
      method: "POST",
      body: { goal: "inspect", aiMode: "unsupported" },
    });
    assert.equal(invalidAiMode.status, 400);
    assert.equal(invalidAiMode.body.error.code, "invalid_ai_mode");

    const invalidTaskSoil = await requestJson(server.url, "/api/deep/conversations", {
      method: "POST",
      body: { goal: "inspect", aiMode: "fake", taskSoilInput: { contextRefs: { ref: "file:a" } } },
    });
    assert.equal(invalidTaskSoil.status, 400);
    assert.equal(invalidTaskSoil.body.error.code, "invalid_context_refs");

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
    assert.equal(view.body.view.brief, undefined);
    // direct_answer 不派生 child
    assert.equal(view.body.view.run.conversationId, conversation.conversationId);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("deep conversation management supports rename, pin and delete with run cleanup", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-deep-conversation-management-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const conversation = await createDeepConversation(server.url, "调研当前社会中的心理健康问题", "fake");

    const renamed = await requestJson(
      server.url,
      `/api/deep/conversations/${encodeURIComponent(conversation.conversationId)}/rename`,
      { method: "POST", body: { title: "全球心理健康调研" } },
    );
    assert.equal(renamed.status, 200, renamed.text);
    assert.equal(renamed.body.conversation.title, "全球心理健康调研");
    assert.equal(typeof renamed.body.conversation.titleEditedAt, "string");
    assert.equal(renamed.body.conversations[0].title, "全球心理健康调研");

    const pinned = await requestJson(
      server.url,
      `/api/deep/conversations/${encodeURIComponent(conversation.conversationId)}/pin`,
      { method: "POST", body: { pinned: true } },
    );
    assert.equal(pinned.status, 200, pinned.text);
    assert.equal(typeof pinned.body.conversation.pinnedAt, "string");
    assert.equal(typeof pinned.body.conversations[0].pinnedAt, "string");

    const unpinned = await requestJson(
      server.url,
      `/api/deep/conversations/${encodeURIComponent(conversation.conversationId)}/pin`,
      { method: "POST", body: { pinned: false } },
    );
    assert.equal(unpinned.status, 200, unpinned.text);
    assert.equal(unpinned.body.conversation.pinnedAt, undefined);

    const run = await startDeepRun(server.url, conversation.conversationId, "fake");
    await waitForDeepRunView(server.url, run.runId);

    const deleted = await requestJson(
      server.url,
      `/api/deep/conversations/${encodeURIComponent(conversation.conversationId)}`,
      { method: "DELETE" },
    );
    assert.equal(deleted.status, 200, deleted.text);
    assert.equal(deleted.body.deletedConversationId, conversation.conversationId);
    assert.equal(
      (deleted.body.conversations as readonly { conversationId: string }[]).some(
        (item) => item.conversationId === conversation.conversationId,
      ),
      false,
    );

    const conversations = await requestJson(server.url, "/api/deep/conversations?limit=50");
    assert.equal(
      (conversations.body.conversations as readonly { conversationId: string }[]).some(
        (item) => item.conversationId === conversation.conversationId,
      ),
      false,
    );

    const runs = await requestJson(server.url, "/api/deep/runs?limit=50");
    assert.equal(
      (runs.body.runs as readonly { runId: string }[]).some((item) => item.runId === run.runId),
      false,
    );

    const deletedView = await requestJson(
      server.url,
      `/api/deep/runs/${encodeURIComponent(run.runId)}/view`,
    );
    assert.equal(deletedView.status, 404);
    assert.equal(deletedView.body.error.code, "deep_run_not_found");
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("deep conversation delete is blocked while a run is still active", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-deep-conversation-busy-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const conversation = await createDeepConversation(server.url, COMPLEX_GOAL, "fake");
    await startDeepRun(server.url, conversation.conversationId, "fake");

    const deleted = await requestJson(
      server.url,
      `/api/deep/conversations/${encodeURIComponent(conversation.conversationId)}`,
      { method: "DELETE" },
    );
    assert.equal(deleted.status, 409, deleted.text);
    assert.equal(deleted.body.error.code, "deep_conversation_busy");
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

// ---------------------------------------------------------------------------
// T3-2：SSE 推送 child 派生/产出与父层综合事件，事件安全投影（无 raw，含 refs/visibility）
// ---------------------------------------------------------------------------

test("deep SSE streams child activity without raw prompt/response and includes refs/visibility", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-deep-sse-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const conversation = await createDeepConversation(server.url, COMPLEX_GOAL, "fake");
    const run = await startDeepRun(server.url, conversation.conversationId, "fake");

    // SSE 轮询：至少等到 child.completed，验证真实 child 生命周期事件已流出。
    // 当前 fake deep 链路可能在多轮 manager/child 循环后以 completed 收束，但不稳定保证一定产出
    // parent_synthesis.completed；本测试聚焦 EP3 安全投影与 child 生命周期事件流式可观察性。
    const stream = await readSseUntil(
      server.url,
      `/api/deep/runs/${encodeURIComponent(run.runId)}/events?cursor=0`,
      (events) => events.some((event: { type?: string }) => event.type === "deep.child.completed"),
    );

    const eventTypes = stream.events.map((event: { type?: string }) => event.type);
    // child 派生/产出事件
    assert.equal(
      eventTypes.includes("deep.child.started") || eventTypes.includes("deep.child.completed"),
      true,
    );
    assert.equal(eventTypes.includes("deep.child.completed"), true);
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
    assert.equal(viewEventTypes.includes("deep.child.completed"), true);
    assert.equal(viewEventTypes.includes("deep.goal_received"), true);
    assert.equal(viewEventTypes.includes("deep.manager.decided"), true);
    assertSafePanelJsonText(view.text);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("deep failed run streams its first positive-sequence event from cursor zero", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-deep-failure-sse-"));
  let fetchCalls = 0;
  const providerFetch: PanelProviderFetch = async () => {
    fetchCalls += 1;
    throw new Error("simulated provider failure after deep run start");
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "broken-deep-model",
        apiKey: "sk-deep-failure-test",
      },
    });
    const conversation = await createDeepConversation(server.url, COMPLEX_GOAL, "openai-compatible");
    const run = await startDeepRun(server.url, conversation.conversationId, "openai-compatible");
    const view = await waitForDeepRunView(server.url, run.runId);
    const firstEvent = view.body.view.eventSequence[0];

    assert.equal(fetchCalls > 0, true);
    assert.equal(view.body.view.run.status, "failed");
    assert.equal(firstEvent.sequence > 0, true);
    assert.equal(view.body.view.eventSequence.some((event: { type?: string }) => event.type === "deep.failed"), true);

    const stream = await requestSse(
      server.url,
      `/api/deep/runs/${encodeURIComponent(run.runId)}/events?cursor=0`,
    );
    assert.equal(stream.status, 200);
    assert.equal(stream.events.length > 0, true);
    assert.equal(stream.events[0].sequence > 0, true);
    assert.equal(stream.events.some((event: { type?: string }) => event.type === "deep.failed"), true);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

// ---------------------------------------------------------------------------
// T3-3：interrupt / correct / stop 控制端点（EP4 controlHandle 注册表转发 + 校验）
// ---------------------------------------------------------------------------

test("deep run runtime health distinguishes active stalled orphaned and terminal records", () => {
  const lastActivityAt = "2026-01-01T00:00:00.000Z";
  const lastActivityMs = Date.parse(lastActivityAt);
  const activeRunIds = new Set(["run-active"]);

  const active = deriveDeepRunRuntimeHealth({
    status: "running",
    runId: "run-active",
    activeRunIds,
    lastActivityAt,
    nowMs: lastActivityMs + 30_000,
    staleAfterMs: 120_000,
  });
  assert.equal(active.state, "active");
  assert.equal(active.canStop, true);

  const stalled = deriveDeepRunRuntimeHealth({
    status: "running",
    runId: "run-active",
    activeRunIds,
    lastActivityAt,
    nowMs: lastActivityMs + 120_000,
    staleAfterMs: 120_000,
  });
  assert.equal(stalled.state, "stalled");
  assert.equal(stalled.canStop, true);

  const orphaned = deriveDeepRunRuntimeHealth({
    status: "running",
    runId: "run-orphaned",
    activeRunIds,
    lastActivityAt,
    nowMs: lastActivityMs + 10_000,
    staleAfterMs: 120_000,
  });
  assert.equal(orphaned.state, "orphaned");
  assert.equal(orphaned.canStop, true);

  const terminal = deriveDeepRunRuntimeHealth({
    status: "completed",
    runId: "run-active",
    activeRunIds,
    lastActivityAt,
    nowMs: lastActivityMs + 300_000,
    staleAfterMs: 120_000,
  });
  assert.equal(terminal.state, "terminal");
  assert.equal(terminal.canStop, false);
});

test("deep control endpoints reject terminal runs instead of accepting stale control handles", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-deep-control-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const conversation = await createDeepConversation(server.url, COMPLEX_GOAL, "fake");
    const run = await startDeepRun(server.url, conversation.conversationId, "fake");
    // 等待 run 完成：终态必须回收 controlHandle，不能返回虚假的 requested。
    await waitForDeepRunView(server.url, run.runId);

    // interrupt / stop / correct 均明确返回 409，终态 run 不再接收运行控制。
    const interrupt = await requestJson(
      server.url,
      `/api/deep/runs/${encodeURIComponent(run.runId)}/interrupt`,
      { method: "POST", body: { reason: "需要调整方向" } },
    );
    assert.equal(interrupt.status, 409);
    assert.equal(interrupt.body.error.code, "deep_run_not_active");

    const stop = await requestJson(
      server.url,
      `/api/deep/runs/${encodeURIComponent(run.runId)}/stop`,
      { method: "POST", body: { reason: "预算耗尽" } },
    );
    assert.equal(stop.status, 409);
    assert.equal(stop.body.error.code, "deep_run_not_active");

    const correct = await requestJson(
      server.url,
      `/api/deep/runs/${encodeURIComponent(run.runId)}/correct`,
      { method: "POST", body: { correctionContext: ["优先考虑性能", "忽略兼容性"] } },
    );
    assert.equal(correct.status, 409);
    assert.equal(correct.body.error.code, "deep_run_not_active");

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

test("deep stop closes orphaned running record without live control handle", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-deep-orphan-stop-"));
  const fixture = await persistOrphanedDeepRunFixture(directory);
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const orphaned = await requestJson(server.url, `/api/deep/runs/${encodeURIComponent(fixture.runId)}/view`);
    assert.equal(orphaned.status, 200, orphaned.text);
    assert.equal(orphaned.body.view.run.status, "running");
    assert.equal(orphaned.body.view.run.runtimeHealth.state, "orphaned");
    assert.equal(orphaned.body.view.run.runtimeHealth.canStop, true);

    const stop = await requestJson(
      server.url,
      `/api/deep/runs/${encodeURIComponent(fixture.runId)}/stop`,
      { method: "POST", body: { reason: "用户停止失联运行" } },
    );
    assert.equal(stop.status, 200, stop.text);
    assert.equal(stop.body.status, "stopped");
    assert.equal(stop.body.view.run.status, "stopped");
    assert.equal(stop.body.view.run.runtimeHealth.state, "terminal");
    assert.equal(
      stop.body.view.eventSequence.some((event: { type?: string }) => event.type === "deep.stopped"),
      true,
    );
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("deep child parent message continues the same child run and updates projection", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-deep-child-message-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const conversation = await createDeepConversation(server.url, COMPLEX_GOAL, "fake");
    const run = await startDeepRun(server.url, conversation.conversationId, "fake");
    const initial = await waitForDeepRunView(server.url, run.runId);
    const initialView = initial.body.view;
    const childRuns = initialView.report?.agentRunTree?.childRuns ?? [];
    const childRunId = childRuns[0]?.childRunId;
    assert.equal(typeof childRunId, "string");
    const initialChildCount = childRuns.length;
    const initialEventCount = initialView.eventSequence.length;

    const continued = await requestJson(
      server.url,
      `/api/deep/runs/${encodeURIComponent(run.runId)}/children/${encodeURIComponent(childRunId)}/messages`,
      {
        method: "POST",
        body: { message: "请沿用同一个子 Agent，补齐刚才遗漏的边界条件后重新输出局部材料。" },
      },
    );

    assert.equal(continued.status, 200, continued.text);
    assert.equal(continued.body.ok, true);
    assert.equal(continued.body.status, "continued");
    assert.equal(continued.body.runId, run.runId);
    assert.equal(continued.body.childRunId, childRunId);
    assert.equal(continued.body.messageRef.startsWith("child_message:"), true);
    const messageStore = createFileSystemDeepChildMessageStore(path.join(directory, "runtime"));
    const childMessage = await messageStore.getByRef(run.runId, continued.body.messageRef);
    assert.equal(childMessage?.content, "请沿用同一个子 Agent，补齐刚才遗漏的边界条件后重新输出局部材料。");
    assert.equal(childMessage?.source, "control_api");
    assert.equal(childMessage?.status, "executed");
    assert.equal(childMessage?.childRunId, childRunId);
    const view = continued.body.view;
    assert.equal(view.run.runId, run.runId);
    assert.equal(view.report.agentRunTree.childRuns.length, initialChildCount);
    const resumeDecision = view.report.agentRunTree.delegationDecisions.at(-1);
    assert.equal(resumeDecision?.action, "resume_child");
    assert.deepEqual(resumeDecision?.childRunIds, [childRunId]);
    assert.equal(resumeDecision?.childRunIds.some((id: string) => id.startsWith("derived:")), false);
    const updatedChildRuns = view.report.agentRunTree.childRuns.filter(
      (childRun: { childRunId?: string }) => childRun.childRunId === childRunId,
    );
    assert.equal(updatedChildRuns.length, 1, "父层追加消息应复用同一个 childRunId，不创建重复 child");
    assert.equal(updatedChildRuns[0].status, "completed");
    assert.equal(typeof updatedChildRuns[0].execution?.modelRounds, "number");
    assert.equal(updatedChildRuns[0].parentInstructions?.length, 1);
    assert.equal(updatedChildRuns[0].parentInstructions?.[0]?.source, "control_api");
    assert.equal(updatedChildRuns[0].parentInstructions?.[0]?.status, "executed");
    assert.equal(updatedChildRuns[0].parentInstructions?.[0]?.messageRef, continued.body.messageRef);
    assert.equal(
      updatedChildRuns[0].parentInstructions?.[0]?.instructionSummary.includes("补齐刚才遗漏"),
      true,
    );
    assert.equal(
      resumeDecision?.inputRefs.some((ref: string) => ref === continued.body.messageRef),
      true,
    );

    const updatedSummary = view.report.childSummaries.find(
      (summary: { childRunId?: string }) => summary.childRunId === childRunId,
    );
    assert.equal(updatedSummary?.status, "completed");
    assert.equal(typeof updatedSummary?.summary, "string");
    assert.equal(updatedSummary.summary.length > 0, true);

    const liveChild = view.liveProjection.children.find(
      (child: { childRunId?: string }) => child.childRunId === childRunId,
    );
    assert.equal(liveChild?.status, "completed");
    assert.equal(liveChild?.summary, updatedSummary.summary);
    assert.equal(liveChild?.parentOperation?.status, "executed");
    assert.equal(liveChild?.parentOperation?.messageRef, continued.body.messageRef);
    assert.equal(view.liveProjection.activeNodeId, "synthesis");
    assert.equal(view.liveProjection.synthesis?.status, "pending");
    assert.equal(view.liveProjection.synthesis?.summary, "子 Agent 已更新，等待父层重新综合。");

    assert.equal(view.eventSequence.length, initialEventCount + 1);
    const lastEvent = view.eventSequence.at(-1);
    assert.equal(lastEvent.type, "deep.child.completed");
    assert.equal(lastEvent.title, "父 Agent 已补充子任务");
    assert.equal(JSON.stringify(lastEvent).includes("补齐刚才遗漏"), false);
    assert.equal(lastEvent.refs.some((ref: { kind?: string; refId?: string }) =>
      ref.kind === "child_run" && ref.refId === childRunId
    ), true);
    assertSafePanelJsonText(continued.text);
    assert.equal(JSON.stringify(view.eventSequence).includes(childMessage?.content ?? ""), false);
    assert.equal(JSON.stringify(view.liveProjection).includes(childMessage?.content ?? ""), false);

    const synthesisCountBefore = view.report.synthesisRecords.length;
    const eventCountBeforeResynthesis = view.eventSequence.length;
    const resynthesized = await requestJson(
      server.url,
      `/api/deep/runs/${encodeURIComponent(run.runId)}/resynthesize`,
      { method: "POST", body: {} },
    );
    assert.equal(resynthesized.status, 200);
    assert.equal(resynthesized.body.ok, true);
    const resynthesizedView = resynthesized.body.view;
    assert.equal(resynthesizedView.report.synthesisRecords.length, synthesisCountBefore + 1);
    assert.equal(
      resynthesizedView.report.agentRunTree.parentSyntheses.length,
      view.report.agentRunTree.parentSyntheses.length + 1,
    );
    assert.equal(resynthesizedView.liveProjection.activeNodeId, "conclusion");
    assert.equal(resynthesizedView.liveProjection.phase, "completed");
    assert.equal(resynthesizedView.liveProjection.synthesis?.status, "completed");
    assert.equal(
      resynthesizedView.liveProjection.conclusion.conclusionId,
      resynthesizedView.report.conclusion.conclusionId,
    );
    assert.equal(resynthesizedView.eventSequence.length, eventCountBeforeResynthesis + 2);
    assert.equal(resynthesizedView.eventSequence.at(-2).type, "deep.parent_synthesis.completed");
    assert.equal(resynthesizedView.eventSequence.at(-2).title, "父层已重新综合");
    assert.equal(
      resynthesizedView.eventSequence.at(-2).refs.some(
        (ref: { kind?: string; refId?: string }) => ref.kind === "child_run" && ref.refId === childRunId,
      ),
      true,
      "重新综合事件应引用被父层重新审查的 child run",
    );
    assert.equal(resynthesizedView.eventSequence.at(-1).type, "deep.conclusion.produced");
    assert.equal(resynthesizedView.eventSequence.at(-1).title, "重新综合结论");
    assertSafePanelJsonText(resynthesized.text);

    const persisted = await requestJson(
      server.url,
      `/api/deep/runs/${encodeURIComponent(run.runId)}/view`,
    );
    assert.equal(persisted.body.view.eventSequence.length, eventCountBeforeResynthesis + 2);
    assert.equal(
      persisted.body.view.report.agentRunTree.childRuns.filter(
        (childRun: { childRunId?: string }) => childRun.childRunId === childRunId,
      ).length,
      1,
    );
    assert.equal(persisted.body.view.report.synthesisRecords.length, synthesisCountBefore + 1);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("deep run records survive panel restart and allow continuing the same child run", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-deep-persisted-child-"));
  let server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const conversation = await createDeepConversation(server.url, COMPLEX_GOAL, "fake");
    const run = await startDeepRun(server.url, conversation.conversationId, "fake");
    const initial = await waitForDeepRunView(server.url, run.runId);
    const childRunId = initial.body.view.report?.agentRunTree?.childRuns?.[0]?.childRunId;
    assert.equal(typeof childRunId, "string");
    const initialChildCount = initial.body.view.report.agentRunTree.childRuns.length;
    const firstMessage = await requestJson(
      server.url,
      `/api/deep/runs/${encodeURIComponent(run.runId)}/children/${encodeURIComponent(childRunId)}/messages`,
      {
        method: "POST",
        body: { message: "重启前第一次继续同一个子 Agent，留下父子消息历史。" },
      },
    );
    assert.equal(firstMessage.status, 200, firstMessage.text);
    const messageStoreBeforeRestart = createFileSystemDeepChildMessageStore(path.join(directory, "runtime"));
    const firstChildMessage = await messageStoreBeforeRestart.getByRef(run.runId, firstMessage.body.messageRef);
    assert.equal(firstChildMessage?.content, "重启前第一次继续同一个子 Agent，留下父子消息历史。");
    assert.equal(firstChildMessage?.status, "executed");
    await server.close();

    server = await startLocalPanelServer({ port: 0, configDirectory: directory });
    const persisted = await requestJson(
      server.url,
      `/api/deep/runs/${encodeURIComponent(run.runId)}/view`,
    );
    assert.equal(persisted.status, 200);
    assert.equal(persisted.body.view.run.runId, run.runId);
    assert.equal(
      persisted.body.view.report.agentRunTree.childRuns.some(
        (childRun: { childRunId?: string }) => childRun.childRunId === childRunId,
      ),
      true,
    );

    const continued = await requestJson(
      server.url,
      `/api/deep/runs/${encodeURIComponent(run.runId)}/children/${encodeURIComponent(childRunId)}/messages`,
      {
        method: "POST",
        body: { message: "重启后第二次继续同一个子 Agent，补齐持久化恢复路径。" },
      },
    );
    assert.equal(continued.status, 200, continued.text);
    assert.equal(continued.body.status, "continued");
    assert.equal(continued.body.childRunId, childRunId);
    assert.equal(continued.body.view.report.agentRunTree.childRuns.length, initialChildCount);
    const updatedChildRuns = continued.body.view.report.agentRunTree.childRuns.filter(
      (childRun: { childRunId?: string }) => childRun.childRunId === childRunId,
    );
    assert.equal(updatedChildRuns.length, 1);
    assert.equal(updatedChildRuns[0].parentInstructions?.at(-1)?.source, "control_api");
    assert.equal(updatedChildRuns[0].parentInstructions?.at(-1)?.status, "executed");
    assert.equal(
      continued.body.view.liveProjection.children.find(
        (child: { childRunId?: string }) => child.childRunId === childRunId,
      )?.parentOperation?.status,
      "executed",
    );
    const messageStoreAfterRestart = createFileSystemDeepChildMessageStore(path.join(directory, "runtime"));
    const childMessages = await messageStoreAfterRestart.listForChild(run.runId, childRunId);
    assert.equal(childMessages.length, 2);
    assert.deepEqual(
      childMessages.map((message: { content: string }) => message.content),
      [
        "重启前第一次继续同一个子 Agent，留下父子消息历史。",
        "重启后第二次继续同一个子 Agent，补齐持久化恢复路径。",
      ],
    );
    assert.equal(
      JSON.stringify(continued.body.view.liveProjection).includes("重启前第一次继续同一个子 Agent"),
      false,
    );
    assertSafePanelJsonText(continued.text);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("post-terminal child operations reject records missing frozen continuation facts or ai mode", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-deep-missing-continuation-facts-"));
  let server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const conversation = await createDeepConversation(server.url, COMPLEX_GOAL, "fake");
    const run = await startDeepRun(server.url, conversation.conversationId, "fake");
    const view = await waitForDeepRunView(server.url, run.runId);
    const childRunId = view.body.view.report?.agentRunTree?.childRuns?.[0]?.childRunId;
    assert.equal(typeof childRunId, "string");
    await server.close();

    const runStore = createFileSystemDeepRunRecordStore(path.join(directory, "runtime"));
    const persisted = await runStore.get(run.runId);
    assert.ok(persisted !== undefined);
    const legacyContinuationFacts = {
      ...persisted.run.continuationFacts,
    } as Record<string, unknown>;
    delete legacyContinuationFacts.taskSoilInput;
    await runStore.upsert({
      ...persisted,
      run: {
        ...persisted.run,
        continuationFacts: legacyContinuationFacts as DeepRunContinuationFacts,
      },
    });

    server = await startLocalPanelServer({ port: 0, configDirectory: directory });
    const childMessage = await requestJson(
      server.url,
      `/api/deep/runs/${encodeURIComponent(run.runId)}/children/${encodeURIComponent(childRunId)}/messages`,
      { method: "POST", body: { message: "不要回退到重启后的当前配置。" } },
    );
    assert.equal(childMessage.status, 409, childMessage.text);
    assert.equal(childMessage.body.error.code, "deep_run_continuation_facts_missing");

    const resynthesis = await requestJson(
      server.url,
      `/api/deep/runs/${encodeURIComponent(run.runId)}/resynthesize`,
      { method: "POST", body: {} },
    );
    assert.equal(resynthesis.status, 409, resynthesis.text);
    assert.equal(resynthesis.body.error.code, "deep_run_continuation_facts_missing");

    await server.close();
    await runStore.upsert({
      ...persisted,
      run: {
        ...persisted.run,
        continuationFacts: undefined,
      },
    });
    server = await startLocalPanelServer({ port: 0, configDirectory: directory });
    const missingContinuationFacts = await requestJson(
      server.url,
      `/api/deep/runs/${encodeURIComponent(run.runId)}/children/${encodeURIComponent(childRunId)}/messages`,
      { method: "POST", body: { message: "缺少整个冻结事实对象时也不能回退当前配置。" } },
    );
    assert.equal(missingContinuationFacts.status, 409, missingContinuationFacts.text);
    assert.equal(missingContinuationFacts.body.error.code, "deep_run_continuation_facts_missing");

    await server.close();
    await runStore.upsert({
      ...persisted,
      run: {
        ...persisted.run,
        aiMode: undefined,
      },
    });
    server = await startLocalPanelServer({ port: 0, configDirectory: directory });
    const missingAiMode = await requestJson(
      server.url,
      `/api/deep/runs/${encodeURIComponent(run.runId)}/children/${encodeURIComponent(childRunId)}/messages`,
      { method: "POST", body: { message: "不要猜测旧记录使用的模型运行模式。" } },
    );
    assert.equal(missingAiMode.status, 409, missingAiMode.text);
    assert.equal(missingAiMode.body.error.code, "deep_run_ai_mode_missing");
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("deep child message route maps live scheduler queue rejection to explicit errors", () => {
  const missing = deepChildInstructionQueueRejectionError({
    status: "child_not_found",
    childRunId: "child-missing",
    reason: "child task not found",
  });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.code, "deep_child_run_not_found");

  const stopped = deepChildInstructionQueueRejectionError({
    status: "not_accepting",
    childRunId: "child-running",
    childStatus: "running",
    reason: "child scheduler is stopped",
  });
  assert.equal(stopped.statusCode, 409);
  assert.equal(stopped.code, "deep_child_scheduler_stopped");

  const cancelled = deepChildInstructionQueueRejectionError({
    status: "not_accepting",
    childRunId: "child-cancelled",
    childStatus: "cancelled",
    reason: "child status cancelled is not queueable",
  });
  assert.equal(cancelled.statusCode, 409);
  assert.equal(cancelled.code, "deep_child_not_continuable");

  const terminal = deepChildInstructionQueueRejectionError({
    status: "not_accepting",
    childRunId: "child-completed",
    childStatus: "completed",
    reason: "child status completed is not queueable",
  });
  assert.equal(terminal.statusCode, 409);
  assert.equal(terminal.code, "deep_child_instruction_not_accepted");

  const interrupted = deepChildInstructionQueueRejectionError({
    status: "not_accepting",
    childRunId: "child-interrupted",
    childStatus: "interrupted",
    reason: "child status interrupted is not queueable",
  });
  assert.equal(interrupted.statusCode, 409);
  assert.equal(interrupted.code, "deep_child_instruction_not_accepted");
});

test("deep child confirmation decision returns 409 when live continuation is unavailable", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-deep-child-confirmation-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const conversation = await createDeepConversation(server.url, COMPLEX_GOAL, "fake");
    const run = await startDeepRun(server.url, conversation.conversationId, "fake");
    const view = await waitForDeepRunView(server.url, run.runId);
    const childRunId = view.body.view.report?.agentRunTree?.childRuns?.[0]?.childRunId;
    assert.equal(typeof childRunId, "string");

    const decision = await requestJson(
      server.url,
      `/api/deep/runs/${encodeURIComponent(run.runId)}/children/${encodeURIComponent(childRunId)}/confirmations/not-live/decision`,
      { method: "POST", body: { decision: "approve_once" } },
    );
    assert.equal(decision.status, 409);
    assert.equal(decision.body.error.code, "confirmation_continuation_lost");
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
