import assert from "node:assert/strict";
import test from "node:test";
import type { ModelProvider, ModelRequest, ModelResponse } from "../domain/intelligence/index.js";
import type { RootletClusterKind } from "../domain/underground/index.js";
import { nowIso } from "../kernel/id.js";
import { NativeIntelligenceChannel } from "../kernel/intelligence/channel.js";
import { createFailedModelResponse } from "../kernel/intelligence/failures.js";
import { pendingModelOutputValidation } from "../kernel/intelligence/validation.js";
import { ToolCenter } from "./tool-center/tool-center.js";
import { createUndergroundDemoSummary } from "./underground-demo-summary.js";
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
  const publicEvents = result.runtime.eventLog.list();
  const rootletStartedEvents = publicEvents.filter((entry) => entry.type === "rootlet_cluster.started");
  const candidatePoolEvents = publicEvents.filter((entry) => entry.type === "candidate_pool.updated");
  const autonomyEvents = publicEvents.filter((entry) => entry.type === "autonomy_review.completed");
  const cycleKeys = rootletStartedEvents.map((entry) => {
    const payload = entry.message.payload as { explorationCycleId?: string };
    return `${entry.type}:${payload.explorationCycleId}`;
  });

  assert.equal(result.terminalStatus, "approved_package_created");
  assert.equal(rootletStartedEvents.length, 2);
  assert.equal(candidatePoolEvents.length, 2);
  assert.equal(autonomyEvents.length, 2);
  assert.equal(new Set(cycleKeys).size, 2);
  assert.deepEqual(
    result.undergroundReport.autonomy?.decisions.map((decision) => decision.action),
    ["continue_exploration", "request_convergence"]
  );
  assert.equal(
    result.eventTypes.indexOf("convergence_review.requested") >
      result.eventTypes.lastIndexOf("autonomy_review.completed"),
    true
  );
  assert.equal(
    result.eventTypes.indexOf("convergence_review.completed") >
      result.eventTypes.indexOf("convergence_review.requested"),
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
  assert.equal(toolCenter.getCallCount(), 1);
  assert.equal(result.eventTypes.includes("tool.requested"), true);
  assert.equal(result.eventTypes.includes("tool.completed"), true);
  assert.equal(result.undergroundReport.autonomy?.latestDecision?.action, "request_convergence");
  assert.equal(
    result.undergroundReport.autonomy?.latestDecision?.sourceRefs.includes("tool-call:tool-call-autonomy-search"),
    true
  );
  assert.equal(
    result.undergroundReport.autonomy?.latestDecision?.sourceRefs.includes("research:autonomy-search"),
    true
  );
  assert.equal(
    createUndergroundDemoSummary(result).underground.autonomy.sourceRefs.includes("tool-call:tool-call-autonomy-search"),
    true
  );
  assert.equal(
    result.directionHandoff?.sourceCandidateRefs.every((candidate) =>
      result.undergroundReport.convergenceReport.handoffCandidateRefs.includes(candidate.id)
    ),
    true
  );
});

test("autonomy-required run without AgentTurnRuntime stops with auditable disabled reason", () => {
  const result = runUndergroundDirectionSession("Build a small deterministic helper.", {
    requireAutonomy: true,
  });

  assert.equal(result.terminalStatus, "stopped");
  assert.equal(result.runtime.eventLog.types().some((type) => type.startsWith("model.")), false);
  assert.equal(result.undergroundReport.autonomy?.latestDecision?.status, "failed");
  assert.equal(result.undergroundReport.autonomy?.latestDecision?.stopReason, "ai_required_for_autonomy");
  assert.equal(result.undergroundReport.convergenceReport.stopReason, "ai_required_for_autonomy");
  assert.equal(result.loadedDirectionHandoffPackage.validation.passed, false);
});

test("autonomy rejects invalid actions, rootlet kinds, candidate refs, and redacts terminal text", async () => {
  const cases: readonly {
    readonly name: string;
    readonly autonomyOutput: unknown;
    readonly expectedDecisionStatus: "completed" | "failed";
    readonly expectedStopReason: string;
  }[] = [
    {
      name: "invalid action",
      autonomyOutput: {
        action: "approve_handoff",
        completionAssessment: "Bypass the convergence judge.",
        informationGaps: [],
        spawnRequests: [],
        rationale: "This must be rejected.",
      },
      expectedDecisionStatus: "failed",
      expectedStopReason: "autonomy_decision_failed",
    },
    {
      name: "invalid rootlet kind",
      autonomyOutput: {
        action: "continue_exploration",
        completionAssessment: "Needs a made-up rootlet.",
        informationGaps: ["unknown runtime data"],
        spawnRequests: [
          {
            rootletKind: "database",
            objective: "Create a rootlet kind that does not exist.",
            informationNeeds: ["illegal kind"],
            sourceHints: [],
            expectedEvidence: [],
            rationale: "This must be rejected.",
          },
        ],
        rationale: "Invalid rootlet kind should not spawn.",
      },
      expectedDecisionStatus: "failed",
      expectedStopReason: "autonomy_decision_failed",
    },
    {
      name: "unknown candidate ref",
      autonomyOutput: {
        action: "request_convergence",
        completionAssessment: "References a candidate outside the pool.",
        informationGaps: [],
        spawnRequests: [],
        rationale: "Unknown candidates cannot guide convergence.",
        sourceRefs: ["candidate-does-not-exist"],
      },
      expectedDecisionStatus: "failed",
      expectedStopReason: "autonomy_decision_failed",
    },
    {
      name: "sensitive stopped rationale",
      autonomyOutput: {
        action: "stop",
        completionAssessment: `Stop because secret sk-autonomy-secret-token ${"x".repeat(900)}`,
        informationGaps: [`token=autonomy-token-value ${"y".repeat(900)}`],
        spawnRequests: [],
        rationale: `Bearer autonomy-bearer-token ${"z".repeat(900)}`,
        sourceRefs: [],
      },
      expectedDecisionStatus: "completed",
      expectedStopReason: "autonomy_stopped",
    },
  ];

  for (const item of cases) {
    const result = await runUndergroundDirectionSessionWithIntelligence(`Autonomy invalid case: ${item.name}`, {
      createIntelligenceChannel: (runtime) =>
        new NativeIntelligenceChannel({
          provider: new AutonomyLoopProvider({ autonomyOutputs: [item.autonomyOutput] }),
          bus: runtime.bus,
        }),
    });
    const projection = JSON.stringify({
      eventLog: result.runtime.eventLog.list(),
      observation: result.observationSnapshot,
      report: result.undergroundReport,
    });

    assert.equal(result.terminalStatus, "stopped", item.name);
    assert.equal(result.undergroundReport.autonomy?.latestDecision?.status, item.expectedDecisionStatus, item.name);
    assert.equal(result.undergroundReport.convergenceReport.stopReason, item.expectedStopReason, item.name);
    assert.equal(result.loadedDirectionHandoffPackage.validation.passed, false, item.name);
    assert.equal(projection.includes("sk-autonomy-secret-token"), false, item.name);
    assert.equal(projection.includes("autonomy-token-value"), false, item.name);
    assert.equal(projection.includes("autonomy-bearer-token"), false, item.name);
  }
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
  if (request.outputContract.contractId === "convergence-advisory") {
    return {
      candidateAnalyses: [],
      conflictsNeedingUserInput: [],
      constraintViolations: [],
      overallDirectionSummary: "Autonomy loop test advisory remains bounded by package validation.",
    };
  }
  return {
    candidates: [candidateForKind(rootletKindFromContractId(request.outputContract.contractId))],
  };
}

function requestConvergenceOutput(): Record<string, unknown> {
  return {
    action: "request_convergence",
    completionAssessment: "Candidate material is sufficient for convergence.",
    informationGaps: [],
    spawnRequests: [],
    rationale: "Convergence Judge must decide before Handoff Steward packages.",
    sourceRefs: [],
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
