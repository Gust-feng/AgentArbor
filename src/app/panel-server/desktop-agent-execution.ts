import type { ModelRunReasoningEffort } from "../../domain/config/index.js";
import { runDesktopAgentSession } from "../desktop-agent-session.js";
import type { ModelRuntimeMode } from "../model-runtime/index.js";
import { createDesktopAgentCanvas } from "../panel-desktop-agent-canvas.js";
import { createPanelRunTranscript } from "../panel-run-read-model.js";
import type { DesktopTaskSoilInput } from "../task-soil-workspace.js";
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
  const agent = await runDesktopAgentSession(goal, {
    aiMode,
    createIntelligenceChannel: resources.aiConfig.createIntelligenceChannel,
    createToolCenter: await createDesktopToolCenterFactory(runtime, resources),
    taskSoilInput,
    conversationHistory: options.conversationHistory,
    skillContexts: await resolveTriggeredSkillContexts(runtime, goal),
    modelCapabilities: resources.capabilitySnapshot.modelCapabilities,
    capabilitySnapshot: resources.capabilitySnapshot,
    platform: process.platform,
    abortSignal: options.abortSignal,
    onRuntimeReady: options.onRuntimeReady,
    onModelOutputDelta: options.onModelOutputDelta,
    allowWorkSessionUpgrade: false,
  });
  return desktopPanelResultFromAgent(agent, options.reasoningEffort);
}

function desktopPanelResultFromAgent(
  agent: Awaited<ReturnType<typeof runDesktopAgentSession>>,
  reasoningEffort?: ModelRunReasoningEffort
): PanelRunExecutionResult {
  if (agent.status === "completed" || agent.status === "confirmation_needed" || agent.status === "paused") {
    const eventEntries = agent.runtime.eventLog.list();
    const transcript = createPanelRunTranscript({
      runId: agent.traceId,
      status: agent.status === "paused" ? "blocked" : "completed",
      eventEntries,
      desktopMode: "agent",
      reasoningEffort,
      createdAt: eventEntries[0]?.recordedAt ?? new Date(0).toISOString(),
      updatedAt: eventEntries.at(-1)?.recordedAt ?? new Date(0).toISOString(),
    });
    return {
      eventEntries,
      canvas: createDesktopAgentCanvas({
        result: agent,
        transcript,
      }),
      blocked:
        agent.status === "paused"
          ? {
              code: "out_of_fuel",
              message:
                agent.failureMessage ??
                "运行被外部边界中断，任务没有完成。你可以继续发送消息让我接着处理。",
            }
          : undefined,
      pendingApproval:
        agent.pendingApproval === undefined
          ? undefined
          : {
              confirmationId: agent.pendingApproval.confirmationId,
              resume: async (resumeInput) => {
                const resumed = await agent.pendingApproval!.resume(resumeInput);
                return desktopPanelResultFromAgent(resumed, reasoningEffort);
              },
            },
    };
  }

  throw new PanelHttpError(500, "desktop_agent_failed", agent.failureMessage ?? "桌面 Agent 没有形成结果。");
}
