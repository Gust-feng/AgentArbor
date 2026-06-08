import type { BasicAgentCapabilitySnapshot, RunCapabilityResolution } from "../domain/config/index.js";
import type { TaskSoil } from "../domain/soil/index.js";
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
