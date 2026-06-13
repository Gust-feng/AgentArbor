import type { AgentTurnRuntime } from "../../../kernel/intelligence/index.js";
import type { Constraint } from "../../../domain/contracts.js";
import type { ModelMessage, ModelOutputContract } from "../../../domain/intelligence/index.js";
import type { RuntimeShape } from "../../../domain/common.js";
import {
  createDirectionHandoffPackage,
  createDirectionHandoffPackageRef,
  type DirectionHandoffPackage,
  type DirectionHandoffPackageRef,
  type DirectionHandoffPackageStore,
} from "../../../domain/agentarbor/direction-handoff-package.js";
import {
  type AgentActionOutput,
  type AgentDecision,
  type AgentLoop,
  type AgentPercept,
  type AgentProtocol,
  type AgentRunContext,
  type CandidatePool,
  type DirectionHandoff,
  type DirectionOption,
  type GoalIntentProfile,
  type ParentSynthesisResult,
  type UndergroundConvergenceOutcome,
  type UndergroundConvergenceReport,
  acceptGuardedAction,
  createGuardViolation,
  type GuardedActionOutput,
  rejectGuardedAction,
  sanitizeUndergroundConvergenceAiAdvisoryText,
} from "../../../domain/underground/index.js";
import {
  createMinimalDirectionMaterial,
  createAwaitingUserDirectionMaterial,
  createStoppedDirectionMaterial,
  type MinimalDirectionMaterial,
} from "../../minimal-direction.js";
import {
  fallbackReasoningTrace,
  reasonWithAgentTurn,
  reasoningTraceRefs,
  type UndergroundReasoningParseResult,
  type UndergroundReasoningResult,
  type UndergroundReasoningTraceEntry,
} from "./reasoning.js";

export type HandoffStewardWorkspace = {
  readonly traceId: string;
  readonly goalId: string;
  readonly rawGoal: string;
  readonly goalIntentProfile?: GoalIntentProfile;
  readonly convergenceReport?: UndergroundConvergenceReport;
  readonly candidatePool?: CandidatePool;
  readonly parentSynthesis?: ParentSynthesisResult;
  readonly constraints: readonly Constraint[];
};

export type HandoffStewardCapabilities = {
  readonly agentTurnRuntime?: AgentTurnRuntime;
  readonly directionHandoffPackageStore: DirectionHandoffPackageStore;
};

export type HandoffStewardPercept = AgentPercept & {
  readonly traceId: string;
  readonly goalId: string;
  readonly rawGoal: string;
  readonly goalIntentProfile?: GoalIntentProfile;
  readonly convergenceReport: UndergroundConvergenceReport;
  readonly candidatePool: CandidatePool;
  readonly parentSynthesis?: ParentSynthesisResult;
  readonly constraints: readonly Constraint[];
};

export type HandoffStewardDecision = AgentDecision & {
  readonly handoffStrategy: "ai_narrative" | "deterministic_fallback";
  readonly handoffMaterial: HandoffDecisionMaterial;
  readonly source: "ai" | "deterministic_fallback";
  readonly confidence: number;
  readonly reasoningTrace: readonly UndergroundReasoningTraceEntry[];
};

export type HandoffStewardAction = AgentActionOutput & {
  readonly directionHandoffPackage: DirectionHandoffPackage;
  readonly directionHandoffPackageRef: DirectionHandoffPackageRef;
  readonly terminalStatus: "approved_package_created" | "awaiting_user" | "stopped";
  readonly source: "ai" | "deterministic_fallback";
  readonly confidence: number;
  readonly reasoningTrace: readonly UndergroundReasoningTraceEntry[];
};

type HandoffOptionNarrative = {
  readonly candidateId: string;
  readonly directionSummary: string;
  readonly whyPreferred: string;
  readonly whyNot: readonly string[];
  readonly doNotChooseWhen: readonly string[];
  readonly evidenceRefs: readonly string[];
};

type HandoffGrowthEntryNarrative = {
  readonly allowedRuntimeShapes: readonly RuntimeShape[];
  readonly suggestedFirstWorkflowNodes: readonly string[];
  readonly escalationRules: readonly string[];
};

type HandoffDecisionMaterial = {
  readonly source: "ai" | "deterministic_fallback";
  readonly status: UndergroundConvergenceOutcome;
  readonly clarifiedGoal: string;
  readonly optionNarratives: readonly HandoffOptionNarrative[];
  readonly nonGoals: readonly string[];
  readonly assumptions: readonly string[];
  readonly missingInformation: readonly string[];
  readonly risks: readonly string[];
  readonly evidenceBoundary: string;
  readonly growthEntry: HandoffGrowthEntryNarrative;
  readonly decisionSummary: string;
  readonly uncertainty: string;
  readonly confidence: number;
  readonly evidenceRefs: readonly string[];
  readonly sourceRefs: readonly string[];
  readonly fallbackRefs: readonly string[];
};

const HANDOFF_STEWARD_PROTOCOL: AgentProtocol = {
  inputs: [
    { source: "workspace", key: "goalId", required: true },
    { source: "workspace", key: "convergenceReport", required: true },
    { source: "workspace", key: "candidatePool", required: true },
    { source: "workspace", key: "constraints", required: false },
  ],
  outputs: [{ type: "DirectionHandoffPackage", payloadSchema: "direction_handoff_package.v1" }],
};

export class HandoffStewardAgent
  implements
    AgentLoop<
      HandoffStewardPercept,
      HandoffStewardDecision,
      HandoffStewardAction,
      HandoffStewardWorkspace,
      HandoffStewardCapabilities
    >
{
  readonly agentId = "underground-handoff-steward-loop";
  readonly protocol = HANDOFF_STEWARD_PROTOCOL;

  observe(
    ctx: AgentRunContext<HandoffStewardWorkspace, HandoffStewardCapabilities>
  ): HandoffStewardPercept {
    const snapshot = ctx.workspace.snapshot();
    const convergenceReport = snapshot.convergenceReport;
    const candidatePool = snapshot.candidatePool;
    if (convergenceReport === undefined) {
      throw new Error("HandoffStewardAgent requires a ConvergenceReport in the workspace.");
    }
    if (candidatePool === undefined) {
      throw new Error("HandoffStewardAgent requires a CandidatePool in the workspace.");
    }
    return {
      inputRefs: [snapshot.goalId, convergenceReport.reviewId],
      traceId: snapshot.traceId,
      goalId: snapshot.goalId,
      rawGoal: snapshot.rawGoal,
      goalIntentProfile: snapshot.goalIntentProfile,
      convergenceReport,
      candidatePool,
      parentSynthesis: snapshot.parentSynthesis,
      constraints: snapshot.constraints,
    };
  }

  async reason(
    ctx: AgentRunContext<HandoffStewardWorkspace, HandoffStewardCapabilities>,
    percept: HandoffStewardPercept
  ): Promise<HandoffStewardDecision> {
    const fallback = createFallbackHandoffMaterial(
      percept,
      "AgentTurnRuntime is not configured for Plan Steward narrative."
    );
    const ai = await reasonWithAgentTurn({
      agentId: this.agentId,
      agentTurnRuntime: ctx.capabilities?.agentTurnRuntime,
      traceId: percept.traceId,
      goalId: percept.goalId,
      purpose: "handoff_narrative",
      outputContract: HANDOFF_NARRATIVE_CONTRACT,
      callerRef: { kind: "direction_handoff", id: this.agentId, label: "handoff_narrative" },
      inputRefs: [
        { kind: "goal", id: percept.goalId },
        { kind: "convergence_review", id: percept.convergenceReport.reviewId },
      ],
      inputRefIds: percept.inputRefs,
      messages: buildHandoffNarrativeMessages(percept),
      constraints: percept.constraints,
      parse: (output) => parseHandoffNarrativeOutput(output, percept),
    });

    const handoffMaterial =
      ai.value === undefined
        ? {
            ...fallback,
            fallbackRefs: unique([...fallback.fallbackRefs, ...ai.fallbackRefs]),
            sourceRefs: handoffReasoningSourceRefs(ai),
          }
        : {
            ...ai.value,
            sourceRefs: unique([...ai.value.sourceRefs, ...handoffReasoningSourceRefs(ai)]),
          };
    const reasoningTrace =
      ai.reasoningTrace.length > 0
        ? ai.reasoningTrace
        : fallbackReasoningTrace({
            agentId: this.agentId,
            decisionSummary: fallback.decisionSummary,
            inputRefs: percept.inputRefs,
            fallbackRefs: fallback.fallbackRefs,
            uncertainty: fallback.uncertainty,
            confidence: 0.16,
          });

    return {
      rationaleRefs: [
        percept.convergenceReport.reviewId,
        ...reasoningTraceRefs(reasoningTrace),
        ...handoffMaterial.sourceRefs,
        ...handoffMaterial.fallbackRefs,
      ],
      handoffStrategy: ai.source === "ai" ? "ai_narrative" : "deterministic_fallback",
      handoffMaterial,
      source: ai.source,
      confidence: ai.confidence,
      reasoningTrace,
    };
  }

  act(
    ctx: AgentRunContext<HandoffStewardWorkspace, HandoffStewardCapabilities>,
    decision: HandoffStewardDecision
  ): HandoffStewardAction {
    const percept = this.observe(ctx);
    const store = ctx.capabilities?.directionHandoffPackageStore;
    if (store === undefined) {
      throw new Error("HandoffStewardAgent requires a directionHandoffPackageStore in capabilities.");
    }
    const convergenceReport = convergenceReportForHandoffMaterial(percept.convergenceReport, decision);
    const materialInput = {
      goalId: percept.goalId,
      goal: percept.rawGoal,
      producedByAgentId: this.agentId,
      constraints: [...percept.constraints],
      goalIntentProfile: percept.goalIntentProfile,
      candidatePool: percept.candidatePool,
      convergenceReport,
    };

    const material =
      decision.handoffMaterial.status === "approved"
        ? applyHandoffNarrativeMaterial(createMinimalDirectionMaterial(materialInput), decision.handoffMaterial)
        : decision.handoffMaterial.status === "awaiting_user"
          ? createAwaitingUserDirectionMaterial(materialInput)
          : createStoppedDirectionMaterial(materialInput);

    const directionHandoffPackage = store.save(material.directionHandoffPackage);
    const loadedDirectionHandoffPackage = store.load(
      directionHandoffPackage.manifest.directionId,
      directionHandoffPackage.manifest.directionVersion
    );
    const directionHandoffPackageRef = createDirectionHandoffPackageRef(loadedDirectionHandoffPackage);
    const terminalStatus = terminalStatusForConvergence(decision.handoffMaterial.status);

    return {
      outputRefs: [directionHandoffPackageRef.packageId],
      directionHandoffPackage,
      directionHandoffPackageRef,
      terminalStatus,
      source: decision.source,
      confidence: decision.confidence,
      reasoningTrace: decision.reasoningTrace,
    };
  }

  guard(
    ctx: AgentRunContext<HandoffStewardWorkspace, HandoffStewardCapabilities>,
    output: HandoffStewardAction
  ): GuardedActionOutput<HandoffStewardAction> {
    const violations = [];
    const pkg = output.directionHandoffPackage;
    const snapshot = ctx.workspace.snapshot();
    const convergenceReport = snapshot.convergenceReport;

    if (convergenceReport === undefined) {
      violations.push(
        createGuardViolation({
          code: "HANDOFF_NO_CONVERGENCE_REPORT",
          message: "HandoffSteward guard requires a ConvergenceReport in the workspace.",
          severity: "error",
        })
      );
      return rejectGuardedAction({ output, violations });
    }

    if (!pkg.validation.passed) {
      const expectedFailureCodes = new Set([
        "DIRECTION_HANDOFF_NOT_APPROVED",
        "MISSING_SOURCE_CANDIDATE_REFS",
        "MISSING_CONVERGENCE_REVIEW_REF",
        "UNCONVERGED_SOURCE_CANDIDATES",
      ]);
      for (const error of pkg.validation.errors) {
        if (output.terminalStatus === "approved_package_created" || !expectedFailureCodes.has(error.code)) {
          violations.push(
            createGuardViolation({
              code: `HANDOFF_PACKAGE_${error.code}`,
              message: error.message,
              severity: "error",
            })
          );
        }
      }
    }

    if (output.terminalStatus === "approved_package_created") {
      const originalHardConstraints = snapshot.constraints.filter((c: Constraint) => c.level === "hard");
      const handoffConstraintRefs = pkg.directionHandoff.constraintRefs.map((r: { constraintId: string }) => r.constraintId);
      for (const hardConstraint of originalHardConstraints) {
        if (!handoffConstraintRefs.includes(hardConstraint.id)) {
          violations.push(
            createGuardViolation({
              code: "HANDOFF_CONSTRAINT_WEAKENED",
              message: `Hard constraint ${hardConstraint.id} is missing from the Plan Package; constraints must not be weakened.`,
              severity: "error",
            })
          );
        }
      }
    }

    for (const candidate of pkg.directionHandoff.sourceCandidateRefs) {
      if (candidate.sourceRefs.length === 0) {
        violations.push(
          createGuardViolation({
            code: "HANDOFF_CANDIDATE_NO_EVIDENCE_REFS",
            message: `Source candidate ${candidate.id} in Plan Package has no evidence sourceRefs.`,
            severity: "error",
          })
        );
      }
    }

    if (pkg.manifest.directionId !== pkg.directionHandoff.id) {
      violations.push(
        createGuardViolation({
          code: "HANDOFF_PACKAGE_STRUCTURE_ILLEGAL",
          message: "Plan Package manifest directionId does not match compatibility handoff id.",
          severity: "error",
        })
      );
    }

    if (pkg.convergenceReview.reviewId !== convergenceReport.reviewId) {
      violations.push(
        createGuardViolation({
          code: "HANDOFF_CONVERGENCE_REF_MISMATCH",
          message: "Plan Package convergence review does not match workspace convergence report.",
          severity: "error",
        })
      );
    }

    // Confidence lower bound warning for approved packages
    if (output.terminalStatus === "approved_package_created" && output.confidence < 0.5) {
      violations.push(
        createGuardViolation({
          code: "HANDOFF_LOW_CONFIDENCE",
          message: `Handoff confidence ${output.confidence.toFixed(2)} is below 0.5; approved packages should have higher confidence.`,
          severity: "warning",
        })
      );
    }

    if (violations.some((v) => v.severity === "error")) {
      return rejectGuardedAction({ output, violations });
    }

    return acceptGuardedAction(output);
  }
}

const HANDOFF_NARRATIVE_CONTRACT: ModelOutputContract = {
  contractId: "underground.handoff_narrative.v1",
  outputKind: "draft",
  format: "json_object",
  requiredFields: [
    "status",
    "clarifiedGoal",
    "optionNarratives",
    "nonGoals",
    "assumptions",
    "missingInformation",
    "risks",
    "evidenceBoundary",
    "growthEntry",
    "decisionSummary",
    "uncertainty",
    "confidence",
  ],
  requiredStringFields: ["status", "clarifiedGoal", "evidenceBoundary", "decisionSummary", "uncertainty"],
  visibleOutput: {
    fields: ["status", "clarifiedGoal", "evidenceBoundary", "decisionSummary", "uncertainty"],
    fieldTypes: {
      status: "string",
      clarifiedGoal: "string",
      evidenceBoundary: "string",
      decisionSummary: "string",
      uncertainty: "string",
    },
    maxFieldLength: 240,
  },
};

function buildHandoffNarrativeMessages(percept: HandoffStewardPercept): readonly ModelMessage[] {
  const candidateById = new Map(percept.candidatePool.candidates.map((candidate) => [candidate.id, candidate]));
  const sourceCandidateLines = percept.convergenceReport.handoffCandidateRefs.map((candidateId) => {
    const candidate = candidateById.get(candidateId);
    return [
      `- candidateId=${candidateId}`,
      `  status=${candidate?.status ?? "missing"}`,
      `  summary=${truncate(candidate?.summary ?? "No candidate summary.", 220)}`,
      `  sourceRefs=${candidate?.sourceRefs.join(", ") ?? "missing"}`,
    ].join("\n");
  });
  const decisionLines = percept.convergenceReport.decisions.map((decision) =>
    `- ${decision.candidateId}: ${decision.status}; evidenceRefs=${decision.evidenceRefs.join(", ") || "none"}; reason=${truncate(decision.reason, 180)}`
  );
  return [
    {
      role: "system",
      content: [
        "You are AgentArbor Underground Plan Steward.",
        "You organize the final .agentarbor Plan Package narrative from already converged materials.",
        "Do not approve candidates that Convergence Judge did not accept or merge. Do not weaken hard constraints.",
        "The clarifiedGoal must add explicit direction-shaping context from convergence and evidence; if the materials only support echoing the raw goal, lower confidence or choose a non-approved status.",
        "Return JSON only. Do not include chain-of-thought, raw prompt, hidden reasoning, provider response text, secrets, or tokens.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Goal id: ${percept.goalId}`,
        `Raw goal: ${percept.rawGoal}`,
        `Goal statement: ${percept.goalIntentProfile?.goalStatement ?? "unknown"}`,
        `Convergence review: ${percept.convergenceReport.reviewId}`,
        `Convergence outcome: ${percept.convergenceReport.outcome}`,
        `Convergence source: ${percept.convergenceReport.source}`,
        `Convergence summary: ${truncate(percept.convergenceReport.summary, 260)}`,
        "",
        "Handoff candidate refs:",
        ...(sourceCandidateLines.length > 0 ? sourceCandidateLines : ["- none"]),
        "",
        "Convergence decisions:",
        ...(decisionLines.length > 0 ? decisionLines : ["- none"]),
        "",
        "Hard constraints:",
        ...percept.constraints
          .filter((constraint) => constraint.level === "hard")
          .map((constraint) => `- ${constraint.id}: ${truncate(constraint.statement, 160)}`),
        ...(percept.constraints.filter((constraint) => constraint.level === "hard").length === 0
          ? ["- none"]
          : []),
        "",
        "Return fields: status, clarifiedGoal, optionNarratives [{ candidateId, directionSummary, whyPreferred, whyNot, doNotChooseWhen, evidenceRefs }], nonGoals, assumptions, missingInformation, risks, evidenceBoundary, growthEntry { allowedRuntimeShapes, suggestedFirstWorkflowNodes, escalationRules }, decisionSummary, uncertainty, confidence.",
        "For approved status, include at least one optionNarrative whose candidateId is a handoff candidate ref.",
      ].join("\n"),
    },
  ];
}

function parseHandoffNarrativeOutput(
  output: unknown,
  percept: HandoffStewardPercept
): UndergroundReasoningParseResult<HandoffDecisionMaterial> {
  const record = asRecord(output);
  const status = parseHandoffStatus(record.status);
  if (status === undefined) {
    return failedParse("handoff_narrative:invalid_status", "Plan Steward model output did not choose a legal status.");
  }
  if (status === "approved" && percept.convergenceReport.outcome !== "approved") {
    return failedParse(
      "handoff_narrative:approval_without_approved_convergence",
      "Plan Steward cannot approve when Convergence Judge did not approve."
    );
  }
  if (status === "approved" && percept.convergenceReport.handoffCandidateRefs.length === 0) {
    return failedParse(
      "handoff_narrative:approval_without_source_candidates",
      "Plan Steward cannot approve without converged Plan candidate refs."
    );
  }
  if (status === "awaiting_user" && percept.convergenceReport.userClarificationRequest === undefined) {
    return failedParse(
      "handoff_narrative:awaiting_user_without_clarification_request",
      "Plan Steward cannot create awaiting_user material without an existing clarification request."
    );
  }

  const clarifiedGoal = stringOrUndefined(record.clarifiedGoal);
  const evidenceBoundary = stringOrUndefined(record.evidenceBoundary);
  const decisionSummary = stringOrUndefined(record.decisionSummary);
  if (clarifiedGoal === undefined || evidenceBoundary === undefined || decisionSummary === undefined) {
    return failedParse(
      "handoff_narrative:missing_safe_summary",
      "Plan Steward model output requires safe clarifiedGoal, evidenceBoundary and decisionSummary fields."
    );
  }

  const optionNarratives = parseOptionNarratives(record.optionNarratives, percept.convergenceReport.handoffCandidateRefs);
  if (status === "approved" && optionNarratives.length === 0) {
    return failedParse(
      "handoff_narrative:approved_without_option_narrative",
      "Approved Plan Steward output must include model-authored narrative for at least one converged Plan candidate."
    );
  }

  const growthEntry = parseGrowthEntry(record.growthEntry);
  return {
    ok: true,
    value: {
      status,
      source: "ai",
      clarifiedGoal,
      optionNarratives,
      nonGoals: stringArray(record.nonGoals),
      assumptions: stringArray(record.assumptions),
      missingInformation: stringArray(record.missingInformation),
      risks: stringArray(record.risks),
      evidenceBoundary,
      growthEntry,
      decisionSummary,
      uncertainty: stringOrUndefined(record.uncertainty) ?? "No uncertainty summary provided by the model.",
      confidence: numberOrUndefined(record.confidence) ?? 0.72,
      evidenceRefs: unique([
        ...stringArray(record.evidenceRefs),
        ...optionNarratives.flatMap((narrative) => narrative.evidenceRefs),
        percept.convergenceReport.reviewId,
      ]),
      sourceRefs: [],
      fallbackRefs: [],
    },
    decisionSummary,
    uncertainty: stringOrUndefined(record.uncertainty),
    confidence: numberOrUndefined(record.confidence),
  };
}

function createFallbackHandoffMaterial(
  percept: HandoffStewardPercept,
  reason: string
): HandoffDecisionMaterial {
  const safeReason = safeHandoffText(reason);
  const fallbackStatus: UndergroundConvergenceOutcome =
    percept.convergenceReport.outcome === "awaiting_user" ? "awaiting_user" : "stopped";
  return {
    status: fallbackStatus,
    source: "deterministic_fallback",
    clarifiedGoal: percept.goalIntentProfile?.goalStatement ?? percept.rawGoal,
    optionNarratives: [],
    nonGoals: [],
    assumptions: ["Plan Steward narrative is unavailable; this material is low-confidence fallback only."],
    missingInformation:
      fallbackStatus === "awaiting_user"
        ? percept.convergenceReport.openQuestions.map((question) => question.question)
        : ["Plan Steward AI narrative is required before approved package creation."],
    risks: [safeReason || "Plan Steward AI narrative path is unavailable."],
    evidenceBoundary: "No approved Plan narrative was produced; source candidates are not promoted by fallback.",
    growthEntry: {
      allowedRuntimeShapes: [],
      suggestedFirstWorkflowNodes: [],
      escalationRules: ["Stop or configure AgentTurnRuntime before Aboveground planning."],
    },
    decisionSummary: "Deterministic fallback did not approve the Plan.",
    uncertainty: "AgentTurnRuntime is required before Plan Steward can organize an approved Plan narrative.",
    confidence: 0.16,
    evidenceRefs: [percept.convergenceReport.reviewId],
    sourceRefs: [],
    fallbackRefs: ["deterministic_fallback", "handoff_narrative_unavailable"],
  };
}

function convergenceReportForHandoffMaterial(
  report: UndergroundConvergenceReport,
  decision: HandoffStewardDecision
): UndergroundConvergenceReport {
  if (report.outcome === decision.handoffMaterial.status) {
    return report;
  }
  if (decision.handoffMaterial.status === "approved") {
    return report;
  }
  const stopped = decision.handoffMaterial.status === "stopped";
  return {
    ...report,
    acceptedCandidateRefs: stopped ? [] : report.acceptedCandidateRefs,
    mergedCandidateRefs: stopped ? [] : report.mergedCandidateRefs,
    deduplicatedCandidateRefs: stopped ? [] : report.deduplicatedCandidateRefs,
    outcome: decision.handoffMaterial.status,
    userEscalationRequired: decision.handoffMaterial.status === "awaiting_user",
    userClarificationRequest:
      decision.handoffMaterial.status === "awaiting_user" ? report.userClarificationRequest : undefined,
    stopReason: stopped ? "ai_required_for_autonomy" : report.stopReason,
    handoffCandidateRefs: stopped ? [] : report.handoffCandidateRefs,
    source: decision.source,
    confidence: Math.min(report.confidence, decision.confidence),
    reasoningTrace: decision.reasoningTrace,
    provenanceRefs: unique([
      ...report.provenanceRefs,
      ...decision.handoffMaterial.sourceRefs,
      ...decision.handoffMaterial.fallbackRefs,
    ]),
  };
}

function applyHandoffNarrativeMaterial(
  material: MinimalDirectionMaterial,
  handoffMaterial: HandoffDecisionMaterial
): MinimalDirectionMaterial {
  const handoff = material.directionHandoff;
  const directionHandoff: DirectionHandoff = {
    ...handoff,
    clarifiedGoal: handoffMaterial.clarifiedGoal,
    nonGoals: unique([...handoffMaterial.nonGoals, ...handoff.nonGoals]),
    assumptions: unique([
      ...handoffMaterial.assumptions,
      `Plan Steward source: ${handoffMaterial.source}; confidence=${formatConfidenceForHandoff(handoffMaterial)}.`,
      ...handoff.assumptions,
    ]),
    missingInformation: unique([...handoffMaterial.missingInformation]),
    risks: unique([...handoffMaterial.risks, ...handoff.risks]),
    evidenceRefs: unique([...handoff.evidenceRefs, ...handoffMaterial.evidenceRefs, ...handoffMaterial.sourceRefs]),
    options: applyOptionNarratives(handoff.options, handoffMaterial.optionNarratives),
    decisionRecord: {
      ...handoff.decisionRecord,
      rationaleEvidenceRefs: unique([
        ...handoff.decisionRecord.rationaleEvidenceRefs,
        ...handoffMaterial.evidenceRefs,
        ...handoffMaterial.sourceRefs,
      ]),
      rationaleRiskRefs: unique([...handoff.decisionRecord.rationaleRiskRefs, ...handoffMaterial.risks]),
    },
    growthEntry: {
      allowedRuntimeShapes:
        handoffMaterial.growthEntry.allowedRuntimeShapes.length > 0
          ? [...handoffMaterial.growthEntry.allowedRuntimeShapes]
          : handoff.growthEntry.allowedRuntimeShapes,
      suggestedFirstWorkflowNodes:
        handoffMaterial.growthEntry.suggestedFirstWorkflowNodes.length > 0
          ? [...handoffMaterial.growthEntry.suggestedFirstWorkflowNodes]
          : handoff.growthEntry.suggestedFirstWorkflowNodes,
      escalationRules: unique([
        ...handoffMaterial.growthEntry.escalationRules,
        `Evidence boundary: ${handoffMaterial.evidenceBoundary}`,
        ...handoff.growthEntry.escalationRules,
      ]),
    },
  };
  return {
    ...material,
    directionHandoff,
    directionHandoffPackage: createDirectionHandoffPackage({
      directionHandoff,
      convergenceReview: material.convergenceReview,
    }),
  };
}

function applyOptionNarratives(
  options: readonly DirectionOption[],
  narratives: readonly HandoffOptionNarrative[]
): DirectionOption[] {
  const narrativeByCandidateId = new Map(narratives.map((narrative) => [narrative.candidateId, narrative]));
  return options.map((option) => {
    const narrative = narrativeByCandidateId.get(option.optionId);
    if (narrative === undefined) {
      return { ...option };
    }
    return {
      ...option,
      directionSummary: narrative.directionSummary,
      supportingEvidenceRefs: unique([...option.supportingEvidenceRefs, ...narrative.evidenceRefs]),
      whyNot: unique([...narrative.whyNot, ...option.whyNot]),
      doNotChooseWhen: unique([...narrative.doNotChooseWhen, ...option.doNotChooseWhen]),
    };
  });
}

function parseOptionNarratives(value: unknown, allowedCandidateIds: readonly string[]): HandoffOptionNarrative[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const allowed = new Set(allowedCandidateIds);
  return value.flatMap((item) => {
    const record = asRecord(item);
    const candidateId = stringOrUndefined(record.candidateId);
    const directionSummary = stringOrUndefined(record.directionSummary);
    const whyPreferred = stringOrUndefined(record.whyPreferred);
    if (
      candidateId === undefined ||
      directionSummary === undefined ||
      whyPreferred === undefined ||
      !allowed.has(candidateId)
    ) {
      return [];
    }
    return [{
      candidateId,
      directionSummary,
      whyPreferred,
      whyNot: stringArray(record.whyNot),
      doNotChooseWhen: stringArray(record.doNotChooseWhen),
      evidenceRefs: stringArray(record.evidenceRefs),
    }];
  });
}

function parseGrowthEntry(value: unknown): HandoffGrowthEntryNarrative {
  const record = asRecord(value);
  return {
    allowedRuntimeShapes: stringArray(record.allowedRuntimeShapes).flatMap(parseRuntimeShape),
    suggestedFirstWorkflowNodes: stringArray(record.suggestedFirstWorkflowNodes),
    escalationRules: stringArray(record.escalationRules),
  };
}

function parseRuntimeShape(value: string): RuntimeShape[] {
  return value === "single_agent" ||
    value === "sub_agent_tree" ||
    value === "shared_team_cluster" ||
    value === "competitive_team_cluster"
    ? [value]
    : [];
}

function parseHandoffStatus(value: unknown): UndergroundConvergenceOutcome | undefined {
  return value === "approved" || value === "awaiting_user" || value === "stopped" ? value : undefined;
}

function handoffReasoningSourceRefs(ai: UndergroundReasoningResult<unknown>): string[] {
  return unique([
    ...ai.modelCallRefs.flatMap((ref) => [
      "model.requested",
      ref.validationStatus === "passed" ? "model.completed" : "model.failed",
      ref.requestId,
      ref.responseId,
    ]),
    ...ai.toolCallRefs,
  ].filter((value): value is string => typeof value === "string" && value.length > 0));
}

function failedParse(
  reason: string,
  decisionSummary: string
): UndergroundReasoningParseResult<HandoffDecisionMaterial> {
  return {
    ok: false,
    reason,
    decisionSummary,
    uncertainty: "The model response passed the generic contract but failed Plan Steward structural parsing.",
    confidence: 0.16,
  };
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function stringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const sanitized = safeHandoffText(value);
  return sanitized.length > 0 ? sanitized : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const parsed = stringOrUndefined(item);
        return parsed === undefined ? [] : [parsed];
      })
    : [];
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function safeHandoffText(value: string): string {
  return sanitizeUndergroundConvergenceAiAdvisoryText(value).trim();
}

function formatConfidenceForHandoff(handoffMaterial: HandoffDecisionMaterial): string {
  return handoffMaterial.confidence.toFixed(2);
}

function terminalStatusForConvergence(
  outcome: UndergroundConvergenceReport["outcome"]
): "approved_package_created" | "awaiting_user" | "stopped" {
  switch (outcome) {
    case "approved":
      return "approved_package_created";
    case "awaiting_user":
      return "awaiting_user";
    case "stopped":
      return "stopped";
  }
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
