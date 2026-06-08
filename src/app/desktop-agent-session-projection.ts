import type { ModelResponse } from "../domain/intelligence/index.js";
import type { TaskSoil } from "../domain/soil/index.js";
import type { ToolCallResult } from "../domain/tools/index.js";
import { toolDisplayName } from "../domain/tools/index.js";
import type { EventLogEntry } from "../kernel/events/in-memory-event-log.js";
import { createId, nowIso } from "../kernel/id.js";
import type { BasicAgentContextPack } from "./basic-agent-runtime/index.js";
import type {
  DesktopAgentActivity,
  DesktopAgentPendingConfirmation,
  DesktopAgentResultBlock,
  DesktopAgentSessionResult,
  DesktopAgentSessionStatus,
} from "./desktop-agent-session-contracts.js";
import { asRecord, isString, numberOrUndefined, stringOrUndefined } from "./panel-read-model-utils.js";
import { sanitizeAssistantVisibleText } from "./visible-text-safety.js";

export function safeDesktopAgentContextPack(
  pack: BasicAgentContextPack
): NonNullable<DesktopAgentSessionResult["contextPack"]> {
  return {
    usageSummary: pack.usageSummary,
    items: pack.items.map((item) => ({
      ...item,
      summary: safeText(item.sourceKind === "system" ? "桌面基础 Agent 系统边界。" : item.summary, 320),
    })),
    budget: pack.budget,
    truncationReport: pack.truncationReport,
    truncated: pack.truncated,
  };
}

export function parseAnswer(
  response: ModelResponse,
  toolCalls: readonly ToolCallResult[]
): string | undefined {
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
  return visible.length > 0
    ? safeText(visible, 12000)
    : undefined;
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
  const approvalRequired = input.toolCalls.find((call) => call.status === "approval_required" && call.confirmationRequest !== undefined);
  if (approvalRequired?.confirmationRequest !== undefined) {
    const confirmation = approvalRequired.confirmationRequest;
    return {
      confirmationId: confirmation.confirmationId,
      title: confirmation.title,
      question: confirmation.actionSummary,
      consequence: "",
      riskLevel: confirmation.riskLevel,
      requestedAt: confirmation.requestedAt,
      modelCallRefs: input.modelCallRefs,
      toolCallRefs: [approvalRequired.callId],
      sourceRefs: confirmation.sourceRefs,
    };
  }
  return undefined;
}

export function resultBlocksFrom(input: {
  readonly answer: string;
  readonly toolCalls: readonly ToolCallResult[];
  readonly evidenceRefs: readonly string[];
  readonly pendingConfirmation?: DesktopAgentPendingConfirmation;
}): readonly DesktopAgentResultBlock[] {
  const blocks: DesktopAgentResultBlock[] = [
    {
      blockId: createId("result-block"),
      kind: "answer",
      title: "结果",
      summary: safeText(input.answer, 1200),
      evidenceRefs: input.evidenceRefs.slice(0, 8),
      toolCallRefs: input.toolCalls.map((call) => call.callId),
    },
  ];
  if (input.toolCalls.length > 0) {
    const completed = input.toolCalls.filter((call) => call.status === "completed").length;
    const failed = input.toolCalls.filter((call) => call.status === "failed").length;
    const approvalRequired = input.toolCalls.filter((call) => call.status === "approval_required").length;
    blocks.push({
      blockId: createId("result-block"),
      kind: failed > 0 ? "failure" : "tool_summary",
      title: "工具摘要",
      summary: toolSummaryText(input.toolCalls, completed, failed, approvalRequired),
      evidenceRefs: input.evidenceRefs.slice(0, 8),
      toolCallRefs: input.toolCalls.map((call) => call.callId),
    });
  }
  if (input.pendingConfirmation !== undefined) {
    blocks.push({
      blockId: createId("result-block"),
      kind: "pending_confirmation",
      title: input.pendingConfirmation.title,
      summary: joinDisplayText(input.pendingConfirmation.question, input.pendingConfirmation.consequence),
      evidenceRefs: input.pendingConfirmation.sourceRefs,
      toolCallRefs: input.pendingConfirmation.toolCallRefs,
    });
  }
  return blocks;
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

export function activityFromEventEntries(
  entries: readonly EventLogEntry[],
  terminalStatus: DesktopAgentSessionStatus
): readonly DesktopAgentActivity[] {
  const activities = entries.flatMap(activityFromEventEntry);
  const terminal = terminalActivity(entries.at(-1), terminalStatus);
  return terminal === undefined ? activities : [...activities, terminal];
}

function activityFromEventEntry(entry: EventLogEntry): readonly DesktopAgentActivity[] {
  const payload = asRecord(entry.message.payload);
  const sourceRefs = [`event:${entry.message.id}`];
  switch (entry.type) {
    case "goal.received":
      return [activity(entry, "task_received", "消息已收到", "开始处理。", "completed", sourceRefs)];
    case "model.requested":
      return [
        activity(
          entry,
          "model_requested",
          "正在处理",
          "正在整理回答或下一步动作。",
          "running",
          sourceRefs,
          refsFromPayload(payload),
        ),
      ];
    case "model.completed":
      return [
        activity(
          entry,
          "model_completed",
          "已更新",
          "继续处理。",
          "completed",
          sourceRefs,
          refsFromPayload(payload),
        ),
      ];
    case "model.failed":
      return [
        activity(
          entry,
          "model_failed",
          "回复失败",
          "没有返回可用结果。",
          "failed",
          sourceRefs,
          refsFromPayload(payload),
        ),
      ];
    case "context.compaction.completed":
      return [
        activity(
          entry,
          "model_completed",
          "上下文已整理",
          contextCompactionSummary(payload, "completed"),
          "completed",
          sourceRefs,
          refsFromPayload(payload),
        ),
      ];
    case "context.compaction.failed":
      return [
        activity(
          entry,
          "model_failed",
          "上下文整理失败",
          contextCompactionSummary(payload, "failed"),
          "failed",
          sourceRefs,
          refsFromPayload(payload),
        ),
      ];
    case "tool.requested":
    case "tool.completed":
    case "tool.failed": {
      const toolName = stringOrUndefined(payload.toolName) ?? "tool";
      const toolLabel = toolDisplayName(toolName);
      const output = asRecord(payload.output);
      const input = asRecord(payload.input);
      const result = asRecord(output.result);
      const type =
        entry.type === "tool.requested"
          ? "tool_requested"
          : entry.type === "tool.completed"
            ? "tool_completed"
            : "tool_failed";
      return [
        activity(
          entry,
          type,
          entry.type === "tool.requested" ? toolActivityTitle(toolName, "start") : entry.type === "tool.completed" ? toolActivityTitle(toolName, "completed") : toolActivityTitle(toolName, "failed"),
          entry.type === "tool.completed"
            ? completedToolActivitySummary(toolName, payload)
            : entry.type === "tool.failed"
              ? `${toolLabel}失败，错误信息已整理。`
              : `${toolLabel}开始执行。`,
          entry.type === "tool.requested" ? "running" : entry.type === "tool.completed" ? "completed" : "failed",
          sourceRefs,
          [],
          stringOrUndefined(payload.callId) === undefined ? [] : [stringOrUndefined(payload.callId) as string],
          toolName,
          {
            action: stringOrUndefined(output.action) ?? toolLabel,
            path: stringOrUndefined(result.path) ?? stringOrUndefined(input.path),
            truncated: output.truncated === true,
            error: stringOrUndefined(payload.error),
          },
        ),
      ];
    }
    case "user_approval.requested":
      return [
        activity(
          entry,
          "confirmation_needed",
          "需要确认",
          stringOrUndefined(payload.question) ?? "继续前需要你补充授权或澄清。",
          "running",
          sourceRefs,
        ),
      ];
    default:
      return [];
  }
}

function joinDisplayText(...parts: readonly string[]): string {
  return parts.map((part) => part.trim()).filter((part) => part.length > 0).join(" ");
}

function toolSummaryText(toolCalls: readonly ToolCallResult[], completed: number, failed: number, approvalRequired: number): string {
  const localSummaries = toolCalls
    .map((call) => {
      const output = asRecord(call.output);
      const action = stringOrUndefined(output.action);
      const summary = stringOrUndefined(output.summary);
      return action !== undefined && summary !== undefined ? `${action}: ${summary}` : undefined;
    })
    .filter((value): value is string => value !== undefined)
    .slice(0, 4);
  const base = `工具调用 ${toolCalls.length} 次；完成 ${completed} 次，失败 ${failed} 次，待确认 ${approvalRequired} 次。`;
  return localSummaries.length === 0 ? base : `${base}\n${localSummaries.join("\n")}`;
}

function contextCompactionSummary(
  payload: Readonly<Record<string, unknown>>,
  status: "completed" | "failed"
): string {
  const summary = stringOrUndefined(payload.summary);
  if (summary !== undefined) {
    return summary;
  }
  const tokenCount = numberOrUndefined(payload.tokenCount);
  const threshold = numberOrUndefined(payload.threshold);
  const tokenText = tokenCount === undefined || threshold === undefined ? "" : `（${tokenCount}/${threshold} tokens）`;
  return status === "completed"
    ? `较早上下文已整理，后续可以继续使用${tokenText}。`
    : `上下文整理没有成功${tokenText}，本轮已暂停。`;
}

function toolActivityTitle(toolName: string, phase: "start" | "completed" | "failed"): string {
  if (toolName === "read_file") return phase === "start" ? "正在读取文件" : phase === "completed" ? "文件已读取" : "文件读取失败";
  if (toolName === "list_dir") return phase === "start" ? "正在列出目录" : phase === "completed" ? "目录已列出" : "目录列出失败";
  if (toolName === "grep_files") return phase === "start" ? "正在搜索文件" : phase === "completed" ? "搜索已完成" : "搜索失败";
  if (toolName === "write_file") return phase === "start" ? "正在写入文件" : phase === "completed" ? "文件已写入" : "文件写入失败";
  if (toolName === "create_file") return phase === "start" ? "正在创建文件" : phase === "completed" ? "文件已创建" : "文件创建失败";
  if (toolName === "edit_file") return phase === "start" ? "正在编辑文件" : phase === "completed" ? "文件已编辑" : "文件编辑失败";
  if (toolName === "delete_file") return phase === "start" ? "正在删除文件" : phase === "completed" ? "文件已删除" : "文件删除失败";
  if (toolName === "run_command") return phase === "start" ? "正在执行命令" : phase === "completed" ? "命令已执行" : "命令执行失败";
  if (toolName === "shell_command") return phase === "start" ? "正在执行 Shell" : phase === "completed" ? "Shell 已执行" : "Shell 执行失败";
  if (toolName === "browser_snapshot") return phase === "start" ? "正在浏览网页" : phase === "completed" ? "网页已浏览" : "网页浏览失败";
  if (toolName === "search") return phase === "start" ? "正在搜索材料" : phase === "completed" ? "搜索已完成" : "搜索失败";
  if (toolName === "read") return phase === "start" ? "正在读取材料" : phase === "completed" ? "材料已读取" : "材料读取失败";
  return phase === "start" ? "正在执行工具" : phase === "completed" ? "工具已完成" : "工具执行失败";
}

function completedToolActivitySummary(toolName: string, payload: Readonly<Record<string, unknown>>): string {
  const output = asRecord(payload.output);
  const summary = stringOrUndefined(output.summary);
  if (summary !== undefined) {
    return summary;
  }
  return `${toolDisplayName(toolName)}已返回结果摘要。`;
}

function terminalActivity(
  lastEntry: EventLogEntry | undefined,
  status: DesktopAgentSessionStatus
): DesktopAgentActivity | undefined {
  const createdAt = lastEntry?.recordedAt ?? nowIso();
  const activityId = lastEntry === undefined ? createId("activity") : `${lastEntry.message.id}:terminal:${status}`;
  if (status === "completed") {
    return {
      activityId,
      type: "completed",
      title: "已完成",
      summary: "已完成。",
      status: "completed",
      createdAt,
      sourceRefs: lastEntry === undefined ? [] : [`event:${lastEntry.message.id}`],
      modelCallRefs: [],
      toolCallRefs: [],
    };
  }
  if (status === "confirmation_needed") {
    return {
      activityId,
      type: "confirmation_needed",
      title: "等待确认",
      summary: "需要用户补充授权或具体材料后再继续。",
      status: "running",
      createdAt,
      sourceRefs: lastEntry === undefined ? [] : [`event:${lastEntry.message.id}`],
      modelCallRefs: [],
      toolCallRefs: [],
    };
  }
  if (status === "stopped") {
    return {
      activityId,
      type: "stopped",
      title: "未开始",
      summary: "模型服务未配置，暂时无法处理。",
      status: "failed",
      createdAt,
      sourceRefs: lastEntry === undefined ? [] : [`event:${lastEntry.message.id}`],
      modelCallRefs: [],
      toolCallRefs: [],
    };
  }
  if (status === "paused") {
    return {
      activityId,
      type: "stopped",
      title: "已暂停",
      summary: "可以补充要求后继续。",
      status: "pending",
      createdAt,
      sourceRefs: lastEntry === undefined ? [] : [`event:${lastEntry.message.id}`],
      modelCallRefs: [],
      toolCallRefs: [],
    };
  }
  return {
    activityId,
    type: "failed",
    title: "未完成",
    summary: "没有形成可展示结果。",
    status: "failed",
    createdAt,
    sourceRefs: lastEntry === undefined ? [] : [`event:${lastEntry.message.id}`],
    modelCallRefs: [],
    toolCallRefs: [],
  };
}

function activity(
  entry: EventLogEntry,
  type: DesktopAgentActivity["type"],
  title: string,
  summary: string,
  status: DesktopAgentActivity["status"],
  sourceRefs: readonly string[],
  modelCallRefs: readonly string[] = [],
  toolCallRefs: readonly string[] = [],
  toolName?: string,
  toolDetail: Pick<DesktopAgentActivity, "action" | "path" | "truncated" | "error"> = {}
): DesktopAgentActivity {
  return {
    activityId: `${entry.message.id}:${type}`,
    type,
    title,
    summary,
    status,
    createdAt: entry.recordedAt,
    action: toolDetail.action,
    path: toolDetail.path,
    truncated: toolDetail.truncated,
    error: toolDetail.error,
    toolName,
    sourceRefs,
    modelCallRefs,
    toolCallRefs,
  };
}

function refsFromPayload(payload: Readonly<Record<string, unknown>>): readonly string[] {
  return unique([stringOrUndefined(payload.requestId), stringOrUndefined(payload.responseId)].filter(isString));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function safeText(value: string, maxLength: number): string {
  const text = value.trim();
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 3))}...` : text;
}
