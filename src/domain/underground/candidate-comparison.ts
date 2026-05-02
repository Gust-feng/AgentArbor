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
  const comparisons = input.candidates.map((candidate) => {
    const rootletOutput = findRootletOutput(candidate, outputById);
    return compareCandidateForGoal({
      goalProfile: input.goalProfile,
      candidate,
      rootletOutput,
      createdAt: input.createdAt,
    });
  });
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
  createdAt: string;
}): CandidateComparison {
  const stopRequested = hasStopIntent(input.goalProfile);
  const permissionUnknown = input.goalProfile.unknowns.some((unknown) =>
    includesAny(unknown.toLowerCase(), ["permission", "权限", "hard constraint", "硬约束", "constraint", "约束"])
  );
  const comparisonId = evidenceId(input.goalProfile.goalId, `comparison:${input.candidate.id}`);
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
      return createComparison(input, {
        conclusion: "accept",
        goalMatch: "strong",
        evidenceSupport: input.rootletOutput.evidenceRefs.length > 0 ? "strong" : "partial",
        constraintImpact: "partial",
        riskLevel: "partial",
      });
    case "evidence":
      return createComparison(input, {
        conclusion: "accept",
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
        whyNot: ["Risk rootlet informs the handoff but is not itself a selectable direction."],
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
  }
): CandidateComparison {
  const comparisonId = evidenceId(input.goalProfile.goalId, `comparison:${input.candidate.id}`);
  return {
    comparisonId,
    candidateId: input.candidate.id,
    goalId: input.goalProfile.goalId,
    rootletOutputRef: input.rootletOutput.outputId,
    rootletKind: input.rootletOutput.kind,
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

function includesAny(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
