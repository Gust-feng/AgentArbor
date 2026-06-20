import type { BasicAgentCapabilitySnapshot, RunCapabilityPlan, RunCapabilityResolution } from "../domain/config/index.js";
import type { TaskSoil } from "../domain/soil/index.js";
import type { ToolExecutionBroker } from "../domain/tools/index.js";
import type { AgentDefinition } from "./agent-prompts/contracts.js";
import { resolveRunCapabilities } from "./capability-policy.js";
import { createRunCapabilityPlan } from "./model-capability-registry.js";

export type ResolveRunToolBoundaryInput = {
  readonly agentDefinition: AgentDefinition;
  readonly snapshot?: BasicAgentCapabilitySnapshot;
  readonly goal: string;
  readonly taskSoil: TaskSoil;
  readonly modelCapabilities?: BasicAgentCapabilitySnapshot["modelCapabilities"];
  readonly capabilityPlan?: RunCapabilityPlan;
  readonly platform?: NodeJS.Platform;
  readonly toolCenter?: ToolExecutionBroker;
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
  const capabilityResolution = restrictRunCapabilityResolutionToExecutableTools(
    resolveRunCapabilities({
      snapshot: input.snapshot,
      goal: input.goal,
      agentDefinition: input.agentDefinition,
      taskSoil: input.taskSoil,
      platform: input.platform,
      capabilityPlan,
    }),
    input.toolCenter
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
    return {
      ...resolution,
      allowedTools: [],
      capabilityPlan: {
        ...resolution.capabilityPlan,
        allowedTools: [],
        warnings,
      },
      toolExposures: resolution.toolExposures.map((tool) =>
        tool.modelVisible
          ? { ...tool, modelVisible: false, reason: "本轮没有可执行的工具运行器。" }
          : tool
      ),
      warnings,
    };
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
  return {
    ...resolution,
    allowedTools,
    capabilityPlan: {
      ...resolution.capabilityPlan,
      allowedTools,
      warnings,
    },
    toolExposures: resolution.toolExposures.map((tool) =>
      tool.modelVisible && !executableTools.has(tool.name)
        ? { ...tool, modelVisible: false, reason: "工具执行器当前未提供该工具。" }
        : tool
    ),
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
