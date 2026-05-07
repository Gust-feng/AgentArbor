import assert from "node:assert/strict";
import test from "node:test";
import type { AgentProtocol } from "./agent-loop.js";
import {
  AgentFabricContractError,
  assertNoDirectChildOutputHandoff,
  completeChildAgentRun,
  createAgentRunTree,
  createChildAgentRun,
  forkAgentWorkspaceProjection,
  startChildAgentRun,
  validateAgentSpec,
  type AgentSpec,
} from "./agent-fabric.js";
import { InMemoryWorkspace } from "./workspace.js";

test("AgentSpec validation keeps permissions, protocol, and rootlet kind explicit", () => {
  const validRootlet = createSpec({ agentKind: "rootlet", rootletKind: "option" });
  const valid = validateAgentSpec(validRootlet);
  assert.equal(valid.ok, true);

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
    completedAt: "2026-05-07T00:00:03.000Z",
  });

  assert.equal(planned.status, "planned");
  assert.equal(running.status, "running");
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.outputRefs, ["rootlet-output-risk-test"]);
  assert.notEqual(completed.spec, spec);
  assert.notEqual(completed.spec.protocol, spec.protocol);
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
