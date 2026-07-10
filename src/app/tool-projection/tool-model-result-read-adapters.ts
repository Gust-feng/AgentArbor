import type { ToolCallRequest } from "../../domain/tools/index.js";
import { commandProgramFromToolResult, commandTextFromToolResult } from "./command-text.js";
import type { InternalToolResult } from "./tool-result-canonical.js";
import {
  MODEL_TOOL_ERROR_MAX_CHARS,
  MODEL_TOOL_TEXT_MAX_CHARS,
} from "./tool-result-field-projection.js";
import {
  asRecord,
  booleanOrUndefined,
  numberOrUndefined,
  optionalRecord,
  readErrorFactsFromOutput,
  readErrorMessageFromOutput,
  stringArray,
  stringOrUndefined,
} from "./tool-result-facts.js";
import { toolResultContinuation } from "./tool-result-continuation.js";
import {
  ensureToolResultContent,
  structuredSnapshot,
  textContentBlocks,
  textFragmentForToolResult,
} from "./tool-model-result-support.js";

interface ToolModelResultAdapterInput {
  readonly request: ToolCallRequest;
  readonly output: unknown;
  readonly truncated: boolean;
  readonly fallbackText: string;
}

export function projectCommandToolModelResult(input: ToolModelResultAdapterInput): InternalToolResult {
  const { request, output, truncated, fallbackText } = input;
  const record = asRecord(output);
  const result = asRecord(record.result);
  const stdout = textFragmentForToolResult(result.stdout, MODEL_TOOL_TEXT_MAX_CHARS, request, "stdout");
  const stderr = textFragmentForToolResult(result.stderr, MODEL_TOOL_ERROR_MAX_CHARS, request, "stderr");
  const content = [
    ...(stdout?.text === undefined ? [] : [{ type: "text" as const, text: stdout.text }]),
    ...(stderr?.text === undefined ? [] : [{ type: "text" as const, text: stderr.text }]),
  ];
  const exitCode = numberOrUndefined(result.exitCode);
  const effectiveTruncated = truncated || stdout?.truncated === true || stderr?.truncated === true;
  const continuation = toolResultContinuation({ request, result, truncated: effectiveTruncated });
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
      truncated: effectiveTruncated,
    }),
    isError: exitCode !== undefined && exitCode !== 0 ? true : undefined,
    continuation,
  }, fallbackText);
}

export function projectFileReadToolModelResult(input: ToolModelResultAdapterInput): InternalToolResult {
  const { request, output, truncated, fallbackText } = input;
  const record = asRecord(output);
  const result = asRecord(record.result);
  const content = textFragmentForToolResult(result.content, MODEL_TOOL_TEXT_MAX_CHARS, request, "content");
  const effectiveTruncated = truncated || content?.truncated === true;
  const continuation = toolResultContinuation({ request, result, truncated: effectiveTruncated });
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
      truncated: effectiveTruncated || booleanOrUndefined(result.truncated),
    }),
    isError: booleanOrUndefined(result.readable) === false ? true : undefined,
    continuation,
  }, fallbackText);
}

export function projectResearchReadToolModelResult(input: ToolModelResultAdapterInput): InternalToolResult {
  const { request, output, truncated, fallbackText } = input;
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
    }, fallbackText);
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
  }, fallbackText);
}
