import assert from "node:assert/strict";
import test from "node:test";
import type { AgentProtocol } from "./agent-loop.js";
import {
  AgentFabricContractError,
  assertNoDirectChildOutputHandoff,
  blockChildAgentRun,
  cloneChildAgentRun,
  completeChildAgentRun,
  createAgentRunTree,
  createChildAgentRun,
  forkAgentWorkspaceProjection,
  interruptChildAgentRun,
  markChildAgentRunParentInstructionExecuted,
  recordChildAgentRunParentInstruction,
  startChildAgentRun,
  validateAgentSpec,
  type AgentSpec,
} from "./agent-fabric.js";
import { InMemoryWorkspace } from "./workspace.js";

test("AgentSpec validation keeps permissions, protocol, and rootlet kind explicit", () => {
  const validRootlet = createSpec({ agentKind: "rootlet", rootletKind: "option" });
  const valid = validateAgentSpec(validRootlet);
  assert.equal(valid.ok, true);

  const validChild = validateAgentSpec(createSpec({ agentKind: "child" }));
  assert.equal(validChild.ok, true);

  const invalid = validateAgentSpec({
    ...validRootlet,
    rootletKind: undefined,
    permissions: {
      ...validRootlet.permissions,
      allowModel: false,
      allowedTools: ["search"],
    },
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.issues.includes("rootlet spec requires rootletKind"), true);
  assert.equal(invalid.issues.includes("tools cannot be exposed when model turns are disabled"), true);
});

test("AgentRunTree and ChildAgentRun clone their specs and runtime refs", () => {
  const spec = createSpec({ agentKind: "rootlet", rootletKind: "risk" });
  const tree = createAgentRunTree({
    treeId: "agent-run-tree-test",
    rootRunId: "orchestrator-run-test",
    rootAgentId: "underground-center-manager",
    rootSpec: createSpec({ agentKind: "manager" }),
    createdAt: "2026-05-07T00:00:00.000Z",
  });
  const planned = createChildAgentRun({
    childRunId: "child-risk-test",
    parentAgentId: tree.rootAgentId,
    spec,
    inputRefs: ["goal-test", "cluster-risk-test"],
    startedAt: "2026-05-07T00:00:01.000Z",
  });
  const running = startChildAgentRun(planned, "2026-05-07T00:00:02.000Z");
  const completed = completeChildAgentRun({
    run: running,
    outputRefs: ["rootlet-output-risk-test"],
    evidenceRefs: ["evidence-risk-test"],
    confidence: 0.76,
    uncertainty: "Risk output is local material until parent synthesis.",
    execution: {
      modelRounds: 3,
      toolRounds: 2,
      modelRequestId: "model-request-child",
      modelResponseId: "model-response-child",
      toolCalls: [
        { callId: "tool-call-1", toolName: "search", status: "completed" },
      ],
    },
    completedAt: "2026-05-07T00:00:03.000Z",
  });

  assert.equal(planned.status, "planned");
  assert.equal(running.status, "running");
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.outputRefs, ["rootlet-output-risk-test"]);
  assert.equal(completed.execution?.modelRounds, 3);
  assert.equal(completed.execution?.toolRounds, 2);
  assert.equal(completed.execution?.toolCalls[0]?.toolName, "search");
  assert.equal(completed.executionHistory?.length, 1);
  assert.equal(completed.executionHistory?.[0]?.outcome, "completed");
  assert.equal(completed.executionHistory?.[0]?.recordedAt, "2026-05-07T00:00:03.000Z");
  assert.notEqual(completed.spec, spec);
  assert.notEqual(completed.spec.instructions, spec.instructions);
  assert.deepEqual(completed.spec.instructions, spec.instructions);
  assert.notEqual(completed.spec.protocol, spec.protocol);
  const clonedCompleted = cloneChildAgentRun(completed);
  assert.notEqual(clonedCompleted.execution, completed.execution);
  assert.notEqual(clonedCompleted.execution?.toolCalls, completed.execution?.toolCalls);
  assert.deepEqual(clonedCompleted.execution, completed.execution);
  assert.notEqual(clonedCompleted.executionHistory, completed.executionHistory);
  assert.notEqual(clonedCompleted.executionHistory?.[0]?.toolCalls, completed.executionHistory?.[0]?.toolCalls);
  assert.deepEqual(clonedCompleted.executionHistory, completed.executionHistory);
});

test("ChildAgentRun can represent a blocked child without treating it as failed", () => {
  const running = startChildAgentRun(
    createChildAgentRun({
      childRunId: "child-blocked-test",
      parentAgentId: "underground-center-manager",
      spec: createSpec({ agentKind: "child" }),
      inputRefs: ["goal-test"],
      startedAt: "2026-05-07T00:00:00.000Z",
    }),
    "2026-05-07T00:00:01.000Z",
  );

  const blocked = blockChildAgentRun({
    run: running,
    reason: "waiting for tool confirmation",
    evidenceRefs: ["call-needs-approval"],
    uncertainty: "Child Agent needs confirmation before continuing.",
    execution: {
      modelRounds: 1,
      toolRounds: 0,
      toolCalls: [
        { callId: "call-needs-approval", toolName: "write_file", status: "approval_required" },
      ],
    },
    pendingApproval: {
      confirmationId: "confirmation-call-needs-approval",
      toolCallId: "call-needs-approval",
      toolName: "write_file",
      title: "需要确认工具调用",
      actionSummary: "写入 notes.md",
      affectedResources: ["notes.md"],
      riskLevel: "medium",
      resumeAvailability: "live",
      requestedAt: "2026-05-07T00:00:01.500Z",
      sourceRefs: ["call-needs-approval"],
    },
    blockedAt: "2026-05-07T00:00:02.000Z",
  });

  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.failureReason, "waiting for tool confirmation");
  assert.deepEqual(blocked.evidenceRefs, ["call-needs-approval"]);
  assert.equal(blocked.execution?.modelRounds, 1);
  assert.equal(blocked.execution?.toolCalls[0]?.status, "approval_required");
  assert.equal(blocked.executionHistory?.length, 1);
  assert.equal(blocked.executionHistory?.[0]?.outcome, "blocked");
  assert.equal(blocked.pendingApproval?.confirmationId, "confirmation-call-needs-approval");
  assert.equal(blocked.pendingApproval?.toolName, "write_file");
  assert.deepEqual(blocked.pendingApproval?.affectedResources, ["notes.md"]);
  assert.equal(blocked.uncertainty, "Child Agent needs confirmation before continuing.");
  assert.equal(blocked.completedAt, "2026-05-07T00:00:02.000Z");

  const cloned = cloneChildAgentRun(blocked);
  assert.notEqual(cloned.pendingApproval, blocked.pendingApproval);
  assert.notEqual(cloned.pendingApproval?.affectedResources, blocked.pendingApproval?.affectedResources);
  assert.deepEqual(cloned.pendingApproval, blocked.pendingApproval);
});

test("ChildAgentRun can represent an interrupted child with execution history", () => {
  const running = startChildAgentRun(
    createChildAgentRun({
      childRunId: "child-interrupted-test",
      parentAgentId: "underground-center-manager",
      spec: createSpec({ agentKind: "child" }),
      inputRefs: ["goal-test"],
      startedAt: "2026-05-07T00:00:00.000Z",
    }),
    "2026-05-07T00:00:01.000Z",
  );

  const interrupted = interruptChildAgentRun(
    running,
    "model call stopped unexpectedly",
    "2026-05-07T00:00:02.000Z",
    {
      modelRounds: 1,
      toolRounds: 0,
      modelRequestId: "model-request-child",
      modelResponseId: "model-response-child",
      toolCalls: [],
    },
  );

  assert.equal(interrupted.status, "interrupted");
  assert.equal(interrupted.failureReason, "model call stopped unexpectedly");
  assert.equal(interrupted.execution?.modelRounds, 1);
  assert.equal(interrupted.executionHistory?.length, 1);
  assert.equal(interrupted.executionHistory?.[0]?.outcome, "interrupted");
  assert.equal(interrupted.executionHistory?.[0]?.recordedAt, "2026-05-07T00:00:02.000Z");
  assert.equal(interrupted.pendingApproval, undefined);
  assert.equal(interrupted.completedAt, "2026-05-07T00:00:02.000Z");
});

test("ChildAgentRun executionHistory preserves each continuation segment while execution stays latest", () => {
  const childRun = createChildAgentRun({
    childRunId: "child-continuation-test",
    parentAgentId: "underground-center-manager",
    spec: createSpec({ agentKind: "child" }),
    inputRefs: ["goal-test"],
    startedAt: "2026-05-07T00:00:00.000Z",
  });
  const firstCompleted = completeChildAgentRun({
    run: startChildAgentRun(childRun, "2026-05-07T00:00:01.000Z"),
    outputRefs: ["child-output-initial"],
    evidenceRefs: ["evidence-initial"],
    execution: {
      modelRounds: 1,
      toolRounds: 0,
      modelRequestId: "model-request-initial",
      modelResponseId: "model-response-initial",
      toolCalls: [],
    },
    completedAt: "2026-05-07T00:00:02.000Z",
  });
  const secondCompleted = completeChildAgentRun({
    run: startChildAgentRun(firstCompleted, "2026-05-07T00:00:03.000Z"),
    outputRefs: ["child-output-followup"],
    evidenceRefs: ["evidence-followup"],
    execution: {
      modelRounds: 2,
      toolRounds: 1,
      modelRequestId: "model-request-followup",
      modelResponseId: "model-response-followup",
      toolCalls: [
        { callId: "tool-call-followup", toolName: "search", status: "completed" },
      ],
    },
    completedAt: "2026-05-07T00:00:04.000Z",
  });

  assert.equal(secondCompleted.execution?.modelRequestId, "model-request-followup");
  assert.equal(secondCompleted.executionHistory?.length, 2);
  assert.deepEqual(
    secondCompleted.executionHistory?.map((segment) => segment.modelRequestId),
    ["model-request-initial", "model-request-followup"],
  );
  assert.deepEqual(
    secondCompleted.executionHistory?.map((segment) => segment.outcome),
    ["completed", "completed"],
  );
  assert.equal(secondCompleted.executionHistory?.[1]?.toolCalls[0]?.toolName, "search");
});

test("ChildAgentRun parentInstructions preserve parent operations separately from execution segments", () => {
  const childRun = createChildAgentRun({
    childRunId: "child-parent-op-test",
    parentAgentId: "underground-center-manager",
    spec: createSpec({ agentKind: "child" }),
    inputRefs: ["goal-test"],
    startedAt: "2026-05-07T00:00:00.000Z",
  });
  const queued = recordChildAgentRunParentInstruction(childRun, {
    instructionId: "child-instruction-1",
    messageRef: "child_message:child-instruction-1",
    source: "manager",
    status: "queued",
    instructionSummary: "补齐边界条件。",
    review: {
      decision: "needs_followup",
      reason: "父层审查发现边界条件不足。",
      evidenceRefs: ["evidence-initial"],
      confidence: 0.7,
    },
    requestedAt: "2026-05-07T00:00:01.000Z",
    queuedAt: "2026-05-07T00:00:01.000Z",
  });
  const executed = markChildAgentRunParentInstructionExecuted(
    queued,
    "child-instruction-1",
    "2026-05-07T00:00:02.000Z",
  );
  const completed = completeChildAgentRun({
    run: startChildAgentRun(executed, "2026-05-07T00:00:03.000Z"),
    outputRefs: ["child-output-followup"],
    evidenceRefs: ["evidence-followup"],
    execution: {
      modelRounds: 1,
      toolRounds: 0,
      toolCalls: [],
    },
    completedAt: "2026-05-07T00:00:04.000Z",
  });

  assert.equal(completed.parentInstructions?.length, 1);
  assert.equal(completed.parentInstructions?.[0]?.status, "executed");
  assert.equal(completed.parentInstructions?.[0]?.source, "manager");
  assert.equal(completed.parentInstructions?.[0]?.messageRef, "child_message:child-instruction-1");
  assert.equal(completed.parentInstructions?.[0]?.instructionSummary, "补齐边界条件。");
  assert.deepEqual(completed.parentInstructions?.[0]?.review, {
    decision: "needs_followup",
    reason: "父层审查发现边界条件不足。",
    evidenceRefs: ["evidence-initial"],
    confidence: 0.7,
  });
  assert.equal(completed.executionHistory?.length, 1);
  const cloned = cloneChildAgentRun(completed);
  assert.notEqual(cloned.parentInstructions, completed.parentInstructions);
  assert.notEqual(cloned.parentInstructions?.[0]?.review?.evidenceRefs, completed.parentInstructions?.[0]?.review?.evidenceRefs);
  assert.deepEqual(cloned.parentInstructions, completed.parentInstructions);
});

test("workspace projection fork is isolated from parent and child mutations", () => {
  const parent = new InMemoryWorkspace({
    traceId: "trace-fabric-test",
    goalId: "goal-fabric-test",
    data: {
      nested: { count: 1 },
      refs: ["a"],
    },
  });
  const child = forkAgentWorkspaceProjection({
    parentWorkspace: parent,
    project: (snapshot) => ({
      traceId: snapshot.traceId,
      count: snapshot.data.nested.count,
      refs: snapshot.data.refs,
    }),
  });

  parent.patch("test", { data: { nested: { count: 2 }, refs: ["b"] } });
  const childSnapshot = child.snapshot();
  childSnapshot.refs.push("mutated");

  assert.equal(child.snapshot().count, 1);
  assert.deepEqual(child.snapshot().refs, ["a"]);
  assert.deepEqual(parent.snapshot().data.refs, ["b"]);
});

test("direct child output refs cannot bypass parent synthesis into handoff", () => {
  const child = completeChildAgentRun({
    run: startChildAgentRun(
      createChildAgentRun({
        childRunId: "child-option-test",
        parentAgentId: "underground-center-manager",
        spec: createSpec({ agentKind: "rootlet", rootletKind: "option" }),
        inputRefs: ["goal-test"],
        startedAt: "2026-05-07T00:00:00.000Z",
      }),
      "2026-05-07T00:00:00.000Z",
    ),
    outputRefs: ["rootlet-output-option-test"],
    completedAt: "2026-05-07T00:00:01.000Z",
  });

  assert.throws(
    () => assertNoDirectChildOutputHandoff({
      handoffInputRefs: ["rootlet-output-option-test"],
      childRuns: [child],
    }),
    AgentFabricContractError,
  );
  assert.doesNotThrow(() => assertNoDirectChildOutputHandoff({
    handoffInputRefs: ["parent-synthesis-test", "candidate-option-test"],
    childRuns: [child],
  }));
});

function createSpec(input: {
  readonly agentKind: AgentSpec["agentKind"];
  readonly rootletKind?: AgentSpec["rootletKind"];
}): AgentSpec {
  const protocol: AgentProtocol = {
    inputs: [{ source: "workspace", key: "goalId", required: true }],
    outputs: [{ type: "material", payloadSchema: "test.material.v1" }],
  };
  return {
    specId: input.rootletKind === undefined ? `spec-${input.agentKind}` : `spec-rootlet-${input.rootletKind}`,
    agentId: input.rootletKind === undefined ? `agent-${input.agentKind}` : `rootlet-explorer-${input.rootletKind}`,
    displayName: input.rootletKind === undefined ? input.agentKind : `Rootlet ${input.rootletKind}`,
    agentKind: input.agentKind,
    role: input.rootletKind === undefined ? input.agentKind : "rootlet_agent",
    rootletKind: input.rootletKind,
    instructions: {
      objective: `Objective for ${input.rootletKind ?? input.agentKind}`,
      systemPromptRef: `prompt:${input.agentKind}:system`,
    },
    protocol,
    promptRef: `prompt:${input.agentKind}`,
    outputContractRef: "contract:test.material.v1",
    permissions: {
      allowModel: true,
      allowedTools: input.rootletKind === undefined ? [] : ["search", "read"],
      maxModelRounds: 2,
      maxToolRounds: 1,
      fallback: "deterministic",
    },
    budget: {
      maxModelRounds: 2,
      maxToolRounds: 1,
      maxOutputRefs: 3,
    },
    inputRefs: ["goal-test"],
    createdAt: "2026-05-07T00:00:00.000Z",
  };
}
