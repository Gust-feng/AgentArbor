import {
  discoverSubAgents,
  type SubAgentDefinition,
  type SubAgentDiscoveryOptions,
} from "./sub-agent-loader.js";

export type { SubAgentDefinition, SubAgentDiscoveryOptions } from "./sub-agent-loader.js";

export class SubAgentRegistry {
  readonly #options: SubAgentDiscoveryOptions;
  #cache: readonly SubAgentDefinition[] | null = null;
  #byId: ReadonlyMap<string, SubAgentDefinition> | null = null;
  #byName: ReadonlyMap<string, SubAgentDefinition> | null = null;

  constructor(options: SubAgentDiscoveryOptions) {
    this.#options = options;
  }

  async list(): Promise<readonly SubAgentDefinition[]> {
    if (this.#cache === null) {
      const subAgents = await discoverSubAgents(this.#options);
      this.#cache = subAgents;
      this.#byId = new Map(subAgents.map((sa) => [sa.id, sa]));
      this.#byName = new Map(subAgents.map((sa) => [sa.name.toLowerCase(), sa]));
    }
    return this.#cache;
  }

  async getById(id: string): Promise<SubAgentDefinition | undefined> {
    await this.list();
    return this.#byId?.get(id);
  }

  async getByName(name: string): Promise<SubAgentDefinition | undefined> {
    await this.list();
    return this.#byName?.get(name.toLowerCase());
  }

  invalidate(): void {
    this.#cache = null;
    this.#byId = null;
    this.#byName = null;
  }
}
