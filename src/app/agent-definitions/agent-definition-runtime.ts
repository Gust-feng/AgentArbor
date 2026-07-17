import type { BasicAgentCapabilitySnapshot, RunCapabilityResolution } from "../../domain/config/index.js";
import type { TaskSoil } from "../../domain/soil/index.js";
import type { ToolConfirmationPolicy, ToolDefinition } from "../../domain/tools/index.js";
import type { AgentTurnPolicy } from "../../kernel/intelligence/agent-turn-runtime.js";
import type { AgentDefinition } from "../agent-prompts/contracts.js";
import { resolveRunCapabilities } from "../capability/capability-policy.js";
import { createRunCapabilityPlan } from "../model-runtime/model-capability-registry.js";

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
  readonly toolDefinitions?: readonly ToolDefinition[];
  readonly confirmationPolicy?: ToolConfirmationPolicy;
  readonly modelCapabilities?: BasicAgentCapabilitySnapshot["modelCapabilities"];
};

export function createAgentTurnPolicyFromDefinition(
  input: CreateAgentTurnPolicyFromDefinitionInput
): AgentTurnPolicy {
  const definition = input.agentDefinition;
  return {
    allowModel: definition.turnPolicy.allowModel,
    allowedTools: [...input.allowedTools],
    toolDefinitions: input.toolDefinitions?.map((tool) => globalThis.structuredClone(tool)),
    confirmationPolicy: input.confirmationPolicy,
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
  const modelCapabilities = input.modelCapabilities ?? input.snapshot.modelCapabilities;
  return resolveRunCapabilities({
    snapshot: input.snapshot,
    skillCatalog: input.snapshot.skillCatalog,
    goal: input.goal,
    agentDefinition: input.agentDefinition,
    taskSoil: input.taskSoil,
    platform: input.platform,
    capabilityPlan: createRunCapabilityPlan({
      profile: input.snapshot.activeModel,
      modelCapabilities,
    }),
  });
}
