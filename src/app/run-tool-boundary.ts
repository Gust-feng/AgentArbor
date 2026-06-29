import type { BasicAgentCapabilitySnapshot, RunCapabilityPlan, RunCapabilityResolution } from "../domain/config/index.js";
import type { TaskSoil } from "../domain/soil/index.js";
import type { ToolExecutionBroker } from "../domain/tools/index.js";
import type { AgentDefinition } from "./agent-prompts/contracts.js";
import type { DesktopAgentSkillContext } from "./desktop-agent-contracts.js";
import { resolveRunCapabilities } from "./capability-policy.js";
import { createRunCapabilityPlan } from "./model-capability-registry.js";
import { hasReadableSelectedSkillResources } from "./tool-center/adapters/skill-resource-tool.js";

export type ResolveRunToolBoundaryInput = {
  readonly agentDefinition: AgentDefinition;
  readonly snapshot?: BasicAgentCapabilitySnapshot;
  readonly goal: string;
  readonly taskSoil: TaskSoil;
  readonly modelCapabilities?: BasicAgentCapabilitySnapshot["modelCapabilities"];
  readonly capabilityPlan?: RunCapabilityPlan;
  readonly platform?: NodeJS.Platform;
  readonly toolCenter?: ToolExecutionBroker;
  readonly skillContexts?: readonly DesktopAgentSkillContext[];
};

export type ResolvedRunToolBoundary = {
  readonly allowedTools: readonly string[];
  readonly capabilityResolution?: RunCapabilityResolution;
};

export function resolveRunToolBoundary(input: ResolveRunToolBoundaryInput): ResolvedRunToolBoundary {
  if (input.snapshot === undefined) {
    return {
      allowedTools: [],
      capabilityResolution: undefined,
    };
  }
  const capabilityPlan = input.capabilityPlan ?? createRunCapabilityPlan({
    profile: input.snapshot.activeModel,
    modelCapabilities: input.modelCapabilities ?? input.snapshot.modelCapabilities,
  });
  const capabilityResolution = addSelectedSkillToolDeclarationWarnings(
    reconcileRunCapabilityResolutionForSelectedSkillResources(
      restrictRunCapabilityResolutionToExecutableTools(
        resolveRunCapabilities({
          snapshot: input.snapshot,
          goal: input.goal,
          agentDefinition: input.agentDefinition,
          taskSoil: input.taskSoil,
          platform: input.platform,
          capabilityPlan,
        }),
        input.toolCenter
      ),
      {
        toolCenter: input.toolCenter,
        skillContexts: input.skillContexts ?? [],
      }
    ),
    input.skillContexts ?? []
  );
  return {
    allowedTools: capabilityResolution.allowedTools,
    capabilityResolution,
  };
}

export function restrictRunCapabilityResolutionToExecutableTools(
  resolution: RunCapabilityResolution,
  toolCenter: ToolExecutionBroker | undefined
): RunCapabilityResolution {
  const executableTools = new Set(toolCenter?.list().map((tool) => tool.name) ?? []);
  if (executableTools.size === 0) {
    const hiddenExecutableToolCount = resolution.allowedTools.length;
    const warnings = capabilityWarningsAfterExecutableRestriction({
      warnings: resolution.warnings,
      hiddenCount: hiddenExecutableToolCount,
      noModelVisibleTools: true,
    });
    const toolExposures = resolution.toolExposures.map((tool) =>
        tool.modelVisible
          ? { ...tool, modelVisible: false, reason: "本轮没有可执行的工具运行器。" }
          : tool
      );
    return capabilityResolutionWithVisibleTools({ resolution, allowedTools: [], toolExposures, warnings });
  }
  const allowedTools = resolution.allowedTools.filter((toolName) => executableTools.has(toolName));
  const hiddenExecutableToolCount = resolution.allowedTools.length - allowedTools.length;
  const warnings = hiddenExecutableToolCount <= 0
    ? resolution.warnings
    : capabilityWarningsAfterExecutableRestriction({
        warnings: resolution.warnings,
        hiddenCount: hiddenExecutableToolCount,
        noModelVisibleTools: allowedTools.length === 0,
      });
  const toolExposures = resolution.toolExposures.map((tool) =>
      tool.modelVisible && !executableTools.has(tool.name)
        ? { ...tool, modelVisible: false, reason: "工具执行器当前未提供该工具。" }
        : tool
    );
  return capabilityResolutionWithVisibleTools({ resolution, allowedTools, toolExposures, warnings });
}

export function reconcileRunCapabilityResolutionForSelectedSkillResources(
  resolution: RunCapabilityResolution,
  input: {
    readonly toolCenter?: ToolExecutionBroker;
    readonly skillContexts: readonly DesktopAgentSkillContext[];
  }
): RunCapabilityResolution {
  const selectedSkillResources = hasReadableSelectedSkillResources(input.skillContexts);
  const readSkillResourceExecutable = input.toolCenter?.has("read_skill_resource") === true;
  const exposure = resolution.toolExposures.find((tool) => tool.name === "read_skill_resource");
  if (exposure === undefined) {
    return resolution;
  }
  if (selectedSkillResources && readSkillResourceExecutable && exposure.reason === "不在本轮可用范围内。") {
    const allowedTools = [...resolution.allowedTools, "read_skill_resource"];
    const toolExposures = resolution.toolExposures.map((tool) =>
        tool.name === "read_skill_resource"
          ? { ...tool, modelVisible: true, reason: "当前已选中技能提供可读资源。" }
          : tool
      );
    const warnings = capabilityWarningsAfterSkillResourceRestriction({
      warnings: resolution.warnings,
      hiddenSkillResourceTool: false,
      noModelVisibleTools: false,
    });
    return capabilityResolutionWithVisibleTools({ resolution, allowedTools, toolExposures, warnings });
  }
  if (selectedSkillResources || exposure.reason !== "不在本轮可用范围内。" && !exposure.modelVisible) {
    return resolution;
  }
  const allowedTools = resolution.allowedTools.filter((toolName) => toolName !== "read_skill_resource");
  const warnings = capabilityWarningsAfterSkillResourceRestriction({
    warnings: resolution.warnings,
    hiddenSkillResourceTool: exposure.modelVisible || exposure.reason === "不在本轮可用范围内。",
    noModelVisibleTools: allowedTools.length === 0,
  });
  const toolExposures = resolution.toolExposures.map((tool) =>
      tool.name === "read_skill_resource"
        ? { ...tool, modelVisible: false, reason: "当前没有已选中且可读的技能资源。" }
        : tool
    );
  return capabilityResolutionWithVisibleTools({ resolution, allowedTools, toolExposures, warnings });
}

export function addSelectedSkillToolDeclarationWarnings(
  resolution: RunCapabilityResolution,
  skillContexts: readonly DesktopAgentSkillContext[]
): RunCapabilityResolution {
  const declared = selectedSkillAllowedTools(skillContexts);
  if (declared.size === 0) {
    return resolution;
  }
  const unavailableDeclaredToolCount = [...declared]
    .filter((toolName) => !resolution.allowedTools.includes(toolName))
    .length;
  const warnings = capabilityWarningsAfterSkillToolDeclarations({
    warnings: resolution.warnings,
    unavailableDeclaredToolCount,
  });
  return capabilityResolutionWithVisibleTools({
    resolution,
    allowedTools: resolution.allowedTools,
    toolExposures: resolution.toolExposures,
    warnings,
  });
}

function selectedSkillAllowedTools(
  skillContexts: readonly DesktopAgentSkillContext[]
): ReadonlySet<string> {
  const allowedTools = new Set<string>();
  for (const context of skillContexts) {
    if ((context.loadStatus ?? "loaded") !== "loaded" || context.omitted === true) {
      continue;
    }
    for (const toolName of skillAllowedTools(context.skill)) {
      allowedTools.add(toolName);
    }
  }
  return allowedTools;
}

function skillAllowedTools(skill: DesktopAgentSkillContext["skill"]): readonly string[] {
  return (skill.allowedTools ?? []).filter((tool) => tool.trim().length > 0);
}

function capabilityResolutionWithVisibleTools(input: {
  readonly resolution: RunCapabilityResolution;
  readonly allowedTools: readonly string[];
  readonly toolExposures: RunCapabilityResolution["toolExposures"];
  readonly warnings: readonly string[];
}): RunCapabilityResolution {
  const warnings = normalizeCapabilityWarnings({
    warnings: input.warnings,
    allowedTools: input.allowedTools,
    toolExposures: input.toolExposures,
  });
  const visibleTools = input.toolExposures.filter((tool) => tool.modelVisible);
  const visibleToolNames = visibleTools.map((tool) => tool.name);
  return {
    ...input.resolution,
    allowedTools: input.allowedTools,
    capabilityPlan: {
      ...input.resolution.capabilityPlan,
      tools: input.resolution.capabilityPlan.tools === undefined
        ? undefined
        : {
            ...input.resolution.capabilityPlan.tools,
            allowedTools: input.allowedTools,
          },
      fileOperations: {
        canReadWorkspace: visibleTools.some((tool) =>
          tool.operationType === "read-only" ||
          tool.operationType === "read-write" ||
          tool.operationType === "execute"
        ),
        canWriteWorkspace: visibleTools.some((tool) => tool.operationType === "read-write"),
        canDeleteWorkspace: visibleTools.some((tool) => tool.fileOperation === "delete"),
        canExecuteCommands: visibleTools.some((tool) => tool.operationType === "execute"),
      },
      uiDisplay: {
        canShowStreamingOutput:
          input.resolution.capabilityPlan.uiDisplay?.canShowStreamingOutput ??
          input.resolution.capabilityPlan.modelCapabilities.supportsStreaming,
        canShowToolCards: visibleToolNames.length > 0,
        visibleToolNames,
      },
      allowedTools: input.allowedTools,
      warnings,
    },
    toolExposures: input.toolExposures,
    warnings,
  };
}

function capabilityWarningsAfterExecutableRestriction(input: {
  readonly warnings: readonly string[];
  readonly hiddenCount: number;
  readonly noModelVisibleTools: boolean;
}): readonly string[] {
  const next = [...input.warnings];
  if (input.noModelVisibleTools && !next.includes("本轮没有可用工具。")) {
    next.push("本轮没有可用工具。");
  }
  if (input.hiddenCount > 0 && !next.some((warning) => warning.includes("工具执行器"))) {
    next.push(`本轮有 ${input.hiddenCount} 个策略可见工具没有对应的工具执行器。`);
  }
  return next;
}

function capabilityWarningsAfterSkillToolDeclarations(input: {
  readonly warnings: readonly string[];
  readonly unavailableDeclaredToolCount: number;
}): readonly string[] {
  const next = [...input.warnings];
  if (input.unavailableDeclaredToolCount > 0 && !next.some((warning) => warning.includes("声明了当前运行不可用工具"))) {
    next.push(`选中技能声明了 ${input.unavailableDeclaredToolCount} 个当前运行不可用工具。`);
  }
  return next;
}

function capabilityWarningsAfterSkillResourceRestriction(input: {
  readonly warnings: readonly string[];
  readonly hiddenSkillResourceTool: boolean;
  readonly noModelVisibleTools: boolean;
}): readonly string[] {
  const next = input.warnings.filter((warning) =>
    warning !== "当前没有已选中且可读的技能资源，已隐藏 read_skill_resource。"
  );
  if (
    input.hiddenSkillResourceTool &&
    !next.includes("当前没有已选中且可读的技能资源，已隐藏 read_skill_resource。")
  ) {
    next.push("当前没有已选中且可读的技能资源，已隐藏 read_skill_resource。");
  }
  return next;
}

function normalizeCapabilityWarnings(input: {
  readonly warnings: readonly string[];
  readonly allowedTools: readonly string[];
  readonly toolExposures: RunCapabilityResolution["toolExposures"];
}): readonly string[] {
  const next = input.warnings.filter((warning) =>
    warning !== "本轮没有可用工具。" && !/^已隐藏 \d+ 个不可用工具。$/u.test(warning)
  );
  if (input.allowedTools.length === 0) {
    next.push("本轮没有可用工具。");
  }
  const hiddenCount = input.toolExposures.filter((tool) => tool.enabled && !tool.modelVisible).length;
  if (hiddenCount > 0) {
    next.push(`已隐藏 ${hiddenCount} 个不可用工具。`);
  }
  return next;
}
