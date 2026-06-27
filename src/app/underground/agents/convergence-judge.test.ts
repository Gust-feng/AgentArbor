/**
 * @deprecated 测试废弃候选（T4-1 / ADR-0025 deep 一期）— 随被测 ①/②/②' 废弃候选代码一并退役。
 *
 * 闭环4 §8.1 阶段②：被测代码迁移到 DeepRuntime 后，本测试随之迁移或退役；
 * 当前保持运行不阻塞构建。
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { IntelligenceChannel, ModelRequest, ModelResponse } from "../../../domain/intelligence/index.js";
import {
  createCandidatePool,
  InMemoryMailbox,
  InMemoryWorkspace,
  type AgentRunContext,
  type ExplorationCandidateRef,
  type RootletOutput,
  type UndergroundAgentInvocation,
} from "../../../domain/underground/index.js";
import { AgentTurnRuntime } from "../../../kernel/intelligence/index.js";
import { createGoalIntentProfileForMinimalUnderground } from "../../underground-goal-profile.js";
import { createMinimalUndergroundExplorationPlan } from "../../underground-rootlets.js";
import {
  ConvergenceJudgeAgent,
  type ConvergenceJudgeCapabilities,
  type ConvergenceJudgeWorkspace,
} from "./convergence-judge.js";

test("ConvergenceJudgeAgent reason uses convergence_judgment as the AI main decision path", async () => {
  const agent = new ConvergenceJudgeAgent();
  const channel = new ConvergenceJudgmentTestChannel();
  const ctx = createConvergenceJudgeContext({
    agentTurnRuntime: new AgentTurnRuntime({ intelligenceChannel: channel }),
  });

  const percept = agent.observe(ctx);
  const decision = await agent.reason(ctx, percept);
  const output = agent.act(ctx, decision);
  const guarded = agent.guard(ctx, output);

  assert.equal(channel.requests.length, 1);
  assert.equal(channel.requests[0]?.purpose, "convergence_judgment");
  assert.equal(channel.requests[0]?.outputContract.contractId, "underground.convergence_judgment.v1");
  assert.equal(decision.convergenceStrategy, "ai_judgment");
  assert.notEqual(decision.convergenceStrategy as string, "ai_advisory");
  assert.equal(decision.source, "ai");
  assert.equal(decision.reasoningTrace[0]?.modelCallRefs.length, 1);
  assert.deepEqual(decision.reasoningTrace[0]?.fallbackRefs, []);
  assert.equal(output.convergenceReport.source, "ai");
  assert.equal(output.convergenceReport.outcome, "approved");
  assert.equal(guarded.status, "accepted");
});

test("ConvergenceJudgeAgent reason without AgentTurnRuntime stays stopped and low confidence", async () => {
  const agent = new ConvergenceJudgeAgent();
  const ctx = createConvergenceJudgeContext();

  const decision = await agent.reason(ctx, agent.observe(ctx));
  const output = agent.act(ctx, decision);
  const guarded = agent.guard(ctx, output);

  assert.equal(decision.convergenceStrategy, "deterministic_fallback");
  assert.equal(decision.source, "deterministic_fallback");
  assert.equal(decision.confidence < 0.3, true);
  assert.equal(decision.reasoningTrace[0]?.fallbackRefs.includes("agentturnruntime:missing"), true);
  assert.equal(output.convergenceReport.source, "deterministic_fallback");
  assert.equal(output.convergenceReport.confidence < 0.3, true);
  assert.equal(output.convergenceReport.outcome, "stopped");
  assert.equal(output.convergenceReport.stopReason, "ai_required_for_autonomy");
  assert.equal(guarded.status, "accepted");
});

function createConvergenceJudgeContext(input: {
  readonly agentTurnRuntime?: AgentTurnRuntime;
} = {}): AgentRunContext<ConvergenceJudgeWorkspace, ConvergenceJudgeCapabilities> {
  const goalId = "goal-convergence-test";
  const rawGoal = "Build a governed research agent.";
  const goalIntentProfile = createGoalIntentProfileForMinimalUnderground({
    goalId,
    rawGoal,
    constraints: [],
  });
  const startedPlan = createMinimalUndergroundExplorationPlan(goalId, goalIntentProfile);
  const cluster = startedPlan.rootletClusters[0]!;
  const rootletOutput: RootletOutput = {
    outputId: "rootlet-output-option-test",
    invocationId: "invocation-option-test",
    clusterId: cluster.clusterId,
    kind: cluster.kind,
    producedByAgentId: "rootlet-agent-option-test",
    summary: "Governed research agent option with reviewable handoff evidence.",
    sourceRefs: ["model.requested", "model.completed"],
    evidenceRefs: ["rootlet-output-option-test"],
    soilAssetFitRefs: [],
    constraintRefs: [],
    riskRefs: [],
    status: "produced",
    source: "ai",
  };
  const candidate: ExplorationCandidateRef = {
    id: "candidate-option-test",
    kind: "claim_candidate",
    producedByAgentId: rootletOutput.producedByAgentId,
    clusterId: rootletOutput.clusterId,
    summary: rootletOutput.summary,
    sourceRefs: [rootletOutput.outputId],
    status: "candidate",
  };
  const invocation: UndergroundAgentInvocation = {
    invocationId: rootletOutput.invocationId,
    agentId: rootletOutput.producedByAgentId,
    role: "rootlet_agent",
    inputRefs: [goalId],
    outputRefs: [rootletOutput.outputId],
    status: "completed",
    startedAt: "2026-05-06T00:00:00.000Z",
    completedAt: "2026-05-06T00:00:00.000Z",
  };
  const candidatePool = createCandidatePool({
    poolId: "candidate-pool-convergence-test",
    goalId,
    rootletOutputs: [rootletOutput],
    agentInvocations: [invocation],
    candidates: [candidate],
    updatedAt: "2026-05-06T00:00:00.000Z",
  });
  return {
    workspace: new InMemoryWorkspace<ConvergenceJudgeWorkspace>({
      traceId: "trace-convergence-test",
      goalId,
      rawGoal,
      goalIntentProfile,
      candidatePool,
      rootletOutputs: [rootletOutput],
      constraints: [],
      startedPlan,
    }),
    mailbox: new InMemoryMailbox(),
    capabilities: {
      agentTurnRuntime: input.agentTurnRuntime,
    },
  };
}

class ConvergenceJudgmentTestChannel implements IntelligenceChannel {
  readonly requests: ModelRequest[] = [];

  async request(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    return {
      responseId: "model-response-convergence-test",
      requestId: request.requestId,
      providerId: "convergence-judgment-test-provider",
      providerKind: "fake",
      protocolKind: "openai_compatible_chat_completions",
      model: "convergence-judgment-test-model",
      status: "completed",
      outputKind: request.outputContract.outputKind,
      structuredOutput: {
        candidateDecisions: [
          {
            candidateId: "candidate-option-test",
            status: "accepted",
            reason: "The governed research agent option is the handoff-ready direction.",
            evidenceRefs: ["rootlet-output-option-test"],
            contentDifference: "This option keeps parent convergence in charge of promotion.",
            whyPreferred: "It is the only option candidate and has reviewable evidence.",
            conflictWith: [],
          },
        ],
        recommendedOptionId: "candidate-option-test",
        nextAction: "approve_handoff",
        conflictsNeedingUserInput: [],
        constraintViolations: [],
        overallDirectionSummary: "Approve the governed research agent option for handoff.",
        decisionSummary: "Convergence Judge accepted the option through the AI judgment contract.",
        uncertainty: "This fixture exposes only a safe decision summary, not private reasoning trace.",
        confidence: 0.84,
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
