import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptGuardedAction,
  InMemoryMailbox,
  InMemoryWorkspace,
  runAgentLoopRound,
  type AgentReflection,
  type AgentActionOutput,
  type AgentDecision,
  type AgentLoop,
  type AgentNextDecision,
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

test("AgentLoop runs observe, reason, act, guard, reflect, and decide_next as an explicit round", async () => {
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
    reflect(
      _ctx: AgentRunContext<TestWorkspace>,
      output: TestActionOutput
    ): AgentReflection {
      calls.push("reflect");
      return {
        guardStatus: "accepted",
        outputRefs: output.outputRefs,
        sourceRefs: ["reflect:test"],
      };
    },
    decideNext(
      _ctx: AgentRunContext<TestWorkspace>,
      reflection: AgentReflection
    ): AgentNextDecision {
      calls.push("decide_next");
      return {
        action: "stop",
        reasonRefs: reflection.outputRefs,
      };
    },
  };

  const result = await runAgentLoopRound(loop, { workspace, mailbox });

  assert.deepEqual(calls, ["observe", "reason", "act", "guard", "reflect", "decide_next"]);
  assert.equal(result.guarded.status, "accepted");
  assert.equal(result.output.candidateId, "candidate:test");
  assert.equal(result.nextDecision.action, "stop");
});

test("AgentLoop exposes guard-adjusted output to callers", async () => {
  const workspace = new InMemoryWorkspace<TestWorkspace>({
    traceId: "trace-agent-loop-guarded-output",
    goalId: "goal-agent-loop-guarded-output",
    goal: "sanitize candidate",
    data: {
      goal: "sanitize candidate",
    },
  });
  const mailbox = new InMemoryMailbox();
  const loop: AgentLoop<TestPercept, TestDecision, TestActionOutput, TestWorkspace> = {
    agentId: "test-agent-loop-guarded-output",
    protocol: {
      inputs: [{ source: "workspace", key: "goal", required: true }],
      outputs: [{ type: "candidate", payloadSchema: "test.candidate.v1" }],
    },
    observe(ctx: AgentRunContext<TestWorkspace>): TestPercept {
      return {
        inputRefs: [ctx.workspace.snapshot().goal],
        goal: ctx.workspace.snapshot().data.goal,
      };
    },
    reason(): TestDecision {
      return {
        rationaleRefs: ["reason:test"],
        nextAction: "publish_candidate",
      };
    },
    act(): TestActionOutput {
      return {
        outputRefs: ["candidate:raw"],
        candidateId: "candidate:raw",
      };
    },
    guard(_ctx: AgentRunContext<TestWorkspace>, output: TestActionOutput) {
      return acceptGuardedAction({
        ...output,
        outputRefs: ["candidate:sanitized"],
        candidateId: "candidate:sanitized",
      });
    },
  };

  const result = await runAgentLoopRound(loop, { workspace, mailbox });

  assert.equal(result.output.candidateId, "candidate:sanitized");
  assert.deepEqual(result.reflection.outputRefs, ["candidate:sanitized"]);
});
