import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import type { ModelProvider, ModelRequest, ModelResponse } from "../domain/intelligence/index.js";
import { nowIso } from "../kernel/id.js";
import { NativeIntelligenceChannel } from "../kernel/intelligence/channel.js";
import { pendingModelOutputValidation } from "../kernel/intelligence/validation.js";
import { createUndergroundAiRuntimeConfig } from "./intelligence-channel-factory.js";
import { runUndergroundDirectionSession } from "./underground-direction-session.js";
import { runUndergroundDirectionSessionWithIntelligence } from "./underground-direction-session.js";
import { recoverUndergroundDirectionSession } from "./underground-direction-recovery.js";
import { createUndergroundDemoSummary } from "./underground-demo-summary.js";

test("createUndergroundDemoSummary reports an approved underground package", async () => {
  const { result, aiInput } = await runFakeUndergroundDirectionSession("Build a small deterministic helper.");
  const summary = createUndergroundDemoSummary(result, undefined, aiInput);

  assert.equal(summary.terminalStatus, "approved_package_created");
  assert.equal(summary.directionPackage.status, "approved");
  assert.equal(summary.directionPackage.version, 1);
  assert.deepEqual(summary.versions, [1]);
  assert.equal(summary.lineage.revisionReason, "initial");
  assert.equal(summary.recoveredPackage, undefined);
  assert.equal(summary.writtenPackagePath, undefined);
  assert.equal(summary.directionPackage.validation.passed, true);
  assert.equal(summary.ai.enabled, true);
  assert.equal(summary.ai.status, "completed");
  assert.equal(summary.ai.eventCounts.requested > 0, true);
  assert.equal(summary.ai.modelCallRefs.length > 0, true);
  assert.deepEqual(summary.underground.rootletKinds, ["option"]);
  assert.equal(summary.underground.candidateCounts.accepted, 1);
  assert.equal(summary.underground.candidateCounts.merged, 1);
  assert.equal(summary.underground.convergence.outcome, "approved");
  assert.equal(summary.userEscalation, undefined);
  assert.equal(summary.observationSnapshot.layerStatuses.aboveground, "not_started");
  assert.equal(summary.eventLog.includes("direction_handoff.completed"), true);
  assert.equal(summary.eventLog.includes("growth_plan.completed"), false);
  assert.equal(result.undergroundReport.agentClusterRun, undefined);
});

test("createUndergroundDemoSummary reports auto-answer recovery as approved v2", async () => {
  const { result, aiInput } = await runFakeUndergroundDirectionSession(
    "Build the helper, but permission boundary and hard constraint are unknown and must be confirmed."
  );
  const recovery = recoverUndergroundDirectionSession(result);
  const summary = createUndergroundDemoSummary(result, recovery, aiInput);

  assert.equal(summary.terminalStatus, "approved_package_created");
  assert.equal(summary.directionPackage.status, "approved");
  assert.equal(summary.directionPackage.version, 2);
  assert.equal(summary.recoveredPackage?.version, 2);
  assert.deepEqual(summary.versions, [1, 2]);
  assert.equal(summary.lineage.previous?.version, 1);
  assert.equal(summary.lineage.revisionReason, "user_clarification_answered");
  assert.equal(summary.underground.convergence.outcome, "approved");
  assert.equal(summary.underground.convergence.userEscalationRequired, false);
  assert.equal(summary.eventLog.includes("user_approval.received"), true);
  assert.equal(summary.eventLog.includes("direction_handoff.completed"), true);
  assert.equal(summary.observationSnapshot.layerStatuses.aboveground, "not_started");
});

test("createUndergroundDemoSummary reports model events and candidate-layer refs without model content", async () => {
  const { runUndergroundDirectionSessionWithIntelligence } = await import("./underground-direction-session.js");

  const result = await runUndergroundDirectionSessionWithIntelligence("Build a small deterministic helper.", {
    createIntelligenceChannel: (runtime) =>
      new NativeIntelligenceChannel({
        provider: new GoalSpecificCandidateProvider(),
        bus: runtime.bus,
      }),
  });
  const summary = createUndergroundDemoSummary(result, undefined, {
    enabled: true,
    mode: "fake",
    providerId: "goal-specific-candidate-provider",
    providerKind: "fake",
    protocolKind: "openai_compatible_chat_completions",
    model: "goal-specific-candidate-model",
  });

  assert.equal(summary.ai.enabled, true);
  assert.equal(summary.ai.mode, "fake");
  assert.equal(summary.ai.status, "completed");
  assert.equal(summary.ai.providerKind, "fake");
  assert.equal(summary.ai.protocolKind, "openai_compatible_chat_completions");
  assert.equal(summary.ai.model, "goal-specific-candidate-model");
  assert.equal(result.undergroundReport.agentClusterRun, undefined);
  assert.equal(summary.ai.eventCounts.requested > 0, true);
  assert.equal(summary.ai.eventCounts.completed > 0, true);
  assert.equal(JSON.stringify(summary).includes("GoalSpecific candidate raw text"), false);
});

test("createUndergroundDemoSummary reports deterministic fallback when AI returns empty candidates", async () => {
  const result = await runUndergroundDirectionSessionWithIntelligence("Build a small deterministic helper.", {
    createIntelligenceChannel: (runtime) =>
      new NativeIntelligenceChannel({
        provider: new EmptyCandidateProvider(),
        bus: runtime.bus,
      }),
  });
  const summary = createUndergroundDemoSummary(result, undefined, {
    enabled: true,
    mode: "fake",
    providerId: "empty-candidate-provider",
    providerKind: "fake",
    protocolKind: "openai_compatible_chat_completions",
    model: "empty-candidate-model",
  });

  assert.equal(result.undergroundReport.agentClusterRun, undefined);
  assert.equal(summary.ai.status, "completed");
  assert.equal(summary.ai.aiCandidateCount, 0);
  assert.equal(
    result.undergroundReport.rootletOutputs.some((output) => output.source === "deterministic_fallback"),
    true
  );
  assert.equal(JSON.stringify(summary).includes("empty provider raw text"), false);
});

test("createUndergroundDemoSummary exposes awaiting-user escalation without entering Aboveground", async () => {
  const { result, aiInput } = await runFakeUndergroundDirectionSession(
    "Build the helper, but permission boundary and hard constraint are unknown and must be confirmed."
  );
  const summary = createUndergroundDemoSummary(result, undefined, aiInput);

  assert.equal(summary.terminalStatus, "awaiting_user");
  assert.equal(summary.directionPackage.status, "awaiting_user");
  assert.equal(summary.directionPackage.validation.passed, false);
  assert.equal(summary.underground.convergence.outcome, "awaiting_user");
  assert.equal(summary.underground.convergence.userEscalationRequired, true);
  assert.notEqual(summary.userEscalation, undefined);
  assert.equal((summary.userEscalation?.questionCount ?? 0) > 0, true);
  assert.equal(summary.eventLog.includes("direction_handoff.completed"), true);
  assert.equal(summary.eventLog.includes("growth_plan.completed"), false);
});

test("createUndergroundDemoSummary reports stopped runs without fabricating approval", async () => {
  const result = await runUndergroundDirectionSession("Stop because no viable candidate should be produced.");
  const summary = createUndergroundDemoSummary(result);

  assert.equal(summary.terminalStatus, "stopped");
  assert.equal(summary.directionPackage.status, "draft");
  assert.equal(summary.directionPackage.validation.passed, false);
  assert.equal(summary.underground.convergence.outcome, "stopped");
  assert.equal(summary.underground.convergence.stopReason, "ai_required_for_autonomy");
  assert.equal(summary.userEscalation, undefined);
  assert.equal(summary.eventLog.includes("direction_handoff.completed"), false);
});

test("underground demo summary does not write repo-root .agentarbor assets", async () => {
  const repoRootAgentArbor = resolve(process.cwd(), ".agentarbor");
  const before = snapshotTree(repoRootAgentArbor);

  const { result } = await runFakeUndergroundDirectionSession("Build a small deterministic helper.");
  createUndergroundDemoSummary(result);

  assert.deepEqual(snapshotTree(repoRootAgentArbor), before);
});

function snapshotTree(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }

  const entries: string[] = [];
  const walk = (current: string, relativePrefix: string): void => {
    for (const name of readdirSync(current).sort()) {
      const absolutePath = join(current, name);
      const relativePath = relativePrefix === "" ? name : `${relativePrefix}/${name}`;
      const stats = statSync(absolutePath);
      entries.push(`${relativePath}:${stats.isDirectory() ? "dir" : "file"}:${stats.size}:${stats.mtimeMs}`);
      if (stats.isDirectory()) {
        walk(absolutePath, relativePath);
      }
    }
  };

  walk(root, "");
  return entries;
}

async function runFakeUndergroundDirectionSession(goal: string) {
  const aiConfig = createUndergroundAiRuntimeConfig({ mode: "fake" });
  if (!aiConfig.enabled) {
    throw new Error("Expected fake AI runtime config to be enabled.");
  }
  return {
    result: await runUndergroundDirectionSessionWithIntelligence(goal, {
      createIntelligenceChannel: aiConfig.createIntelligenceChannel,
      createToolCenter: aiConfig.createToolCenter,
    }),
    aiInput: aiConfig.summaryInput,
  };
}

class GoalSpecificCandidateProvider implements ModelProvider {
  readonly providerId = "goal-specific-candidate-provider";
  readonly providerKind = "fake" as const;
  readonly protocolKind = "openai_compatible_chat_completions" as const;
  readonly model = "goal-specific-candidate-model";

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const kind = rootletKindFromContractId(request.outputContract.contractId);
    const structuredOutput =
      request.outputContract.contractId === "underground.intent_profile.v1"
        ? createLegalIntentProfileOutput(request)
        : request.outputContract.contractId === "underground.growth_governor.v1"
          ? createLegalGrowthGovernorOutput(request)
      : request.outputContract.contractId === "underground.convergence_judgment.v1"
        ? createLegalConvergenceJudgmentOutput(request)
      : request.outputContract.contractId === "underground.handoff_narrative.v1"
        ? createLegalHandoffNarrativeOutput(request)
      : request.outputContract.contractId === "convergence-advisory"
        ? {
            candidateAnalyses: [],
            conflictsNeedingUserInput: [],
            constraintViolations: [],
            overallDirectionSummary: "GoalSpecific candidate provider defers to convergence judge.",
          }
        : request.outputContract.contractId === "underground.autonomy_decision.v1"
          ? {
              action: "request_convergence",
              completionAssessment: "GoalSpecific candidate provider allows convergence.",
              informationGaps: [],
              spawnRequests: [],
              rationale: "Convergence Judge still owns the final report.",
              sourceRefs: [],
              decisionSummary: "GoalSpecific autonomy recommends convergence.",
              uncertainty: "Deterministic test output.",
              confidence: 0.74,
            }
        : request.outputContract.contractId === "underground.candidate_aggregation.v1"
          ? {
              aggregationRationale: "GoalSpecific candidate collector aggregated rootlet outputs.",
              deduplicationNotes: [],
              implicitRelations: [],
              decisionSummary: "GoalSpecific candidate aggregation completed.",
              uncertainty: "Deterministic test output.",
              confidence: 0.74,
            }
        : {
            candidates: [
              {
                summary: `TypeScript helper module with deterministic ${kind} logic and type-safe utility functions`,
                evidenceRefs: [`model-call:${request.requestId}`],
                sourceRefs: [`model-call:${request.requestId}`],
              },
              {
                summary: `Deterministic ${kind} approach using pure functions with no side effects`,
                evidenceRefs: [`model-call:${request.requestId}`],
                sourceRefs: [`model-call:${request.requestId}`],
              },
            ],
          };
    return {
      responseId: "model-response-goal-specific-candidates",
      requestId: request.requestId,
      providerId: this.providerId,
      providerKind: this.providerKind,
      protocolKind: this.protocolKind,
      model: this.model,
      status: "completed",
      outputKind: request.outputContract.outputKind,
      structuredOutput,
      textOutput: "GoalSpecific candidate raw text",
      finishReason: "stop",
      validation: pendingModelOutputValidation(),
      completedAt: nowIso(),
    };
  }
}

function rootletKindFromContractId(contractId: string): string {
  const match = contractId.match(/rootlet_candidate_advice\.([^.]+)\.v\d+/);
  return match?.[1] ?? "option";
}

class EmptyCandidateProvider implements ModelProvider {
  readonly providerId = "empty-candidate-provider";
  readonly providerKind = "fake" as const;
  readonly protocolKind = "openai_compatible_chat_completions" as const;
  readonly model = "empty-candidate-model";

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const structuredOutput =
      request.outputContract.contractId === "underground.intent_profile.v1"
        ? createLegalIntentProfileOutput(request)
        : request.outputContract.contractId === "underground.growth_governor.v1"
          ? createLegalGrowthGovernorOutput(request)
      : request.outputContract.contractId === "underground.convergence_judgment.v1"
        ? createLegalConvergenceJudgmentOutput(request)
      : request.outputContract.contractId === "underground.handoff_narrative.v1"
        ? createLegalHandoffNarrativeOutput(request)
      : request.outputContract.contractId === "convergence-advisory"
        ? {
            candidateAnalyses: [],
            conflictsNeedingUserInput: [],
            constraintViolations: [],
            overallDirectionSummary: "Empty candidate provider leaves convergence advisory neutral.",
          }
        : request.outputContract.contractId === "underground.autonomy_decision.v1"
          ? {
              action: "request_convergence",
              completionAssessment: "Empty candidate provider allows convergence after deterministic fallback.",
              informationGaps: [],
              spawnRequests: [],
              rationale: "Convergence Judge still owns the final report.",
              sourceRefs: [],
              decisionSummary: "Empty autonomy recommends convergence.",
              uncertainty: "Deterministic test output.",
              confidence: 0.74,
            }
        : request.outputContract.contractId === "underground.candidate_aggregation.v1"
          ? {
              aggregationRationale: "Empty candidate collector aggregated zero rootlet outputs.",
              deduplicationNotes: [],
              implicitRelations: [],
              decisionSummary: "Empty candidate aggregation completed.",
              uncertainty: "Deterministic test output.",
              confidence: 0.74,
            }
        : { candidates: [] };
    return {
      responseId: "model-response-empty-candidates",
      requestId: request.requestId,
      providerId: this.providerId,
      providerKind: this.providerKind,
      protocolKind: this.protocolKind,
      model: this.model,
      status: "completed",
      outputKind: request.outputContract.outputKind,
      structuredOutput,
      textOutput: "empty provider raw text",
      finishReason: "stop",
      validation: pendingModelOutputValidation(),
      completedAt: nowIso(),
    };
  }
}

function createLegalIntentProfileOutput(request: ModelRequest): Record<string, unknown> {
  const goal = extractGoalAnchor(request);
  return {
    goalStatement: goal,
    keyConcepts: ["helper", "runtime"],
    domainConcepts: ["helper", "runtime"],
    nonGoals: [],
    acceptanceCriteria: ["The helper direction remains candidate-layer material before handoff."],
    assumptions: ["The test provider only emits safe structured fixture data."],
    riskHints: [],
    constraintHints: [],
    unknowns: [],
    decisionSummary: `Intent Core shaped ${goal} as a test profile.`,
    uncertainty: "No raw provider response or private reasoning trace is exposed.",
    confidence: 0.78,
  };
}

function createLegalGrowthGovernorOutput(request: ModelRequest): Record<string, unknown> {
  const rootletKinds = availableRootletKindsFromGrowthRequest(request);
  return {
    rootletKinds,
    budget: {
      maxRootletClusters: rootletKinds.length,
      maxCandidateOutputs: rootletKinds.length,
    },
    dispatchDecision: "Start selected rootlet clusters as lower-layer material for parent convergence.",
    decisionSummary: "Growth Governor selected bounded rootlet clusters.",
    uncertainty: "This fixture cannot approve handoff.",
    confidence: 0.76,
  };
}

function createLegalHandoffNarrativeOutput(request: ModelRequest): Record<string, unknown> {
  const candidateIds = candidateIdsFromHandoffRequest(request);
  return {
    status: candidateIds.length > 0 ? "approved" : "stopped",
    clarifiedGoal: "Handoff Steward packages the helper runtime direction with evidence refs.",
    optionNarratives: candidateIds.map((candidateId) => ({
      candidateId,
      directionSummary: `Handoff narrative for ${candidateId}: preserve helper runtime evidence, lineage, and validation boundaries.`,
      whyPreferred: "Convergence Judge accepted or merged this candidate.",
      whyNot: [],
      doNotChooseWhen: ["When package validation fails."],
      evidenceRefs: [`handoff-narrative:${candidateId}`],
    })),
    nonGoals: ["Do not bypass DirectionHandoffPackage validation."],
    assumptions: ["Convergence Judge is the promotion owner."],
    missingInformation: [],
    risks: ["Aboveground must preserve source candidate refs."],
    evidenceBoundary: "Use source candidate, convergence, model and package validation refs only.",
    growthEntry: {
      allowedRuntimeShapes: ["single_agent", "sub_agent_tree"],
      suggestedFirstWorkflowNodes: ["confirm_direction_handoff", "derive_execution_plan", "preserve_evidence_refs"],
      escalationRules: ["Stop if package validation fails."],
    },
    decisionSummary: "Handoff Steward demo-summary fixture organized safe handoff material.",
    uncertainty: "No raw provider response or private reasoning trace is exposed.",
    confidence: candidateIds.length > 0 ? 0.8 : 0.2,
  };
}

function createLegalConvergenceJudgmentOutput(request: ModelRequest): Record<string, unknown> {
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
        reason: `Summary fixture Convergence Judge marked ${candidate.candidateId} as ${status}.`,
        evidenceRefs: [candidate.outputId],
        contentDifference: `Candidate ${candidate.candidateId} is handled by parent convergence.`,
        whyPreferred: status === "accepted"
          ? "The first option candidate is retained for handoff."
          : "The candidate remains supporting or rejected material.",
        conflictWith: [],
      };
    }),
    recommendedOptionId: firstOption?.candidateId,
    nextAction: firstOption === undefined ? "stop" : "approve_handoff",
    conflictsNeedingUserInput: [],
    constraintViolations: [],
    overallDirectionSummary: "Summary fixture Convergence Judge approved handoff-ready candidate material.",
    decisionSummary: "Convergence Judge returned the new convergence_judgment fixture output.",
    uncertainty: "The fixture contains no raw provider response or private reasoning trace.",
    confidence: 0.8,
  };
}

function parseConvergenceCandidates(request: ModelRequest): {
  readonly kind: string;
  readonly candidateId: string;
  readonly outputId: string;
}[] {
  const content = request.sanitizedMessages.map((message) => message.content).join("\n");
  return [...content.matchAll(/- \[(option|risk|asset_fit|evidence|constraint|counterfactual)\]\s+candidateId=([^\s]+)\s+outputId=([^\s\n]+)/g)]
    .map((match) => ({
      kind: match[1] ?? "option",
      candidateId: match[2] ?? "candidate-unknown",
      outputId: match[3] ?? "unknown",
    }));
}

function candidateIdsFromHandoffRequest(request: ModelRequest): string[] {
  const content = request.sanitizedMessages.map((message) => message.content).join("\n");
  return [...content.matchAll(/candidateId=([^\s\n]+)/g)]
    .map((match) => match[1])
    .filter((candidateId): candidateId is string => candidateId !== undefined && candidateId.length > 0);
}

function extractGoalAnchor(request: ModelRequest): string {
  const content = request.sanitizedMessages.map((message) => message.content).join("\n");
  const rawGoalLine = content.split("\n").find((line) => line.trim().startsWith("Raw goal:"));
  return rawGoalLine?.slice("Raw goal:".length).trim() || "current goal";
}

function availableRootletKindsFromGrowthRequest(request: ModelRequest): string[] {
  const content = request.sanitizedMessages.map((message) => message.content).join("\n");
  const line = content.split("\n").find((candidate) => candidate.trim().startsWith("Available rootlet kinds:"));
  const rawKinds = line?.slice(line.indexOf(":") + 1).trim() ?? "option";
  return rawKinds
    .split(",")
    .map((kind) => kind.trim())
    .filter((kind) => kind.length > 0);
}
