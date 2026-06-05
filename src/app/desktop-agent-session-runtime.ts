import type { IntelligenceChannel, ModelOutputContract } from "../domain/intelligence/contracts.js";
import type { ConstraintRef } from "../domain/constraints.js";
import type { TaskSoil } from "../domain/soil/task-soil.js";
import type { ToolExecutionBroker } from "../domain/tools/contracts.js";
import { AgentTurnRuntime } from "../kernel/intelligence/agent-turn-runtime.js";
import {
  compactBasicAgentLoopContextIfNeeded,
  createOpenAITokenCounter,
} from "./basic-agent-runtime/index.js";
import { resolveRunCapabilities } from "./capability-policy.js";
import {
  DESKTOP_ROOT_AGENT,
} from "./agent-prompts/desktop-root-agent.js";
import {
  filterToolNamesVisibleToAgentProfile,
} from "./agent-prompts/contracts.js";
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
    fetch: options.providerFetch,
    onModelOutputDelta: options.onModelOutputDelta,
    streamingMode: options.onModelOutputDelta === undefined ? "respect_profile" : "force_live",
  });
  if (!config.enabled) {
    throw createModelRuntimeDisabledConfigurationError(config.summaryInput);
  }
  return config.createIntelligenceChannel;
}

export function createDesktopAgentOutputContract(): ModelOutputContract {
  return DESKTOP_ROOT_AGENT.outputContract;
}

export function createDesktopAgentTurnRuntime(input: {
  readonly runtime: MinimalRuntime;
  readonly channel: IntelligenceChannel;
  readonly goal: string;
  readonly traceId: string;
  readonly goalId: string;
  readonly options: RunDesktopAgentSessionOptions;
  readonly toolCenter?: ToolExecutionBroker;
}): AgentTurnRuntime {
  const tokenCounter = createOpenAITokenCounter(resolveActiveModelName(input.options));
  return new AgentTurnRuntime({
    intelligenceChannel: input.channel,
    toolCenter: input.toolCenter,
    publishToolEvent: (message) => input.runtime.bus.publish(message),
    maintainContext: async (contextInput) => {
      const result = await compactBasicAgentLoopContextIfNeeded({
        goal: input.goal,
        traceId: input.traceId,
        goalId: input.goalId,
        messages: contextInput.messages,
        tools: contextInput.tools,
        intelligenceChannel: input.channel,
        modelCapabilities: input.options.modelCapabilities,
        tokenCounter,
      });
      if (result.status === "failed") {
        publishContextCompactionFailed({
          runtime: input.runtime,
          traceId: input.traceId,
          goalId: input.goalId,
          tokenCount: result.tokenCount,
          threshold: result.threshold,
          message: result.message,
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
          traceId: input.traceId,
          goalId: input.goalId,
          summaryId: result.conversationSummary.summaryId,
          tokenCount: result.tokenCount,
          threshold: result.threshold,
          coveredRefCount: result.conversationSummary.coveredRefs.length,
          messageCountAfter: result.messages.length,
          requestId: result.conversationSummary.modelRequestId,
          responseId: result.conversationSummary.modelResponseId,
        });
        return { status: "compacted", messages: result.messages };
      }
      return { status: "unchanged" };
    },
  });
}

export function resolveActiveModelName(options: RunDesktopAgentSessionOptions): string | undefined {
  return options.aiEnvironment?.AGENTARBOR_MODEL_NAME ?? process.env.AGENTARBOR_MODEL_NAME;
}

export function allowedToolsForDesktopAgent(toolCenter: ToolExecutionBroker): readonly string[] {
  return filterToolNamesVisibleToAgentProfile(
    DESKTOP_ROOT_AGENT.toolVisibilityProfile,
    toolCenter.list().map((tool) => tool.name)
  );
}

export function allowedToolsForRun(input: {
  readonly toolCenter: ToolExecutionBroker;
  readonly snapshot?: BasicAgentCapabilitySnapshot;
  readonly goal: string;
  readonly taskSoil: TaskSoil;
  readonly platform?: NodeJS.Platform;
}): readonly string[] {
  if (input.snapshot === undefined) {
    return allowedToolsForDesktopAgent(input.toolCenter);
  }
  return resolveRunCapabilities({
    snapshot: input.snapshot,
    goal: input.goal,
    agentDefinition: DESKTOP_ROOT_AGENT,
    taskSoil: input.taskSoil,
    platform: input.platform,
  }).allowedTools;
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
