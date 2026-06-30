import {
  InMemoryDirectionHandoffPackageStore,
  type DirectionHandoffPackageStore,
} from "../domain/agentarbor/direction-handoff-package.js";
import { createMinimalReadonlySoilStore, createMinimalSoilConstraints } from "../domain/soil/index.js";
import { InMemoryArtifactStore } from "../kernel/artifacts/in-memory-artifact-store.js";
import { InMemoryEventLog } from "../kernel/events/in-memory-event-log.js";
import { InMemoryMessageBus } from "../kernel/messages/in-memory-message-bus.js";
import { InMemoryAgentRegistry } from "../kernel/registry/in-memory-agent-registry.js";
import { SimpleRouter } from "../kernel/router/simple-router.js";
import { createDemoAgentManifests } from "./agents/manifests.js";
import { InMemorySubAgentRunTraceStore } from "./sub-agents/sub-agent-trace-store.js";

export type MinimalRuntime = ReturnType<typeof createMinimalRuntime>;

export type CreateMinimalRuntimeOptions = {
  directionHandoffPackageStore?: DirectionHandoffPackageStore;
};

export function createMinimalRuntime(options: CreateMinimalRuntimeOptions = {}) {
  const eventLog = new InMemoryEventLog();
  const bus = new InMemoryMessageBus(eventLog);
  const registry = new InMemoryAgentRegistry();
  const artifactStore = new InMemoryArtifactStore();
  const subAgentRunTraceStore = new InMemorySubAgentRunTraceStore();
  const directionHandoffPackageStore =
    options.directionHandoffPackageStore ?? new InMemoryDirectionHandoffPackageStore();
  const router = new SimpleRouter(registry);
  const constraints = createMinimalSoilConstraints();
  const soilStore = createMinimalReadonlySoilStore(constraints);

  for (const manifest of createDemoAgentManifests()) {
    registry.register(manifest);
  }

  return {
    eventLog,
    bus,
    registry,
    artifactStore,
    subAgentRunTraceStore,
    directionHandoffPackageStore,
    router,
    soilStore,
    constraints: soilStore.listConstraints(),
  };
}
