import type { Constraint } from "../../domain/constraints.js";
import type { ReadonlySoilStore } from "../../domain/soil/index.js";
import type {
  SubAgentRunTrace,
  SubAgentRunTraceReader,
  SubAgentRunTraceSink,
} from "../../domain/sub-agents/contracts.js";
import type { InMemoryArtifactStore } from "../../kernel/artifacts/in-memory-artifact-store.js";
import type { InMemoryEventLog } from "../../kernel/events/in-memory-event-log.js";
import type { InMemoryMessageBus } from "../../kernel/messages/in-memory-message-bus.js";

/** Exact mutable runtime facts owned by one Ordinary Agent session. */
export type BasicAgentRuntimeContext = {
  readonly eventLog: InMemoryEventLog;
  readonly bus: InMemoryMessageBus;
  readonly constraints: readonly Constraint[];
  readonly soilStore: ReadonlySoilStore;
  readonly artifactStore: InMemoryArtifactStore;
  readonly subAgentRunTraceStore: SubAgentRunTraceSink & SubAgentRunTraceReader & {
    list(): readonly SubAgentRunTrace[];
  };
};
