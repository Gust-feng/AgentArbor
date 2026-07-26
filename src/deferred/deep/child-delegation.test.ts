import assert from "node:assert/strict";
import test from "node:test";
import { FakeModelProvider } from "../../adapters/intelligence/fake-model-provider.js";
import type { FakeModelProviderResponse } from "../../adapters/intelligence/fake-model-provider-contracts.js";
import { InMemoryEventLog } from "../../kernel/events/in-memory-event-log.js";
import { InMemoryMessageBus } from "../../kernel/messages/in-memory-message-bus.js";
import { NativeIntelligenceChannel } from "../../kernel/intelligence/channel.js";
import { createChildAgentRun } from "../../domain/underground/agent-fabric.js";
import { AGENT_FABRIC_MVP_MAX_DEPTH } from "../../domain/underground/agent-fabric.js";
import { createDeepTurnRuntime } from "./deep-turn.js";
import type { DeepChildSpec } from "./contracts.js";
import {
  assertOneLayerChildDepth,
  createDeepChildAgentSpec,
  deriveDeepChildren,
  exploreDeepChild,
  DEEP_CHILD_DEPTH_GUARD_CODE,
  DEEP_MAX_CHILDREN,
} from "./child-delegation.js";

// ---------------------------------------------------------------------------
// T2-4 测试点（task.md 验收）：
//   child 工具经 ToolCenter/确认门执行；递归派生子 child 被拒绝（硬约束可观察触发）；
//   超 child 上限时 manager 收束或询问；child 局部材料含来源/证据/置信度。
//
// 复用边界：经 AgentTurnRuntime（封装 NativeIntelligenceChannel + FakeModelProvider）
// 调模型做 child 探索；guard 复用 domain/underground/guard.ts（确定性硬约束）。
// ---------------------------------------------------------------------------

function makeChildSpec(role: string, index: number): DeepChildSpec {
  return {
    specId: `child-spec-${role}-${index}`,
    displayName: `${role} 角度 child`,
    role,
    objective: `从 ${role} 角度探索目标`,
    allowedTools: [],
    inputRefs: [`goal:goal-test`],
  };
}

function makeTurnRuntimeFromProvider(provider: FakeModelProvider) {
  const channel = new NativeIntelligenceChannel({
    provider,
    bus: new InMemoryMessageBus(new InMemoryEventLog()),
  });
  return createDeepTurnRuntime({ intelligenceChannel: channel });
}

// ---------------------------------------------------------------------------
// 1. assertOneLayerChildDepth：manager→child（depth=1）通过，child→grandchild（depth=2）拒绝
// ---------------------------------------------------------------------------

test("assertOneLayerChildDepth：parentDepth=0 派生一层 child（depth=1）通过硬约束", () => {
  const result = assertOneLayerChildDepth({ parentDepth: 0 });
  assert.equal(result.passed, true);
  assert.equal(result.violations.length, 0);
});

test("assertOneLayerChildDepth：parentDepth=1 派生子 child（depth=2 > maxDepth）递归越界被拒绝", () => {
  const result = assertOneLayerChildDepth({ parentDepth: 1 });
  assert.equal(result.passed, false);
  assert.equal(result.violations.length, 1);
  const violation = result.violations[0];
  assert.equal(violation.severity, "error");
  assert.equal(violation.code, DEEP_CHILD_DEPTH_GUARD_CODE);
  assert.ok(
    /depth=2|maxDepth|一层 child/.test(violation.message),
    `violation.message 应标注递归越界与 maxDepth，实际：${violation.message}`,
  );
});

test("assertOneLayerChildDepth 复用 AGENT_FABRIC_MVP_MAX_DEPTH（deep 不自定义 maxDepth 常量）", () => {
  // deep 一期 maxDepth 直接复用 domain AGENT_FABRIC_MVP_MAX_DEPTH（=1），不另起常量
  assert.equal(AGENT_FABRIC_MVP_MAX_DEPTH, 1);
  // parentDepth=0 → childDepth=1 == maxDepth → 通过
  assert.equal(assertOneLayerChildDepth({ parentDepth: 0 }).passed, true);
  // parentDepth=1 → childDepth=2 > maxDepth → 拒绝
  assert.equal(assertOneLayerChildDepth({ parentDepth: 1 }).passed, false);
});

// ---------------------------------------------------------------------------
// 2. deriveDeepChildren：一层 child 正常派生 + 数量上限裁剪 + 递归越界拒绝
// ---------------------------------------------------------------------------

test("deriveDeepChildren：parentDepth=0 时按 childSpecs 正常派生一层 child，depth guard 通过", () => {
  const specs = [makeChildSpec("risk", 0), makeChildSpec("asset_fit", 1)];
  const result = deriveDeepChildren({
    specs,
    parentAgentId: "deep-runtime-manager",
    parentDepth: 0,
    goalId: "goal-test",
    traceId: "trace-test",
    createdAt: "2026-05-01T00:00:00.000Z",
  });

  assert.equal(result.depthGuard.passed, true);
  assert.equal(result.overflowCount, 0);
  assert.equal(result.children.length, 2);
  // 每个派生的 child 是完整 ChildAgentRun（复用 domain createChildAgentRun）
  for (const child of result.children) {
    assert.ok(child.childRunId.length > 0);
    assert.equal(child.parentAgentId, "deep-runtime-manager");
    assert.ok(child.spec.agentId.length > 0);
    assert.ok(child.spec.specId.length > 0);
    // 派生出的 child depth=1（一层边界，不可再派生）
    assert.equal(child.spec.agentKind, "child");
  }
});

test("deriveDeepChildren：超出 maxChildren 上限时裁剪，overflowCount 记录超出数量（不伪造派生成功）", () => {
  // 6 个 childSpec 请求，maxChildren=4 → 仅派生前 4 个，overflowCount=2
  const specs = Array.from({ length: 6 }, (_, index) => makeChildSpec(`role-${index}`, index));
  const result = deriveDeepChildren({
    specs,
    parentAgentId: "deep-runtime-manager",
    parentDepth: 0,
    goalId: "goal-test",
    traceId: "trace-test",
    maxChildren: 4,
    createdAt: "2026-05-01T00:00:00.000Z",
  });

  assert.equal(result.children.length, 4);
  assert.equal(result.overflowCount, 2);
  assert.equal(result.depthGuard.passed, true);
});

test("deriveDeepChildren：默认上限复用 DEEP_MAX_CHILDREN（=4），超出部分记 overflowCount", () => {
  assert.equal(DEEP_MAX_CHILDREN, 4);
  const specs = Array.from({ length: 5 }, (_, index) => makeChildSpec(`r${index}`, index));
  const result = deriveDeepChildren({
    specs,
    parentAgentId: "deep-runtime-manager",
    parentDepth: 0,
    goalId: "goal-test",
    traceId: "trace-test",
  });
  assert.equal(result.children.length, 4);
  assert.equal(result.overflowCount, 1);
});

test("deriveDeepChildren：parentDepth=1 时递归派生子 child 被 depth guard 拒绝，children 为空", () => {
  // child 尝试派生 grandchild（parentDepth=1 → childDepth=2 > maxDepth）
  const result = deriveDeepChildren({
    specs: [makeChildSpec("grandchild-attempt", 0)],
    parentAgentId: "some-child-agent",
    parentDepth: 1,
    goalId: "goal-test",
    traceId: "trace-test",
  });

  assert.equal(result.depthGuard.passed, false);
  assert.equal(result.children.length, 0, "递归越界时不派生任何 child");
  assert.equal(result.overflowCount, 1, "全部 specs 记为 overflow（未派生）");
  assert.equal(result.depthGuard.violations[0].code, DEEP_CHILD_DEPTH_GUARD_CODE);
});

// ---------------------------------------------------------------------------
// 3. createDeepChildAgentSpec：DeepChildSpec 补全为完整 domain AgentSpec
// ---------------------------------------------------------------------------

test("createDeepChildAgentSpec：DeepChildSpec 补全为完整 AgentSpec（不注入默认预算）", () => {
  const childSpec = makeChildSpec("risk", 0);
  const spec = createDeepChildAgentSpec({
    childSpec,
    index: 0,
    goalId: "goal-test",
    traceId: "trace-test",
    createdAt: "2026-05-01T00:00:00.000Z",
  });

  assert.equal(spec.agentKind, "child");
  assert.equal(spec.role, "risk");
  assert.equal(spec.instructions?.objective, childSpec.objective);
  assert.equal(spec.instructions?.systemPromptRef, "prompt:deep.child.agent.standard.v1");
  assert.ok(spec.permissions.allowModel === true);
  assert.equal(spec.permissions.maxModelRounds, undefined);
  assert.equal(spec.permissions.maxToolRounds, undefined);
  assert.equal(spec.budget.maxModelRounds, undefined);
  assert.equal(spec.budget.maxToolRounds, undefined);
  assert.equal(spec.budget.maxChildRuns, undefined);
  assert.equal(spec.budget.maxOutputRefs, undefined);
  assert.deepEqual(spec.budget, {});
  assert.ok(spec.protocol.outputs.length > 0);
  // inputRefs 含 goal/trace 引用（child 工作所需上下文）
  assert.ok(spec.inputRefs.some((ref) => ref.startsWith("goal:")));
  assert.ok(spec.inputRefs.some((ref) => ref.startsWith("trace:")));
});

test("createDeepChildAgentSpec：父 Agent 显式派生预算时写入 child run spec", () => {
  const spec = createDeepChildAgentSpec({
    childSpec: {
      ...makeChildSpec("risk", 0),
      maxModelRounds: 5,
      maxToolRounds: 3,
    },
    index: 0,
    goalId: "goal-test",
    traceId: "trace-test",
    createdAt: "2026-05-01T00:00:00.000Z",
  });

  assert.equal(spec.permissions.maxModelRounds, 5);
  assert.equal(spec.permissions.maxToolRounds, 3);
  assert.equal(spec.budget.maxModelRounds, 5);
  assert.equal(spec.budget.maxToolRounds, 3);
});

test("createDeepChildAgentSpec：空展示名 fallback 使用用户可见的子 Agent 命名", () => {
  const spec = createDeepChildAgentSpec({
    childSpec: {
      ...makeChildSpec("risk", 0),
      displayName: "",
    },
    index: 0,
    goalId: "goal-test",
    traceId: "trace-test",
    createdAt: "2026-05-01T00:00:00.000Z",
  });

  assert.equal(spec.displayName, "子 Agent 1");
  assert.equal(spec.displayName.includes("Deep"), false);
});

// ---------------------------------------------------------------------------
// 4. exploreDeepChild：兼容入口经 child Agent runner 产出 DeepChildSummary（来源/证据/置信度）
// ---------------------------------------------------------------------------

test("exploreDeepChild：经 child Agent runner 调模型产出 DeepChildSummary，含 summary/findings/evidenceRefs/confidence", async () => {
  const childSpec = makeChildSpec("risk", 0);
  const spec = createDeepChildAgentSpec({
    childSpec,
    index: 0,
    goalId: "goal-test",
    traceId: "trace-test",
    createdAt: "2026-05-01T00:00:00.000Z",
  });
  const childRun = createChildAgentRun({
    childRunId: "deep-child-run-test",
    parentAgentId: "deep-runtime-manager",
    spec,
    inputRefs: spec.inputRefs,
    startedAt: "2026-05-01T00:00:00.000Z",
  });

  // 显式 response：child_material 输出含 summary/findings/evidenceRefs/confidence
  const responses: FakeModelProviderResponse[] = [
    {
      output: {
        summary: "风险角度探索：识别出主要风险并有缓解路径。",
        findings: ["风险一：兼容性", "风险二：回滚成本"],
        evidenceRefs: ["child:risk:evidence-1", "child:risk:evidence-2"],
        uncertainty: "缓解路径需在 staging 验证。",
        confidence: 0.65,
      },
    },
  ];
  const provider = new FakeModelProvider({ responses });
  const turnRuntime = makeTurnRuntimeFromProvider(provider);

  const result = await exploreDeepChild({
    childRun,
    childSpec,
    goal: "重构认证模块并迁移到 OAuth2",
    permissionBoundaryRefs: [],
    turnRuntime,
    traceId: "trace-test",
    goalId: "goal-test",
  });

  // DeepChildSummary 含来源/证据/置信度（验收点：child 局部材料含来源/证据/置信度）
  assert.equal(result.summary.status, "completed");
  assert.ok(result.summary.summary.trim().length > 0);
  assert.ok(result.summary.findings.length > 0);
  assert.ok(result.summary.evidenceRefs.length > 0);
  assert.ok(result.summary.confidence !== undefined);
  assert.ok(result.summary.confidence > 0);

  // completedRun 携带产出字段（outputRefs/evidenceRefs/confidence）
  assert.equal(result.completedRun.status, "completed");
  assert.ok(result.completedRun.outputRefs.length > 0);
  assert.ok(result.completedRun.evidenceRefs.length > 0);
  assert.ok(result.completedRun.confidence !== undefined);
});

test("exploreDeepChild：content-aware 默认 fake 也能产出 DeepChildSummary（不依赖显式 responses）", async () => {
  // 不提供 responses 序列，依赖 fake-model-provider-deep 的 content-aware 默认输出
  const childSpec = makeChildSpec("asset_fit", 1);
  const spec = createDeepChildAgentSpec({
    childSpec,
    index: 1,
    goalId: "goal-test",
    traceId: "trace-test",
    createdAt: "2026-05-01T00:00:00.000Z",
  });
  const childRun = createChildAgentRun({
    childRunId: "deep-child-run-default",
    parentAgentId: "deep-runtime-manager",
    spec,
    inputRefs: spec.inputRefs,
    startedAt: "2026-05-01T00:00:00.000Z",
  });
  const provider = new FakeModelProvider();
  const turnRuntime = makeTurnRuntimeFromProvider(provider);

  const result = await exploreDeepChild({
    childRun,
    childSpec,
    goal: "评估目标可行性",
    permissionBoundaryRefs: [],
    turnRuntime,
    traceId: "trace-test",
    goalId: "goal-test",
  });

  assert.equal(result.summary.status, "completed");
  assert.ok(result.summary.summary.trim().length > 0);
  assert.ok(result.summary.evidenceRefs.length > 0);
});
