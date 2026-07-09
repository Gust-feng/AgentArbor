import { mergeTranscriptNodeLists } from "./panel-transcript-node-identity.js";
import {
  type TranscriptNodeCacheItem,
} from "../../panel-ui-transcript-cache.js";

export type MaterializedConversationTranscript<T extends TranscriptNodeCacheItem> = {
  readonly conversationId?: string;
  readonly nodesByRunId: Readonly<Record<string, readonly T[]>>;
};

const emptyTranscriptNodes: readonly never[] = Object.freeze([]);

export function materializeConversationTranscript<T extends TranscriptNodeCacheItem>(input: {
  readonly previous?: MaterializedConversationTranscript<T>;
  readonly conversationId?: string;
  readonly cachedNodesByRunId: Readonly<Record<string, readonly T[]>>;
  readonly currentRunId?: string;
  readonly currentRunNodes: readonly T[];
}): MaterializedConversationTranscript<T> {
  const currentConversationNodes = mergeVisibleTranscriptNodesByRunId(
    input.cachedNodesByRunId,
    input.currentRunId,
    input.currentRunNodes,
  );
  const previousConversationNodes = input.previous !== undefined && input.previous.conversationId === input.conversationId
    ? input.previous.nodesByRunId
    : {};
  const nodesByRunId = mergeStickyTranscriptNodesByRunId(previousConversationNodes, currentConversationNodes);
  if (input.previous !== undefined && input.previous.conversationId === input.conversationId && nodesByRunId === input.previous.nodesByRunId) {
    return input.previous;
  }
  return {
    conversationId: input.conversationId,
    nodesByRunId,
  };
}

function mergeVisibleTranscriptNodesByRunId<T extends TranscriptNodeCacheItem>(
  cachedNodesByRunId: Readonly<Record<string, readonly T[]>>,
  currentRunId: string | undefined,
  currentRunNodes: readonly T[],
): Readonly<Record<string, readonly T[]>> {
  const grouped: Record<string, readonly T[]> = { ...cachedNodesByRunId };
  const currentNodesByRunId = new Map<string, T[]>();
  for (const node of currentRunNodes) {
    if (node.runId.length === 0) continue;
    if (currentRunId !== undefined && node.runId !== currentRunId && grouped[node.runId] === undefined) {
      grouped[node.runId] = [];
    }
    const nodes = currentNodesByRunId.get(node.runId) ?? [];
    nodes.push(node);
    currentNodesByRunId.set(node.runId, nodes);
  }
  for (const [runId, nodes] of currentNodesByRunId) {
    grouped[runId] = mergeTranscriptNodeLists(grouped[runId] ?? [], nodes);
  }
  return grouped;
}

export function stableTranscriptNodesByRunIdMap<T extends TranscriptNodeCacheItem>(
  previous: ReadonlyMap<string, readonly T[]> | undefined,
  next: Readonly<Record<string, readonly T[]>>,
): ReadonlyMap<string, readonly T[]> {
  const cached = previous ?? new Map<string, readonly T[]>();
  const entries = Object.entries(next);
  let changed = entries.length !== cached.size;
  const stable = new Map<string, readonly T[]>();
  for (const [runId, freshNodes] of entries) {
    const cachedNodes = cached.get(runId);
    if (cachedNodes !== undefined && transcriptNodeListsEqual(cachedNodes, freshNodes)) {
      stable.set(runId, cachedNodes);
      continue;
    }
    stable.set(runId, freshNodes);
    changed = true;
  }
  return changed ? stable : cached;
}

export function transcriptNodesForRunId<T>(
  grouped: ReadonlyMap<string, readonly T[]>,
  runId: string | undefined,
): readonly T[] {
  if (runId === undefined) {
    return emptyTranscriptNodes;
  }
  return grouped.get(runId) ?? emptyTranscriptNodes;
}

function transcriptNodeListsEqual<T>(
  left: readonly T[] | undefined,
  right: readonly T[] | undefined,
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function mergeStickyTranscriptNodesByRunId<T extends TranscriptNodeCacheItem>(
  previous: Readonly<Record<string, readonly T[]>>,
  next: Readonly<Record<string, readonly T[]>>,
): Readonly<Record<string, readonly T[]>> {
  const merged: Record<string, readonly T[]> = { ...previous };
  let changed = false;
  for (const [runId, nodes] of Object.entries(next)) {
    const previousNodes = merged[runId] ?? [];
    const nextNodes = mergeTranscriptNodeLists(previousNodes, nodes);
    if (transcriptNodeListsSemanticallyEqual(previousNodes, nextNodes)) {
      merged[runId] = previousNodes;
      continue;
    }
    merged[runId] = nextNodes;
    changed = true;
  }
  return changed ? merged : previous;
}

function transcriptNodeListsSemanticallyEqual<T extends TranscriptNodeCacheItem>(
  left: readonly T[],
  right: readonly T[],
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftNode = left[index];
    const rightNode = right[index];
    if (leftNode === undefined || rightNode === undefined || !transcriptNodesSemanticallyEqual(leftNode, rightNode)) {
      return false;
    }
  }
  return true;
}

function transcriptNodesSemanticallyEqual(
  left: TranscriptNodeCacheItem,
  right: TranscriptNodeCacheItem,
): boolean {
  return left.nodeId === right.nodeId &&
    left.runId === right.runId &&
    left.sequence === right.sequence &&
    left.eventType === right.eventType &&
    left.kind === right.kind &&
    left.phase === right.phase &&
    left.title === right.title &&
    left.summary === right.summary &&
    left.text === right.text &&
    left.timestamp === right.timestamp &&
    transcriptRefsSemanticallyEqual(left.refs ?? [], right.refs ?? []);
}

function transcriptRefsSemanticallyEqual(
  left: NonNullable<TranscriptNodeCacheItem["refs"]>,
  right: NonNullable<TranscriptNodeCacheItem["refs"]>,
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftRef = left[index];
    const rightRef = right[index];
    if (
      leftRef === undefined ||
      rightRef === undefined ||
      leftRef.kind !== rightRef.kind ||
      leftRef.id !== rightRef.id ||
      leftRef.label !== rightRef.label
    ) {
      return false;
    }
  }
  return true;
}
