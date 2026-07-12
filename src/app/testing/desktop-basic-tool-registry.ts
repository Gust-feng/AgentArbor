import {
  createMcpToolRegistryContribution,
  type McpToolExecutorProvider,
} from "../mcp/mcp-tool-contribution.js";
import { createResearchToolRegistryContribution } from "../research/research-tool-contribution.js";
import {
  createAgentToolRegistry,
  type CreateAgentToolRegistryOptions,
} from "../tool-center/builtin-tool-runtime.js";
import { applyAgentToolRegistryContributions } from "../tool-center/factory.js";
import { ToolRegistry } from "../tool-center/tool-registry.js";

/**
 * Test-only registry fixture for the current Host `desktop-basic` wire scope.
 * Production features must use composition-root contributions instead.
 */
export function createDesktopBasicToolRegistryForTest(
  options: CreateAgentToolRegistryOptions & {
    readonly mcpManager?: McpToolExecutorProvider;
  } = {},
): ToolRegistry {
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
