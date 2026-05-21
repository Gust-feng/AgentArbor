import type { DirectionHandoff } from "../../underground/contracts.js";
import type { UndergroundConvergenceReport } from "../../underground/radial-growth.js";
import type { DirectionHandoffPackage, DirectionHandoffPackageFilePath } from "./contracts.js";

export function serializeDirectionHandoffPackageFiles(
  pkg: DirectionHandoffPackage
): Record<DirectionHandoffPackageFilePath, string> {
  return {
    // V0.2 treats handoff.meta.json as the canonical payload; split files are rendered views.
    "handoff.meta.json": `${JSON.stringify(pkg, null, 2)}\n`,
    "direction.md": renderDirection(pkg.directionHandoff),
    "options.json": `${JSON.stringify(pkg.directionHandoff.options, null, 2)}\n`,
    "decision-record.md": renderDecisionRecord(pkg.directionHandoff),
    "constraints.json": `${JSON.stringify(
      {
        constraintRefs: pkg.directionHandoff.constraintRefs,
        candidateConstraintRefs: pkg.directionHandoff.candidateConstraintRefs,
      },
      null,
      2
    )}\n`,
    "soil-refs.json": `${JSON.stringify({ soilRefs: pkg.directionHandoff.soilRefs }, null, 2)}\n`,
    "evidence-index.md": renderEvidenceIndex(pkg),
    "risk-register.md": renderRiskRegister(pkg.directionHandoff),
    "open-questions.md": renderOpenQuestions(pkg),
    "escalation-rules.md": renderEscalationRules(pkg),
    "growth-entry.json": `${JSON.stringify(pkg.directionHandoff.growthEntry, null, 2)}\n`,
  };
}

function renderDirection(handoff: DirectionHandoff): string {
  const retainedOption = handoff.options.find((option) => option.optionId === handoff.decisionRecord.retainedOptionId);
  return `# Plan

## Source Goal
- sourceGoalId: ${handoff.sourceGoalId}
- rawUserInputRef: ${handoff.rawUserInputRef}

## Clarified Goal
${handoff.clarifiedGoal}

## Recommended Direction
${retainedOption?.directionSummary ?? handoff.options[0]?.directionSummary ?? "No retained option is available."}

## Aboveground Handoff Notes
- recommendedOptionId: ${handoff.recommendedOptionId ?? "none"}
- sourceCandidateRefs: ${handoff.sourceCandidateRefs.map((candidate) => candidate.id).join(", ") || "none"}
- convergenceReviewRef: ${handoff.convergenceReviewRef}
- allowedRuntimeShapes: ${handoff.growthEntry.allowedRuntimeShapes.join(", ") || "none"}

## Non Goals
${markdownList(handoff.nonGoals)}

## Assumptions
${markdownList(handoff.assumptions)}

## Risks
${markdownList(handoff.risks)}
`;
}

function renderDecisionRecord(handoff: DirectionHandoff): string {
  const retainedOption = handoff.options.find((option) => option.optionId === handoff.decisionRecord.retainedOptionId);
  return `# Decision Record

- retainedOptionId: ${handoff.decisionRecord.retainedOptionId}
- mergedOptionIds: ${handoff.decisionRecord.mergedOptionIds.join(", ") || "none"}
- rejectedOptionIds: ${handoff.decisionRecord.rejectedOptionIds.join(", ") || "none"}
- userDecisionRequired: ${handoff.decisionRecord.userDecisionRequired.join(", ") || "none"}
- abovegroundReferenceOptionIds: ${handoff.decisionRecord.abovegroundReferenceOptionIds.join(", ") || "none"}

## Retained Direction
${retainedOption?.directionSummary ?? "No retained direction summary is available."}

## Rationale Evidence Refs
${markdownList(handoff.decisionRecord.rationaleEvidenceRefs)}

## Rationale Constraint Refs
${markdownList(handoff.decisionRecord.rationaleConstraintRefs)}

## Rationale Risk Refs
${markdownList(handoff.decisionRecord.rationaleRiskRefs)}
`;
}

function renderEvidenceIndex(pkg: DirectionHandoffPackage): string {
  const handoff = pkg.directionHandoff;
  const convergenceReview = pkg.convergenceReview as Partial<UndergroundConvergenceReport>;
  const comparisons = convergenceReview.candidateComparisons ?? [];
  const decisions = convergenceReview.decisions ?? [];
  return `# Evidence Index

## Direction Evidence Refs
${markdownList(handoff.evidenceRefs)}

## Source Candidates
${markdownList(
  handoff.sourceCandidateRefs.map((candidate) =>
    `${candidate.id} (${candidate.status}, ${candidate.kind}) ${candidate.summary ?? "no summary"} from ${candidate.sourceRefs.join(", ") || "none"}`
  )
)}

## Candidate Comparisons
${markdownList(
  comparisons.map((comparison) =>
    `${comparison.comparisonId}: ${comparison.candidateId} -> ${comparison.conclusion}; refs ${comparison.evidenceRefs.join(", ") || "none"}`
  )
)}

## Convergence Decisions
${markdownList(
  decisions.map((decision) =>
    `${decision.decisionId}: ${decision.candidateId} -> ${decision.status}; refs ${decision.evidenceRefs.join(", ")}`
  )
)}

## Candidate Reference Index
${markdownList(
  pkg.candidateReferenceIndex.map((candidate) =>
    `${candidate.candidateId}: convergence ${candidate.convergenceReviewRef}; source refs ${candidate.sourceRefs.join(", ") || "none"}`
  )
)}
`;
}

function renderRiskRegister(handoff: DirectionHandoff): string {
  const risks = handoff.riskRegister.map(
    (risk) => [
      `- ${risk.riskId}: ${risk.name} (${risk.blockingLevel})`,
      `  - source: ${risk.source}`,
      `  - impactScope: ${risk.impactScope.join(", ") || "none"}`,
      `  - evidenceRefs: ${risk.evidenceRefs.join(", ") || "none"}`,
      `  - mitigation: ${risk.mitigation.join("; ") || "none"}`,
    ].join("\n")
  );
  return `# Risk Register

${risks.length > 0 ? risks.join("\n") : [
  "- no-promoted-risk: No blocking risks were promoted during convergence.",
  "  - source: convergence_review.completed",
  "  - impactScope: underground_center, agentarbor_handoff, aboveground_center",
  "  - evidenceRefs: none",
  "  - mitigation: Keep convergence evidence, open questions, and validation results visible during planning.",
].join("\n")}
`;
}

function renderOpenQuestions(pkg: DirectionHandoffPackage): string {
  const convergenceReview = pkg.convergenceReview as Partial<UndergroundConvergenceReport>;
  const openQuestions = convergenceReview.openQuestions ?? [];
  const entries = [
    ...pkg.directionHandoff.missingInformation.map((question) => `handoff: ${question}`),
    ...openQuestions.map((question) =>
      `${question.candidateId} [${question.blockingLevel}/${question.disposition}]: ${question.question} evidence=${question.evidenceRefs.join(", ") || "none"}`
    ),
  ];
  return `# Open Questions

${entries.length > 0 ? entries.map((entry) => `- ${entry}`).join("\n") : "- No blocking open questions; validate assumptions during Aboveground planning."}
`;
}

function renderEscalationRules(pkg: DirectionHandoffPackage): string {
  const convergenceReview = pkg.convergenceReview as Partial<UndergroundConvergenceReport>;
  const entries = [
    ...pkg.directionHandoff.growthEntry.escalationRules,
    ...(convergenceReview.stopReason === undefined ? [] : [`Convergence stop reason: ${convergenceReview.stopReason}`]),
    ...(convergenceReview.userClarificationRequest === undefined
      ? []
      : [`User clarification required: ${convergenceReview.userClarificationRequest.requestId}`]),
  ];
  return `# Escalation Rules

${markdownList(entries)}
`;
}

function markdownList(entries: string[]): string {
  return entries.length > 0 ? entries.map((entry) => `- ${entry}`).join("\n") : "- none";
}
