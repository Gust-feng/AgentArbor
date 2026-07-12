import path from "node:path";
import { isToolCallEventMessageType } from "../../domain/common.js";
import type { SanitizedWorkspaceConfig } from "../../domain/config/index.js";
import type {
  ToolErrorDomain,
  ToolErrorFacts,
  ToolFactValue,
} from "../../domain/tools/index.js";
import { isToolErrorDomain } from "../../domain/tools/index.js";
import type {
  RuntimeRunContinuationAvailability,
  RuntimeArtifactRecord,
  RuntimeConfirmationRecord,
  RuntimeEventRecord,
  RuntimeModelCallRecord,
  RuntimeRunRecord,
  RuntimeToolCallRecord,
  RuntimeWorkspaceRecord,
} from "../../domain/runtime-database/index.js";
import { redactSensitiveText } from "../../kernel/redaction.js";
import type { EventLogEntry } from "../../kernel/events/in-memory-event-log.js";
import type { PanelRunCanvasReadModel } from "../panel-read-model/canvas/panel-canvas-read-model.js";
import {
  panelRunPayloadForStatus,
  type PanelRunConfirmationDecisionRecord,
  type PanelRunJob,
} from "./run-jobs.js";
import type {
  PanelRunStatus,
  PanelRunStreamEvent,
  PanelRunTraceReadModel,
  PanelRunTranscript,
} from "../panel-run-read-model.js";
import { reduceToolCallEventFacts } from "../run-read-model/tool-call-event-reducer.js";
import { runtimeEventRecordId } from "../run-runtime-core/event-stream.js";
import { normalizeModelFacingText, sanitizeAssistantVisibleText } from "../text-projection/visible-text-safety.js";
import { confirmationActionSummaryText } from "../text-projection/confirmation-copy.js";
import { asRecord, optionalString, unique } from "./request-parsers.js";

export type RuntimeErrorDomain = ToolErrorDomain;

export type RuntimeRunRecordWithErrorDomain = RuntimeRunRecord & {
  readonly error?: RuntimeRunRecord["error"] & {
    readonly errorDomain?: RuntimeErrorDomain;
  };
};

export type RuntimeToolCallRecordWithErrorDomain = RuntimeToolCallRecord & {
  readonly errorDomain?: RuntimeErrorDomain;
  readonly errorFacts?: ToolErrorFacts;
};

export function createRuntimeWorkspaceRecord(
  workspace: SanitizedWorkspaceConfig,
  selectedAt: string,
  runId: string
): RuntimeWorkspaceRecord {
  return {
    workspaceId: `workspace:run:${runId}`,
    kind: "local_directory",
    path: workspace.workspaceDirectory,
    label: path.basename(workspace.workspaceDirectory) || workspace.workspaceDirectory,
    selectedAt,
    updatedAt: workspace.updatedAt,
  };
}

export function createRuntimeRunRecord(input: {
  readonly job: PanelRunJob;
  readonly workspace: RuntimeWorkspaceRecord | undefined;
  readonly appHome: string;
  readonly runtimeHome: string | undefined;
}): RuntimeRunRecordWithErrorDomain {
  const restoredResult = resultSummaryForJob(input.job);
  const statusPayload = panelRunPayloadForStatus(input.job);
  const statusObservation = statusPayload === undefined || !("observation" in statusPayload) ? undefined : statusPayload.observation;
  const terminalError = input.job.failed?.error ?? input.job.cancelled?.reason ?? input.job.blocked?.reason;
  return {
    runId: input.job.runId,
    profile: "lite",
    runKind: input.job.runKind,
    runMode: input.job.runMode,
    status: input.job.status,
    goalSummary: compactRuntimeText(input.job.goal, 300),
    aiMode: input.job.aiMode,
    workspaceId: input.workspace?.workspaceId,
    workspacePath: input.workspace?.path,
    conversationId: input.job.conversationId,
    traceId: input.job.traceId ?? statusObservation?.traceId ?? canvasTraceId(statusPayload?.canvas),
    goalId: input.job.goalId ?? statusObservation?.goalId,
    appHome: input.appHome,
    runHome: input.runtimeHome === undefined ? "" : path.join(input.runtimeHome, "runs", encodeURIComponent(input.job.runId)),
    createdAt: input.job.createdAt,
    updatedAt: input.job.updatedAt,
    completedAt: isTerminalPanelRunStatus(input.job.status) ? input.job.updatedAt : undefined,
    resultTitle: restoredResult?.title,
    resultSummary: restoredResult?.summary,
    resultAnswer: restoredResult?.answer,
    stopReason: runtimeStopReasonForJob(input.job),
    continuationAvailability: runtimeContinuationAvailabilityForJob(input.job),
    error: safeRuntimeError(terminalError, inferRunErrorDomain(input.job, terminalError)),
    agentDefinitionRef: input.job.agentDefinitionRef,
    capabilitySnapshot: input.job.capabilitySnapshot,
    capabilityResolution: statusPayload?.capabilityResolution ?? input.job.capabilityResolution,
    informationAccess: input.job.informationAccess,
  };
}

export function isTerminalPanelRunStatus(status: PanelRunStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "blocked";
}

export function toRuntimeEventRecord(
  runId: string,
  event: PanelRunTraceReadModel["events"][number],
  sourceEntry?: EventLogEntry
): RuntimeEventRecord {
  return {
    eventId: runtimeEventRecordId(runId, event.sequence),
    runId,
    sequence: event.sequence,
    type: event.type,
    summary: compactRuntimeText(event.summary, 800),
    scope: event.scope,
    severity: event.severity,
    progress: event.progress,
    refs: event.refs,
    traceId: event.traceId,
    taskId: event.taskId,
    intent: event.intent,
    payload: durableToolLifecyclePayload(sourceEntry),
    createdAt: event.createdAt,
    recordedAt: event.recordedAt,
  };
}

function durableToolLifecyclePayload(entry: EventLogEntry | undefined): RuntimeEventRecord["payload"] {
  if (entry === undefined || !isToolCallEventMessageType(entry.type)) {
    return undefined;
  }
  const payload = entry.message.payload as ToolFactValue | undefined;
  if (payload === undefined) {
    return undefined;
  }
  return globalThis.structuredClone(payload);
}


export function toRuntimeModelCallRecord(
  runId: string,
  call: PanelRunTranscript["modelCalls"][number]
): RuntimeModelCallRecord {
  return {
    requestId: call.requestId,
    runId,
    responseId: call.responseId,
    status: call.status,
    purpose: call.purpose,
    outputContractId: call.outputContractId,
    providerKind: call.providerKind,
    protocolKind: call.protocolKind,
    model: call.model,
    outputKind: call.outputKind,
    validationStatus: call.validationStatus,
    failureKind: call.failureKind,
    retryable: call.retryable,
    usage: call.usage,
    eventRefs: call.eventRefs,
  };
}

export function toRuntimeToolCallRecords(
  runId: string,
  _events: readonly PanelRunStreamEvent[],
  eventEntries: readonly EventLogEntry[]
): readonly RuntimeToolCallRecordWithErrorDomain[] {
  return reduceToolCallEventFacts(eventEntries).map((fact) => ({
    callId: fact.callId,
    runId,
    toolName: fact.toolName,
    status: fact.status,
    error: fact.error,
    errorFacts: fact.errorFacts,
    errorDomain: fact.errorDomain,
    durationMs: fact.durationMs,
    confirmationId: fact.confirmationId,
    eventRefs: fact.eventSequences.map((sequence) => runtimeEventRecordId(runId, sequence)),
    createdAt: fact.createdAt,
    terminalAt: fact.terminalAt,
  }));
}

export function toRuntimeArtifactRecords(job: PanelRunJob): readonly RuntimeArtifactRecord[] {
  return (job.runtime?.artifactStore.list() ?? []).map((artifact) => ({
    runId: job.runId,
    ref: artifact.ref,
    summary: compactRuntimeText(artifact.summary, 800),
  }));
}

export function toRuntimeConfirmationRecords(
  job: PanelRunJob,
  eventEntries: readonly EventLogEntry[]
): readonly RuntimeConfirmationRecord[] {
  const confirmations = new Map<string, RuntimeConfirmationRecord>();
  const toolNames = toolNameByCallId(eventEntries);
  for (const entry of eventEntries) {
    if (entry.type !== "user_approval.requested" && entry.type !== "user_approval.received") {
      continue;
    }
    const payload = asRecord(entry.message.payload);
    const confirmationId =
      optionalString(payload.confirmationId) ??
      optionalString(payload.requestId) ??
      `confirmation-${entry.sequence}`;
    const previous = confirmations.get(confirmationId);
    const eventRef = `${job.runId}:event:${entry.sequence}`;
    if (entry.type === "user_approval.requested") {
      const question = optionalString(payload.question);
      const consequence = optionalString(payload.consequence);
      const sourceRefs = sourceRefsFrom(payload, eventRef);
      const toolCallId = toolCallIdFrom(payload, sourceRefs);
      confirmations.set(confirmationId, {
        confirmationId,
        runId: job.runId,
        conversationId: job.conversationId,
        status: previous?.status ?? "pending",
        title: compactRuntimeText(optionalString(payload.title) ?? "待处理", 160),
        actionSummary: compactRuntimeText(
          confirmationActionSummaryText({
            question,
            consequence,
            fallback: "等待你判断。",
          }),
          500
        ),
        affectedResources: affectedResourcesFrom(payload),
        riskLevel: riskLevelFrom(payload.riskLevel),
        toolCallId,
        toolName: toolCallId === undefined ? undefined : toolNames.get(toolCallId),
        resumeAvailability: "lost_after_restart",
        sourceRefs,
        requestedAt: entry.recordedAt,
        expiresAt: optionalString(payload.expiresAt),
        decidedAt: previous?.decidedAt,
        guidance: previous?.guidance,
        eventRefs: unique([...(previous?.eventRefs ?? []), eventRef]),
      });
      continue;
    }
    confirmations.set(confirmationId, {
      confirmationId,
      runId: job.runId,
      conversationId: job.conversationId,
      status: decisionStatusFrom(payload),
      title: previous?.title ?? confirmationRecordTitle(decisionStatusFrom(payload)),
      actionSummary: previous?.actionSummary ?? confirmationRecordActionSummary(decisionStatusFrom(payload)),
      affectedResources: previous?.affectedResources ?? affectedResourcesFrom(payload),
      riskLevel: previous?.riskLevel ?? "medium",
      toolCallId: previous?.toolCallId,
      toolName: previous?.toolName,
      resumeAvailability: previous?.resumeAvailability,
      sourceRefs: previous?.sourceRefs ?? sourceRefsFrom(payload, eventRef),
      requestedAt: previous?.requestedAt ?? entry.recordedAt,
      expiresAt: previous?.expiresAt,
      decidedAt: optionalString(payload.answeredAt) ?? entry.recordedAt,
      guidance: guidanceFrom(payload),
      eventRefs: unique([...(previous?.eventRefs ?? []), eventRef]),
    });
  }
  for (const decision of job.confirmationDecisions) {
    const previous = confirmations.get(decision.confirmationId);
    confirmations.set(decision.confirmationId, {
      confirmationId: decision.confirmationId,
      runId: job.runId,
      conversationId: job.conversationId,
      status:
        decision.decision === "approve_once"
          ? "approved"
          : decision.decision === "deny"
            ? "denied"
            : "guidance",
      title: previous?.title ?? confirmationDecisionTitle(decision.decision),
      actionSummary: previous?.actionSummary ?? confirmationDecisionActionSummary(decision.decision),
      affectedResources: previous?.affectedResources ?? [],
      riskLevel: previous?.riskLevel ?? "medium",
      toolCallId: previous?.toolCallId,
      toolName: previous?.toolName,
      resumeAvailability: previous?.resumeAvailability,
      sourceRefs: previous?.sourceRefs ?? [`confirmation:${decision.confirmationId}`],
      requestedAt: previous?.requestedAt ?? decision.decidedAt,
      expiresAt: previous?.expiresAt,
      decidedAt: decision.decidedAt,
      guidance: decision.guidance === undefined ? previous?.guidance : compactRuntimeText(decision.guidance, 500),
      eventRefs: unique([...(previous?.eventRefs ?? []), `confirmation:${decision.confirmationId}`]),
    });
  }
  return [...confirmations.values()];
}

export function compactRuntimeText(value: string, maxLength: number): string {
  const normalized = redactSensitiveText(sanitizeAssistantVisibleText(value))
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function confirmationRecordTitle(status: RuntimeConfirmationRecord["status"]): string {
  if (status === "guidance") return "补充要求";
  if (status === "denied") return "已不执行";
  if (status === "approved") return "已确认";
  return "待处理";
}

function confirmationRecordActionSummary(status: RuntimeConfirmationRecord["status"]): string {
  if (status === "guidance") return "用户已补充要求。";
  if (status === "denied") return "用户已选择不执行。";
  if (status === "approved") return "用户已确认。";
  return "等待你判断。";
}

function confirmationDecisionTitle(decision: PanelRunConfirmationDecisionRecord["decision"]): string {
  if (decision === "guidance") return "补充要求";
  if (decision === "deny") return "已不执行";
  return "已确认";
}

function confirmationDecisionActionSummary(decision: PanelRunConfirmationDecisionRecord["decision"]): string {
  if (decision === "guidance") return "用户已补充要求。";
  if (decision === "deny") return "用户已选择不执行。";
  return "用户已确认。";
}

export function canvasTraceId(canvas: PanelRunCanvasReadModel | undefined): string | undefined {
  if (canvas === undefined) {
    return undefined;
  }
  if (canvas.kind === "underground_deep_canvas") {
    return canvas.task.traceId;
  }
  return canvas.taskSoil.traceId;
}

function resultSummaryForJob(job: PanelRunJob): {
  readonly title: string;
  readonly summary: string;
  readonly answer?: string;
} | undefined {
  const statusPayload = panelRunPayloadForStatus(job);
  if (job.status === "failed" && statusPayload !== undefined && "error" in statusPayload) {
    return {
      title: "运行失败",
      summary: compactRuntimeText(statusPayload.error.message, 900),
    };
  }
  if (job.status === "cancelled" && statusPayload !== undefined && "reason" in statusPayload) {
    return {
      title: "已取消",
      summary: compactRuntimeText(statusPayload.reason.message, 900),
    };
  }
  if (job.status === "blocked" && statusPayload !== undefined && "reason" in statusPayload) {
    return {
      title: "需要处理",
      summary: compactRuntimeText(statusPayload.reason.message, 900),
    };
  }
  const canvas = statusPayload?.canvas;
  if (canvas?.kind === "desktop_agent_canvas" && canvas.agent.answer !== undefined) {
    const answer = preserveRuntimeAnswerText(canvas.agent.answer.answer, 128_000);
    return {
      title: canvas.agent.pendingConfirmation === undefined ? "已完成" : "待处理",
      summary: compactRuntimeText(answer, 900),
      answer,
    };
  }
  if (canvas?.kind === "desktop_agent_canvas" && canvas.agent.pendingConfirmation !== undefined) {
    return {
      title: "待处理",
      summary: compactRuntimeText(
        confirmationActionSummaryText({
          question: canvas.agent.pendingConfirmation.question,
          consequence: canvas.agent.pendingConfirmation.consequence,
        }),
        900
      ),
    };
  }
  if (canvas?.kind === "underground_deep_canvas") {
    return {
      title: canvas.underground.status === "approved_package_created" ? "方向已形成" : "深度模式已停止",
      summary: compactRuntimeText(
        canvas.underground.recommendedDirection.reason || canvas.underground.convergenceSummary,
        900
      ),
    };
  }
  return undefined;
}

function runtimeStopReasonForJob(job: PanelRunJob): string | undefined {
  if (job.status === "approval_needed") {
    return "approval_required";
  }
  if (job.status === "needs_input") {
    return "needs_input";
  }
  if (job.status === "completed") {
    return "completed";
  }
  if (job.status === "failed") {
    return job.failed?.error.code ?? "failed";
  }
  if (job.status === "cancelled") {
    return job.cancelled?.reason.code ?? "cancelled";
  }
  if (job.status === "blocked") {
    return job.blocked?.reason.code ?? "blocked";
  }
  return undefined;
}

function runtimeContinuationAvailabilityForJob(job: PanelRunJob): RuntimeRunContinuationAvailability {
  if (job.status === "approval_needed") {
    return "lost_after_restart";
  }
  if (job.status === "needs_input") {
    return "new_turn";
  }
  if (job.status === "running" || job.status === "pending") {
    return "lost_after_restart";
  }
  const stopReason = runtimeStopReasonForJob(job);
  if (stopReason === "out_of_fuel" || stopReason === "context_overflow") {
    return "new_turn";
  }
  if (stopReason === "confirmation_continuation_lost") {
    return "lost_after_restart";
  }
  return "none";
}

function preserveRuntimeAnswerText(value: string, maxLength: number): string {
  const normalized = redactSensitiveText(normalizeModelFacingText(value));
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function safeRuntimeError(
  error: RuntimeRunRecord["error"] | undefined,
  errorDomain: RuntimeErrorDomain | undefined
): RuntimeRunRecordWithErrorDomain["error"] | undefined {
  if (error === undefined) {
    return undefined;
  }
  return {
    code: compactRuntimeText(error.code, 160),
    message: compactRuntimeText(error.message, 900),
    errorDomain,
  };
}

function inferRunErrorDomain(
  job: PanelRunJob,
  error: RuntimeRunRecord["error"] | undefined
): RuntimeErrorDomain | undefined {
  const explicit = errorDomainFromUnknown(error);
  if (explicit !== undefined) {
    return explicit;
  }
  if (error === undefined) {
    return undefined;
  }
  const code = error.code.toLowerCase();
  const message = error.message.toLowerCase();
  const hasModelFailureEvent = job.streamEvents.some((event) => event.type === "model.failed");
  const hasToolFailureEvent = job.streamEvents.some((event) => event.type === "tool.failed");
  const hasProcessToolFailureEvent = job.streamEvents.some((event) =>
    event.type === "tool.failed" &&
    isProcessTool(event.toolName)
  );
  if (hasModelFailureEvent || isModelErrorCode(code) || isModelErrorMessage(message)) {
    return "model_error";
  }
  if (hasProcessToolFailureEvent || isProcessErrorCode(code) || (!hasToolFailureEvent && isProcessErrorMessage(message))) {
    return "process_error";
  }
  if (hasToolFailureEvent) {
    return "tool_error";
  }
  if (isUiSubmitErrorCode(code)) {
    return "ui_submit_error";
  }
  return "runtime_error";
}

function inferToolCallErrorDomain(input: {
  readonly eventType: PanelRunStreamEvent["type"];
  readonly toolName?: string;
  readonly error?: string;
  readonly exitCode?: number;
  readonly previous?: RuntimeErrorDomain;
}): RuntimeErrorDomain | undefined {
  const explicit = input.previous;
  if (explicit !== undefined) {
    return explicit;
  }
  if (input.eventType !== "tool.failed") {
    return undefined;
  }
  if (
    isProcessTool(input.toolName) ||
    input.exitCode !== undefined ||
    isProcessErrorMessage(input.error?.toLowerCase() ?? "")
  ) {
    return "process_error";
  }
  return "tool_error";
}

function errorDomainFromUnknown(value: unknown): RuntimeErrorDomain | undefined {
  return errorDomainOrUndefined(asRecord(value).errorDomain);
}

function errorDomainOrUndefined(value: unknown): RuntimeErrorDomain | undefined {
  return isToolErrorDomain(value) ? value : undefined;
}

function isModelErrorCode(code: string): boolean {
  return code === "model_failed" ||
    code === "provider_failed" ||
    code === "missing_api_key" ||
    code === "missing_model_name" ||
    code === "ai_disabled" ||
    code.includes("model") ||
    code.includes("provider");
}

function isModelErrorMessage(message: string): boolean {
  return message.includes("模型") ||
    message.includes("model") ||
    message.includes("provider");
}

function isProcessErrorCode(code: string): boolean {
  return code.includes("process") ||
    code.includes("spawn") ||
    code.includes("exit") ||
    code.includes("signal") ||
    code === "command_not_found";
}

function isProcessErrorMessage(message: string): boolean {
  return message.includes("spawn") ||
    message.includes("enoent") ||
    message.includes("exit code") ||
    message.includes("退出码") ||
    message.includes("command not found") ||
    message.includes("not recognized as");
}

function isUiSubmitErrorCode(code: string): boolean {
  return code.startsWith("invalid_") ||
    code.startsWith("missing_") ||
    code.endsWith("_not_found") ||
    code.includes("request");
}

function isProcessTool(toolName: string | undefined): boolean {
  return toolName === "shell_command";
}

function affectedResourcesFrom(payload: Readonly<Record<string, unknown>>): readonly string[] {
  const explicit = stringArrayFrom(payload.affectedResources);
  if (explicit.length > 0) {
    return explicit.slice(0, 12).map((value) => compactRuntimeText(value, 240));
  }
  const sourceRefs = stringArrayFrom(payload.sourceRefs);
  if (sourceRefs.length > 0) {
    return sourceRefs.slice(0, 12).map((value) => compactRuntimeText(value, 240));
  }
  const evidenceRefs = stringArrayFrom(payload.evidenceRefs);
  return evidenceRefs.slice(0, 12).map((value) => compactRuntimeText(value, 240));
}

function sourceRefsFrom(
  payload: Readonly<Record<string, unknown>>,
  fallbackEventRef: string
): readonly string[] {
  const refs = [
    ...stringArrayFrom(payload.sourceRefs),
    ...stringArrayFrom(payload.evidenceRefs),
  ];
  const selected = refs.length > 0 ? refs : [fallbackEventRef];
  return unique(selected.map((value) => compactRuntimeText(value, 240))).slice(0, 16);
}

function toolCallIdFrom(
  payload: Readonly<Record<string, unknown>>,
  sourceRefs: readonly string[]
): string | undefined {
  const explicit =
    optionalString(payload.toolCallId) ??
    optionalString(payload.toolCallRef) ??
    optionalString(payload.callId);
  if (explicit !== undefined) {
    return compactRuntimeText(explicit, 180);
  }
  for (const ref of sourceRefs) {
    const toolRef =
      ref.startsWith("tool:") ? ref.slice("tool:".length) :
      ref.startsWith("tool_call:") ? ref.slice("tool_call:".length) :
      undefined;
    if (toolRef !== undefined && toolRef.trim().length > 0) {
      return compactRuntimeText(toolRef.trim(), 180);
    }
  }
  return undefined;
}

function toolNameByCallId(eventEntries: readonly EventLogEntry[]): ReadonlyMap<string, string> {
  return new Map(reduceToolCallEventFacts(eventEntries)
    .filter((call): call is typeof call & { readonly toolName: string } => call.toolName !== undefined)
    .map((call) => [call.callId, compactRuntimeText(call.toolName, 160)]));
}

function riskLevelFrom(value: unknown): RuntimeConfirmationRecord["riskLevel"] {
  return value === "low" || value === "medium" || value === "high" ? value : "medium";
}

function decisionStatusFrom(payload: Readonly<Record<string, unknown>>): RuntimeConfirmationRecord["status"] {
  const decision = (optionalString(payload.decision) ?? optionalString(payload.status) ?? "").toLowerCase();
  if (decision.includes("approve") || decision.includes("allow") || decision.includes("同意") || decision.includes("允许")) {
    return "approved";
  }
  if (decision.includes("deny") || decision.includes("reject") || decision.includes("refuse") || decision.includes("拒绝") || decision.includes("不执行")) {
    return "denied";
  }
  return "guidance";
}

function guidanceFrom(payload: Readonly<Record<string, unknown>>): string | undefined {
  const direct = optionalString(payload.guidance) ?? optionalString(payload.note);
  if (direct !== undefined) {
    return compactRuntimeText(direct, 500);
  }
  const answers = Array.isArray(payload.answers) ? payload.answers : undefined;
  if (answers !== undefined) {
    return `用户已补充 ${answers.length} 项说明。`;
  }
  return undefined;
}

function stringArrayFrom(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}
