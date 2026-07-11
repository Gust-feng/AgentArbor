import assert from "node:assert/strict";
import test from "node:test";
import {
  CapturingFakeModelProvider,
  makeDeepConversation,
  makeStartInput,
  makeTurnRuntime,
  makeTurnRuntimeForProvider,
  startDeepRun,
} from "./deep-run-executor-test-support.js";
import type {
  DeepRunExecutorConfig,
  StartDeepRunInput,
} from "./deep-run-executor-test-support.js";
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
  const config = makeTurnRuntime([
    { output: { action: "direct_answer", childSpecs: [], decisionSummary: "直接回答。", rationale: "无需协作。", uncertainty: "无。", confidence: 0.9, reasoningRefs: [] } },
    { output: { conclusion: "TypeScript 会根据表达式和上下文推导类型。", oneLineRationale: "类型可由赋值和使用位置确定。", keyEvidenceRefs: [], mainUncertainty: "具体行为取决于上下文。", confidence: 0.9 } },
  ]);
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
  const config: DeepRunExecutorConfig = makeTurnRuntimeForProvider(provider);
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
