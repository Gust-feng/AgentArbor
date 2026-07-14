import type { ModelResponse } from "../../domain/intelligence/index.js";
import type { TaskSoil } from "../../domain/soil/index.js";
import type { ToolCallResult } from "../../domain/tools/index.js";
import type { BasicAgentContextPack } from "../basic-agent-runtime/index.js";
import { asRecord, stringOrUndefined } from "../run-read-model/value-utils.js";
import { sanitizeAssistantVisibleText } from "../text-projection/visible-text-safety.js";
import type {
  DesktopAgentPendingConfirmation,
  DesktopAgentSessionResult,
} from "./desktop-agent-session-contracts.js";

export function safeDesktopAgentContextPack(
  pack: BasicAgentContextPack
): NonNullable<DesktopAgentSessionResult["contextPack"]> {
  return {
    usageSummary: pack.usageSummary,
    items: pack.items.map((item) => ({
      itemId: item.itemId,
      sourceKind: item.sourceKind,
      role: item.role,
      summary: safeText(item.sourceKind === "system" ? "当前任务的系统指令。" : item.summary, 320),
      refs: item.refs,
      visibility: item.visibility,
      truncated: item.truncated,
      skill: item.skill,
    })),
    budget: pack.budget,
    truncationReport: pack.truncationReport,
    truncated: pack.truncated,
  };
}

export function parseAnswer(response: ModelResponse): string | undefined {
  const text =
    typeof response.textOutput === "string" && response.textOutput.trim().length > 0
      ? response.textOutput.trim()
      : typeof response.structuredOutput === "string" && response.structuredOutput.trim().length > 0
        ? response.structuredOutput.trim()
        : undefined;
  if (text === undefined) {
    return undefined;
  }
  const visible = sanitizeAssistantVisibleText(text);
  return visible.length > 0 ? visible : undefined;
}

export function refsFromResponse(
  response: ModelResponse | undefined,
  requestId: string | undefined,
  responseId: string | undefined,
): readonly string[] {
  return [
    requestId,
    response?.requestId,
    responseId,
    response?.responseId,
  ].filter((value, index, values): value is string => typeof value === "string" && values.indexOf(value) === index);
}

export function refsFromToolCalls(toolCalls: readonly ToolCallResult[]): readonly string[] {
  return toolCalls.map((call) => call.callId);
}

export function pendingConfirmationFrom(input: {
  readonly goal: string;
  readonly taskSoil: TaskSoil;
  readonly toolCalls: readonly ToolCallResult[];
  readonly traceId: string;
  readonly goalId: string;
  readonly modelCallRefs: readonly string[];
  readonly toolCallRefs: readonly string[];
}): DesktopAgentPendingConfirmation | undefined {
  const approvalRequired = input.toolCalls.find(
    (call) => call.status === "approval_required" && call.confirmationRequest !== undefined
  );
  if (approvalRequired?.confirmationRequest === undefined) {
    return undefined;
  }
  const confirmation = approvalRequired.confirmationRequest;
  return {
    confirmationId: confirmation.confirmationId,
    title: confirmation.title,
    question: confirmation.actionSummary,
    consequence: confirmation.consequence ?? confirmationConsequenceFallback(confirmation),
    affectedResources: confirmation.affectedResources,
    riskLevel: confirmation.riskLevel,
    resumeAvailability: confirmation.resumeAvailability,
    requestedAt: confirmation.requestedAt,
    expiresAt: confirmation.expiresAt,
    modelCallRefs: input.modelCallRefs,
    toolCallRefs: [approvalRequired.callId],
    sourceRefs: confirmation.sourceRefs,
  };
}

function confirmationConsequenceFallback(input: {
  readonly title: string;
  readonly actionSummary: string;
  readonly affectedResources: readonly string[];
}): string {
  const title = safeText(input.title, 120);
  const resources = input.affectedResources.slice(0, 4).join("、");
  const target = resources.length === 0 ? "" : `目标：${safeText(resources, 240)}。`;
  if (title.length > 0) {
    return `${target}批准后只执行本次${title}。`;
  }
  return `${target}批准后只执行本次操作。`;
}

export function evidenceRefsFromToolCalls(toolCalls: readonly ToolCallResult[]): readonly string[] {
  const refs: string[] = [];
  for (const call of toolCalls) {
    if (call.status !== "completed") {
      continue;
    }
    refs.push(`tool:${call.callId}`);
    const output = asRecord(call.output);
    const outputRef = stringOrUndefined(output.refId);
    if (outputRef !== undefined) {
      refs.push(safeText(outputRef, 180));
    }
    const results = Array.isArray(output.results) ? output.results : [];
    for (const result of results) {
      const item = asRecord(result);
      const ref = stringOrUndefined(item.refId) ?? stringOrUndefined(item.uri) ?? stringOrUndefined(item.title);
      if (ref !== undefined) {
        refs.push(safeText(ref, 180));
      }
    }
  }
  return unique(refs).slice(0, 12);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function safeText(value: string, maxLength: number): string {
  const text = value.trim();
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 3))}...` : text;
}
