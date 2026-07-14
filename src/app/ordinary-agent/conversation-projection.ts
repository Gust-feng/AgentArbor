import type {
  OrdinaryConversationControlDocument,
  OrdinaryConversationReadModel,
  OrdinaryRunState,
} from "./contracts.js";

export function visibleOrdinaryConversationRuns(
  control: OrdinaryConversationControlDocument,
  allRuns: readonly OrdinaryRunState[],
): readonly OrdinaryRunState[] {
  const conversationRuns = allRuns.filter((run) => run.turn.conversationId === control.state.conversationId);
  const byId = new Map(conversationRuns.map((run) => [run.runId, run]));
  const activeLineage = control.state.lineages.find((lineage) => lineage.lineageId === control.state.activeLineageId);
  if (activeLineage === undefined) throw new Error(`Ordinary conversation ${control.state.conversationId} active lineage was not found`);
  const ancestors: OrdinaryRunState[] = [];
  let cursor = activeLineage.forkFromRunId;
  const seen = new Set<string>();
  while (cursor !== undefined) {
    if (seen.has(cursor)) throw new Error(`Ordinary conversation ${control.state.conversationId} contains a run cycle`);
    seen.add(cursor);
    const run = byId.get(cursor);
    if (run === undefined) throw new Error(`Ordinary conversation fork run ${cursor} was not found`);
    ancestors.push(run);
    cursor = run.turn.predecessorRunId;
  }
  ancestors.reverse();
  const current = conversationRuns
    .filter((run) => run.turn.lineageId === activeLineage.lineageId)
    .sort((left, right) => left.turn.ordinal - right.turn.ordinal);
  let predecessor = ancestors.at(-1)?.runId;
  for (const run of current) {
    if (run.turn.predecessorRunId !== predecessor) {
      throw new Error(`Ordinary conversation lineage ${activeLineage.lineageId} is not contiguous`);
    }
    predecessor = run.runId;
  }
  return [...ancestors, ...current];
}

export function projectOrdinaryConversation(input: {
  readonly control: OrdinaryConversationControlDocument;
  readonly runs: readonly OrdinaryRunState[];
}): OrdinaryConversationReadModel | undefined {
  if (input.control.state.deletedAt !== undefined || input.runs.length === 0) return undefined;
  const activeLineage = input.control.state.lineages.find((lineage) => lineage.lineageId === input.control.state.activeLineageId);
  if (activeLineage === undefined) throw new Error(`Ordinary conversation ${input.control.state.conversationId} active lineage was not found`);
  const first = input.runs[0]!;
  const latest = input.runs.at(-1)!;
  const active = input.runs.find((run) => run.status.kind === "running" || run.status.kind === "awaiting_approval");
  const queued = input.runs.filter((run) => run.status.kind === "queued").map((run) => run.runId);
  const updatedAt = input.runs.reduce(
    (latestTime, run) => run.timestamps.updatedAt.localeCompare(latestTime) > 0 ? run.timestamps.updatedAt : latestTime,
    input.control.savedAt,
  );
  return {
    conversationId: input.control.state.conversationId,
    title: input.control.state.titleOverride ?? compactTitle(first.input.userMessage),
    titleEditedAt: input.control.state.titleEditedAt,
    pinnedAt: input.control.state.pinnedAt,
    createdAt: input.control.state.createdAt,
    updatedAt,
    activeLineage: structuredClone(activeLineage),
    activeRunId: active?.runId,
    latestRunId: latest.runId,
    queuedRunIds: queued,
    turns: input.runs.flatMap((run) => [{
      role: "user" as const,
      turnId: run.turn.userTurnId,
      runId: run.runId,
      content: run.input.userMessage,
      input: structuredClone(run.input),
      status: run.status.kind === "queued" ? "pending" as const : "completed" as const,
      createdAt: run.timestamps.createdAt,
      updatedAt: run.timestamps.updatedAt,
    }, {
      role: "assistant" as const,
      turnId: run.turn.assistantTurnId,
      runId: run.runId,
      content: assistantContent(run),
      status: run.status.kind,
      model: structuredClone(run.birth.config),
      createdAt: run.timestamps.createdAt,
      updatedAt: run.timestamps.updatedAt,
    }]),
  };
}

export function normalizeOrdinaryConversationTitle(value: string): string {
  const title = value.replace(/\s+/gu, " ").trim();
  if (title.length === 0) throw new Error("Ordinary conversation title cannot be empty");
  return compactTitle(title);
}

function compactTitle(value: string): string {
  const title = value.replace(/\s+/gu, " ").trim();
  return title.length <= 80 ? title : `${title.slice(0, 79)}…`;
}

function assistantContent(run: OrdinaryRunState): string {
  switch (run.status.kind) {
    case "completed": return run.status.answer;
    case "failed": return run.status.error.message;
    case "cancelled": return run.status.reason;
    case "blocked": return run.status.reason.message;
    default: return "";
  }
}
