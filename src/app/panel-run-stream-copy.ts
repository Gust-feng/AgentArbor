import type { ArborMessageType } from "../domain/common.js";
import type { ModelVisibleOutputProjection } from "../domain/intelligence/index.js";
import type { EventLogEntry } from "../kernel/events/in-memory-event-log.js";
import { modelVisibleOutputOrUndefined } from "./panel-transcript-model-calls.js";
import { asRecord, isString, numberOrUndefined, stringOrUndefined } from "./panel-read-model-utils.js";
import { compactStreamDetailText, type PanelRunStreamEventDetail } from "./panel-stream-tool-projection.js";
import type { PanelObservationReadModel } from "./panel-run-tracking-contracts.js";
import { cleanConfirmationSummary } from "./confirmation-copy.js";
import type { PanelRunStreamEvent, PanelRunStreamEventType } from "./panel-run-stream-contracts.js";
import type { PanelRunSummary, PanelRunSummaryPayload } from "./panel-run-summary.js";
import { friendlyUserFacingFailureText } from "./visible-text-safety.js";
import { modelRequestedSummary as projectedModelRequestedSummary } from "./panel-model-progress-copy.js";
import { friendlyFailureCopy } from "./failure-copy.js";

export function blockedRunSummary(error: { readonly code: string; readonly message: string } | undefined): string {
  if (error?.code === "out_of_fuel") {
    return "任务没有完成。你可以继续发送消息，我会接着处理。";
  }
  return friendlyUserFacingFailureText(error?.message ?? "运行中断，等待用户确认或补充指导。");
}

export function runStartedSummary(desktopMode: "agent" | "deep" | undefined): string {
  return desktopMode === "deep"
    ? "已进入深度处理，会并行检查上下文、汇总判断并形成结果。"
    : "";
}

export function agentFabricLabel(type: PanelRunStreamEventType): string {
  switch (type) {
    case "agent.delegation.planned":
      return "任务分工";
    case "agent.child.started":
    case "agent.child.completed":
    case "agent.child.waiting":
      return "并行检查";
    case "agent.parent_synthesis.completed":
      return "汇总判断";
    default:
      return "工作更新";
  }
}

export function agentFabricSummary(type: PanelRunStreamEventType, payload: Readonly<Record<string, unknown>>): string {
  if (type === "agent.delegation.planned") {
    const childSpecIds = Array.isArray(payload.childSpecIds) ? payload.childSpecIds.filter(isString) : [];
    return `已形成分工计划，准备 ${childSpecIds.length} 路检查。`;
  }
  if (type === "agent.child.started") {
    const spec = asRecord(payload.agentSpec);
    return `${publicCheckName(stringOrUndefined(spec.displayName))}已启动。`;
  }
  if (type === "agent.child.completed") {
    const outputRefs = Array.isArray(payload.outputRefs) ? payload.outputRefs.filter(isString) : [];
    return `一路检查已完成，产出 ${outputRefs.length} 个材料引用。`;
  }
  if (type === "agent.child.waiting") {
    const childRunIds = Array.isArray(payload.childRunIds) ? payload.childRunIds.filter(isString) : [];
    return `正在等待 ${childRunIds.length} 路检查材料返回。`;
  }
  if (type === "agent.parent_synthesis.completed") {
    const synthesis = asRecord(payload.parentSynthesis);
    return `汇总判断完成：${stringOrUndefined(synthesis.decisionSummary) ?? "检查材料已合并"}。`;
  }
  return "工作状态已更新。";
}

export function modelRequestedSummary(payload: Readonly<Record<string, unknown>>): string | undefined {
  return projectedModelRequestedSummary(payload);
}

export function modelCompletedSummary(payload: Readonly<Record<string, unknown>>): string {
  const validation = stringOrUndefined(payload.validationStatus) ?? "unknown";
  return validation === "passed" ? "内容已整理。" : `内容已整理，校验 ${validation}。`;
}

export function modelFailedSummary(payload: Readonly<Record<string, unknown>>): string {
  return modelFailureErrorText(payload) ?? stringOrUndefined(payload.failureKind) ?? "模型调用失败。";
}

export function modelFailureStreamDetail(payload: Readonly<Record<string, unknown>>): PanelRunStreamEventDetail | undefined {
  const error = modelFailureErrorText(payload);
  return error === undefined
    ? undefined
    : {
        kind: "thinking",
        action: "模型调用失败",
        error,
        truncated: false,
      };
}

export function runFailureStreamDetail(
  error: { readonly code: string; readonly message: string } | undefined
): PanelRunStreamEventDetail | undefined {
  if (error === undefined) {
    return undefined;
  }
  const message = friendlyUserFacingFailureText(error.message);
  return {
    kind: "thinking",
    action: "运行未完成",
    error: compactFailureText(message, 1_000),
    truncated: false,
  };
}

export function runFailedSummary(error: { readonly message: string } | undefined): string {
  return friendlyUserFacingFailureText(error?.message);
}

export function contextCompactionStreamSummary(
  type: "context.compaction.completed" | "context.compaction.failed",
  payload: Readonly<Record<string, unknown>>
): string {
  const summary = stringOrUndefined(payload.summary);
  if (summary !== undefined) {
    return summary;
  }
  const tokenCount = numberOrUndefined(payload.tokenCount);
  const threshold = numberOrUndefined(payload.threshold);
  const tokenText = tokenCount === undefined || threshold === undefined ? "" : `（${tokenCount}/${threshold} tokens）`;
  return type === "context.compaction.completed"
    ? `较早上下文已整理${tokenText}。`
    : `上下文整理没有成功${tokenText}。`;
}

export function contextCompactionPreview(payload: Readonly<Record<string, unknown>>): string | undefined {
  const covered = numberOrUndefined(payload.coveredRefCount);
  const messageCountAfter = numberOrUndefined(payload.messageCountAfter);
  const parts = [
    covered === undefined ? undefined : `覆盖较早上下文 ${covered} 条`,
    messageCountAfter === undefined ? undefined : `压缩后消息 ${messageCountAfter} 条`,
    stringOrUndefined(payload.error),
  ].filter(isString);
  return parts.length === 0 ? undefined : parts.join("；");
}

export function confirmationSummary(payload: Readonly<Record<string, unknown>>): string {
  const question = stringOrUndefined(payload.question);
  const consequence = stringOrUndefined(payload.consequence);
  if (question !== undefined && consequence !== undefined) {
    return compactStreamDetailText(cleanConfirmationSummary(`${question} ${consequence}`), 500) ?? "继续前需要用户补充授权或澄清。";
  }
  return question === undefined
    ? "继续前需要用户补充授权或澄清。"
    : compactStreamDetailText(cleanConfirmationSummary(question), 500) ?? "继续前需要用户补充授权或澄清。";
}

export function userGuidanceSummary(payload: Readonly<Record<string, unknown>>): string {
  const decision = stringOrUndefined(payload.decision) ?? stringOrUndefined(payload.status);
  const note = stringOrUndefined(payload.note) ?? stringOrUndefined(payload.guidance);
  if (decision !== undefined && note !== undefined) {
    return `用户已${decision}：${note}`;
  }
  return note ?? "用户已补充指导，工作可以继续。";
}

export function agentNoteForEvent(
  entry: EventLogEntry,
  payload: Readonly<Record<string, unknown>>
): { readonly agentLabel: string; readonly summary: string; readonly status: PanelRunStreamEvent["status"] } | undefined {
  switch (entry.type) {
    case "goal.received":
      return { agentLabel: "用户", summary: "消息已收到。", status: "completed" };
    case "underground.exploration_planned":
      return { agentLabel: "任务理解", summary: "任务目标和探索计划已形成。", status: "completed" };
    case "rootlet_cluster.started":
      return { agentLabel: "并行检查", summary: "已启动多路检查，开始探索候选方向。", status: "running" };
    case "exploration_candidate.produced":
      return { agentLabel: "并行检查", summary: "一路检查已产出候选材料，等待汇总。", status: "completed" };
    case "candidate_pool.updated":
      return { agentLabel: "材料汇总", summary: "候选材料已更新，后续会继续校验和收束。", status: "completed" };
    case "autonomy_review.completed":
      return {
        agentLabel: "任务判断",
        summary: autonomySummary(payload),
        status: "completed",
      };
    case "convergence_review.requested":
      return { agentLabel: "任务判断", summary: "正在评估候选材料是否足够收束。", status: "running" };
    case "convergence_review.completed":
      return { agentLabel: "汇总判断", summary: "候选材料已完成汇总判断。", status: "completed" };
    case "direction_handoff.requested":
      return { agentLabel: "结果整理", summary: "正在把已确认方向整理为可交付结果。", status: "running" };
    case "direction_handoff.completed":
      return { agentLabel: "结果整理", summary: "结果材料已通过校验并生成。", status: "completed" };
    case "direction_handoff.revision_requested":
      return { agentLabel: "结果整理", summary: "结果材料需要修订或补充。", status: "running" };
    case "user_approval.requested":
      return { agentLabel: "用户确认", summary: "继续前需要用户澄清。", status: "running" };
    case "user_approval.received":
      return { agentLabel: "用户确认", summary: "用户澄清已收到，工作继续推进。", status: "completed" };
    default:
      return undefined;
  }
}

export function visibleOutputText(value: unknown): string {
  const output = modelVisibleOutputOrUndefined(value);
  if (output === undefined) {
    return "";
  }
  const primaryParts: string[] = [];
  const secondaryParts: string[] = [];
  for (const item of output.items) {
    for (const field of item.fields) {
      const valueText = field.value;
      if (valueText.trim().length === 0) continue;
      const suffix = field.truncated ? " (truncated)" : "";
      if (isPrimaryVisibleOutputField(field.name)) {
        primaryParts.push(`${valueText}${suffix}`);
      } else {
        secondaryParts.push(`${field.name}: ${valueText}${suffix}`);
      }
    }
  }
  return uniqueTextParts(primaryParts.length > 0 ? primaryParts : secondaryParts).join("\n");
}

export function visibleOutputSummary(value: string, maxLength: number): string {
  return compactStreamDetailText(value, maxLength) ?? value;
}

export function chunkText(value: string, maxLength: number): readonly string[] {
  if (value.trim().length === 0) {
    return [];
  }
  const text = value;
  const chunks: string[] = [];
  let index = 0;
  while (index < text.length) {
    const remaining = text.length - index;
    if (remaining <= maxLength) {
      chunks.push(text.slice(index));
      break;
    }
    const end = preferredChunkEnd(text, index, maxLength);
    chunks.push(text.slice(index, end));
    index = end;
  }
  return chunks;
}

export function finalResultSummary(input: {
  readonly summary?: PanelRunSummaryPayload;
  readonly observation?: PanelObservationReadModel;
  readonly eventEntries: readonly EventLogEntry[];
  readonly desktopMode?: "agent" | "deep";
}): string | undefined {
  if (input.desktopMode === "agent") {
    const directAnswer = latestDirectAnswerPayload(input.eventEntries);
    if (directAnswer !== undefined) {
      return `已回答：${directAnswer.answer}`;
    }
    return undefined;
  }
  const summary = fullSummaryOrUndefined(input.summary);
  if (summary !== undefined) {
    return `任务运行完成，已形成可执行方案，状态 ${summary.directionPackage.status}。`;
  }
  const artifact = latestArtifactProducedPayload(input.eventEntries);
  if (artifact !== undefined) {
    return `任务运行完成，已生成报告：${artifact.summary ?? artifact.artifactId ?? "artifact"}。`;
  }
  const directAnswer = latestDirectAnswerPayload(input.eventEntries);
  if (directAnswer !== undefined) {
    return `已回答：${directAnswer.answer}`;
  }
  if (input.observation?.aboveground.status === "completed") {
    const handoff = input.observation.handoff;
    return handoff.packageId.length === 0
      ? "任务运行完成，已产出结果。"
      : "任务运行完成，已产出结果。";
  }
  return "运行完成。";
}

export function finalSourceRefs(input: {
  readonly summary?: PanelRunSummaryPayload;
  readonly observation?: PanelObservationReadModel;
  readonly eventEntries: readonly EventLogEntry[];
  readonly desktopMode?: "agent" | "deep";
}): readonly string[] {
  if (input.desktopMode === "agent") {
    const directAnswer = latestDirectAnswerPayload(input.eventEntries);
    return directAnswer?.requestId === undefined ? [] : [`model_call:${directAnswer.requestId}`];
  }
  const summary = fullSummaryOrUndefined(input.summary);
  if (summary !== undefined) {
    return [
      `direction_package:${summary.directionPackage.id}`,
      `direction_handoff:${summary.directionPackage.directionId}`,
    ];
  }
  const handoff = input.observation?.handoff;
  if (handoff !== undefined && handoff.packageId.length > 0) {
    return [`direction_package:${handoff.packageId}`, `direction_handoff:${handoff.directionId}`];
  }
  const artifact = latestArtifactProducedPayload(input.eventEntries);
  if (artifact?.artifactId !== undefined) {
    return [`artifact:${artifact.artifactId}`];
  }
  const directAnswer = latestDirectAnswerPayload(input.eventEntries);
  return directAnswer?.requestId === undefined ? [] : [`model_call:${directAnswer.requestId}`];
}

function modelFailureErrorText(payload: Readonly<Record<string, unknown>>): string | undefined {
  const message = modelFailureMessageForDisplay(stringOrUndefined(payload.failureMessage));
  if (message !== undefined) {
    return message;
  }
  return modelFailureKindForDisplay(stringOrUndefined(payload.failureKind));
}

function modelFailureMessageForDisplay(message: string | undefined): string | undefined {
  const safe = compactFailureText(friendlyFailureCopy(message ?? ""), 1_000);
  if (safe.length === 0) {
    return undefined;
  }
  return safe;
}

function compactFailureText(value: string, maxLength: number): string {
  const text = value.trim();
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function modelFailureKindForDisplay(failureKind: string | undefined): string | undefined {
  switch (failureKind) {
    case "provider_auth":
      return "模型服务鉴权失败。";
    case "provider_rate_limit":
      return "模型服务限流。";
    case "provider_timeout":
      return "模型服务请求超时。";
    case "provider_network":
      return "模型服务连接失败。";
    case "output_validation":
      return "模型输出校验失败。";
    case "request_validation":
      return "模型请求无效。";
    case "provider_config":
      return "模型配置无效。";
    case "provider_response":
      return "模型服务响应无效。";
    case "model_failed":
      return "模型调用失败。";
    default:
      return undefined;
  }
}

function autonomySummary(payload: Readonly<Record<string, unknown>>): string {
  const decision = asRecord(payload.autonomyDecision);
  const action = stringOrUndefined(decision.action) ?? stringOrUndefined(payload.action) ?? "";
  if (action.length === 0 || action === "unknown") {
    return "任务判断完成。";
  }
  return `任务判断完成，下一步：${action}。`;
}

function publicCheckName(value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) return "一路检查";
  return value
    .replace(/\brootlet\b/giu, "检查")
    .replace(/\bRootlet\b/g, "检查")
    .trim() || "一路检查";
}

function uniqueTextParts(parts: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of parts) {
    const key = part.replace(/\s+/g, " ").trim();
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    result.push(part);
  }
  return result;
}

function isPrimaryVisibleOutputField(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized === "answer" ||
    normalized === "content" ||
    normalized === "text" ||
    normalized === "summary" ||
    normalized === "message" ||
    normalized === "decisionsummary" ||
    normalized === "decision_summary" ||
    normalized === "directanswer" ||
    normalized === "direct_answer" ||
    normalized === "finalanswer" ||
    normalized === "final_answer";
}

function preferredChunkEnd(text: string, start: number, maxLength: number): number {
  const hardEnd = Math.min(start + maxLength, text.length);
  const candidate = text.slice(start, hardEnd);
  const boundary = Math.max(
    candidate.lastIndexOf("\n"),
    candidate.lastIndexOf("。"),
    candidate.lastIndexOf("！"),
    candidate.lastIndexOf("？"),
    candidate.lastIndexOf("."),
    candidate.lastIndexOf("!"),
    candidate.lastIndexOf("?"),
    candidate.lastIndexOf(";"),
    candidate.lastIndexOf("；"),
    candidate.lastIndexOf(","),
    candidate.lastIndexOf("，"),
    candidate.lastIndexOf(" ")
  );
  if (boundary >= Math.floor(maxLength * 0.45)) {
    return start + boundary + 1;
  }
  return hardEnd;
}

function latestArtifactProducedPayload(eventEntries: readonly EventLogEntry[]): { readonly artifactId?: string; readonly summary?: string } | undefined {
  const artifactEvent = [...eventEntries].reverse().find((entry) => entry.type === "artifact.produced");
  if (artifactEvent === undefined) {
    return undefined;
  }
  const payload = asRecord(artifactEvent.message.payload);
  return {
    artifactId: stringOrUndefined(payload.artifactId),
    summary: stringOrUndefined(payload.summary),
  };
}

function latestDirectAnswerPayload(eventEntries: readonly EventLogEntry[]): { readonly requestId?: string; readonly answer: string } | undefined {
  for (const entry of [...eventEntries].reverse()) {
    if (entry.type !== "model.completed") {
      continue;
    }
    const payload = asRecord(entry.message.payload);
    const visibleOutput = modelVisibleOutputOrUndefined(payload.visibleOutput);
    if (!isDirectAnswerOutput(visibleOutput)) {
      continue;
    }
    const answer = visibleOutput.items
      .flatMap((item) => item.fields)
      .find((field) => field.name === "text" || field.name === "answer")
      ?.value
      .trim();
    if (answer !== undefined && answer.length > 0) {
      return {
        requestId: stringOrUndefined(payload.requestId),
        answer,
      };
    }
  }
  return undefined;
}

function isDirectAnswerOutput(visibleOutput: ModelVisibleOutputProjection | undefined): visibleOutput is ModelVisibleOutputProjection {
  return visibleOutput?.contractId === "work_session.direct_answer.v1" ||
    visibleOutput?.contractId === "desktop.agent_response.v1" ||
    visibleOutput?.contractId === "desktop.agent.answer.v1" ||
    visibleOutput?.contractId === "desktop.chat_response.v1" ||
    visibleOutput?.contractId === "desktop.chat.answer.v1";
}

function fullSummaryOrUndefined(value: PanelRunSummaryPayload | undefined): PanelRunSummary | undefined {
  return value !== undefined && "directionPackage" in value ? value : undefined;
}
