import assert from "node:assert/strict";
import test from "node:test";
import { FakeModelProvider } from "../../adapters/intelligence/fake-model-provider.js";
import type { FakeModelProviderResponse } from "../../adapters/intelligence/fake-model-provider-contracts.js";
import { InMemoryEventLog } from "../../kernel/events/in-memory-event-log.js";
import { InMemoryMessageBus } from "../../kernel/messages/in-memory-message-bus.js";
import { NativeIntelligenceChannel } from "../../kernel/intelligence/channel.js";
import { createTaskSoil } from "../../domain/soil/task-soil.js";
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

// ---------------------------------------------------------------------------
// 3. 证据不足走 spawn_children 再 synthesize（manager→child→综合完整闭环）
// ---------------------------------------------------------------------------

test("证据不足时模型选 spawn_children 派生 child 探索，材料就绪后 synthesize 收束闭环", async () => {
  // 用显式 responses 序列精确控制动作：spawn_children → 2 child material → synthesize 决策
  // → synthesis 结论。验证六动作分支可分发 + 一层 child 探索 + 父层综合闭环。
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
