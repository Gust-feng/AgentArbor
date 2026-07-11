import assert from "node:assert/strict";
import test from "node:test";
import { FakeModelProvider } from "../../adapters/intelligence/fake-model-provider.js";
import type { FakeModelProviderResponse } from "../../adapters/intelligence/fake-model-provider-contracts.js";
import { InMemoryEventLog } from "../../kernel/events/in-memory-event-log.js";
import { InMemoryMessageBus } from "../../kernel/messages/in-memory-message-bus.js";
import { NativeIntelligenceChannel } from "../../kernel/intelligence/channel.js";
import type {
  ModelOutputDelta,
  ModelProvider,
  ModelRequest,
  ModelRequestOptions,
  ModelResponse,
} from "../../domain/intelligence/index.js";
import { createTaskSoil } from "../../domain/soil/task-soil.js";
import { resetIdsForTests } from "../../kernel/id.js";
import type {
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolExecutionBroker,
  ToolExecutionContext,
  ToolPermissionCheck,
} from "../../domain/tools/index.js";
import { createMinimalRuntime } from "../runtime.js";
import { createDeepTurnRuntime } from "./deep-turn.js";
import { createDeepConversationIsolationMark } from "./deep-conversation.js";
import {
  executeDeepRun,
  InMemoryDeepRunRecordStore,
  type DeepChildInstructionQueueRegistry,
  type DeepRuntimeConfig,
  type StartDeepRuntimeInput,
} from "./deep-runtime.js";
import {
  InMemoryDeepChildMessageStore,
  type DeepChildMessageStore,
} from "./deep-child-messages.js";
import { DeepChildPendingContinuationStore } from "./deep-child-continuations.js";
import type { DeepChildInstructionQueueHandle } from "./deep-child-scheduler-contracts.js";
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
  toolCenter?: ToolExecutionBroker;
  childContinuations?: DeepChildPendingContinuationStore;
  childInstructionQueues?: DeepChildInstructionQueueRegistry;
  childMessageStore?: DeepChildMessageStore;
  store?: InMemoryDeepRunRecordStore;
  onOutputDelta?: (delta: ModelOutputDelta) => void;
  provider?: ModelProvider;
}): { config: DeepRuntimeConfig; eventLog: InMemoryEventLog } {
  const provider = options.provider ?? new FakeModelProvider({
    responses: options.responses,
    onOutputDelta: options.onOutputDelta,
  });
  const runtime = createMinimalRuntime();
  // channel 独立 bus：模型调用事件不混入 deep 事件序列断言。
  const channel = new NativeIntelligenceChannel({
    provider,
    bus: new InMemoryMessageBus(new InMemoryEventLog()),
  });
  const config: DeepRuntimeConfig = {
    turnRuntime: createDeepTurnRuntime({ intelligenceChannel: channel, toolCenter: options.toolCenter }),
    runtime,
    store: options.store ?? new InMemoryDeepRunRecordStore(),
    controlHandle: options.controlHandle,
    childContinuations: options.childContinuations,
    childInstructionQueues: options.childInstructionQueues,
    childMessageStore: options.childMessageStore,
  };
  return { config, eventLog: runtime.eventLog };
}

function createInstructionQueueRegistry(): DeepChildInstructionQueueRegistry & {
  readonly get: (runId: string) => DeepChildInstructionQueueHandle | undefined;
} {
  const handles = new Map<string, DeepChildInstructionQueueHandle>();
  return {
    register(runId, handle): void {
      handles.set(runId, handle);
    },
    unregister(runId, handle): void {
      if (handles.get(runId) === handle) {
        handles.delete(runId);
      }
    },
    get(runId): DeepChildInstructionQueueHandle | undefined {
      return handles.get(runId);
    },
  };
}

class PurposeFakeModelProvider implements ModelProvider {
  readonly providerId = "purpose-fake-model-provider";
  readonly providerKind = "fake" as const;
  readonly protocolKind = "openai_compatible_chat_completions" as const;
  readonly model = "fake-deterministic-model";
  private readonly responsesByPurpose = new Map<string, FakeModelProviderResponse[]>();
  private readonly onOutputDelta?: (delta: ModelOutputDelta) => void;
  private readonly onRequest?: (request: ModelRequest) => void | Promise<void>;

  constructor(input: {
    readonly responsesByPurpose: Readonly<Record<string, readonly FakeModelProviderResponse[]>>;
    readonly onOutputDelta?: (delta: ModelOutputDelta) => void;
    readonly onRequest?: (request: ModelRequest) => void | Promise<void>;
  }) {
    for (const [purpose, responses] of Object.entries(input.responsesByPurpose)) {
      this.responsesByPurpose.set(purpose, [...responses]);
    }
    this.onOutputDelta = input.onOutputDelta;
    this.onRequest = input.onRequest;
  }

  async complete(request: ModelRequest, _options?: ModelRequestOptions): Promise<ModelResponse> {
    await this.onRequest?.(request);
    const queue = this.responsesByPurpose.get(request.purpose);
    const next = queue?.shift();
    if (next === undefined) {
      throw new Error(`Missing fake model response for purpose: ${request.purpose}`);
    }
    return new FakeModelProvider({
      providerId: this.providerId,
      model: this.model,
      responses: [next],
      onOutputDelta: this.onOutputDelta,
    }).complete(request);
  }
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

function countOccurrences(content: string, needle: string): number {
  return content.split(needle).length - 1;
}

class ApprovalRequiredToolBroker implements ToolExecutionBroker {
  list(): ToolDefinition[] {
    return [{
      name: "write_file",
      description: "Test write tool requiring confirmation.",
      inputSchema: { type: "object", properties: {}, additionalProperties: true },
    }];
  }

  has(name: string): boolean {
    return name === "write_file";
  }

  async execute(
    request: ToolCallRequest,
    _context: ToolExecutionContext,
    _permission: ToolPermissionCheck,
  ): Promise<ToolCallResult> {
    return {
      callId: request.callId,
      toolName: request.toolName,
      input: request.input,
      output: undefined,
      status: "approval_required",
      durationMs: 1,
      confirmationRequest: {
        confirmationId: `confirm-${request.callId}`,
        runId: "deep-child-run-test",
        title: "需要确认工具调用",
        actionSummary: `运行 ${request.toolName}`,
        affectedResources: [request.toolName],
        riskLevel: "medium",
        requestedAt: "2026-05-01T00:00:00.000Z",
        sourceRefs: [request.callId],
      },
    };
  }

  executionCount(): number {
    return 0;
  }
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

function spawnApprovalChildDecisionResponse(): FakeModelProviderResponse {
  return {
    output: {
      action: "spawn_children",
      childSpecs: [
        {
          specId: "child-spec-write",
          displayName: "文件核查",
          role: "file_review",
          objective: "尝试写入核查笔记，必要时等待确认。",
          allowedTools: ["write_file"],
          inputRefs: ["goal:goal-runtime-test"],
        },
      ],
      decisionSummary: "需要一个会使用工具的 child 核查文件侧影响。",
      rationale: "manager 派生具备写入工具授权的 child。",
      uncertainty: "child 可能需要用户确认后继续。",
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
  assert.equal(result.run.status, "completed", result.failure);
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
  assert.equal(persisted!.liveProjection?.phase, "completed");
  assert.equal(persisted!.liveProjection?.activeNodeId, "conclusion");
  assert.equal(persisted!.liveProjection?.conclusion?.conclusionId, result.report!.conclusion.conclusionId);
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

test("executeDeepRun follow-up context is projected into manager decision input", async () => {
  resetIdsForTests();
  let decisionRequestContent = "";
  const provider = new PurposeFakeModelProvider({
    responsesByPurpose: {
      deep_decision: [
        {
          output: {
            action: "direct_answer",
            childSpecs: [],
            decisionSummary: "续聊上下文足够，直接补充回答。",
            rationale: "用户是在同一任务链上补充范围。",
            uncertainty: "无需新增探索。",
            confidence: 0.82,
            reasoningRefs: [],
          },
        },
      ],
      deep_direct_answer: [
        {
          output: {
            conclusion: "已结合上一轮结论补充成本和失败恢复路径。",
            oneLineRationale: "续聊上下文提供了上一轮结论与探索摘要。",
            keyEvidenceRefs: ["child:previous:evidence"],
            candidateDispositions: [],
            mainUncertainty: "仍需在实施阶段验证。",
            confidence: 0.8,
          },
        },
      ],
    },
    onRequest: (request) => {
      if (request.purpose === "deep_decision") {
        decisionRequestContent = request.sanitizedMessages.map((message) => message.content).join("\n");
      }
    },
  });
  const { config } = makeConfig({ provider });
  const input: StartDeepRuntimeInput = {
    ...makeRuntimeInput("评估续聊上下文传递", true),
    runId: "deep-run-follow-up",
    parentRunId: "deep-run-previous",
    rootRunId: "deep-run-root",
    turnOrdinal: 2,
    followUpContext: {
      message: "继续补充成本和失败恢复路径。",
      previousRunId: "deep-run-previous",
      previousGoal: "评估多 Agent 协作体验",
      previousStatus: "completed",
      previousConclusion: "上一轮结论：方案可行。",
      previousOneLineRationale: "多角度材料一致。",
      synthesisSummary: "上一轮已综合风险与收益。",
      childSummaries: [
        {
          childRunId: "deep-child-previous",
          displayName: "风险角度",
          role: "risk",
          status: "completed",
          summary: "风险可控，但恢复路径需要补充。",
          findings: ["需要回滚计划"],
          evidenceRefs: ["child:previous:evidence"],
          confidence: 0.7,
          uncertainty: "恢复演练未验证。",
        },
      ],
    },
  };

  const result = await executeDeepRun(input, config);

  assert.equal(result.run.parentRunId, "deep-run-previous");
  assert.equal(result.run.rootRunId, "deep-run-root");
  assert.equal(result.run.turnOrdinal, 2);
  assert.match(decisionRequestContent, /Follow-up context/);
  assert.match(decisionRequestContent, /继续补充成本和失败恢复路径/);
  assert.match(decisionRequestContent, /上一轮结论：方案可行/);
  assert.match(decisionRequestContent, /风险可控，但恢复路径需要补充/);
  assert.equal(decisionRequestContent.includes("raw prompt"), false);
  assert.equal(decisionRequestContent.includes("raw response"), false);
  assert.equal(decisionRequestContent.includes("raw tool"), false);
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

  assert.equal(result.run.status, "completed", result.failure);
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
  const spawnDecision = tree.delegationDecisions.find((decision) => decision.action === "spawn_children");
  assert.ok(spawnDecision !== undefined, "spawn_children delegation decision 应存在");
  assert.equal(
    spawnDecision.childRunIds.some((id) => id.startsWith("derived:")),
    false,
    "delegation.childRunIds 不应再使用 derived 占位 id",
  );
  assert.deepEqual(new Set(spawnDecision.childRunIds), treeChildRunIds);

  // report 承载完整可复盘证据链：childSummaries + synthesisRecords + conclusion
  assert.ok(result.report !== undefined);
  assert.equal(result.report!.childSummaries.length, 2);
  assert.equal(result.report!.synthesisRecords.length, 1);
  assert.equal(result.report!.conclusion.candidateDispositions.length, 2);
  const persisted = await config.store.get(result.run.runId);
  assert.equal(persisted?.liveProjection?.phase, "completed");
  assert.equal(persisted?.liveProjection?.children.length, 2);
  assert.equal(persisted?.liveProjection?.children[0]?.displayName, "风险角度");
  assert.equal(persisted?.liveProjection?.children[0]?.objective, "从风险角度探查目标可行性");

  // 事件序列顺序：goal_received → manager.decided → child.started → child.completed → parent_synthesis.completed → conclusion.produced
  // T2-1 投影权威化：child.started/child.completed 由 scheduler 回调在真实 board 状态变化时实时发布，
  // 不再事后重建 child.waiting（该事件无对应 board 状态转移）。
  const types = eventLog.types();
  const delegationIdx = types.indexOf("deep.manager.decided");
  const childStartedIdx = types.indexOf("deep.child.started");
  const childCompletedIdx = types.indexOf("deep.child.completed");
  const synthesisIdx = types.indexOf("deep.parent_synthesis.completed");
  const conclusionIdx = types.indexOf("deep.conclusion.produced");
  assert.ok(types.includes("deep.goal_received"), "应发布 goal_received");
  assert.ok(delegationIdx >= 0, "应发布 manager.decided");
  assert.ok(childStartedIdx >= 0, "应发布 child.started");
  assert.ok(childCompletedIdx >= 0, "应发布 child.completed");
  assert.ok(synthesisIdx >= 0, "应发布 parent_synthesis.completed");
  assert.ok(conclusionIdx >= 0, "应发布 conclusion.produced");
  assert.ok(
    delegationIdx < childStartedIdx && childStartedIdx < childCompletedIdx && childCompletedIdx < synthesisIdx,
    "事件序列应按 manager.decided→child.started→child.completed→synthesis 顺序发布",
  );
  const childStartedIndices = types
    .map((type, index) => ({ type, index }))
    .filter((item) => item.type === "deep.child.started")
    .map((item) => item.index);
  assert.ok(childStartedIndices.length >= 2, "并发 child 应至少发布两个 child.started");
  assert.ok(
    childStartedIndices.every((index) => index < childCompletedIdx),
    "多个 child.started 应先于任何 child.completed，证明不是串行成对完成",
  );

  // eventSequence 安全投影（EP3）：事件序列有序递增，含 refs，不含 raw
  assert.ok(result.eventSequence.length >= 7, "spawn_children→synthesize eventSequence 应含完整事件链");
  assert.ok(
    result.eventSequence.every((e) => e.refs.length > 0),
    "每条事件应含 refs（安全投影引用）",
  );
});

test("executeDeepRun persists live AgentRunTree child runs before final record", async () => {
  resetIdsForTests();
  const store = new InMemoryDeepRunRecordStore();
  let inspectedDuringChildRun = false;
  const provider = new PurposeFakeModelProvider({
    responsesByPurpose: {
      deep_decision: [
        spawnChildrenDecisionResponse(),
        synthesizeDecisionResponse(),
      ],
      deep_child_material: childMaterialResponses(),
      deep_synthesis: [synthesisConclusionResponse()],
    },
    onRequest: async (request) => {
      if (request.purpose !== "deep_child_material" || inspectedDuringChildRun) {
        return;
      }
      inspectedDuringChildRun = true;
      const record = await store.get("deep-run-live-tree-test");
      assert.ok(record !== undefined, "running record should exist before child model request completes");
      assert.equal(record.agentRunTree.childRuns.length > 0, true);
      const projectedChildIds = new Set((record.liveProjection?.children ?? []).map((child) => child.childRunId));
      assert.equal(
        record.agentRunTree.childRuns.every((child) => projectedChildIds.has(child.childRunId)),
        true,
      );
      assert.equal(record.run.status, "running");
    },
  });
  const { config } = makeConfig({ provider, store });
  const input = {
    ...makeRuntimeInput("运行中持久化 child tree", true),
    runId: "deep-run-live-tree-test",
  };

  const result = await executeDeepRun(input, config);
  const persisted = await store.get(result.run.runId);

  assert.equal(inspectedDuringChildRun, true);
  assert.equal(persisted?.agentRunTree.childRuns.length, 2);
  assert.equal(persisted?.liveProjection?.children.length, 2);
});

test("executeDeepRun continue_child：父层继续同一个 child run，并在 tree 中记录 resume_child + 真实 childRunId", async () => {
  resetIdsForTests();
  const responses: FakeModelProviderResponse[] = [
    {
      output: {
        action: "spawn_children",
        childSpecs: [
          {
            specId: "child-spec-risk",
            displayName: "风险角度",
            role: "risk",
            objective: "先识别 OAuth2 迁移风险。",
            allowedTools: [],
            inputRefs: ["goal:goal-runtime-test"],
          },
        ],
        decisionSummary: "需要风险 child 初步探索。",
        rationale: "父层需要先得到一份局部材料。",
        uncertainty: "回滚证据未知。",
        confidence: 0.68,
        reasoningRefs: [],
      },
    },
    {
      output: {
        summary: "风险角度：初步材料完成，但回滚证据不足。",
        findings: ["回调兼容性需要验证"],
        evidenceRefs: ["child:risk:initial"],
        uncertainty: "缺少回滚路径证据。",
        confidence: 0.42,
      },
    },
    {
      output: {
        action: "continue_child",
        childSpecs: [],
        childOperations: [
          {
            childRunId: "deep-child-run-0001",
            instruction: "继续沿用风险角度，补齐回滚路径证据后重新输出 child material JSON。",
          },
        ],
        decisionSummary: "同一个风险 child 材料不足，需要继续补齐。",
        rationale: "父层审查发现无需重复派生，只需让原 child 继续。",
        uncertainty: "回滚证据仍缺失。",
        confidence: 0.71,
        reasoningRefs: [],
      },
    },
    {
      output: {
        summary: "风险角度：补齐回滚证据，确认保留旧入口可降低风险。",
        findings: ["保留旧入口是关键回滚措施"],
        evidenceRefs: ["child:risk:rollback"],
        uncertainty: "仍需执行验证。",
        confidence: 0.74,
      },
    },
    {
      output: {
        action: "synthesize",
        childSpecs: [],
        decisionSummary: "风险 child 已补齐，可以综合。",
        rationale: "父层审查后的追加工作已完成。",
        uncertainty: "仍需执行验证。",
        confidence: 0.77,
        reasoningRefs: [],
      },
    },
    {
      output: {
        conclusion: "OAuth2 迁移可推进，但必须保留旧入口作为回滚路径。",
        oneLineRationale: "同一个风险 child 补齐后证明回滚措施可行。",
        keyEvidenceRefs: ["child:risk:rollback"],
        candidateDispositions: [
          { candidateId: "risk", label: "风险角度", selected: true, reason: "补齐后的材料可采纳。" },
        ],
        mainUncertainty: "仍需执行阶段验证。",
        confidence: 0.78,
      },
    },
  ];
  const childMessageStore = new InMemoryDeepChildMessageStore();
  const { config } = makeConfig({ responses, childMessageStore });
  const input = makeRuntimeInput("评估 OAuth2 迁移风险并补齐回滚证据", true);

  const result = await executeDeepRun(input, config);
  const tree = result.agentRunTree;

  assert.equal(result.run.status, "completed", result.failure);
  assert.equal(tree.childRuns.length, 1, "继续同一个 child 不应增加新的 child run");
  assert.equal(tree.childRuns[0]?.childRunId, "deep-child-run-0001");
  assert.deepEqual(tree.childRuns[0]?.evidenceRefs, ["child:risk:rollback"]);
  assert.equal(tree.childRuns[0]?.executionHistory?.length, 2);
  assert.deepEqual(
    tree.childRuns[0]?.executionHistory?.map((segment) => segment.outcome),
    ["completed", "completed"],
  );
  assert.equal(tree.childRuns[0]?.parentInstructions?.length, 1);
  assert.equal(tree.childRuns[0]?.parentInstructions?.[0]?.source, "manager");
  assert.equal(tree.childRuns[0]?.parentInstructions?.[0]?.status, "executed");
  assert.equal(tree.childRuns[0]?.parentInstructions?.[0]?.messageRef?.startsWith("child_message:"), true);
  const managerMessage = await childMessageStore.getByRef(
    result.run.runId,
    tree.childRuns[0]?.parentInstructions?.[0]?.messageRef ?? "",
  );
  assert.equal(managerMessage?.source, "manager");
  assert.equal(managerMessage?.status, "executed");
  assert.equal(
    managerMessage?.content,
    "继续沿用风险角度，补齐回滚路径证据后重新输出 child material JSON。",
  );
  const resumeDecision = tree.delegationDecisions.find((decision) => decision.action === "resume_child");
  assert.ok(resumeDecision !== undefined, "continue_child 应映射为 domain resume_child");
  assert.deepEqual(resumeDecision.childRunIds, ["deep-child-run-0001"]);
  assert.equal(resumeDecision.childRunIds.some((id) => id.startsWith("derived:")), false);
  assert.equal(result.report?.childSummaries.length, 1);
  assert.deepEqual(result.report?.childSummaries[0]?.evidenceRefs, ["child:risk:rollback"]);
  const persisted = await config.store.get(result.run.runId);
  assert.equal(persisted?.liveProjection?.children.length, 1);
  assert.equal(persisted?.liveProjection?.children[0]?.childRunId, "deep-child-run-0001");
  assert.deepEqual(persisted?.report?.agentRunTree.delegationDecisions.map((decision) => decision.action), [
    "spawn_children",
    "resume_child",
    "request_parent_synthesis",
  ]);
});

test("executeDeepRun interrupted child：真实 child loop 中断后父层继续同一个 child run", async () => {
  resetIdsForTests();
  const childRunId = "deep-child-run-0001";
  const provider = new PurposeFakeModelProvider({
    responsesByPurpose: {
      deep_decision: [
        {
          output: {
            action: "spawn_children",
            childSpecs: [
              {
                specId: "child-spec-recovery",
                displayName: "恢复路径",
                role: "recovery",
                objective: "检查异常停止后的恢复路径。",
                allowedTools: [],
                inputRefs: ["goal:goal-runtime-test"],
              },
            ],
            decisionSummary: "需要子 Agent 先检查恢复路径。",
            rationale: "父层需要独立材料后再审查。",
            uncertainty: "恢复路径尚未确认。",
            confidence: 0.68,
            reasoningRefs: [],
          },
        },
        {
          output: {
            action: "continue_child",
            childSpecs: [],
            childOperations: [
              {
                childRunId,
                instruction: "同一个子 Agent 刚才异常中断，请继续检查恢复路径并输出材料。",
                review: {
                  decision: "needs_followup",
                  reason: "父层审查发现 child 没有产出可治理材料，但 run 可继续。",
                  evidenceRefs: [`child_run:${childRunId}`],
                  confidence: 0.6,
                },
              },
            ],
            decisionSummary: "子 Agent 中断，需要继续同一个 run。",
            rationale: "继续同一个 child 比重新派生更能保留上下文和审计链。",
            uncertainty: "需确认第二段能否产出材料。",
            confidence: 0.72,
            reasoningRefs: [],
          },
        },
        {
          output: {
            action: "synthesize",
            childSpecs: [],
            decisionSummary: "同一个子 Agent 续跑后已补齐材料，可以综合。",
            rationale: "父层审查最新材料后收口。",
            uncertainty: "仍需执行侧验证。",
            confidence: 0.78,
            reasoningRefs: [],
          },
        },
      ],
      deep_child_material: [
        {
          fail: true,
          failureMessage: "provider stopped before child material was produced",
        },
        {
          output: {
            summary: "恢复路径：续跑后确认可以从同一 child run 补齐材料。",
            findings: ["异常停止后继续同一 child run 可保留审计链"],
            evidenceRefs: ["child:recovery:continued"],
            uncertainty: "仍需执行验证。",
            confidence: 0.73,
          },
        },
      ],
      deep_synthesis: [
        {
          output: {
            conclusion: "异常停止后的子 Agent 可以由父层审查并继续同一个 run。",
            oneLineRationale: "child 中断被保留为可审查材料，续跑后补齐证据。",
            keyEvidenceRefs: ["child:recovery:continued"],
            candidateDispositions: [
              { candidateId: "recovery", label: "恢复路径", selected: true, reason: "续跑后的同一 child 材料可采纳。" },
            ],
            mainUncertainty: "执行侧验证仍需跟进。",
            confidence: 0.79,
          },
        },
      ],
    },
  });
  const { config } = makeConfig({ provider });

  const result = await executeDeepRun(
    makeRuntimeInput("验证子 Agent 异常停止后的父层继续能力", true),
    config,
  );

  assert.equal(result.run.status, "completed", result.failure);
  assert.equal(result.eventSequence.some((event) => event.type === "deep.child.interrupted"), true);
  assert.equal(result.eventSequence.some((event) => event.type === "deep.child.failed"), false);
  assert.equal(result.agentRunTree.childRuns.length, 1);
  assert.equal(result.agentRunTree.childRuns[0]?.childRunId, childRunId);
  assert.equal(result.agentRunTree.childRuns[0]?.status, "completed");
  assert.deepEqual(result.agentRunTree.childRuns[0]?.evidenceRefs, ["child:recovery:continued"]);
  assert.deepEqual(
    result.agentRunTree.childRuns[0]?.executionHistory?.map((segment) => segment.outcome),
    ["interrupted", "completed"],
  );
  const resumeDecision = result.agentRunTree.delegationDecisions.find((decision) => decision.action === "resume_child");
  assert.ok(resumeDecision !== undefined, "中断后的 continue_child 应记录 resume_child");
  assert.deepEqual(resumeDecision.childRunIds, [childRunId]);
});

test("executeDeepRun consecutive continue_child：child 续跑读取已执行父子消息历史但不重复当前指令", async () => {
  resetIdsForTests();
  const childRunId = "deep-child-run-0001";
  const firstInstruction = "第一次父层补充：补齐回滚证据。";
  const secondInstruction = "第二次父层补充：核对灰度发布证据。";
  const childPrompts: string[] = [];
  const provider = new PurposeFakeModelProvider({
    responsesByPurpose: {
      deep_decision: [
        {
          output: {
            action: "spawn_children",
            childSpecs: [
              {
                specId: "child-spec-risk-history",
                displayName: "风险续查",
                role: "risk",
                objective: "先识别迁移风险，再按父层审查持续补齐证据。",
                allowedTools: [],
                inputRefs: ["goal:goal-runtime-test"],
              },
            ],
            decisionSummary: "需要风险 child 先探索。",
            rationale: "父层需要局部材料后审查。",
            uncertainty: "证据尚未成形。",
            confidence: 0.68,
            reasoningRefs: [],
          },
        },
        {
          output: {
            action: "continue_child",
            childSpecs: [],
            childOperations: [{ childRunId, instruction: firstInstruction }],
            decisionSummary: "需要同一个 child 先补齐回滚证据。",
            rationale: "材料缺少回滚证据。",
            uncertainty: "回滚路径未知。",
            confidence: 0.7,
            reasoningRefs: [],
          },
        },
        {
          output: {
            action: "continue_child",
            childSpecs: [],
            childOperations: [{ childRunId, instruction: secondInstruction }],
            decisionSummary: "同一个 child 还需要核对灰度发布证据。",
            rationale: "第一次补充后仍缺灰度证据。",
            uncertainty: "灰度风险未知。",
            confidence: 0.72,
            reasoningRefs: [],
          },
        },
        {
          output: {
            action: "synthesize",
            childSpecs: [],
            decisionSummary: "同一个 child 已完成两次补充，可以综合。",
            rationale: "父层审查后的追加材料已经足够。",
            uncertainty: "仍需执行验证。",
            confidence: 0.78,
            reasoningRefs: [],
          },
        },
      ],
      deep_child_material: [
        {
          output: {
            summary: "风险续查：初步材料完成。",
            findings: ["发现回滚证据缺口"],
            evidenceRefs: ["child:history:initial"],
            uncertainty: "缺少回滚证据。",
            confidence: 0.45,
          },
        },
        {
          output: {
            summary: "风险续查：第一次父层补充后回滚证据已补齐。",
            findings: ["回滚证据已补齐"],
            evidenceRefs: ["child:history:first"],
            uncertainty: "缺少灰度证据。",
            confidence: 0.67,
          },
        },
        {
          output: {
            summary: "风险续查：第二次父层补充后灰度证据也已核对。",
            findings: ["灰度证据已核对"],
            evidenceRefs: ["child:history:second"],
            uncertainty: "仍需执行验证。",
            confidence: 0.77,
          },
        },
      ],
      deep_synthesis: [
        {
          output: {
            conclusion: "迁移可以推进，但需保留回滚路径并分阶段灰度。",
            oneLineRationale: "同一个 child 两次续跑后补齐了回滚与灰度证据。",
            keyEvidenceRefs: ["child:history:second"],
            candidateDispositions: [
              { candidateId: "risk", label: "风险续查", selected: true, reason: "续跑后的材料可采纳。" },
            ],
            mainUncertainty: "执行验证仍需跟进。",
            confidence: 0.8,
          },
        },
      ],
    },
    onRequest: (request) => {
      if (request.purpose === "deep_child_material") {
        childPrompts.push(request.sanitizedMessages.map((message) => message.content).join("\n"));
      }
    },
  });
  const childMessageStore = new InMemoryDeepChildMessageStore();
  const { config } = makeConfig({ provider, childMessageStore });

  const result = await executeDeepRun(
    makeRuntimeInput("连续审查同一个子 Agent 并追加两轮证据要求", true),
    config,
  );

  assert.equal(result.run.status, "completed", result.failure);
  assert.equal(childPrompts.length, 3, "应有初始 child loop + 两次 continuation loop");
  assert.equal(countOccurrences(childPrompts[1]!, firstInstruction), 1);
  assert.match(childPrompts[1]!, /Parent message history: \(none\)/);
  assert.equal(countOccurrences(childPrompts[2]!, firstInstruction) >= 1, true);
  assert.equal(countOccurrences(childPrompts[2]!, secondInstruction), 1);
  assert.match(childPrompts[2]!, /Parent message history \(internal, raw parent-to-child messages\):/);
  assert.equal(result.agentRunTree.childRuns[0]?.executionHistory?.length, 3);
  assert.deepEqual(
    result.agentRunTree.childRuns[0]?.parentInstructions?.map((instruction) => instruction.source),
    ["manager", "manager"],
  );
  const storedMessages = await childMessageStore.listForChild(result.run.runId, childRunId);
  assert.deepEqual(storedMessages.map((message) => message.content), [firstInstruction, secondInstruction]);
  assert.equal(storedMessages.every((message) => message.status === "executed"), true);
});

test("executeDeepRun running child control message：运行中追加消息续跑同一个 child，并补齐 resume_child 审计", async () => {
  resetIdsForTests();
  const runId = "deep-run-queued-control-test";
  const childRunId = "deep-child-run-0001";
  const rawInstruction = "追加一句只有测试能识别的原文：继续核对失败路径。";
  const queueRegistry = createInstructionQueueRegistry();
  const childMessageStore = new InMemoryDeepChildMessageStore();
  let queuedStatus: string | undefined;
  let queuedChildStatus: string | undefined;
  const responses: FakeModelProviderResponse[] = [
    {
      output: {
        action: "spawn_children",
        childSpecs: [
          {
            specId: "child-spec-recovery",
            displayName: "恢复路径",
            role: "recovery",
            objective: "先核对失败路径。当前材料不足时可由父层追加消息继续。",
            allowedTools: [],
            inputRefs: ["goal:goal-runtime-test"],
          },
        ],
        decisionSummary: "需要子 Agent 先检查失败路径。",
        rationale: "父层需要独立材料后审查。",
        uncertainty: "失败路径尚未确认。",
        confidence: 0.69,
        reasoningRefs: [],
      },
    },
    {
      output: {
        action: "wait_children",
        childSpecs: [],
        decisionSummary: "子 Agent 仍在运行，等待其完成后再审查。",
        rationale: "父层不应在 child 材料返回前综合。",
        uncertainty: "等待运行中材料。",
        confidence: 0.7,
        reasoningRefs: [],
      },
    },
    {
      output: {
        summary: "恢复路径：初步材料完成，但失败路径证据不足。",
        findings: ["发现失败路径未覆盖"],
        evidenceRefs: ["child:control:initial"],
        uncertainty: "缺少失败路径复核。",
        confidence: 0.43,
      },
    },
    {
      output: {
        summary: "恢复路径：按父层追加消息复核失败路径后完成。",
        findings: ["失败路径已补齐"],
        evidenceRefs: ["child:control:continued"],
        uncertainty: "仍需执行侧验证。",
        confidence: 0.76,
      },
    },
    {
      output: {
        action: "synthesize",
        childSpecs: [],
        decisionSummary: "子 Agent 已按追加消息补齐失败路径，可以综合。",
        rationale: "父层审查材料完整后收口。",
        uncertainty: "仍需执行验证。",
        confidence: 0.78,
        reasoningRefs: [],
      },
    },
    {
      output: {
        conclusion: "失败路径已由同一个子 Agent 补齐，可进入后续执行验证。",
        oneLineRationale: "运行中追加消息没有新建 child，而是让原 child 继续完成材料。",
        keyEvidenceRefs: ["child:control:continued"],
        candidateDispositions: [
          { candidateId: "recovery", label: "恢复路径", selected: true, reason: "同一 child 续跑后的材料可采纳。" },
        ],
        mainUncertainty: "执行侧验证仍需跟进。",
        confidence: 0.79,
      },
    },
  ];
  const provider = new PurposeFakeModelProvider({
    responsesByPurpose: {
      deep_decision: [responses[0]!, responses[1]!, responses[4]!],
      deep_child_material: [responses[2]!, responses[3]!],
      deep_synthesis: [responses[5]!],
    },
    onOutputDelta: (delta) => {
      if (queuedStatus !== undefined || delta.purpose !== "deep_child_material") {
        return;
      }
      const queued = queueRegistry.get(runId)?.queueChildInstruction({
        childRunId,
        instruction: rawInstruction,
      });
      queuedStatus = queued?.status;
      queuedChildStatus = queued?.status === "queued" ? queued.childStatus : queued?.childStatus;
    },
  });
  const { config } = makeConfig({
    provider,
    childInstructionQueues: queueRegistry,
    childMessageStore,
  });
  const input = { ...makeRuntimeInput("检查失败路径并允许父层追加消息继续子 Agent", true), runId };

  const result = await executeDeepRun(input, config);
  const tree = result.agentRunTree;

  assert.equal(queuedStatus, "queued");
  assert.equal(queuedChildStatus, "running");
  assert.equal(result.run.status, "completed", result.failure);
  const queuedEvent = result.eventSequence.find((event) => event.type === "deep.child.instruction_queued");
  assert.ok(queuedEvent !== undefined, "运行中追加消息应实时发布排队事件");
  assert.equal(queuedEvent.refs.some((ref) => ref.kind === "child_run" && ref.refId === childRunId), true);
  assert.equal(queuedEvent.refs.some((ref) => ref.kind === "child_instruction" && ref.refId.startsWith("child_message:")), true);
  assert.equal(JSON.stringify(queuedEvent).includes(rawInstruction), false);
  assert.ok(
    result.eventSequence.findIndex((event) => event.type === "deep.child.instruction_queued") >
      result.eventSequence.findIndex((event) => event.type === "deep.child.started"),
    "排队事件应发生在 child.started 之后",
  );
  assert.equal(tree.childRuns.length, 1, "运行中追加消息不应新建 child run");
  assert.equal(tree.childRuns[0]?.childRunId, childRunId);
  assert.deepEqual(tree.childRuns[0]?.evidenceRefs, ["child:control:continued"]);
  assert.equal(tree.childRuns[0]?.executionHistory?.length, 2);
  assert.deepEqual(
    tree.childRuns[0]?.executionHistory?.map((segment) => segment.outcome),
    ["completed", "completed"],
  );
  assert.equal(tree.childRuns[0]?.parentInstructions?.length, 1);
  assert.equal(tree.childRuns[0]?.parentInstructions?.[0]?.source, "control_api");
  assert.equal(tree.childRuns[0]?.parentInstructions?.[0]?.status, "executed");
  assert.equal(tree.childRuns[0]?.parentInstructions?.[0]?.messageRef?.startsWith("child_message:"), true);
  assert.equal(tree.childRuns[0]?.parentInstructions?.[0]?.instructionSummary.includes("继续核对"), true);
  const childMessage = await childMessageStore.getByRef(
    runId,
    tree.childRuns[0]?.parentInstructions?.[0]?.messageRef ?? "",
  );
  assert.equal(childMessage?.content, rawInstruction);
  assert.equal(childMessage?.status, "executed");
  assert.equal(childMessage?.childRunId, childRunId);
  assert.deepEqual(tree.delegationDecisions.map((decision) => decision.action), [
    "spawn_children",
    "wait_for_children",
    "resume_child",
    "request_parent_synthesis",
  ]);
  const resumeDecision = tree.delegationDecisions.find((decision) => decision.action === "resume_child");
  assert.ok(resumeDecision !== undefined, "控制 API 排队续跑应补齐 resume_child 审计");
  assert.equal(resumeDecision.source, "control_api");
  assert.deepEqual(resumeDecision.childRunIds, [childRunId]);
  assert.ok(
    resumeDecision.inputRefs.some((ref) => ref.startsWith("child_message:")),
    "resume_child 应通过 child_message ref 追踪控制消息，不写 raw 指令",
  );
  assert.equal(JSON.stringify(resumeDecision).includes(rawInstruction), false);
  const persisted = await config.store.get(runId);
  assert.deepEqual(persisted?.report?.agentRunTree.childRuns[0]?.evidenceRefs, ["child:control:continued"]);
  assert.equal(persisted?.liveProjection?.children[0]?.parentOperation?.status, "executed");
  assert.equal(
    persisted?.liveProjection?.children[0]?.parentOperation?.messageRef?.startsWith("child_message:"),
    true,
  );
  assert.equal(
    persisted?.liveProjection?.children[0]?.workflowItems?.some((item) => item.kind === "parent_message_applied"),
    true,
    "控制 API 续跑后 liveProjection 应投影已应用的协作项跟进流程",
  );
  assert.equal(
    persisted?.liveProjection?.children[0]?.parentInstructions?.[0]?.instructionSummary.includes("继续核对"),
    true,
    "liveProjection 应携带安全跟进摘要供右侧流程分栏展示",
  );
  assert.equal(JSON.stringify(persisted?.liveProjection?.children[0]?.parentOperation).includes(rawInstruction), false);
});

// ---------------------------------------------------------------------------
// 闭环2 投影权威化：DeepRunRecord 携带 DeepResearchBrief + liveProjection 由 board
// terminalSnapshot 派生并与 AgentRunTree 一致（board 单一事实源，最终树≡终端快照）。
// ---------------------------------------------------------------------------
test("executeDeepRun 投影权威化：DeepRunRecord 携带 brief，liveProjection.children ≡ AgentRunTree.childRuns（board terminalSnapshot 单一事实源）", async () => {
  const responses: FakeModelProviderResponse[] = [
    spawnChildrenDecisionResponse(),
    ...childMaterialResponses(),
    synthesizeDecisionResponse(),
    synthesisConclusionResponse(),
  ];
  const { config } = makeConfig({ responses });
  const input = makeRuntimeInput("评估某技术方案的可行性与风险，需多角度证据", true);

  const result = await executeDeepRun(input, config);
  const persisted = await config.store.get(result.run.runId);
  assert.ok(persisted !== undefined, "deep run 应持久化");

  // T2-1：DeepRunRecord 携带 DeepResearchBrief（spawn_children 装配的研究简报，FR-BRIEF-02）。
  assert.ok(persisted.brief !== undefined, "DeepRunRecord 应携带 DeepResearchBrief");
  assert.equal(persisted.brief!.plannedAngles.length, 2, "brief.plannedAngles 应承载 spawn 派生的 2 个角度");
  assert.equal(persisted.brief!.needsUserApproval, false, "默认不强制用户批准计划");
  assert.equal(persisted.brief!.goal, input.conversation.goal, "brief.goal 应承载原始目标");

  // T2-1 投影权威化：liveProjection.children 由 board terminalSnapshot.tasks 派生，
  // 其 childRunId 集合 ≡ AgentRunTree.childRuns（单一事实源：最终树与终端快照一致）。
  const treeChildRunIds = new Set(result.agentRunTree.childRuns.map((c) => c.childRunId));
  const projectionChildRunIds = new Set(
    (persisted.liveProjection?.children ?? []).map((c) => c.childRunId),
  );
  assert.equal(treeChildRunIds.size, 2, "AgentRunTree 应含 2 个 child");
  assert.equal(projectionChildRunIds.size, 2, "liveProjection 应投影 2 个 child");
  for (const id of treeChildRunIds) {
    assert.equal(
      projectionChildRunIds.has(id),
      true,
      `liveProjection child ${id} 应来自 board terminalSnapshot（与 tree 同源）`,
    );
  }

  // liveProjection child 状态由 board 终态映射（成功 run 下 board 任务全为 completed → 投影 completed）。
  assert.equal(
    persisted.liveProjection?.children.every((c) => c.status === "completed"),
    true,
    "成功 run 下 board 终态全 completed，投影 child 状态应全为 completed",
  );

  // liveProjection child 承载 board 终态回填的 summary（证明从 board 派生而非事后伪造）。
  assert.ok(
    persisted.liveProjection?.children.every((c) => c.summary !== undefined && c.summary!.length > 0),
    "投影 child 应承载 board 终态回填的 summary",
  );

  // liveProjection 终态相位 ≡ board 终态相位（completed）。
  assert.equal(persisted.liveProjection?.phase, "completed");
});

test("executeDeepRun child approval_required 投影为 blocked child run，不误报 failed", async () => {
  const childContinuations = new DeepChildPendingContinuationStore();
  const { config } = makeConfig({
    responses: [
      spawnApprovalChildDecisionResponse(),
      {
        toolCalls: [
          {
            callId: "call-write-approval",
            toolName: "write_file",
            input: { path: "notes.md" },
          },
        ],
      },
      synthesizeDecisionResponse(),
      synthesisConclusionResponse(),
    ],
    toolCenter: new ApprovalRequiredToolBroker(),
    childContinuations,
  });

  const result = await executeDeepRun(
    makeRuntimeInput("需要文件核查的迁移评估", true),
    config,
  );
  const persisted = await config.store.get(result.run.runId);

  const child = result.report?.agentRunTree.childRuns[0];
  assert.equal(child?.status, "blocked");
  assert.equal(child?.failureReason, "waiting for tool confirmation");
  assert.equal(child?.pendingApproval?.confirmationId, "confirm-call-write-approval");
  assert.equal(child?.pendingApproval?.toolCallId, "call-write-approval");
  assert.equal(child?.pendingApproval?.toolName, "write_file");
  assert.equal(child?.pendingApproval?.actionSummary, "运行 write_file");
  assert.deepEqual(child?.pendingApproval?.affectedResources, ["write_file"]);
  assert.equal(child?.pendingApproval?.riskLevel, "medium");
  assert.equal(result.report?.childSummaries[0]?.status, "blocked");
  assert.equal(result.eventSequence.some((event) => event.type === "deep.child.blocked"), true);
  assert.equal(result.eventSequence.some((event) => event.type === "deep.child.failed"), false);
  assert.equal(persisted?.liveProjection?.children[0]?.status, "blocked");
  assert.equal(
    persisted?.liveProjection?.children[0]?.pendingApproval?.confirmationId,
    "confirm-call-write-approval",
  );
  assert.equal(
    persisted?.liveProjection?.children[0]?.pendingApproval?.toolName,
    "write_file",
  );
  assert.equal(
    persisted?.liveProjection?.children[0]?.workflowItems?.some((item) => item.kind === "tool_waiting"),
    true,
    "pending approval 应进入协作项工作流程",
  );
  assert.equal(
    persisted?.liveProjection?.children[0]?.execution?.latestOutcome,
    "blocked",
    "blocked child 的最近执行段应进入 live execution 投影",
  );
  assert.equal(
    persisted?.report?.agentRunTree.childRuns[0]?.pendingApproval?.confirmationId,
    "confirm-call-write-approval",
  );
  const liveChildJson = JSON.stringify(persisted?.liveProjection?.children[0]);
  assert.equal(liveChildJson.includes("raw prompt"), false);
  assert.equal(liveChildJson.includes("raw response"), false);
  assert.equal(liveChildJson.includes("stdout"), false);
  assert.equal(liveChildJson.includes("stderr"), false);
  assert.ok(child !== undefined);
  assert.ok(
    childContinuations.get(result.run.runId, child!.childRunId, "confirm-call-write-approval") !== undefined,
    "blocked child pending continuation should be retained in the runtime-only store",
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
