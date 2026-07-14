import { agentDefinitionRefMatchesDefinition } from "../agent-definition-ref.js";
import { runDesktopAgentSession } from "../desktop-agent/desktop-agent-session.js";
import { latestModelFailureTextForUser } from "../panel-read-model/run/panel-model-failure-copy.js";
import type { ModelRuntimeMode } from "../model-runtime/index.js";
import { createDesktopAgentCanvas } from "../panel-read-model/canvas/panel-desktop-agent-canvas.js";
import type { DesktopTaskSoilInput } from "../task-soil-workspace.js";
import { friendlyUserFacingFailureText } from "../text-projection/visible-text-safety.js";
import { PanelHttpError } from "./http-utils.js";
import type { PanelRuntime } from "./runtime.js";
import { resolveTriggeredSkillContexts, type ResolveTriggeredSkillContextsOptions } from "./skill-service.js";
import { createAgentToolCenterFactory } from "./agent-run-resources.js";
import { createHostAgentToolContributions } from "./agent-tool-contributions.js";
import { createSkillToolRegistryContribution } from "../skills/skill-resource-tool.js";
import type { DesktopAgentConversationMessage, DesktopAgentSkillResolverContext } from "../desktop-agent/desktop-agent-session-contracts.js";
import type {
  AgentRunResources,
  PanelRunExecutionOptions,
  PanelRunExecutionResult,
} from "./run-execution-contracts.js";
import { confirmationActionSummaryText } from "../text-projection/confirmation-copy.js";
import type { BasicAgentOrdinaryRunFacts } from "../basic-agent-runtime/run-job.js";

export type OrdinaryDesktopPanelRunExecutionInput = {
  readonly runtime: PanelRuntime;
  readonly goal: string;
  readonly aiMode: ModelRuntimeMode;
  readonly taskSoilInput: DesktopTaskSoilInput | undefined;
  readonly resources: AgentRunResources;
  readonly options: PanelRunExecutionOptions;
};

export async function executeOrdinaryDesktopRunForPanel(
  input: OrdinaryDesktopPanelRunExecutionInput
): Promise<PanelRunExecutionResult> {
  const { runtime, goal, aiMode, taskSoilInput, resources, options } = input;
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
  let releasePromise: Promise<void> | undefined;
  const releaseResources = (): Promise<void> => {
    releasePromise ??= resources.release();
    return releasePromise;
  };
  const createSharedToolCenter = createAgentToolCenterFactory(runtime.providerFetch, resources);
  let agent: Awaited<ReturnType<typeof runDesktopAgentSession>>;
  try {
    agent = await runDesktopAgentSession(goal, {
      aiMode,
      createIntelligenceChannel: resources.aiConfig.createIntelligenceChannel,
      createToolCenter: (toolRuntime, context) => createSharedToolCenter(toolRuntime, {
        taskSoil: context?.taskSoil,
        contributions: [
          ...createHostAgentToolContributions({
            runtime: toolRuntime,
            resources,
            providerFetch: runtime.providerFetch,
          }),
          ...(context === undefined
            ? []
            : [createSkillToolRegistryContribution(context.skillContexts)]),
        ],
      }),
      taskSoilInput,
      agentDefinition,
      conversationHistory: options.conversationHistory,
      interruptedRunContexts: options.interruptedRunContexts,
      priorToolCallContexts: options.priorToolCallContexts,
      resolveSkillContexts: (context) =>
        resolveTriggeredSkillContexts(
          runtime,
          goal,
          resources.capabilitySnapshot.skillCatalog,
          skillTriggerOptions(resources.capabilitySnapshot.skillTrigger?.mode ?? "keyword", context)
        ),
      modelCapabilities: resources.capabilitySnapshot.modelCapabilities,
      capabilitySnapshot: resources.capabilitySnapshot,
      workspaceRoot: resources.workspaceRoot,
      toolConfirmationPolicy: options.toolConfirmationPolicy,
      platform: process.platform,
      subAgentRoots: runtime.resolveSubAgentRoots?.({ workspaceDirectory: resources.workspaceRoot }) ?? runtime.subAgentRoots,
      abortSignal: options.abortSignal,
      onRuntimeReady: options.onRuntimeReady,
      onModelOutputDelta: options.onModelOutputDelta,
    });
  } catch (error) {
    await releaseResources();
    throw error;
  }
  return desktopPanelResultFromAgent(agent, {
    config: resources.capabilitySnapshot.activeModel,
    informationAccess: resources.informationAccess,
    capabilitySnapshot: resources.capabilitySnapshot,
    agentDefinitionRef,
  }, releaseResources);
}

function skillTriggerOptions(
  mode: "keyword" | "model",
  context: DesktopAgentSkillResolverContext
): ResolveTriggeredSkillContextsOptions {
  if (mode !== "model") {
    return {
      routingMode: "keyword",
      abortSignal: context.abortSignal,
    };
  }
  return {
    routingMode: "model",
    intelligenceChannel: context.intelligenceChannel,
    historySummary: skillRouterHistorySummary(context.conversationHistory),
    traceId: context.traceId,
    callerRef: `skill-router:${context.goalId}`,
    abortSignal: context.abortSignal,
  };
}

function skillRouterHistorySummary(
  history: readonly DesktopAgentConversationMessage[]
): string | undefined {
  const recent = history.slice(-6);
  if (recent.length === 0) {
    return undefined;
  }
  const summary = recent
    .map((message) => `${message.role}: ${compactSkillRouterHistoryText(message.content, 700)}`)
    .join("\n");
  return summary.length === 0 ? undefined : compactSkillRouterHistoryText(summary, 2_400);
}

function compactSkillRouterHistoryText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

type OrdinaryDesktopPanelFacts = {
  readonly config: NonNullable<PanelRunExecutionResult["config"]>;
  readonly informationAccess: NonNullable<PanelRunExecutionResult["informationAccess"]>;
  readonly capabilitySnapshot: NonNullable<PanelRunExecutionResult["capabilitySnapshot"]>;
  readonly agentDefinitionRef: NonNullable<PanelRunExecutionResult["agentDefinitionRef"]>;
};

async function desktopPanelResultFromAgent(
  agent: Awaited<ReturnType<typeof runDesktopAgentSession>>,
  facts: OrdinaryDesktopPanelFacts,
  releaseResources: () => Promise<void>
): Promise<PanelRunExecutionResult> {
  if (
    agent.status === "completed" ||
    agent.status === "confirmation_needed" ||
    agent.status === "paused" ||
    agent.status === "failed"
  ) {
    const eventEntries = agent.runtime.eventLog.list();
    if (agent.pendingApproval === undefined) {
      await releaseResources();
    }
    return {
      ...facts,
      completed: agent.status === "completed" ? true : undefined,
      eventEntries,
      ordinary: ordinaryRunFactsFromAgent(agent),
      capabilityResolution: frozenCapabilityResolution(agent.capabilityResolution, facts.agentDefinitionRef),
      canvas: createDesktopAgentCanvas({
        result: agent,
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
              release: releaseResources,
              resume: async (resumeInput) => {
                try {
                  const resumed = await agent.pendingApproval!.resume(resumeInput);
                  return await desktopPanelResultFromAgent(resumed, facts, releaseResources);
                } catch (error) {
                  await releaseResources();
                  throw error;
                }
              },
              resumeWithDecision: async (resumeInput) => {
                try {
                  const resumed = await agent.pendingApproval!.resumeWithDecision(resumeInput);
                  return await desktopPanelResultFromAgent(resumed, facts, releaseResources);
                } catch (error) {
                  await releaseResources();
                  throw error;
                }
              },
            },
    };
  }

  await releaseResources();
  throw new PanelHttpError(500, "desktop_agent_stopped", agent.failureMessage ?? "桌面 Agent 运行已停止。");
}

function ordinaryRunFactsFromAgent(
  agent: Awaited<ReturnType<typeof runDesktopAgentSession>>
): BasicAgentOrdinaryRunFacts {
  const pending = agent.pendingConfirmation;
  return {
    answer: agent.answer === undefined
      ? undefined
      : {
          content: agent.answer.answer,
          modelCallRefs: agent.answer.modelCallRefs,
          toolCallRefs: agent.answer.toolCallRefs,
          evidenceRefs: agent.answer.evidenceRefs,
        },
    pendingConfirmation: pending === undefined
      ? undefined
      : {
          confirmationId: pending.confirmationId,
          title: pending.title,
          actionSummary: confirmationActionSummaryText({
            question: pending.question,
            consequence: pending.consequence,
          }),
          consequence: pending.consequence,
          affectedResources: pending.affectedResources,
          riskLevel: pending.riskLevel,
          resumeAvailability: pending.resumeAvailability,
          requestedAt: pending.requestedAt,
          expiresAt: pending.expiresAt,
          sourceRefs: pending.sourceRefs,
        },
    contextLedger: agent.contextLedger,
  };
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
