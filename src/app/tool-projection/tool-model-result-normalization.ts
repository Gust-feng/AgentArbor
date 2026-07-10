import type {
  ToolCallRequest,
  ToolDisplayProjection,
  ToolErrorDomain,
  ToolErrorFacts,
  ToolResult,
  ToolSafeProjection,
} from "../../domain/tools/index.js";
import { toolDisplayName, toolModelAttachmentsFromOutput } from "../../domain/tools/index.js";
import {
  projectToolResultEnvelope as projectKernelToolResultEnvelope,
  projectToolStatusEnvelope,
} from "../../kernel/tools/index.js";
import { projectToolDisplay } from "./tool-display-projection.js";
import { projectToolAgentContent } from "./tool-agent-content-projection.js";
import {
  projectFileChangeToolModelResult,
  projectGenericToolModelResult,
} from "./tool-model-result-default-adapters.js";
import {
  projectContextAttachmentListToolModelResult,
  projectContextAttachmentTableToolModelResult,
  projectDirectoryToolModelResult,
  projectFileSearchToolModelResult,
  projectSearchToolModelResult,
} from "./tool-model-result-collection-adapters.js";
import {
  projectCommandToolModelResult,
  projectFileReadToolModelResult,
  projectResearchReadToolModelResult,
} from "./tool-model-result-read-adapters.js";
import {
  projectBrowserSnapshotToolModelResult,
  projectHttpResponseToolModelResult,
} from "./tool-model-result-web-adapters.js";
import {
  projectLegacyMcpToolResult,
  toolResultFromUnknown,
  type InternalToolResult,
} from "./tool-result-canonical.js";
import {
  asRecord,
  isMcpToolName,
  stringOrUndefined,
  textOrUndefined,
} from "./tool-result-facts.js";
import { compactSafeText, redactOrdinaryText } from "./tool-projection-text.js";
import { isSubAgentToolName, projectSubAgentToolModelResult } from "./sub-agent-tool-projection.js";
import {
  ensureToolResultContent,
  structuredSnapshot,
} from "./tool-model-result-support.js";
type ToolDisplayShape = "file" | "sources" | "diff" | "terminal" | "approval" | "text" | "generic";

export function projectToolResult(input: {
  readonly request: ToolCallRequest;
  readonly output: unknown;
  readonly maxPreviewChars?: number;
}): ToolSafeProjection {
  const record = asRecord(input.output);
  const summary = stringOrUndefined(record.summary);
  const refId = stringOrUndefined(record.refId);
  const truncated = record.truncated === true;
  const display = projectToolDisplay(input.request, input.output);
  const modelResult = projectToolModelResult(input.request, input.output, display, truncated);
  const fallbackSummary = projectToolFallbackSummary(input.request, input.output, display, modelResult);
  const modelContinuation = projectToolModelContinuation({
    request: input.request,
    output: input.output,
    modelResult,
    truncated,
  });
  const diagnosticRef = refId ?? `tool:${input.request.callId}`;
  const envelope = projectKernelToolResultEnvelope({
    request: input.request,
    display,
    summary,
    diagnosticRef,
    truncated,
  });
  // agentContent is the model-continuation payload. UI-only summaries and
  // display previews must never replace it.
  return {
    agentContent: modelContinuation.agentContent,
    modelResult: modelContinuation.modelResult,
    modelAttachments: toolModelAttachmentsFromOutput(input.output),
    uiSummary: compactSafeText(summary ?? fallbackSummary, input.maxPreviewChars ?? 800),
    diagnosticRef,
    display,
    envelope,
    truncated,
    redacted: false,
  };
}

export function projectToolFailure(input: {
  readonly request: ToolCallRequest;
  readonly error: string;
  readonly diagnosticRef?: string;
  readonly errorDomain?: ToolErrorDomain;
  readonly errorFacts?: ToolErrorFacts;
  readonly durationMs?: number;
}): ToolSafeProjection {
  const diagnosticRef = input.diagnosticRef ?? `tool:${input.request.callId}:failed`;
  const modelResult = toolFailureModelResult(input);
  return {
    agentContent: {
      status: "failed",
      toolName: input.request.toolName,
      callId: input.request.callId,
      error: input.error,
      errorDomain: input.errorDomain,
      errorFacts: input.errorFacts,
      facts: input.errorFacts,
      durationMs: input.durationMs,
    },
    modelResult,
    uiSummary: redactOrdinaryText(input.error, 500),
    diagnosticRef,
    envelope: projectToolStatusEnvelope({
      request: input.request,
      status: "failed",
      summary: input.error,
      diagnosticRef,
      errorDomain: input.errorDomain,
      errorFacts: input.errorFacts,
    }),
    truncated: false,
    redacted: false,
  };
}

export function projectToolApprovalRequired(input: {
  readonly request: ToolCallRequest;
  readonly toolName: string;
  readonly operationType: string;
  readonly actionSummary?: string;
}): ToolSafeProjection {
  const diagnosticRef = `tool:${input.request.callId}:confirmation-required`;
  const summary = input.actionSummary ?? toolDisplayName(input.toolName);
  return {
    uiSummary: summary,
    diagnosticRef,
    modelResult: toolApprovalModelResult(input, summary),
    envelope: projectToolStatusEnvelope({
      request: input.request,
      status: "approval_required",
      summary,
      diagnosticRef,
    }),
    truncated: false,
    redacted: false,
  };
}

export function projectToolModelResult(
  request: ToolCallRequest,
  output: unknown,
  display: ToolDisplayProjection,
  truncated: boolean
): InternalToolResult {
  const record = asRecord(output);
  const explicit = toolResultFromUnknown(record.canonicalResult) ?? toolResultFromUnknown(record.mcpResult);
  if (explicit !== undefined) {
    return ensureToolResultContent(explicit, toolResultFallbackText(request, display, record));
  }
  if (record.result !== undefined && isMcpToolName(request.toolName)) {
    return ensureToolResultContent(projectLegacyMcpToolResult(record), toolResultFallbackText(request, display, record));
  }
  if (request.toolName === "run_command" || request.toolName === "shell_command") {
    return projectCommandToolModelResult({ request, output, truncated, fallbackText: toolResultFallbackText(request, display, record) });
  }
  if (isFileReadTool(request.toolName)) {
    return projectFileReadToolModelResult({ request, output, truncated, fallbackText: toolResultFallbackText(request, display, record) });
  }
  if (request.toolName === "read") {
    return projectResearchReadToolModelResult({
      request,
      output,
      truncated,
      fallbackText: Array.isArray(output) ? "工具返回了可查看的读取结果。" : toolResultFallbackText(request, display, record),
    });
  }
  if (request.toolName === "search") {
    return projectSearchToolModelResult({ request, output, display, truncated, fallbackText: toolResultFallbackText(request, display, record) });
  }
  if (request.toolName === "grep_files" || request.toolName === "search_context_attachment_files") {
    return projectFileSearchToolModelResult({
      request,
      output,
      truncated,
      fallbackText: stringOrUndefined(record.summary) ?? "工具返回了可参考的结果。",
    });
  }
  if (request.toolName === "list_context_attachment_files") {
    return projectContextAttachmentListToolModelResult({
      request,
      output,
      truncated,
      fallbackText: stringOrUndefined(record.summary) ?? "工具返回了可查看的附件目录结果。",
    });
  }
  if (request.toolName === "read_context_attachment_table") {
    return projectContextAttachmentTableToolModelResult({
      request,
      output,
      truncated,
      fallbackText: stringOrUndefined(record.summary) ?? "工具返回了可查看的附件表格结果。",
    });
  }
  if (display.kind === "directory_listing") {
    return projectDirectoryToolModelResult({
      request,
      output,
      display,
      truncated,
      fallbackText: "工具返回了可查看的结果。",
    });
  }
  if (display.kind === "file_change_summary" || display.kind === "file_diff_preview") {
    return projectFileChangeToolModelResult({
      request,
      output,
      display,
      truncated,
      fallbackText: "工具返回了文件变更内容。",
    });
  }
  if (isSubAgentToolName(request.toolName)) {
    return projectSubAgentToolModelResult({
      request,
      output,
      display,
      truncated,
      fallbackText: toolResultFallbackText(request, display, record),
    });
  }
  if (display.kind === "browser_snapshot") {
    return projectBrowserSnapshotToolModelResult({
      request,
      output,
      display,
      truncated,
      fallbackText: toolResultFallbackText(request, display, record),
    });
  }
  if (display.kind === "http_response") {
    return projectHttpResponseToolModelResult({
      request,
      output,
      display,
      truncated,
      fallbackText: toolResultFallbackText(request, display, record),
    });
  }
  return projectGenericToolModelResult({
    request,
    output,
    display,
    truncated,
    fallbackText: toolResultFallbackText(request, display, record),
  });
}

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

export function toolFailureModelResult(input: {
  readonly request: ToolCallRequest;
  readonly error: string;
  readonly diagnosticRef?: string;
  readonly errorDomain?: ToolErrorDomain;
  readonly errorFacts?: ToolErrorFacts;
  readonly durationMs?: number;
}): ToolResult {
  return {
    content: [{ type: "text", text: input.error }],
    structuredContent: structuredSnapshot({
      status: "failed",
      toolName: input.request.toolName,
      callId: input.request.callId,
      error: input.error,
      errorDomain: input.errorDomain,
      errorFacts: input.errorFacts,
      durationMs: input.durationMs,
    }),
    isError: true,
    error: {
      message: input.error,
      domain: input.errorDomain,
      facts: input.errorFacts,
    },
  };
}

export function toolApprovalModelResult(input: {
  readonly request: ToolCallRequest;
  readonly toolName: string;
  readonly operationType: string;
  readonly actionSummary?: string;
}, summary: string): ToolResult {
  return {
    content: [{ type: "text", text: summary }],
    structuredContent: structuredSnapshot({
      status: "waiting_approval",
      toolName: input.toolName,
      callId: input.request.callId,
      operationType: input.operationType,
      actionSummary: input.actionSummary,
    }),
  };
}

export function projectToolModelContinuation(input: {
  readonly request: ToolCallRequest;
  readonly output: unknown;
  readonly modelResult: InternalToolResult;
  readonly truncated: boolean;
}): { readonly agentContent: unknown; readonly modelResult: ToolResult } {
  const legacyAgentContent = projectToolAgentContent(input.request, input.output, input.truncated);
  const modelResult = toolResultFromModelResult(input.modelResult, input.truncated);
  const record = asRecord(input.output);
  const mcpLike = isMcpToolName(input.request.toolName) || record.mcpResult !== undefined;
  if (!mcpLike) {
    return {
      agentContent: legacyAgentContent,
      modelResult,
    };
  }

  return {
    agentContent: {
      ...asRecord(legacyAgentContent),
      content: modelResult.content,
      structuredContent: modelResult.structuredContent,
      isError: modelResult.isError,
      truncation: modelResult.truncation,
    },
    modelResult,
  };
}

function toolResultFromModelResult(
  modelResult: InternalToolResult,
  truncated: boolean
): ToolResult {
  return {
    content: modelResult.content,
    structuredContent: modelResult.structuredContent,
    isError: modelResult.isError,
    error: modelResult.error,
    truncation: modelResult.truncation ?? (truncated ? {
      truncated: true,
      continuation: modelResult.continuation,
    } : undefined),
    continuation: modelResult.continuation,
  };
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

function toolResultFallbackText(
  request: ToolCallRequest,
  display: ToolDisplayProjection,
  record: Readonly<Record<string, unknown>>
): string {
  return compactExplanationText(stringOrUndefined(record.summary)) ??
    fallbackExplanationForShape(displayShapeForTool(request, display), record.isError === true);
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

function isFileReadTool(toolName: string): boolean {
  return toolName === "read_file" ||
    toolName === "read_skill_resource" ||
    toolName === "read_context_attachment_text" ||
    toolName === "read_context_attachment_pdf_text";
}
