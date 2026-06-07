import type { IntelligenceChannel, ModelOutputContract } from "../domain/intelligence/contracts.js";
import type { ObservationRef } from "../domain/observation/contracts.js";
import type { ToolExecutionBroker } from "../domain/tools/contracts.js";
import { AgentTurnRuntime, type AgentTurnRuntimeResult } from "../kernel/intelligence/agent-turn-runtime.js";
import {
  createUndergroundAiRuntimeConfig,
  type UndergroundAiMode,
} from "./underground-ai-runtime.js";
import type { MinimalRuntime } from "./runtime.js";
import type { RunCognitiveWorkSessionOptions } from "./cognitive-work-session-contracts.js";

export function createIntelligenceChannelFromOptions(
  aiMode: UndergroundAiMode,
  options: RunCognitiveWorkSessionOptions
): ((runtime: MinimalRuntime) => IntelligenceChannel) | undefined {
  const aiConfig = createUndergroundAiRuntimeConfig({
    mode: aiMode,
    env: options.aiEnvironment,
    fetch: options.providerFetch,
    onModelOutputDelta: options.onModelOutputDelta,
  });
  if (!aiConfig.enabled) {
    return undefined;
  }
  return aiConfig.createIntelligenceChannel;
}

export function createWorkSessionTurnRuntime(input: {
  readonly runtime: MinimalRuntime;
  readonly intelligenceChannel: (runtime: MinimalRuntime) => IntelligenceChannel;
  readonly toolCenter?: ToolExecutionBroker;
}): AgentTurnRuntime {
  return new AgentTurnRuntime({
    intelligenceChannel: input.intelligenceChannel(input.runtime),
    toolCenter: input.toolCenter,
    publishToolEvent: (message) => input.runtime.bus.publish(message),
  });
}

export async function executeRequiredTurn(input: {
  readonly turnRuntime: AgentTurnRuntime;
  readonly traceId: string;
  readonly goalId: string;
  readonly callerAgentId: string;
  readonly callerRef: ObservationRef;
  readonly purpose:
    | "work_session_decision"
    | "work_session_child_material"
    | "work_session_synthesis"
    | "work_session_direct_answer";
  readonly outputContract: ModelOutputContract;
  readonly inputRefs: readonly ObservationRef[];
  readonly messages: readonly { readonly role: "system" | "user"; readonly content: string; readonly ref?: string }[];
  readonly allowedTools: readonly string[];
  readonly maxModelRounds: number;
  readonly maxToolRounds: number;
}): Promise<AgentTurnRuntimeResult> {
  const result = await input.turnRuntime.execute({
    policy: {
      allowModel: true,
      allowedTools: input.allowedTools,
      maxModelRounds: input.maxModelRounds,
      maxToolRounds: input.maxToolRounds,
      fallback: "disabled",
      callerAgentId: input.callerAgentId,
      traceId: input.traceId,
      goalId: input.goalId,
      purpose: input.purpose,
      outputContract: input.outputContract,
      sensitivity: "internal",
      budget: {
        maxOutputTokens: 1200,
        maxLatencyMs: 60_000,
      },
    },
    callerRef: input.callerRef,
    inputRefs: input.inputRefs,
    sanitizedMessages: input.messages,
    constraintRefs: [],
  });
  if (result.status !== "completed" || result.finalOutput?.status !== "completed") {
    throw new Error(`Work Session model turn failed: ${input.purpose} / ${input.outputContract.contractId}`);
  }
  return result;
}
