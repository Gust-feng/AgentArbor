export type UndergroundEvidenceKind =
  | "goal_intent"
  | "soil_constraint"
  | "rootlet_output"
  | "candidate_comparison"
  | "convergence_decision"
  | "user_clarification"
  | "stop_reason";

export type UndergroundEvidenceEntry = {
  evidenceId: string;
  goalId: string;
  kind: UndergroundEvidenceKind;
  summary: string;
  sourceRefs: string[];
  createdAt: string;
};

export type UndergroundEvidenceLedger = {
  ledgerId: string;
  goalId: string;
  entries: UndergroundEvidenceEntry[];
  createdAt: string;
  updatedAt: string;
};

export function createUndergroundEvidenceLedger(input: {
  ledgerId: string;
  goalId: string;
  entries?: readonly UndergroundEvidenceEntry[];
  createdAt: string;
}): UndergroundEvidenceLedger {
  return {
    ledgerId: input.ledgerId,
    goalId: input.goalId,
    entries: cloneEntries(input.entries ?? []),
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

export function appendUndergroundEvidenceEntries(
  ledger: UndergroundEvidenceLedger,
  entries: readonly UndergroundEvidenceEntry[],
  updatedAt: string
): UndergroundEvidenceLedger {
  const existingIds = new Set(ledger.entries.map((entry) => entry.evidenceId));
  const nextEntries = [...ledger.entries];
  for (const entry of entries) {
    if (existingIds.has(entry.evidenceId)) {
      continue;
    }
    nextEntries.push(cloneEntry(entry));
    existingIds.add(entry.evidenceId);
  }

  return {
    ...ledger,
    entries: nextEntries,
    updatedAt,
  };
}

export function createUndergroundEvidenceEntry(input: {
  evidenceId: string;
  goalId: string;
  kind: UndergroundEvidenceKind;
  summary: string;
  sourceRefs?: readonly string[];
  createdAt: string;
}): UndergroundEvidenceEntry {
  return {
    evidenceId: input.evidenceId,
    goalId: input.goalId,
    kind: input.kind,
    summary: input.summary,
    sourceRefs: [...(input.sourceRefs ?? [])],
    createdAt: input.createdAt,
  };
}

export function evidenceId(goalId: string, localName: string): string {
  return `evidence:${sanitize(goalId)}:${sanitize(localName)}`;
}

export function cloneUndergroundEvidenceLedger(ledger: UndergroundEvidenceLedger): UndergroundEvidenceLedger {
  return {
    ...ledger,
    entries: cloneEntries(ledger.entries),
  };
}

function cloneEntries(entries: readonly UndergroundEvidenceEntry[]): UndergroundEvidenceEntry[] {
  return entries.map(cloneEntry);
}

function cloneEntry(entry: UndergroundEvidenceEntry): UndergroundEvidenceEntry {
  return {
    ...entry,
    sourceRefs: [...entry.sourceRefs],
  };
}

function sanitize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
