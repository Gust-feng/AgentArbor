import type {
  BasicAgentCapabilitySnapshot,
  CapabilityDraft,
  RunCapabilityResolution,
  RunToolExposure,
} from "../domain/config/index.js";
import type { TaskSoil } from "../domain/soil/index.js";
import { createId, nowIso } from "../kernel/id.js";

export type ResolveRunCapabilitiesInput = {
  readonly snapshot: BasicAgentCapabilitySnapshot;
  readonly goal: string;
  readonly runMode: "agent" | "deep";
  readonly taskSoil?: TaskSoil;
  readonly platform?: NodeJS.Platform;
};

// CapabilityCenter freezes what exists; this policy freezes what this specific
// run may expose to the model after task permissions, platform gates, and mode
// boundaries are applied.
export function resolveRunCapabilities(input: ResolveRunCapabilitiesInput): RunCapabilityResolution {
  const platform = input.platform ?? process.platform;
  const permissionRefs = new Set(input.taskSoil?.permissionBoundaryRefs ?? []);
  const toolExposures = input.snapshot.toolCatalog.tools.map((tool): RunToolExposure => {
    const availabilityAllowed = tool.enabled && tool.availability === "available";
    const denied = isDeniedByPermissionRef(tool.name, permissionRefs);
    const modelVisible = availabilityAllowed && !denied && isVisibleInRunMode(input.runMode, tool.name);
    return {
      name: tool.name,
      enabled: tool.enabled,
      modelVisible,
      availability: tool.availability,
      riskLevel: tool.riskLevel,
      operationType: tool.operationType,
      requiresConfirmation: tool.requiresConfirmation || (platform === "win32" && tool.operationType !== "read-only"),
      reason: exposureReason({
        enabled: tool.enabled,
        availability: tool.availability,
        denied,
        modelVisible,
        requiresConfirmation: tool.requiresConfirmation || (platform === "win32" && tool.operationType !== "read-only"),
      }),
    };
  });
  const allowedTools = toolExposures
    .filter((tool) => tool.modelVisible)
    .map((tool) => tool.name);
  return {
    resolutionId: createId("capability-resolution"),
    snapshotId: input.snapshot.snapshotId,
    runMode: input.runMode,
    allowedTools,
    toolExposures,
    enabledSkills: input.snapshot.skillCatalog.filter((skill) => skill.enabled),
    mcpDrafts: input.snapshot.mcpCatalog.map((server): CapabilityDraft => ({
      draftId: `mcp:${server.serverId}`,
      source: "mcp",
      label: server.label,
      availability: server.availability,
      enabled: server.enabled,
      reason: server.enabled
        ? "MCP 当前只作为能力草案登记，本批不执行 MCP tool。"
        : "MCP server is disabled.",
    })),
    warnings: capabilityResolutionWarnings({ snapshot: input.snapshot, allowedTools, toolExposures }),
    createdAt: nowIso(),
  };
}

function isDeniedByPermissionRef(toolName: string, refs: ReadonlySet<string>): boolean {
  return refs.has(`deny:tool:${toolName}`) || refs.has(`deny:${toolName}`);
}

function isVisibleInRunMode(runMode: "agent" | "deep", toolName: string): boolean {
  // Mode visibility is the safety boundary: ordinary runs hide Underground internals; deep runs may opt in.
  if (runMode === "deep") {
    return true;
  }
  return !toolName.startsWith("underground_");
}

function exposureReason(input: {
  readonly enabled: boolean;
  readonly availability: "available" | "unavailable";
  readonly denied: boolean;
  readonly modelVisible: boolean;
  readonly requiresConfirmation: boolean;
}): string {
  if (!input.enabled) return "Tool is disabled by configuration.";
  if (input.availability !== "available") return "Tool runtime is unavailable.";
  if (input.denied) return "Tool is denied by this run permission boundary.";
  if (!input.modelVisible) return "Tool is not visible for this run mode.";
  if (input.requiresConfirmation) return "Tool is visible but dangerous actions are gated by confirmation.";
  return "Tool is available for this run.";
}

function capabilityResolutionWarnings(input: {
  readonly snapshot: BasicAgentCapabilitySnapshot;
  readonly allowedTools: readonly string[];
  readonly toolExposures: readonly RunToolExposure[];
}): readonly string[] {
  const warnings = [...input.snapshot.warnings];
  if (input.allowedTools.length === 0) {
    warnings.push("本轮没有模型可见工具。");
  }
  const hidden = input.toolExposures.filter((tool) => tool.enabled && !tool.modelVisible);
  if (hidden.length > 0) {
    warnings.push(`本轮已隐藏 ${hidden.length} 个不可用或未授权工具。`);
  }
  if (input.snapshot.mcpCatalog.some((server) => server.enabled)) {
    warnings.push("MCP 当前只进入能力草案目录，本批不执行 MCP tool。");
  }
  return warnings;
}
