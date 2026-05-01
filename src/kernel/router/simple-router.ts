import type { AgentManifest } from "../../domain/common.js";
import type { TaskSpec } from "../../domain/aboveground/contracts.js";
import type { InMemoryAgentRegistry } from "../registry/in-memory-agent-registry.js";

export class RoutingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoutingError";
  }
}

export class SimpleRouter {
  constructor(private readonly registry: InMemoryAgentRegistry) {}

  route(task: TaskSpec): AgentManifest {
    const worker = this.registry.findByRequiredCapabilities(task.requiredCapabilities);
    if (worker === undefined) {
      throw new RoutingError(
        `No active worker can satisfy required capabilities: ${task.requiredCapabilities.join(", ")}`
      );
    }
    return worker;
  }
}
