import assert from "node:assert/strict";
import test from "node:test";
import type { Constraint } from "../../../domain/contracts.js";
import type { IntelligenceChannel, ModelRequest, ModelResponse } from "../../../domain/intelligence/index.js";
import {
  applyCandidateConvergenceDecisions,
  compareCandidatesForGoal,
  createCandidatePool,
  createUndergroundConvergenceReport,
  createWorkspaceProjectionView,
  InMemoryMailbox,
  type CandidatePool,
  type ExplorationCandidateRef,
  type RootletOutput,
  type UndergroundAgentInvocation,
  type UndergroundConvergenceReport,
} from "../../../domain/underground/index.js";
import { InMemoryDirectionHandoffPackageStore } from "../../../domain/agentarbor/direction-handoff-package.js";
import { AgentTurnRuntime } from "../../../kernel/intelligence/index.js";
import { createGoalIntentProfileForMinimalUnderground } from "../../underground-goal-profile.js";
import { createMinimalUndergroundExplorationPlan, startRootletClusters } from "../../underground-rootlets.js";
import {
  HandoffStewardAgent,
  type HandoffStewardCapabilities,
  type HandoffStewardWorkspace,
} from "./handoff-steward.js";
import type { AgentRunContext } from "../../../domain/underground/index.js";

test("HandoffStewardAgent reason uses handoff_narrative as the AI handoff material path", async () => {
  const agent = new HandoffStewardAgent();
  const channel = new HandoffNarrativeTestChannel(validHandoffNarrativeOutput());
  const ctx = createHandoffStewardContext({
    agentTurnRuntime: new AgentTurnRuntime({ intelligenceChannel: channel }),
  });

  const percept = agent.observe(ctx);
  const decision = await agent.reason(ctx, percept);
  const output = agent.act(ctx, decision);
  const guarded = agent.guard(ctx, output);

  assert.equal(channel.requests.length, 1);
  assert.equal(channel.requests[0]?.traceId, "trace-handoff-test");
  assert.equal(channel.requests[0]?.purpose, "handoff_narrative");
  assert.equal(channel.requests[0]?.outputContract.contractId, "underground.handoff_narrative.v1");
  assert.equal(decision.handoffStrategy, "ai_narrative");
  assert.equal(decision.source, "ai");
  assert.equal(decision.handoffMaterial.status, "approved");
  assert.equal(decision.reasoningTrace[0]?.modelCallRefs.length, 1);
  assert.deepEqual(decision.reasoningTrace[0]?.fallbackRefs, []);
  assert.equal(output.terminalStatus, "approved_package_created");
  assert.equal(output.directionHandoffPackage.validation.passed, true);
  assert.match(output.directionHandoffPackage.directionHandoff.clarifiedGoal, /evidence-led governed research agent/);
  assert.match(output.directionHandoffPackage.directionHandoff.options[0]?.directionSummary ?? "", /Handoff Steward AI narrative/);
  assert.equal(guarded.status, "accepted");
});

test("HandoffStewardAgent no-runtime fallback never creates an approved package", async () => {
  const agent = new HandoffStewardAgent();
  const ctx = createHandoffStewardContext();

  const decision = await agent.reason(ctx, agent.observe(ctx));
  const output = agent.act(ctx, decision);
  const guarded = agent.guard(ctx, output);

  assert.equal(decision.handoffStrategy, "deterministic_fallback");
  assert.equal(decision.source, "deterministic_fallback");
  assert.equal(decision.confidence < 0.2, true);
  assert.equal(decision.reasoningTrace[0]?.fallbackRefs.includes("agentturnruntime:missing"), true);
  assert.equal(output.terminalStatus, "stopped");
  assert.notEqual(output.directionHandoffPackage.directionHandoff.status, "approved");
  assert.equal(output.directionHandoffPackage.validation.passed, false);
  assert.equal(guarded.status, "accepted");
});

test("HandoffStewardAgent invalid model output falls back without approving handoff", async () => {
  const agent = new HandoffStewardAgent();
  const channel = new HandoffNarrativeTestChannel({
    ...validHandoffNarrativeOutput(),
    optionNarratives: [],
  });
  const ctx = createHandoffStewardContext({
    agentTurnRuntime: new AgentTurnRuntime({ intelligenceChannel: channel }),
  });

  const decision = await agent.reason(ctx, agent.observe(ctx));
  const output = agent.act(ctx, decision);

  assert.equal(channel.requests.length, 1);
  assert.equal(decision.source, "deterministic_fallback");
  assert.equal(
    decision.reasoningTrace[0]?.fallbackRefs.some((ref) =>
      ref.startsWith("parser:handoff_narrative:approved_without_option_narrative")
    ),
    true,
  );
  assert.equal(output.terminalStatus, "stopped");
  assert.notEqual(output.directionHandoffPackage.directionHandoff.status, "approved");
});

test("HandoffStewardAgent act only consumes reason material and does not call the model again", async () => {
  const agent = new HandoffStewardAgent();
  const channel = new HandoffNarrativeTestChannel(validHandoffNarrativeOutput());
  const ctx = createHandoffStewardContext({
    agentTurnRuntime: new AgentTurnRuntime({ intelligenceChannel: channel }),
  });
  const decision = await agent.reason(ctx, agent.observe(ctx));

  agent.act(ctx, decision);
  agent.act(ctx, decision);

  assert.equal(channel.requests.length, 1);
});

test("HandoffStewardAgent reasoning trace preserves provider summary fragments", async () => {
  const agent = new HandoffStewardAgent();
  const ctx = createHandoffStewardContext({
    agentTurnRuntime: new AgentTurnRuntime({
      intelligenceChannel: new HandoffNarrativeTestChannel({
        ...validHandoffNarrativeOutput(),
        decisionSummary:
          "chain-of-thought: hidden draft. Raw goal: Build a governed research agent. raw provider response: sk-handoff-secret",
        uncertainty: "system: internal prompt details should not be stored.",
      }),
    }),
  });

  const decision = await agent.reason(ctx, agent.observe(ctx));
  const traceJson = JSON.stringify(decision.reasoningTrace);

  assert.equal(decision.source, "ai");
  assert.equal(traceJson.includes("chain-of-thought"), true);
  assert.equal(traceJson.includes("Raw goal:"), true);
  assert.equal(traceJson.includes("raw provider response"), true);
  assert.equal(traceJson.includes("sk-handoff-secret"), true);
  assert.equal(traceJson.includes("[redacted-reasoning-detail]"), false);
});

function createHandoffStewardContext(input: {
  readonly constraints?: readonly Constraint[];
  readonly agentTurnRuntime?: AgentTurnRuntime;
} = {}): AgentRunContext<HandoffStewardWorkspace, HandoffStewardCapabilities> {
  const fixture = createApprovedHandoffFixture(input.constraints ?? []);
  return {
    workspace: createWorkspaceProjectionView({
      traceId: "trace-handoff-test",
      goalId: fixture.goalId,
      rawGoal: fixture.rawGoal,
      goalIntentProfile: fixture.goalIntentProfile,
      convergenceReport: fixture.convergenceReport,
      candidatePool: fixture.candidatePool,
      constraints: [...(input.constraints ?? [])],
    }),
    mailbox: new InMemoryMailbox(),
    capabilities: {
      agentTurnRuntime: input.agentTurnRuntime,
      directionHandoffPackageStore: new InMemoryDirectionHandoffPackageStore(),
    },
  };
}

function createApprovedHandoffFixture(constraints: readonly Constraint[]): {
  readonly goalId: string;
  readonly rawGoal: string;
  readonly goalIntentProfile: ReturnType<typeof createGoalIntentProfileForMinimalUnderground>;
  readonly candidatePool: CandidatePool;
  readonly convergenceReport: UndergroundConvergenceReport;
} {
  const goalId = "goal-handoff-test";
  const rawGoal = "Build a governed research agent with reviewable evidence.";
  const goalIntentProfile = createGoalIntentProfileForMinimalUnderground({ goalId, rawGoal, constraints });
  const plan = startRootletClusters(createMinimalUndergroundExplorationPlan(goalId, goalIntentProfile));
  const cluster = plan.rootletClusters.find((candidate) => candidate.kind === "option") ?? plan.rootletClusters[0]!;
  const rootletOutput: RootletOutput = {
    outputId: "rootlet-output-handoff-option",
    invocationId: "invocation-handoff-option",
    clusterId: cluster.clusterId,
    kind: "option",
    producedByAgentId: "rootlet-explorer-option",
    summary: "Governed research agent option with reviewable evidence and handoff validation.",
    sourceRefs: ["model.requested", "model.completed"],
    evidenceRefs: ["rootlet-output-handoff-option"],
    soilAssetFitRefs: [],
    constraintRefs: [],
    riskRefs: [],
    status: "produced",
    source: "ai",
  };
  const candidate: ExplorationCandidateRef = {
    id: "candidate-handoff-option",
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
  const initialPool = createCandidatePool({
    poolId: "candidate-pool-handoff-test",
    goalId,
    rootletOutputs: [rootletOutput],
    agentInvocations: [invocation],
    candidates: [candidate],
    updatedAt: "2026-05-06T00:00:00.000Z",
  });
  const comparison = compareCandidatesForGoal({
    goalProfile: goalIntentProfile,
    candidates: initialPool.candidates,
    rootletOutputs: [rootletOutput],
    createdAt: "2026-05-06T00:00:00.000Z",
  });
  const candidatePool = applyCandidateConvergenceDecisions(
    initialPool,
    comparison.decisions,
    "2026-05-06T00:00:00.000Z",
  );
  const convergenceReport = createUndergroundConvergenceReport({
    reviewId: "convergence-review-handoff-test",
    reviewedByAgentIds: ["underground-convergence-judge-loop"],
    leadAgentId: "underground-convergence-judge-loop",
    candidatePool,
    decisions: comparison.decisions,
    candidateComparisons: comparison.comparisons,
    provenanceRefs: ["convergence-judgment-test"],
    budget: {
      ...plan.budget,
      exhausted: false,
    },
    summary: "Convergence Judge approved the governed research agent candidate for handoff.",
    source: "ai",
    confidence: 0.82,
    reasoningTrace: [],
    createdAt: "2026-05-06T00:00:00.000Z",
  });
  return { goalId, rawGoal, goalIntentProfile, candidatePool, convergenceReport };
}

function validHandoffNarrativeOutput(): Record<string, unknown> {
  return {
    status: "approved",
    clarifiedGoal: "Build an evidence-led governed research agent for Aboveground planning.",
    optionNarratives: [
      {
        candidateId: "candidate-handoff-option",
        directionSummary:
          "Handoff Steward AI narrative: carry the governed research agent direction forward with reviewable evidence, source candidate lineage, and package validation.",
        whyPreferred: "It is the accepted option candidate and has evidence refs.",
        whyNot: [],
        doNotChooseWhen: ["When package validation fails or hard constraints are weakened."],
        evidenceRefs: ["handoff-narrative:candidate-handoff-option"],
      },
    ],
    nonGoals: ["Do not let Aboveground bypass package validation."],
    assumptions: ["Convergence Judge already accepted the source candidate."],
    missingInformation: [],
    risks: ["Aboveground must preserve source refs."],
    evidenceBoundary: "Only source candidate refs, convergence refs, model refs and package validation are evidence.",
    growthEntry: {
      allowedRuntimeShapes: ["single_agent", "sub_agent_tree"],
      suggestedFirstWorkflowNodes: ["confirm_direction_handoff", "derive_execution_plan", "preserve_evidence_refs"],
      escalationRules: ["Stop if package validation fails."],
    },
    decisionSummary: "Handoff Steward organized approved handoff material from convergence refs.",
    uncertainty: "This is a fixture summary, not private reasoning trace.",
    confidence: 0.86,
  };
}

class HandoffNarrativeTestChannel implements IntelligenceChannel {
  readonly requests: ModelRequest[] = [];

  constructor(private readonly output: unknown) {}

  async request(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    return {
      responseId: `model-response-handoff-${this.requests.length}`,
      requestId: request.requestId,
      providerId: "handoff-narrative-test-provider",
      providerKind: "fake",
      protocolKind: "openai_compatible_chat_completions",
      model: "handoff-narrative-test-model",
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
