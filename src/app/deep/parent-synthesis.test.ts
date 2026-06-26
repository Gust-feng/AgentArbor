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
  synthesizeDeepConclusion,
  buildParentSynthesisRecord,
} from "./parent-synthesis.js";
import type { ChildAgentRun, AgentSpec } from "../../domain/underground/agent-fabric.js";
import { AgentFabricContractError } from "../../domain/underground/agent-fabric.js";
import type { DeepChildSummary, DeepChildSpec } from "./contracts.js";
import { nowIso } from "../../kernel/id.js";
import { DEEP_MANAGER_AGENT_ID } from "./child-delegation.js";

// ---------------------------------------------------------------------------
// T2-5 测试点（task.md 验收）：
//   1. 父层综合消费 child 局部材料产出 SynthesizedConclusion（五要素完整）；
//   2. 综合产出 ParentSynthesisResult（run-tree 级记录），字段映射正确
//      （childRunIds / retainedMaterialRefs=采纳 / rejectedMaterialRefs=未采纳 /
//       nextAction=request_convergence / source=ai）；
//   3. 冲突材料带理由（candidateDispositions 各候选 reason 保留）；
//   4. assertNoDirectChildOutputHandoff 硬约束——child outputRefs 直通结论被拒绝
//      （FR-005，AgentFabricContractError 可观察触发）。
//
// 复用边界（与 deep-run-executor.test 一致）：经 AgentTurnRuntime（封装
// NativeIntelligenceChannel + FakeModelProvider）调模型，不重复测模型 IO 解析器。
// ---------------------------------------------------------------------------

function makeTurnRuntime(
  responses?: readonly FakeModelProviderResponse[],
): ReturnType<typeof createDeepTurnRuntime> {
  const provider = new FakeModelProvider({ responses });
  const channel = new NativeIntelligenceChannel({
    provider,
    bus: new InMemoryMessageBus(new InMemoryEventLog()),
  });
  return createDeepTurnRuntime({ intelligenceChannel: channel });
}

function makeChildSpec(role: string): AgentSpec {
  return {
    specId: `spec-${role}`,
    agentId: `deep-child-${role}`,
    displayName: `Deep Child ${role}`,
    agentKind: "child",
    role,
    protocol: {
      inputs: [{ source: "workspace", key: "task_soil_goal", required: true }],
      outputs: [{ type: "material", payloadSchema: "deep.child_material.v1" }],
    },
    promptRef: `prompt:deep.child.${role}.v1`,
    outputContractRef: "deep.child_material.v1",
    permissions: {
      allowModel: true,
      allowedTools: [],
      maxModelRounds: 2,
      maxToolRounds: 2,
      fallback: "disabled",
    },
    budget: { maxModelRounds: 2, maxToolRounds: 2, maxOutputRefs: 6 },
    inputRefs: [],
    createdAt: nowIso(),
  };
}

function makeChildRun(
  id: string,
  role: string,
  outputRefs: readonly string[],
  evidenceRefs: readonly string[] = [],
): ChildAgentRun {
  return {
    childRunId: id,
    parentAgentId: "deep-manager",
    spec: makeChildSpec(role),
    status: "completed",
    inputRefs: [],
    outputRefs: [...outputRefs],
    evidenceRefs: [...evidenceRefs],
    startedAt: nowIso(),
    completedAt: nowIso(),
  };
}

function makeChildSummary(
  childId: string,
  role: string,
  summary: string,
  evidenceRefs: readonly string[],
): DeepChildSummary {
  const spec: DeepChildSpec = {
    specId: `spec-${role}`,
    displayName: `Deep Child ${role}`,
    role,
    objective: summary,
    allowedTools: [],
    inputRefs: [],
  };
  return {
    childRunId: childId,
    spec,
    status: "completed",
    summary,
    findings: [],
    evidenceRefs: [...evidenceRefs],
    confidence: 0.6,
  };
}

// ---------------------------------------------------------------------------
// 1. 父层综合产出 SynthesizedConclusion 五要素 + ParentSynthesisResult 字段映射
// ---------------------------------------------------------------------------

test("synthesizeDeepConclusion：消费 child 材料产出 SynthesizedConclusion 五要素 + ParentSynthesisResult（childRunIds/采纳/未采纳/nextAction/source 映射）", async () => {
  const childRunRisk = makeChildRun(
    "child-run-risk",
    "risk",
    ["child:risk:material-1"],
    ["child:risk:evidence-1"],
  );
  const childRunAsset = makeChildRun(
    "child-run-asset",
    "asset_fit",
    ["child:asset_fit:material-1"],
    ["child:asset_fit:evidence-1"],
  );
  const childSummaries: DeepChildSummary[] = [
    makeChildSummary("child-run-risk", "risk", "风险角度：两个主要风险均有缓解。", [
      "child:risk:evidence-1",
    ]),
    makeChildSummary("child-run-asset", "asset_fit", "资产契合角度：现有能力覆盖 70%。", [
      "child:asset_fit:evidence-1",
    ]),
  ];
  // 冲突材料：两候选分别 selected=true/false，各带理由（验收点 3）
  const synthesisResponse: FakeModelProviderResponse = {
    output: {
      conclusion: "目标可行，风险有缓解路径，资产基本契合，采纳风险约束为主线。",
      oneLineRationale: "多角度材料一致支持推进，关键风险均有缓解方案。",
      keyEvidenceRefs: ["child:risk:evidence-1", "child:asset_fit:evidence-1"],
      candidateDispositions: [
        {
          candidateId: "child-run-risk",
          label: "风险角度",
          selected: true,
          reason: "风险材料与结论方向一致，采纳为主线约束。",
        },
        {
          candidateId: "child-run-asset",
          label: "资产契合角度",
          selected: false,
          reason: "作为补充验证，不作为主线。",
        },
      ],
      mainUncertainty: "staging 验证与适配模块复杂度仍需跟踪。",
      confidence: 0.78,
    },
  };
  const turnRuntime = makeTurnRuntime([synthesisResponse]);

  const outcome = await synthesizeDeepConclusion({
    turnRuntime,
    traceId: "trace-test-synthesis",
    goalId: "goal-test-synthesis",
    runId: "run-test-synthesis",
    goal: "重构认证模块并迁移到 OAuth2",
    taskSoil: createTaskSoil({ rawGoal: "重构认证模块并迁移到 OAuth2" }),
    childSummaries,
    completedChildRuns: [childRunRisk, childRunAsset],
    evidenceRefs: ["child:risk:evidence-1", "child:asset_fit:evidence-1"],
    inputRefs: [],
    maxModelRounds: 1,
    maxToolRounds: 0,
  });

  // 验收点 1：SynthesizedConclusion 五要素完整
  const conclusion = outcome.conclusion;
  assert.ok(conclusion.conclusion.trim().length > 0, "conclusion 非空");
  assert.ok(conclusion.oneLineRationale.trim().length > 0, "oneLineRationale 非空");
  assert.ok(conclusion.keyEvidenceRefs.length > 0, "keyEvidenceRefs 非空");
  assert.ok(conclusion.candidateDispositions.length === 2, "candidateDispositions 两个候选");
  assert.ok(conclusion.mainUncertainty.trim().length > 0, "mainUncertainty 非空");
  assert.equal(conclusion.source, "ai", "综合结论 source=ai（模型产出，非 deterministic_fallback）");

  // 验收点 2：ParentSynthesisResult 字段映射
  const record = outcome.synthesisRecord;
  assert.deepEqual(
    record.childRunIds,
    ["child-run-risk", "child-run-asset"],
    "childRunIds 映射参与综合的 child",
  );
  assert.deepEqual(
    record.retainedMaterialRefs,
    ["child-run-risk"],
    "retainedMaterialRefs = selected=true 的候选（采纳）",
  );
  assert.deepEqual(
    record.rejectedMaterialRefs,
    ["child-run-asset"],
    "rejectedMaterialRefs = selected=false 的候选（未采纳）",
  );
  assert.equal(record.nextAction, "request_convergence", "综合已产出结论，nextAction=request_convergence");
  assert.equal(record.source, "ai", "run-tree 记录 source 跟随 conclusion.source");
  assert.equal(record.parentAgentId, DEEP_MANAGER_AGENT_ID);
  assert.ok(record.outputRefs.length > 0, "综合产出 outputRefs 非空");

  // 验收点 3：冲突材料带理由（reason 保留）
  const retained = conclusion.candidateDispositions.find((c) => c.selected);
  const rejected = conclusion.candidateDispositions.find((c) => !c.selected);
  assert.ok(retained && retained.reason.trim().length > 0, "采纳候选带理由");
  assert.ok(rejected && rejected.reason.trim().length > 0, "未采纳候选带理由");
});

// ---------------------------------------------------------------------------
// 2. assertNoDirectChildOutputHandoff 硬约束：child outputRefs 直通结论被拒绝（FR-005）
// ---------------------------------------------------------------------------

test("synthesizeDeepConclusion：综合产出 outputRefs 直通任何 child outputRefs 时被 assertNoDirectChildOutputHandoff 拒绝（FR-005）", async () => {
  // parseDeepSynthesis 将 outputRefs 设为 `synthesis:${conclusion.slice(0,40)}`。
  // 用一个短结论（< 40 字符 ASCII）使其 outputRefs 可预测，再让 child outputRefs
  // 包含该引用，模拟"直通交接"违规。
  const violationConclusion = "Conflict resolved by synthesis.";
  const violatedRef = `synthesis:${violationConclusion}`;
  const childRunLeak = makeChildRun(
    "child-run-leak",
    "leak",
    [violatedRef], // child outputRefs 直接包含综合产出引用 → 直通交接
  );
  const synthesisResponse: FakeModelProviderResponse = {
    output: {
      conclusion: violationConclusion,
      oneLineRationale: "综合两个角度材料收束。",
      keyEvidenceRefs: ["child:leak:evidence-1"],
      candidateDispositions: [
        {
          candidateId: "child-run-leak",
          label: "泄露角度",
          selected: true,
          reason: "采纳。",
        },
      ],
      mainUncertainty: "无。",
      confidence: 0.6,
    },
  };
  const turnRuntime = makeTurnRuntime([synthesisResponse]);

  await assert.rejects(
    () =>
      synthesizeDeepConclusion({
        turnRuntime,
        traceId: "trace-test-handoff",
        goalId: "goal-test-handoff",
        runId: "run-test-handoff",
        goal: "测试直通交接被拒",
        taskSoil: createTaskSoil({ rawGoal: "测试直通交接被拒" }),
        childSummaries: [
          makeChildSummary("child-run-leak", "leak", "泄露角度材料。", ["child:leak:evidence-1"]),
        ],
        completedChildRuns: [childRunLeak],
        evidenceRefs: ["child:leak:evidence-1"],
        inputRefs: [],
        maxModelRounds: 1,
        maxToolRounds: 0,
      }),
    (error: unknown) => {
      // FR-005 硬约束：直通交接在写入前拒绝，可观察触发 AgentFabricContractError。
      assert.ok(
        error instanceof AgentFabricContractError,
        "直通交接应抛 AgentFabricContractError（可观察硬约束）",
      );
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// 3. buildParentSynthesisRecord：独立验证字段映射口径（无模型依赖，纯函数）
// ---------------------------------------------------------------------------

test("buildParentSynthesisRecord：candidateDispositions selected=true/false 分别映射 retained/rejected，nextAction 固定 request_convergence", () => {
  const conclusion = {
    conclusionId: "deep-conclusion-test",
    conclusion: "结论正文。",
    oneLineRationale: "一句话理由。",
    keyEvidenceRefs: ["ev-1", "ev-2"],
    candidateDispositions: [
      { candidateId: "cand-a", label: "A", selected: true, reason: "采纳 A" },
      { candidateId: "cand-b", label: "B", selected: false, reason: "不采纳 B" },
      { candidateId: "cand-c", label: "C", selected: true, reason: "采纳 C" },
    ],
    mainUncertainty: "主要不确定性。",
    outputRefs: ["synthesis:结论正文。"],
    source: "ai" as const,
    confidence: 0.72,
    createdAt: nowIso(),
  };
  const childRuns: ChildAgentRun[] = [
    makeChildRun("child-a", "a", ["material-a"]),
    makeChildRun("child-b", "b", ["material-b"]),
  ];
  const record = buildParentSynthesisRecord({
    conclusion,
    childRuns,
    parentAgentId: "deep-manager",
    createdAt: nowIso(),
  });

  assert.deepEqual(record.childRunIds, ["child-a", "child-b"]);
  assert.deepEqual(record.retainedMaterialRefs, ["cand-a", "cand-c"], "selected=true → retained");
  assert.deepEqual(record.rejectedMaterialRefs, ["cand-b"], "selected=false → rejected");
  assert.equal(record.nextAction, "request_convergence");
  assert.equal(record.source, "ai");
  assert.equal(record.decisionSummary, "一句话理由。");
  assert.equal(record.uncertainty, "主要不确定性。");
  assert.deepEqual(record.outputRefs, ["synthesis:结论正文。"]);
});
