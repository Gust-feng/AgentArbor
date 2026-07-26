import {
  PathMemoryFeatureError,
  pathMemoryIdForSource,
  type PathMemory,
  type PathMemoryCaptureInput,
  type PathMemoryEvent,
  type PathMemoryFeature,
  type PathMemoryRepository,
} from "./contracts.js";
import { searchPathMemories } from "./search.js";

export type CreatePathMemoryFeatureInput = {
  readonly repository: PathMemoryRepository;
  readonly now?: () => Date;
};

export function createPathMemoryFeature(input: CreatePathMemoryFeatureInput): PathMemoryFeature {
  const { repository } = input;
  const now = input.now ?? (() => new Date());
  const listeners = new Set<(event: PathMemoryEvent) => void>();
  const pending = new Set<Promise<unknown>>();
  let released = false;

  function assertUsable(operation: string): void {
    if (released) {
      throw new PathMemoryFeatureError(
        "path_memory_feature_released",
        `PathMemory feature is released and cannot ${operation}`,
      );
    }
  }

  function publish(event: PathMemoryEvent): void {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // Listener failures never affect already committed memory facts.
      }
    }
  }

  function track<T>(operation: Promise<T>): Promise<T> {
    pending.add(operation);
    void operation.then(() => undefined, () => undefined).finally(() => {
      pending.delete(operation);
    });
    return operation;
  }

  return {
    commands: {
      capture(captureInput: PathMemoryCaptureInput) {
        assertUsable("capture a memory");
        const memory: PathMemory = {
          id: pathMemoryIdForSource(captureInput.source),
          source: captureInput.source,
          scope: captureInput.scope,
          goal: captureInput.goal,
          path: captureInput.path,
          outcome: captureInput.outcome,
          verification: captureInput.verification,
          evidenceRefs: captureInput.evidenceRefs,
          capturedAt: now().toISOString(),
        };
        return track((async () => {
          const result = await repository.create(memory);
          if (result.status === "created") {
            publish({ type: "path_memory.captured", memory: result.memory });
          } else if (result.status === "replaced") {
            publish({
              type: "path_memory.replaced",
              memory: result.memory,
              supersededRevision: result.supersededRevision,
            });
          }
          return result;
        })());
      },
      delete(memoryId: string) {
        assertUsable("delete a memory");
        return track((async () => {
          const deleted = await repository.delete(memoryId, now().toISOString());
          if (!deleted) {
            throw new PathMemoryFeatureError(
              "path_memory_not_found",
              `PathMemory ${memoryId} was not found`,
            );
          }
          publish({ type: "path_memory.deleted", memoryId });
        })());
      },
    },
    queries: {
      get(memoryId) {
        assertUsable("read a memory");
        return track(repository.get(memoryId));
      },
      findBySource(sourceInput) {
        assertUsable("read a memory");
        return track(repository.findBySource(sourceInput));
      },
      list(filter) {
        assertUsable("list memories");
        return track(repository.list(filter));
      },
      search(searchInput) {
        assertUsable("search memories");
        return track((async () => {
          // Scope filter first via repository; scoring reorders, so the
          // result limit is applied by the pure search function only.
          const memories = await repository.list({
            workspaceRoot: searchInput.workspaceRoot,
            conversationId: searchInput.conversationId,
            terminalStatus: searchInput.terminalStatus,
          });
          return searchPathMemories(memories, searchInput);
        })());
      },
    },
    events: {
      subscribe(listener) {
        assertUsable("subscribe to events");
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    async release() {
      if (released) return;
      released = true;
      listeners.clear();
      // Drain accepted work; release never invents failures for settled facts.
      while (pending.size > 0) {
        await Promise.allSettled([...pending]);
      }
    },
  };
}
