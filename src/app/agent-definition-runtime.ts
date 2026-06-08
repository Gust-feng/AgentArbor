import type { BasicAgentCapabilitySnapshot, RunCapabilityResolution } from "../domain/config/index.js";
import type { TaskSoil } from "../domain/soil/index.js";
import type { ToolExecutionBroker } from "../domain/tools/index.js";
import type { AgentTurnPolicy } from "../kernel/intelligence/agent-turn-runtime.js";
import type { AgentDefinition } from "./agent-prompts/contracts.js";
import { resolveRunCapabilities } from "./capability-policy.js";

export {
  agentDefinitionHash,
  agentDefinitionRefMatchesDefinition,
  isCompleteRunAgentDefinitionRef,
  runAgentDefinitionRef,
} from "./agent-definition-ref.js";
export type { CompleteRunAgentDefinitionRef } from "./agent-definition-ref.js";

export type CreateAgentTurnPolicyFromDefinitionInput = {
  readonly agentDefinition: AgentDefinition;
  readonly traceId: string;
  readonly goalId: string;
  readonly allowedTools: readonly string[];
  readonly modelCapabilities?: BasicAgentCapabilitySnapshot["modelCapabilities"];
};

export function createAgentTurnPolicyFromDefinition(
  input: CreateAgentTurnPolicyFromDefinitionInput
): AgentTurnPolicy {
  const definition = input.agentDefinition;
  return {
    allowModel: definition.turnPolicy.allowModel,
    allowedTools: [...input.allowedTools],
    ...(definition.turnPolicy.maxModelRounds === undefined
      ? {}
      : { maxModelRounds: definition.turnPolicy.maxModelRounds }),
    ...(definition.turnPolicy.maxToolRounds === undefined
      ? {}
      : { maxToolRounds: definition.turnPolicy.maxToolRounds }),
    fallback: definition.turnPolicy.fallback,
    callerAgentId: definition.agentId,
    traceId: input.traceId,
    goalId: input.goalId,
    purpose: definition.turnPolicy.purpose,
    outputContract: definition.outputContract,
    sensitivity: definition.turnPolicy.sensitivity,
    budget: {
      maxOutputTokens:
        input.modelCapabilities?.maxOutputTokens ??
        definition.turnPolicy.defaultMaxOutputTokens,
    },
  };
}

export type ResolveAgentRunCapabilitiesInput = {
  readonly agentDefinition: AgentDefinition;
  readonly snapshot: BasicAgentCapabilitySnapshot;
  readonly goal: string;
  readonly taskSoil: TaskSoil;
  readonly modelCapabilities?: BasicAgentCapabilitySnapshot["modelCapabilities"];
  readonly platform?: NodeJS.Platform;
};

export function resolveAgentRunCapabilities(input: ResolveAgentRunCapabilitiesInput): RunCapabilityResolution {
  return resolveRunCapabilities({
    snapshot: input.snapshot,
    goal: input.goal,
    agentDefinition: input.agentDefinition,
    taskSoil: input.taskSoil,
    platform: input.platform,
    modelSupportsToolCalling:
      input.modelCapabilities?.supportsToolCalling ??
      input.snapshot.modelCapabilities.supportsToolCalling,
  });
}

export function restrictRunCapabilityResolutionToExecutableTools(
  resolution: RunCapabilityResolution,
  toolCenter: ToolExecutionBroker | undefined
): RunCapabilityResolution {
  const executableTools = new Set(toolCenter?.list().map((tool) => tool.name) ?? []);
  if (executableTools.size === 0) {
    const hiddenExecutableToolCount = resolution.allowedTools.length;
    return {
      ...resolution,
      allowedTools: [],
      toolExposures: resolution.toolExposures.map((tool) =>
        tool.modelVisible
          ? { ...tool, modelVisible: false, reason: "本轮没有可执行的工具运行器。" }
          : tool
      ),
      warnings: capabilityWarningsAfterExecutableRestriction({
        warnings: resolution.warnings,
        hiddenCount: hiddenExecutableToolCount,
        noModelVisibleTools: true,
      }),
    };
  }
  const allowedTools = resolution.allowedTools.filter((toolName) => executableTools.has(toolName));
  const hiddenExecutableToolCount = resolution.allowedTools.length - allowedTools.length;
  return {
    ...resolution,
    allowedTools,
    toolExposures: resolution.toolExposures.map((tool) =>
      tool.modelVisible && !executableTools.has(tool.name)
        ? { ...tool, modelVisible: false, reason: "工具执行器当前未提供该工具。" }
        : tool
    ),
    warnings: hiddenExecutableToolCount <= 0
      ? resolution.warnings
      : capabilityWarningsAfterExecutableRestriction({
          warnings: resolution.warnings,
          hiddenCount: hiddenExecutableToolCount,
          noModelVisibleTools: allowedTools.length === 0,
        }),
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
