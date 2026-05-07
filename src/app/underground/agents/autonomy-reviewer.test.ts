import assert from "node:assert/strict";
import test from "node:test";
import type { ModelRequest, ModelResponse, IntelligenceChannel } from "../../../domain/intelligence/index.js";
import {
  InMemoryMailbox,
  createWorkspaceProjectionView,
  type AgentRunContext,
  type CandidatePool,
  type RootletOutput,
  type UndergroundExplorationCycle,
} from "../../../domain/underground/index.js";
import { AgentTurnRuntime } from "../../../kernel/intelligence/index.js";
import { AutonomyReviewerAgent, type AutonomyReviewerWorkspace } from "./autonomy-reviewer.js";

test("AutonomyReviewerAgent reason uses reasonWithAgentTurn and returns AI reasoning trace", async () => {
  const agent = new AutonomyReviewerAgent();
  const ctx = createAutonomyContext({ agentTurnRuntime: createFakeAutonomyRuntime() });

  const percept = agent.observe(ctx);
  const decision = await agent.reason(ctx, percept);

  assert.equal(decision.source, "ai");
  assert.equal(decision.confidence > 0.5, true);
  assert.equal(decision.decision.action, "continue_exploration");
  assert.equal(decision.reasoningTrace.length, 1);
  assert.equal(decision.reasoningTrace[0]?.modelCallRefs.length, 1);
  assert.deepEqual(decision.reasoningTrace[0]?.fallbackRefs, []);
  assert.equal(JSON.stringify(decision.reasoningTrace).includes("chain-of-thought"), false);
});

test("AutonomyReviewerAgent reason without AgentTurnRuntime returns deterministic low-confidence fallback", async () => {
  const agent = new AutonomyReviewerAgent();
  const ctx = createAutonomyContext({});

  const percept = agent.observe(ctx);
  const decision = await agent.reason(ctx, percept);

  assert.equal(decision.source, "deterministic_fallback");
  assert.equal(decision.confidence < 0.2, true);
  assert.equal(decision.decision.action, "stop");
  assert.equal(decision.decision.status, "failed");
  assert.equal(decision.reasoningTrace[0]?.fallbackRefs.includes("deterministic_fallback"), true);
  assert.equal(decision.reasoningTrace[0]?.modelCallRefs.length, 0);
});

test("AutonomyReviewerAgent guard rejects invalid action", async () => {
  const agent = new AutonomyReviewerAgent();
  const ctx = createAutonomyContext({ agentTurnRuntime: createFakeAutonomyRuntime() });
  const decision = await agent.reason(ctx, agent.observe(ctx));

  const badDecision = {
    ...decision,
    decision: { ...decision.decision, action: "invalid_action" as never },
  };
  const output = agent.act(ctx, badDecision);
  const guarded = agent.guard(ctx, output);

  assert.equal(guarded.status, "rejected");
  assert.equal(
    guarded.guard.violations.some((v) => v.code === "AUTONOMY_INVALID_ACTION"),
    true,
  );
});

test("AutonomyReviewerAgent guard rejects continue_exploration without spawnRequests", async () => {
  const agent = new AutonomyReviewerAgent();
  const ctx = createAutonomyContext({ agentTurnRuntime: createFakeAutonomyRuntime() });
  const decision = await agent.reason(ctx, agent.observe(ctx));

  const badDecision = {
    ...decision,
    decision: { ...decision.decision, action: "continue_exploration" as const, spawnRequests: [] },
  };
  const output = agent.act(ctx, badDecision);
  const guarded = agent.guard(ctx, output);

  assert.equal(guarded.status, "rejected");
  assert.equal(
    guarded.guard.violations.some((v) => v.code === "AUTONOMY_CONTINUE_NO_SPAWN"),
    true,
  );
});

test("AutonomyReviewerAgent guard accepts structurally valid decision", async () => {
  const agent = new AutonomyReviewerAgent();
  const ctx = createAutonomyContext({ agentTurnRuntime: createFakeAutonomyRuntime() });
  const decision = await agent.reason(ctx, agent.observe(ctx));
  const output = agent.act(ctx, decision);
  const guarded = agent.guard(ctx, output);

  assert.equal(guarded.status, "accepted");
});

function createAutonomyContext(input: {
  readonly agentTurnRuntime?: AgentTurnRuntime;
}): AgentRunContext<AutonomyReviewerWorkspace, { readonly agentTurnRuntime?: AgentTurnRuntime }> {
  const goalId = "goal-autonomy-test";
  const cycle: UndergroundExplorationCycle = {
    explorationCycleId: "cycle-test-1",
    cycleIndex: 0,
    rootletKinds: ["option", "risk"],
    spawnedRootletCount: 2,
    status: "running",
  };
  const pool: CandidatePool = {
    poolId: "pool-test-1",
    goalId,
    sourceRootletOutputRefs: ["output-1"],
    candidates: [{
      id: "candidate-1",
      status: "candidate" as const,
      kind: "observation" as const,
      clusterId: "cluster-1",
      sourceRefs: ["output-1"],
      producedByAgentId: "underground-rootlet-explorer-option",
      summary: "An option candidate.",
    }],
    candidatesByKind: { option: [{ id: "candidate-1", status: "candidate", kind: "observation", clusterId: "cluster-1", sourceRefs: ["output-1"], producedByAgentId: "underground-rootlet-explorer-option", summary: "An option candidate." }], risk: [], asset_fit: [], evidence: [], constraint: [], counterfactual: [] },
    counts: { total: 1, candidate: 1, accepted: 0, merged: 0, rejected: 0, unknown: 0 },
    updatedAt: "2026-05-06T00:00:00.000Z",
  };
  const rootletOutputs: RootletOutput[] = [{
    outputId: "output-1",
    invocationId: "inv-1",
    clusterId: "cluster-1",
    kind: "option",
    producedByAgentId: "underground-rootlet-explorer-option",
    summary: "Option output.",
    sourceRefs: [],
    evidenceRefs: [],
    soilAssetFitRefs: [],
    constraintRefs: [],
    riskRefs: [],
    status: "produced",
    source: "ai",
  }];
  const projected: AutonomyReviewerWorkspace = {
    goalId,
    rawGoal: "Build a test agent.",
    goalIntentProfile: {
      goalId,
      rawGoal: "Build a test agent.",
      goalStatement: "Build a test agent.",
      keyConcepts: ["test"],
      domainConcepts: ["agent"],
      nonGoals: [],
      acceptanceCriteria: ["Works"],
      assumptions: [],
      riskHints: [],
      constraintHints: [],
      unknowns: [],
      createdAt: "2026-05-06T00:00:00.000Z",
    },
    candidatePool: pool,
    currentCycle: cycle,
    autonomyCycles: [cycle],
    rootletOutputs,
    constraints: [],
    maxAutonomyCycles: 3,
  };
  const workspace = createWorkspaceProjectionView(projected);
  return {
    workspace,
    mailbox: new InMemoryMailbox(),
    capabilities: { agentTurnRuntime: input.agentTurnRuntime },
  };
}

function createFakeAutonomyRuntime(): AgentTurnRuntime {
  return new AgentTurnRuntime({ intelligenceChannel: new AutonomyTestChannel() });
}

class AutonomyTestChannel implements IntelligenceChannel {
  async request(request: ModelRequest): Promise<ModelResponse> {
    return {
      responseId: "model-response-autonomy-test",
      requestId: request.requestId,
      providerId: "autonomy-test-provider",
      providerKind: "fake",
      protocolKind: "openai_compatible_chat_completions",
      model: "autonomy-test-model",
      status: "completed",
      outputKind: request.outputContract.outputKind,
      structuredOutput: {
        action: "continue_exploration",
        completionAssessment: "More exploration needed for counterfactual risks.",
        informationGaps: ["counterfactual analysis", "risk mitigation"],
        spawnRequests: [{
          requestId: "spawn-test-1",
          rootletKind: "counterfactual",
          objective: "Explore counterfactual risks.",
          informationNeeds: ["risk analysis"],
          sourceHints: [],
          expectedEvidence: ["counterfactual output"],
          rationale: "Counterfactual gap identified.",
        }],
        rationale: "The candidate pool shows option coverage but lacks counterfactual analysis.",
        decisionSummary: "Autonomy recommends continued exploration for counterfactual coverage.",
        uncertainty: "Counterfactual risks are not yet quantified.",
        confidence: 0.78,
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
