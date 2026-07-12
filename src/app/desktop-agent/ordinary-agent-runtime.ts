import { createMinimalReadonlySoilStore, createMinimalSoilConstraints } from "../../domain/soil/index.js";
import { InMemoryEventLog } from "../../kernel/events/in-memory-event-log.js";
import { InMemoryMessageBus } from "../../kernel/messages/in-memory-message-bus.js";
import { InMemoryArtifactStore } from "../../kernel/artifacts/in-memory-artifact-store.js";
import type { BasicAgentRuntimeContext } from "../basic-agent-runtime/runtime-context.js";
import { InMemorySubAgentRunTraceStore } from "../sub-agents/sub-agent-trace-store.js";

export function createOrdinaryAgentRuntime(): BasicAgentRuntimeContext {
  const eventLog = new InMemoryEventLog();
  const constraints = createMinimalSoilConstraints();
  const soilStore = createMinimalReadonlySoilStore(constraints);
  return {
    eventLog,
    bus: new InMemoryMessageBus(eventLog),
    constraints: soilStore.listConstraints(),
    soilStore,
    artifactStore: new InMemoryArtifactStore(),
    subAgentRunTraceStore: new InMemorySubAgentRunTraceStore(),
  };
}
