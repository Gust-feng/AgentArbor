import assert from "node:assert/strict";
import test from "node:test";
import { FakeModelProvider } from "../../adapters/intelligence/fake-model-provider.js";
import type { FakeModelProviderResponse } from "../../adapters/intelligence/fake-model-provider-contracts.js";
import { InMemoryEventLog } from "../../kernel/events/in-memory-event-log.js";
import { InMemoryMessageBus } from "../../kernel/messages/in-memory-message-bus.js";
import { NativeIntelligenceChannel } from "../../kernel/intelligence/channel.js";
import { createTaskSoil } from "../../domain/soil/task-soil.js";
import { createMinimalRuntime } from "../runtime.js";
import { createDeepTurnRuntime } from "./deep-turn.js";
import { createDeepConversationIsolationMark } from "./deep-conversation.js";
import {
  executeDeepRun,
  InMemoryDeepRunRecordStore,
  type DeepRuntimeConfig,
  type StartDeepRuntimeInput,
} from "./deep-runtime.js";
import type { DeepRunControlHandle, DeepRunControlSignal } from "./deep-run-executor.js";
import { DEEP_MANAGER_AGENT_ID } from "./child-delegation.js";
import { DEEP_RUN_KIND, DEEP_RUN_MODE, type DeepConversation } from "./contracts.js";

// ---------------------------------------------------------------------------
// T2-6/T2-7 测试点（task.md 验收）：
//   T2-6：一次 deep run 产出可持久化的 AgentRunTree（根+子+父层+事件序列）；
//         复盘可重建 manager→child→综合→结论推理路径；deep 产物写入独立分区不交叉。
//   T2-7：打断后已产出材料保留且状态置 interrupted；纠正携带上下文后 manager 行为继续；
//         stop 后产出部分结论或说明；打断/纠正记录可持久化。
//
// 复用边界（与 B-3 实现一致）：经 executeDeepRun（聚合 executor + tree 构建 + 持久化）
// 驱动；turnRuntime 经 AgentTurnRuntime 调模型；不测 /api/deep/* 端点（闭环3）。
//
// control 注入缝：DeepRuntimeConfig.controlHandle 可注入脚本化 handle，使运行侧
// control 行为（interrupt/correct/stop）可在同步测试中精确复现（FR-008）。
// ---------------------------------------------------------------------------

function makeDeepConversation(goal: string): DeepConversation {
  const now = new Date().toISOString();
  return {
    conversationId: "conv-runtime-test",
    title: goal.slice(0, 40),
    goal,
    isolation: createDeepConversationIsolationMark(),
    permissionBoundaryRefs: [],
    createdAt: now,
    updatedAt: now,
  };
}

function makeRuntimeInput(goal: string, modelAvailable: boolean): StartDeepRuntimeInput {
  return {
    conversation: makeDeepConversation(goal),
    taskSoil: createTaskSoil({ rawGoal: goal }),
    permissionBoundaryRefs: [],
    modelAvailable,
    traceId: "trace-runtime-test",
    goalId: "goal-runtime-test",
  };
}

/**
 * 装配 DeepRuntimeConfig。channel 使用独立 bus（模型事件），runtime.bus 承载 deep
 * 事件序列（delegation/child/synthesis/control），二者分离使 eventLog 断言干净。
 * 返回 eventLog 引用供事件序列断言。
 */
function makeConfig(options: {
  responses?: readonly FakeModelProviderResponse[];
  controlHandle?: DeepRunControlHandle;
}): { config: DeepRuntimeConfig; eventLog: InMemoryEventLog } {
  const provider = new FakeModelProvider({ responses: options.responses });
  const runtime = createMinimalRuntime();
  // channel 独立 bus：模型调用事件不混入 deep 事件序列断言。
  const channel = new NativeIntelligenceChannel({
    provider,
    bus: new InMemoryMessageBus(new InMemoryEventLog()),
  });
  const config: DeepRuntimeConfig = {
    turnRuntime: createDeepTurnRuntime({ intelligenceChannel: channel }),
    runtime,
    store: new InMemoryDeepRunRecordStore(),
    controlHandle: options.controlHandle,
  };
  return { config, eventLog: runtime.eventLog };
}

/**
 * 脚本化 control handle：consume() 按预设信号序列返回，用尽后返回 none。
 * request* 为 no-op（测试只脚本化 consume，模拟 API 层已注入的信号）。
 */
function scriptedControlHandle(signals: readonly DeepRunControlSignal[]): DeepRunControlHandle {
  let index = 0;
  return {
    consume(): DeepRunControlSignal {
      const fallback: DeepRunControlSignal = { kind: "none" };
      const signal: DeepRunControlSignal = index < signals.length ? signals[index] : fallback;
      index += 1;
      return signal;
    },
    requestInterrupt(): void {
      /* no-op：测试经 signals 序列预设 */
    },
    requestCorrect(): void {
      /* no-op */
    },
    requestStop(): void {
      /* no-op */
    },
  };
}

// spawn_children 决策响应（派生 2 个 child）。
function spawnChildrenDecisionResponse(): FakeModelProviderResponse {
  return {
    output: {
      action: "spawn_children",
      childSpecs: [
        {
          specId: "child-spec-risk",
          displayName: "风险角度",
          role: "risk",
          objective: "从风险角度探查目标可行性",
          allowedTools: [],
          inputRefs: ["goal:goal-runtime-test"],
        },
        {
          specId: "child-spec-asset",
          displayName: "资产契合角度",
          role: "asset_fit",
          objective: "从资产契合角度评估能力支撑",
          allowedTools: [],
          inputRefs: ["goal:goal-runtime-test"],
        },
      ],
      decisionSummary: "目标复杂，证据不足，需多角度派生 child 分头探索。",
      rationale: "manager 经语义推理判定需要多角度证据后再收束。",
      uncertainty: "child 探索材料未到位前无法直接结论。",
      confidence: 0.7,
      reasoningRefs: [],
    },
  };
}

function childMaterialResponses(): FakeModelProviderResponse[] {
  return [
    {
      output: {
        summary: "风险角度：识别出两个主要风险，但均有缓解路径。",
        findings: ["风险一：迁移期间兼容性", "风险二：回滚成本"],
        evidenceRefs: ["child:risk:evidence-1", "child:risk:evidence-2"],
        uncertainty: "缓解路径需在 staging 验证。",
        confidence: 0.62,
      },
    },
    {
      output: {
        summary: "资产契合角度：现有能力可支撑目标，需补充少量适配。",
        findings: ["现有资产覆盖 70%", "需新增一个适配模块"],
        evidenceRefs: ["child:asset_fit:evidence-1"],
        uncertainty: "适配模块的复杂度待评估。",
        confidence: 0.68,
      },
    },
  ];
}

function synthesizeDecisionResponse(): FakeModelProviderResponse {
  return {
    output: {
      action: "synthesize",
      childSpecs: [],
      decisionSummary: "child 局部材料已返回，进入父层综合产出结论。",
      rationale: "manager 判定证据已足够综合，不再派生新 child。",
      uncertainty: "冲突材料需父层综合时取舍。",
      confidence: 0.76,
      reasoningRefs: [],
    },
  };
}

function synthesisConclusionResponse(): FakeModelProviderResponse {
  return {
    output: {
      conclusion: "综合两个角度材料：目标可行，风险有缓解路径，资产基本契合。",
      oneLineRationale: "多角度材料一致支持推进，关键风险均有缓解方案。",
      keyEvidenceRefs: ["child:risk:evidence-1", "child:asset_fit:evidence-1"],
      candidateDispositions: [
        {
          candidateId: "risk-angle",
          label: "风险角度",
          selected: true,
          reason: "风险材料与结论方向一致，采纳为主线约束。",
        },
        {
          candidateId: "asset-angle",
          label: "资产契合角度",
          selected: false,
          reason: "作为补充验证，不作为主线。",
        },
      ],
      mainUncertainty: "staging 验证与适配模块复杂度仍需跟踪。",
      confidence: 0.78,
    },
  };
}

// ---------------------------------------------------------------------------
// T2-6 测试 1：direct_answer → AgentRunTree（root + parentSynthesis）+ report + 持久化 + 事件序列
// ---------------------------------------------------------------------------

test("executeDeepRun direct_answer：产出 AgentRunTree（root+parentSynthesis）+ report + 持久化进 deep 分区 + 事件序列", async () => {
  // 轻量目标 → content-aware 默认 fake 选 direct_answer（无需 responses 序列）。
  const { config, eventLog } = makeConfig({});
  const input = makeRuntimeInput("什么是 TypeScript 的类型推断", true);

  const result = await executeDeepRun(input, config);

  // run 终态
  assert.equal(result.run.status, "completed");
  assert.equal(result.stopReason, "direct_answer");

  // AgentRunTree：root manager + 单 parentSynthesis（direct_answer 收口），无 child
  const tree = result.agentRunTree;
  assert.equal(tree.rootAgentId, DEEP_MANAGER_AGENT_ID);
  assert.equal(tree.childRuns.length, 0);
  assert.equal(tree.parentSyntheses.length, 1, "direct_answer 收口应 append 一个 synthesis");
  assert.equal(tree.status, "completed");

  // report 承载结论如何形成（FR-009 可复盘证据链）
  assert.ok(result.report !== undefined, "direct_answer 应产出 DeepExplorationReport");
  assert.equal(result.report!.conclusion.conclusion.trim().length > 0, true);
  assert.equal(result.report!.synthesisRecords.length, 1);
  assert.equal(result.report!.childSummaries.length, 0);

  // 持久化进 deep 分区（DeepRunRecordStore.get 可取回，含完整 tree + report）
  const persisted = await config.store.get(result.run.runId);
  assert.ok(persisted !== undefined, "deep run 应持久化进 DeepRunRecordStore");
  assert.equal(persisted!.agentRunTree.treeId, tree.treeId);
  assert.ok(persisted!.report !== undefined);
  assert.equal(persisted!.run.isolation.runKind, DEEP_RUN_KIND);
  assert.equal(persisted!.run.isolation.runMode, DEEP_RUN_MODE);

  // 事件序列：goal_received + manager.decided + parent_synthesis.completed + conclusion.produced（deep.* 谱系）
  const types = eventLog.types();
  assert.ok(types.includes("deep.goal_received"), "应发布 goal_received 事件");
  assert.ok(types.includes("deep.manager.decided"), "应发布 manager.decided 事件");
  assert.ok(
    types.includes("deep.parent_synthesis.completed"),
    "direct_answer 收口应发布 parent_synthesis.completed 事件",
  );
  assert.ok(types.includes("deep.conclusion.produced"), "应发布 conclusion.produced 事件");

  // eventSequence 安全投影（EP3）：每事件含 id/runId/sequence/type/visibility，不含 raw
  assert.ok(result.eventSequence.length >= 3, "eventSequence 应至少含 goal_received + manager.decided + conclusion");
  assert.equal(result.eventSequence[0].type, "deep.goal_received");
  assert.equal(
    result.eventSequence.every((e) => e.visibility === "public"),
    true,
    "所有事件 visibility 应为 public",
  );
});

// ---------------------------------------------------------------------------
// T2-6 测试 2：spawn_children→synthesize → 完整 AgentRunTree + 复盘重建推理路径 + 事件序列顺序
// ---------------------------------------------------------------------------

test("executeDeepRun spawn_children→synthesize：完整 tree（root+children+synthesis）+ 复盘重建 manager→child→综合→结论路径", async () => {
  const responses: FakeModelProviderResponse[] = [
    spawnChildrenDecisionResponse(),
    ...childMaterialResponses(),
    synthesizeDecisionResponse(),
    synthesisConclusionResponse(),
  ];
  const { config, eventLog } = makeConfig({ responses });
  const input = makeRuntimeInput("重构认证模块并迁移到 OAuth2，保证零停机", true);

  const result = await executeDeepRun(input, config);

  assert.equal(result.run.status, "completed");
  assert.equal(result.stopReason, "synthesized");

  const tree = result.agentRunTree;
  // 完整 tree 结构：root + 2 children + 2 delegationDecisions（spawn + synthesize）+ 1 synthesis
  assert.equal(tree.rootAgentId, DEEP_MANAGER_AGENT_ID);
  assert.equal(tree.childRuns.length, 2, "应派生 2 个 child run");
  assert.equal(tree.delegationDecisions.length, 2, "应记录 2 个 delegation decision（spawn + synthesize）");
  assert.equal(tree.parentSyntheses.length, 1, "synthesize 收口应 append 一个 parent synthesis");

  // 复盘重建推理路径：synthesis 引用的 childRunIds 覆盖全部 child（结论如何形成的证据链）
  const synthesis = tree.parentSyntheses[0];
  assert.ok(synthesis.childRunIds.length >= 2, "synthesis 应引用全部 child run");
  const treeChildRunIds = new Set(tree.childRuns.map((c) => c.childRunId));
  for (const refId of synthesis.childRunIds) {
    assert.equal(treeChildRunIds.has(refId), true, `synthesis childRunId ${refId} 应在 tree childRuns 中`);
  }

  // report 承载完整可复盘证据链：childSummaries + synthesisRecords + conclusion
  assert.ok(result.report !== undefined);
  assert.equal(result.report!.childSummaries.length, 2);
  assert.equal(result.report!.synthesisRecords.length, 1);
  assert.equal(result.report!.conclusion.candidateDispositions.length, 2);

  // 事件序列顺序：goal_received → manager.decided → child.started → child.waiting → child.completed → parent_synthesis.completed → conclusion.produced
  const types = eventLog.types();
  const delegationIdx = types.indexOf("deep.manager.decided");
  const childStartedIdx = types.indexOf("deep.child.started");
  const childWaitingIdx = types.indexOf("deep.child.waiting");
  const childCompletedIdx = types.indexOf("deep.child.completed");
  const synthesisIdx = types.indexOf("deep.parent_synthesis.completed");
  const conclusionIdx = types.indexOf("deep.conclusion.produced");
  assert.ok(types.includes("deep.goal_received"), "应发布 goal_received");
  assert.ok(delegationIdx >= 0, "应发布 manager.decided");
  assert.ok(childStartedIdx >= 0, "应发布 child.started");
  assert.ok(childWaitingIdx >= 0, "应发布 child.waiting");
  assert.ok(childCompletedIdx >= 0, "应发布 child.completed");
  assert.ok(synthesisIdx >= 0, "应发布 parent_synthesis.completed");
  assert.ok(conclusionIdx >= 0, "应发布 conclusion.produced");
  assert.ok(
    delegationIdx < childStartedIdx && childStartedIdx < childCompletedIdx && childCompletedIdx < synthesisIdx,
    "事件序列应按 manager.decided→child.started→child.completed→synthesis 顺序发布",
  );

  // eventSequence 安全投影（EP3）：事件序列有序递增，含 refs，不含 raw
  assert.ok(result.eventSequence.length >= 7, "spawn_children→synthesize eventSequence 应含完整事件链");
  assert.ok(
    result.eventSequence.every((e) => e.refs.length > 0),
    "每条事件应含 refs（安全投影引用）",
  );
});

// ---------------------------------------------------------------------------
// T2-6 测试 3：deep 产物独立分区（DeepRunRecordStore 与普通会话 store 隔离）
// ---------------------------------------------------------------------------

test("executeDeepRun 持久化隔离：deep 产物写入独立 DeepRunRecordStore，run 隔离标记 deep 专属", async () => {
  const { config } = makeConfig({});
  const input = makeRuntimeInput("评估是否引入新技术栈", true);

  const result = await executeDeepRun(input, config);

  // deep 分区可列表取回；record 含 deep 隔离标记，不与普通会话 store 交叉。
  const listed = await config.store.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].run.runId, result.run.runId);
  assert.equal(listed[0].run.isolation.kind, "deep_conversation");
  assert.equal(listed[0].run.isolation.runKind, DEEP_RUN_KIND);
  assert.equal(listed[0].run.isolation.runMode, DEEP_RUN_MODE);
  // controlEvents 字段存在（即使空数组也体现持久化结构完整）
  assert.ok(Array.isArray(listed[0].controlEvents));
});

// ---------------------------------------------------------------------------
// T2-7 测试 4：interrupt 保留已产出材料 + 状态 interrupted + deep.interrupted 事件 + 持久化
// ---------------------------------------------------------------------------

test("executeDeepRun interrupt：spawn_children 后打断，保留 child 材料，状态 interrupted，发布 deep.interrupted，记录可持久化", async () => {
  // 脚本化 handle：step0 consume→none（让 spawn_children 执行产出材料），step1 consume→interrupt。
  const handle = scriptedControlHandle([
    { kind: "none" },
    { kind: "interrupt", reason: "用户中途打断" },
  ]);
  const responses: FakeModelProviderResponse[] = [
    spawnChildrenDecisionResponse(),
    ...childMaterialResponses(),
  ];
  const { config, eventLog } = makeConfig({ responses, controlHandle: handle });
  const input = makeRuntimeInput("复杂多步目标需多角度探索", true);

  const result = await executeDeepRun(input, config);

  // FR-008：打断后已产出材料保留，run 置 interrupted，不伪装完成。
  assert.equal(result.run.status, "interrupted");
  assert.equal(result.stopReason, "interrupted");
  assert.equal(result.controlEvents.length, 1);
  const event = result.controlEvents[0];
  assert.equal(event.kind, "interrupt");
  assert.equal(event.preservedChildRuns, 2, "应保留 2 个 child run");
  assert.equal(event.preservedMaterials, 2, "应保留 2 份 child 材料");

  // AgentRunTree 承载已产出的 child（材料在 tree 中保留）
  assert.equal(result.agentRunTree.childRuns.length, 2);

  // 发布 deep.interrupted 事件
  assert.ok(eventLog.types().includes("deep.interrupted"), "应发布 deep.interrupted 事件");

  // 打断记录可持久化（DeepRunRecord.controlEvents 携带 interrupt 事件）
  const persisted = await config.store.get(result.run.runId);
  assert.ok(persisted !== undefined);
  assert.equal(persisted!.controlEvents.length, 1);
  assert.equal(persisted!.controlEvents[0].kind, "interrupt");
  // interrupt 无 conclusion → report 为 undefined（不伪装完成）
  assert.equal(persisted!.report, undefined);
});

// ---------------------------------------------------------------------------
// T2-7 测试 5：correct 携带补充上下文，manager 行为继续收束闭环 + 记录可持久化
// ---------------------------------------------------------------------------

test("executeDeepRun correct：携带补充上下文注入 manager 决策，循环继续收束闭环，correct 记录可持久化", async () => {
  // 脚本化 handle：step0 consume→correct（携带上下文），step1 consume→none。
  // correct 非终态：manager 据纠正上下文调整后继续 spawn_children→synthesize 收束。
  const handle = scriptedControlHandle([
    { kind: "correct", correctionContext: ["补充约束：必须兼容旧版 OAuth1"], reason: "用户补充兼容性约束" },
    { kind: "none" },
  ]);
  const responses: FakeModelProviderResponse[] = [
    spawnChildrenDecisionResponse(),
    ...childMaterialResponses(),
    synthesizeDecisionResponse(),
    synthesisConclusionResponse(),
  ];
  const { config, eventLog } = makeConfig({ responses, controlHandle: handle });
  const input = makeRuntimeInput("迁移认证到 OAuth2", true);

  const result = await executeDeepRun(input, config);

  // correct 非终态：循环继续到 synthesize 收束（不因纠正而终止）
  assert.equal(result.run.status, "completed");
  assert.equal(result.stopReason, "synthesized");

  // correct 事件携带补充上下文
  assert.equal(result.controlEvents.length, 1);
  const event = result.controlEvents[0];
  assert.equal(event.kind, "correct");
  assert.equal(event.correctionContext[0], "补充约束：必须兼容旧版 OAuth1");

  // 发布 deep.corrected 事件
  assert.ok(eventLog.types().includes("deep.corrected"), "应发布 deep.corrected 事件");

  // correct 记录可持久化
  const persisted = await config.store.get(result.run.runId);
  assert.ok(persisted !== undefined);
  assert.equal(persisted!.controlEvents.length, 1);
  assert.equal(persisted!.controlEvents[0].kind, "correct");
});

// ---------------------------------------------------------------------------
// T2-7 测试 6：stop 产出部分结论（attemptPartialSynthesis）+ 状态 stopped + deep.stopped 事件
// ---------------------------------------------------------------------------

test("executeDeepRun stop：spawn_children 后停止，尝试产出部分结论，状态 stopped，发布 deep.stopped", async () => {
  // 脚本化 handle：step0 consume→none（spawn_children 产出材料），step1 consume→stop。
  // stop 后 attemptPartialSynthesis 消费 child 材料尝试综合（多一次 synthesis 模型调用）。
  const handle = scriptedControlHandle([
    { kind: "none" },
    { kind: "stop", reason: "用户要求停止" },
  ]);
  const responses: FakeModelProviderResponse[] = [
    spawnChildrenDecisionResponse(),
    ...childMaterialResponses(),
    synthesisConclusionResponse(), // partial synthesis 模型调用
  ];
  const { config, eventLog } = makeConfig({ responses, controlHandle: handle });
  const input = makeRuntimeInput("长期探索目标需中途停止", true);

  const result = await executeDeepRun(input, config);

  // FR-008：stop 后 run 置 stopped，尝试产出部分结论或说明。
  assert.equal(result.run.status, "stopped");
  assert.equal(result.stopReason, "stopped_by_control");
  assert.equal(result.controlEvents.length, 1);
  const event = result.controlEvents[0];
  assert.equal(event.kind, "stop");
  // 有 child 材料时 attemptPartialSynthesis 应尝试产出部分结论（partialSynthesis=true）
  assert.equal(event.partialSynthesis, true, "有 child 材料时应尝试产出部分结论");

  // 发布 deep.stopped 事件
  assert.ok(eventLog.types().includes("deep.stopped"), "应发布 deep.stopped 事件");

  // 部分结论可观察（report.conclusion 存在；report 承载 partial 证据链）
  assert.ok(result.report !== undefined, "stop 应产出部分结论（report 承载）");
  assert.ok(result.report!.conclusion.conclusion.trim().length > 0);

  // stop 记录可持久化
  const persisted = await config.store.get(result.run.runId);
  assert.ok(persisted !== undefined);
  assert.equal(persisted!.controlEvents.length, 1);
  assert.equal(persisted!.controlEvents[0].kind, "stop");
});
