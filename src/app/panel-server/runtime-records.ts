import path from "node:path";
import type { SanitizedWorkspaceConfig } from "../../domain/config/index.js";
import type {
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
import type { PanelRunCanvasReadModel } from "../panel-canvas-read-model.js";
import {
  panelRunPayloadForStatus,
  type PanelRunConfirmationDecisionRecord,
  type PanelRunJob,
} from "../panel-run-jobs.js";
import type {
  PanelRunStatus,
  PanelRunStreamEvent,
  PanelRunTraceReadModel,
  PanelRunTranscript,
} from "../panel-run-read-model.js";
import { safeCommandToolPreview, safeReadFileToolPreview } from "../safe-tool-preview.js";
import { cleanOrdinaryToolText } from "../ordinary-tool-copy.js";
import { sanitizeAssistantVisibleText } from "../visible-text-safety.js";
import { confirmationActionSummaryText } from "../confirmation-copy.js";
import { asRecord, optionalString, unique } from "./request-parsers.js";

export function createRuntimeWorkspaceRecord(
  workspace: SanitizedWorkspaceConfig,
  selectedAt: string
): RuntimeWorkspaceRecord {
  return {
    workspaceId: "workspace:current",
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
}): RuntimeRunRecord {
  const restoredResult = resultSummaryForJob(input.job);
  const statusPayload = panelRunPayloadForStatus(input.job);
  const statusObservation = statusPayload === undefined || !("observation" in statusPayload) ? undefined : statusPayload.observation;
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
    error: safeRuntimeError(input.job.failed?.error ?? input.job.cancelled?.reason ?? input.job.blocked?.reason),
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
  event: PanelRunTraceReadModel["events"][number]
): RuntimeEventRecord {
  return {
    eventId: `${runId}:event:${event.sequence}`,
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
    createdAt: event.createdAt,
    recordedAt: event.recordedAt,
  };
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
    eventRefs: call.eventRefs,
  };
}

export function toRuntimeToolCallRecords(
  runId: string,
  events: readonly PanelRunStreamEvent[],
  eventEntries: readonly EventLogEntry[]
): readonly RuntimeToolCallRecord[] {
  const detailsByCallId = localToolDetailsByCallId(eventEntries);
  const calls = new Map<string, RuntimeToolCallRecord>();
  for (const event of events) {
    if (!event.type.startsWith("tool.") && event.type !== "confirmation.needed") {
      continue;
    }
    for (const callId of event.toolCallRefs) {
      const previous = calls.get(callId);
      const detail = detailsByCallId.get(callId);
      calls.set(callId, {
        callId,
        runId,
        toolName: event.toolName ?? previous?.toolName,
        status: mergeToolStatus(previous?.status, event.type),
        action: event.detail?.action ?? detail?.action ?? previous?.action,
        path: event.detail?.path ?? detail?.path ?? previous?.path,
        query: event.detail?.query ?? detail?.query ?? previous?.query,
        command: event.detail?.command ?? detail?.command ?? previous?.command,
        exitCode: event.detail?.exitCode ?? detail?.exitCode ?? previous?.exitCode,
        summary: cleanOrdinaryToolText(detail?.summary) ?? cleanOrdinaryToolText(event.summary) ?? cleanOrdinaryToolText(previous?.summary),
        preview: cleanOrdinaryToolText(event.detail?.preview) ?? cleanOrdinaryToolText(detail?.preview) ?? cleanOrdinaryToolText(previous?.preview),
        display: event.detail?.display ?? detail?.display ?? previous?.display,
        envelope: event.detail?.envelope ?? detail?.envelope ?? previous?.envelope,
        truncated: event.detail?.truncated ?? detail?.truncated ?? previous?.truncated,
        error: event.detail?.error ?? detail?.error ?? previous?.error,
        eventRefs: unique([...(previous?.eventRefs ?? []), event.eventId]),
        createdAt: previous?.createdAt ?? event.createdAt,
      });
    }
  }
  return [...calls.values()];
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

function resultSummaryForJob(job: PanelRunJob): { readonly title: string; readonly summary: string } | undefined {
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
    return {
      title: canvas.agent.pendingConfirmation === undefined ? "已完成" : "待处理",
      summary: compactRuntimeText(canvas.agent.answer.answer, 900),
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
  if (canvas?.kind === "work_session_canvas" && canvas.workSession.directAnswer !== undefined) {
    return {
      title: "已回答",
      summary: compactRuntimeText(canvas.workSession.directAnswer.answer, 900),
    };
  }
  if (canvas?.kind === "work_session_canvas" && canvas.workSession.report !== undefined) {
    return {
      title: canvas.workSession.report.title,
      summary: compactRuntimeText(canvas.workSession.report.decisionSummary, 900),
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

function safeRuntimeError(error: RuntimeRunRecord["error"] | undefined): RuntimeRunRecord["error"] | undefined {
  if (error === undefined) {
    return undefined;
  }
  return {
    code: compactRuntimeText(error.code, 160),
    message: compactRuntimeText(error.message, 900),
  };
}

function localToolDetailsByCallId(
  eventEntries: readonly EventLogEntry[]
): Map<string, Pick<RuntimeToolCallRecord, "action" | "path" | "query" | "command" | "exitCode" | "summary" | "preview" | "display" | "envelope" | "truncated" | "error">> {
  const details = new Map<string, Pick<RuntimeToolCallRecord, "action" | "path" | "query" | "command" | "exitCode" | "summary" | "preview" | "display" | "envelope" | "truncated" | "error">>();
  for (const entry of eventEntries) {
    if (entry.type !== "tool.completed" && entry.type !== "tool.failed") {
      continue;
    }
    const payload = asRecord(entry.message.payload);
    const callId = optionalString(payload.callId);
    if (callId === undefined) {
      continue;
    }
    const output = asRecord(payload.output);
    const input = asRecord(payload.input);
    const result = asRecord(output.result);
    const pathValue = optionalString(result.path) ?? optionalString(input.path);
    const command = optionalString(result.command) ?? optionalString(input.command);
    const args = Array.isArray(result.args) ? result.args : Array.isArray(input.args) ? input.args : [];
    details.set(callId, {
      action: optionalString(output.action) ?? optionalString(payload.toolName),
      path: pathValue,
      query: optionalString(result.query) ?? optionalString(input.query),
      command: command === undefined ? undefined : [command, ...args.filter((value): value is string => typeof value === "string")].join(" ").trim(),
      exitCode: typeof result.exitCode === "number" ? result.exitCode : undefined,
      summary: cleanOrdinaryToolText(optionalString(output.summary)),
      preview: persistedToolPreview(optionalString(payload.toolName), output, result, payload),
      display: toolDisplayOrUndefined(output.display),
      envelope: toolResultEnvelopeOrUndefined(output.envelope),
      truncated: output.truncated === true,
      error: optionalString(payload.error),
    });
  }
  return details;
}

function toolDisplayOrUndefined(value: unknown): RuntimeToolCallRecord["display"] | undefined {
  const record = asRecord(value);
  const kind = optionalString(record.kind);
  if (
    kind === "search_results" ||
    kind === "browser_snapshot" ||
    kind === "file_change_summary" ||
    kind === "file_diff_preview" ||
    kind === "command_summary" ||
    kind === "generic_tool_summary"
  ) {
    return value as RuntimeToolCallRecord["display"];
  }
  return undefined;
}

function toolResultEnvelopeOrUndefined(value: unknown): RuntimeToolCallRecord["envelope"] | undefined {
  const record = asRecord(value);
  const agentSummary = optionalString(record.agentSummary);
  const rawRetention = optionalString(record.rawRetention);
  if (agentSummary === undefined || (rawRetention !== "none" && rawRetention !== "diagnostic_ref_only")) {
    return undefined;
  }
  return {
    agentSummary: compactRuntimeText(agentSummary, 1_800),
    evidenceRefs: stringArrayFrom(record.evidenceRefs).map((ref) => compactRuntimeText(ref, 220)).slice(0, 12),
    uiDisplay: toolDisplayOrUndefined(record.uiDisplay),
    tokenEstimate: typeof record.tokenEstimate === "number" && Number.isFinite(record.tokenEstimate)
      ? Math.max(1, Math.floor(record.tokenEstimate))
      : Math.max(1, Math.ceil(agentSummary.length / 4)),
    truncated: record.truncated === true,
    redacted: record.redacted !== false,
    diagnosticRef: optionalString(record.diagnosticRef),
    rawRetention,
  };
}

function persistedToolPreview(
  toolName: string | undefined,
  output: Readonly<Record<string, unknown>>,
  result: Readonly<Record<string, unknown>>,
  payload: Readonly<Record<string, unknown>>
): string | undefined {
  const error = optionalString(payload.error);
  if (error !== undefined) {
    return compactRuntimeText(error, 800);
  }
  if (toolName === "read_file") {
    return persistedReadFilePreview(output, result);
  }
  if (toolName === "list_dir") {
    const entries = Array.isArray(result.entries) ? result.entries : [];
    const lines = entries.slice(0, 12).map((entry) => {
      const record = asRecord(entry);
      const name = optionalString(record.name) ?? "unknown";
      const kind = optionalString(record.kind) ?? "entry";
      return `${kind} ${name}`;
    });
    return lines.length === 0 ? cleanOrdinaryToolText(optionalString(output.summary)) : lines.join("\n");
  }
  if (toolName === "grep_files") {
    const matches = Array.isArray(result.matches) ? result.matches : [];
    const lines = matches.slice(0, 12).map((match) => {
      const record = asRecord(match);
      const matchPath = optionalString(record.path) ?? "unknown";
      const line = typeof record.line === "number" ? record.line : "?";
      const preview = optionalString(record.preview) ?? "";
      return `${matchPath}:${line} ${preview}`;
    });
    return lines.length === 0 ? cleanOrdinaryToolText(optionalString(output.summary)) : lines.join("\n");
  }
  if (toolName === "write_file" || toolName === "create_file" || toolName === "edit_file" || toolName === "delete_file") {
    return persistedFileChangePreview(toolName, asRecord(payload.input), output, result);
  }
  if (toolName === "run_command" || toolName === "shell_command") {
    return persistedCommandPreview(output, result);
  }
  if (toolName === "browser_snapshot") {
    const title = optionalString(result.title);
    const url = optionalString(result.url);
    const text = optionalString(result.text);
    const headline = [title, url].filter((item): item is string => item !== undefined).join(" · ");
    return compactRuntimeText(
      [headline, text].filter((item): item is string => typeof item === "string" && item.length > 0).join("\n"),
      900
    );
  }
  return cleanOrdinaryToolText(optionalString(output.summary));
}

function persistedFileChangePreview(
  toolName: string,
  input: Readonly<Record<string, unknown>>,
  output: Readonly<Record<string, unknown>>,
  result: Readonly<Record<string, unknown>>
): string | undefined {
  const resultPath = optionalString(result.path) ?? optionalString(input.path);
  const summary = cleanOrdinaryToolText(optionalString(output.summary));
  if (toolName === "edit_file") {
    const replacements = typeof result.replacements === "number" ? `替换：${result.replacements} 处` : undefined;
    const diffPreview = ["变更预览", replacements]
      .filter((item): item is string => item !== undefined && item.length > 0)
      .join("\n");
    return [summary, resultPath === undefined ? undefined : `文件：${resultPath}`, diffPreview].filter((item): item is string => item !== undefined && item.length > 0).join("\n");
  }
  return [summary, resultPath === undefined ? undefined : `文件：${resultPath}`].filter((item): item is string => item !== undefined && item.length > 0).join("\n");
}

function persistedReadFilePreview(
  output: Readonly<Record<string, unknown>>,
  result: Readonly<Record<string, unknown>>
): string | undefined {
  return safeReadFileToolPreview({
    summary: optionalString(output.summary),
    path: optionalString(result.path),
    bytes: typeof result.bytes === "number" ? result.bytes : undefined,
  });
}

function persistedCommandPreview(
  output: Readonly<Record<string, unknown>>,
  result: Readonly<Record<string, unknown>>
): string | undefined {
  return safeCommandToolPreview({
    summary: optionalString(output.summary),
    command: optionalString(result.command),
    exitCode: typeof result.exitCode === "number" ? result.exitCode : undefined,
  });
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

function mergeToolStatus(
  previous: RuntimeToolCallRecord["status"] | undefined,
  eventType: PanelRunStreamEvent["type"]
): RuntimeToolCallRecord["status"] {
  if (previous === "failed" || eventType === "tool.failed") {
    return "failed";
  }
  if (previous === "completed" || eventType === "tool.completed") {
    return "completed";
  }
  if (previous === "cancelled") {
    return "cancelled";
  }
  if (eventType === "confirmation.needed" || previous === "approval_required") {
    return "approval_required";
  }
  return "requested";
}
