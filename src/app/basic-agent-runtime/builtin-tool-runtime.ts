/** @deprecated Import neutral tool assembly from ../tool-center/index.js. */
export * from "../tool-center/builtin-tool-runtime.js";

import { createResearchToolRegistryContribution } from "../research/research-tool-contribution.js";
import {
  createMcpToolRegistryContribution,
  type McpToolExecutorProvider,
} from "../mcp/mcp-tool-contribution.js";
import { applyAgentToolRegistryContributions } from "../tool-center/factory.js";
import {
  createAgentToolRegistry,
  type CreateAgentToolRegistryOptions,
} from "../tool-center/builtin-tool-runtime.js";
import { ToolRegistry } from "../tool-center/tool-registry.js";

/** @deprecated Ordinary compatibility facade; new features compose contributions explicitly. */
export function createDesktopBasicToolRegistry(
  options: CreateAgentToolRegistryOptions & {
    readonly mcpManager?: McpToolExecutorProvider;
  } = {},
) {
  const compatibilityOptions = {
    ...options,
    baseToolScopes: options.baseToolScopes ?? ["desktop-basic"],
  };
  const registry = new ToolRegistry();
  applyAgentToolRegistryContributions(registry, compatibilityOptions, [
    createResearchToolRegistryContribution({
      constraints: options.runtime?.constraints,
      env: options.env,
      fetch: options.fetch,
      workspaceRoot: options.workspaceRoot,
    }),
  ]);
  createAgentToolRegistry(compatibilityOptions, registry);
  if (options.mcpManager !== undefined) {
    applyAgentToolRegistryContributions(registry, compatibilityOptions, [
      createMcpToolRegistryContribution(options.mcpManager, {
        useDiscoveredTools: options.toolCatalogNames === undefined,
      }),
    ]);
  }
  return registry;
}
