import type { ModelRunReasoningEffort } from "../../domain/config/index.js";
import { agentDefinitionRefMatchesDefinition } from "../agent-definition-ref.js";
import { runDesktopAgentSession } from "../desktop-agent-session.js";
import { latestModelFailureTextForUser } from "../model-failure-visible-copy.js";
import type { ModelRuntimeMode } from "../model-runtime/index.js";
import { createDesktopAgentCanvas } from "../panel-desktop-agent-canvas.js";
import { createPanelRunTranscript } from "../panel-run-read-model.js";
import type { DesktopTaskSoilInput } from "../task-soil-workspace.js";
import { friendlyUserFacingFailureText } from "../visible-text-safety.js";
import { PanelHttpError } from "./http-utils.js";
import type { PanelRuntime } from "./runtime.js";
import { resolveTriggeredSkillContexts } from "./skill-service.js";
import { createDesktopToolCenterFactory } from "./desktop-run-resources.js";
import type {
  DesktopRunResources,
  PanelRunExecutionOptions,
  PanelRunExecutionResult,
} from "./run-execution-contracts.js";

export async function runOrdinaryDesktopForPanel(
  runtime: PanelRuntime,
  goal: string,
  aiMode: ModelRuntimeMode,
  taskSoilInput: DesktopTaskSoilInput | undefined,
  resources: DesktopRunResources,
  options: PanelRunExecutionOptions
): Promise<PanelRunExecutionResult> {
  const agentDefinition = options.agentDefinition ?? runtime.desktopAgentDefinition;
  if (options.agentDefinitionRef === undefined) {
    throw new PanelHttpError(
      500,
      "agent_definition_ref_required",
      "普通 Desktop Agent 运行缺少创建时冻结的 Agent 定义引用。"
    );
  }
  const agentDefinitionRef = options.agentDefinitionRef;
  if (!agentDefinitionRefMatchesDefinition(agentDefinitionRef, agentDefinition)) {
    throw new PanelHttpError(
      500,
      "agent_definition_mismatch",
      "运行记录中的 Agent 定义与当前执行定义不一致。"
    );
  }
  const releaseResources = () => {
    void resources.mcpManager?.disconnectAll?.().catch(() => undefined);
  };
  const agent = await runDesktopAgentSession(goal, {
    aiMode,
    createIntelligenceChannel: resources.aiConfig.createIntelligenceChannel,
    createToolCenter: createDesktopToolCenterFactory(runtime.providerFetch, resources),
    taskSoilInput,
    agentDefinition,
    conversationHistory: options.conversationHistory,
    skillContexts: await resolveTriggeredSkillContexts(runtime, goal, resources.capabilitySnapshot.skillCatalog),
    modelCapabilities: resources.capabilitySnapshot.modelCapabilities,
    capabilitySnapshot: resources.capabilitySnapshot,
    platform: process.platform,
    abortSignal: options.abortSignal,
    onRuntimeReady: options.onRuntimeReady,
    onModelOutputDelta: options.onModelOutputDelta,
  });
  return desktopPanelResultFromAgent(agent, {
    config: resources.capabilitySnapshot.activeModel,
    informationAccess: resources.informationAccess,
    capabilitySnapshot: resources.capabilitySnapshot,
    agentDefinitionRef,
  }, options.reasoningEffort, releaseResources);
}

type OrdinaryDesktopPanelFacts = {
  readonly config: NonNullable<PanelRunExecutionResult["config"]>;
  readonly informationAccess: NonNullable<PanelRunExecutionResult["informationAccess"]>;
  readonly capabilitySnapshot: NonNullable<PanelRunExecutionResult["capabilitySnapshot"]>;
  readonly agentDefinitionRef: NonNullable<PanelRunExecutionResult["agentDefinitionRef"]>;
};

function desktopPanelResultFromAgent(
  agent: Awaited<ReturnType<typeof runDesktopAgentSession>>,
  facts: OrdinaryDesktopPanelFacts,
  reasoningEffort?: ModelRunReasoningEffort,
  releaseResources?: () => void
): PanelRunExecutionResult {
  if (
    agent.status === "completed" ||
    agent.status === "confirmation_needed" ||
    agent.status === "paused" ||
    agent.status === "failed"
  ) {
    const eventEntries = agent.runtime.eventLog.list();
    const transcriptStatus =
      agent.status === "paused"
        ? "blocked"
        : agent.status === "failed"
          ? "failed"
        : agent.status === "confirmation_needed"
          ? "approval_needed"
          : "completed";
    const transcript = createPanelRunTranscript({
      runId: agent.traceId,
      status: transcriptStatus,
      eventEntries,
      agentDefinitionRef: facts.agentDefinitionRef,
      desktopMode: "agent",
      reasoningEffort,
      createdAt: eventEntries[0]?.recordedAt ?? new Date(0).toISOString(),
      updatedAt: eventEntries.at(-1)?.recordedAt ?? new Date(0).toISOString(),
    });
    if (agent.pendingApproval === undefined) {
      releaseResources?.();
    }
    return {
      ...facts,
      completed: agent.status === "completed" ? true : undefined,
      eventEntries,
      capabilityResolution: frozenCapabilityResolution(agent.capabilityResolution, facts.agentDefinitionRef),
      canvas: createDesktopAgentCanvas({
        result: agent,
        transcript,
      }),
      failed:
        agent.status === "failed"
          ? failedRunFromAgent(agent)
          : undefined,
      blocked:
        agent.status === "paused"
          ? blockedRunFromPausedAgent(agent)
          : undefined,
      pendingApproval:
        agent.pendingApproval === undefined
          ? undefined
          : {
              confirmationId: agent.pendingApproval.confirmationId,
              resume: async (resumeInput) => {
                const resumed = await agent.pendingApproval!.resume(resumeInput);
                return desktopPanelResultFromAgent(resumed, facts, reasoningEffort, releaseResources);
              },
              resumeWithDecision: async (resumeInput) => {
                const resumed = await agent.pendingApproval!.resumeWithDecision(resumeInput);
                return desktopPanelResultFromAgent(resumed, facts, reasoningEffort, releaseResources);
              },
            },
    };
  }

  releaseResources?.();
  throw new PanelHttpError(500, "desktop_agent_stopped", agent.failureMessage ?? "桌面 Agent 运行已停止。");
}

function frozenCapabilityResolution(
  resolution: PanelRunExecutionResult["capabilityResolution"],
  agentDefinitionRef: OrdinaryDesktopPanelFacts["agentDefinitionRef"]
): PanelRunExecutionResult["capabilityResolution"] {
  return resolution === undefined
    ? undefined
    : {
        ...resolution,
        agentId: agentDefinitionRef.agentId,
        agentDisplayName: agentDefinitionRef.agentDisplayName,
        toolVisibilityProfileId: agentDefinitionRef.toolVisibilityProfileId,
      };
}

function failedRunFromAgent(
  agent: Awaited<ReturnType<typeof runDesktopAgentSession>>
): NonNullable<PanelRunExecutionResult["failed"]> {
  const eventEntries = agent.runtime.eventLog.list();
  return {
    code: "desktop_agent_failed",
    message:
      latestModelFailureTextForUser(eventEntries) ??
      friendlyUserFacingFailureText(agent.failureMessage ?? "桌面 Agent 没有形成最终结果。"),
  };
}

function blockedRunFromPausedAgent(
  agent: Awaited<ReturnType<typeof runDesktopAgentSession>>
): NonNullable<PanelRunExecutionResult["blocked"]> {
  return {
    code: agent.stopReason ?? "agent_paused",
    message:
      agent.failureMessage ??
      "运行被外部边界中断，任务没有完成。你可以继续发送消息让我接着处理。",
  };
}
