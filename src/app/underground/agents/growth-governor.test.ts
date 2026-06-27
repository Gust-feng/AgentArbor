/**
 * @deprecated 测试废弃候选（T4-1 / ADR-0025 deep 一期）— 随被测 ①/②/②' 废弃候选代码一并退役。
 *
 * 闭环4 §8.1 阶段②：被测代码迁移到 DeepRuntime 后，本测试随之迁移或退役；
 * 当前保持运行不阻塞构建。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryMailbox,
  InMemoryWorkspace,
  type AgentRunContext,
} from "../../../domain/underground/index.js";
import type { IntelligenceChannel, ModelRequest, ModelResponse } from "../../../domain/intelligence/index.js";
import { AgentTurnRuntime } from "../../../kernel/intelligence/index.js";
import { createGoalIntentProfileForMinimalUnderground } from "../../underground-goal-profile.js";
import { createMinimalUndergroundExplorationPlan } from "../../underground-rootlets.js";
import {
  GrowthGovernorAgent,
  type GrowthGovernorCapabilities,
  type GrowthGovernorWorkspaceSnapshot,
} from "./growth-governor.js";

test("GrowthGovernorAgent reason uses AgentTurnRuntime for rootlet dispatch decision", async () => {
  const agent = new GrowthGovernorAgent();
  const ctx = createGrowthGovernorContext({ agentTurnRuntime: createFakeAgentTurnRuntime() });

  const percept = agent.observe(ctx);
  const decision = await agent.reason(ctx, percept);
  const output = agent.act(ctx, decision);
  const guarded = agent.guard(ctx, output);

  assert.equal(decision.source, "ai");
  assert.equal(decision.confidence > 0.7, true);
  assert.match(decision.dispatchDecision, /rootlet clusters/);
  assert.equal(decision.reasoningTrace[0]?.modelCallRefs.length, 1);
  assert.deepEqual(decision.reasoningTrace[0]?.fallbackRefs, []);
  assert.deepEqual(
    output.startedPlan.rootletClusters.map((cluster) => cluster.kind),
    percept.explorationPlan.rootletClusters.map((cluster) => cluster.kind),
  );
  assert.equal(output.runningRootletInvocations.length, output.startedPlan.rootletClusters.length);
  assert.equal("rootletOutputs" in output, false);
  assert.equal("candidatePool" in output, false);
  assert.equal("directionHandoffPackage" in output, false);
  assert.equal(guarded.status, "accepted");
});

test("GrowthGovernorAgent reason without AgentTurnRuntime returns low-confidence fallback dispatch", async () => {
  const agent = new GrowthGovernorAgent();
  const ctx = createGrowthGovernorContext();

  const percept = agent.observe(ctx);
  const decision = await agent.reason(ctx, percept);

  assert.equal(decision.source, "deterministic_fallback");
  assert.equal(decision.confidence < 0.2, true);
  assert.equal(decision.reasoningTrace[0]?.fallbackRefs.includes("agentturnruntime:missing"), true);
  assert.deepEqual(
    decision.explorationPlan.rootletClusters.map((cluster) => cluster.kind),
    percept.explorationPlan.rootletClusters.map((cluster) => cluster.kind),
  );
});

test("GrowthGovernorAgent act only materializes started plan and invocations", async () => {
  const agent = new GrowthGovernorAgent();
  const ctx = createGrowthGovernorContext({ agentTurnRuntime: createFakeAgentTurnRuntime() });
  const decision = await agent.reason(ctx, agent.observe(ctx));
  const narrowedDecision = {
    ...decision,
    explorationPlan: {
      ...decision.explorationPlan,
      budget: {
        ...decision.explorationPlan.budget,
        maxRootletClusters: 1,
        maxCandidateOutputs: decision.explorationPlan.rootletClusters[0]!.budget.maxCandidateOutputs,
      },
      rootletClusters: [decision.explorationPlan.rootletClusters[0]!],
    },
  };

  const output = agent.act(ctx, narrowedDecision);

  assert.deepEqual(output.startedPlan.rootletClusters.map((cluster) => cluster.kind), [
    narrowedDecision.explorationPlan.rootletClusters[0]!.kind,
  ]);
  assert.equal(output.runningRootletInvocations.length, 1);
  assert.equal(output.centerInvocations[0]?.role, "growth_governor");
});

test("GrowthGovernorAgent guard rejects structural dispatch boundary violations", async () => {
  const agent = new GrowthGovernorAgent();
  const ctx = createGrowthGovernorContext();
  const decision = await agent.reason(ctx, agent.observe(ctx));
  const output = agent.act(ctx, decision);

  const guarded = agent.guard(ctx, {
    ...output,
    runningRootletInvocations: [],
  });

  assert.equal(guarded.status, "rejected");
  assert.equal(
    guarded.guard.violations.some((violation) => violation.code === "GROWTH_GOVERNOR_INVOCATION_MISMATCH"),
    true,
  );
});

function createGrowthGovernorContext(input: {
  readonly agentTurnRuntime?: AgentTurnRuntime;
} = {}): AgentRunContext<GrowthGovernorWorkspaceSnapshot, GrowthGovernorCapabilities> {
  const goalId = "goal-growth-test";
  const rawGoal = "Build a governed research agent with risk evidence constraints and counterfactual review.";
  const goalIntentProfile = createGoalIntentProfileForMinimalUnderground({
    goalId,
    rawGoal,
    constraints: [],
  });
  const explorationPlan = createMinimalUndergroundExplorationPlan(goalId, goalIntentProfile);
  const workspace = new InMemoryWorkspace<GrowthGovernorWorkspaceSnapshot>({
    traceId: "trace-growth-test",
    goalId,
    goal: rawGoal,
    data: {
      goalId,
      rawGoal,
      goalIntentProfile,
      explorationPlan,
    },
  });
  return {
    workspace,
    mailbox: new InMemoryMailbox(),
    capabilities: {
      constraints: [],
      agentTurnRuntime: input.agentTurnRuntime,
    },
  };
}

function createFakeAgentTurnRuntime(): AgentTurnRuntime {
  return new AgentTurnRuntime({ intelligenceChannel: new GrowthGovernorTestChannel() });
}

class GrowthGovernorTestChannel implements IntelligenceChannel {
  async request(request: ModelRequest): Promise<ModelResponse> {
    return {
      responseId: "model-response-growth-test",
      requestId: request.requestId,
      providerId: "growth-governor-test-provider",
      providerKind: "fake",
      protocolKind: "openai_compatible_chat_completions",
      model: "growth-governor-test-model",
      status: "completed",
      outputKind: request.outputContract.outputKind,
      structuredOutput: {
        rootletKinds: availableRootletKinds(request),
        budget: {
          maxRootletClusters: availableRootletKinds(request).length,
          maxCandidateOutputs: 16,
        },
        dispatchDecision: "Start selected rootlet clusters as lower-layer material for parent convergence.",
        decisionSummary: "Growth Governor selected rootlet clusters for controlled dispatch.",
        uncertainty: "This fixture does not approve handoff or bypass parent convergence.",
        confidence: 0.81,
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

function availableRootletKinds(request: ModelRequest): string[] {
  const content = request.sanitizedMessages.map((message) => message.content).join("\n");
  const line = content.split("\n").find((candidate) => candidate.trim().startsWith("Available rootlet kinds:"));
  const rawKinds = line?.slice(line.indexOf(":") + 1).trim() ?? "option";
  return rawKinds
    .split(",")
    .map((kind) => kind.trim())
    .filter((kind) => kind.length > 0);
}
