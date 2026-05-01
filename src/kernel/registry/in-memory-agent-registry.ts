import type { AgentManifest } from "../../domain/common.js";

export class AgentRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentRegistryError";
  }
}

export class InMemoryAgentRegistry {
  private readonly agents = new Map<string, AgentManifest>();

  register(manifest: AgentManifest): void {
    if (this.agents.has(manifest.id)) {
      throw new AgentRegistryError(`Agent already registered: ${manifest.id}`);
    }
    this.agents.set(manifest.id, manifest);
  }

  get(agentId: string): AgentManifest {
    const manifest = this.agents.get(agentId);
    if (manifest === undefined) {
      throw new AgentRegistryError(`Agent not registered: ${agentId}`);
    }
    return manifest;
  }

  list(): AgentManifest[] {
    return [...this.agents.values()];
  }

  findByRequiredCapabilities(requiredCapabilities: string[]): AgentManifest | undefined {
    return this.list().find(
      (manifest) =>
        manifest.lifecycle.status === "active" &&
        requiredCapabilities.every((capability) => manifest.capabilities.includes(capability))
    );
  }
}
