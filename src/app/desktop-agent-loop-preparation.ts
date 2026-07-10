import type { BasicAgentCapabilitySnapshot, ModelCapabilities, RunCapabilityResolution } from "../domain/config/index.js";
import type { IntelligenceChannel } from "../domain/intelligence/index.js";
import type { TaskSoil } from "../domain/soil/index.js";
import type { AgentTurnPolicy, AgentTurnRuntime } from "../kernel/intelligence/index.js";
import { createSubAgentToolExecutors } from "./sub-agents/sub-agent-tools.js";
import { SubAgentRegistry } from "./sub-agents/sub-agent-registry.js";
import { createOpenAITokenCounter, type BasicAgentContextPack } from "./basic-agent-runtime/index.js";
import type { AgentDefinition } from "./agent-prompts/contracts.js";
import { desktopAgentContextPack } from "./desktop-agent/desktop-agent-prompts.js";
import type { RunDesktopAgentSessionOptions } from "./desktop-agent-session-contracts.js";
import {
  createDesktopAgentTurnPolicy,
  createDesktopAgentTurnRuntime,
  resolveActiveModelName,
} from "./desktop-agent-session-runtime.js";
import type { MinimalRuntime } from "./runtime.js";
import type { ModelRuntimeMode } from "./model-runtime/index.js";
import { createRunCapabilityPlan } from "./model-capability-registry.js";
import { resolveRunToolBoundary } from "./run-tool-boundary.js";

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
  readonly modelCapabilities?: ModelCapabilities;
  readonly capabilityResolution?: RunCapabilityResolution;
};

export function prepareDesktopAgentLoop(input: DesktopAgentLoopPreparationInput): DesktopAgentLoopPreparation {
  const modelCapabilities = modelCapabilitiesForDesktopRun(input.aiMode, input.options);
  const capabilityPlan = input.options.capabilitySnapshot === undefined
    ? undefined
    : createRunCapabilityPlan({
        profile: input.options.capabilitySnapshot.activeModel,
        modelCapabilities: modelCapabilities ?? input.options.capabilitySnapshot.modelCapabilities,
      });
  const mayExposeTools =
    (capabilityPlan?.canExposeModelTools ?? modelCapabilities?.supportsToolCalling) !== false &&
    input.options.createToolCenter !== undefined;
  if (mayExposeTools && input.options.capabilitySnapshot === undefined) {
    throw new Error("Desktop Agent requires a capability snapshot before exposing tools to the model.");
  }

  const skillContexts = input.options.skillContexts ?? [];
  const toolCenter = mayExposeTools
    ? input.options.createToolCenter?.(input.runtime, {
        runtime: input.runtime,
        traceId: input.traceId,
        goalId: input.goalId,
        skillContexts,
        taskSoil: input.taskSoil,
      })
    : undefined;
  toolCenter?.resetCallCount();

  let parentAllowedTools: readonly string[] = [];
  if (toolCenter !== undefined && input.options.subAgentRoots !== undefined && toolCenter.register !== undefined) {
    const subAgentRegistry = new SubAgentRegistry(
      input.options.capabilitySnapshot === undefined
        ? { roots: input.options.subAgentRoots }
        : {
            roots: input.options.subAgentRoots,
            catalog: input.options.capabilitySnapshot.subAgentCatalog,
          }
    );
    const executors = createSubAgentToolExecutors({
      subAgentRegistry,
      channel: input.channel,
      toolBroker: toolCenter,
      allowedTools: () => parentAllowedTools,
      confirmationPolicy: () => input.options.toolConfirmationPolicy,
      publishToolEvent: (message) => input.runtime.bus.publish(message),
      traceSink: input.runtime.subAgentRunTraceStore,
      traceReader: input.runtime.subAgentRunTraceStore,
      includeSpawnTool: true,
      eventLog: input.runtime.eventLog,
    });
    for (const executor of executors) {
      toolCenter.register(executor);
    }
  }

  const tokenCounter = createOpenAITokenCounter(resolveActiveModelName(input.options));
  const contextPack = desktopAgentContextPack({
    agentDefinition: input.agentDefinition,
    goal: input.goal,
    taskSoil: input.taskSoil,
    conversationHistory: input.options.conversationHistory ?? [],
    conversationSummary: input.options.conversationSummary,
    interruptedRunContexts: input.options.interruptedRunContexts,
    skillContexts,
    toolEvidence: input.options.toolEvidence,
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
  const toolBoundary = resolveRunToolBoundary({
    agentDefinition: input.agentDefinition,
    snapshot: input.options.capabilitySnapshot,
    goal: input.goal,
    taskSoil: input.taskSoil,
    modelCapabilities,
    capabilityPlan,
    platform: input.options.platform,
    toolCenter,
    skillContexts,
  });
  parentAllowedTools = toolBoundary.allowedTools;
  const turnPolicy = createDesktopAgentTurnPolicy({
    agentDefinition: input.agentDefinition,
    traceId: input.traceId,
    goalId: input.goalId,
    allowedTools: toolBoundary.allowedTools,
    toolDefinitions: toolBoundary.toolDefinitions,
    confirmationPolicy: input.options.toolConfirmationPolicy,
    modelCapabilities,
  });

  return {
    contextPack,
    turnRuntime,
    turnPolicy,
    modelCapabilities,
    capabilityResolution: toolBoundary.capabilityResolution,
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
