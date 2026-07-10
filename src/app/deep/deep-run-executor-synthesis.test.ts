import assert from "node:assert/strict";
import test from "node:test";
import type { FakeModelProviderResponse } from "../../adapters/intelligence/fake-model-provider-contracts.js";
import {
  makeStartInput,
  makeTurnRuntime,
  startDeepRun,
} from "./deep-run-executor-test-support.js";
import type { DeepRunExecutorConfig } from "./deep-run-executor-test-support.js";
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
