import assert from "node:assert/strict";
import test from "node:test";
import type { FakeModelProviderResponse } from "../../adapters/intelligence/fake-model-provider-contracts.js";
import {
  makeStartInput,
  makeTurnRuntime,
  startDeepRun,
} from "./deep-run-executor-test-support.js";
import type { DeepRunExecutorConfig } from "./deep-run-executor-test-support.js";
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
