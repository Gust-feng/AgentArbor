import type { AgentDefinition } from "./agent-prompts/contracts.js";
import {
  BasicAgentCapabilitySnapshot,
  CapabilityDraft,
  RunCapabilityResolution,
  RunEnabledSkill,
  RunToolExposure,
} from "../domain/config/index.js";
import type { TaskSoil } from "../domain/soil/index.js";
import { createId, nowIso } from "../kernel/id.js";
import { isToolVisibleToAgentProfile as isVisibleToProfile } from "./agent-prompts/contracts.js";

export type ResolveRunCapabilitiesInput = {
  readonly snapshot: BasicAgentCapabilitySnapshot;
  readonly goal: string;
  readonly agentDefinition: AgentDefinition;
  readonly taskSoil?: TaskSoil;
  readonly platform?: NodeJS.Platform;
  readonly modelSupportsToolCalling?: boolean;
};

// CapabilityCenter freezes what exists; this policy freezes what this specific
// run may expose to the model after task permissions, platform gates, and mode
// boundaries are applied.
export function resolveRunCapabilities(input: ResolveRunCapabilitiesInput): RunCapabilityResolution {
  const permissionRefs = new Set(input.taskSoil?.permissionBoundaryRefs ?? []);
  const modelSupportsToolCalling = input.modelSupportsToolCalling ?? true;
  const snapshotAllowedTools = new Set(input.snapshot.toolCatalog.allowedTools);
  const toolExposures = input.snapshot.toolCatalog.tools.map((tool): RunToolExposure => {
    const availabilityAllowed = tool.enabled && tool.availability === "available";
    const allowedBySnapshot = snapshotAllowedTools.has(tool.name);
    const denied = isDeniedByPermissionRef(tool.name, permissionRefs);
    const modelVisible =
      modelSupportsToolCalling &&
      availabilityAllowed &&
      allowedBySnapshot &&
      !denied &&
      isVisibleToProfile(input.agentDefinition.toolVisibilityProfile, tool);
    return {
      name: tool.name,
      displayName: tool.displayName,
      enabled: tool.enabled,
      modelVisible,
      scopes: tool.scopes,
      availability: tool.availability,
      riskLevel: tool.riskLevel,
      operationType: tool.operationType,
      requiresConfirmation: tool.requiresConfirmation,
      reason: exposureReason({
        enabled: tool.enabled,
        availability: tool.availability,
        allowedBySnapshot,
        denied,
        modelSupportsToolCalling,
        modelVisible,
        requiresConfirmation: tool.requiresConfirmation,
      }),
    };
  });
  const allowedTools = toolExposures
    .filter((tool) => tool.modelVisible)
    .map((tool) => tool.name);
  return {
    resolutionId: createId("capability-resolution"),
    snapshotId: input.snapshot.snapshotId,
    runMode: input.agentDefinition.toolVisibilityProfile.runMode,
    agentId: input.agentDefinition.agentId,
    agentDisplayName: input.agentDefinition.displayName,
    toolVisibilityProfileId: input.agentDefinition.toolVisibilityProfile.profileId,
    allowedTools,
    toolExposures,
    enabledSkills: input.snapshot.skillCatalog
      .filter((skill) => skill.enabled)
      .map((skill): RunEnabledSkill => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        triggers: [...skill.triggers],
      })),
    mcpDrafts: input.snapshot.mcpCatalog.map((server): CapabilityDraft => ({
      draftId: `mcp:${server.serverId}`,
      source: "mcp",
      label: server.label,
      availability: server.availability,
      enabled: server.enabled,
      reason: server.enabled
        ? "已登记。"
        : "已停用。",
    })),
    warnings: capabilityResolutionWarnings({ snapshot: input.snapshot, allowedTools, toolExposures }),
    createdAt: nowIso(),
  };
}

function isDeniedByPermissionRef(toolName: string, refs: ReadonlySet<string>): boolean {
  return refs.has(`deny:tool:${toolName}`) || refs.has(`deny:${toolName}`);
}

function exposureReason(input: {
  readonly enabled: boolean;
  readonly availability: "available" | "unavailable";
  readonly allowedBySnapshot: boolean;
  readonly denied: boolean;
  readonly modelSupportsToolCalling: boolean;
  readonly modelVisible: boolean;
  readonly requiresConfirmation: boolean;
}): string {
  if (!input.modelSupportsToolCalling) return "当前模型不支持工具调用。";
  if (!input.enabled) return "工具已在配置中停用。";
  if (input.availability !== "available") return "当前不可用。";
  if (!input.allowedBySnapshot) return "不在本轮可用范围内。";
  if (input.denied) return "本轮已隐藏。";
  if (!input.modelVisible) return "当前模式不可用。";
  if (input.requiresConfirmation) return "可用，高影响动作会先等你判断。";
  return "可用。";
}

function capabilityResolutionWarnings(input: {
  readonly snapshot: BasicAgentCapabilitySnapshot;
  readonly allowedTools: readonly string[];
  readonly toolExposures: readonly RunToolExposure[];
}): readonly string[] {
  const warnings = [...input.snapshot.warnings];
  if (input.allowedTools.length === 0) {
    warnings.push("本轮没有可用工具。");
  }
  const hidden = input.toolExposures.filter((tool) => tool.enabled && !tool.modelVisible);
  if (hidden.length > 0) {
    warnings.push(`已隐藏 ${hidden.length} 个不可用工具。`);
  }
  if (input.snapshot.mcpCatalog.some((server) => server.enabled)) {
    warnings.push("MCP 已登记。");
  }
  return warnings;
}
