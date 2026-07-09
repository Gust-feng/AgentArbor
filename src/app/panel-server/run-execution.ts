import type {
  ModelRunReasoningEffort,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import { type BasicAgentRunExecutionInput } from "../basic-agent-runtime/index.js";
import { type PanelRunCanvasReadModel } from "../panel-canvas-read-model.js";
import {
  createPanelRunTrace,
  createPanelRunTracking,
  createPanelRunTranscript,
  type PanelObservationReadModel,
  type PanelRunStatus,
  type PanelRunStreamCursor,
  type PanelRunTraceReadModel,
  type PanelRunTrackingReadModel,
  type PanelRunTranscript,
} from "../panel-run-read-model.js";
import type { PanelRunJob, PanelRunKind, PanelRunMode } from "../panel-run-jobs.js";
import type { PanelRunConfigurationFailureSummary, PanelRunSummary } from "../panel-run-summary.js";
import type { DesktopTaskSoilInput } from "../task-soil-workspace.js";
import {
  ModelRuntimeConfigurationError,
  type ModelRuntimeSummaryInput,
  type ModelRuntimeMode,
} from "../model-runtime/index.js";
import { latestModelFailureTextForUser } from "../panel-read-model/run/panel-model-failure-copy.js";
import { friendlyUserFacingFailureText } from "../visible-text-safety.js";
import {
  buildConversationHistoryMessages,
  buildConversationInterruptedRunContexts,
  buildConversationToolEvidence,
} from "./conversation-history.js";
import { PanelHttpError } from "./http-utils.js";
import { throwIfAborted } from "./request-parsers.js";
import { canvasTraceId } from "./runtime-records.js";
import type { PanelRuntime } from "./runtime.js";
import { executeOrdinaryDesktopRunForPanel } from "./desktop-agent-execution.js";
import { prepareDesktopRunResources } from "./desktop-run-resources.js";
import { runUndergroundForPanel } from "./underground-compat-execution.js";
import type { AgentDefinition } from "../agent-prompts/contracts.js";
import { runAgentDefinitionRefCacheKey } from "../agent-definition-ref.js";
import { assertRunModeForKind, RunModePolicyError } from "../run-mode-policy.js";
import type {
  PanelRunExecutionOptions,
  PanelRunExecutionResult,
} from "./run-execution-contracts.js";

export type PanelRunResponse = {
  readonly ok: true;
  readonly runKind: PanelRunKind;
  readonly runMode: PanelRunMode;
  readonly status: PanelRunStatus;
  readonly agentDefinitionRef?: PanelRunExecutionResult["agentDefinitionRef"];
  readonly capabilityResolution?: PanelRunExecutionResult["capabilityResolution"];
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly summary?: PanelRunSummary;
  readonly observation?: PanelObservationReadModel;
  readonly tracking: PanelRunTrackingReadModel;
  readonly trace: PanelRunTraceReadModel;
  readonly transcript: PanelRunTranscript;
  readonly transcriptNodes: PanelRunTranscript["transcriptNodes"];
  readonly workNotes: PanelRunTranscript["workNotes"];
  readonly steps: PanelRunTranscript["steps"];
  readonly streamCursor: PanelRunStreamCursor;
  readonly canvas?: PanelRunCanvasReadModel;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
};

export async function executeBasicPanelRun(
  runtime: PanelRuntime,
  input: BasicAgentRunExecutionInput
): Promise<PanelRunExecutionResult> {
  const job = input.job;
  if (job.conversationId !== undefined && job.runAfterRunId !== undefined) {
    runtime.conversations.activateQueuedRun(job.conversationId, job.runId);
  }
  const conversationContext = {
    source: runtime,
    conversationId: job.conversationId,
    assistantTurnId: job.assistantTurnId,
  };
  const [conversationHistory, interruptedRunContexts, toolEvidence] = await Promise.all([
    buildConversationHistoryMessages(conversationContext),
    buildConversationInterruptedRunContexts(conversationContext),
    buildConversationToolEvidence(conversationContext),
  ]);
  return executePanelRunFromFrozenJob(runtime, {
    runKind: job.runKind,
    runMode: job.runMode,
    goal: job.goal,
    aiMode: job.aiMode,
    taskSoilInput: job.taskSoilInput,
    options: {
      conversationHistory,
      interruptedRunContexts,
      toolEvidence,
      agentDefinition: resolveExecutionAgentDefinition(runtime, job),
      agentDefinitionRef: job.agentDefinitionRef,
      config: job.config,
      capabilitySnapshot: job.capabilitySnapshot,
      informationAccess: job.informationAccess,
      reasoningEffort: job.reasoningEffort,
      toolConfirmationPolicy: job.toolConfirmationPolicy,
      abortSignal: input.abortSignal,
      onRuntimeReady: input.onRuntimeReady,
      onModelOutputDelta: input.onModelOutputDelta,
    },
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
      capabilitySnapshot: job.capabilitySnapshot,
      capabilityResolution: job.capabilityResolution,
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
      capabilitySnapshot: job.capabilitySnapshot,
      capabilityResolution: job.capabilityResolution,
      error: {
        code: error.code,
        message: panelJobErrorMessage(error),
      },
    });
    return;
  }
  const eventEntries = job.runtime?.eventLog.list() ?? [];
  const modelFailureMessage = latestModelFailureTextForUser(eventEntries);
  runtime.runJobs.fail(job.runId, {
    config,
    informationAccess,
    capabilitySnapshot: job.capabilitySnapshot,
    capabilityResolution: job.capabilityResolution,
    error: {
      code: "panel_internal_error",
      message: modelFailureMessage ?? "本次运行失败。",
    },
  });
}

/**
 * @deprecated Compatibility helper for legacy synchronous run routes. Default
 * ordinary Desktop Agent runs must be created through BasicAgentRunExecutor.start
 * so run birth facts are frozen before execution.
 */
export async function runForPanel(
  runtime: PanelRuntime,
  runKind: PanelRunKind,
  goal: string,
  aiMode: ModelRuntimeMode,
  taskSoilInput: DesktopTaskSoilInput | undefined,
  runMode: PanelRunMode = "agent",
  options: PanelRunExecutionOptions = {}
): Promise<PanelRunExecutionResult> {
  assertSupportedPanelRunMode(runKind, runMode);
  if (runKind === "desktop") {
    throw new PanelHttpError(
      400,
      "desktop_sync_run_not_supported",
      "Desktop 默认运行入口必须通过 BasicAgentRunExecutor.start 创建并冻结运行事实。"
    );
  }
  return executePanelRunFromFrozenJob(runtime, {
    runKind,
    runMode,
    goal,
    aiMode,
    taskSoilInput,
    options,
  });
}

type PanelRunFrozenExecutionInput = {
  readonly runKind: PanelRunKind;
  readonly runMode: PanelRunMode;
  readonly goal: string;
  readonly aiMode: ModelRuntimeMode;
  readonly taskSoilInput: DesktopTaskSoilInput | undefined;
  readonly options: PanelRunExecutionOptions;
};

async function executePanelRunFromFrozenJob(
  runtime: PanelRuntime,
  input: PanelRunFrozenExecutionInput
): Promise<PanelRunExecutionResult> {
  throwIfAborted(input.options.abortSignal);
  assertSupportedPanelRunMode(input.runKind, input.runMode);
  return input.runKind === "desktop"
    ? runDesktopForPanel(runtime, input.goal, input.aiMode, input.taskSoilInput, input.options)
    : runUndergroundForPanel(runtime, input.goal, input.aiMode, input.options);
}

async function runDesktopForPanel(
  runtime: PanelRuntime,
  goal: string,
  aiMode: ModelRuntimeMode,
  taskSoilInput: DesktopTaskSoilInput | undefined,
  options: PanelRunExecutionOptions
): Promise<PanelRunExecutionResult> {
  throwIfAborted(options.abortSignal);
  const resources = await prepareDesktopRunResources(runtime, aiMode, options);
  return executeOrdinaryDesktopRunForPanel({
    runtime,
    goal,
    aiMode,
    taskSoilInput,
    resources,
    options,
  });
}

function assertSupportedPanelRunMode(runKind: PanelRunKind, runMode: PanelRunMode): void {
  try {
    assertRunModeForKind(runKind, runMode);
  } catch (error) {
    if (error instanceof RunModePolicyError) {
      throw new PanelHttpError(
        400,
        error.code,
        runModeNotSupportedMessage(error)
      );
    }
    throw error;
  }
}

function runModeNotSupportedMessage(error: RunModePolicyError): string {
  return error.code === "desktop_run_mode_not_supported"
    ? "Desktop 默认执行入口当前只支持普通 agent 运行。请使用显式 deep 入口。"
    : "Underground 执行入口固定运行 deep 模式，不支持普通 agent 运行。";
}

function resolveExecutionAgentDefinition(
  runtime: PanelRuntime,
  job: Pick<PanelRunJob, "runKind" | "runMode" | "agentDefinitionRef">
): AgentDefinition | undefined {
  if (job.runKind !== "desktop" || job.runMode !== "agent") {
    return undefined;
  }
  if (job.agentDefinitionRef === undefined) {
    throw new PanelHttpError(
      500,
      "agent_definition_ref_required",
      "普通 Desktop Agent 运行缺少创建时冻结的 Agent 定义引用。"
    );
  }
  const dynamicDefinition = runtime.agentDefinitionOverrides.get(runAgentDefinitionRefCacheKey(job.agentDefinitionRef));
  if (dynamicDefinition !== undefined) {
    return dynamicDefinition;
  }
  const definition = runtime.agentDefinitions.resolve(job.agentDefinitionRef);
  if (definition === undefined) {
    throw new PanelHttpError(
      500,
      "agent_definition_mismatch",
      "运行记录中的 Agent 定义与当前执行定义不一致。"
    );
  }
  return definition;
}

export async function createPanelRunResponse(input: {
  readonly runtime: PanelRuntime;
  readonly runKind: PanelRunKind;
  readonly runMode: PanelRunMode;
  readonly requestedMode: ModelRuntimeMode;
  readonly reasoningEffort?: ModelRunReasoningEffort;
  readonly run: PanelRunExecutionResult;
}): Promise<PanelRunResponse> {
  assertOrdinaryDesktopRunResponseFacts(input);
  const status = panelRunStatusFromExecutionResult(input.run);
  const error = panelRunErrorFromExecutionResult(input.run);
  const config =
    input.run.capabilitySnapshot?.activeModel ??
    input.run.config ??
    await input.runtime.configCenter.getModelProviderConfig();
  const informationAccess =
    input.run.informationAccess ??
    await input.runtime.configCenter.getInformationAccessConfig();
  const trace = createPanelRunTrace({ status, runMode: input.runMode, eventEntries: input.run.eventEntries });
  const tracking = createPanelRunTracking({
    status,
    runMode: input.runMode,
    config,
    informationAccess,
    requestedMode: input.requestedMode,
    summary: input.run.summary,
    observation: input.run.observation,
    agentRunTree: input.run.agentRunTree,
    eventEntries: input.run.eventEntries,
  });
  const responseRunId = input.run.observation?.traceId ?? canvasTraceId(input.run.canvas) ?? "panel-sync-run";
  const transcript = createPanelRunTranscript({
    runId: responseRunId,
    status,
    eventEntries: input.run.eventEntries,
    summary: input.run.summary,
    observation: input.run.observation,
    agentRunTree: input.run.agentRunTree,
    desktopMode: input.runKind === "desktop" ? input.runMode : undefined,
    reasoningEffort: input.reasoningEffort,
    agentDefinitionRef: input.run.agentDefinitionRef,
    createdAt: input.run.eventEntries[0]?.recordedAt ?? new Date(0).toISOString(),
    updatedAt: input.run.eventEntries.at(-1)?.recordedAt ?? new Date(0).toISOString(),
    error,
  });
  return {
    ok: true,
    runKind: input.runKind,
    runMode: input.runMode,
    status,
    agentDefinitionRef: input.run.agentDefinitionRef,
    capabilityResolution: input.run.capabilityResolution,
    config,
    informationAccess,
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
    error,
  };
}

function assertOrdinaryDesktopRunResponseFacts(input: {
  readonly runKind: PanelRunKind;
  readonly runMode: PanelRunMode;
  readonly run: PanelRunExecutionResult;
}): void {
  if (input.runKind !== "desktop" || input.runMode !== "agent") {
    return;
  }
  if (input.run.capabilitySnapshot === undefined) {
    throw new PanelHttpError(
      500,
      "desktop_capability_snapshot_required",
      "Desktop Agent run response requires a capability snapshot frozen when the run was created."
    );
  }
  if (input.run.informationAccess === undefined) {
    throw new PanelHttpError(
      500,
      "desktop_information_access_required",
      "Desktop Agent run response requires information access settings frozen when the run was created."
    );
  }
  if (input.run.agentDefinitionRef === undefined) {
    throw new PanelHttpError(
      500,
      "agent_definition_ref_required",
      "Desktop Agent run response requires the Agent definition reference frozen when the run was created."
    );
  }
}

function panelRunStatusFromExecutionResult(run: PanelRunExecutionResult): PanelRunStatus {
  if (run.failed !== undefined) {
    return "failed";
  }
  if (run.blocked !== undefined) {
    return "blocked";
  }
  if (run.pendingApproval !== undefined) {
    return "approval_needed";
  }
  if (run.completed === true) {
    return "completed";
  }
  throw new PanelHttpError(
    500,
    "run_terminal_state_missing",
    "运行结果缺少明确终态，不能作为完成结果返回。"
  );
}

function panelRunErrorFromExecutionResult(
  run: PanelRunExecutionResult
): PanelRunResponse["error"] {
  return run.failed ?? run.blocked;
}

export function createConfigurationFailedAiSummary(
  input: ModelRuntimeSummaryInput,
  error: ModelRuntimeConfigurationError,
  message: string
): PanelRunConfigurationFailureSummary["ai"] {
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

function panelJobErrorMessage(error: PanelHttpError): string {
  if (error.code === "desktop_agent_failed" || error.code === "desktop_chat_failed" || error.statusCode >= 500) {
    return friendlyUserFacingFailureText(error.message);
  }
  return error.message;
}
