import { createResearchToolRegistryContribution } from "../research/research-tool-contribution.js";
import type {
  AgentToolProviderFetch,
  AgentToolRegistryContribution,
  AgentToolRuntimeContext,
} from "../tool-center/factory.js";
import type { AgentHostRunResources } from "./agent-run-resources.js";

/** Feature contributions selected by the application Host for every Agent run. */
export function createHostAgentToolContributions(input: {
  readonly runtime: AgentToolRuntimeContext;
  readonly resources: AgentHostRunResources;
  readonly providerFetch?: AgentToolProviderFetch;
}): readonly AgentToolRegistryContribution[] {
  return [createResearchToolRegistryContribution({
    constraints: input.runtime.constraints,
    env: input.resources.aiEnvironment,
    fetch: input.providerFetch,
    workspaceRoot: input.resources.workspaceRoot,
  })];
}
