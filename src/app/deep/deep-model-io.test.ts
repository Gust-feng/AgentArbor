import assert from "node:assert/strict";
import test from "node:test";
import { createTaskSoil } from "../../domain/soil/task-soil.js";
import type { ChildAgentRun } from "../../domain/underground/agent-fabric.js";
import { deepDecisionMessages, deepSynthesisMessages, parseDeepDecision } from "./deep-model-io.js";

test("parseDeepDecision keeps child budgets optional and only records parent-provided limits", () => {
  const decision = parseDeepDecision({
    parentAgentId: "deep-runtime-manager",
    createdAt: "2026-05-01T00:00:00.000Z",
    value: {
      action: "spawn_children",
      decisionSummary: "派生两个 child，一个限轮次，一个不设默认预算。",
      uncertainty: "仍需 child 探索。",
      confidence: 0.7,
      childSpecs: [
        {
          specId: "limited",
          displayName: "限轮次视角",
          role: "limited",
          objective: "用有限轮次快速核查。",
          allowedTools: ["search"],
          inputRefs: ["goal:1"],
          maxModelRounds: 5,
          maxToolRounds: 3,
        },
        {
          specId: "open",
          displayName: "开放视角",
          role: "open",
          objective: "自主探索直到自然完成。",
          allowedTools: ["search"],
          inputRefs: ["goal:1"],
        },
      ],
    },
  });

  assert.equal(decision.childSpecs[0]?.maxModelRounds, 5);
  assert.equal(decision.childSpecs[0]?.maxToolRounds, 3);
  assert.equal(decision.childSpecs[1]?.maxModelRounds, undefined);
  assert.equal(decision.childSpecs[1]?.maxToolRounds, undefined);
  assert.deepEqual(decision.childOperations, []);
});

test("parseDeepDecision reads parent operations for continuing an existing child run", () => {
  const decision = parseDeepDecision({
    parentAgentId: "deep-runtime-manager",
    createdAt: "2026-05-01T00:00:00.000Z",
    value: {
      action: "continue_child",
      decisionSummary: "父层审查后要求同一个子 Agent 补齐证据。",
      uncertainty: "缺少回滚证据。",
      confidence: 0.64,
      childOperations: [
        {
          childRunId: "deep-child-run-risk",
          review: {
            decision: "needs_followup",
            reason: "初轮材料缺少回滚证据，需要同一个子 Agent 继续补齐。",
            evidenceRefs: ["child:risk:initial"],
            confidence: 0.61,
          },
          instruction: "继续沿用风险视角，补齐回滚路径证据后重新输出 child material JSON。",
        },
      ],
    },
  });

  assert.equal(decision.action, "continue_child");
  assert.deepEqual(decision.childSpecs, []);
  assert.deepEqual(decision.childOperations, [
    {
      childRunId: "deep-child-run-risk",
      review: {
        decision: "needs_followup",
        reason: "初轮材料缺少回滚证据，需要同一个子 Agent 继续补齐。",
        evidenceRefs: ["child:risk:initial"],
        confidence: 0.61,
      },
      instruction: "继续沿用风险视角，补齐回滚路径证据后重新输出 child material JSON。",
    },
  ]);
});

test("parseDeepDecision uses user-facing child fallback names without Deep wording", () => {
  const decision = parseDeepDecision({
    parentAgentId: "deep-runtime-manager",
    createdAt: "2026-05-01T00:00:00.000Z",
    value: {
      action: "spawn_children",
      decisionSummary: "派生一个未命名 child。",
      uncertainty: "仍需 child 探索。",
      confidence: 0.7,
      childSpecs: [
        {
          objective: "补充证据。",
          allowedTools: [],
          inputRefs: [],
        },
      ],
    },
  });

  assert.equal(decision.childSpecs[0]?.displayName, "子 Agent 1");
  assert.equal(decision.childSpecs[0]?.displayName.includes("Deep"), false);
});

test("deepDecisionMessages explains child budgets as optional without showing a default round budget example", () => {
  const messages = deepDecisionMessages({
    goal: "评估迁移方案",
    taskSoil: createTaskSoil({
      rawGoal: "评估迁移方案",
      createdAt: "2026-05-01T00:00:00.000Z",
    }),
    stepIndex: 0,
    stepLimit: 4,
    childSummaries: [],
    priorDecisionSummaries: [],
    evidenceRefs: [],
    permissionBoundaryRefs: [],
    maxChildren: 4,
  });
  const prompt = messages.map((message) => message.content).join("\n");

  assert.match(prompt, /maxModelRounds \/ maxToolRounds 是可选字段/);
  assert.match(prompt, /continue_child/);
  assert.equal(prompt.includes('"maxModelRounds": 4'), false);
  assert.equal(prompt.includes('"maxToolRounds": 4'), false);
});

test("deepDecisionMessages projects recent blocked child reason for parent review", () => {
  const messages = deepDecisionMessages({
    goal: "评估迁移方案",
    taskSoil: createTaskSoil({
      rawGoal: "评估迁移方案",
      createdAt: "2026-05-01T00:00:00.000Z",
    }),
    stepIndex: 1,
    stepLimit: 4,
    childSummaries: [],
    priorDecisionSummaries: [],
    evidenceRefs: [],
    permissionBoundaryRefs: [],
    maxChildren: 4,
    taskBoardSnapshot: {
      runId: "deep-run-1",
      phase: "exploring",
      updatedAt: "2026-05-01T00:00:00.000Z",
      tasks: [
        {
          taskId: "task-1",
          childRunId: "child-blocked",
          spec: {
            specId: "blocked",
            displayName: "文件核查",
            role: "file_review",
            objective: "核查需要写入确认的文件。",
            allowedTools: ["write_file"],
            inputRefs: ["goal:1"],
          },
          status: "blocked",
          updatedAt: "2026-05-01T00:00:00.000Z",
          failure: "waiting for tool confirmation",
        },
      ],
    },
  });
  const prompt = messages.map((message) => message.content).join("\n");

  assert.match(prompt, /blocked=1/);
  assert.match(prompt, /最近受阻 child/);
  assert.match(prompt, /waiting for tool confirmation/);
});

test("deepDecisionMessages projects child run parent operation history for manager review", () => {
  const messages = deepDecisionMessages({
    goal: "评估迁移方案",
    taskSoil: createTaskSoil({
      rawGoal: "评估迁移方案",
      createdAt: "2026-05-01T00:00:00.000Z",
    }),
    stepIndex: 2,
    stepLimit: 4,
    childSummaries: [],
    childRuns: [
      childRunWithParentInstruction({
        childRunId: "child-risk",
        instructionSummary: "补齐回滚路径证据。",
        source: "manager",
        status: "executed",
      }),
    ],
    priorDecisionSummaries: [],
    evidenceRefs: [],
    permissionBoundaryRefs: [],
    maxChildren: 4,
  });
  const prompt = messages.map((message) => message.content).join("\n");

  assert.match(prompt, /Child run facts/);
  assert.match(prompt, /child-risk/);
  assert.match(prompt, /executionSegments=2/);
  assert.match(prompt, /segmentHistory:/);
  assert.match(prompt, /1\.completed model:1 tool:0 toolCalls:\(none\)/);
  assert.match(prompt, /2\.completed model:2 tool:1 toolCalls:search:completed/);
  assert.match(prompt, /manager\/executed \(child_message:instruction-1\): 补齐回滚路径证据。/);
});

test("deepSynthesisMessages projects child run operation facts separately from child material", () => {
  const messages = deepSynthesisMessages({
    goal: "评估迁移方案",
    taskSoil: createTaskSoil({
      rawGoal: "评估迁移方案",
      createdAt: "2026-05-01T00:00:00.000Z",
    }),
    childSummaries: [
      {
        childRunId: "child-risk",
        spec: {
          specId: "risk",
          displayName: "风险角度",
          role: "risk",
          objective: "核查回滚风险。",
          allowedTools: [],
          inputRefs: [],
        },
        status: "completed",
        summary: "风险角度材料已补齐。",
        findings: ["保留旧入口降低风险"],
        evidenceRefs: ["evidence:risk"],
        confidence: 0.7,
      },
    ],
    childRuns: [
      childRunWithParentInstruction({
        childRunId: "child-risk",
        instructionSummary: "继续核对失败路径。",
        source: "control_api",
        status: "executed",
      }),
    ],
    evidenceRefs: ["evidence:risk"],
  });
  const prompt = messages.map((message) => message.content).join("\n");

  assert.match(prompt, /Child materials to synthesize/);
  assert.match(prompt, /Child run facts/);
  assert.match(prompt, /segmentHistory:/);
  assert.match(prompt, /2\.completed model:2 tool:1 toolCalls:search:completed/);
  assert.match(prompt, /control_api\/executed \(child_message:instruction-1\): 继续核对失败路径。/);
});

function childRunWithParentInstruction(input: {
  readonly childRunId: string;
  readonly instructionSummary: string;
  readonly source: "manager" | "control_api";
  readonly status: "queued" | "executed" | "cancelled";
}): ChildAgentRun {
  return {
    childRunId: input.childRunId,
    parentAgentId: "deep-runtime-manager",
    spec: {
      specId: "spec-risk",
      agentId: "child-risk",
      displayName: "风险角度",
      agentKind: "child",
      role: "risk",
      protocol: { inputs: [], outputs: [] },
      promptRef: "prompt:child-risk",
      outputContractRef: "deep.child_material.v1",
      permissions: {
        allowModel: true,
        allowedTools: [],
        fallback: "disabled",
      },
      budget: {},
      inputRefs: [],
      createdAt: "2026-05-01T00:00:00.000Z",
    },
    status: "completed",
    inputRefs: [],
    outputRefs: ["child:output"],
    evidenceRefs: ["evidence:risk"],
    execution: {
      modelRounds: 2,
      toolRounds: 1,
      toolCalls: [{ callId: "tool-1", toolName: "search", status: "completed" }],
    },
    executionHistory: [
      {
        modelRounds: 1,
        toolRounds: 0,
        toolCalls: [],
        outcome: "completed",
        recordedAt: "2026-05-01T00:00:01.000Z",
      },
      {
        modelRounds: 2,
        toolRounds: 1,
        toolCalls: [{ callId: "tool-1", toolName: "search", status: "completed" }],
        outcome: "completed",
        recordedAt: "2026-05-01T00:00:02.000Z",
      },
    ],
    parentInstructions: [
      {
        instructionId: "instruction-1",
        messageRef: "child_message:instruction-1",
        source: input.source,
        status: input.status,
        instructionSummary: input.instructionSummary,
        requestedAt: "2026-05-01T00:00:01.500Z",
        executedAt: input.status === "executed" ? "2026-05-01T00:00:01.600Z" : undefined,
      },
    ],
    startedAt: "2026-05-01T00:00:00.000Z",
    completedAt: "2026-05-01T00:00:02.000Z",
  };
}
