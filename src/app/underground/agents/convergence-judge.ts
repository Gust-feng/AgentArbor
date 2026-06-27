/**
 * @deprecated 废弃候选（T4-1 / ADR-0025 deep 一期）— ②' 固定拓扑主体（强耦合 directionHandoffPackage/Plan，不做本期主线）。
 *
 * 替代物：src/app/deep/* DeepRuntime（manager 自由决策循环 → 一层 child 探索 → 父层综合）；
 * 正式入口 POST /api/deep/conversations + /api/deep/conversations/:id/runs。
 *
 * 删除前置条件（闭环4 §8.1 阶段④）：smoke/tests 迁移完成 + 等价能力验证通过 + 无活跃引用。
 * 当前保持运行不阻塞构建；禁止改名/删除（仍被 test/smoke/compat 引用）。
 * 边界：domain/underground 的 AgentLoop/Guard/run tree/事件契约为保留复用抽象，不在退役范围。
 */
import type { AgentTurnRuntime } from "../../../kernel/intelligence/index.js";
import type { Constraint } from "../../../domain/contracts.js";
import type { ModelMessage, ModelOutputContract } from "../../../domain/intelligence/index.js";
import {
  type AgentActionOutput,
  type AgentDecision,
  type AgentLoop,
  type AgentPercept,
  type AgentProtocol,
  type AgentRunContext,
  type CandidatePool,
  type CandidateConvergenceStatus,
  type GoalIntentProfile,
  type RootletOutput,
  type UndergroundAutonomyDecision,
  type UndergroundConvergenceReport,
  type UndergroundEvidenceLedger,
  type UndergroundExplorationPlan,
  type ParentSynthesisResult,
  type UserClarificationReason,
  acceptGuardedAction,
  createGuardViolation,
  type GuardedActionOutput,
  rejectGuardedAction,
  sanitizeUndergroundConvergenceAiAdvisoryText,
} from "../../../domain/underground/index.js";
import {
  convergeCandidatePoolFromJudgment,
  convergeAutonomyTerminalCandidatePool,
  type ConvergenceJudgment,
  type ConvergenceJudgmentCandidateDecision,
  type ConvergenceJudgmentNextAction,
} from "../../underground-convergence.js";
import {
  fallbackReasoningTrace,
  reasonWithAgentTurn,
  reasoningTraceRefs,
  type UndergroundReasoningParseResult,
  type UndergroundReasoningTraceEntry,
} from "./reasoning.js";

export type ConvergenceJudgeWorkspace = {
  readonly traceId: string;
  readonly goalId: string;
  readonly rawGoal: string;
  readonly goalIntentProfile?: GoalIntentProfile;
  readonly candidatePool?: CandidatePool;
  readonly rootletOutputs: readonly RootletOutput[];
  readonly constraints: readonly Constraint[];
  readonly startedPlan?: UndergroundExplorationPlan;
  readonly evidenceLedger?: UndergroundEvidenceLedger;
  readonly autonomyDecision?: UndergroundAutonomyDecision;
  readonly parentSynthesis?: ParentSynthesisResult;
};

export type ConvergenceJudgeCapabilities = {
  readonly agentTurnRuntime?: AgentTurnRuntime;
};

export type ConvergenceJudgePercept = AgentPercept & {
  readonly goalId: string;
  readonly traceId: string;
  readonly rawGoal: string;
  readonly goalIntentProfile?: GoalIntentProfile;
  readonly candidatePool: CandidatePool;
  readonly rootletOutputs: readonly RootletOutput[];
  readonly constraints: readonly Constraint[];
  readonly startedPlan: UndergroundExplorationPlan;
  readonly evidenceLedger?: UndergroundEvidenceLedger;
  readonly autonomyDecision?: UndergroundAutonomyDecision;
  readonly parentSynthesis?: ParentSynthesisResult;
};

export type ConvergenceJudgeDecision = AgentDecision & {
  readonly convergenceStrategy: "ai_judgment" | "deterministic_fallback" | "terminal_autonomy";
  readonly judgment?: ConvergenceJudgment;
  readonly source: "ai" | "deterministic_fallback" | "terminal_autonomy";
  readonly confidence: number;
  readonly reasoningTrace: readonly UndergroundReasoningTraceEntry[];
};

export type ConvergenceJudgeAction = AgentActionOutput & {
  readonly convergenceReport: UndergroundConvergenceReport;
  readonly evidenceLedger: UndergroundEvidenceLedger;
  readonly candidatePool: CandidatePool;
  readonly source: "ai" | "deterministic_fallback" | "terminal_autonomy";
  readonly confidence: number;
  readonly reasoningTrace: readonly UndergroundReasoningTraceEntry[];
};

const CONVERGENCE_JUDGE_PROTOCOL: AgentProtocol = {
  inputs: [
    { source: "workspace", key: "goalId", required: true },
    { source: "workspace", key: "candidatePool", required: true },
    { source: "workspace", key: "rootletOutputs", required: true },
    { source: "workspace", key: "constraints", required: false },
    { source: "workspace", key: "startedPlan", required: true },
    { source: "workspace", key: "evidenceLedger", required: false },
    { source: "workspace", key: "autonomyDecision", required: false },
  ],
  outputs: [{ type: "ConvergenceReport", payloadSchema: "convergence_report.v1" }],
};

export class ConvergenceJudgeAgent
  implements
    AgentLoop<
      ConvergenceJudgePercept,
      ConvergenceJudgeDecision,
      ConvergenceJudgeAction,
      ConvergenceJudgeWorkspace,
      ConvergenceJudgeCapabilities
    >
{
  readonly agentId = "underground-convergence-judge-loop";
  readonly protocol = CONVERGENCE_JUDGE_PROTOCOL;

  observe(
    ctx: AgentRunContext<ConvergenceJudgeWorkspace, ConvergenceJudgeCapabilities>
  ): ConvergenceJudgePercept {
    const snapshot = ctx.workspace.snapshot();
    const candidatePool = snapshot.candidatePool;
    const startedPlan = snapshot.startedPlan;
    if (candidatePool === undefined) {
      throw new Error("ConvergenceJudgeAgent requires a CandidatePool in the workspace.");
    }
    if (startedPlan === undefined) {
      throw new Error("ConvergenceJudgeAgent requires a startedPlan in the workspace.");
    }
    return {
      inputRefs: [snapshot.goalId, candidatePool.poolId],
      goalId: snapshot.goalId,
      traceId: snapshot.traceId,
      rawGoal: snapshot.rawGoal,
      goalIntentProfile: snapshot.goalIntentProfile,
      candidatePool,
      rootletOutputs: snapshot.rootletOutputs,
      constraints: snapshot.constraints,
      startedPlan,
      evidenceLedger: snapshot.evidenceLedger,
      autonomyDecision: snapshot.autonomyDecision,
      parentSynthesis: snapshot.parentSynthesis,
    };
  }

  async reason(
    ctx: AgentRunContext<ConvergenceJudgeWorkspace, ConvergenceJudgeCapabilities>,
    percept: ConvergenceJudgePercept
  ): Promise<ConvergenceJudgeDecision> {
    const autonomyDecision = percept.autonomyDecision;
    const isTerminal =
      autonomyDecision !== undefined &&
      (autonomyDecision.status !== "completed" || autonomyDecision.action !== "request_convergence");

    if (isTerminal) {
      return {
        rationaleRefs: [autonomyDecision.decisionId],
        convergenceStrategy: "terminal_autonomy",
        source: "terminal_autonomy",
        confidence: 0.24,
        reasoningTrace: fallbackReasoningTrace({
          agentId: this.agentId,
          decisionSummary: `Autonomy terminal decision ${autonomyDecision.decisionId} is being landed as a terminal convergence report.`,
          inputRefs: percept.inputRefs,
          fallbackRefs: [autonomyDecision.decisionId, autonomyDecision.stopReason ?? "autonomy_terminal"],
          uncertainty: "Convergence Judge is structuring an autonomy terminal path, not approving handoff.",
          confidence: 0.24,
        }),
      };
    }

    const fallback = createFallbackConvergenceJudgment(percept, "AgentTurnRuntime is not configured for Convergence Judge.");
    const ai = await reasonWithAgentTurn({
      agentId: this.agentId,
      agentTurnRuntime: ctx.capabilities?.agentTurnRuntime,
      traceId: percept.traceId,
      goalId: percept.goalId,
      purpose: "convergence_judgment",
      outputContract: CONVERGENCE_JUDGMENT_CONTRACT,
      callerRef: { kind: "convergence_review", id: this.agentId, label: "convergence_judgment" },
      inputRefs: [
        { kind: "goal", id: percept.goalId },
        { kind: "candidate_pool", id: percept.candidatePool.poolId },
      ],
      inputRefIds: percept.inputRefs,
      messages: buildConvergenceJudgmentMessages(percept),
      constraints: percept.constraints,
      parse: (output) => parseConvergenceJudgmentOutput(output, percept),
    });

    const judgment = ai.value ?? createFallbackConvergenceJudgment(
      percept,
      ai.failureReason ?? "Convergence Judge model path failed or returned invalid judgment."
    );
    const reasoningTrace =
      ai.reasoningTrace.length > 0
        ? ai.reasoningTrace
        : fallbackReasoningTrace({
            agentId: this.agentId,
            decisionSummary: fallback.decisionSummary,
            inputRefs: percept.inputRefs,
            fallbackRefs: ["deterministic_fallback"],
          });

    return {
      rationaleRefs: [percept.candidatePool.poolId, judgment.judgmentId, ...reasoningTraceRefs(reasoningTrace)],
      convergenceStrategy: ai.source === "ai" ? "ai_judgment" : "deterministic_fallback",
      judgment,
      source: ai.source,
      confidence: ai.confidence,
      reasoningTrace,
    };
  }

  act(
    ctx: AgentRunContext<ConvergenceJudgeWorkspace, ConvergenceJudgeCapabilities>,
    decision: ConvergenceJudgeDecision
  ): ConvergenceJudgeAction {
    const percept = this.observe(ctx);
    const leadAgentId = this.agentId;

    if (decision.convergenceStrategy === "terminal_autonomy" && percept.autonomyDecision !== undefined) {
      const result = convergeAutonomyTerminalCandidatePool({
        pool: percept.candidatePool,
        plan: percept.startedPlan,
        leadAgentId,
        rootletOutputs: percept.rootletOutputs,
        goalIntentProfile: percept.goalIntentProfile,
        constraints: percept.constraints,
        evidenceLedger: percept.evidenceLedger,
        autonomyDecision: percept.autonomyDecision,
      });
      return {
        outputRefs: [result.convergenceReport.reviewId],
        convergenceReport: result.convergenceReport,
        evidenceLedger: result.evidenceLedger,
        candidatePool: result.candidatePool,
        source: "terminal_autonomy",
        confidence: decision.confidence,
        reasoningTrace: decision.reasoningTrace,
      };
    }

    if (decision.judgment === undefined) {
      throw new Error("ConvergenceJudgeAgent requires a judgment before act can land convergence.");
    }

    const result = convergeCandidatePoolFromJudgment({
      pool: percept.candidatePool,
      plan: percept.startedPlan,
      leadAgentId,
      rootletOutputs: percept.rootletOutputs,
      goalIntentProfile: percept.goalIntentProfile,
      constraints: percept.constraints,
      evidenceLedger: percept.evidenceLedger,
      judgment: decision.judgment,
      source: decision.source,
      confidence: decision.confidence,
      reasoningTrace: decision.reasoningTrace,
      forcedStopReason: decision.source === "deterministic_fallback" ? "ai_required_for_autonomy" : undefined,
    });
    const convergenceReport =
      percept.parentSynthesis === undefined
        ? result.convergenceReport
        : {
            ...result.convergenceReport,
            provenanceRefs: [
              ...result.convergenceReport.provenanceRefs,
              percept.parentSynthesis.synthesisId,
            ],
          };
    return {
      outputRefs: [convergenceReport.reviewId],
      convergenceReport,
      evidenceLedger: result.evidenceLedger,
      candidatePool: result.candidatePool,
      source: decision.source,
      confidence: decision.confidence,
      reasoningTrace: decision.reasoningTrace,
    };
  }

  guard(
    ctx: AgentRunContext<ConvergenceJudgeWorkspace, ConvergenceJudgeCapabilities>,
    output: ConvergenceJudgeAction
  ): GuardedActionOutput<ConvergenceJudgeAction> {
    const violations = [];
    const report = output.convergenceReport;
    const snapshot = ctx.workspace.snapshot();

    if (report.outcome === "approved") {
      if (report.source !== "ai") {
        violations.push(
          createGuardViolation({
            code: "CONVERGENCE_APPROVED_WITHOUT_AI_JUDGMENT",
            message: "Approved convergence requires an AI Convergence Judge judgment.",
            severity: "error",
          })
        );
      }
      const hardConstraints = snapshot.constraints.filter((c: Constraint) => c.level === "hard");
      for (const hardConstraint of hardConstraints) {
        const violatedInDecisions = report.decisions.some(
          (d) =>
            d.status === "accepted" &&
            d.provenanceRefs.some((ref: string) => ref.includes(hardConstraint.id)) &&
            d.evidenceRefs.length === 0
        );
        if (violatedInDecisions) {
          violations.push(
            createGuardViolation({
              code: "HARD_CONSTRAINT_VIOLATION_NOT_BLOCKED",
              message: `Accepted candidate references hard constraint ${hardConstraint.id} without blocking evidence.`,
              severity: "error",
            })
          );
        }
      }
    }

    if (report.source === "deterministic_fallback" && report.confidence > 0.3) {
      violations.push(
        createGuardViolation({
          code: "CONVERGENCE_FALLBACK_CONFIDENCE_TOO_HIGH",
          message: "Deterministic convergence fallback must remain low confidence.",
          severity: "error",
        })
      );
    }

    if (report.summary.trim().length === 0) {
      violations.push(
        createGuardViolation({
          code: "CONVERGENCE_EMPTY_SUMMARY",
          message: "ConvergenceReport summary must not be empty.",
          severity: "error",
        })
      );
    }

    if (report.decisions.length === 0) {
      violations.push(
        createGuardViolation({
          code: "CONVERGENCE_NO_DECISIONS",
          message: "ConvergenceReport must contain at least one decision.",
          severity: "error",
        })
      );
    }

    for (const decision of report.decisions) {
      if (decision.evidenceRefs.length === 0) {
        violations.push(
          createGuardViolation({
            code: "CONVERGENCE_DECISION_NO_EVIDENCE",
            message: `Convergence decision ${decision.decisionId} must include evidence refs.`,
            severity: "warning",
          })
        );
      }
    }

    if (violations.some((v) => v.severity === "error")) {
      return rejectGuardedAction({ output, violations });
    }

    return acceptGuardedAction(output);
  }
}

const CONVERGENCE_JUDGMENT_CONTRACT: ModelOutputContract = {
  contractId: "underground.convergence_judgment.v1",
  outputKind: "explanation",
  format: "json_object",
  requiredFields: [
    "candidateDecisions",
    "nextAction",
    "overallDirectionSummary",
    "decisionSummary",
    "uncertainty",
    "confidence",
  ],
  requiredStringFields: ["nextAction", "overallDirectionSummary", "decisionSummary", "uncertainty"],
  visibleOutput: {
    fields: ["nextAction", "overallDirectionSummary", "decisionSummary", "uncertainty"],
    fieldTypes: {
      nextAction: "string",
      overallDirectionSummary: "string",
      decisionSummary: "string",
      uncertainty: "string",
    },
    maxFieldLength: 240,
  },
};

function buildConvergenceJudgmentMessages(percept: ConvergenceJudgePercept): readonly ModelMessage[] {
  const candidateLines = percept.candidatePool.candidates.map((candidate) => {
    const rootletOutput = percept.rootletOutputs.find((output) => candidate.sourceRefs.includes(output.outputId));
    return [
      `- [${rootletOutput?.kind ?? "unknown"}] candidateId=${candidate.id} outputId=${rootletOutput?.outputId ?? "unknown"}`,
      `  summary: ${truncate(candidate.summary ?? rootletOutput?.summary ?? "No candidate summary.", 220)}`,
      `  sourceRefs: ${candidate.sourceRefs.join(", ") || "none"}`,
      `  evidenceRefs: ${rootletOutput?.evidenceRefs.join(", ") || "none"}`,
      `  source: ${rootletOutput?.source ?? "unknown"}`,
    ].join("\n");
  });
  return [
    {
      role: "system",
      content: [
        "You are AgentArbor Underground Convergence Judge.",
        "You are the primary convergence decision-maker, not an advisory overlay.",
        "Decide every candidate as accepted, merged, rejected, or unknown; decide whether to approve handoff, continue exploration, ask the user, or stop.",
        "Return JSON only. Do not include chain-of-thought. Engineering guards only enforce hard constraints, state legality, evidence refs, and report/package structure.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Goal id: ${percept.goalId}`,
        `Raw goal: ${percept.rawGoal}`,
        `Goal statement: ${percept.goalIntentProfile?.goalStatement ?? "unknown"}`,
        `Candidate pool: ${percept.candidatePool.poolId}`,
        "Allowed candidate statuses: accepted, merged, rejected, unknown.",
        "Allowed nextAction values: approve_handoff, continue_exploration, request_user_clarification, stop.",
        "Candidate decisions must cover exactly every candidateId below.",
        "",
        "Candidates:",
        ...candidateLines,
        "",
        "Hard constraints:",
        ...percept.constraints
          .filter((constraint) => constraint.level === "hard")
          .map((constraint) => `- ${constraint.id}: ${truncate(constraint.statement, 160)}`),
        ...(percept.constraints.filter((constraint) => constraint.level === "hard").length === 0
          ? ["- none"]
          : []),
        "",
        "Return fields: candidateDecisions [{ candidateId, status, reason, evidenceRefs, clarificationReason?, contentDifference?, whyPreferred?, conflictWith?, openQuestion?, blockingLevel? }], recommendedOptionId?, nextAction, conflictsNeedingUserInput, constraintViolations, overallDirectionSummary, decisionSummary, uncertainty, confidence.",
        "If nextAction is stop or continue_exploration, do not mark candidates accepted or merged.",
      ].join("\n"),
    },
  ];
}

function parseConvergenceJudgmentOutput(
  output: unknown,
  percept: ConvergenceJudgePercept
): UndergroundReasoningParseResult<ConvergenceJudgment> {
  const record = asRecord(output);
  const nextAction = parseNextAction(record.nextAction);
  if (nextAction === undefined) {
    return failedParse("convergence_judgment:invalid_next_action", "Convergence Judge model output did not choose a legal nextAction.");
  }
  if (!Array.isArray(record.candidateDecisions)) {
    return failedParse("convergence_judgment:missing_candidate_decisions", "Convergence Judge model output did not include candidateDecisions.");
  }

  const candidateIds = new Set(percept.candidatePool.candidates.map((candidate) => candidate.id));
  const decisions = record.candidateDecisions.flatMap((item) => {
    const parsed = parseCandidateDecision(item, candidateIds);
    return parsed === undefined ? [] : [parsed];
  });
  const decisionIds = new Set(decisions.map((decision) => decision.candidateId));
  const missingCandidateIds = [...candidateIds].filter((candidateId) => !decisionIds.has(candidateId));
  if (missingCandidateIds.length > 0 || decisions.length !== candidateIds.size) {
    return failedParse(
      "convergence_judgment:incomplete_candidate_decisions",
      `Convergence Judge model output must decide every candidate; missing ${missingCandidateIds.join(", ") || "duplicate/invalid candidates"}.`
    );
  }
  if (nextAction === "request_user_clarification" && !decisions.some((decision) => decision.status === "unknown")) {
    return failedParse(
      "convergence_judgment:clarification_without_unknown_candidate",
      "Convergence Judge cannot request user clarification without marking at least one candidate unknown."
    );
  }
  if (nextAction === "approve_handoff" && !decisions.some((decision) => decision.status === "accepted" || decision.status === "merged")) {
    return failedParse(
      "convergence_judgment:approval_without_handoff_candidate",
      "Convergence Judge cannot approve handoff without accepted or merged candidates."
    );
  }
  if (
    (nextAction === "continue_exploration" || nextAction === "stop") &&
    decisions.some((decision) => decision.status === "accepted" || decision.status === "merged")
  ) {
    return failedParse(
      "convergence_judgment:non_handoff_action_with_handoff_candidates",
      "Convergence Judge cannot mark candidates accepted or merged when nextAction does not approve handoff."
    );
  }

  const summary = stringOrUndefined(record.overallDirectionSummary);
  const decisionSummary = stringOrUndefined(record.decisionSummary);
  if (summary === undefined || decisionSummary === undefined) {
    return failedParse(
      "convergence_judgment:missing_safe_summary",
      "Convergence Judge model output requires safe summary fields."
    );
  }

  return {
    ok: true,
    value: {
      judgmentId: `convergence-judgment:${percept.candidatePool.poolId}`,
      nextAction,
      recommendedOptionId: stringOrUndefined(record.recommendedOptionId),
      candidateDecisions: decisions,
      conflictsNeedingUserInput: stringArray(record.conflictsNeedingUserInput),
      constraintViolations: stringArray(record.constraintViolations),
      overallDirectionSummary: summary,
      decisionSummary,
      uncertainty: stringOrUndefined(record.uncertainty) ?? "No uncertainty summary provided by the model.",
    },
    decisionSummary,
    uncertainty: stringOrUndefined(record.uncertainty),
    confidence: numberOrUndefined(record.confidence),
  };
}

function parseCandidateDecision(
  value: unknown,
  candidateIds: ReadonlySet<string>
): ConvergenceJudgmentCandidateDecision | undefined {
  const record = asRecord(value);
  const candidateId = stringOrUndefined(record.candidateId);
  const status = parseCandidateStatus(record.status);
  const reason = stringOrUndefined(record.reason);
  if (candidateId === undefined || status === undefined || reason === undefined || !candidateIds.has(candidateId)) {
    return undefined;
  }
  return {
    candidateId,
    status,
    reason,
    evidenceRefs: stringArray(record.evidenceRefs),
    clarificationReason: parseClarificationReason(record.clarificationReason),
    contentDifference: stringOrUndefined(record.contentDifference),
    whyPreferred: stringOrUndefined(record.whyPreferred),
    conflictWith: stringArray(record.conflictWith),
    openQuestion: stringOrUndefined(record.openQuestion),
    blockingLevel: parseBlockingLevel(record.blockingLevel),
  };
}

function createFallbackConvergenceJudgment(
  percept: ConvergenceJudgePercept,
  reason: string
): ConvergenceJudgment {
  const safeReason = sanitizeUndergroundConvergenceAiAdvisoryText(reason);
  return {
    judgmentId: `convergence-judgment:fallback:${percept.candidatePool.poolId}`,
    nextAction: "stop",
    candidateDecisions: percept.candidatePool.candidates.map((candidate) => ({
      candidateId: candidate.id,
      status: "rejected",
      reason: safeReason || "Convergence Judge fallback cannot approve without AgentTurnRuntime.",
      evidenceRefs: candidate.sourceRefs,
      contentDifference: "Deterministic fallback lacks semantic convergence judgment.",
      whyPreferred: "Candidate is not promoted because AI convergence judgment is unavailable.",
      conflictWith: [],
    })),
    conflictsNeedingUserInput: [],
    constraintViolations: [],
    overallDirectionSummary:
      "Convergence Judge used deterministic fallback and stopped because no AI judgment was available for the convergence mainline.",
    decisionSummary: "Deterministic fallback stopped convergence instead of approving a handoff.",
    uncertainty: "AgentTurnRuntime is required before Convergence Judge can approve or merge candidates.",
  };
}

function parseNextAction(value: unknown): ConvergenceJudgmentNextAction | undefined {
  return value === "approve_handoff" ||
    value === "continue_exploration" ||
    value === "request_user_clarification" ||
    value === "stop"
    ? value
    : undefined;
}

function parseCandidateStatus(value: unknown): CandidateConvergenceStatus | undefined {
  return value === "accepted" || value === "merged" || value === "rejected" || value === "unknown"
    ? value
    : undefined;
}

function parseBlockingLevel(value: unknown): "blocking" | "non_blocking" | undefined {
  return value === "blocking" || value === "non_blocking" ? value : undefined;
}

function parseClarificationReason(value: unknown): UserClarificationReason | undefined {
  return value === "permission_boundary_unclear" ||
    value === "critical_fact_missing" ||
    value === "goal_conflict" ||
    value === "value_tradeoff_required" ||
    value === "hard_constraint_unclear"
    ? value
    : undefined;
}

function failedParse(
  reason: string,
  decisionSummary: string
): UndergroundReasoningParseResult<ConvergenceJudgment> {
  return {
    ok: false,
    reason,
    decisionSummary,
    uncertainty: "The model response passed generic validation but failed Convergence Judge structural parsing.",
    confidence: 0.18,
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
  const sanitized = sanitizeUndergroundConvergenceAiAdvisoryText(value);
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

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
