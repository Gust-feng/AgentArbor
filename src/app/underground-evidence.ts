import type { Constraint } from "../domain/contracts.js";
import {
  appendUndergroundEvidenceEntries,
  createUndergroundEvidenceEntry,
  createUndergroundEvidenceLedger,
  evidenceId,
  type GoalIntentProfile,
  type RootletOutput,
  type UndergroundEvidenceEntry,
  type UndergroundEvidenceLedger,
} from "../domain/underground/index.js";
import { createId } from "../kernel/id.js";

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
      evidenceId: evidenceId(input.goalIntentProfile.goalId, `rootlet:${output.kind}`),
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
