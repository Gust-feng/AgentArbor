import assert from "node:assert/strict";
import test from "node:test";
import type { IntelligenceChannel, ModelRequest, ModelResponse } from "../../../domain/intelligence/index.js";
import {
  InMemoryMailbox,
  createWorkspaceProjectionView,
  type AgentRunContext,
  type RootletOutput,
  type UndergroundAgentInvocation,
} from "../../../domain/underground/index.js";
import { AgentTurnRuntime } from "../../../kernel/intelligence/index.js";
import { CandidateCollectorAgent, type CandidateCollectorWorkspace } from "./candidate-collector.js";

test("CandidateCollectorAgent reason uses reasonWithAgentTurn and returns AI reasoning trace", async () => {
  const agent = new CandidateCollectorAgent();
  const ctx = createCollectorContext({ agentTurnRuntime: createFakeCollectorRuntime() });

  const percept = agent.observe(ctx);
  const decision = await agent.reason(ctx, percept);

  assert.equal(decision.source, "ai");
  assert.equal(decision.confidence > 0.5, true);
  assert.equal(decision.candidateCount, 2);
  assert.match(decision.aggregationRationale, /aggregated/i);
  assert.equal(decision.reasoningTrace.length, 1);
  assert.equal(decision.reasoningTrace[0]?.modelCallRefs.length, 1);
  assert.deepEqual(decision.reasoningTrace[0]?.fallbackRefs, []);
  assert.equal(JSON.stringify(decision.reasoningTrace).includes("chain-of-thought"), false);
});

test("CandidateCollectorAgent reason without AgentTurnRuntime returns deterministic low-confidence fallback", async () => {
  const agent = new CandidateCollectorAgent();
  const ctx = createCollectorContext({});

  const percept = agent.observe(ctx);
  const decision = await agent.reason(ctx, percept);

  assert.equal(decision.source, "deterministic_fallback");
  assert.equal(decision.confidence < 0.2, true);
  assert.equal(decision.candidateCount, 2);
  assert.match(decision.aggregationRationale, /Aggregated 2/);
  assert.equal(decision.reasoningTrace[0]?.fallbackRefs.includes("deterministic_fallback"), true);
  assert.equal(decision.reasoningTrace[0]?.modelCallRefs.length, 0);
});

test("CandidateCollectorAgent act materializes candidate pool and guard stays structural", async () => {
  const agent = new CandidateCollectorAgent();
  const ctx = createCollectorContext({ agentTurnRuntime: createFakeCollectorRuntime() });

  const percept = agent.observe(ctx);
  const decision = await agent.reason(ctx, percept);
  const output = agent.act(ctx, decision);

  assert.equal(output.candidatePool.goalId, "goal-collector-test");
  assert.equal(output.candidatePool.candidates.length, 2);
  assert.equal(output.source, "ai");

  const guarded = agent.guard(ctx, output);
  assert.equal(guarded.status, "accepted");
});

test("CandidateCollectorAgent guard rejects goal mismatch", async () => {
  const agent = new CandidateCollectorAgent();
  const ctx = createCollectorContext({ agentTurnRuntime: createFakeCollectorRuntime() });

  const percept = agent.observe(ctx);
  const decision = await agent.reason(ctx, percept);
  const output = agent.act(ctx, decision);
  const badOutput = {
    ...output,
    candidatePool: { ...output.candidatePool, goalId: "wrong-goal" },
  };
  const guarded = agent.guard(ctx, badOutput);

  assert.equal(guarded.status, "rejected");
  assert.equal(
    guarded.guard.violations.some((v) => v.code === "CANDIDATE_POOL_GOAL_MISMATCH"),
    true,
  );
});

function createCollectorContext(input: {
  readonly agentTurnRuntime?: AgentTurnRuntime;
}): AgentRunContext<CandidateCollectorWorkspace, { readonly agentTurnRuntime?: AgentTurnRuntime }> {
  const goalId = "goal-collector-test";
  const rootletOutputs: RootletOutput[] = [
    {
      outputId: "output-1",
      invocationId: "inv-1",
      clusterId: "cluster-1",
      kind: "option",
      producedByAgentId: "underground-rootlet-explorer-option",
      summary: "Option A: build a modular plugin system.",
      sourceRefs: [],
      evidenceRefs: ["evidence-1"],
      soilAssetFitRefs: [],
      constraintRefs: [],
      riskRefs: [],
      status: "produced",
      source: "ai",
    },
    {
      outputId: "output-2",
      invocationId: "inv-2",
      clusterId: "cluster-2",
      kind: "risk",
      producedByAgentId: "underground-rootlet-explorer-risk",
      summary: "Risk B: dependency lock-in.",
      sourceRefs: [],
      evidenceRefs: ["evidence-2"],
      soilAssetFitRefs: [],
      constraintRefs: [],
      riskRefs: ["risk-1"],
      status: "produced",
      source: "ai",
    },
  ];
  const invocations: UndergroundAgentInvocation[] = [
    {
      invocationId: "inv-1",
      agentId: "underground-rootlet-explorer-option",
      role: "rootlet_agent",
      inputRefs: [],
      outputRefs: ["output-1"],
      status: "completed",
      startedAt: "2026-05-06T00:00:00.000Z",
      completedAt: "2026-05-06T00:01:00.000Z",
    },
    {
      invocationId: "inv-2",
      agentId: "underground-rootlet-explorer-risk",
      role: "rootlet_agent",
      inputRefs: [],
      outputRefs: ["output-2"],
      status: "completed",
      startedAt: "2026-05-06T00:00:00.000Z",
      completedAt: "2026-05-06T00:01:00.000Z",
    },
  ];
  const projected: CandidateCollectorWorkspace = {
    goalId,
    rootletOutputs,
    completedRootletInvocations: invocations,
    centerInvocations: [],
  };
  const workspace = createWorkspaceProjectionView(projected);
  return {
    workspace,
    mailbox: new InMemoryMailbox(),
    capabilities: { agentTurnRuntime: input.agentTurnRuntime },
  };
}

function createFakeCollectorRuntime(): AgentTurnRuntime {
  return new AgentTurnRuntime({ intelligenceChannel: new CollectorTestChannel() });
}

class CollectorTestChannel implements IntelligenceChannel {
  async request(request: ModelRequest): Promise<ModelResponse> {
    return {
      responseId: "model-response-collector-test",
      requestId: request.requestId,
      providerId: "collector-test-provider",
      providerKind: "fake",
      protocolKind: "openai_compatible_chat_completions",
      model: "collector-test-model",
      status: "completed",
      outputKind: request.outputContract.outputKind,
      structuredOutput: {
        aggregationRationale: "Aggregated 2 rootlet outputs. Option and risk candidates are complementary.",
        deduplicationNotes: ["No duplicates found between option and risk outputs."],
        implicitRelations: ["Option A addresses Risk B's dependency lock-in concern."],
        decisionSummary: "Two complementary candidates aggregated for convergence.",
        uncertainty: "Implicit relation strength is estimated, not verified.",
        confidence: 0.76,
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
