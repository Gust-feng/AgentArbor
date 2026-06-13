import assert from "node:assert/strict";
import test from "node:test";
import type { ModelProvider, ModelRequest, ModelResponse } from "../domain/intelligence/index.js";
import type { RootletClusterKind } from "../domain/underground/index.js";
import { nowIso } from "../kernel/id.js";
import { NativeIntelligenceChannel } from "../kernel/intelligence/channel.js";
import { createFailedModelResponse } from "../kernel/intelligence/failures.js";
import { pendingModelOutputValidation } from "../kernel/intelligence/validation.js";
import { ToolCenter } from "./tool-center/tool-center.js";
import {
  runUndergroundDirectionSession,
  runUndergroundDirectionSessionWithIntelligence,
} from "./underground-direction-session.js";

test("autonomy continue_exploration starts a second cycle before convergence request", async () => {
  const result = await runUndergroundDirectionSessionWithIntelligence("Build a helper but gather more evidence first.", {
    createIntelligenceChannel: (runtime) =>
      new NativeIntelligenceChannel({
        provider: new AutonomyLoopProvider({
          autonomyOutputs: [continueExplorationOutput("evidence"), requestConvergenceOutput()],
        }),
        bus: runtime.bus,
      }),
  });

  assert.equal(result.terminalStatus, "approved_package_created");
  assert.equal(result.undergroundReport.agentClusterRun, undefined);
  assert.equal(result.undergroundReport.autonomy?.enabled, true);
  assert.equal(result.undergroundReport.autonomy?.cycles.length, 2);
  assert.equal(result.undergroundReport.autonomy?.latestDecision?.action, "request_convergence");
  assert.equal(
    result.undergroundOrchestratorRun.agentLoopIds.filter(
      (id) => id === "underground-autonomy-reviewer"
    ).length >= 1,
    true
  );
  assert.equal(
    result.directionHandoff?.sourceCandidateRefs.every((candidate) =>
      result.undergroundReport.convergenceReport.handoffCandidateRefs.includes(candidate.id)
    ),
    true
  );
});

test("autonomy core can use search before requesting convergence through AgentTurnRuntime", async () => {
  const toolCenter = new ToolCenter();
  toolCenter.register({
    definition: {
      name: "search",
      description: "Test search tool for autonomy decisions.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
      },
    },
    async execute() {
      return {
        status: "completed",
        refs: [
          {
            refId: "research:autonomy-search",
            title: "Autonomy search evidence",
            snippet: "Search evidence stays as tool refs and cannot approve a handoff directly.",
          },
        ],
      };
    },
  });

  const result = await runUndergroundDirectionSessionWithIntelligence("Build a helper with autonomy research.", {
    createToolCenter: () => toolCenter,
    createIntelligenceChannel: (runtime) =>
      new NativeIntelligenceChannel({
        provider: new AutonomyLoopProvider({
          autonomyOutputs: [requestConvergenceOutput()],
          toolAutonomyBeforeDecision: true,
        }),
        bus: runtime.bus,
      }),
  });

  assert.equal(result.terminalStatus, "approved_package_created");
  assert.equal(result.eventTypes.includes("tool.requested"), true);
  assert.equal(result.eventTypes.includes("tool.completed"), true);
  // Tool call refs are tracked through reasonWithAgentTurn envelope
  assert.equal(result.undergroundReport.autonomy?.latestDecision?.sourceRefs.some((ref: string) => ref.startsWith("tool-call:")), true);
  assert.equal(result.undergroundReport.agentClusterRun, undefined);
  assert.equal(
    result.directionHandoff?.sourceCandidateRefs.every((candidate) =>
      result.undergroundReport.convergenceReport.handoffCandidateRefs.includes(candidate.id)
    ),
    true
  );
});

test("autonomy-required run without AgentTurnRuntime stops without approval", async () => {
  const result = await runUndergroundDirectionSession("Build a small deterministic helper.", {
    requireAutonomy: true,
  });

  assert.equal(result.terminalStatus, "stopped");
  assert.equal(result.runtime.eventLog.types().some((type) => type.startsWith("model.")), false);
  assert.equal(result.undergroundReport.autonomy?.latestDecision?.status, "failed");
  assert.equal(result.undergroundReport.convergenceReport.stopReason, "ai_required_for_autonomy");
  assert.equal(result.undergroundReport.agentClusterRun, undefined);
  assert.equal(result.loadedDirectionHandoffPackage.validation.passed, false);
});

test("autonomy cognitive manager preserves sensitive-looking text in underground report and observation", async () => {
  const result = await runUndergroundDirectionSessionWithIntelligence("Autonomy sensitive case: preservation test", {
    createIntelligenceChannel: (runtime) =>
      new NativeIntelligenceChannel({
        provider: new AutonomyLoopProvider({
          autonomyOutputs: [
            {
              action: "stop",
              completionAssessment: `Stop because secret sk-autonomy-secret-token ${"x".repeat(900)}`,
              informationGaps: [`token=autonomy-token-value ${"y".repeat(900)}`],
              spawnRequests: [],
              rationale: `Bearer autonomy-bearer-token ${"z".repeat(900)}`,
              sourceRefs: [],
              decisionSummary: "Autonomy recommends convergence.",
              uncertainty: "Test fixture output.",
              confidence: 0.74,
            },
          ],
        }),
        bus: runtime.bus,
      }),
  });
  const projection = JSON.stringify({
    eventLog: result.runtime.eventLog.list(),
    observation: result.observationSnapshot,
    report: result.undergroundReport,
  });

  assert.equal(result.undergroundReport.autonomy?.latestDecision?.action, "stop");
  assert.equal(result.undergroundReport.agentClusterRun, undefined);
  assert.equal(projection.includes("sk-autonomy-secret-token"), true);
  assert.equal(projection.includes("autonomy-token-value"), true);
  assert.equal(projection.includes("autonomy-bearer-token"), true);
});

type AutonomyLoopProviderOptions = {
  readonly autonomyOutputs?: readonly unknown[];
  readonly failAutonomy?: boolean;
  readonly toolAutonomyBeforeDecision?: boolean;
};

class AutonomyLoopProvider implements ModelProvider {
  readonly providerId = "autonomy-loop-provider";
  readonly providerKind = "fake" as const;
  readonly protocolKind = "openai_compatible_chat_completions" as const;
  readonly model = "autonomy-loop-model";
  private autonomyCallCount = 0;

  constructor(private readonly options: AutonomyLoopProviderOptions = {}) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (this.options.failAutonomy && request.outputContract.contractId === "underground.autonomy_decision.v1") {
      return createFailedModelResponse({
        requestId: request.requestId,
        providerId: this.providerId,
        providerKind: this.providerKind,
        protocolKind: this.protocolKind,
        model: this.model,
        outputKind: request.outputContract.outputKind,
        failureKind: "provider_response",
        message: "Autonomy provider failed.",
      });
    }

    if (
      this.options.toolAutonomyBeforeDecision === true &&
      request.outputContract.contractId === "underground.autonomy_decision.v1" &&
      !request.sanitizedMessages.some((message) => message.role === "tool")
    ) {
      return {
        responseId: "model-response-autonomy-tool-call",
        requestId: request.requestId,
        providerId: this.providerId,
        providerKind: this.providerKind,
        protocolKind: this.protocolKind,
        model: this.model,
        status: "completed",
        outputKind: request.outputContract.outputKind,
        toolCalls: [
          {
            callId: "tool-call-autonomy-search",
            toolName: "search",
            input: { query: "autonomy decision evidence" },
          },
        ],
        finishReason: "tool_call",
        validation: pendingModelOutputValidation(),
        completedAt: nowIso(),
      };
    }

    return {
      responseId: "model-response-autonomy-loop",
      requestId: request.requestId,
      providerId: this.providerId,
      providerKind: this.providerKind,
      protocolKind: this.protocolKind,
      model: this.model,
      status: "completed",
      outputKind: request.outputContract.outputKind,
      structuredOutput:
        request.outputContract.contractId === "underground.autonomy_decision.v1"
          ? this.nextAutonomyOutput()
          : outputForRequest(request),
      finishReason: "stop",
      validation: pendingModelOutputValidation(),
      completedAt: nowIso(),
    };
  }

  private nextAutonomyOutput(): unknown {
    const output = this.options.autonomyOutputs?.[this.autonomyCallCount];
    this.autonomyCallCount += 1;
    return output ?? requestConvergenceOutput();
  }
}

function outputForRequest(request: ModelRequest): unknown {
  if (request.outputContract.contractId === "underground.convergence_judgment.v1") {
    return convergenceJudgmentOutput(request);
  }

  if (request.outputContract.contractId === "underground.handoff_narrative.v1") {
    return handoffNarrativeOutput(request);
  }

  if (request.outputContract.contractId === "convergence-advisory") {
    return {
      candidateAnalyses: [],
      conflictsNeedingUserInput: [],
      constraintViolations: [],
      overallDirectionSummary: "Autonomy loop test advisory remains bounded by package validation.",
    };
  }

  if (request.outputContract.contractId === "underground.candidate_aggregation.v1") {
    return {
      aggregationRationale: "Test candidate collector aggregated rootlet outputs.",
      deduplicationNotes: [],
      implicitRelations: [],
      decisionSummary: "Test candidate aggregation completed.",
      uncertainty: "Test fixture output.",
      confidence: 0.74,
    };
  }

  return {
    candidates: [candidateForKind(rootletKindFromContractId(request.outputContract.contractId))],
  };
}

function handoffNarrativeOutput(request: ModelRequest): Record<string, unknown> {
  const candidateIds = parseHandoffCandidateIds(request);
  return {
    status: candidateIds.length > 0 ? "approved" : "stopped",
    clarifiedGoal: "Autonomy loop handoff narrative packages the converged helper direction.",
    optionNarratives: candidateIds.map((candidateId) => ({
      candidateId,
      directionSummary: `Autonomy loop Handoff Steward narrative keeps ${candidateId} under package validation.`,
      whyPreferred: "Convergence Judge accepted or merged this candidate before handoff.",
      whyNot: [],
      doNotChooseWhen: ["When package validation fails."],
      evidenceRefs: [`handoff-narrative:${candidateId}`],
    })),
    nonGoals: ["Do not let autonomy approve handoff directly."],
    assumptions: ["Autonomy only requested convergence; Handoff Steward owns package narrative."],
    missingInformation: [],
    risks: ["Aboveground must preserve package validation boundaries."],
    evidenceBoundary: "Use convergence, model, source candidate and package validation refs only.",
    growthEntry: {
      allowedRuntimeShapes: ["single_agent", "sub_agent_tree"],
      suggestedFirstWorkflowNodes: ["confirm_direction_handoff", "derive_execution_plan"],
      escalationRules: ["Stop if package validation fails."],
    },
    decisionSummary: "Handoff Steward fixture organized autonomy loop handoff material.",
    uncertainty: "The fixture exposes only a safe summary.",
    confidence: candidateIds.length > 0 ? 0.8 : 0.2,
  };
}

function parseHandoffCandidateIds(request: ModelRequest): string[] {
  const content = request.sanitizedMessages.map((message) => message.content).join("\n");
  return [...content.matchAll(/candidateId=([^\s\n]+)/g)]
    .map((match) => match[1])
    .filter((candidateId): candidateId is string => candidateId !== undefined && candidateId.length > 0);
}

function convergenceJudgmentOutput(request: ModelRequest): Record<string, unknown> {
  const candidates = parseConvergenceCandidates(request);
  const firstOption = candidates.find((candidate) => candidate.kind === "option");
  return {
    candidateDecisions: candidates.map((candidate) => {
      const status =
        candidate.kind === "option"
          ? candidate.candidateId === firstOption?.candidateId ? "accepted" : "merged"
          : candidate.kind === "risk" || candidate.kind === "counterfactual"
            ? "rejected"
            : "merged";
      return {
        candidateId: candidate.candidateId,
        status,
        reason: `Autonomy loop Convergence Judge marked ${candidate.candidateId} as ${status}.`,
        evidenceRefs: [candidate.outputId],
        contentDifference: `Candidate ${candidate.candidateId} remains parent-converged material.`,
        whyPreferred: status === "accepted"
          ? "The option candidate is retained for handoff after autonomy requested convergence."
          : "The candidate is supporting or why-not material.",
        conflictWith: [],
      };
    }),
    recommendedOptionId: firstOption?.candidateId,
    nextAction: firstOption === undefined ? "stop" : "approve_handoff",
    conflictsNeedingUserInput: [],
    constraintViolations: [],
    overallDirectionSummary: "Autonomy loop Convergence Judge approved the option after autonomy requested convergence.",
    decisionSummary: "Convergence Judge used the new convergence_judgment contract in the autonomy fixture.",
    uncertainty: "The fixture exposes only a safe summary.",
    confidence: 0.81,
  };
}

function parseConvergenceCandidates(request: ModelRequest): {
  readonly kind: RootletClusterKind;
  readonly candidateId: string;
  readonly outputId: string;
}[] {
  const content = request.sanitizedMessages.map((message) => message.content).join("\n");
  return [...content.matchAll(/- \[(option|risk|asset_fit|evidence|constraint|counterfactual)\]\s+candidateId=([^\s]+)\s+outputId=([^\s\n]+)/g)]
    .map((match) => ({
      kind: rootletKindFromContractId(`underground.rootlet_candidate_advice.${match[1]}.v1`),
      candidateId: match[2] ?? "candidate-unknown",
      outputId: match[3] ?? "unknown",
    }));
}

function requestConvergenceOutput(): Record<string, unknown> {
  return {
    action: "request_convergence",
    completionAssessment: "Candidate material is sufficient for convergence.",
    informationGaps: [],
    spawnRequests: [],
    rationale: "Convergence Judge must decide before Handoff Steward packages.",
    sourceRefs: [],
    decisionSummary: "Autonomy recommends convergence.",
    uncertainty: "Test fixture output.",
    confidence: 0.74,
  };
}

function continueExplorationOutput(kind: RootletClusterKind): Record<string, unknown> {
  return {
    action: "continue_exploration",
    completionAssessment: "A second exploration cycle can fill one evidence gap.",
    informationGaps: ["More evidence is useful before convergence."],
    spawnRequests: [
      {
        rootletKind: kind,
        objective: `Explore additional ${kind} evidence before convergence.`,
        informationNeeds: [`Need ${kind} evidence.`],
        sourceHints: ["candidate-pool.updated"],
        expectedEvidence: [`A ${kind} rootlet output enters CandidatePool.`],
        rationale: "The request is runtime-only and maps to an existing rootlet kind.",
      },
    ],
    rationale: "Continue once, then ask Convergence Judge to review the expanded pool.",
    sourceRefs: [],
    decisionSummary: "Autonomy recommends convergence.",
    uncertainty: "Test fixture output.",
    confidence: 0.74,
  };
}

function rootletKindFromContractId(contractId: string): RootletClusterKind {
  const prefix = "underground.rootlet_candidate_advice.";
  const rawKind = contractId.startsWith(prefix) ? contractId.slice(prefix.length).split(".")[0] : "option";
  return isRootletClusterKind(rawKind) ? rawKind : "option";
}

function isRootletClusterKind(value: string | undefined): value is RootletClusterKind {
  return (
    value === "option" ||
    value === "risk" ||
    value === "asset_fit" ||
    value === "evidence" ||
    value === "constraint" ||
    value === "counterfactual"
  );
}

function candidateForKind(kind: RootletClusterKind): Record<string, unknown> {
  switch (kind) {
    case "risk":
      return {
        summary: "Autonomy loop risk candidate for the helper goal.",
        impactScope: "runtime boundary",
        severity: "low",
        mitigation: "Keep CandidatePool and Convergence Judge in charge.",
      };
    case "asset_fit":
      return {
        summary: "Autonomy loop asset fit candidate for the helper goal.",
        assetRefs: ["soil:minimal-constraints"],
        fitConditions: ["Use refs only."],
        doNotApplyWhen: ["A ref would be copied as Soil body content."],
      };
    case "evidence":
      return {
        summary: "Autonomy loop evidence candidate for the helper goal.",
        evidenceType: "verification",
        confidence: "medium",
      };
    case "constraint":
      return {
        summary: "Autonomy loop constraint candidate for the helper goal.",
        constraintLevel: "hard",
        enforcementGate: "direction_handoff",
      };
    case "counterfactual":
      return {
        summary: "Autonomy loop counterfactual candidate for the helper goal.",
        alternativeDirection: "Stop before handoff.",
        whyNotChosen: "It would skip convergence.",
      };
    case "option":
      return {
        summary: "Autonomy loop option candidate for the helper goal.",
        tradeoffs: ["keeps autonomy as routing only"],
        applicability: "Use only after convergence.",
      };
  }
}
