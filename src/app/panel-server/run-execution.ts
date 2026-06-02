import type {
  ModelRunReasoningEffort,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import type { EventLogEntry } from "../../kernel/events/in-memory-event-log.js";
import { type BasicAgentRunExecutionInput } from "../basic-agent-runtime/index.js";
import { type PanelRunCanvasReadModel } from "../panel-canvas-read-model.js";
import {
  createPanelRunTrace,
  createPanelRunTracking,
  createPanelRunTranscript,
  type PanelObservationReadModel,
  type PanelRunStreamCursor,
  type PanelRunTraceReadModel,
  type PanelRunTrackingReadModel,
  type PanelRunTranscript,
} from "../panel-run-read-model.js";
import type { PanelDesktopRunMode, PanelRunJob, PanelRunKind } from "../panel-run-jobs.js";
import type { DesktopTaskSoilInput } from "../task-soil-workspace.js";
import {
  ModelRuntimeConfigurationError,
  type ModelRuntimeMode,
} from "../model-runtime/index.js";
import {
  type UndergroundDemoAiInput,
  type UndergroundDemoSummary,
} from "../underground-demo-summary.js";
import { friendlyUserFacingFailureText } from "../visible-text-safety.js";
import { buildConversationHistoryMessages } from "./conversation-history.js";
import { PanelHttpError } from "./http-utils.js";
import { asRecord, optionalString, throwIfAborted } from "./request-parsers.js";
import { canvasTraceId } from "./runtime-records.js";
import type { PanelRuntime } from "./runtime.js";
import { runOrdinaryDesktopForPanel } from "./desktop-agent-execution.js";
import { prepareDesktopRunResources } from "./desktop-run-resources.js";
import { runDeepDesktopForPanel, runUndergroundForPanel } from "./underground-compat-execution.js";
import type {
  PanelRunExecutionOptions,
  PanelRunExecutionResult,
} from "./run-execution-contracts.js";

export type PanelRunResponse = {
  readonly ok: true;
  readonly runKind: PanelRunKind;
  readonly runMode: PanelDesktopRunMode;
  readonly status: "completed";
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly summary?: UndergroundDemoSummary;
  readonly observation?: PanelObservationReadModel;
  readonly tracking: PanelRunTrackingReadModel;
  readonly trace: PanelRunTraceReadModel;
  readonly transcript: PanelRunTranscript;
  readonly transcriptNodes: PanelRunTranscript["transcriptNodes"];
  readonly workNotes: PanelRunTranscript["workNotes"];
  readonly steps: PanelRunTranscript["steps"];
  readonly streamCursor: PanelRunStreamCursor;
  readonly canvas?: PanelRunCanvasReadModel;
};

export async function executeBasicPanelRun(
  runtime: PanelRuntime,
  input: BasicAgentRunExecutionInput
): Promise<PanelRunExecutionResult> {
  const job = input.job;
  if (job.conversationId !== undefined && job.runAfterRunId !== undefined) {
    runtime.conversations.activateQueuedRun(job.conversationId, job.runId);
  }
  const conversationHistory = await buildConversationHistoryMessages({
    source: runtime,
    conversationId: job.conversationId,
    assistantTurnId: job.assistantTurnId,
  });
  return runForPanel(runtime, job.runKind, job.goal, job.aiMode, job.taskSoilInput, job.runMode, {
    conversationHistory,
    capabilitySnapshot: job.capabilitySnapshot,
    reasoningEffort: job.reasoningEffort,
    abortSignal: input.abortSignal,
    onRuntimeReady: input.onRuntimeReady,
    onModelOutputDelta: input.onModelOutputDelta,
  });
}

export async function failPanelRunJob(
  runtime: PanelRuntime,
  job: PanelRunJob,
  error: unknown
): Promise<void> {
  const config = job.config;
  const informationAccess = job.informationAccess;
  if (error instanceof ModelRuntimeConfigurationError) {
    const message = panelConfigurationErrorMessage(error.issue.code);
    runtime.runJobs.fail(job.runId, {
      config,
      informationAccess,
      error: {
        code: error.issue.code,
        message,
      },
      summary: {
        ai: createConfigurationFailedAiSummary(error.issue.summaryInput, error, message),
      },
    });
    return;
  }
  if (error instanceof PanelHttpError) {
    runtime.runJobs.fail(job.runId, {
      config,
      informationAccess,
      error: {
        code: error.code,
        message: panelJobErrorMessage(error),
      },
    });
    return;
  }
  const eventEntries = job.runtime?.eventLog.list() ?? [];
  const modelFailureMessage = latestModelFailureMessage(eventEntries);
  runtime.runJobs.fail(job.runId, {
    config,
    informationAccess,
    error: {
      code: "panel_internal_error",
      message: friendlyUserFacingFailureText(
        modelFailureMessage ??
          (job.runKind === "desktop" ? "Desktop Shell 运行 job 失败。" : "地下兼容运行 job 失败。")
      ),
    },
  });
}

export async function runForPanel(
  runtime: PanelRuntime,
  runKind: PanelRunKind,
  goal: string,
  aiMode: ModelRuntimeMode,
  taskSoilInput: DesktopTaskSoilInput | undefined,
  runMode: PanelDesktopRunMode = "agent",
  options: PanelRunExecutionOptions = {}
): Promise<PanelRunExecutionResult> {
  throwIfAborted(options.abortSignal);
  return runKind === "desktop"
    ? runDesktopForPanel(runtime, goal, aiMode, taskSoilInput, runMode, options)
    : runUndergroundForPanel(runtime, goal, aiMode, options);
}

async function runDesktopForPanel(
  runtime: PanelRuntime,
  goal: string,
  aiMode: ModelRuntimeMode,
  taskSoilInput: DesktopTaskSoilInput | undefined,
  runMode: PanelDesktopRunMode,
  options: PanelRunExecutionOptions
): Promise<PanelRunExecutionResult> {
  throwIfAborted(options.abortSignal);
  const resources = await prepareDesktopRunResources(runtime, aiMode, options);
  return runMode === "deep"
    ? runDeepDesktopForPanel(runtime, goal, resources, options)
    : runOrdinaryDesktopForPanel(runtime, goal, aiMode, taskSoilInput, resources, options);
}

export async function createCompletedPanelRunResponse(input: {
  readonly runtime: PanelRuntime;
  readonly runKind: PanelRunKind;
  readonly runMode: PanelDesktopRunMode;
  readonly requestedMode: ModelRuntimeMode;
  readonly reasoningEffort?: ModelRunReasoningEffort;
  readonly run: PanelRunExecutionResult;
}): Promise<PanelRunResponse> {
  const currentConfig = await input.runtime.configCenter.getModelProviderConfig();
  const currentInformationAccess = await input.runtime.configCenter.getInformationAccessConfig();
  const trace = createPanelRunTrace({ status: "completed", eventEntries: input.run.eventEntries });
  const tracking = createPanelRunTracking({
    status: "completed",
    config: currentConfig,
    informationAccess: currentInformationAccess,
    requestedMode: input.requestedMode,
    summary: input.run.summary,
    observation: input.run.observation,
    agentRunTree: input.run.agentRunTree,
    eventEntries: input.run.eventEntries,
  });
  const responseRunId = input.run.observation?.traceId ?? canvasTraceId(input.run.canvas) ?? "panel-sync-run";
  const transcript = createPanelRunTranscript({
    runId: responseRunId,
    status: "completed",
    eventEntries: input.run.eventEntries,
    summary: input.run.summary,
    observation: input.run.observation,
    agentRunTree: input.run.agentRunTree,
    desktopMode: input.runKind === "desktop" ? input.runMode : undefined,
    reasoningEffort: input.reasoningEffort,
    createdAt: input.run.eventEntries[0]?.recordedAt ?? new Date(0).toISOString(),
    updatedAt: input.run.eventEntries.at(-1)?.recordedAt ?? new Date(0).toISOString(),
  });
  return {
    ok: true,
    runKind: input.runKind,
    runMode: input.runMode,
    status: "completed",
    config: currentConfig,
    informationAccess: currentInformationAccess,
    summary: input.run.summary,
    observation: input.run.observation,
    tracking,
    trace,
    transcript,
    transcriptNodes: transcript.transcriptNodes,
    workNotes: transcript.workNotes,
    steps: transcript.steps,
    streamCursor: {
      runId: responseRunId,
      lastSequence: transcript.events.at(-1)?.sequence ?? 0,
    },
    canvas: input.run.canvas,
  };
}

export function createConfigurationFailedAiSummary(
  input: UndergroundDemoAiInput,
  error: ModelRuntimeConfigurationError,
  message: string
): UndergroundDemoSummary["ai"] {
  return {
    ...input,
    status: "configuration_failed",
    eventCounts: { requested: 0, completed: 0, failed: 0 },
    aiCandidateCount: 0,
    fallbackCount: 0,
    aiFallbackUsed: false,
    rootletKinds: [],
    modelCallRefs: [],
    configurationError: {
      code: error.issue.code,
      message,
    },
  };
}

export function panelConfigurationErrorMessage(code: ModelRuntimeConfigurationError["issue"]["code"]): string {
  if (code === "ai_disabled") {
    return "AI 已禁用。";
  }
  if (code === "missing_api_key") {
    return "模型密钥未配置。";
  }
  return "模型未配置。";
}

function latestModelFailureMessage(eventEntries: readonly EventLogEntry[]): string | undefined {
  const latestFailure = [...eventEntries].reverse().find((entry) => entry.type === "model.failed");
  if (latestFailure === undefined) {
    return undefined;
  }
  const failurePayload = asRecord(latestFailure.message.payload);
  const requestId = optionalString(failurePayload.requestId);
  const responseId = optionalString(failurePayload.responseId);
  const requestedPayload = requestId === undefined ? {} : modelRequestedPayloadFor(eventEntries, requestId);
  const purpose = optionalString(requestedPayload.purpose) ?? "unknown purpose";
  const outputContract = asRecord(requestedPayload.outputContract);
  const contractId = optionalString(outputContract.contractId) ?? "unknown contract";
  const failureKind = optionalString(failurePayload.failureKind) ?? "model_failed";
  const validationStatus = optionalString(failurePayload.validationStatus) ?? "unknown";
  const retryable = failurePayload.retryable === true ? "可重试" : "不可重试";
  const callRef = [requestId, responseId].filter((value): value is string => value !== undefined).join(" / ");
  const location = callRef.length > 0 ? `；调用 ${callRef}` : "";

  if (failureKind === "output_validation") {
    return `真实 AI 输出未通过契约校验：${purpose} / ${contractId}；validation ${validationStatus}，${retryable}${location}。运行已停止，没有生成 completed artifact。`;
  }
  return `真实 AI 调用失败：${purpose} / ${contractId}；原因 ${failureKind}，validation ${validationStatus}，${retryable}${location}。运行已停止，没有生成 completed artifact。`;
}

function modelRequestedPayloadFor(eventEntries: readonly EventLogEntry[], requestId: string): Record<string, unknown> {
  const requested = eventEntries.find((entry) => {
    if (entry.type !== "model.requested") {
      return false;
    }
    return optionalString(asRecord(entry.message.payload).requestId) === requestId;
  });
  return requested === undefined ? {} : asRecord(requested.message.payload);
}

function panelJobErrorMessage(error: PanelHttpError): string {
  if (error.code === "desktop_agent_failed" || error.code === "desktop_chat_failed" || error.statusCode >= 500) {
    return friendlyUserFacingFailureText(error.message);
  }
  return error.message;
}
