import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptGuardedAction,
  InMemoryMailbox,
  InMemoryWorkspace,
  runAgentLoopRound,
  type AgentActionOutput,
  type AgentDecision,
  type AgentLoop,
  type AgentPercept,
  type AgentRunContext,
  type WorkspaceSnapshot,
} from "./index.js";

type TestPercept = AgentPercept & {
  readonly goal: string;
};

type TestDecision = AgentDecision & {
  readonly nextAction: "publish_candidate";
};

type TestActionOutput = AgentActionOutput & {
  readonly candidateId: string;
};

type TestWorkspace = WorkspaceSnapshot<{ readonly goal: string }>;

test("AgentLoop runs observe, reason, act, and guard as an explicit round", async () => {
  const calls: string[] = [];
  const workspace = new InMemoryWorkspace<TestWorkspace>({
    traceId: "trace-agent-loop",
    goalId: "goal-agent-loop",
    goal: "shape underground direction",
    data: {
      goal: "shape underground direction",
    },
  });
  const mailbox = new InMemoryMailbox();
  const loop: AgentLoop<TestPercept, TestDecision, TestActionOutput, TestWorkspace> = {
    agentId: "test-agent-loop",
    protocol: {
      inputs: [{ source: "workspace", key: "goal", required: true }],
      outputs: [{ type: "candidate", payloadSchema: "test.candidate.v1" }],
    },
    observe(ctx: AgentRunContext<TestWorkspace>): TestPercept {
      calls.push("observe");
      return {
        inputRefs: [ctx.workspace.snapshot().goal ?? ""],
        goal: ctx.workspace.snapshot().data.goal,
      };
    },
    reason(_ctx: AgentRunContext<TestWorkspace>, percept: TestPercept): TestDecision {
      calls.push("reason");
      assert.equal(percept.goal, "shape underground direction");
      return {
        rationaleRefs: ["reason:test"],
        nextAction: "publish_candidate",
      };
    },
    act(_ctx: AgentRunContext<TestWorkspace>, decision: TestDecision): TestActionOutput {
      calls.push("act");
      assert.equal(decision.nextAction, "publish_candidate");
      return {
        outputRefs: ["candidate:test"],
        candidateId: "candidate:test",
      };
    },
    guard(_ctx: AgentRunContext<TestWorkspace>, output: TestActionOutput) {
      calls.push("guard");
      return acceptGuardedAction(output);
    },
  };

  const result = await runAgentLoopRound(loop, { workspace, mailbox });

  assert.deepEqual(calls, ["observe", "reason", "act", "guard"]);
  assert.equal(result.guarded.status, "accepted");
  assert.equal(result.output.candidateId, "candidate:test");
});

