import type { ExplorationCandidateRef } from "./contracts.js";
import type { UndergroundEvidenceEntry } from "./evidence-ledger.js";
import { createUndergroundEvidenceEntry, evidenceId } from "./evidence-ledger.js";
import type { GoalIntentProfile } from "./intent-core.js";
import { hasStopIntent } from "./intent-core.js";
import type {
  CandidateConvergenceDecision,
  CandidateConvergenceStatus,
  RootletOutput,
} from "./radial-growth.js";

export type CandidateComparisonLevel = "strong" | "partial" | "weak" | "blocking";

export type CandidateComparisonConclusion = "accept" | "merge" | "reject" | "needs_user" | "keep_unknown";

export type CandidateComparison = {
  comparisonId: string;
  candidateId: string;
  goalId: string;
  rootletOutputRef: string;
  rootletKind: RootletOutput["kind"];
  candidateSummary: string;
  goalMatch: CandidateComparisonLevel;
  evidenceSupport: CandidateComparisonLevel;
  constraintImpact: CandidateComparisonLevel;
  riskLevel: CandidateComparisonLevel;
  unknowns: string[];
  whyNot: string[];
  conclusion: CandidateComparisonConclusion;
  evidenceRefs: string[];
  createdAt: string;
};

export type CandidateComparisonResult = {
  comparisons: CandidateComparison[];
  decisions: CandidateConvergenceDecision[];
  evidenceEntries: UndergroundEvidenceEntry[];
};

export function compareCandidatesForGoal(input: {
  goalProfile: GoalIntentProfile;
  candidates: readonly ExplorationCandidateRef[];
  rootletOutputs: readonly RootletOutput[];
  decidedByRole?: CandidateConvergenceDecision["decidedByRole"];
  createdAt: string;
}): CandidateComparisonResult {
  const outputById = new Map(input.rootletOutputs.map((output) => [output.outputId, output]));
  const candidateContexts = input.candidates.map((candidate, index) => {
    const rootletOutput = findRootletOutput(candidate, outputById);
    return { candidate, rootletOutput, index };
  });
  const comparisons = candidateContexts.map(({ candidate, rootletOutput, index }) =>
    compareCandidateForGoal({
      goalProfile: input.goalProfile,
      candidate,
      rootletOutput,
      candidateIndex: index,
      optionCandidateIds: candidateContexts
        .filter((context) => context.rootletOutput.kind === "option")
        .map((context) => context.candidate.id),
      evidenceCandidateRefs: candidateContexts
        .filter((context) => context.rootletOutput.kind === "evidence")
        .flatMap((context) => [context.candidate.id, ...context.rootletOutput.evidenceRefs]),
      createdAt: input.createdAt,
    })
  );
  const decisions = comparisons.map((comparison) =>
    createConvergenceDecisionFromComparison({
      comparison,
      candidate: input.candidates.find((candidate) => candidate.id === comparison.candidateId),
      decidedByRole: input.decidedByRole ?? "convergence_judge",
    })
  );
  const evidenceEntries = comparisons.flatMap((comparison) => [
    createUndergroundEvidenceEntry({
      evidenceId: comparison.evidenceRefs[0] ?? evidenceId(input.goalProfile.goalId, `comparison:${comparison.candidateId}`),
      goalId: input.goalProfile.goalId,
      kind: "candidate_comparison",
      summary: `Candidate ${comparison.candidateId} comparison concluded ${comparison.conclusion}.`,
      sourceRefs: [comparison.rootletOutputRef, ...comparison.evidenceRefs.slice(1)],
      createdAt: input.createdAt,
    }),
    createUndergroundEvidenceEntry({
      evidenceId: evidenceId(input.goalProfile.goalId, `decision:${comparison.candidateId}`),
      goalId: input.goalProfile.goalId,
      kind: "convergence_decision",
      summary: `Candidate ${comparison.candidateId} is ${statusForConclusion(comparison.conclusion)}.`,
      sourceRefs: [comparison.comparisonId],
      createdAt: input.createdAt,
    }),
  ]);

  return { comparisons, decisions, evidenceEntries };
}

export function createConvergenceDecisionFromComparison(input: {
  comparison: CandidateComparison;
  candidate?: ExplorationCandidateRef;
  decidedByRole?: CandidateConvergenceDecision["decidedByRole"];
}): CandidateConvergenceDecision {
  const candidateSourceRefs = input.candidate?.sourceRefs ?? [input.comparison.rootletOutputRef];
  const status = statusForConclusion(input.comparison.conclusion);
  return {
    decisionId: evidenceId(input.comparison.goalId, `decision:${input.comparison.candidateId}`),
    candidateId: input.comparison.candidateId,
    sourceCandidateRefs: [input.comparison.candidateId],
    status,
    decidedByRole: input.decidedByRole ?? "convergence_judge",
    reason: decisionReason(input.comparison),
    provenanceRefs: [...candidateSourceRefs, input.comparison.comparisonId],
    evidenceRefs: [evidenceId(input.comparison.goalId, `decision:${input.comparison.candidateId}`)],
  };
}

export function compareCandidateForGoal(input: {
  goalProfile: GoalIntentProfile;
  candidate: ExplorationCandidateRef;
  rootletOutput: RootletOutput;
  candidateIndex?: number;
  optionCandidateIds?: readonly string[];
  evidenceCandidateRefs?: readonly string[];
  createdAt: string;
}): CandidateComparison {
  const stopRequested = hasStopIntent(input.goalProfile);
  const permissionUnknown = input.goalProfile.unknowns.some((unknown) =>
    includesAny(unknown.toLowerCase(), ["permission", "权限", "hard constraint", "硬约束", "constraint", "约束"])
  );
  const comparisonId = evidenceId(input.goalProfile.goalId, `comparison:${input.candidate.id}`);
  const optionCandidateIds = input.optionCandidateIds ?? [];
  const optionOrdinal = input.rootletOutput.kind === "option" ? optionCandidateIds.indexOf(input.candidate.id) : -1;
  const evidenceCandidateRefs = input.evidenceCandidateRefs ?? [];
  const baseEvidenceRefs = [
    comparisonId,
    ...input.rootletOutput.evidenceRefs,
    ...input.rootletOutput.constraintRefs.map((constraint) => `constraint:${constraint.constraintId}`),
  ];

  if (stopRequested) {
    return {
      comparisonId,
      candidateId: input.candidate.id,
      goalId: input.goalProfile.goalId,
      rootletOutputRef: input.rootletOutput.outputId,
      rootletKind: input.rootletOutput.kind,
      candidateSummary: input.rootletOutput.summary,
      goalMatch: "blocking",
      evidenceSupport: "weak",
      constraintImpact: "blocking",
      riskLevel: "blocking",
      unknowns: [],
      whyNot: ["The goal explicitly asks Underground to stop or declares no viable candidate."],
      conclusion: "reject",
      evidenceRefs: unique(baseEvidenceRefs),
      createdAt: input.createdAt,
    };
  }

  if (permissionUnknown && input.rootletOutput.kind === "constraint") {
    return {
      comparisonId,
      candidateId: input.candidate.id,
      goalId: input.goalProfile.goalId,
      rootletOutputRef: input.rootletOutput.outputId,
      rootletKind: input.rootletOutput.kind,
      candidateSummary: input.rootletOutput.summary,
      goalMatch: "partial",
      evidenceSupport: "partial",
      constraintImpact: "blocking",
      riskLevel: "blocking",
      unknowns: input.goalProfile.unknowns,
      whyNot: ["The hard constraint or permission boundary is not clear enough for approved handoff."],
      conclusion: "needs_user",
      evidenceRefs: unique(baseEvidenceRefs),
      createdAt: input.createdAt,
    };
  }

  switch (input.rootletOutput.kind) {
    case "option":
      if (optionConflictsWithGoalBoundaries(input.rootletOutput.summary, input.goalProfile)) {
        return createComparison(input, {
          conclusion: "reject",
          goalMatch: "weak",
          evidenceSupport: evidenceCandidateRefs.length > 0 ? "partial" : "weak",
          constraintImpact: "blocking",
          riskLevel: "blocking",
          whyNot: ["The option conflicts with a non-goal or hard constraint boundary in the goal profile."],
          extraEvidenceRefs: evidenceCandidateRefs,
        });
      }
      return createComparison(input, {
        conclusion: optionOrdinal <= 0 ? "accept" : "merge",
        goalMatch: "strong",
        evidenceSupport: evidenceCandidateRefs.length > 0 || input.rootletOutput.evidenceRefs.length > 0 ? "strong" : "partial",
        constraintImpact: "partial",
        riskLevel: "partial",
        whyNot: optionOrdinal > 0 ? ["Compatible option variant is merged into the recommended direction."] : [],
        extraEvidenceRefs: evidenceCandidateRefs,
      });
    case "evidence":
      return createComparison(input, {
        conclusion: optionCandidateIds.length > 0 ? "merge" : "accept",
        goalMatch: "strong",
        evidenceSupport: "strong",
        constraintImpact: "partial",
        riskLevel: "partial",
      });
    case "asset_fit":
    case "constraint":
      return createComparison(input, {
        conclusion: "merge",
        goalMatch: "partial",
        evidenceSupport: "partial",
        constraintImpact: "strong",
        riskLevel: "partial",
      });
    case "risk":
      return createComparison(input, {
        conclusion: input.goalProfile.riskHints.length > 0 ? "keep_unknown" : "reject",
        goalMatch: "partial",
        evidenceSupport: "partial",
        constraintImpact: "partial",
        riskLevel: input.goalProfile.riskHints.length > 0 ? "strong" : "partial",
        unknowns: input.goalProfile.riskHints.length > 0 ? input.goalProfile.riskHints : [],
        whyNot: [
          optionCandidateIds.length > 0
            ? `Risk rootlet covers option candidates ${optionCandidateIds.join(", ")} but is not itself a selectable direction.`
            : "Risk rootlet has no option candidate to cover.",
        ],
        extraEvidenceRefs: optionCandidateIds,
      });
    case "counterfactual":
      return createComparison(input, {
        conclusion: "reject",
        goalMatch: "weak",
        evidenceSupport: "partial",
        constraintImpact: "partial",
        riskLevel: "partial",
        whyNot: ["Counterfactual rootlet is retained as why-not evidence, not a first handoff path."],
      });
  }
}

function createComparison(
  input: {
    goalProfile: GoalIntentProfile;
    candidate: ExplorationCandidateRef;
    rootletOutput: RootletOutput;
    createdAt: string;
  },
  decision: {
    conclusion: CandidateComparisonConclusion;
    goalMatch: CandidateComparisonLevel;
    evidenceSupport: CandidateComparisonLevel;
    constraintImpact: CandidateComparisonLevel;
    riskLevel: CandidateComparisonLevel;
    unknowns?: readonly string[];
    whyNot?: readonly string[];
    extraEvidenceRefs?: readonly string[];
  }
): CandidateComparison {
  const comparisonId = evidenceId(input.goalProfile.goalId, `comparison:${input.candidate.id}`);
  return {
    comparisonId,
    candidateId: input.candidate.id,
    goalId: input.goalProfile.goalId,
    rootletOutputRef: input.rootletOutput.outputId,
    rootletKind: input.rootletOutput.kind,
    candidateSummary: input.rootletOutput.summary,
    goalMatch: decision.goalMatch,
    evidenceSupport: decision.evidenceSupport,
    constraintImpact: decision.constraintImpact,
    riskLevel: decision.riskLevel,
    unknowns: [...(decision.unknowns ?? [])],
    whyNot: [...(decision.whyNot ?? [])],
    conclusion: decision.conclusion,
    evidenceRefs: unique([
      comparisonId,
      ...input.rootletOutput.evidenceRefs,
      ...input.rootletOutput.sourceRefs,
      ...(decision.extraEvidenceRefs ?? []),
    ]),
    createdAt: input.createdAt,
  };
}

function findRootletOutput(
  candidate: ExplorationCandidateRef,
  outputById: ReadonlyMap<string, RootletOutput>
): RootletOutput {
  for (const sourceRef of candidate.sourceRefs) {
    const output = outputById.get(sourceRef);
    if (output !== undefined) {
      return output;
    }
  }
  throw new Error(`Candidate ${candidate.id} does not reference a known rootlet output.`);
}

function statusForConclusion(conclusion: CandidateComparisonConclusion): CandidateConvergenceStatus {
  switch (conclusion) {
    case "accept":
      return "accepted";
    case "merge":
      return "merged";
    case "needs_user":
    case "keep_unknown":
      return "unknown";
    case "reject":
      return "rejected";
  }
}

function decisionReason(comparison: CandidateComparison): string {
  switch (comparison.conclusion) {
    case "accept":
      return `Candidate ${comparison.candidateId} directly matches the goal and has enough evidence for handoff.`;
    case "merge":
      return `Candidate ${comparison.candidateId} supports the retained direction as constraint, asset, or evidence context.`;
    case "needs_user":
      return `Candidate ${comparison.candidateId} has a blocking unknown that requires user clarification.`;
    case "keep_unknown":
      return `Candidate ${comparison.candidateId} remains an open unknown and is excluded from handoff candidates.`;
    case "reject":
      return comparison.whyNot[0] ?? `Candidate ${comparison.candidateId} does not support the current handoff direction.`;
  }
}

function optionConflictsWithGoalBoundaries(summary: string, profile: GoalIntentProfile): boolean {
  const normalizedSummary = summary.toLowerCase();
  const boundaryTexts = [
    ...profile.nonGoals,
    ...profile.constraintHints.filter((hint) => hint.includes("hard_constraint") || hint.includes("硬约束")),
  ];
  const forbiddenTerms = unique(boundaryTexts.flatMap(extractBoundaryTokens));
  return forbiddenTerms.some((term) => term.length > 0 && summaryAffirmsForbiddenTerm(normalizedSummary, term));
}

function summaryAffirmsForbiddenTerm(normalizedSummary: string, term: string): boolean {
  let startIndex = normalizedSummary.indexOf(term);
  while (startIndex >= 0) {
    const prefix = normalizedSummary.slice(Math.max(0, startIndex - 18), startIndex);
    if (!hasNegationMarker(prefix)) {
      return true;
    }
    startIndex = normalizedSummary.indexOf(term, startIndex + term.length);
  }
  return false;
}

function hasNegationMarker(value: string): boolean {
  return [
    "without",
    "do not",
    "don't",
    "must not",
    "no ",
    "不要",
    "不需要",
    "不新增",
    "不接",
    "不能",
    "禁止",
  ].some((marker) => value.includes(marker));
}

function extractBoundaryTokens(value: string): string[] {
  const normalized = value.toLowerCase();
  const englishStopWords = new Set([
    "and",
    "but",
    "can",
    "cannot",
    "constraint",
    "do",
    "goal",
    "hard",
    "must",
    "need",
    "not",
    "the",
    "use",
    "with",
    "without",
  ]);
  const english = normalized.match(/[a-z][a-z0-9_-]{2,}/g) ?? [];
  const chineseBoundaryTerms = ["数据库", "前端", "后端", "真实模型", "外部依赖", "持久化", "网络", "权限", "资产"];
  return [
    ...english.filter((token) => !englishStopWords.has(token)),
    ...chineseBoundaryTerms.filter((term) => normalized.includes(term)),
  ];
}

function includesAny(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
