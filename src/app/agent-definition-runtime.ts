import { createHash } from "node:crypto";
import type { BasicAgentCapabilitySnapshot, RunAgentDefinitionRef, RunCapabilityResolution } from "../domain/config/index.js";
import type { TaskSoil } from "../domain/soil/index.js";
import type { ToolExecutionBroker } from "../domain/tools/index.js";
import type { AgentTurnPolicy } from "../kernel/intelligence/agent-turn-runtime.js";
import type { AgentDefinition } from "./agent-prompts/contracts.js";
import { resolveRunCapabilities } from "./capability-policy.js";

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

export function runAgentDefinitionRef(definition: AgentDefinition): RunAgentDefinitionRef {
  return {
    agentId: definition.agentId,
    agentDisplayName: definition.displayName,
    promptRef: definition.prompt.promptRef,
    promptVersion: definition.prompt.version,
    outputContractId: definition.outputContract.contractId,
    toolVisibilityProfileId: definition.toolVisibilityProfile.profileId,
    definitionHash: agentDefinitionHash(definition),
  };
}

export function agentDefinitionHash(definition: AgentDefinition): string {
  const semanticDefinition = {
    agentId: definition.agentId,
    prompt: definition.prompt,
    turnPolicy: definition.turnPolicy,
    outputContract: definition.outputContract,
    toolVisibilityProfile: definition.toolVisibilityProfile,
  };
  return `sha256:${createHash("sha256").update(stableJson(semanticDefinition)).digest("hex")}`;
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
  if (input.noModelVisibleTools && !next.includes("本轮没有模型可见工具。")) {
    next.push("本轮没有模型可见工具。");
  }
  if (input.hiddenCount > 0 && !next.some((warning) => warning.includes("工具执行器"))) {
    next.push(`本轮有 ${input.hiddenCount} 个策略可见工具没有对应的工具执行器。`);
  }
  return next;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableJsonValue(value));
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableJsonValue);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const record = value as Readonly<Record<string, unknown>>;
  return Object.fromEntries(
    Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => [key, stableJsonValue(record[key])])
  );
}
