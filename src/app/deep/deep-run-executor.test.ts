import assert from "node:assert/strict";
import test from "node:test";
import { FakeModelProvider } from "../../adapters/intelligence/fake-model-provider.js";
import type { FakeModelProviderResponse } from "../../adapters/intelligence/fake-model-provider-contracts.js";
import type { ModelRequest, ModelResponse } from "../../domain/intelligence/contracts.js";
import { InMemoryEventLog } from "../../kernel/events/in-memory-event-log.js";
import { InMemoryMessageBus } from "../../kernel/messages/in-memory-message-bus.js";
import { NativeIntelligenceChannel } from "../../kernel/intelligence/channel.js";
import { createTaskSoil } from "../../domain/soil/task-soil.js";
import { resetIdsForTests } from "../../kernel/id.js";
import { createDeepTurnRuntime } from "./deep-turn.js";
import {
  startDeepRun,
  type DeepRunExecutorConfig,
  type StartDeepRunInput,
} from "./deep-run-executor.js";
import {
  DEEP_RUN_KIND,
  DEEP_RUN_MODE,
  type DeepConversation,
  type DeepRun,
} from "./contracts.js";
import { createDeepConversationIsolationMark } from "./deep-conversation.js";

// ---------------------------------------------------------------------------
// T2-3 测试点（task.md 验收）：
//   manager 决策经模型产出（非确定性模板，source:"ai"）；证据不足时选择继续派生
//   或询问用户；无模型时拒绝运行不 fallback。
//
// 复用边界（与 B-2 实现一致）：测试经 AgentTurnRuntime（封装
// NativeIntelligenceChannel + FakeModelProvider）调模型；不测 /api/deep/* 端点
// （闭环3，避免过早包含后续范围）。
// ---------------------------------------------------------------------------

function makeDeepConversation(goal: string): DeepConversation {
  const now = new Date().toISOString();
  return {
    conversationId: "conv-test-deep",
    title: goal.slice(0, 40),
    goal,
    isolation: createDeepConversationIsolationMark(),
    permissionBoundaryRefs: [],
    createdAt: now,
    updatedAt: now,
  };
}

function makeDeepRun(goal: string): DeepRun {
  const now = new Date().toISOString();
  return {
    runId: "run-test-deep",
    conversationId: "conv-test-deep",
    goal,
    status: "running",
    isolation: {
      kind: "deep_conversation",
      runKind: DEEP_RUN_KIND,
      runMode: DEEP_RUN_MODE,
    },
    startedAt: now,
    updatedAt: now,
  };
}

function makeStartInput(goal: string, modelAvailable: boolean): StartDeepRunInput {
  return {
    run: makeDeepRun(goal),
    conversation: makeDeepConversation(goal),
    taskSoil: createTaskSoil({ rawGoal: goal }),
    permissionBoundaryRefs: [],
    modelAvailable,
    traceId: "trace-test-deep",
    goalId: "goal-test-deep",
  };
}

function makeTurnRuntime(responses?: readonly FakeModelProviderResponse[]): DeepRunExecutorConfig {
  const provider = new FakeModelProvider({ responses });
  const channel = new NativeIntelligenceChannel({
    provider,
    bus: new InMemoryMessageBus(new InMemoryEventLog()),
  });
  return { turnRuntime: createDeepTurnRuntime({ intelligenceChannel: channel }) };
}

class CapturingFakeModelProvider extends FakeModelProvider {
  readonly requests: ModelRequest[] = [];

  override async complete(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    return super.complete(request);
  }
}

// ---------------------------------------------------------------------------
// 1. 无可用模型时拒绝运行（AI-first 边界，需求 A3，不 fallback 伪装）
// ---------------------------------------------------------------------------

test("无可用模型时拒绝运行：stopReason=no_model_rejected，run.status=failed，不伪装完成", async () => {
  // 即使配置了 turnRuntime（有 provider），modelAvailable=false 仍拒绝——AI-first 边界
  // 由调用方据冻结的 capabilitySnapshot.activeModel 判定，executor 不 fallback 伪装。
  const config = makeTurnRuntime();
  const input = makeStartInput("任意目标", false);

  const result = await startDeepRun(input, config);

  assert.equal(result.stopReason, "no_model_rejected");
  assert.equal(result.run.status, "failed");
  assert.equal(result.decisions.length, 0);
  assert.equal(result.steps.length, 0);
  assert.equal(result.childSummaries.length, 0);
  assert.equal(result.conclusion, undefined);
  assert.ok(
    result.failure !== undefined && /AI-first|No model available/i.test(result.failure),
    `failure 应标注 AI-first 拒绝原因，实际：${result.failure}`,
  );
});

// ---------------------------------------------------------------------------
// 2. manager 决策经模型产出（source:"ai"，非确定性模板）；轻量目标 → direct_answer
// ---------------------------------------------------------------------------

test("manager 决策经 AgentTurnRuntime 调模型产出，source=ai，direct_answer 分支产出 SynthesizedConclusion", async () => {
  // 轻量问题 → content-aware 默认 fake 选 direct_answer（无需 responses 序列）。
  const config = makeTurnRuntime();
  const input = makeStartInput("什么是 TypeScript 的类型推断", true);

  const result = await startDeepRun(input, config);

  assert.equal(result.stopReason, "direct_answer");
  assert.equal(result.run.status, "completed");
  assert.ok(result.decisions.length >= 1, "应至少产出一个决策");
  const decision = result.decisions[0];
  // 验收：决策经模型产出非模板——source 固定 "ai"（解析器产出，executor 不合成 fallback 决策）
  assert.equal(decision.source, "ai");
  assert.equal(decision.action, "direct_answer");
  assert.ok(
    decision.decisionSummary.trim().length > 0,
    "decisionSummary 应由模型产出非空内容",
  );
  // direct_answer 分支产出结论级 SynthesizedConclusion（五要素）
  assert.ok(result.conclusion !== undefined, "direct_answer 应产出 SynthesizedConclusion");
  assert.ok(result.conclusion.conclusion.trim().length > 0);
  assert.ok(result.conclusion.oneLineRationale.trim().length > 0);
  assert.ok(result.conclusion.mainUncertainty.trim().length > 0);
});

test("manager 首轮决策消息包含 intake 形成的目标与短计划", async () => {
  const provider = new CapturingFakeModelProvider({
    responses: [
      {
        output: {
          action: "direct_answer",
          childSpecs: [],
          decisionSummary: "入口计划已经足够，直接收口回答。",
          rationale: "测试 manager 消费 intakeContext。",
          uncertainty: "无。",
          confidence: 0.8,
          reasoningRefs: [],
        },
      },
      {
        output: {
          conclusion: "基于入口理解计划直接回答。",
          oneLineRationale: "manager 看到了 intakeContext。",
          keyEvidenceRefs: ["intake:plan"],
          mainUncertainty: "无。",
          confidence: 0.8,
        },
      },
    ],
  });
  const channel = new NativeIntelligenceChannel({
    provider,
    bus: new InMemoryMessageBus(new InMemoryEventLog()),
  });
  const config: DeepRunExecutorConfig = {
    turnRuntime: createDeepTurnRuntime({ intelligenceChannel: channel }),
  };
  const input: StartDeepRunInput = {
    ...makeStartInput("原始输入", true),
    conversation: {
      ...makeDeepConversation("原始输入"),
      currentObjective: "标准化后的研究目标",
    },
    intakeContext: {
      normalizedObjective: "标准化后的研究目标",
      assistantMessage: "我会先收窄目标再协作探索。",
      plan: "先确认范围，再从两个角度探索，最后综合结论。",
      uncertainty: "范围可能变化。",
      confidence: 0.76,
    },
  };

  const result = await startDeepRun(input, config);

  assert.equal(result.stopReason, "direct_answer");
  const firstRequestText = JSON.stringify(provider.requests[0]?.sanitizedMessages ?? []);
  assert.match(firstRequestText, /Intake context/);
  assert.match(firstRequestText, /标准化后的研究目标/);
  assert.match(firstRequestText, /先确认范围/);
});

// ---------------------------------------------------------------------------
// 3. 证据不足走 spawn_children 再 synthesize（manager→child→综合完整闭环）
// ---------------------------------------------------------------------------

test("证据不足时模型选 spawn_children 派生 child 探索，材料就绪后 synthesize 收束闭环", async () => {
  // 用显式 responses 序列精确控制动作：spawn_children → 2 child material → synthesize 决策
  // → synthesis 结论。验证 manager 动作分支可分发 + 一层 child 探索 + 父层综合闭环。
  const responses: FakeModelProviderResponse[] = [
    // call 0: deep.decision → spawn_children（派生 2 个 child 分头探索）
    {
      output: {
        action: "spawn_children",
        childSpecs: [
          {
            specId: "child-spec-risk",
            displayName: "风险角度",
            role: "risk",
            objective: "从风险角度探查目标的可行性",
            allowedTools: [],
            inputRefs: ["goal:goal-test-deep"],
          },
          {
            specId: "child-spec-asset",
            displayName: "资产契合角度",
            role: "asset_fit",
            objective: "从资产契合角度评估现有能力是否支撑目标",
            allowedTools: [],
            inputRefs: ["goal:goal-test-deep"],
          },
        ],
        decisionSummary: "目标复杂，证据不足，需多角度派生 child 分头探索。",
        rationale: "manager 经语义推理判定需要多角度证据后再收束。",
        uncertainty: "child 探索材料未到位前无法直接结论。",
        confidence: 0.7,
        reasoningRefs: [],
      },
    },
    // call 1: deep.child_material（child 1 - risk 角度）
    {
      output: {
        summary: "风险角度：识别出两个主要风险，但均有缓解路径。",
        findings: ["风险一：迁移期间兼容性", "风险二：回滚成本"],
        evidenceRefs: ["child:risk:evidence-1", "child:risk:evidence-2"],
        uncertainty: "缓解路径需在 staging 验证。",
        confidence: 0.62,
      },
    },
    // call 2: deep.child_material（child 2 - asset_fit 角度）
    {
      output: {
        summary: "资产契合角度：现有能力可支撑目标，需补充少量适配。",
        findings: ["现有资产覆盖 70%", "需新增一个适配模块"],
        evidenceRefs: ["child:asset_fit:evidence-1"],
        uncertainty: "适配模块的复杂度待评估。",
        confidence: 0.68,
      },
    },
    // call 3: deep.decision → synthesize（child 材料已就绪）
    {
      output: {
        action: "synthesize",
        childSpecs: [],
        decisionSummary: "child 局部材料已返回，进入父层综合产出结论。",
        rationale: "manager 判定证据已足够综合，不再派生新 child。",
        uncertainty: "冲突材料需父层综合时取舍。",
        confidence: 0.76,
        reasoningRefs: [],
      },
    },
    // call 4: deep.synthesis → SynthesizedConclusion（五要素）
    {
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
    },
  ];
  const config = makeTurnRuntime(responses);
  const input = makeStartInput("重构认证模块并迁移到 OAuth2，保证零停机", true);

  const result = await startDeepRun(input, config);

  // 验收：证据不足 → spawn_children 而非伪装完成；child 探索后 synthesize 收束
  assert.equal(result.stopReason, "synthesized");
  assert.equal(result.run.status, "completed");

  // 步骤序列：spawn_children（step0）→ synthesize（step1）
  assert.equal(result.steps.length, 2);
  assert.equal(result.steps[0].dispatchedAction, "spawn_children");
  assert.equal(result.steps[0].childrenAdded?.length, 2);
  assert.ok(
    result.steps[0].depthGuardPassed === true,
    "一层 child depth guard 应通过",
  );
  assert.equal(result.steps[1].dispatchedAction, "synthesize");

  // 两层决策均为模型产出（source:"ai"）
  assert.equal(result.decisions.length, 2);
  assert.equal(result.decisions[0].action, "spawn_children");
  assert.equal(result.decisions[0].source, "ai");
  assert.equal(result.decisions[1].action, "synthesize");
  assert.equal(result.decisions[1].source, "ai");

  // child 探索产出局部材料（含来源/证据/置信度）
  assert.equal(result.childSummaries.length, 2);
  assert.ok(result.childSummaries[0].summary.trim().length > 0);
  assert.ok(result.childSummaries[0].evidenceRefs.length > 0);
  assert.ok(result.childSummaries[0].confidence !== undefined);

  // 父层综合产出 SynthesizedConclusion 五要素
  assert.ok(result.conclusion !== undefined, "synthesize 应产出 SynthesizedConclusion");
  assert.ok(result.conclusion.conclusion.trim().length > 0);
  assert.ok(result.conclusion.oneLineRationale.trim().length > 0);
  assert.ok(result.conclusion.keyEvidenceRefs.length > 0);
  assert.ok(result.conclusion.candidateDispositions.length === 2);
  assert.ok(result.conclusion.mainUncertainty.trim().length > 0);
});

// ---------------------------------------------------------------------------
// 4. 证据不足走 ask_user（不伪装完成，run 置 interrupted）
// ---------------------------------------------------------------------------

test("证据/方向不足时模型选 ask_user 向用户澄清，run 置 interrupted 不伪装完成", async () => {
  // 显式 responses：第一个决策即 ask_user（证据/方向不足）。验证 executor 据此置
  // interrupted，不伪装成已完成判断（AI-first 边界）。
  const responses: FakeModelProviderResponse[] = [
    {
      output: {
        action: "ask_user",
        childSpecs: [],
        decisionSummary: "目标方向存在歧义，需要用户澄清关键约束。",
        rationale: "manager 判定在用户澄清前无法给出可靠结论，不伪装完成。",
        uncertainty: "目标涉及的优先级与资源约束不明确。",
        confidence: 0.4,
        reasoningRefs: [],
      },
    },
  ];
  const config = makeTurnRuntime(responses);
  const input = makeStartInput("优化系统性能", true);

  const result = await startDeepRun(input, config);

  assert.equal(result.stopReason, "ask_user");
  assert.equal(result.run.status, "interrupted");
  assert.equal(result.conclusion, undefined, "ask_user 不应产出结论（不伪装完成）");
  assert.ok(result.decisions.length >= 1);
  assert.equal(result.decisions[0].action, "ask_user");
  assert.equal(result.decisions[0].source, "ai");
  assert.equal(result.steps[0].dispatchedAction, "ask_user");
});

// ---------------------------------------------------------------------------
// 5. stop 动作：模型主动终止，run 置 stopped
// ---------------------------------------------------------------------------

test("stop 动作：模型主动停止，run 置 stopped，产出可观察停止记录", async () => {
  const responses: FakeModelProviderResponse[] = [
    {
      output: {
        action: "stop",
        childSpecs: [],
        decisionSummary: "预算耗尽，停止运行。",
        rationale: "manager 判定继续探索成本高于收益，主动停止。",
        uncertainty: "未完成的部分由用户决定是否重新启动。",
        confidence: 0.3,
        reasoningRefs: [],
      },
    },
  ];
  const config = makeTurnRuntime(responses);
  const input = makeStartInput("长期探索目标", true);

  const result = await startDeepRun(input, config);

  assert.equal(result.stopReason, "stopped");
  assert.equal(result.run.status, "stopped");
  assert.equal(result.conclusion, undefined);
  assert.equal(result.decisions[0].action, "stop");
  assert.equal(result.decisions[0].source, "ai");
});

// ---------------------------------------------------------------------------
// 6. synthesize 拒绝伪造（FR-SAFE-03）：无任何 child 材料时拒绝综合
// ---------------------------------------------------------------------------

test("synthesize 拒绝伪造（FR-SAFE-03）：无 child 材料时拒绝综合，转入 ask_user 不产出伪造结论", async () => {
  // T1-4 新增安全守卫：模型在未派生任何 child、无 child 材料时直接选 synthesize，
  // executor 必须拒绝伪造结论，转入 ask_user/interrupted，而非凭空综合（FR-SAFE-03 防伪造）。
  // （并发启动/wait 真实等待/单 child 失败不击穿/stop 后 pending 不启动 等语义由
  // deep-child-scheduler.test.ts 以受控 exploreFactory 权威验证，此处聚焦 executor 层防伪造。）
  const responses: FakeModelProviderResponse[] = [
    {
      output: {
        action: "synthesize",
        childSpecs: [],
        decisionSummary: "直接综合已有材料产出结论。",
        rationale: "manager 误判已具备材料。",
        uncertainty: "无材料可综合。",
        confidence: 0.5,
        reasoningRefs: [],
      },
    },
  ];
  const config = makeTurnRuntime(responses);
  const input = makeStartInput("需要多角度探索的复杂目标", true);

  const result = await startDeepRun(input, config);

  assert.equal(result.stopReason, "ask_user");
  assert.equal(result.run.status, "interrupted");
  assert.equal(
    result.conclusion,
    undefined,
    "无 child 材料时 synthesize 不得产出伪造结论（FR-SAFE-03）",
  );
  assert.equal(result.childSummaries.length, 0, "未派生 child，不应有任何 child 材料");
  assert.equal(result.childRuns.length, 0);
  assert.equal(result.decisions[0].action, "synthesize");
  assert.equal(result.decisions[0].source, "ai");
  // 拒绝综合时 step 记录事实（note 标注无材料拒绝伪造）
  assert.equal(result.steps[0].dispatchedAction, "synthesize");
  assert.ok(
    result.steps[0].note !== undefined && /拒绝伪造|无任何 child 材料|ask_user/.test(result.steps[0].note),
    `note 应标注拒绝伪造，实际：${result.steps[0].note}`,
  );
});

test("synthesize 前会启动并等待全部 pending child，终态不残留 planned 节点", async () => {
  const responses: FakeModelProviderResponse[] = [
    {
      output: {
        action: "spawn_children",
        childSpecs: [
          {
            specId: "child-spec-a",
            displayName: "A 角度",
            role: "angle_a",
            objective: "从 A 角度收集证据",
            allowedTools: [],
            inputRefs: ["goal:goal-test-deep"],
          },
          {
            specId: "child-spec-b",
            displayName: "B 角度",
            role: "angle_b",
            objective: "从 B 角度收集证据",
            allowedTools: [],
            inputRefs: ["goal:goal-test-deep"],
          },
          {
            specId: "child-spec-c",
            displayName: "C 角度",
            role: "angle_c",
            objective: "从 C 角度收集证据",
            allowedTools: [],
            inputRefs: ["goal:goal-test-deep"],
          },
        ],
        decisionSummary: "需要三个角度并行探索。",
        rationale: "manager 判定需多角度证据。",
        uncertainty: "材料未到位。",
        confidence: 0.7,
        reasoningRefs: [],
      },
    },
    {
      output: {
        summary: "A 角度：材料完成。",
        findings: ["A 发现"],
        evidenceRefs: ["child:a:evidence"],
        uncertainty: "A 不确定性",
        confidence: 0.61,
      },
    },
    {
      output: {
        action: "synthesize",
        childSpecs: [],
        decisionSummary: "已有部分材料，准备综合。",
        rationale: "manager 决定收束。",
        uncertainty: "仍需清空 pending child 后综合。",
        confidence: 0.74,
        reasoningRefs: [],
      },
    },
    {
      output: {
        summary: "B 角度：材料完成。",
        findings: ["B 发现"],
        evidenceRefs: ["child:b:evidence"],
        uncertainty: "B 不确定性",
        confidence: 0.62,
      },
    },
    {
      output: {
        summary: "C 角度：材料完成。",
        findings: ["C 发现"],
        evidenceRefs: ["child:c:evidence"],
        uncertainty: "C 不确定性",
        confidence: 0.63,
      },
    },
    {
      output: {
        conclusion: "三个角度均已完成，目标可继续推进。",
        oneLineRationale: "A/B/C 三类材料均支持继续推进。",
        keyEvidenceRefs: ["child:a:evidence", "child:b:evidence", "child:c:evidence"],
        candidateDispositions: [
          { candidateId: "a", label: "A", selected: true, reason: "A 材料支持。" },
          { candidateId: "b", label: "B", selected: true, reason: "B 材料支持。" },
          { candidateId: "c", label: "C", selected: true, reason: "C 材料支持。" },
        ],
        mainUncertainty: "仍需执行阶段验证。",
        confidence: 0.76,
      },
    },
  ];
  const config: DeepRunExecutorConfig = { ...makeTurnRuntime(responses), maxConcurrency: 1 };
  const input = makeStartInput("需要三个角度逐步探索后综合", true);

  const result = await startDeepRun(input, config);

  assert.equal(result.stopReason, "synthesized");
  assert.equal(result.run.status, "completed");
  assert.equal(result.childSummaries.length, 3, "synthesize 前应启动并回收全部 pending child");
  const snapshot = result.taskBoard?.snapshot();
  assert.ok(snapshot !== undefined);
  assert.equal(
    snapshot.tasks.some((task) => task.status === "pending" || task.status === "running"),
    false,
    "终态 task board 不应残留 pending/running child",
  );
  assert.equal(snapshot.tasks.filter((task) => task.status === "completed").length, 3);
});

test("continue_child 让父层审查后驱动同一个 child run 继续标准 loop，并替换旧材料", async () => {
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
            objective: "从风险角度核查 OAuth2 迁移，初步识别缺口。",
            allowedTools: [],
            inputRefs: ["goal:goal-test-deep"],
          },
        ],
        decisionSummary: "先派生风险角度。",
        rationale: "需要 child 初步材料。",
        uncertainty: "缺少回滚证据。",
        confidence: 0.68,
        reasoningRefs: [],
      },
    },
    {
      output: {
        summary: "风险角度：初步材料完成，但缺少回滚证据。",
        findings: ["回调兼容性需要验证"],
        evidenceRefs: ["child:risk:initial"],
        uncertainty: "回滚路径证据缺失。",
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
            review: {
              decision: "needs_followup",
              reason: "风险 child 初轮材料缺少 OAuth2 回滚证据，父层要求同一个 child 继续补齐。",
              evidenceRefs: ["child:risk:initial"],
              confidence: 0.66,
            },
            instruction: "继续沿用风险角度，补齐 OAuth2 回滚路径证据后重新输出 child material JSON。",
          },
        ],
        decisionSummary: "父层审查认为同一个风险子任务需要继续补证据。",
        rationale: "旧材料不足，但不需要新建重复子任务。",
        uncertainty: "回滚证据仍缺失。",
        confidence: 0.7,
        reasoningRefs: [],
      },
    },
    {
      output: {
        summary: "风险角度：补齐回滚证据，确认保留旧认证入口可降低迁移风险。",
        findings: ["保留旧认证入口是关键回滚措施"],
        evidenceRefs: ["child:risk:rollback"],
        uncertainty: "仍需项目内验证入口数量。",
        confidence: 0.74,
      },
    },
    {
      output: {
        action: "synthesize",
        childSpecs: [],
        decisionSummary: "同一个风险 child 已补齐材料，可以综合。",
        rationale: "父层已审查并补齐缺口。",
        uncertainty: "仍需执行阶段验证。",
        confidence: 0.78,
        reasoningRefs: [],
      },
    },
    {
      output: {
        conclusion: "OAuth2 迁移可推进，但必须保留旧认证入口作为回滚路径。",
        oneLineRationale: "同一个风险子任务补齐后证明回滚措施可行。",
        keyEvidenceRefs: ["child:risk:rollback"],
        candidateDispositions: [
          { candidateId: "risk", label: "风险角度", selected: true, reason: "补齐后的风险材料可采纳。" },
        ],
        mainUncertainty: "入口数量仍需项目内验证。",
        confidence: 0.77,
      },
    },
  ];
  const config = makeTurnRuntime(responses);
  const input = makeStartInput("评估 OAuth2 迁移风险并补齐回滚证据", true);

  const result = await startDeepRun(input, config);

  assert.equal(result.stopReason, "synthesized");
  assert.equal(result.run.status, "completed");
  assert.deepEqual(result.decisions.map((decision) => decision.action), [
    "spawn_children",
    "continue_child",
    "synthesize",
  ]);
  assert.equal(result.steps[1].dispatchedAction, "continue_child");
  assert.deepEqual(result.steps[1].operatedChildRunIds, ["deep-child-run-0001"]);
  assert.equal(result.childSummaries.length, 1, "同一个 child 继续后应替换旧材料而不是追加重复材料");
  assert.equal(result.childSummaries[0]?.childRunId, "deep-child-run-0001");
  assert.deepEqual(result.childSummaries[0]?.evidenceRefs, ["child:risk:rollback"]);
  assert.equal(result.childRuns.length, 1);
  assert.equal(result.childRuns[0]?.childRunId, "deep-child-run-0001");
  assert.equal(result.childRuns[0]?.status, "completed");
  assert.equal(result.childRuns[0]?.evidenceRefs[0], "child:risk:rollback");
  assert.equal(result.childRuns[0]?.executionHistory?.length, 2);
  assert.deepEqual(
    result.childRuns[0]?.executionHistory?.map((segment) => segment.outcome),
    ["completed", "completed"],
  );
  assert.equal(result.childRuns[0]?.parentInstructions?.length, 1);
  assert.equal(result.childRuns[0]?.parentInstructions?.[0]?.source, "manager");
  assert.equal(result.childRuns[0]?.parentInstructions?.[0]?.status, "executed");
  assert.equal(result.childRuns[0]?.parentInstructions?.[0]?.messageRef?.startsWith("child_message:"), true);
  assert.equal(
    result.childRuns[0]?.parentInstructions?.[0]?.instructionSummary.includes("补齐"),
    true,
  );
  assert.deepEqual(result.childRuns[0]?.parentInstructions?.[0]?.review, {
    decision: "needs_followup",
    reason: "风险 child 初轮材料缺少 OAuth2 回滚证据，父层要求同一个 child 继续补齐。",
    evidenceRefs: ["child:risk:initial"],
    confidence: 0.66,
  });
  const snapshot = result.taskBoard?.snapshot();
  assert.ok(snapshot !== undefined);
  assert.equal(snapshot.tasks.length, 1);
  assert.equal(snapshot.tasks[0]?.status, "completed");
  assert.equal(snapshot.tasks[0]?.summary?.evidenceRefs[0], "child:risk:rollback");
});

test("stepLimit 触发时如已有 child 材料必须尝试父层综合，不能 completed 空结论", async () => {
  const responses: FakeModelProviderResponse[] = [
    {
      output: {
        action: "spawn_children",
        childSpecs: [
          {
            specId: "child-spec-risk",
            displayName: "风险角度",
            role: "risk",
            objective: "从风险角度收集证据",
            allowedTools: [],
            inputRefs: ["goal:goal-test-deep"],
          },
        ],
        decisionSummary: "先派生风险角度。",
        rationale: "需要 child 材料。",
        uncertainty: "尚未综合。",
        confidence: 0.7,
        reasoningRefs: [],
      },
    },
    {
      output: {
        summary: "风险角度：材料完成。",
        findings: ["风险可控"],
        evidenceRefs: ["child:risk:evidence"],
        uncertainty: "仍需父层综合。",
        confidence: 0.62,
      },
    },
    {
      output: {
        conclusion: "基于风险角度材料的收口结论：可以继续推进。",
        oneLineRationale: "child 材料已覆盖主要风险。",
        keyEvidenceRefs: ["child:risk:evidence"],
        candidateDispositions: [
          { candidateId: "risk", label: "风险角度", selected: true, reason: "风险材料可采纳。" },
        ],
        mainUncertainty: "只有一个角度，后续仍需执行验证。",
        confidence: 0.66,
      },
    },
  ];
  const config: DeepRunExecutorConfig = { ...makeTurnRuntime(responses), stepLimit: 1 };
  const input = makeStartInput("需要 child 探索但 manager 达到 step 上限的目标", true);

  const result = await startDeepRun(input, config);

  assert.equal(result.stopReason, "step_limit_reached");
  assert.equal(result.run.status, "completed");
  assert.equal(result.childSummaries.length, 1);
  assert.ok(result.conclusion !== undefined);
  assert.ok(result.synthesisRecord !== undefined);
});

test("模型主动 stop 会取消 pending、保留 running 材料并尝试部分综合", async () => {
  const responses: FakeModelProviderResponse[] = [
    {
      output: {
        action: "spawn_children",
        childSpecs: [
          {
            specId: "child-spec-a",
            displayName: "A 角度",
            role: "angle_a",
            objective: "从 A 角度收集证据",
            allowedTools: [],
            inputRefs: ["goal:goal-test-deep"],
          },
          {
            specId: "child-spec-b",
            displayName: "B 角度",
            role: "angle_b",
            objective: "从 B 角度收集证据",
            allowedTools: [],
            inputRefs: ["goal:goal-test-deep"],
          },
          {
            specId: "child-spec-c",
            displayName: "C 角度",
            role: "angle_c",
            objective: "从 C 角度收集证据",
            allowedTools: [],
            inputRefs: ["goal:goal-test-deep"],
          },
        ],
        decisionSummary: "需要三个角度探索。",
        rationale: "manager 判定需多角度证据。",
        uncertainty: "材料未到位。",
        confidence: 0.7,
        reasoningRefs: [],
      },
    },
    {
      output: {
        summary: "A 角度：材料完成。",
        findings: ["A 发现"],
        evidenceRefs: ["child:a:evidence"],
        uncertainty: "A 不确定性",
        confidence: 0.61,
      },
    },
    {
      output: {
        action: "stop",
        childSpecs: [],
        decisionSummary: "预算不足，主动停止。",
        rationale: "manager 判定不再继续探索。",
        uncertainty: "只保留已完成材料。",
        confidence: 0.34,
        reasoningRefs: [],
      },
    },
    {
      output: {
        conclusion: "基于已完成 A 材料的部分结论：暂不继续扩大探索。",
        oneLineRationale: "A 材料可作为保留依据，B/C 已取消。",
        keyEvidenceRefs: ["child:a:evidence"],
        candidateDispositions: [
          { candidateId: "a", label: "A", selected: true, reason: "A 材料已完成。" },
          { candidateId: "bc", label: "B/C", selected: false, reason: "B/C 在停止时未启动。" },
        ],
        mainUncertainty: "B/C 未探索，结论为部分综合。",
        confidence: 0.45,
      },
    },
  ];
  const config: DeepRunExecutorConfig = { ...makeTurnRuntime(responses), maxConcurrency: 1 };
  const input = makeStartInput("需要探索但可能被 manager 主动停止的目标", true);

  const result = await startDeepRun(input, config);

  assert.equal(result.stopReason, "stopped");
  assert.equal(result.run.status, "stopped");
  assert.equal(result.childSummaries.length, 1, "应保留已完成 running child 材料");
  assert.ok(result.conclusion !== undefined, "有材料时模型 stop 应尝试产出 partial synthesis");
  const snapshot = result.taskBoard?.snapshot();
  assert.ok(snapshot !== undefined);
  assert.equal(snapshot.tasks.filter((task) => task.status === "completed").length, 1);
  assert.equal(snapshot.tasks.filter((task) => task.status === "cancelled").length, 2);
  assert.equal(snapshot.tasks.some((task) => task.status === "pending" || task.status === "running"), false);
});

// ---------------------------------------------------------------------------
// 7. spawn 装配 DeepResearchBrief 并在结果暴露 taskBoard（FR-BRIEF-02/03 + FR-PROJ）
// ---------------------------------------------------------------------------

test("spawn_children 装配 DeepResearchBrief 并在结果暴露 taskBoard（FR-BRIEF-02/03 + FR-PROJ）", async () => {
  // T1-4 新增产物：首次 spawn 后装配 DeepResearchBrief（不强制审批，needsUserApproval=false，
  // FR-BRIEF-02），并在结果暴露 taskBoard（FR-PROJ 运行中事实源对外投影）。
  // 序列：spawn_children（1 child，装配 brief + 入板）→ child_material → stop（终止，验证相位）。
  const responses: FakeModelProviderResponse[] = [
    // call 0: spawn_children（派生 1 个 child）
    {
      output: {
        action: "spawn_children",
        childSpecs: [
          {
            specId: "child-spec-probe",
            displayName: "探查角度",
            role: "probe",
            objective: "从探查角度收集关键证据",
            allowedTools: [],
            inputRefs: ["goal:goal-test-deep"],
          },
        ],
        decisionSummary: "证据不足，派生探查 child。",
        rationale: "manager 判定需探查证据。",
        uncertainty: "材料未到位。",
        confidence: 0.6,
        reasoningRefs: [],
      },
    },
    // call 1: child_material（child 探查完成）
    {
      output: {
        summary: "探查角度：收集到关键证据。",
        findings: ["证据探查-1"],
        evidenceRefs: ["child:probe:evidence-1"],
        uncertainty: "证据需复核。",
        confidence: 0.65,
      },
    },
    // call 2: stop（终止运行）
    {
      output: {
        action: "stop",
        childSpecs: [],
        decisionSummary: "预算耗尽，停止。",
        rationale: "manager 主动停止。",
        uncertainty: "未完成部分由用户决定。",
        confidence: 0.3,
        reasoningRefs: [],
      },
    },
  ];
  const config = makeTurnRuntime(responses);
  const input = makeStartInput("评估一个需要探查的技术方向", true);

  const result = await startDeepRun(input, config);

  // stop 终止
  assert.equal(result.stopReason, "stopped");
  assert.equal(result.run.status, "stopped");

  // FR-BRIEF-02/03：首次 spawn 后装配 brief，不强制审批
  assert.ok(result.brief !== undefined, "首次 spawn 应装配 DeepResearchBrief");
  assert.equal(result.brief.needsUserApproval, false, "brief 不强制用户批准（FR-BRIEF-02）");
  assert.equal(result.brief.goal, input.conversation.goal);
  assert.ok(result.brief.plannedAngles.length > 0, "brief 应投影计划探查角度");

  // FR-PROJ：结果暴露 taskBoard（运行中事实源对外投影）
  assert.ok(result.taskBoard !== undefined, "结果应暴露 taskBoard");
  const snapshot = result.taskBoard.snapshot();
  assert.equal(snapshot.runId, input.run.runId);
  assert.equal(snapshot.phase, "stopped", "stop 后 board 相位应切到 stopped");
  // child 已入板（探查 child），snapshot 含 1 个任务
  assert.equal(snapshot.tasks.length, 1);
});
