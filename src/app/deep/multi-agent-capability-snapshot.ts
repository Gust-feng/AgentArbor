import type { AgentCapabilitySnapshot } from "../../domain/config/contracts.js";

/**
 * Run-born capabilities owned by Multi-Agent. Ordinary-only Skills and
 * Sub-Agent catalogs are intentionally absent from this contract.
 */
export type MultiAgentCapabilitySnapshot = AgentCapabilitySnapshot;

/** Selects only capability facts that can affect a Multi-Agent run. */
export function projectMultiAgentCapabilitySnapshot(
  snapshot: MultiAgentCapabilitySnapshot,
): MultiAgentCapabilitySnapshot {
  // Catalog-only definitions are contributed by Ordinary's SDK AgentTool path;
  // Deep has no executor for them and must not persist them as run capabilities.
  const tools = snapshot.toolCatalog.tools.filter((tool) => tool.catalogOnly !== true);
  const executableToolNames = new Set(tools.map((tool) => tool.name));
  return {
    snapshotId: snapshot.snapshotId,
    createdAt: snapshot.createdAt,
    activeModel: snapshot.activeModel,
    modelCapabilities: snapshot.modelCapabilities,
    toolCatalog: {
      scope: snapshot.toolCatalog.scope,
      tools,
      allowedTools: snapshot.toolCatalog.allowedTools.filter((name) => executableToolNames.has(name)),
    },
    mcpCatalog: snapshot.mcpCatalog,
    workspace: snapshot.workspace,
    ...(snapshot.commandShell === undefined ? {} : { commandShell: snapshot.commandShell }),
    ...(snapshot.toolConfirmation === undefined ? {} : { toolConfirmation: snapshot.toolConfirmation }),
    securitySummary: snapshot.securitySummary,
    warnings: snapshot.warnings,
  };
}
