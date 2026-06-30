import type { IntelligenceChannel } from "../domain/intelligence/contracts.js";
import type { ConstraintRef } from "../domain/constraints.js";
import type { TaskSoil } from "../domain/soil/task-soil.js";
import type { ToolExecutionBroker } from "../domain/tools/contracts.js";
import {
  AgentTurnRuntime,
  type AgentTurnPolicy,
} from "../kernel/intelligence/agent-turn-runtime.js";
import {
  compactAgentLoopContextIfNeeded,
  createOpenAITokenCounter,
} from "./agent-loop-context-maintenance.js";
import {
  DESKTOP_ROOT_AGENT,
} from "./agent-prompts/desktop-root-agent.js";
import {
  createAgentTurnPolicyFromDefinition,
} from "./agent-definition-runtime.js";
import {
  createModelRuntimeConfig,
  createModelRuntimeDisabledConfigurationError,
  type ModelRuntimeMode,
} from "./model-runtime/index.js";
import type { MinimalRuntime } from "./runtime.js";
import type { RunDesktopAgentSessionOptions } from "./desktop-agent-session-contracts.js";
import type { BasicAgentCapabilitySnapshot } from "../domain/config/contracts.js";
import {
  publishContextCompactionCompleted,
  publishContextCompactionFailed,
} from "./desktop-agent-session-events.js";

type DesktopAgentDefinition = NonNullable<RunDesktopAgentSessionOptions["agentDefinition"]>;

export function createIntelligenceChannelFromOptions(
  aiMode: ModelRuntimeMode,
  options: RunDesktopAgentSessionOptions
): ((runtime: MinimalRuntime) => IntelligenceChannel) | undefined {
  if (aiMode === "none") {
    return undefined;
  }
  const config = createModelRuntimeConfig({
    mode: aiMode,
    env: options.aiEnvironment,
    modelProvider: options.capabilitySnapshot?.activeModel,
    fetch: options.providerFetch,
    onModelOutputDelta: options.onModelOutputDelta,
    onContextWindowExceeded: options.onContextWindowExceeded,
    streamingMode: options.onModelOutputDelta === undefined ? "respect_profile" : "force_live",
  });
  if (!config.enabled) {
    throw createModelRuntimeDisabledConfigurationError(config.summaryInput);
  }
  return config.createIntelligenceChannel;
}

export function createDesktopAgentTurnPolicy(input: {
  readonly agentDefinition?: DesktopAgentDefinition;
  readonly traceId: string;
  readonly goalId: string;
  readonly allowedTools: readonly string[];
  readonly confirmationPolicy?: RunDesktopAgentSessionOptions["toolConfirmationPolicy"];
  readonly modelCapabilities?: BasicAgentCapabilitySnapshot["modelCapabilities"];
}): AgentTurnPolicy {
  return createAgentTurnPolicyFromDefinition({
    agentDefinition: input.agentDefinition ?? DESKTOP_ROOT_AGENT,
    traceId: input.traceId,
    goalId: input.goalId,
    allowedTools: input.allowedTools,
    confirmationPolicy: input.confirmationPolicy,
    modelCapabilities: input.modelCapabilities,
  });
}

export function createDesktopAgentTurnRuntime(input: {
  readonly runtime: MinimalRuntime;
  readonly agentId: string;
  readonly agentDisplayName: string;
  readonly channel: IntelligenceChannel;
  readonly goal: string;
  readonly traceId: string;
  readonly goalId: string;
  readonly options: RunDesktopAgentSessionOptions;
  readonly modelCapabilities?: BasicAgentCapabilitySnapshot["modelCapabilities"];
  readonly toolCenter?: ToolExecutionBroker;
}): AgentTurnRuntime {
  const tokenCounter = createOpenAITokenCounter(resolveActiveModelName(input.options));
  return new AgentTurnRuntime({
    intelligenceChannel: input.channel,
    toolCenter: input.toolCenter,
    publishToolEvent: (message) => input.runtime.bus.publish(message),
    maintainContext: async (contextInput) => {
      const result = await compactAgentLoopContextIfNeeded({
        goal: input.goal,
        traceId: input.traceId,
        goalId: input.goalId,
        agentIdentity: {
          agentId: input.agentId,
          displayName: input.agentDisplayName,
        },
        messages: contextInput.messages,
        tools: contextInput.tools,
        intelligenceChannel: input.channel,
        modelCapabilities: input.modelCapabilities,
        tokenCounter,
      });
      if (result.status === "failed") {
        publishContextCompactionFailed({
          runtime: input.runtime,
          agentId: input.agentId,
          traceId: input.traceId,
          goalId: input.goalId,
          tokenCount: result.tokenCount,
          threshold: result.threshold,
          message: result.message,
          scope: "loop_context",
          requestId: result.requestId,
          responseId: result.responseId,
        });
        return {
          status: "failed",
          message: result.message,
          requestId: result.requestId,
          responseId: result.responseId,
          retryable: true,
        };
      }
      if (result.status === "compacted") {
        publishContextCompactionCompleted({
          runtime: input.runtime,
          agentId: input.agentId,
          traceId: input.traceId,
          goalId: input.goalId,
          summaryId: result.conversationSummary.summaryId,
          tokenCount: result.tokenCount,
          threshold: result.threshold,
          coveredRefCount: result.conversationSummary.coveredRefs.length,
          messageCountAfter: result.messages.length,
          scope: "loop_context",
          requestId: result.conversationSummary.modelRequestId,
          responseId: result.conversationSummary.modelResponseId,
        });
        return { status: "compacted", messages: result.messages };
      }
      return { status: "unchanged" };
    },
  });
}

export function resolveDesktopAgentAiMode(options: RunDesktopAgentSessionOptions): ModelRuntimeMode {
  return options.aiMode ?? options.capabilitySnapshot?.activeModel.defaultAiMode ?? "openai-responses";
}

export function resolveActiveModelName(options: RunDesktopAgentSessionOptions): string | undefined {
  return (
    options.capabilitySnapshot?.activeModel.model ??
    options.aiEnvironment?.AGENTARBOR_MODEL_NAME ??
    process.env.AGENTARBOR_MODEL_NAME
  );
}

export function constraintRefsFromTaskSoil(taskSoil: TaskSoil): readonly ConstraintRef[] {
  const constraintRefs = taskSoil.constraints.map((constraint): ConstraintRef => ({
    constraintId: constraint.id,
    requiredLevel: constraint.level,
    enforcementGate: constraint.enforcementGate,
  }));
  const permissionRefs = taskSoil.permissionBoundaryRefs.map((permission): ConstraintRef => ({
    constraintId: permission,
    requiredLevel: "hard",
    enforcementGate: "tool_execution",
  }));
  return [...constraintRefs, ...permissionRefs];
}
