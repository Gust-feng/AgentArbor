export type TranscriptNodeCacheItem = {
  readonly nodeId: string;
  readonly runId: string;
  readonly sequence: number;
};

export type ConversationRunTurn = {
  readonly role: "user" | "assistant";
  readonly runId?: string;
};

export function mergeTranscriptNodesByRunId<T extends TranscriptNodeCacheItem>(
  previous: Record<string, readonly T[]>,
  runId: string | undefined,
  nodes: readonly T[]
): Record<string, readonly T[]> {
  const next = { ...previous };
  if (runId !== undefined) {
    next[runId] = nodes.filter((node) => node.runId === runId);
  }
  for (const node of nodes) {
    if (node.runId.length === 0) continue;
    next[node.runId] = mergeTranscriptNodeLists(next[node.runId] ?? [], [node]);
  }
  return next;
}

export function transcriptNodesForConversation<T extends TranscriptNodeCacheItem>(
  turns: readonly ConversationRunTurn[],
  byRunId: Record<string, readonly T[]>
): readonly T[] {
  return runIdsForConversation(turns).flatMap((runId) => byRunId[runId] ?? []);
}

export function runIdsForConversation(turns: readonly ConversationRunTurn[]): readonly string[] {
  const runIds = turns
    .filter((turn) => turn.role === "assistant")
    .map((turn) => turn.runId)
    .filter((runId): runId is string => runId !== undefined && runId.trim().length > 0);
  return Array.from(new Set(runIds));
}

function mergeTranscriptNodeLists<T extends TranscriptNodeCacheItem>(
  previous: readonly T[],
  incoming: readonly T[]
): readonly T[] {
  const byId = new Map<string, T>();
  for (const node of previous) byId.set(node.nodeId, node);
  for (const node of incoming) byId.set(node.nodeId, node);
  return [...byId.values()].sort((left, right) => left.sequence - right.sequence || left.nodeId.localeCompare(right.nodeId));
}
