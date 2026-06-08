import type { BasicAgentCapabilitySnapshot, ModelCapabilities, RunCapabilityResolution } from "../domain/config/index.js";
import type { IntelligenceChannel } from "../domain/intelligence/index.js";
import type { TaskSoil } from "../domain/soil/index.js";
import type { AgentTurnPolicy, AgentTurnRuntime } from "../kernel/intelligence/index.js";
import { createOpenAITokenCounter, type BasicAgentContextPack } from "./basic-agent-runtime/index.js";
import type { AgentDefinition } from "./agent-prompts/contracts.js";
import { desktopAgentContextPack } from "./desktop-agent-prompts.js";
import type { RunDesktopAgentSessionOptions } from "./desktop-agent-session-contracts.js";
import {
  createDesktopAgentTurnPolicy,
  createDesktopAgentTurnRuntime,
  resolveActiveModelName,
  resolveDesktopAgentRunCapabilities,
  restrictRunCapabilityResolutionToExecutableTools,
} from "./desktop-agent-session-runtime.js";
import type { MinimalRuntime } from "./runtime.js";
import type { ModelRuntimeMode } from "./model-runtime/index.js";

export type DesktopAgentLoopPreparationInput = {
  readonly runtime: MinimalRuntime;
  readonly agentDefinition: AgentDefinition;
  readonly goal: string;
  readonly taskSoil: TaskSoil;
  readonly traceId: string;
  readonly goalId: string;
  readonly aiMode: ModelRuntimeMode;
  readonly channel: IntelligenceChannel;
  readonly options: RunDesktopAgentSessionOptions;
};

export type DesktopAgentLoopPreparation = {
  readonly contextPack: BasicAgentContextPack;
  readonly turnRuntime: AgentTurnRuntime;
  readonly turnPolicy: AgentTurnPolicy;
  readonly capabilityResolution?: RunCapabilityResolution;
};

export function prepareDesktopAgentLoop(input: DesktopAgentLoopPreparationInput): DesktopAgentLoopPreparation {
  const modelCapabilities = modelCapabilitiesForDesktopRun(input.aiMode, input.options);
  const mayExposeTools =
    modelCapabilities?.supportsToolCalling !== false &&
    input.options.createToolCenter !== undefined;
  if (mayExposeTools && input.options.capabilitySnapshot === undefined) {
    throw new Error("Desktop Agent requires a capability snapshot before exposing tools to the model.");
  }

  const toolCenter = mayExposeTools ? input.options.createToolCenter?.(input.runtime) : undefined;
  toolCenter?.resetCallCount();

  const tokenCounter = createOpenAITokenCounter(resolveActiveModelName(input.options));
  const contextPack = desktopAgentContextPack({
    agentDefinition: input.agentDefinition,
    goal: input.goal,
    taskSoil: input.taskSoil,
    conversationHistory: input.options.conversationHistory ?? [],
    skillContexts: input.options.skillContexts ?? [],
    modelCapabilities,
    tokenCounter,
  });
  const turnRuntime = createDesktopAgentTurnRuntime({
    runtime: input.runtime,
    agentId: input.agentDefinition.agentId,
    agentDisplayName: input.agentDefinition.displayName,
    channel: input.channel,
    goal: input.goal,
    traceId: input.traceId,
    goalId: input.goalId,
    options: input.options,
    modelCapabilities,
    toolCenter,
  });
  const capabilityResolution =
    input.options.capabilitySnapshot === undefined
      ? undefined
      : restrictRunCapabilityResolutionToExecutableTools(
          resolveDesktopAgentRunCapabilities({
            agentDefinition: input.agentDefinition,
            snapshot: input.options.capabilitySnapshot,
            goal: input.goal,
            taskSoil: input.taskSoil,
            modelCapabilities,
            platform: input.options.platform,
          }),
          toolCenter
        );
  const turnPolicy = createDesktopAgentTurnPolicy({
    agentDefinition: input.agentDefinition,
    traceId: input.traceId,
    goalId: input.goalId,
    allowedTools: capabilityResolution?.allowedTools ?? [],
    modelCapabilities,
  });

  return {
    contextPack,
    turnRuntime,
    turnPolicy,
    capabilityResolution,
  };
}

export function modelCapabilitiesForDesktopRun(
  aiMode: ModelRuntimeMode,
  options: Pick<RunDesktopAgentSessionOptions, "capabilitySnapshot" | "modelCapabilities">
): ModelCapabilities | undefined {
  const modelCapabilities = options.capabilitySnapshot?.modelCapabilities ?? options.modelCapabilities;
  if (
    options.capabilitySnapshot !== undefined ||
    aiMode !== "fake" ||
    modelCapabilities === undefined ||
    modelCapabilities.supportsToolCalling
  ) {
    return modelCapabilities;
  }
  return {
    ...modelCapabilities,
    supportsToolCalling: true,
  };
}
