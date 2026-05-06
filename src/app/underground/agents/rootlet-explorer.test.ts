import assert from "node:assert/strict";
import test from "node:test";
import type { Constraint } from "../../../domain/contracts.js";
import type { IntelligenceChannel, ModelRequest, ModelResponse } from "../../../domain/intelligence/index.js";
import {
  InMemoryMailbox,
  InMemoryWorkspace,
  type RootletClusterKind,
  type RootletOutput,
  type WorkspaceSnapshot,
} from "../../../domain/underground/index.js";
import { AgentTurnRuntime } from "../../../kernel/intelligence/index.js";
import { createGoalIntentProfileForMinimalUnderground } from "../../underground-goal-profile.js";
import { createMinimalUndergroundExplorationPlan, startRootletClusters } from "../../underground-rootlets.js";
import { RootletExplorerAgent } from "./rootlet-explorer.js";

type RootletExplorerContext = Parameters<RootletExplorerAgent["observe"]>[0];

test("RootletExplorerAgent reason uses AgentTurnRuntime and parser before act materializes outputs", async () => {
  const agent = new RootletExplorerAgent("option");
  const channel = new RootletAdviceTestChannel(validOptionAdviceOutput());
  const ctx = createRootletExplorerContext({
    agentTurnRuntime: new AgentTurnRuntime({ intelligenceChannel: channel }),
  });

  const decision = await agent.reason(ctx, agent.observe(ctx));
  const output = await agent.act(ctx, decision);
  const guarded = agent.guard(ctx, output);

  assert.equal(channel.requests.length, 1);
  assert.equal(channel.requests[0]?.purpose, "rootlet_candidate");
  assert.equal(channel.requests[0]?.outputContract.contractId, "underground.rootlet_candidate_advice.option.v2");
  assert.equal(decision.source, "ai");
  assert.equal(decision.reasoningTrace[0]?.modelCallRefs.length, 1);
  assert.deepEqual(decision.reasoningTrace[0]?.fallbackRefs, []);
  assert.equal(output.source, "ai");
  assert.equal(output.rootletOutputs.length, 2);
  assert.equal(output.rootletOutputs.every((rootletOutput) => rootletOutput.source === "ai"), true);
  assert.equal(output.rootletOutputs.every((rootletOutput) => rootletOutput.invocationId === ctx.workspace.snapshot().data.runningRootletInvocations?.[0]?.invocationId), true);
  assert.equal(output.rootletOutputs.every((rootletOutput) => rootletOutput.sourceRefs.includes("model.requested")), true);
  assert.equal(output.rootletOutputs.every((rootletOutput) => rootletOutput.sourceRefs.includes("model.completed")), true);
  assert.equal(output.rootletOutputs.every((rootletOutput) => rootletOutput.sourceRefs.some((ref) => ref.startsWith("model-candidate:option:"))), true);
  assert.equal(output.rootletOutputs[0]?.sourceRefs.includes("rootlet-variant:option:1"), true);
  assert.equal(output.rootletOutputs[1]?.sourceRefs.includes("rootlet-variant:option:2"), true);
  assert.equal(output.rootletOutputs.every((rootletOutput) => rootletOutput.evidenceRefs.some((ref) => ref.startsWith("model-call:"))), true);
  assert.equal(output.rootletOutputs.every((rootletOutput) => rootletOutput.evidenceRefs.includes("model-call:model-response-rootlet-1")), true);
  const traceJson = JSON.stringify(decision.reasoningTrace);
  assert.equal(traceJson.includes("Raw goal:"), false);
  assert.equal(traceJson.includes("chain-of-thought"), false);
  assert.equal(traceJson.includes("sk-rootlet-secret"), false);
  assert.equal(guarded.status, "accepted");
});

test("RootletExplorerAgent no-runtime reason materializes deterministic fallback with observable fallback refs", async () => {
  const agent = new RootletExplorerAgent("option");
  const ctx = createRootletExplorerContext();

  const decision = await agent.reason(ctx, agent.observe(ctx));
  const output = await agent.act(ctx, decision);
  const guarded = agent.guard(ctx, output);

  assert.equal(decision.source, "deterministic_fallback");
  assert.equal(decision.confidence < 0.2, true);
  assert.equal(decision.reasoningTrace[0]?.fallbackRefs.includes("agentturnruntime:missing"), true);
  assert.equal(output.source, "deterministic_fallback");
  assert.equal(output.rootletOutputs.every((rootletOutput) => rootletOutput.source === "deterministic_fallback"), true);
  assert.equal(output.rootletOutputs.some((rootletOutput) => rootletOutput.sourceRefs.includes("ai-fallback:option")), true);
  assert.equal(output.rootletOutputs.some((rootletOutput) => rootletOutput.sourceRefs.includes("agentturnruntime:missing")), true);
  assert.equal(guarded.status, "accepted");
});

test("RootletExplorerAgent invalid model output falls back without approving parser output", async () => {
  const agent = new RootletExplorerAgent("option");
  const channel = new RootletAdviceTestChannel({
    candidates: [
      {
        summary: "This candidate lacks required option fields and must be discarded.",
      },
    ],
  });
  const ctx = createRootletExplorerContext({
    agentTurnRuntime: new AgentTurnRuntime({ intelligenceChannel: channel }),
  });

  const decision = await agent.reason(ctx, agent.observe(ctx));
  const output = await agent.act(ctx, decision);

  assert.equal(channel.requests.length, 1);
  assert.equal(decision.source, "deterministic_fallback");
  assert.equal(decision.reasoningTrace[0]?.fallbackRefs.some((ref) => ref.startsWith("parser:rootlet_candidate")), true);
  assert.equal(output.rootletOutputs.every((rootletOutput) => rootletOutput.source === "deterministic_fallback"), true);
  assert.equal(output.rootletOutputs.some((rootletOutput) => rootletOutput.sourceRefs.includes("ai-fallback:option")), true);
  assert.equal(output.rootletOutputs.some((rootletOutput) => rootletOutput.sourceRefs.includes("model.completed")), true);
  assert.equal(output.rootletOutputs.some((rootletOutput) => rootletOutput.summary.includes("lacks required option fields")), false);
});

test("RootletExplorerAgent act-only materialization does not trigger another model request", async () => {
  const agent = new RootletExplorerAgent("option");
  const channel = new RootletAdviceTestChannel(validOptionAdviceOutput());
  const ctx = createRootletExplorerContext({
    agentTurnRuntime: new AgentTurnRuntime({ intelligenceChannel: channel }),
  });
  const decision = await agent.reason(ctx, agent.observe(ctx));

  await agent.act(ctx, decision);
  await agent.act(ctx, decision);

  assert.equal(channel.requests.length, 1);
});

test("RootletExplorerAgent guard remains structural and does not judge candidate semantics", async () => {
  const agent = new RootletExplorerAgent("option");
  const channel = new RootletAdviceTestChannel(validOptionAdviceOutput());
  const ctx = createRootletExplorerContext({
    agentTurnRuntime: new AgentTurnRuntime({ intelligenceChannel: channel }),
  });
  const decision = await agent.reason(ctx, agent.observe(ctx));
  const output = await agent.act(ctx, decision);
  const semanticallyOddOutput = {
    ...output,
    rootletOutputs: output.rootletOutputs.map((rootletOutput: RootletOutput) => ({
      ...rootletOutput,
      summary: "A structurally valid but semantically unrelated moon-base candidate.",
    })),
  };

  const guarded = agent.guard(ctx, semanticallyOddOutput);

  assert.equal(guarded.status, "accepted");
  assert.equal(channel.requests.length, 1);
});

function createRootletExplorerContext(input: {
  readonly kind?: RootletClusterKind;
  readonly constraints?: readonly Constraint[];
  readonly agentTurnRuntime?: AgentTurnRuntime;
} = {}): RootletExplorerContext {
  const kind = input.kind ?? "option";
  const goalId = "goal-rootlet-test";
  const rawGoal = "Build a governed research agent with reviewable evidence.";
  const constraints = [...(input.constraints ?? [])];
  const goalIntentProfile = createGoalIntentProfileForMinimalUnderground({
    goalId,
    rawGoal,
    constraints,
  });
  const plan = startRootletClusters(createMinimalUndergroundExplorationPlan(goalId, goalIntentProfile));
  const cluster = plan.rootletClusters.find((candidate) => candidate.kind === kind) ?? plan.rootletClusters[0]!;
  const invocation = {
    invocationId: `invocation-rootlet-${kind}`,
    agentId: `rootlet-explorer-${kind.replace("_", "-")}`,
    role: "rootlet_agent" as const,
    inputRefs: [goalId, plan.planId, cluster.clusterId],
    outputRefs: [] as string[],
    status: "running" as const,
    startedAt: "2026-05-06T00:00:00.000Z",
  };
  const startedPlan = {
    ...plan,
    rootletClusters: [cluster],
    budget: {
      ...plan.budget,
      maxRootletClusters: 1,
      maxCandidateOutputs: cluster.budget.maxCandidateOutputs,
      spentRootletClusters: 1,
      spentCandidateOutputs: 0,
      exhausted: false,
    },
  };
  const workspace = new InMemoryWorkspace<WorkspaceSnapshot<{
    goalId: string;
    rawGoal: string;
    goalIntentProfile: typeof goalIntentProfile;
    startedPlan: typeof startedPlan;
    rootletClusters: typeof startedPlan.rootletClusters;
    runningRootletInvocations: (typeof invocation)[];
  }>>({
    traceId: "trace-rootlet-test",
    goalId,
    goal: rawGoal,
    data: {
      goalId,
      rawGoal,
      goalIntentProfile,
      startedPlan,
      rootletClusters: startedPlan.rootletClusters,
      runningRootletInvocations: [invocation],
    },
  });
  return {
    workspace,
    mailbox: new InMemoryMailbox(),
    capabilities: {
      constraints,
      agentTurnRuntime: input.agentTurnRuntime,
    },
  } as RootletExplorerContext;
}

function validOptionAdviceOutput(): Record<string, unknown> {
  return {
    confidence: 0.83,
    candidates: [
      {
        summary: "Investigate a governed research agent direction before handoff.",
        tradeoffs: ["more evidence", "slower first path"],
        applicability: "Use when parent convergence still needs multiple viable options.",
      },
      {
        summary: "Keep first growth path narrow and evidence-led.",
        tradeoffs: ["less scope", "clearer validation"],
        applicability: "Use when verification gates are more important than breadth.",
      },
    ],
  };
}

class RootletAdviceTestChannel implements IntelligenceChannel {
  readonly requests: ModelRequest[] = [];

  constructor(private readonly output: unknown) {}

  async request(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    return {
      responseId: `model-response-rootlet-${this.requests.length}`,
      requestId: request.requestId,
      providerId: "rootlet-test-provider",
      providerKind: "fake",
      protocolKind: "openai_compatible_chat_completions",
      model: "rootlet-test-model",
      status: "completed",
      outputKind: request.outputContract.outputKind,
      structuredOutput: this.output,
      finishReason: "stop",
      validation: { status: "passed", checkedAt: "2026-05-06T00:00:00.000Z", issues: [] },
      completedAt: "2026-05-06T00:00:00.000Z",
    };
  }

  validateResponse(_request: ModelRequest, response: ModelResponse) {
    return response.validation;
  }
}
