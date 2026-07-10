import type { Constraint } from "../../../domain/contracts.js";
import {
  appendUndergroundEvidenceEntries,
  createUndergroundEvidenceEntry,
  createUndergroundEvidenceLedger,
  evidenceId,
  type GoalIntentProfile,
  type RootletOutput,
  type UndergroundConvergenceReport,
  type UndergroundEvidenceEntry,
  type UndergroundEvidenceLedger,
} from "../../../domain/underground/index.js";
import { createId } from "../../../kernel/id.js";

export function createMinimalUndergroundEvidenceLedger(input: {
  existingLedger?: UndergroundEvidenceLedger;
  goalIntentProfile: GoalIntentProfile;
  constraints: readonly Constraint[];
  rootletOutputs: readonly RootletOutput[];
  extraEntries?: readonly UndergroundEvidenceEntry[];
  createdAt: string;
}): UndergroundEvidenceLedger {
  const baseLedger =
    input.existingLedger ??
    createUndergroundEvidenceLedger({
      ledgerId: createId("evidence-ledger"),
      goalId: input.goalIntentProfile.goalId,
      entries: [
        createUndergroundEvidenceEntry({
          evidenceId: evidenceId(input.goalIntentProfile.goalId, "goal-intent"),
          goalId: input.goalIntentProfile.goalId,
          kind: "goal_intent",
          summary: input.goalIntentProfile.goalStatement,
          sourceRefs: ["goal.received"],
          createdAt: input.createdAt,
        }),
        ...input.constraints.map((constraint) =>
          createUndergroundEvidenceEntry({
            evidenceId: evidenceId(input.goalIntentProfile.goalId, `constraint:${constraint.id}`),
            goalId: input.goalIntentProfile.goalId,
            kind: "soil_constraint",
            summary: constraint.statement,
            sourceRefs: [constraint.id, ...constraint.evidenceRefs],
            createdAt: input.createdAt,
          })
        ),
      ],
      createdAt: input.createdAt,
    });
  const rootletEvidence = input.rootletOutputs.map((output) =>
    createUndergroundEvidenceEntry({
      evidenceId: rootletOutputEvidenceId(input.goalIntentProfile.goalId, output),
      goalId: input.goalIntentProfile.goalId,
      kind: "rootlet_output",
      summary: output.summary,
      sourceRefs: [output.outputId, ...output.sourceRefs],
      createdAt: input.createdAt,
    })
  );

  return appendUndergroundEvidenceEntries(
    baseLedger,
    [...rootletEvidence, ...(input.extraEntries ?? [])],
    input.createdAt
  );
}

function rootletOutputEvidenceId(goalId: string, output: RootletOutput): string {
  return (
    output.evidenceRefs.find((ref) => ref.includes(`:rootlet:${output.kind}:`)) ??
    output.evidenceRefs.find((ref) => ref === evidenceId(goalId, `rootlet:${output.kind}`)) ??
    evidenceId(goalId, `rootlet-output:${output.outputId}`)
  );
}

export function appendUndergroundConvergenceOutcomeEvidence(input: {
  ledger: UndergroundEvidenceLedger;
  convergenceReport: UndergroundConvergenceReport;
  createdAt: string;
}): UndergroundEvidenceLedger {
  return appendUndergroundEvidenceEntries(
    input.ledger,
    createConvergenceOutcomeEvidenceEntries(input.ledger.goalId, input.convergenceReport, input.createdAt),
    input.createdAt
  );
}

function createConvergenceOutcomeEvidenceEntries(
  goalId: string,
  report: UndergroundConvergenceReport,
  createdAt: string
): UndergroundEvidenceEntry[] {
  const entries: UndergroundEvidenceEntry[] = [];

  if (report.userClarificationRequest !== undefined) {
    entries.push(
      createUndergroundEvidenceEntry({
        evidenceId: evidenceId(goalId, `user-clarification:${report.userClarificationRequest.requestId}`),
        goalId,
        kind: "user_clarification",
        summary: `User clarification ${report.userClarificationRequest.requestId} is required for ${report.userClarificationRequest.relatedCandidateRefs.join(", ")}.`,
        sourceRefs: [
          report.reviewId,
          report.userClarificationRequest.requestId,
          ...report.userClarificationRequest.relatedCandidateRefs,
          ...report.userClarificationRequest.questions.map((question) => question.questionId),
          ...report.openQuestions.flatMap((question) => question.evidenceRefs),
        ],
        createdAt,
      })
    );
  }

  if (report.stopReason !== undefined) {
    entries.push(
      createUndergroundEvidenceEntry({
        evidenceId: evidenceId(goalId, `stop-reason:${report.stopReason}`),
        goalId,
        kind: "stop_reason",
        summary: `Convergence stopped with reason ${report.stopReason}.`,
        sourceRefs: [
          report.reviewId,
          ...report.unknownCandidateRefs,
          ...report.rejectedCandidateRefs,
          ...report.openQuestions.flatMap((question) => question.evidenceRefs),
        ],
        createdAt,
      })
    );
  }

  return entries;
}
