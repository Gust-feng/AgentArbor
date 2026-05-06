import assert from "node:assert/strict";
import test from "node:test";
import type { Constraint } from "../../../domain/contracts.js";
import {
  InMemoryMailbox,
  InMemoryWorkspace,
  type AgentRunContext,
  type WorkspaceSnapshot,
} from "../../../domain/underground/index.js";
import type { IntelligenceChannel, ModelRequest, ModelResponse } from "../../../domain/intelligence/index.js";
import { AgentTurnRuntime } from "../../../kernel/intelligence/index.js";
import { IntentCoreAgent, type IntentCoreDecision } from "./intent-core.js";

test("IntentCoreAgent reason uses AgentTurnRuntime and returns safe AI reasoning trace", async () => {
  const agent = new IntentCoreAgent();
  const ctx = createIntentCoreContext({
    goal: "Build a governed research agent.",
    agentTurnRuntime: createFakeAgentTurnRuntime(),
  });

  const percept = agent.observe(ctx);
  const decision = await agent.reason(ctx, percept);

  assert.equal(decision.source, "ai");
  assert.equal(decision.confidence > 0.7, true);
  assert.match(decision.goalIntentProfile.goalStatement, /governed research agent/);
  assert.equal(decision.reasoningTrace.length, 1);
  assert.equal(decision.reasoningTrace[0]?.modelCallRefs.length, 1);
  assert.deepEqual(decision.reasoningTrace[0]?.fallbackRefs, []);
  assert.equal(JSON.stringify(decision.reasoningTrace).includes("Raw goal:"), false);
  assert.equal(JSON.stringify(decision.reasoningTrace).includes("chain-of-thought"), false);
});

test("IntentCoreAgent reasoning trace redacts unsafe provider summary fragments", async () => {
  const agent = new IntentCoreAgent();
  const ctx = createIntentCoreContext({
    goal: "Build a governed research agent.",
    agentTurnRuntime: createUnsafeSummaryAgentTurnRuntime(),
  });

  const decision = await agent.reason(ctx, agent.observe(ctx));
  const traceJson = JSON.stringify(decision.reasoningTrace);

  assert.equal(decision.source, "ai");
  assert.equal(traceJson.includes("chain-of-thought"), false);
  assert.equal(traceJson.includes("Raw goal:"), false);
  assert.equal(traceJson.includes("raw provider response"), false);
  assert.equal(traceJson.includes("sk-test-secret"), false);
  assert.equal(traceJson.includes("[redacted-reasoning-detail]"), true);
});

test("IntentCoreAgent reason without AgentTurnRuntime returns deterministic low-confidence fallback", async () => {
  const agent = new IntentCoreAgent();
  const ctx = createIntentCoreContext({ goal: "Build a governed research agent." });

  const percept = agent.observe(ctx);
  const decision = await agent.reason(ctx, percept);

  assert.equal(decision.source, "deterministic_fallback");
  assert.equal(decision.confidence < 0.2, true);
  assert.equal(decision.reasoningTrace[0]?.fallbackRefs.includes("agentturnruntime:missing"), true);
  assert.equal(decision.reasoningTrace[0]?.modelCallRefs.length, 0);
  assert.equal(decision.goalIntentProfile.rawGoal, "Build a governed research agent.");
});

test("IntentCoreAgent act only materializes the decision and guard stays structural", async () => {
  const agent = new IntentCoreAgent();
  const ctx = createIntentCoreContext({
    goal: "Build a governed research agent.",
    agentTurnRuntime: createFakeAgentTurnRuntime(),
  });
  const decision = await agent.reason(ctx, agent.observe(ctx));
  const semanticallyOddDecision: IntentCoreDecision = {
    ...decision,
    goalIntentProfile: {
      ...decision.goalIntentProfile,
      goalStatement: "A semantically odd but structurally valid profile.",
      keyConcepts: ["unrelated"],
      domainConcepts: ["unrelated-domain"],
    },
  };

  const output = agent.act(ctx, semanticallyOddDecision);
  const guarded = agent.guard(ctx, output);

  assert.deepEqual(output.goalIntentProfile, semanticallyOddDecision.goalIntentProfile);
  assert.equal(output.source, semanticallyOddDecision.source);
  assert.equal(guarded.status, "accepted");
});

test("IntentCoreAgent guard rejects hard structural boundaries without judging goal quality", async () => {
  const agent = new IntentCoreAgent();
  const ctx = createIntentCoreContext({
    goal: "Build a governed research agent.",
    constraints: [hardBlockingConstraint("hard-a"), hardBlockingConstraint("hard-b")],
  });
  const decision = await agent.reason(ctx, agent.observe(ctx));

  const guarded = agent.guard(ctx, agent.act(ctx, decision));

  assert.equal(guarded.status, "rejected");
  assert.equal(
    guarded.guard.violations.some((violation) => violation.code === "intent_core:conflicting_hard_constraints"),
    true,
  );
});

function createIntentCoreContext(input: {
  readonly goal: string;
  readonly goalId?: string;
  readonly traceId?: string;
  readonly constraints?: readonly Constraint[];
  readonly agentTurnRuntime?: AgentTurnRuntime;
}): AgentRunContext<
  WorkspaceSnapshot<unknown>,
  { readonly constraints: readonly Constraint[]; readonly agentTurnRuntime?: AgentTurnRuntime }
> {
  const goalId = input.goalId ?? "goal-intent-test";
  const traceId = input.traceId ?? "trace-intent-test";
  const mailbox = new InMemoryMailbox();
  mailbox.route({
    id: "agent-message-intent-test",
    traceId,
    fromAgentId: "user",
    toAgentId: "underground-intent-core",
    type: "goal.received",
    payload: { goalId, goal: input.goal },
    createdAt: "2026-05-06T00:00:00.000Z",
    sourceRef: "goal.received",
  });
  const workspace = new InMemoryWorkspace<WorkspaceSnapshot<unknown>>({
    traceId,
    goalId,
    goal: input.goal,
    data: {},
  });
  return {
    workspace,
    mailbox,
    capabilities: {
      constraints: [...(input.constraints ?? [])],
      agentTurnRuntime: input.agentTurnRuntime,
    },
  };
}

function createFakeAgentTurnRuntime(): AgentTurnRuntime {
  return new AgentTurnRuntime({ intelligenceChannel: new IntentProfileTestChannel() });
}

function createUnsafeSummaryAgentTurnRuntime(): AgentTurnRuntime {
  return new AgentTurnRuntime({ intelligenceChannel: new UnsafeSummaryIntentProfileTestChannel() });
}

class IntentProfileTestChannel implements IntelligenceChannel {
  async request(request: ModelRequest): Promise<ModelResponse> {
    return {
      responseId: "model-response-intent-test",
      requestId: request.requestId,
      providerId: "intent-profile-test-provider",
      providerKind: "fake",
      protocolKind: "openai_compatible_chat_completions",
      model: "intent-profile-test-model",
      status: "completed",
      outputKind: request.outputContract.outputKind,
      structuredOutput: {
        goalStatement: "Build a governed research agent",
        keyConcepts: ["governed", "research", "agent"],
        domainConcepts: ["research", "agent"],
        nonGoals: [],
        acceptanceCriteria: ["The direction remains reviewable before handoff."],
        assumptions: ["The test provider is deterministic."],
        riskHints: ["review-boundary"],
        constraintHints: ["goal:handoff-boundary"],
        unknowns: [],
        decisionSummary: "Intent Core shaped a governed research agent profile.",
        uncertainty: "This is a fixture summary, not private reasoning trace.",
        confidence: 0.82,
      },
      finishReason: "stop",
      validation: { status: "passed", checkedAt: "2026-05-06T00:00:00.000Z", issues: [] },
      completedAt: "2026-05-06T00:00:00.000Z",
    };
  }

  validateResponse(_request: ModelRequest, response: ModelResponse) {
    return response.validation;
  }
}

class UnsafeSummaryIntentProfileTestChannel extends IntentProfileTestChannel {
  override async request(request: ModelRequest): Promise<ModelResponse> {
    const response = await super.request(request);
    return {
      ...response,
      structuredOutput: {
        ...(response.structuredOutput as Record<string, unknown>),
        decisionSummary:
          "chain-of-thought: hidden draft. Raw goal: Build a governed research agent. raw provider response: sk-test-secret",
        uncertainty: "system: internal prompt details should not be stored.",
      },
    };
  }
}

function hardBlockingConstraint(id: string): Constraint {
  return {
    id,
    source: "user",
    type: "scope",
    level: "hard",
    statement: `Hard blocking constraint ${id}.`,
    owner: "user",
    appliesTo: ["direction_handoff"],
    evidenceRefs: [],
    enforcementGate: "direction_handoff",
    conflictPolicy: "block",
    status: "active",
  };
}
