import type { ModelFailure } from "../../domain/intelligence/index.js";
import type {
  ToolCallRequest,
  ToolContentBlock,
  ToolContinuation,
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
import { commandProgramFromToolResult, commandTextFromToolResult } from "../command-text.js";
import { sanitizeAssistantVisibleText } from "../visible-text-safety.js";
import { cleanOrdinaryToolText } from "../ordinary-tool-copy.js";
import { normalizeToolDisplayForOperation } from "../tool-display-normalization.js";
import {
  toolContinuationFromUnknown,
  toolResultContinuation,
} from "../tool-result-continuation.js";

const MODEL_TOOL_TEXT_MAX_CHARS = 128_000;
const MODEL_TOOL_ERROR_MAX_CHARS = 64_000;
const SEARCH_DISPLAY_RESULTS_LIMIT = 20;
const FILE_SEARCH_DISPLAY_MATCHES_LIMIT = 80;

type InternalToolResult = ToolResult;

type ToolDisplayShape = "file" | "sources" | "diff" | "terminal" | "approval" | "text" | "generic";

type SubAgentContinuationRef = {
  readonly index?: number;
  readonly sub_agent_id?: string;
  readonly sub_agent_name?: string;
  readonly run_id?: string;
  readonly full_output_ref?: string;
  readonly continuation: ToolContinuation;
};

// Historical compatibility name: callers across the app still import
// "redactOrdinaryText", but current ordinary text policy is compact-only.
export function redactOrdinaryText(value: string, maxLength = 1_200): string {
  return compactSafeText(sanitizeAssistantVisibleText(value), maxLength) ?? "";
}

// Historical compatibility name: markdown visible to the model/UI is preserved
// except for newline normalization and transparent length clipping.
export function redactOrdinaryMarkdownFragment(value: string, maxLength = 1_200): string {
  const text = sanitizeAssistantVisibleText(value, { preserveOuterWhitespace: true })
    .replace(/\r\n?/g, "\n");
  if (text.trim().length === 0) return text;
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

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

export function projectModelFailure(failure: ModelFailure | undefined): string {
  return redactOrdinaryText(failure?.message ?? "模型服务没有返回可用结果。", 600);
}

export function safeReadFileToolPreview(input: {
  readonly summary?: string;
  readonly path?: string;
  readonly bytes?: number;
  readonly maxLength?: number;
}): string | undefined {
  const headline = cleanOrdinaryToolText(input.summary) ?? input.path;
  return compactSafeText(headline || "文件已读取。", input.maxLength ?? 900);
}

export function safeCommandToolPreview(input: {
  readonly summary?: string;
  readonly command?: string;
  readonly exitCode?: number;
  readonly maxLength?: number;
}): string | undefined {
  const headline = cleanOrdinaryToolText(input.summary) ?? input.command;
  return compactSafeText(headline || "命令已执行。", input.maxLength ?? 900);
}

export function compactSafeText(value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const text = value.trim();
  if (text.length === 0) {
    return undefined;
  }
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1))}...`;
}

function projectToolModelResult(
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
    return commandToolResult(request, output, truncated);
  }
  if (isFileReadTool(request.toolName)) {
    return fileReadToolResult(request, output, truncated);
  }
  if (request.toolName === "read") {
    return researchReadToolResult(request, output, truncated);
  }
  if (request.toolName === "search") {
    return searchToolResult(request, output, display);
  }
  if (request.toolName === "grep_files" || request.toolName === "search_context_attachment_files") {
    return fileSearchToolResult(request, output, truncated);
  }
  if (request.toolName === "list_context_attachment_files") {
    return contextAttachmentListToolResult(request, output, truncated);
  }
  if (request.toolName === "read_context_attachment_table") {
    return contextAttachmentTableToolResult(request, output, truncated);
  }
  if (display.kind === "directory_listing") {
    return directoryToolResult(request, display, truncated, output);
  }
  if (display.kind === "file_change_summary" || display.kind === "file_diff_preview") {
    return fileChangeToolResult(display, truncated);
  }
  if (isSubAgentToolName(request.toolName)) {
    const continuationRefs = subAgentToolContinuationRefs(record);
    const continuation = continuationRefs[0]?.continuation;
    return ensureToolResultContent({
      content: genericToolResultContent(record, display),
      structuredContent: subAgentStructuredContent(request, output, display, truncated, continuationRefs),
      isError: record.isError === true ? true : undefined,
      continuation,
    }, toolResultFallbackText(request, display, record));
  }
  if (display.kind === "browser_snapshot") {
    const result = asRecord(record.result);
    const text = textFragmentForToolResult(result.text, MODEL_TOOL_TEXT_MAX_CHARS, request, "text");
    const effectiveTruncated = display.truncated === true || truncated || text?.truncated === true;
    const continuation = toolResultContinuation({ request, result, truncated: effectiveTruncated });
    return ensureToolResultContent({
      content: textContentBlocks(text?.text),
      structuredContent: structuredSnapshot({
        title: display.title,
        url: display.url,
        startChar: numberOrUndefined(result.startChar),
        textChars: numberOrUndefined(result.textChars),
        totalTextChars: numberOrUndefined(result.totalTextChars),
        hasMoreAfter: booleanOrUndefined(result.hasMoreAfter),
        nextStartChar: numberOrUndefined(result.nextStartChar),
        reachedStartCharCeiling: booleanOrUndefined(result.reachedStartCharCeiling),
        startCharCeiling: numberOrUndefined(result.startCharCeiling),
        rawTextRef: text?.rawRef,
        truncated: effectiveTruncated,
      }),
      continuation,
    }, toolResultFallbackText(request, display, record));
  }
  if (display.kind === "http_response") {
    const result = asRecord(record.result);
    const body = textFragmentForToolResult(result.body, MODEL_TOOL_TEXT_MAX_CHARS, request, "body");
    const effectiveTruncated = display.truncated === true || truncated || body?.truncated === true;
    const continuation = toolResultContinuation({ request, result, truncated: effectiveTruncated });
    return ensureToolResultContent({
      content: textContentBlocks(body?.text),
      structuredContent: structuredSnapshot({
        method: display.method,
        url: display.url,
        statusCode: display.statusCode,
        statusText: display.statusText,
        durationMs: display.durationMs,
        startChar: numberOrUndefined(result.startChar),
        bodyChars: numberOrUndefined(result.bodyChars),
        hasMoreAfter: booleanOrUndefined(result.hasMoreAfter),
        nextStartChar: numberOrUndefined(result.nextStartChar),
        reachedStartCharCeiling: booleanOrUndefined(result.reachedStartCharCeiling),
        startCharCeiling: numberOrUndefined(result.startCharCeiling),
        rawBodyRef: body?.rawRef,
        truncated: effectiveTruncated,
      }),
      isError: typeof display.statusCode === "number" && display.statusCode >= 400 ? true : undefined,
      continuation,
    }, toolResultFallbackText(request, display, record));
  }
  return ensureToolResultContent({
    content: genericToolResultContent(record, display),
    structuredContent: genericStructuredContent(request, output, display, truncated),
    isError: record.isError === true ? true : undefined,
  }, toolResultFallbackText(request, display, record));
}

function projectToolFallbackSummary(
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

function toolFailureModelResult(input: {
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

function toolApprovalModelResult(input: {
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

function projectToolModelContinuation(input: {
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

function toolResultFromUnknown(value: unknown): InternalToolResult | undefined {
  const record = asRecord(value);
  if (!Array.isArray(record.content)) {
    return undefined;
  }
  const content = record.content
    .map(toolContentBlockFromUnknown)
    .filter((part): part is ToolContentBlock => part !== undefined);
  return {
    content,
    structuredContent: record.structuredContent,
    isError: booleanOrUndefined(record.isError),
    error: toolResultErrorFromUnknown(record.error),
    truncation: toolResultTruncationFromUnknown(record.truncation),
    continuation: toolContinuationFromUnknown(record.continuation),
  };
}

function toolContentBlockFromUnknown(value: unknown): ToolContentBlock | undefined {
  const record = asRecord(value);
  const type = stringOrUndefined(record.type);
  if (type === "text") {
    const text = textOrUndefined(record.text);
    return text === undefined ? undefined : { type: "text", text };
  }
  if (type === "image") {
    const mimeType = stringOrUndefined(record.mimeType);
    if (mimeType === undefined) return undefined;
    return {
      type: "image",
      mimeType,
      data: textOrUndefined(record.data),
      ref: stringOrUndefined(record.ref),
    };
  }
  if (type === "audio") {
    const mimeType = stringOrUndefined(record.mimeType);
    if (mimeType === undefined) return undefined;
    return {
      type: "audio",
      mimeType,
      data: textOrUndefined(record.data),
      ref: stringOrUndefined(record.ref),
    };
  }
  if (type === "resource") {
    const uri = stringOrUndefined(record.uri);
    if (uri === undefined) return undefined;
    return {
      type: "resource",
      uri,
      mimeType: stringOrUndefined(record.mimeType),
      text: textOrUndefined(record.text),
    };
  }
  return undefined;
}

function toolResultTruncationFromUnknown(value: unknown): ToolResult["truncation"] | undefined {
  const record = asRecord(value);
  if (record.truncated !== true) {
    return undefined;
  }
  return {
    truncated: true,
    reason: stringOrUndefined(record.reason),
    omittedChars: numberOrUndefined(record.omittedChars),
    omittedItems: numberOrUndefined(record.omittedItems),
    continuation: toolContinuationFromUnknown(record.continuation),
  };
}

function toolResultErrorFromUnknown(value: unknown): ToolResult["error"] | undefined {
  const record = asRecord(value);
  const message = stringOrUndefined(record.message);
  if (message === undefined) {
    return undefined;
  }
  return {
    message,
    domain: toolErrorDomainFromUnknown(record.domain),
    facts: optionalRecord(record.facts) as ToolErrorFacts | undefined,
    retryable: booleanOrUndefined(record.retryable),
  };
}

function toolErrorDomainFromUnknown(value: unknown): ToolErrorDomain | undefined {
  return value === "tool_error" ||
      value === "runtime_error" ||
      value === "model_error" ||
      value === "ui_submit_error" ||
      value === "process_error"
    ? value
    : undefined;
}

function projectLegacyMcpToolResult(record: Readonly<Record<string, unknown>>): InternalToolResult {
  const result = asRecord(record.result);
  const content: ToolContentBlock[] = [];
  const text = textOrUndefined(result.text);
  if (text !== undefined) {
    content.push({ type: "text", text });
  }
  for (const item of Array.isArray(result.multimodal) ? result.multimodal : []) {
    const part = asRecord(item);
    const type = stringOrUndefined(part.type);
    const mimeType = stringOrUndefined(part.mimeType);
    if ((type === "image" || type === "audio") && mimeType !== undefined) {
      content.push({ type, mimeType, ref: stringOrUndefined(part.ref) });
    }
  }
  return {
    content,
    structuredContent: result.structuredContent ?? record.structuredContent,
    isError: booleanOrUndefined(record.isError),
  };
}

function commandToolResult(request: ToolCallRequest, output: unknown, truncated: boolean): InternalToolResult {
  const record = asRecord(output);
  const result = asRecord(record.result);
  const stdout = textFragmentForToolResult(result.stdout, MODEL_TOOL_TEXT_MAX_CHARS, request, "stdout");
  const stderr = textFragmentForToolResult(result.stderr, MODEL_TOOL_ERROR_MAX_CHARS, request, "stderr");
  const content = [
    ...(stdout?.text === undefined ? [] : [{ type: "text" as const, text: stdout.text }]),
    ...(stderr?.text === undefined ? [] : [{ type: "text" as const, text: stderr.text }]),
  ];
  const exitCode = numberOrUndefined(result.exitCode);
  const continuation = toolResultContinuation({
    request,
    result,
    truncated: truncated || stdout?.truncated === true || stderr?.truncated === true,
  });
  return ensureToolResultContent({
    content,
    structuredContent: structuredSnapshot({
      command: commandProgramFromToolResult(result, request.input),
      commandLine: commandTextFromToolResult(result, request.input),
      args: stringArray(result.args).length > 0 ? stringArray(result.args) : stringArray(asRecord(request.input).args),
      cwd: stringOrUndefined(result.cwd),
      shell: optionalRecord(result.shell),
      exitCode,
      timedOut: booleanOrUndefined(result.timedOut),
      background: booleanOrUndefined(result.background),
      pid: numberOrUndefined(result.pid),
      logRef: stringOrUndefined(result.logRef),
      logPath: stringOrUndefined(result.logPath),
      stopCommand: stringOrUndefined(result.stopCommand),
      durationMs: numberOrUndefined(result.durationMs),
      waitForPort: numberOrUndefined(result.waitForPort),
      portReady: booleanOrUndefined(result.portReady),
      stdout: stdout?.text,
      stderr: stderr?.text,
      stdoutTruncated: booleanOrUndefined(result.stdoutTruncated) ?? stdout?.truncated,
      stderrTruncated: booleanOrUndefined(result.stderrTruncated) ?? stderr?.truncated,
      stdoutChars: numberOrUndefined(result.stdoutChars),
      stderrChars: numberOrUndefined(result.stderrChars),
      stdoutOmittedChars: numberOrUndefined(result.stdoutOmittedChars),
      stderrOmittedChars: numberOrUndefined(result.stderrOmittedChars),
      rawStdoutRef: stdout?.rawRef,
      rawStderrRef: stderr?.rawRef,
      truncated: truncated || stdout?.truncated === true || stderr?.truncated === true,
    }),
    isError: exitCode !== undefined && exitCode !== 0 ? true : undefined,
    continuation,
  }, toolResultFallbackText(request, projectToolDisplay(request, output), record));
}

function fileReadToolResult(request: ToolCallRequest, output: unknown, truncated: boolean): InternalToolResult {
  const record = asRecord(output);
  const result = asRecord(record.result);
  const content = textFragmentForToolResult(result.content, MODEL_TOOL_TEXT_MAX_CHARS, request, "content");
  const continuation = toolResultContinuation({
    request,
    result,
    truncated: truncated || content?.truncated === true,
  });
  return ensureToolResultContent({
    content: textContentBlocks(content?.text),
    structuredContent: structuredSnapshot({
      path: stringOrUndefined(result.path),
      attachmentId: stringOrUndefined(result.attachmentId),
      kind: stringOrUndefined(result.kind),
      title: stringOrUndefined(result.title),
      mimeType: stringOrUndefined(result.mimeType),
      bytes: numberOrUndefined(result.bytes),
      binary: booleanOrUndefined(result.binary),
      readable: booleanOrUndefined(result.readable),
      reason: stringOrUndefined(result.reason),
      startLine: numberOrUndefined(result.startLine),
      endLine: numberOrUndefined(result.endLine),
      totalLines: numberOrUndefined(result.totalLines),
      hasMoreBefore: booleanOrUndefined(result.hasMoreBefore),
      hasMoreAfter: booleanOrUndefined(result.hasMoreAfter),
      startChar: numberOrUndefined(result.startChar),
      textChars: numberOrUndefined(result.textChars),
      charCount: numberOrUndefined(result.charCount),
      nextStartChar: numberOrUndefined(result.nextStartChar),
      rawContentRef: content?.rawRef,
      truncated: truncated || content?.truncated === true || booleanOrUndefined(result.truncated),
    }),
    isError: booleanOrUndefined(result.readable) === false ? true : undefined,
    continuation,
  }, toolResultFallbackText(request, projectToolDisplay(request, output), record));
}

function researchReadToolResult(request: ToolCallRequest, output: unknown, truncated: boolean): InternalToolResult {
  if (Array.isArray(output)) {
    const results = output.map((item, index) => {
      const record = asRecord(item);
      const content = textFragmentForToolResult(record.contentPreview, MODEL_TOOL_TEXT_MAX_CHARS, request, `contentPreview:${index}`);
      return {
        ref: stringOrUndefined(record.ref),
        status: stringOrUndefined(record.status),
        title: stringOrUndefined(record.title),
        uri: stringOrUndefined(record.uri),
        source: stringOrUndefined(record.source),
        error: stringOrUndefined(record.error),
        contentPreview: content?.text,
        rawContentPreviewRef: content?.rawRef,
        truncated: booleanOrUndefined(record.truncated) ?? content?.truncated ?? false,
      };
    });
    return ensureToolResultContent({
      content: results.flatMap((item) => textContentBlocks(item.contentPreview ?? item.error)),
      structuredContent: { results },
      isError: results.some((item) => item.error !== undefined || item.status === "provider-failed") ? true : undefined,
    }, "工具返回了可查看的读取结果。");
  }
  const record = asRecord(output);
  const result = asRecord(record.result);
  const content = textFragmentForToolResult(result.contentPreview, MODEL_TOOL_TEXT_MAX_CHARS, request, "contentPreview");
  const error = readErrorMessageFromOutput(record);
  const errorFacts = readErrorFactsFromOutput(record);
  return ensureToolResultContent({
    content: textContentBlocks(content?.text ?? error ?? stringOrUndefined(result.summary)),
    structuredContent: structuredSnapshot({
      ref: stringOrUndefined(record.ref) ?? stringOrUndefined(asRecord(request.input).ref),
      source: stringOrUndefined(result.source),
      status: stringOrUndefined(record.status) ?? stringOrUndefined(result.status),
      title: stringOrUndefined(result.title),
      url: stringOrUndefined(result.uri),
      uri: stringOrUndefined(result.uri),
      sourceSearchRef: stringOrUndefined(result.sourceSearchRef),
      error,
      errorFacts,
      metadata: optionalRecord(result.metadata),
      rawContentPreviewRef: content?.rawRef,
      truncated: booleanOrUndefined(result.truncated) ?? (truncated || content?.truncated === true),
    }),
    isError: error !== undefined || errorFacts !== undefined ? true : undefined,
  }, toolResultFallbackText(request, projectToolDisplay(request, output), record));
}

function searchToolResult(
  request: ToolCallRequest,
  output: unknown,
  display: ToolDisplayProjection
): InternalToolResult {
  const record = asRecord(output);
  const results = display.kind === "search_results"
    ? display.results
    : Array.isArray(record.results)
      ? record.results.map(searchDisplayItem).filter((item): item is NonNullable<ReturnType<typeof searchDisplayItem>> => item !== undefined)
      : [];
  const content = results
    .flatMap((item) => textContentBlocks([item.title, item.snippet].filter(isString).join("\n")));
  return ensureToolResultContent({
    content,
    structuredContent: structuredSnapshot({
      query: display.kind === "search_results" ? display.query : stringOrUndefined(record.query),
      status: display.kind === "search_results" ? display.status : stringOrUndefined(record.status),
      message: display.kind === "search_results" ? display.message : searchMessageFromOutput(record),
      resultsReturned: display.kind === "search_results" ? display.resultsReturned ?? results.length : results.length,
      results,
      truncated: display.kind === "search_results" ? display.truncated : booleanOrUndefined(record.truncated),
    }),
    isError: (display.kind === "search_results" ? display.status : stringOrUndefined(record.status)) === "invalid-input" ? true : undefined,
  }, toolResultFallbackText(request, display, record));
}

function fileSearchToolResult(request: ToolCallRequest, output: unknown, truncated: boolean): InternalToolResult {
  const record = asRecord(output);
  const result = asRecord(record.result);
  const matches = Array.isArray(result.matches) ? result.matches.slice(0, FILE_SEARCH_DISPLAY_MATCHES_LIMIT).map(projectGrepMatch) : [];
  const content = matches.flatMap((match) => textContentBlocks(
    [match.path, match.line === undefined ? undefined : String(match.line), match.preview].filter(isString).join(":")
  ));
  return ensureToolResultContent({
    content,
    structuredContent: structuredSnapshot({
      query: stringOrUndefined(result.query),
      path: stringOrUndefined(result.path),
      engine: stringOrUndefined(result.engine),
      offset: numberOrUndefined(result.offset),
      limit: numberOrUndefined(result.limit),
      matches,
      matchesReturned: numberOrUndefined(result.matchesReturned) ?? (Array.isArray(result.matches) ? result.matches.length : matches.length),
      searchedFiles: numberOrUndefined(result.searchedFiles),
      skippedFactsAvailable: booleanOrUndefined(result.skippedFactsAvailable),
      skippedFactsComplete: booleanOrUndefined(result.skippedFactsComplete),
      skippedFiles: numberOrUndefined(result.skippedFiles),
      skippedSamples: Array.isArray(result.skippedSamples)
        ? result.skippedSamples.slice(0, 8).map(projectGrepSkippedSample)
        : undefined,
      hasMoreAfter: booleanOrUndefined(result.hasMoreAfter),
      nextOffset: numberOrUndefined(result.nextOffset),
      reachedOffsetCeiling: booleanOrUndefined(result.reachedOffsetCeiling),
      offsetCeiling: numberOrUndefined(result.offsetCeiling),
      maxOffset: numberOrUndefined(result.maxOffset),
      truncated,
    }),
    continuation: toolResultContinuation({ request, result, truncated }),
  }, stringOrUndefined(record.summary) ?? "工具返回了可参考的结果。");
}

function contextAttachmentListToolResult(
  request: ToolCallRequest,
  output: unknown,
  truncated: boolean
): InternalToolResult {
  const record = asRecord(output);
  const result = asRecord(record.result);
  const entries = Array.isArray(result.entries) ? result.entries.slice(0, 200).map(projectDirectoryEntry) : [];
  return ensureToolResultContent({
    content: textContentBlocks(entries.slice(0, 30).map((entry) =>
      [entry.kind, entry.path].filter(isString).join(" ")
    ).join("\n")),
    structuredContent: structuredSnapshot({
      attachmentId: stringOrUndefined(result.attachmentId),
      kind: stringOrUndefined(result.kind),
      title: stringOrUndefined(result.title),
      path: stringOrUndefined(result.path),
      depth: numberOrUndefined(result.depth),
      offset: numberOrUndefined(result.offset),
      limit: numberOrUndefined(result.limit),
      maxDepth: numberOrUndefined(result.maxDepth),
      entries,
      entriesReturned: numberOrUndefined(result.entriesReturned),
      totalEntries: numberOrUndefined(result.totalEntries),
      unreadableDirectories: numberOrUndefined(result.unreadableDirectories),
      unreadableSamples: Array.isArray(result.unreadableSamples)
        ? result.unreadableSamples.slice(0, 8).map(projectUnreadableDirectorySample)
        : undefined,
      hasMoreAfter: booleanOrUndefined(result.hasMoreAfter),
      nextOffset: numberOrUndefined(result.nextOffset),
      reachedOffsetCeiling: booleanOrUndefined(result.reachedOffsetCeiling),
      offsetCeiling: numberOrUndefined(result.offsetCeiling),
      truncated,
    }),
    continuation: toolResultContinuation({ request, result, truncated }),
  }, stringOrUndefined(record.summary) ?? "工具返回了可查看的附件目录结果。");
}

function contextAttachmentTableToolResult(
  request: ToolCallRequest,
  output: unknown,
  truncated: boolean
): InternalToolResult {
  const record = asRecord(output);
  const result = asRecord(record.result);
  const rows = Array.isArray(result.rows) ? result.rows.slice(0, 200).map(projectTableRow) : [];
  const content = rows.slice(0, 30).map((row) =>
    `row ${row.rowNumber ?? "?"}: ${(row.values ?? []).join(" | ")}`
  ).join("\n");
  return ensureToolResultContent({
    content: textContentBlocks(content),
    structuredContent: structuredSnapshot({
      attachmentId: stringOrUndefined(result.attachmentId),
      kind: stringOrUndefined(result.kind),
      title: stringOrUndefined(result.title),
      path: stringOrUndefined(result.path),
      mimeType: stringOrUndefined(result.mimeType),
      bytes: numberOrUndefined(result.bytes),
      table: booleanOrUndefined(result.table),
      readable: booleanOrUndefined(result.readable),
      reason: stringOrUndefined(result.reason),
      format: stringOrUndefined(result.format),
      delimiter: stringOrUndefined(result.delimiter),
      sheetName: stringOrUndefined(result.sheetName),
      sheetIndex: numberOrUndefined(result.sheetIndex),
      sheets: stringArray(result.sheets),
      headerRow: booleanOrUndefined(result.headerRow),
      totalRows: numberOrUndefined(result.totalRows),
      dataRows: numberOrUndefined(result.dataRows),
      columnCount: numberOrUndefined(result.columnCount),
      columns: stringArray(result.columns),
      startRow: numberOrUndefined(result.startRow),
      rowCount: numberOrUndefined(result.rowCount),
      requestedRowCount: numberOrUndefined(result.requestedRowCount),
      nextStartRow: numberOrUndefined(result.nextStartRow),
      rows,
      rowsReturned: numberOrUndefined(result.rowsReturned),
      hasMoreBefore: booleanOrUndefined(result.hasMoreBefore),
      hasMoreAfter: booleanOrUndefined(result.hasMoreAfter),
      reachedRowCeiling: booleanOrUndefined(result.reachedRowCeiling),
      rowCeiling: numberOrUndefined(result.rowCeiling),
      truncated,
    }),
    continuation: toolResultContinuation({ request, result, truncated }),
    isError: booleanOrUndefined(result.readable) === false ? true : undefined,
  }, stringOrUndefined(record.summary) ?? "工具返回了可查看的附件表格结果。");
}

function directoryToolResult(
  request: ToolCallRequest,
  display: Extract<ToolDisplayProjection, { readonly kind: "directory_listing" }>,
  truncated: boolean,
  output?: unknown
): InternalToolResult {
  const result = asRecord(asRecord(output).result);
  const entries = display.entries.map((entry) => [entry.kind, entry.path].filter(isString).join(" "));
  return ensureToolResultContent({
    content: textContentBlocks(entries.slice(0, 30).join("\n")),
    structuredContent: structuredSnapshot({
      path: display.path,
      depth: display.depth,
      entriesReturned: display.entriesReturned,
      totalEntries: display.totalEntries,
      unreadableDirectories: display.unreadableDirectories,
      unreadableSamples: display.unreadableSamples,
      entries: display.entries,
      offset: numberOrUndefined(result.offset),
      limit: numberOrUndefined(result.limit),
      hasMoreAfter: booleanOrUndefined(result.hasMoreAfter),
      nextOffset: numberOrUndefined(result.nextOffset),
      truncated: display.truncated === true || truncated,
    }),
    continuation: toolResultContinuation({
      request,
      result,
      display,
      truncated: display.truncated === true || truncated,
    }),
  }, "工具返回了可查看的结果。");
}

function fileChangeToolResult(
  display: Extract<ToolDisplayProjection, { readonly kind: "file_change_summary" | "file_diff_preview" }>,
  truncated: boolean
): InternalToolResult {
  const files = diffFilesFromPreview(display.preview, display.path);
  return ensureToolResultContent({
    content: files.flatMap((file) => textContentBlocks(file.diff)),
    structuredContent: structuredSnapshot({
      files,
      path: display.path,
      operation: display.operation,
      bytes: "bytes" in display ? display.bytes : undefined,
      replacements: display.replacements,
      previousLength: display.previousLength,
      nextLength: display.nextLength,
      truncated: display.truncated === true || truncated,
    }),
  }, "工具返回了文件变更内容。");
}

function genericToolResultContent(
  record: Readonly<Record<string, unknown>>,
  display: ToolDisplayProjection
): readonly ToolContentBlock[] {
  const result = asRecord(record.result);
  if (display.kind === "generic_tool_summary") {
    return [
      ...textContentBlocks(display.summary),
      ...(display.items ?? []).flatMap((item) => textContentBlocks(item)),
    ];
  }
  return textContentBlocks(stringOrUndefined(result.text) ?? stringOrUndefined(record.summary));
}

function genericStructuredContent(
  request: ToolCallRequest,
  output: unknown,
  display: ToolDisplayProjection,
  truncated: boolean
): unknown {
  const record = asRecord(output);
  const result = asRecord(record.result);
  return structuredSnapshot({
    toolName: request.toolName,
    action: stringOrUndefined(record.action),
    display,
    result: structuredRecordWithoutVerbose(result),
    truncated,
  });
}

function ensureToolResultContent(result: InternalToolResult, fallbackText: string): InternalToolResult {
  if (result.content.length > 0) {
    return result;
  }
  return {
    ...result,
    content: [{ type: "text", text: fallbackText }],
  };
}

function textContentBlocks(value: string | undefined): readonly ToolContentBlock[] {
  return value === undefined || value.length === 0 ? [] : [{ type: "text", text: value }];
}

function textFragmentForToolResult(
  value: unknown,
  maxLength: number,
  request: ToolCallRequest,
  field: string
): ModelVisibleTextFragment | undefined {
  return typeof value === "string"
    ? modelVisibleTextFragment({ value, maxLength, request, field })
    : undefined;
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

function structuredSnapshot(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) {
      result[key] = item;
    }
  }
  return result;
}

function structuredRecordWithoutVerbose(record: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    if (isVerboseToolResultStructuredKey(key)) {
      continue;
    }
    result[key] = item;
  }
  return result;
}

function isVerboseToolResultStructuredKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized === "content" ||
    normalized === "contentpreview" ||
    normalized === "stdout" ||
    normalized === "stderr" ||
    normalized === "body" ||
    normalized === "text" ||
    normalized === "raw";
}

function diffFilesFromPreview(
  preview: string | undefined,
  fallbackPath: string | undefined
): readonly { readonly path?: string; readonly diff: string }[] {
  if (preview === undefined || preview.trim().length === 0) {
    return fallbackPath === undefined ? [] : [{ path: fallbackPath, diff: "" }];
  }
  const lines = preview.replace(/\r\n?/g, "\n").split("\n");
  const blocks: { path?: string; lines: string[] }[] = [];
  let current: { path?: string; lines: string[] } = { path: fallbackPath, lines: [] };
  for (const line of lines) {
    const diffPath = line.match(/^diff --git a\/(.+?) b\/(.+)$/u)?.[2];
    if (diffPath !== undefined && current.lines.length > 0) {
      blocks.push(current);
      current = { path: diffPath, lines: [line] };
      continue;
    }
    if (diffPath !== undefined) {
      current.path = diffPath;
    }
    current.lines.push(line);
  }
  if (current.lines.length > 0) {
    blocks.push(current);
  }
  return blocks.map((block) => ({
    path: block.path,
    diff: block.lines.join("\n").trim(),
  })).filter((block) => block.diff.length > 0 || block.path !== undefined);
}

function isFileReadTool(toolName: string): boolean {
  return toolName === "read_file" ||
    toolName === "read_skill_resource" ||
    toolName === "read_context_attachment_text" ||
    toolName === "read_context_attachment_pdf_text";
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {};
}

function optionalRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  const record = asRecord(value);
  return Object.keys(record).length === 0 ? undefined : record;
}

function readErrorFactsFromOutput(record: Readonly<Record<string, unknown>>): ToolErrorFacts | undefined {
  const direct = optionalRecord(record.errorFacts);
  if (direct !== undefined) {
    return direct as ToolErrorFacts;
  }
  const trace = asRecord(record.trace);
  const sourceSteps = Array.isArray(trace.sourceSteps) ? trace.sourceSteps : [];
  for (const value of sourceSteps) {
    const step = asRecord(value);
    if (stringOrUndefined(step.status) === "completed") {
      continue;
    }
    const facts = optionalRecord(step.errorFacts);
    if (facts !== undefined) {
      return facts as ToolErrorFacts;
    }
  }
  return undefined;
}

function readErrorMessageFromOutput(record: Readonly<Record<string, unknown>>): string | undefined {
  const direct = stringOrUndefined(record.error);
  if (direct !== undefined) {
    return direct;
  }
  const trace = asRecord(record.trace);
  const sourceSteps = Array.isArray(trace.sourceSteps) ? trace.sourceSteps : [];
  for (const value of sourceSteps) {
    const step = asRecord(value);
    if (stringOrUndefined(step.status) === "completed") {
      continue;
    }
    const message = stringOrUndefined(step.message);
    if (message !== undefined) {
      return message;
    }
  }
  return undefined;
}

function searchMessageFromOutput(record: Readonly<Record<string, unknown>>): string | undefined {
  const direct = stringOrUndefined(record.message);
  if (direct !== undefined) {
    return direct;
  }
  const trace = asRecord(record.trace);
  const sourceSteps = Array.isArray(trace.sourceSteps) ? trace.sourceSteps : [];
  for (const value of sourceSteps) {
    const step = asRecord(value);
    if (stringOrUndefined(step.status) === "completed") {
      continue;
    }
    const message = stringOrUndefined(step.message);
    if (message !== undefined) {
      return message;
    }
  }
  return undefined;
}

function projectToolDisplay(request: ToolCallRequest, output: unknown): ToolDisplayProjection {
  const record = asRecord(output);
  const result = asRecord(record.result);
  const action = displayActionForTool(stringOrUndefined(record.action), request.toolName);
  if (request.toolName === "search" && Array.isArray(record.results)) {
    const results = record.results
      .slice(0, SEARCH_DISPLAY_RESULTS_LIMIT)
      .map(searchDisplayItem)
      .filter((item): item is NonNullable<ReturnType<typeof searchDisplayItem>> => item !== undefined);
    return {
      kind: "search_results",
      query: stringOrUndefined(record.query),
      status: stringOrUndefined(record.status),
      message: compactSafeText(searchMessageFromOutput(record), 500),
      results,
      resultsReturned: record.results.length,
      truncated: record.results.length > results.length || record.truncated === true,
    };
  }
  if (request.toolName === "read" && Array.isArray(output)) {
    return {
      kind: "generic_tool_summary",
      action,
      summary: `读取 ${output.length} 个 ref。`,
      items: output.slice(0, 8).map(batchReadDisplayItem).filter(isString),
    };
  }
  if (request.toolName === "read") {
    const errorFacts = readErrorFactsFromOutput(record);
    const error = readErrorMessageFromOutput(record);
    return {
      kind: "read_result",
      ref: stringOrUndefined(record.ref) ?? stringOrUndefined(asRecord(request.input).ref),
      source: stringOrUndefined(result.source),
      status: stringOrUndefined(record.status) ?? stringOrUndefined(result.status),
      title: stringOrUndefined(result.title),
      url: stringOrUndefined(result.uri),
      uri: stringOrUndefined(result.uri),
      sourceSearchRef: stringOrUndefined(result.sourceSearchRef),
      contentPreview: compactSafeText(stringOrUndefined(result.contentPreview) ?? stringOrUndefined(result.summary), 1_200),
      error,
      errorFacts,
      truncated: result.truncated === true || record.truncated === true,
    };
  }
  if (request.toolName === "browser_snapshot") {
    return {
      kind: "browser_snapshot",
      title: stringOrUndefined(result.title),
      url: stringOrUndefined(result.url),
      text: compactSafeText(stringOrUndefined(result.text), 900),
      truncated: record.truncated === true,
    };
  }
  if (request.toolName === "http_request") {
    return {
      kind: "http_response",
      method: stringOrUndefined(result.method),
      url: stringOrUndefined(result.url),
      statusCode: numberOrUndefined(result.statusCode),
      statusText: stringOrUndefined(result.statusText),
      durationMs: numberOrUndefined(result.durationMs),
      bodyPreview: compactSafeText(stringOrUndefined(result.body), 900),
      truncated: result.truncated === true || record.truncated === true,
    };
  }
  if (record.result !== undefined && isMcpToolName(request.toolName)) {
    return normalizeToolDisplayForOperation({
      toolName: request.toolName,
      input: request.input,
      output,
      existingDisplay: record.display,
      truncated: record.truncated === true,
    });
  }
  const normalizedDisplay = normalizeToolDisplayForOperation({
    toolName: request.toolName,
    input: request.input,
    output,
    existingDisplay: record.display,
    truncated: record.truncated === true,
  });
  if (
    (normalizedDisplay.kind === "file_change_summary" || normalizedDisplay.kind === "file_diff_preview") &&
    request.toolName !== "write_file" &&
    request.toolName !== "create_file" &&
    request.toolName !== "delete_file" &&
    request.toolName !== "edit_file"
  ) {
    return normalizedDisplay;
  }
  if (request.toolName === "write_file" || request.toolName === "create_file" || request.toolName === "delete_file") {
    return normalizedDisplay;
  }
  if (request.toolName === "edit_file") {
    return normalizedDisplay;
  }
  if (request.toolName === "run_command" || request.toolName === "shell_command") {
    const stdout = stringOrUndefined(result.stdout);
    const stderr = stringOrUndefined(result.stderr);
    const commandLine = commandTextFromToolResult(result, request.input);
    return {
      kind: "command_summary",
      command: commandProgramFromToolResult(result, request.input),
      args: stringArray(result.args).length > 0 ? stringArray(result.args) : stringArray(asRecord(request.input).args),
      commandLine,
      cwd: stringOrUndefined(result.cwd),
      shell: stringOrUndefined(asRecord(result.shell).label),
      exitCode: numberOrUndefined(result.exitCode),
      timedOut: result.timedOut === true,
      background: result.background === true,
      pid: numberOrUndefined(result.pid),
      logRef: stringOrUndefined(result.logRef),
      logPath: stringOrUndefined(result.logPath),
      stopCommand: stringOrUndefined(result.stopCommand),
      durationMs: numberOrUndefined(result.durationMs),
      waitForPort: numberOrUndefined(result.waitForPort),
      portReady: result.portReady === true ? true : result.portReady === false ? false : undefined,
      stdoutTruncated: result.stdoutTruncated === true ? true : result.stdoutTruncated === false ? false : undefined,
      stderrTruncated: result.stderrTruncated === true ? true : result.stderrTruncated === false ? false : undefined,
      stdoutChars: numberOrUndefined(result.stdoutChars),
      stderrChars: numberOrUndefined(result.stderrChars),
      stdoutOmittedChars: numberOrUndefined(result.stdoutOmittedChars),
      stderrOmittedChars: numberOrUndefined(result.stderrOmittedChars),
      outputSummary: stdout === undefined ? undefined : summarizeCommandOutput(stdout),
      errorSummary: stderr === undefined ? undefined : summarizeCommandOutput(stderr),
    };
  }
  return normalizedDisplay;
}

function projectToolAgentContent(request: ToolCallRequest, output: unknown, truncated: boolean): unknown {
  const record = asRecord(output);
  const result = asRecord(record.result);
  const summary = stringOrUndefined(record.summary);
  if (isSubAgentToolName(request.toolName)) {
    return projectSubAgentToolAgentContent(request, record, result, summary, truncated);
  }
  if (request.toolName === "read_skill_resource") {
    const content = typeof result.content === "string"
      ? modelVisibleTextFragment({
          value: result.content,
          maxLength: MODEL_TOOL_TEXT_MAX_CHARS,
          request,
          field: "content",
        })
      : undefined;
    const continuation = toolResultContinuation({
      request,
      result,
      truncated: truncated || content?.truncated === true,
    });
    return {
      summary,
      skillId: stringOrUndefined(result.skillId),
      path: stringOrUndefined(result.path),
      type: stringOrUndefined(result.type),
      contentHash: stringOrUndefined(result.contentHash),
      byteLength: numberOrUndefined(result.byteLength),
      charCount: numberOrUndefined(result.charCount),
      requiresToolExecution: result.requiresToolExecution === true,
      notExecutableByResolver: result.notExecutableByResolver === true,
      executionNote: stringOrUndefined(result.executionNote),
      truncated: truncated || content?.truncated === true,
      content: content?.text,
      rawContentRef: content?.rawRef,
      continuation,
    };
  }
  if (request.toolName === "read_file") {
    const content = typeof result.content === "string"
      ? modelVisibleTextFragment({
          value: result.content,
          maxLength: MODEL_TOOL_TEXT_MAX_CHARS,
          request,
          field: "content",
        })
      : undefined;
    const continuation = toolResultContinuation({
      request,
      result,
      truncated: truncated || content?.truncated === true,
    });
    return {
      summary,
      path: stringOrUndefined(result.path),
      bytes: numberOrUndefined(result.bytes),
      binary: result.binary === true,
      startLine: numberOrUndefined(result.startLine),
      endLine: numberOrUndefined(result.endLine),
      totalLines: numberOrUndefined(result.totalLines),
      hasMoreBefore: result.hasMoreBefore === true,
      hasMoreAfter: result.hasMoreAfter === true,
      truncated: truncated || content?.truncated === true,
      content: content?.text,
      rawContentRef: content?.rawRef,
      continuation,
    };
  }
  if (request.toolName === "read_context_attachment_text") {
    const content = typeof result.content === "string"
      ? modelVisibleTextFragment({
          value: result.content,
          maxLength: MODEL_TOOL_TEXT_MAX_CHARS,
          request,
          field: "content",
        })
      : undefined;
    const continuation = toolResultContinuation({
      request,
      result,
      truncated: truncated || content?.truncated === true,
    });
    return {
      summary,
      attachmentId: stringOrUndefined(result.attachmentId),
      kind: stringOrUndefined(result.kind),
      title: stringOrUndefined(result.title),
      path: stringOrUndefined(result.path),
      mimeType: stringOrUndefined(result.mimeType),
      bytes: numberOrUndefined(result.bytes),
      readable: result.readable === true ? true : result.readable === false ? false : undefined,
      binary: result.binary === true,
      reason: stringOrUndefined(result.reason),
      startLine: numberOrUndefined(result.startLine),
      endLine: numberOrUndefined(result.endLine),
      totalLines: numberOrUndefined(result.totalLines),
      hasMoreBefore: result.hasMoreBefore === true,
      hasMoreAfter: result.hasMoreAfter === true,
      truncated: truncated || content?.truncated === true,
      content: content?.text,
      rawContentRef: content?.rawRef,
      continuation,
    };
  }
  if (request.toolName === "read_context_attachment_pdf_text") {
    const content = typeof result.content === "string"
      ? modelVisibleTextFragment({
          value: result.content,
          maxLength: MODEL_TOOL_TEXT_MAX_CHARS,
          request,
          field: "content",
        })
      : undefined;
    const continuation = toolResultContinuation({
      request,
      result,
      truncated: truncated || content?.truncated === true,
    });
    return {
      summary,
      attachmentId: stringOrUndefined(result.attachmentId),
      kind: stringOrUndefined(result.kind),
      title: stringOrUndefined(result.title),
      path: stringOrUndefined(result.path),
      mimeType: stringOrUndefined(result.mimeType),
      bytes: numberOrUndefined(result.bytes),
      format: stringOrUndefined(result.format),
      readable: booleanOrUndefined(result.readable),
      reason: stringOrUndefined(result.reason),
      extraction: stringOrUndefined(result.extraction),
      streamCount: numberOrUndefined(result.streamCount),
      decodedStreams: numberOrUndefined(result.decodedStreams),
      skippedStreams: numberOrUndefined(result.skippedStreams),
      textFragments: numberOrUndefined(result.textFragments),
      startChar: numberOrUndefined(result.startChar),
      textChars: numberOrUndefined(result.textChars),
      charCount: numberOrUndefined(result.charCount),
      hasMoreAfter: result.hasMoreAfter === true,
      nextStartChar: numberOrUndefined(result.nextStartChar),
      truncated: truncated || content?.truncated === true,
      content: content?.text,
      rawContentRef: content?.rawRef,
      continuation,
    };
  }
  if (request.toolName === "read_context_attachment_image") {
    return {
      summary,
      attachmentId: stringOrUndefined(result.attachmentId),
      kind: stringOrUndefined(result.kind),
      title: stringOrUndefined(result.title),
      path: stringOrUndefined(result.path),
      mimeType: stringOrUndefined(result.mimeType),
      bytes: numberOrUndefined(result.bytes),
      format: stringOrUndefined(result.format),
      readable: booleanOrUndefined(result.readable),
      reason: stringOrUndefined(result.reason),
      modelInput: {
        attached: booleanOrUndefined(asRecord(result.modelInput).attached),
        detail: stringOrUndefined(asRecord(result.modelInput).detail),
      },
      truncated,
    };
  }
  if (request.toolName === "list_context_attachments") {
    return {
      summary,
      count: numberOrUndefined(result.count),
      attachments: Array.isArray(result.attachments)
        ? result.attachments.slice(0, 80).map(projectContextAttachment)
        : undefined,
      truncated,
    };
  }
  if (request.toolName === "inspect_context_attachment_table") {
    return {
      summary,
      attachmentId: stringOrUndefined(result.attachmentId),
      kind: stringOrUndefined(result.kind),
      title: stringOrUndefined(result.title),
      path: stringOrUndefined(result.path),
      mimeType: stringOrUndefined(result.mimeType),
      bytes: numberOrUndefined(result.bytes),
      table: booleanOrUndefined(result.table),
      readable: booleanOrUndefined(result.readable),
      reason: stringOrUndefined(result.reason),
      format: stringOrUndefined(result.format),
      delimiter: stringOrUndefined(result.delimiter),
      sheetName: stringOrUndefined(result.sheetName),
      sheetIndex: numberOrUndefined(result.sheetIndex),
      sheets: stringArray(result.sheets),
      headerRow: booleanOrUndefined(result.headerRow),
      totalRows: numberOrUndefined(result.totalRows),
      dataRows: numberOrUndefined(result.dataRows),
      columnCount: numberOrUndefined(result.columnCount),
      columns: stringArray(result.columns),
      sampleRows: Array.isArray(result.sampleRows) ? result.sampleRows.slice(0, 20).map(projectTableRow) : undefined,
      truncated,
    };
  }
  if (request.toolName === "read_context_attachment_table") {
    const continuation = toolResultContinuation({ request, result, truncated });
    return {
      summary,
      attachmentId: stringOrUndefined(result.attachmentId),
      kind: stringOrUndefined(result.kind),
      title: stringOrUndefined(result.title),
      path: stringOrUndefined(result.path),
      mimeType: stringOrUndefined(result.mimeType),
      bytes: numberOrUndefined(result.bytes),
      table: booleanOrUndefined(result.table),
      readable: booleanOrUndefined(result.readable),
      reason: stringOrUndefined(result.reason),
      format: stringOrUndefined(result.format),
      delimiter: stringOrUndefined(result.delimiter),
      sheetName: stringOrUndefined(result.sheetName),
      sheetIndex: numberOrUndefined(result.sheetIndex),
      sheets: stringArray(result.sheets),
      headerRow: booleanOrUndefined(result.headerRow),
      totalRows: numberOrUndefined(result.totalRows),
      dataRows: numberOrUndefined(result.dataRows),
      columnCount: numberOrUndefined(result.columnCount),
      columns: stringArray(result.columns),
      startRow: numberOrUndefined(result.startRow),
      rowCount: numberOrUndefined(result.rowCount),
      requestedRowCount: numberOrUndefined(result.requestedRowCount),
      nextStartRow: numberOrUndefined(result.nextStartRow),
      rows: Array.isArray(result.rows) ? result.rows.slice(0, 200).map(projectTableRow) : undefined,
      rowsReturned: numberOrUndefined(result.rowsReturned),
      hasMoreBefore: result.hasMoreBefore === true,
      hasMoreAfter: result.hasMoreAfter === true,
      reachedRowCeiling: booleanOrUndefined(result.reachedRowCeiling),
      rowCeiling: numberOrUndefined(result.rowCeiling),
      truncated,
      continuation,
    };
  }
  if (request.toolName === "inspect_context_attachment_archive") {
    return {
      summary,
      attachmentId: stringOrUndefined(result.attachmentId),
      kind: stringOrUndefined(result.kind),
      title: stringOrUndefined(result.title),
      path: stringOrUndefined(result.path),
      mimeType: stringOrUndefined(result.mimeType),
      bytes: numberOrUndefined(result.bytes),
      archive: booleanOrUndefined(result.archive),
      readable: booleanOrUndefined(result.readable),
      reason: stringOrUndefined(result.reason),
      format: stringOrUndefined(result.format),
      entryCount: numberOrUndefined(result.entryCount),
      entriesReturned: numberOrUndefined(result.entriesReturned),
      entries: Array.isArray(result.entries) ? result.entries.slice(0, 200).map(projectArchiveEntry) : undefined,
      truncated,
    };
  }
  if (request.toolName === "list_context_attachment_files") {
    const continuation = toolResultContinuation({ request, result, truncated });
    return {
      summary,
      attachmentId: stringOrUndefined(result.attachmentId),
      kind: stringOrUndefined(result.kind),
      title: stringOrUndefined(result.title),
      path: stringOrUndefined(result.path),
      depth: numberOrUndefined(result.depth),
      offset: numberOrUndefined(result.offset),
      limit: numberOrUndefined(result.limit),
      maxDepth: numberOrUndefined(result.maxDepth),
      entries: Array.isArray(result.entries) ? result.entries.slice(0, 200).map(projectDirectoryEntry) : undefined,
      entriesReturned: numberOrUndefined(result.entriesReturned),
      totalEntries: numberOrUndefined(result.totalEntries),
      unreadableDirectories: numberOrUndefined(result.unreadableDirectories),
      unreadableSamples: Array.isArray(result.unreadableSamples)
        ? result.unreadableSamples.slice(0, 8).map(projectUnreadableDirectorySample)
        : undefined,
      hasMoreAfter: booleanOrUndefined(result.hasMoreAfter),
      nextOffset: numberOrUndefined(result.nextOffset),
      reachedOffsetCeiling: booleanOrUndefined(result.reachedOffsetCeiling),
      offsetCeiling: numberOrUndefined(result.offsetCeiling),
      truncated,
      continuation,
    };
  }
  if (request.toolName === "search_context_attachment_files") {
    return {
      summary,
      attachmentId: stringOrUndefined(result.attachmentId),
      kind: stringOrUndefined(result.kind),
      title: stringOrUndefined(result.title),
      query: stringOrUndefined(result.query),
      path: stringOrUndefined(result.path),
      offset: numberOrUndefined(result.offset),
      limit: numberOrUndefined(result.limit),
      matches: Array.isArray(result.matches) ? result.matches.slice(0, FILE_SEARCH_DISPLAY_MATCHES_LIMIT).map(projectGrepMatch) : undefined,
      matchesReturned: numberOrUndefined(result.matchesReturned) ?? (Array.isArray(result.matches) ? result.matches.length : undefined),
      searchedFiles: numberOrUndefined(result.searchedFiles),
      skippedFiles: numberOrUndefined(result.skippedFiles),
      skippedBinaryFiles: numberOrUndefined(result.skippedBinaryFiles),
      skippedTooLargeFiles: numberOrUndefined(result.skippedTooLargeFiles),
      skippedUnreadableFiles: numberOrUndefined(result.skippedUnreadableFiles),
      skippedDirectories: numberOrUndefined(result.skippedDirectories),
      skippedOtherEntries: numberOrUndefined(result.skippedOtherEntries),
      skippedSamples: Array.isArray(result.skippedSamples)
        ? result.skippedSamples.slice(0, 8).map(projectGrepSkippedSample)
        : undefined,
      hasMoreAfter: booleanOrUndefined(result.hasMoreAfter),
      nextOffset: numberOrUndefined(result.nextOffset),
      reachedOffsetCeiling: booleanOrUndefined(result.reachedOffsetCeiling),
      offsetCeiling: numberOrUndefined(result.offsetCeiling),
      truncated,
      continuation: toolResultContinuation({ request, result, truncated }),
    };
  }
  if (request.toolName === "list_dir") {
    const display = projectToolDisplay(request, output);
    return {
      summary,
      path: stringOrUndefined(result.path),
      depth: numberOrUndefined(result.depth),
      offset: numberOrUndefined(result.offset),
      limit: numberOrUndefined(result.limit),
      maxDepth: numberOrUndefined(result.maxDepth),
      entries: Array.isArray(result.entries) ? result.entries.slice(0, 200).map(projectDirectoryEntry) : undefined,
      entriesReturned: numberOrUndefined(result.entriesReturned),
      totalEntries: numberOrUndefined(result.totalEntries),
      unreadableDirectories: numberOrUndefined(result.unreadableDirectories),
      unreadableSamples: Array.isArray(result.unreadableSamples)
        ? result.unreadableSamples.slice(0, 8).map(projectUnreadableDirectorySample)
        : undefined,
      hasMoreAfter: booleanOrUndefined(result.hasMoreAfter),
      nextOffset: numberOrUndefined(result.nextOffset),
      reachedOffsetCeiling: booleanOrUndefined(result.reachedOffsetCeiling),
      offsetCeiling: numberOrUndefined(result.offsetCeiling),
      truncated,
      continuation: display.kind === "directory_listing"
        ? toolResultContinuation({ request, result, display, truncated })
        : undefined,
    };
  }
  if (request.toolName === "grep_files") {
    return {
      summary,
      query: stringOrUndefined(result.query),
      path: stringOrUndefined(result.path),
      engine: stringOrUndefined(result.engine),
      offset: numberOrUndefined(result.offset),
      limit: numberOrUndefined(result.limit),
      matches: Array.isArray(result.matches) ? result.matches.slice(0, FILE_SEARCH_DISPLAY_MATCHES_LIMIT).map(projectGrepMatch) : undefined,
      matchesReturned: numberOrUndefined(result.matchesReturned) ?? (Array.isArray(result.matches) ? result.matches.length : undefined),
      searchedFiles: numberOrUndefined(result.searchedFiles),
      skippedFactsAvailable: result.skippedFactsAvailable === true ? true : result.skippedFactsAvailable === false ? false : undefined,
      skippedFactsComplete: result.skippedFactsComplete === true ? true : result.skippedFactsComplete === false ? false : undefined,
      skippedFiles: numberOrUndefined(result.skippedFiles),
      skippedBinaryFiles: numberOrUndefined(result.skippedBinaryFiles),
      skippedTooLargeFiles: numberOrUndefined(result.skippedTooLargeFiles),
      skippedUnreadableFiles: numberOrUndefined(result.skippedUnreadableFiles),
      skippedDirectories: numberOrUndefined(result.skippedDirectories),
      skippedOtherEntries: numberOrUndefined(result.skippedOtherEntries),
      skippedSamples: Array.isArray(result.skippedSamples)
        ? result.skippedSamples.slice(0, 8).map(projectGrepSkippedSample)
        : undefined,
      hasMoreAfter: booleanOrUndefined(result.hasMoreAfter),
      nextOffset: numberOrUndefined(result.nextOffset),
      reachedOffsetCeiling: booleanOrUndefined(result.reachedOffsetCeiling),
      offsetCeiling: numberOrUndefined(result.offsetCeiling),
      maxOffset: numberOrUndefined(result.maxOffset),
      truncated,
      continuation: toolResultContinuation({ request, result, truncated }),
    };
  }
  if (request.toolName === "read") {
    const errorFacts = readErrorFactsFromOutput(record);
    const error = readErrorMessageFromOutput(record);
    if (Array.isArray(output)) {
      const results = output.map((item, index) => projectBatchReadAgentItem(item, request, index));
      return {
        summary: `read batch completed with ${results.length} item${results.length === 1 ? "" : "s"}.`,
        results,
        truncated: truncated || results.some((item) => item.truncated === true),
      };
    }
    const contentPreview = typeof result.contentPreview === "string"
      ? modelVisibleTextFragment({
          value: result.contentPreview,
          maxLength: MODEL_TOOL_TEXT_MAX_CHARS,
          request,
          field: "contentPreview",
        })
      : undefined;
    return {
      summary,
      ref: stringOrUndefined(record.ref) ?? stringOrUndefined(asRecord(request.input).ref),
      source: stringOrUndefined(result.source),
      status: stringOrUndefined(record.status) ?? stringOrUndefined(result.status),
      title: stringOrUndefined(result.title),
      url: stringOrUndefined(result.uri),
      uri: stringOrUndefined(result.uri),
      sourceSearchRef: stringOrUndefined(result.sourceSearchRef),
      error,
      errorFacts,
      truncated: result.truncated === true || truncated || contentPreview?.truncated === true,
      contentPreview: contentPreview?.text,
      rawContentPreviewRef: contentPreview?.rawRef,
      metadata: optionalRecord(result.metadata),
    };
  }
  if (request.toolName === "run_command" || request.toolName === "shell_command") {
    const commandLine = commandTextFromToolResult(result, request.input);
    const stdout = typeof result.stdout === "string"
      ? modelVisibleTextFragment({
          value: result.stdout,
          maxLength: MODEL_TOOL_TEXT_MAX_CHARS,
          request,
          field: "stdout",
        })
      : undefined;
    const stderr = typeof result.stderr === "string"
      ? modelVisibleTextFragment({
          value: result.stderr,
          maxLength: MODEL_TOOL_ERROR_MAX_CHARS,
          request,
          field: "stderr",
        })
      : undefined;
    return {
      summary,
      command: commandProgramFromToolResult(result, request.input),
      commandLine,
      cwd: stringOrUndefined(result.cwd),
      shell: {
        kind: stringOrUndefined(asRecord(result.shell).kind),
        label: stringOrUndefined(asRecord(result.shell).label),
        executable: stringOrUndefined(asRecord(result.shell).executable),
        syntax: stringOrUndefined(asRecord(result.shell).syntax),
      },
      exitCode: numberOrUndefined(result.exitCode),
      timedOut: result.timedOut === true,
      background: result.background === true,
      pid: numberOrUndefined(result.pid),
      logRef: stringOrUndefined(result.logRef),
      logPath: stringOrUndefined(result.logPath),
      stopCommand: stringOrUndefined(result.stopCommand),
      durationMs: numberOrUndefined(result.durationMs),
      waitForPort: numberOrUndefined(result.waitForPort),
      portReady: result.portReady === true ? true : result.portReady === false ? false : undefined,
      stdoutTruncated: result.stdoutTruncated === true ? true : result.stdoutTruncated === false ? false : undefined,
      stderrTruncated: result.stderrTruncated === true ? true : result.stderrTruncated === false ? false : undefined,
      stdoutChars: numberOrUndefined(result.stdoutChars),
      stderrChars: numberOrUndefined(result.stderrChars),
      stdoutOmittedChars: numberOrUndefined(result.stdoutOmittedChars),
      stderrOmittedChars: numberOrUndefined(result.stderrOmittedChars),
      truncated: truncated || stdout?.truncated === true || stderr?.truncated === true,
      stdout: stdout?.text,
      stderr: stderr?.text,
      rawStdoutRef: stdout?.rawRef,
      rawStderrRef: stderr?.rawRef,
      continuation: toolResultContinuation({
        request,
        result,
        truncated: truncated || stdout?.truncated === true || stderr?.truncated === true,
      }),
    };
  }
  if (request.toolName === "browser_snapshot") {
    const text = typeof result.text === "string"
      ? modelVisibleTextFragment({
          value: result.text,
          maxLength: MODEL_TOOL_TEXT_MAX_CHARS,
          request,
          field: "text",
        })
      : undefined;
    const continuation = toolResultContinuation({
      request,
      result,
      truncated: truncated || text?.truncated === true,
    });
    return {
      summary,
      url: stringOrUndefined(result.url),
      title: stringOrUndefined(result.title),
      startChar: numberOrUndefined(result.startChar),
      textChars: numberOrUndefined(result.textChars),
      totalTextChars: numberOrUndefined(result.totalTextChars),
      hasMoreAfter: booleanOrUndefined(result.hasMoreAfter),
      nextStartChar: numberOrUndefined(result.nextStartChar),
      reachedStartCharCeiling: booleanOrUndefined(result.reachedStartCharCeiling),
      startCharCeiling: numberOrUndefined(result.startCharCeiling),
      truncated: truncated || text?.truncated === true,
      text: text?.text,
      rawTextRef: text?.rawRef,
      continuation,
    };
  }
  if (request.toolName === "http_request") {
    const body = typeof result.body === "string"
      ? modelVisibleTextFragment({
          value: result.body,
          maxLength: MODEL_TOOL_TEXT_MAX_CHARS,
          request,
          field: "body",
        })
      : undefined;
    const continuation = toolResultContinuation({
      request,
      result,
      truncated: result.truncated === true || truncated || body?.truncated === true,
    });
    return {
      summary,
      url: stringOrUndefined(result.url),
      method: stringOrUndefined(result.method),
      statusCode: numberOrUndefined(result.statusCode),
      statusText: stringOrUndefined(result.statusText),
      headers: asRecord(result.headers),
      durationMs: numberOrUndefined(result.durationMs),
      startChar: numberOrUndefined(result.startChar),
      bodyChars: numberOrUndefined(result.bodyChars),
      hasMoreAfter: booleanOrUndefined(result.hasMoreAfter),
      nextStartChar: numberOrUndefined(result.nextStartChar),
      reachedStartCharCeiling: booleanOrUndefined(result.reachedStartCharCeiling),
      startCharCeiling: numberOrUndefined(result.startCharCeiling),
      truncated: result.truncated === true || truncated || body?.truncated === true,
      body: body?.text,
      rawBodyRef: body?.rawRef,
      continuation,
    };
  }
  if (record.result !== undefined && isMcpToolName(request.toolName)) {
    const text = typeof result.text === "string"
      ? modelVisibleTextFragment({
          value: result.text,
          maxLength: MODEL_TOOL_TEXT_MAX_CHARS,
          request,
          field: "text",
        })
      : undefined;
    return {
      summary,
      truncated: truncated || text?.truncated === true,
      text: text?.text,
      rawTextRef: text?.rawRef,
      multimodal: Array.isArray(result.multimodal)
        ? result.multimodal.slice(0, 12).map(projectMcpMultimodalPart)
        : undefined,
    };
  }
  const display = projectToolDisplay(request, output);
  return {
    summary: compactSafeText(summary ?? `${toolDisplayName(request.toolName)}已完成。`, 1_200),
    display,
    truncated,
  };
}

function batchReadDisplayItem(value: unknown): string | undefined {
  const item = asRecord(value);
  const ref = stringOrUndefined(item.ref);
  const status = stringOrUndefined(item.status);
  const title = stringOrUndefined(item.title);
  const error = stringOrUndefined(item.error);
  const headline = title ?? ref;
  if (headline === undefined && status === undefined) {
    return undefined;
  }
  return [status, headline, error].filter(isString).join(" · ");
}

function projectBatchReadAgentItem(
  value: unknown,
  request: ToolCallRequest,
  index: number
): {
  readonly ref?: string;
  readonly status?: string;
  readonly refId?: string;
  readonly source?: string;
  readonly title?: string;
  readonly url?: string;
  readonly uri?: string;
  readonly summary?: string;
  readonly contentPreview?: string;
  readonly truncated: boolean;
  readonly rawContentPreviewRef?: string;
  readonly sourceSearchRef?: string;
  readonly error?: string;
  readonly errorFacts?: Readonly<Record<string, unknown>>;
  readonly metadata?: Readonly<Record<string, unknown>>;
} {
  const item = asRecord(value);
  const contentPreview = typeof item.contentPreview === "string"
    ? modelVisibleTextFragment({
        value: item.contentPreview,
        maxLength: MODEL_TOOL_TEXT_MAX_CHARS,
        request,
        field: `contentPreview:${index}`,
      })
    : undefined;
  return {
    ref: stringOrUndefined(item.ref),
    status: stringOrUndefined(item.status),
    refId: stringOrUndefined(item.refId),
    source: stringOrUndefined(item.source),
    title: stringOrUndefined(item.title),
    url: stringOrUndefined(item.uri),
    uri: stringOrUndefined(item.uri),
    summary: stringOrUndefined(item.summary),
    contentPreview: contentPreview?.text,
    truncated: item.truncated === true || contentPreview?.truncated === true,
    rawContentPreviewRef: contentPreview?.rawRef,
    sourceSearchRef: stringOrUndefined(item.sourceSearchRef),
    error: stringOrUndefined(item.error),
    errorFacts: optionalRecord(item.errorFacts),
    metadata: optionalRecord(item.metadata),
  };
}

function isSubAgentToolName(toolName: string): boolean {
  return toolName === "call_sub_agent" || toolName === "call_sub_agents" || toolName === "spawn_sub_agent";
}

function subAgentStructuredContent(
  request: ToolCallRequest,
  output: unknown,
  display: ToolDisplayProjection,
  truncated: boolean,
  continuationRefs: readonly SubAgentContinuationRef[]
): unknown {
  return structuredSnapshot({
    ...asRecord(genericStructuredContent(request, output, display, truncated)),
    continuations: continuationRefs.length === 0 ? undefined : continuationRefs,
  });
}

function subAgentToolContinuationRefs(record: Readonly<Record<string, unknown>>): readonly SubAgentContinuationRef[] {
  const result = asRecord(record.result);
  const refs: SubAgentContinuationRef[] = [];
  const recordContinuation = toolContinuationFromUnknown(record.continuation);
  if (recordContinuation !== undefined) {
    refs.push({ continuation: recordContinuation });
  }
  const resultContinuation = toolContinuationFromUnknown(result.continuation);
  if (resultContinuation !== undefined) {
    refs.push({
      run_id: stringOrUndefined(result.run_id),
      full_output_ref: stringOrUndefined(result.full_output_ref),
      continuation: resultContinuation,
    });
  }
  if (Array.isArray(result.results)) {
    for (const item of result.results) {
      const itemRecord = asRecord(item);
      const continuation = toolContinuationFromUnknown(itemRecord.continuation);
      if (continuation !== undefined) {
        refs.push({
          index: numberOrUndefined(itemRecord.index),
          sub_agent_id: stringOrUndefined(itemRecord.sub_agent_id),
          sub_agent_name: stringOrUndefined(itemRecord.sub_agent_name),
          run_id: stringOrUndefined(itemRecord.run_id),
          full_output_ref: stringOrUndefined(itemRecord.full_output_ref),
          continuation,
        });
      }
    }
  }
  return uniqueSubAgentContinuationRefs(refs);
}

function uniqueSubAgentContinuationRefs(refs: readonly SubAgentContinuationRef[]): readonly SubAgentContinuationRef[] {
  const seen = new Set<string>();
  const uniqueRefs: SubAgentContinuationRef[] = [];
  for (const ref of refs) {
    const key = JSON.stringify(ref.continuation);
    if (!seen.has(key)) {
      seen.add(key);
      uniqueRefs.push(ref);
    }
  }
  return uniqueRefs;
}

function projectSubAgentToolAgentContent(
  request: ToolCallRequest,
  record: Readonly<Record<string, unknown>>,
  result: Readonly<Record<string, unknown>>,
  summary: string | undefined,
  truncated: boolean
): unknown {
  const action = stringOrUndefined(record.action) ?? request.toolName;
  if (Array.isArray(result.results)) {
    const continuationRefs = subAgentToolContinuationRefs(record);
    return {
      action,
      status: stringOrUndefined(record.status),
      summary,
      result: {
        results: result.results.map(projectSubAgentResultItem),
        stats: optionalRecord(result.stats),
      },
      continuations: continuationRefs.length === 0 ? undefined : continuationRefs,
      truncated,
    };
  }

  const projectedResult = projectSubAgentResultItem(result);
  return {
    action,
    status: stringOrUndefined(record.status),
    sub_agent_name: stringOrUndefined(record.sub_agent_name),
    sub_agent_id: stringOrUndefined(record.sub_agent_id),
    spawned_role: stringOrUndefined(record.spawned_role),
    spawned_id: stringOrUndefined(record.spawned_id),
    summary,
    full_output: projectedResult.full_output,
    result: projectedResult,
    truncated,
  };
}

function projectSubAgentResultItem(value: unknown): {
  readonly index?: number;
  readonly sub_agent_id?: string;
  readonly sub_agent_name?: string;
  readonly task?: string;
  readonly status?: string;
  readonly summary?: string;
  readonly full_output?: string;
  readonly full_output_chars?: number;
  readonly full_output_ref?: string;
  readonly continuation?: ToolContinuation;
  readonly tool_calls?: number;
  readonly model_rounds?: number;
  readonly duration_ms?: number;
  readonly run_id?: string;
  readonly error?: string;
} {
  const record = asRecord(value);
  return {
    index: numberOrUndefined(record.index),
    sub_agent_id: stringOrUndefined(record.sub_agent_id),
    sub_agent_name: stringOrUndefined(record.sub_agent_name),
    task: stringOrUndefined(record.task),
    status: stringOrUndefined(record.status),
    summary: stringOrUndefined(record.summary),
    full_output: textOrUndefined(record.full_output),
    full_output_chars: numberOrUndefined(record.full_output_chars),
    full_output_ref: stringOrUndefined(record.full_output_ref),
    continuation: toolContinuationFromUnknown(record.continuation),
    tool_calls: numberOrUndefined(record.tool_calls),
    model_rounds: numberOrUndefined(record.model_rounds),
    duration_ms: numberOrUndefined(record.duration_ms),
    run_id: stringOrUndefined(record.run_id),
    error: stringOrUndefined(record.error),
  };
}

function projectDirectoryEntry(value: unknown): {
  readonly path?: string;
  readonly name?: string;
  readonly kind?: string;
  readonly bytes?: number;
  readonly depth?: number;
} {
  const record = asRecord(value);
  return {
    path: stringOrUndefined(record.path),
    name: stringOrUndefined(record.name),
    kind: stringOrUndefined(record.kind),
    bytes: numberOrUndefined(record.bytes),
    depth: numberOrUndefined(record.depth),
  };
}

function projectArchiveEntry(value: unknown): {
  readonly path?: string;
  readonly name?: string;
  readonly kind?: string;
  readonly bytes?: number;
  readonly compressedBytes?: number;
  readonly compressionMethod?: number;
  readonly unsafePath?: boolean;
} {
  const record = asRecord(value);
  return {
    path: stringOrUndefined(record.path),
    name: stringOrUndefined(record.name),
    kind: stringOrUndefined(record.kind),
    bytes: numberOrUndefined(record.bytes),
    compressedBytes: numberOrUndefined(record.compressedBytes),
    compressionMethod: numberOrUndefined(record.compressionMethod),
    unsafePath: booleanOrUndefined(record.unsafePath),
  };
}

function projectContextAttachment(value: unknown): {
  readonly attachmentId?: string;
  readonly kind?: string;
  readonly format?: string;
  readonly title?: string;
  readonly summary?: string;
  readonly mimeType?: string;
  readonly byteLength?: number;
  readonly available?: boolean;
  readonly previewTruncated?: boolean;
  readonly authorized?: boolean;
  readonly ref?: string;
  readonly canReadText?: boolean;
  readonly canReadPdfText?: boolean;
  readonly canReadImage?: boolean;
  readonly canReadTable?: boolean;
  readonly canInspectArchive?: boolean;
  readonly canListFiles?: boolean;
  readonly canSearchFiles?: boolean;
  readonly canUseVisionInput?: boolean;
} {
  const record = asRecord(value);
  return {
    attachmentId: stringOrUndefined(record.attachmentId),
    kind: stringOrUndefined(record.kind),
    format: stringOrUndefined(record.format),
    title: stringOrUndefined(record.title),
    summary: stringOrUndefined(record.summary),
    mimeType: stringOrUndefined(record.mimeType),
    byteLength: numberOrUndefined(record.byteLength),
    available: booleanOrUndefined(record.available),
    previewTruncated: booleanOrUndefined(record.previewTruncated),
    authorized: booleanOrUndefined(record.authorized),
    ref: stringOrUndefined(record.ref),
    canReadText: booleanOrUndefined(record.canReadText),
    canReadPdfText: booleanOrUndefined(record.canReadPdfText),
    canReadImage: booleanOrUndefined(record.canReadImage),
    canReadTable: booleanOrUndefined(record.canReadTable),
    canInspectArchive: booleanOrUndefined(record.canInspectArchive),
    canListFiles: booleanOrUndefined(record.canListFiles),
    canSearchFiles: booleanOrUndefined(record.canSearchFiles),
    canUseVisionInput: booleanOrUndefined(record.canUseVisionInput),
  };
}

function projectTableRow(value: unknown): {
  readonly rowNumber?: number;
  readonly values?: readonly string[];
  readonly record?: Readonly<Record<string, string>>;
} {
  const record = asRecord(value);
  return {
    rowNumber: numberOrUndefined(record.rowNumber),
    values: stringArray(record.values),
    record: stringRecordOrUndefined(record.record),
  };
}

function projectGrepMatch(value: unknown): { readonly path?: string; readonly line?: number; readonly preview?: string } {
  const record = asRecord(value);
  const preview = typeof record.preview === "string"
    ? modelVisibleTextFragment({ value: record.preview, maxLength: 500 })
    : undefined;
  return {
    path: stringOrUndefined(record.path),
    line: numberOrUndefined(record.line),
    preview: preview?.text,
  };
}

function projectUnreadableDirectorySample(value: unknown): {
  readonly path?: string;
  readonly errorCode?: string;
} {
  const record = asRecord(value);
  return {
    path: stringOrUndefined(record.path),
    errorCode: stringOrUndefined(record.errorCode),
  };
}

function projectGrepSkippedSample(value: unknown): {
  readonly path?: string;
  readonly reason?: string;
  readonly bytes?: number;
  readonly errorCode?: string;
} {
  const record = asRecord(value);
  return {
    path: stringOrUndefined(record.path),
    reason: stringOrUndefined(record.reason),
    bytes: numberOrUndefined(record.bytes),
    errorCode: stringOrUndefined(record.errorCode),
  };
}

type ModelVisibleTextFragment = {
  readonly text: string;
  readonly truncated: boolean;
  readonly rawRef?: string;
};

function modelVisibleTextFragment(input: {
  readonly value: string;
  readonly maxLength: number;
  readonly request?: ToolCallRequest;
  readonly field?: string;
}): ModelVisibleTextFragment {
  const { value, maxLength } = input;
  if (value.length <= maxLength) {
    return { text: value, truncated: false };
  }
  const marker = `\n[truncated to ${maxLength} chars]`;
  return {
    text: `${value.slice(0, Math.max(0, maxLength - marker.length))}${marker}`,
    truncated: true,
    rawRef: input.request === undefined || input.field === undefined
      ? undefined
      : rawToolFieldRef(input.request, input.field),
  };
}

function rawToolFieldRef(request: ToolCallRequest, field: string): string {
  return `tool:${request.callId}:raw:${request.toolName}:${field}`;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function textOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  if (value === true) return true;
  if (value === false) return false;
  return undefined;
}

function displayActionForTool(action: string | undefined, toolName: string): string {
  if (action === undefined || action === toolName || /^[a-z][a-z0-9_:-]*$/i.test(action)) {
    return toolDisplayName(action ?? toolName);
  }
  return action;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringRecordOrUndefined(value: unknown): Readonly<Record<string, string>> | undefined {
  const record = asRecord(value);
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === "string") {
      result[key] = item;
    }
  }
  return Object.keys(result).length === 0 ? undefined : result;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function searchDisplayItem(value: unknown): Extract<ToolDisplayProjection, { readonly kind: "search_results" }>["results"][number] | undefined {
  const item = asRecord(value);
  const title = stringOrUndefined(item.title);
  if (title === undefined) {
    return undefined;
  }
  return {
    title: redactOrdinaryText(title, 160),
    url: stringOrUndefined(item.url) ?? stringOrUndefined(item.uri),
    refId: stringOrUndefined(item.refId),
    source: stringOrUndefined(item.source),
    snippet: compactSafeText(stringOrUndefined(item.snippet), 260),
  };
}

function summarizeCommandOutput(value: string): string | undefined {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 4);
  return compactSafeText(lines.join("\n"), 420);
}

function isMcpToolName(toolName: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*__[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(toolName);
}

function projectMcpMultimodalPart(value: unknown): {
  readonly type?: string;
  readonly mimeType?: string;
  readonly bytesApprox?: number;
} {
  const record = asRecord(value);
  return {
    type: stringOrUndefined(record.type),
    mimeType: stringOrUndefined(record.mimeType),
    bytesApprox: numberOrUndefined(record.bytesApprox),
  };
}
