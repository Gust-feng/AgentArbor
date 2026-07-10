import type { ToolCallRequest, ToolDisplayProjection } from "../../domain/tools/index.js";
import type { InternalToolResult } from "./tool-result-canonical.js";
import { asRecord, isMcpToolName, stringOrUndefined } from "./tool-result-facts.js";
import { compactSafeText } from "./tool-projection-text.js";

type ToolDisplayShape = "file" | "sources" | "diff" | "terminal" | "approval" | "text" | "generic";

export function projectToolFallbackSummary(
  request: ToolCallRequest,
  output: unknown,
  display: ToolDisplayProjection,
  modelResult: InternalToolResult
): string {
  const record = asRecord(output);
  const mcpLike = isMcpToolName(request.toolName) || record.mcpResult !== undefined;
  const toolExplanation = explicitExplanationFromOutput(record, { includeSummary: !mcpLike });
  if (toolExplanation !== undefined) {
    return toolExplanation;
  }
  const mcpText = mcpLike
    ? explanationFromToolResultText(modelResult)
    : undefined;
  if (mcpText !== undefined) {
    return mcpText;
  }
  const structuredText = explanationFromStructuredContent(modelResult.structuredContent);
  if (structuredText !== undefined) {
    return structuredText;
  }
  const shape = displayShapeForTool(request, display);
  return fallbackExplanationForShape(shape, modelResult.isError === true);
}

export function toolResultFallbackText(
  request: ToolCallRequest,
  display: ToolDisplayProjection,
  record: Readonly<Record<string, unknown>>
): string {
  return compactExplanationText(stringOrUndefined(record.summary)) ??
    fallbackExplanationForShape(displayShapeForTool(request, display), record.isError === true);
}

function displayShapeForTool(request: ToolCallRequest, display: ToolDisplayProjection): ToolDisplayShape {
  if (display.kind === "command_summary") return "terminal";
  if (display.kind === "search_results" || display.kind === "file_search_results") return "sources";
  if (display.kind === "file_change_summary" || display.kind === "file_diff_preview") return "diff";
  if (display.kind === "read_result") return "file";
  if (display.kind === "browser_snapshot" || display.kind === "http_response") return "text";
  if (display.kind === "generic_tool_summary" && isMcpToolName(request.toolName)) return "text";
  return displayShapeForToolName(request.toolName);
}

function displayShapeForToolName(toolName: string): ToolDisplayShape {
  const normalized = toolName.trim().toLowerCase();
  if (normalized === "run_command" || normalized === "shell_command" || normalized.includes("command") || normalized.includes("terminal")) {
    return "terminal";
  }
  if (normalized === "search" || normalized.includes("search") || normalized.includes("grep")) {
    return "sources";
  }
  if (normalized.includes("edit") || normalized.includes("write") || normalized.includes("create") || normalized.includes("delete") || normalized.includes("patch")) {
    return "diff";
  }
  if (normalized.startsWith("read") || normalized.includes("file")) {
    return "file";
  }
  return "generic";
}

function explicitExplanationFromOutput(
  record: Readonly<Record<string, unknown>>,
  options: { readonly includeSummary: boolean } = { includeSummary: true }
): string | undefined {
  const legacyPresentation = asRecord(record.presentation);
  const explanation = asRecord(legacyPresentation.explanation);
  const candidates = [
    stringOrUndefined(explanation.text),
    typeof record.explanation === "string" ? record.explanation : stringOrUndefined(asRecord(record.explanation).text),
    stringOrUndefined(record.message),
    options.includeSummary ? stringOrUndefined(record.summary) : undefined,
  ];
  return candidates
    .map((candidate) => candidate === undefined ? undefined : compactExplanationText(candidate))
    .find((candidate): candidate is string => candidate !== undefined && !isLowValueExplanation(candidate));
}

function explanationFromToolResultText(result: InternalToolResult): string | undefined {
  const text = result.content
    .map((part) => part.type === "text" ? part.text : part.type === "resource" ? part.text : undefined)
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  return compactExplanationText(text);
}

function explanationFromStructuredContent(value: unknown): string | undefined {
  const record = asRecord(value);
  const candidates = [
    stringOrUndefined(record.explanation),
    stringOrUndefined(asRecord(record.explanation).text),
    stringOrUndefined(record.message),
    stringOrUndefined(record.summary),
    stringOrUndefined(record.title),
  ];
  return candidates
    .map((candidate) => candidate === undefined ? undefined : compactExplanationText(candidate))
    .find((candidate): candidate is string => candidate !== undefined && !isLowValueExplanation(candidate));
}

function fallbackExplanationForShape(shape: ToolDisplayShape, isError: boolean): string {
  if (shape === "approval") return "这个操作需要确认后才能继续。";
  if (isError) {
    if (shape === "terminal") return "命令返回了错误输出。";
    if (shape === "sources") return "工具返回了需要处理的问题。";
    return "工具返回了错误信息。";
  }
  if (shape === "terminal") return "命令返回了执行输出。";
  if (shape === "sources") return "工具返回了可参考的结果。";
  if (shape === "diff") return "工具返回了文件变更内容。";
  if (shape === "file") return "工具返回了可阅读内容。";
  if (shape === "text") return "工具返回了一段文本。";
  return "工具返回了可查看的结果。";
}

function compactExplanationText(value: string | undefined): string | undefined {
  const text = compactSafeText(value?.replace(/\s+/g, " "), 180);
  if (text === undefined || text.length === 0) {
    return undefined;
  }
  const firstLine = text.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? text;
  return compactSafeText(firstLine, 180);
}

function isLowValueExplanation(value: string): boolean {
  const normalized = value.replace(/[。.!！?？；;:：、，,\s_-]/g, "").trim().toLowerCase();
  if (normalized.length === 0) return true;
  return normalized === "工具已完成" ||
    normalized === "工具完成" ||
    normalized === "动作完成" ||
    normalized === "已完成" ||
    normalized === "完成" ||
    normalized === "读取完成" ||
    normalized === "资料读取完成" ||
    normalized === "文件已读取" ||
    normalized === "命令已执行" ||
    normalized === "执行完成" ||
    normalized === "搜索完成";
}
