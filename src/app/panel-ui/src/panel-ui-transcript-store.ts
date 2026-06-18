/**
 * External transcript node cache for historical runs.
 *
 * Historical transcript nodes are stored OUTSIDE React's app state so that
 * loading them does NOT trigger a full App → ChatActive → TranscriptChain
 * re-render cascade.  Only the TranscriptChain component subscribes to this
 * cache via useSyncExternalStore, keeping the rest of the UI stable during
 * background conversation loading.
 */
import type { TranscriptNode } from "./contracts/run";
import {
  resetConversationTranscriptNodes,
  transcriptNodesByRunIdForConversation,
  updateConversationTranscriptNodes,
  type TranscriptNodesByConversationId,
} from "../../panel-ui-transcript-cache";

export type TranscriptNodesCache = Readonly<Record<string, readonly TranscriptNode[]>>;
export type TranscriptNodesStoreSnapshot = {
  readonly nodesByConversationId: TranscriptNodesByConversationId<TranscriptNode>;
};

let cache: TranscriptNodesStoreSnapshot = {
  nodesByConversationId: {},
};
const listenersByConversationId = new Map<string | undefined, Set<() => void>>();

export function getTranscriptNodesCache(): TranscriptNodesStoreSnapshot {
  return cache;
}

export function transcriptNodesCacheForConversation(
  snapshot: TranscriptNodesStoreSnapshot,
  conversationId: string | undefined
): TranscriptNodesCache {
  return transcriptNodesByRunIdForConversation(snapshot.nodesByConversationId, conversationId);
}

export function subscribeTranscriptNodesCache(
  conversationId: string | undefined,
  listener: () => void
): () => void {
  let listeners = listenersByConversationId.get(conversationId);
  if (listeners === undefined) {
    listeners = new Set();
    listenersByConversationId.set(conversationId, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners?.delete(listener);
    if (listeners?.size === 0) {
      listenersByConversationId.delete(conversationId);
    }
  };
}

/**
 * Merge new entries into the cache and notify subscribers.
 * If the merge produces no actual changes for this conversation, notification
 * is suppressed to avoid spurious re-renders.
 */
export function updateTranscriptNodesCache(
  conversationId: string,
  patch: Record<string, readonly TranscriptNode[]>
): void {
  const nextNodesByConversationId = updateConversationTranscriptNodes(
    cache.nodesByConversationId,
    conversationId,
    patch,
  );
  if (nextNodesByConversationId === cache.nodesByConversationId) return;
  cache = {
    nodesByConversationId: nextNodesByConversationId,
  };
  notifyTranscriptNodesCache(conversationId);
}

export function resetTranscriptNodesCache(conversationId?: string): void {
  const nextNodesByConversationId = resetConversationTranscriptNodes(
    cache.nodesByConversationId,
    conversationId,
  );
  if (nextNodesByConversationId === cache.nodesByConversationId) return;
  cache = {
    nodesByConversationId: nextNodesByConversationId,
  };
  if (conversationId === undefined) {
    notifyAllTranscriptNodesCache();
  } else {
    notifyTranscriptNodesCache(conversationId);
  }
}

function notifyTranscriptNodesCache(conversationId: string | undefined): void {
  const listeners = listenersByConversationId.get(conversationId);
  if (listeners === undefined) return;
  for (const listener of listeners) listener();
}

function notifyAllTranscriptNodesCache(): void {
  for (const listeners of listenersByConversationId.values()) {
    for (const listener of listeners) listener();
  }
}
