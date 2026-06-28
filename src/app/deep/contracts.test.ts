import assert from "node:assert/strict";
import test from "node:test";
import { createAgentRunTree, type AgentSpec } from "../../domain/underground/agent-fabric.js";
import {
  AGENT_FABRIC_MVP_MAX_DEPTH,
  assertNoDirectChildOutputHandoff,
  DEEP_CHILD_STATUSES,
  DEEP_DELEGATION_ACTIONS,
  DEEP_RUN_KIND,
  DEEP_RUN_MODE,
  DEEP_TASK_BOARD_PHASES,
  type CandidateDisposition,
  type DeepChildSpec,
  type DeepChildStatus,
  type DeepChildStatusProjectionMap,
  type DeepChildTask,
  type DeepChildTaskSeed,
  type DeepConversation,
  type DeepDelegationAction,
  type DeepDelegationDecision,
  type DeepExplorationReport,
  type DeepLiveChildProjection,
  type DeepLiveChildWorkflowItem,
  type DeepResearchBrief,
  type DeepRun,
  type DeepTaskBoardPhase,
  type DeepTaskBoardSnapshot,
  type SynthesizedConclusion,
} from "./contracts.js";
import {
  AGENT_FABRIC_MVP_MAX_DEPTH as DOMAIN_MAX_DEPTH,
  assertNoDirectChildOutputHandoff as DOMAIN_ASSERT_NO_HANDOFF,
} from "../../domain/underground/agent-fabric.js";

// ---------------------------------------------------------------------------
// T2-1 测试点（task.md）：
//   1. DelegationDecision 动作枚举完备
//   2. SynthesizedConclusion 五要素字段完整
//   3. domain/underground 契约复用而非重定义
// 另覆盖命名红线自检：产物类型不出现 Plan/directionHandoffPackage/artifact/Fruits 字段。
// ---------------------------------------------------------------------------

function makeManagerSpec(): AgentSpec {
  return {
    specId: "manager-spec",
    agentId: "manager",
    displayName: "manager",
    agentKind: "manager",
    role: "manager",
    protocol: { inputs: [], outputs: [] },
    promptRef: "prompt:manager",
    outputContractRef: "contract:manager",
    permissions: {
      allowModel: true,
      allowedTools: [],
      maxModelRounds: 3,
      maxToolRounds: 2,
      fallback: "disabled",
    },
    budget: { maxModelRounds: 3, maxToolRounds: 2 },
    inputRefs: [],
    createdAt: "2026-05-01T00:00:00.000Z",
  };
}

test("DEEP_DELEGATION_ACTIONS 覆盖多 Agent manager 动作且不含普通工具/产物动作", () => {
  assert.equal(DEEP_DELEGATION_ACTIONS.length, 7);
  assert.deepEqual([...DEEP_DELEGATION_ACTIONS].sort(), [
    "ask_user",
    "continue_child",
    "direct_answer",
    "spawn_children",
    "stop",
    "synthesize",
    "wait_children",
  ]);
  // 不含 cognitive-work-session-* 的 use_tools / produce_artifact
  // （工具调用并入 child 探索；产物统一为 SynthesizedConclusion）
  const actions = DEEP_DELEGATION_ACTIONS as readonly string[];
  assert.ok(!actions.includes("use_tools"));
  assert.ok(!actions.includes("produce_artifact"));
});

test("DeepDelegationDecision 可承载多 Agent manager 动作中任一动作", () => {
  const baseDecision: DeepDelegationDecision = {
    decisionId: "decision-1",
    parentAgentId: "manager",
    action: "spawn_children",
    childSpecs: [
      {
        specId: "child-spec-1",
        displayName: "风险探查",
        role: "risk",
        objective: "评估候选 A 的风险",
        allowedTools: ["search", "read"],
        inputRefs: ["goal:1"],
      },
    ],
    childOperations: [],
    decisionSummary: "需要多角度探查",
    rationale: "证据不足以直接结论",
    uncertainty: "候选 A 的长期维护成本未知",
    source: "ai",
    confidence: 0.6,
    reasoningRefs: ["model-call:1"],
    createdAt: "2026-05-01T00:00:00.000Z",
  };
  assert.equal(baseDecision.action, "spawn_children");
  assert.equal(baseDecision.childSpecs.length, 1);
  assert.equal(baseDecision.source, "ai");

  const allActions: readonly DeepDelegationAction[] = DEEP_DELEGATION_ACTIONS;
  for (const action of allActions) {
    const decision: DeepDelegationDecision = { ...baseDecision, action, childSpecs: [], childOperations: [] };
    assert.equal(decision.action, action);
  }
});

test("SynthesizedConclusion 含结论/理由/证据引用/候选取舍/不确定性五要素", () => {
  const dispositions: readonly CandidateDisposition[] = [
    { candidateId: "A", label: "候选 A", selected: true, reason: "成本低且满足核心约束" },
    { candidateId: "B", label: "候选 B", selected: false, reason: "维护成本高，与约束 X 冲突" },
  ];
  const conclusion: SynthesizedConclusion = {
    conclusionId: "conclusion-1",
    conclusion: "采纳候选 A",
    oneLineRationale: "A 在满足核心约束的前提下成本最低",
    keyEvidenceRefs: ["evidence:cost-a", "evidence:constraint-fit-a"],
    candidateDispositions: dispositions,
    mainUncertainty: "A 的长期维护成本未量化，需后续观察",
    outputRefs: ["synthesis:conclusion-1"],
    source: "ai",
    confidence: 0.72,
    createdAt: "2026-05-01T00:00:00.000Z",
  };

  assert.equal(conclusion.conclusion, "采纳候选 A");
  assert.equal(conclusion.oneLineRationale.length > 0, true);
  assert.equal(conclusion.keyEvidenceRefs.length, 2);
  assert.equal(conclusion.candidateDispositions.length, 2);
  // 候选取舍同时解释为什么选 A 与为什么不选 B
  const accepted = conclusion.candidateDispositions.find((d) => d.selected);
  const rejected = conclusion.candidateDispositions.find((d) => !d.selected);
  assert.equal(accepted?.candidateId, "A");
  assert.equal(rejected?.candidateId, "B");
  assert.ok(accepted?.reason.length);
  assert.ok(rejected?.reason.length);
  assert.ok(conclusion.mainUncertainty.length > 0);
});

test("DeepExplorationReport 复用 domain AgentRunTree 并承载结论链", () => {
  // 复用 domain createAgentRunTree 工厂构造合法 run tree（FR-010 复用而非另起）
  const agentRunTree = createAgentRunTree({
    treeId: "tree-1",
    rootRunId: "run-1",
    rootAgentId: "manager",
    rootSpec: makeManagerSpec(),
    createdAt: "2026-05-01T00:00:00.000Z",
  });
  const report: DeepExplorationReport = {
    reportId: "report-1",
    runId: "run-1",
    conversationId: "deep-conversation-1",
    goal: "分析项目",
    agentRunTree,
    childSummaries: [
      {
        childRunId: "child-run-1",
        spec: {
          specId: "child-spec-1",
          displayName: "风险探查",
          role: "risk",
          objective: "评估风险",
          allowedTools: ["search"],
          inputRefs: [],
        },
        status: "completed",
        summary: "发现 2 个风险",
        findings: ["风险 1", "风险 2"],
        evidenceRefs: ["evidence:1"],
        confidence: 0.7,
        uncertainty: "风险量化不足",
      },
    ],
    synthesisRecords: [],
    conclusion: {
      conclusionId: "conclusion-1",
      conclusion: "结论",
      oneLineRationale: "理由",
      keyEvidenceRefs: ["evidence:1"],
      candidateDispositions: [],
      mainUncertainty: "不确定性",
      outputRefs: ["synthesis:1"],
      source: "ai",
      confidence: 0.7,
      createdAt: "2026-05-01T00:00:00.000Z",
    },
    createdAt: "2026-05-01T00:00:00.000Z",
  };
  assert.equal(report.agentRunTree.treeId, "tree-1");
  assert.equal(report.agentRunTree.rootAgentId, "manager");
  assert.equal(report.childSummaries.length, 1);
  assert.equal(report.conclusion.conclusion, "结论");
});

test("DeepConversation 与 DeepRun 携带 deep 隔离标记", () => {
  const conversation: DeepConversation = {
    conversationId: "deep-conversation-1",
    title: "Deep 会话",
    goal: "分析项目",
    isolation: {
      kind: "deep_conversation",
      runKind: DEEP_RUN_KIND,
      runMode: DEEP_RUN_MODE,
    },
    permissionBoundaryRefs: ["read:workspace:current-task"],
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
  assert.equal(conversation.isolation.kind, "deep_conversation");
  assert.equal(conversation.isolation.runKind, "underground");
  assert.equal(conversation.isolation.runMode, "deep");

  const run: DeepRun = {
    runId: "deep-run-1",
    conversationId: conversation.conversationId,
    goal: conversation.goal,
    status: "pending",
    isolation: conversation.isolation,
    startedAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
  assert.equal(run.isolation.runMode, "deep");
});

test("domain/underground run tree 契约复用而非重定义", () => {
  // assertNoDirectChildOutputHandoff 与 AGENT_FABRIC_MVP_MAX_DEPTH 通过 deep 模块
  // 入口 re-export 的就是 domain 同一引用，确保 FR-010 复用而非另起。
  assert.equal(assertNoDirectChildOutputHandoff, DOMAIN_ASSERT_NO_HANDOFF);
  assert.equal(AGENT_FABRIC_MVP_MAX_DEPTH, DOMAIN_MAX_DEPTH);
  assert.equal(AGENT_FABRIC_MVP_MAX_DEPTH, 1);
});

test("命名红线：产物类型字段不出现 Plan/directionHandoffPackage/artifact/Fruits 语义", () => {
  const forbidden = [
    "plan",
    "directionhandoffpackage",
    "directionhandoff",
    "artifact",
    "fruit",
    "fruits",
    "handoffpackage",
  ];
  const sampleConclusion: SynthesizedConclusion = {
    conclusionId: "c",
    conclusion: "c",
    oneLineRationale: "r",
    keyEvidenceRefs: [],
    candidateDispositions: [],
    mainUncertainty: "u",
    outputRefs: [],
    source: "ai",
    confidence: 0.5,
    createdAt: "2026-05-01T00:00:00.000Z",
  };
  const sampleChildSpec: DeepChildSpec = {
    specId: "s",
    displayName: "d",
    role: "r",
    objective: "o",
    allowedTools: [],
    inputRefs: [],
  };
  const conclusionKeys = Object.keys(sampleConclusion).map((k) => k.toLowerCase());
  const childSpecKeys = Object.keys(sampleChildSpec).map((k) => k.toLowerCase());
  for (const key of forbidden) {
    assert.ok(
      !conclusionKeys.includes(key),
      `SynthesizedConclusion 不应包含禁用产物字段 ${key}`,
    );
    assert.ok(
      !childSpecKeys.includes(key),
      `DeepChildSpec 不应包含禁用产物字段 ${key}`,
    );
  }
});

// ---------------------------------------------------------------------------
// T1-1 测试点（tasks.md）：DeepChildStatus 七态完备，DeepChildTask /
// DeepTaskBoardSnapshot / DeepResearchBrief 字段完整，复用既有契约而非重定义，
// 不出现 Plan/directionHandoffPackage/artifact/Fruits 产物字段。
// ---------------------------------------------------------------------------

test("DeepChildStatus 覆盖七态且仅七态", () => {
  assert.equal(DEEP_CHILD_STATUSES.length, 7);
  assert.deepEqual([...DEEP_CHILD_STATUSES].sort(), [
    "blocked",
    "cancelled",
    "completed",
    "failed",
    "interrupted",
    "pending",
    "running",
  ]);
  // 七态均可赋值（类型层面覆盖 + 运行时抽样）
  const all: readonly DeepChildStatus[] = DEEP_CHILD_STATUSES;
  for (const status of all) {
    const task: Pick<DeepChildTask, "status"> = { status };
    assert.equal(task.status, status);
  }
});

test("DeepChildTask 含安全结构化字段且复用 DeepChildSpec/DeepChildSummary", () => {
  const sampleChildSpec: DeepChildSpec = {
    specId: "child-spec-1",
    displayName: "风险探查",
    role: "risk",
    objective: "评估风险",
    allowedTools: ["search"],
    inputRefs: ["goal:1"],
  };
  const task: DeepChildTask = {
    taskId: "deep-task-0001",
    childRunId: "deep-child-run-0001",
    spec: sampleChildSpec,
    status: "pending",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
  // 关键字段完备
  assert.equal(task.taskId, "deep-task-0001");
  assert.equal(task.childRunId, "deep-child-run-0001");
  assert.equal(task.spec, sampleChildSpec); // spec 复用 DeepChildSpec（同引用）
  assert.equal(task.status, "pending");
  assert.equal(task.startedAt, undefined);
  assert.equal(task.completedAt, undefined);
  assert.equal(task.summary, undefined);
  assert.equal(task.failure, undefined);
  assert.equal(task.pendingApproval, undefined);

  // 不含 raw prompt/response/工具原始输出字段（FR-TB-01 安全结构化边界）
  const forbiddenRaw = [
    "prompt",
    "response",
    "rawprompt",
    "rawresponse",
    "tooloutput",
    "toolresult",
    "stdout",
    "stderr",
  ];
  const keys = Object.keys(task).map((k) => k.toLowerCase());
  for (const key of forbiddenRaw) {
    assert.ok(!keys.includes(key), `DeepChildTask 不应包含 raw 材料字段 ${key}`);
  }

  // seed 字段完备（scheduler 入板种子）
  const seed: DeepChildTaskSeed = {
    childRunId: task.childRunId,
    spec: sampleChildSpec,
  };
  assert.equal(seed.childRunId, task.childRunId);
  assert.equal(seed.spec, sampleChildSpec);
});

test("DeepLiveChildProjection 支持协作项右侧工作流安全投影", () => {
  const workflowItem: DeepLiveChildWorkflowItem = {
    itemId: "workflow-1",
    kind: "tool_waiting",
    title: "等待确认",
    detail: "write_file：运行 write_file",
    status: "blocked",
    timestamp: "2026-05-01T00:00:00.000Z",
  };
  const child: DeepLiveChildProjection = {
    childRunId: "deep-child-run-0001",
    displayName: "风险探查",
    objective: "评估风险",
    role: "risk",
    status: "blocked",
    updatedAt: "2026-05-01T00:00:00.000Z",
    latestResult: "等待工具确认",
    workflowItems: [workflowItem],
    execution: {
      modelRounds: 1,
      toolRounds: 1,
      segmentCount: 1,
      latestOutcome: "blocked",
    },
    parentInstructions: [
      {
        instructionId: "instruction-1",
        status: "queued",
        instructionSummary: "继续补齐边界条件。",
        requestedAt: "2026-05-01T00:00:00.000Z",
      },
    ],
  };
  assert.equal(child.workflowItems?.[0]?.kind, "tool_waiting");
  assert.equal(child.execution?.latestOutcome, "blocked");
  assert.equal(child.parentInstructions?.[0]?.status, "queued");

  const forbiddenRaw = ["rawPrompt", "rawResponse", "toolOutput", "stdout", "stderr"];
  const keys = Object.keys(child).join(" ").toLowerCase();
  for (const key of forbiddenRaw) {
    assert.equal(keys.includes(key.toLowerCase()), false);
  }
});

test("DeepTaskBoardSnapshot 含 runId/phase/tasks/updatedAt 且 phase 九态完备", () => {
  assert.equal(DEEP_TASK_BOARD_PHASES.length, 9);
  assert.deepEqual([...DEEP_TASK_BOARD_PHASES].sort(), [
    "completed",
    "deciding",
    "exploring",
    "failed",
    "needs_input",
    "planning",
    "stopped",
    "synthesizing",
    "waiting",
  ]);
  // phase 九态均可赋值
  const all: readonly DeepTaskBoardPhase[] = DEEP_TASK_BOARD_PHASES;
  for (const phase of all) {
    const snap: Pick<DeepTaskBoardSnapshot, "phase"> = { phase };
    assert.equal(snap.phase, phase);
  }

  const snapshot: DeepTaskBoardSnapshot = {
    runId: "deep-run-1",
    phase: "exploring",
    tasks: [],
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
  assert.equal(snapshot.runId, "deep-run-1");
  assert.equal(snapshot.phase, "exploring");
  assert.equal(snapshot.tasks.length, 0);
});

test("DeepResearchBrief 字段完整且不出现 Plan 语义", () => {
  const brief: DeepResearchBrief = {
    briefId: "brief-1",
    goal: "分析项目可行性",
    scopeSummary: "聚焦成本与风险两个角度",
    sourcePolicySummary: "优先 workspace 上下文与一手证据",
    plannedAngles: ["成本角度", "风险角度"],
    needsUserApproval: false,
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
  assert.equal(brief.goal, "分析项目可行性");
  assert.equal(brief.scopeSummary.length > 0, true);
  assert.equal(brief.plannedAngles.length, 2);
  // FR-BRIEF-02：本轮固定 false（不强制审批流程）
  assert.equal(brief.needsUserApproval, false);

  // 命名红线：brief 字段不出现 Plan / directionHandoffPackage / artifact / Fruits
  const forbidden = ["plan", "planpackage", "directionhandoffpackage", "artifact", "fruit", "fruits"];
  const keys = Object.keys(brief).map((k) => k.toLowerCase());
  for (const key of forbidden) {
    assert.ok(!keys.includes(key), `DeepResearchBrief 不应包含禁用产物字段 ${key}`);
  }
});

test("DeepChildStatusProjectionMap 为 DeepChildStatus → 展示状态的映射类型位预留", () => {
  // 类型位预留：映射实现归 T2-1 runtime 派生；此处只校验类型可承载七态 → 展示状态映射。
  // ChildAgentRun["status"] 的合法值为 planned/running/blocked/completed/failed/interrupted/resumed
  // （DeepChildSummary.status 复用之）。pending/cancelled 等任务板专用态由 T2-1
  // 映射为最接近的展示态，blocked/interrupted 作为 child 自身状态保留。
  const sampleMap: DeepChildStatusProjectionMap = {
    pending: "planned",
    running: "running",
    completed: "completed",
    failed: "failed",
    interrupted: "interrupted",
    cancelled: "interrupted",
    blocked: "blocked",
  };
  // 每个任务态都有展示态映射（完备性）
  for (const status of DEEP_CHILD_STATUSES) {
    assert.equal(typeof sampleMap[status], "string");
  }
});
