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
  goalMatchBasis: string;
  evidenceSupport: CandidateComparisonLevel;
  evidenceSupportBasis: string;
  evidenceGaps: string[];
  constraintImpact: CandidateComparisonLevel;
  constraintImpactBasis: string;
  hardConstraintConflictRefs: string[];
  riskLevel: CandidateComparisonLevel;
  riskCoverage: string[];
  unknowns: string[];
  whyNot: string[];
  conclusion: CandidateComparisonConclusion;
  evidenceRefs: string[];
  createdAt: string;
  contentDifference?: string;
  whyPreferred?: string;
  conflictWith?: string[];
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
  const decisionByCandidateId = new Map(decisions.map((decision) => [decision.candidateId, decision]));
  const evidenceEntries = comparisons.flatMap((comparison) => {
    const decision = decisionByCandidateId.get(comparison.candidateId);
    return [
      createUndergroundEvidenceEntry({
        evidenceId: comparison.comparisonId,
        goalId: input.goalProfile.goalId,
        kind: "candidate_comparison",
        summary: [
          `Candidate ${comparison.candidateId} comparison concluded ${comparison.conclusion}.`,
          `goal=${comparison.goalMatch}: ${comparison.goalMatchBasis}`,
          `evidence=${comparison.evidenceSupport}: ${comparison.evidenceSupportBasis}`,
          `constraint=${comparison.constraintImpact}: ${comparison.constraintImpactBasis}`,
          `risk=${comparison.riskLevel}: ${comparison.riskCoverage.join("; ") || "no dedicated risk signal"}`,
        ].join(" "),
        sourceRefs: unique([comparison.rootletOutputRef, ...comparison.evidenceRefs.slice(1)]),
        createdAt: input.createdAt,
      }),
      createUndergroundEvidenceEntry({
        evidenceId: decision?.evidenceRefs[0] ?? evidenceId(input.goalProfile.goalId, `decision:${comparison.candidateId}`),
        goalId: input.goalProfile.goalId,
        kind: "convergence_decision",
        summary: `Candidate ${comparison.candidateId} is ${statusForConclusion(comparison.conclusion)} because ${decisionReason(comparison)}`,
        sourceRefs: unique([comparison.comparisonId, ...comparison.evidenceRefs, ...(decision?.provenanceRefs ?? [])]),
        createdAt: input.createdAt,
      }),
    ];
  });

  return { comparisons, decisions, evidenceEntries };
}

export function createConvergenceDecisionFromComparison(input: {
  comparison: CandidateComparison;
  candidate?: ExplorationCandidateRef;
  decidedByRole?: CandidateConvergenceDecision["decidedByRole"];
}): CandidateConvergenceDecision {
  const candidateSourceRefs = input.candidate?.sourceRefs ?? [input.comparison.rootletOutputRef];
  const status = statusForConclusion(input.comparison.conclusion);
  const decisionEvidenceRef = evidenceId(input.comparison.goalId, `decision:${input.comparison.candidateId}`);
  return {
    decisionId: decisionEvidenceRef,
    candidateId: input.comparison.candidateId,
    sourceCandidateRefs: [input.comparison.candidateId],
    status,
    decidedByRole: input.decidedByRole ?? "convergence_judge",
    reason: decisionReason(input.comparison),
    provenanceRefs: unique([...candidateSourceRefs, input.comparison.comparisonId, ...input.comparison.evidenceRefs]),
    evidenceRefs: unique([decisionEvidenceRef, input.comparison.comparisonId, ...input.comparison.evidenceRefs]),
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
    ...input.rootletOutput.sourceRefs,
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
      goalMatchBasis: "The raw goal explicitly asks Underground to stop or provides no viable direction.",
      evidenceSupport: "weak",
      evidenceSupportBasis: "Stop intent prevents positive direction evidence from being sufficient.",
      evidenceGaps: ["A stopped goal cannot produce an approved direction without new user input."],
      constraintImpact: "blocking",
      constraintImpactBasis: "Stop intent is treated as a hard boundary for convergence.",
      hardConstraintConflictRefs: hardConstraintConflictRefsFor(input.rootletOutput, "blocking"),
      riskLevel: "blocking",
      riskCoverage: ["The candidate would violate the user's stop intent."],
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
      goalMatchBasis: "The constraint rootlet matches the goal boundary but cannot approve it without clarification.",
      evidenceSupport: "partial",
      evidenceSupportBasis: "The goal exposes a permission or hard constraint signal, but the boundary remains unresolved.",
      evidenceGaps: input.goalProfile.unknowns,
      constraintImpact: "blocking",
      constraintImpactBasis: "A hard constraint or permission boundary is unclear enough to block approval.",
      hardConstraintConflictRefs: hardConstraintConflictRefsFor(input.rootletOutput, "blocking"),
      riskLevel: "blocking",
      riskCoverage: ["Permission or hard constraint ambiguity is retained as a blocking risk."],
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
    goalMatchBasis?: string;
    evidenceSupportBasis?: string;
    evidenceGaps?: readonly string[];
    constraintImpactBasis?: string;
    hardConstraintConflictRefs?: readonly string[];
    riskCoverage?: readonly string[];
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
    goalMatchBasis: decision.goalMatchBasis ?? goalMatchBasis(decision.goalMatch, input.rootletOutput, input.goalProfile),
    evidenceSupport: decision.evidenceSupport,
    evidenceSupportBasis:
      decision.evidenceSupportBasis ??
      evidenceSupportBasis(decision.evidenceSupport, input.rootletOutput, decision.extraEvidenceRefs ?? []),
    evidenceGaps: [...(decision.evidenceGaps ?? defaultEvidenceGaps(decision.evidenceSupport))],
    constraintImpact: decision.constraintImpact,
    constraintImpactBasis:
      decision.constraintImpactBasis ?? constraintImpactBasis(decision.constraintImpact, input.rootletOutput),
    hardConstraintConflictRefs: [
      ...(decision.hardConstraintConflictRefs ?? hardConstraintConflictRefsFor(input.rootletOutput, decision.constraintImpact)),
    ],
    riskLevel: decision.riskLevel,
    riskCoverage: [...(decision.riskCoverage ?? riskCoverage(decision.riskLevel, input.rootletOutput, input.goalProfile))],
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
    contentDifference: deterministicContentDifference(input.rootletOutput, input.goalProfile),
    whyPreferred: deterministicWhyPreferred(decision.conclusion, input.rootletOutput),
    conflictWith: deterministicConflictWith(input.rootletOutput, input.goalProfile),
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

function goalMatchBasis(
  level: CandidateComparisonLevel,
  output: RootletOutput,
  profile: GoalIntentProfile
): string {
  switch (level) {
    case "strong":
      return `The ${output.kind} rootlet summary directly supports ${profile.goalStatement}.`;
    case "partial":
      return `The ${output.kind} rootlet contributes context but is not sufficient as the primary direction.`;
    case "weak":
      return `The ${output.kind} rootlet is retained mainly as negative or alternative evidence.`;
    case "blocking":
      return `The ${output.kind} rootlet conflicts with the current goal or approval boundary.`;
  }
}

function evidenceSupportBasis(
  level: CandidateComparisonLevel,
  output: RootletOutput,
  extraEvidenceRefs: readonly string[]
): string {
  const supportingRefs = unique([...output.evidenceRefs, ...extraEvidenceRefs]);
  if (supportingRefs.length > 0) {
    return `${level} support from refs ${supportingRefs.join(", ")}.`;
  }
  return `${level} support because no dedicated evidence ref beyond the rootlet output is available.`;
}

function defaultEvidenceGaps(level: CandidateComparisonLevel): string[] {
  return level === "weak" || level === "blocking" ? ["Dedicated supporting evidence is insufficient."] : [];
}

function constraintImpactBasis(level: CandidateComparisonLevel, output: RootletOutput): string {
  const refs = output.constraintRefs.map((constraint) => constraint.constraintId);
  if (refs.length > 0) {
    return `${level} constraint impact from refs ${refs.join(", ")}.`;
  }
  return `${level} constraint impact inferred from goal and rootlet kind ${output.kind}.`;
}

function hardConstraintConflictRefsFor(
  output: RootletOutput,
  constraintImpact: CandidateComparisonLevel
): string[] {
  if (constraintImpact !== "blocking") {
    return [];
  }
  return output.constraintRefs
    .filter((constraint) => constraint.requiredLevel === "hard")
    .map((constraint) => constraint.constraintId);
}

function riskCoverage(
  level: CandidateComparisonLevel,
  output: RootletOutput,
  profile: GoalIntentProfile
): string[] {
  const refs = unique([...output.riskRefs, ...profile.riskHints]);
  if (refs.length > 0) {
    return [`${level} risk coverage from ${refs.join(", ")}.`];
  }
  return level === "weak" || level === "blocking"
    ? ["Risk coverage is insufficient for a selectable handoff direction."]
    : ["No blocking risk remains for this candidate."];
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

function deterministicContentDifference(output: RootletOutput, profile: GoalIntentProfile): string {
  const kindLabel = output.kind;
  if (kindLabel === "option") {
    return `This option proposes: ${truncate(output.summary, 100)}`;
  }
  if (kindLabel === "risk") {
    return `Risk analysis covering: ${truncate(output.summary, 100)}`;
  }
  if (kindLabel === "constraint") {
    return `Constraint boundary: ${truncate(output.summary, 100)}`;
  }
  return `${kindLabel} insight: ${truncate(output.summary, 100)}`;
}

function deterministicWhyPreferred(conclusion: CandidateComparisonConclusion, output: RootletOutput): string {
  switch (conclusion) {
    case "accept":
      return `Strongly matches the goal intent with ${output.evidenceRefs.length} supporting evidence refs.`;
    case "merge":
      return `Provides complementary context (${output.kind}) that strengthens the primary direction.`;
    case "needs_user":
      return "Requires user input to resolve an ambiguity before it can be accepted or rejected.";
    case "keep_unknown":
      return "Retained as open uncertainty for future resolution.";
    case "reject":
      return "Does not align with the current goal direction or violates constraints.";
  }
}

function deterministicConflictWith(output: RootletOutput, profile: GoalIntentProfile): string[] {
  const conflicts: string[] = [];
  for (const nonGoal of profile.nonGoals) {
    if (output.summary.toLowerCase().includes(nonGoal.toLowerCase().slice(0, 8))) {
      conflicts.push(`Non-goal overlap: ${nonGoal}`);
    }
  }
  for (const constraint of output.constraintRefs) {
    if (constraint.requiredLevel === "hard") {
      conflicts.push(`Hard constraint: ${constraint.constraintId}`);
    }
  }
  return conflicts;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
