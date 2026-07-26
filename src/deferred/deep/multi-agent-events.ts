import type { DeepRunStreamEvent } from "./deep-events.js";
import { isTerminalDeepRunStatus } from "./deep-run-health.js";
import type { DeepRunRecord, DeepRunRecordStore } from "./deep-run-record-store.js";

export type MultiAgentRunEventReplay = {
  readonly events: readonly DeepRunStreamEvent[];
  readonly terminal: boolean;
};

/**
 * Distinguishes an active run whose first durable record has not arrived yet
 * from a run that cannot produce events. Routes must not infer this from an
 * empty replay or reach into the feature's active-run registry.
 */
export type MultiAgentRunEventAdmission =
  | { readonly kind: "replay"; readonly replay: MultiAgentRunEventReplay }
  | { readonly kind: "live_pending" }
  | { readonly kind: "missing" };

export type MultiAgentRunEventUpdate =
  | {
      readonly kind: "updated";
      readonly runId: string;
      readonly events: readonly DeepRunStreamEvent[];
      readonly terminal: boolean;
    }
  | {
      readonly kind: "deleted";
      readonly runId: string;
    };

export type MultiAgentFeatureEvents = {
  readonly replay: (
    runId: string,
    afterSequence?: number,
  ) => Promise<MultiAgentRunEventReplay | undefined>;
  readonly admit: (
    runId: string,
    afterSequence?: number,
  ) => Promise<MultiAgentRunEventAdmission>;
  readonly subscribe: (
    runId: string,
    listener: (update: MultiAgentRunEventUpdate) => void,
  ) => () => void;
};

export type MultiAgentRunEventStream = MultiAgentFeatureEvents & {
  readonly recordSaved: (record: DeepRunRecord) => void;
  readonly recordDeleted: (runId: string) => void;
  readonly close: () => void;
};

export function createMultiAgentRunEventStream(input: {
  readonly getRun: (runId: string) => Promise<DeepRunRecord | undefined>;
  /** True only while the owning Multi-Agent feature has accepted the run. */
  readonly isRunLive?: (runId: string) => boolean;
}): MultiAgentRunEventStream {
  const listeners = new Map<string, Set<(update: MultiAgentRunEventUpdate) => void>>();
  const lastPublishedSequence = new Map<string, number>();
  const lastTerminalState = new Map<string, boolean>();
  let closed = false;

  function emit(update: MultiAgentRunEventUpdate): void {
    for (const listener of listeners.get(update.runId) ?? []) {
      try {
        listener(structuredClone(update));
      } catch {
        // A projection subscriber cannot roll back an already durable feature fact.
      }
    }
  }

  async function replay(runId: string, afterSequence = 0): Promise<MultiAgentRunEventReplay | undefined> {
    const record = await input.getRun(runId);
    if (record === undefined) {
      return undefined;
    }
    return {
      events: structuredClone(record.eventSequence)
        .filter((event) => event.sequence > afterSequence)
        .sort((left, right) => left.sequence - right.sequence),
      terminal: isTerminalDeepRunStatus(record.run.status),
    };
  }

  return {
    replay,

    async admit(runId, afterSequence = 0): Promise<MultiAgentRunEventAdmission> {
      const available = await replay(runId, afterSequence);
      if (available !== undefined) return { kind: "replay", replay: available };
      return input.isRunLive?.(runId) === true ? { kind: "live_pending" } : { kind: "missing" };
    },

    subscribe(runId, listener): () => void {
      if (closed) {
        return () => undefined;
      }
      const runListeners = listeners.get(runId) ?? new Set();
      runListeners.add(listener);
      listeners.set(runId, runListeners);
      return () => {
        runListeners.delete(listener);
        if (runListeners.size === 0) {
          listeners.delete(runId);
        }
      };
    },

    recordSaved(record): void {
      if (closed) {
        return;
      }
      const runId = record.run.runId;
      const previousSequence = lastPublishedSequence.get(runId) ?? 0;
      const events = record.eventSequence
        .filter((event) => event.sequence > previousSequence)
        .sort((left, right) => left.sequence - right.sequence);
      const latestSequence = record.eventSequence.at(-1)?.sequence ?? previousSequence;
      const terminal = isTerminalDeepRunStatus(record.run.status);
      const terminalChanged = lastTerminalState.get(runId) !== terminal;
      lastPublishedSequence.set(runId, Math.max(previousSequence, latestSequence));
      lastTerminalState.set(runId, terminal);
      if (events.length > 0 || terminalChanged) {
        emit({ kind: "updated", runId, events, terminal });
      }
    },

    recordDeleted(runId): void {
      if (closed) {
        return;
      }
      lastPublishedSequence.delete(runId);
      lastTerminalState.delete(runId);
      emit({ kind: "deleted", runId });
      listeners.delete(runId);
    },

    close(): void {
      closed = true;
      listeners.clear();
      lastPublishedSequence.clear();
      lastTerminalState.clear();
    },
  };
}

/** Publishes only writes that the durable store accepted successfully. */
export function observeDeepRunRecordStore(
  store: DeepRunRecordStore,
  events: Pick<MultiAgentRunEventStream, "recordSaved" | "recordDeleted">,
): DeepRunRecordStore {
  return {
    async upsert(record): Promise<DeepRunRecord> {
      const saved = await store.upsert(record);
      events.recordSaved(saved);
      return saved;
    },
    get: (runId) => store.get(runId),
    list: (limit) => store.list(limit),
    listByConversation: (conversationId, limit) => store.listByConversation(conversationId, limit),
    listByRootRun: (rootRunId, limit) => store.listByRootRun(rootRunId, limit),
    async delete(runId): Promise<void> {
      await store.delete(runId);
      events.recordDeleted(runId);
    },
  };
}
