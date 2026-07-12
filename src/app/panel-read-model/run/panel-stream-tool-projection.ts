import type { ModelUsage } from "../../../domain/intelligence/index.js";
import type { ToolDisplayProjection } from "../../../domain/observation/index.js";
import type { ToolErrorDomain, ToolErrorFacts, ToolFactValue } from "../../../domain/tools/index.js";
import { isToolErrorDomain, toolDisplayName } from "../../../domain/tools/index.js";
import { commandTextFromToolInput, commandTextFromToolResult } from "../../command-text.js";
import { asRecord, stringArray, stringOrUndefined } from "../../run-read-model/value-utils.js";
import { safeCommandToolPreview, safeReadFileToolPreview } from "../../safe-tool-preview.js";
import {
  normalizeToolDisplayForOperation,
} from "../../tool-display-normalization.js";
import { projectToolDisplay } from "../../tool-projection/tool-display-projection.js";
import { commandSummaryParts } from "../transcript/panel-transcript-tool-format.js";

export type PanelRunStreamEventDetail = {
  readonly kind: "thinking" | "tool" | "confirmation" | "work" | "sub_agent";
  readonly action?: string;
  readonly path?: string;
  readonly query?: string;
  readonly command?: string;
  readonly exitCode?: number;
  readonly preview?: string;
  readonly display?: ToolDisplayProjection;
  readonly truncated?: boolean;
  readonly error?: string;
  readonly errorDomain?: ToolErrorDomain;
  readonly errorFacts?: ToolErrorFacts;
  readonly modelUsage?: ModelUsage;
  readonly subAgentRunId?: string;
  readonly subAgentBatchId?: string;
  readonly subAgentBatchIndex?: number;
  readonly subAgentName?: string;
  readonly subAgentStatus?: "completed" | "failed" | "approval_required" | "cancelled" | "running";
  readonly subAgentTask?: string;
  readonly subAgentModelRounds?: number;
  readonly subAgentToolCalls?: number;
  readonly subAgentDurationMs?: number;
  readonly subAgentTotalCount?: number;
  readonly subAgentSuccessCount?: number;
  readonly subAgentFailedCount?: number;
  readonly subAgentCancelledCount?: number;
  readonly subAgentApprovalRequiredCount?: number;
  readonly subAgentNotStartedCount?: number;
};

export function toolSummary(
  type: "tool.requested" | "tool.completed" | "tool.failed" | "tool.cancelled",
  payload: Readonly<Record<string, unknown>>
): string {
  const toolName = stringOrUndefined(payload.toolName) ?? "unknown";
  const displayName = stringOrUndefined(payload.toolDisplayName) ?? localToolLabel(toolName);
  const input = asRecord(payload.input);
  const output = asRecord(payload.output);
  const target = toolTargetText(toolName, input, output);
  const targetText = target === undefined ? "" : `：${target}`;
  if (type === "tool.requested") {
    return `正在${displayName}${targetText}。`;
  }
  if (type === "tool.completed") {
    return `${displayName}完成${targetText}。`;
  }
  return type === "tool.cancelled"
    ? `${displayName}已取消${targetText}。`
    : `${displayName}未完成${targetText}。`;
}

export function toolStreamDetail(
  type: "tool.requested" | "tool.completed" | "tool.failed" | "tool.cancelled",
  payload: Readonly<Record<string, unknown>>
): PanelRunStreamEventDetail {
  const toolName = stringOrUndefined(payload.toolName) ?? "tool";
  const input = asRecord(payload.input);
  const output = asRecord(payload.output);
  const display = compactToolDisplayForStream(toolName, commandDisplayForReadModel(toolName, input, output, payload) ??
    projectToolDisplay({
      callId: stringOrUndefined(payload.callId) ?? "panel-tool",
      toolName,
      input: cloneToolFactValue(input),
    }, output));
  const errorDomain = errorDomainFromToolFacts(payload, output);
  const errorFacts = errorFactsFromToolFacts(payload, output, display);
  return {
    kind: "tool",
    action: displayActionLabel(localToolLabel(toolName)),
    path: stringOrUndefined(output.path) ?? stringOrUndefined(input.path),
    query: stringOrUndefined(output.query) ?? stringOrUndefined(input.query),
    command: commandTextFromToolResult(output, input),
    exitCode: typeof output.exitCode === "number" ? output.exitCode : undefined,
    preview: type === "tool.requested" ? toolRequestPreview(toolName, input) : toolResultPreview(toolName, output, payload),
    display,
    truncated: output.truncated === true || asRecord(payload.factTruncation).output === true,
    error: type === "tool.failed"
      ? stringOrUndefined(payload.error)
      : type === "tool.cancelled"
        ? stringOrUndefined(payload.reason)
        : undefined,
    errorDomain,
    errorFacts,
  };
}

function compactToolDisplayForStream(
  toolName: string,
  display: ToolDisplayProjection,
): ToolDisplayProjection {
  if (display.kind === "read_result" && isContentReadTool(toolName)) {
    return { ...display, contentPreview: undefined };
  }
  return display;
}

function isContentReadTool(toolName: string): boolean {
  return toolName === "read_file" ||
    toolName === "read_context_attachment_text" ||
    toolName === "read_context_attachment_pdf_text" ||
    toolName === "read_skill_resource" ||
    toolName === "read_sub_agent_output";
}

function commandDisplayForReadModel(
  toolName: string,
  input: Readonly<Record<string, unknown>>,
  output: Readonly<Record<string, unknown>>,
  payload: Readonly<Record<string, unknown>>
): ToolDisplayProjection | undefined {
  if (toolName !== "shell_command") {
    return undefined;
  }
  const display: ToolDisplayProjection & { readonly cancelled?: boolean } = {
    kind: "command_summary",
    command: stringOrUndefined(output.command) ?? stringOrUndefined(input.command),
    args: stringArray(output.args).length > 0 ? stringArray(output.args) : stringArray(input.args),
    commandLine: commandTextFromToolResult(output, input),
    cwd: stringOrUndefined(output.cwd) ?? stringOrUndefined(input.cwd),
    shell: stringOrUndefined(asRecord(output.shell).label),
    exitCode: numberOrUndefined(output.exitCode),
    timedOut: booleanOrUndefined(output.timedOut),
    cancelled: booleanOrUndefined(output.cancelled),
    background: booleanOrUndefined(output.background),
    pid: numberOrUndefined(output.pid),
    logRef: stringOrUndefined(output.logRef),
    logPath: stringOrUndefined(output.logPath),
    stopCommand: stringOrUndefined(output.stopCommand),
    durationMs: numberOrUndefined(output.durationMs) ?? numberOrUndefined(payload.durationMs),
    waitForPort: numberOrUndefined(output.waitForPort),
    portReady: booleanOrUndefined(output.portReady),
    stdoutTruncated: booleanOrUndefined(output.stdoutTruncated),
    stderrTruncated: booleanOrUndefined(output.stderrTruncated),
    stdoutChars: numberOrUndefined(output.stdoutChars),
    stderrChars: numberOrUndefined(output.stderrChars),
    stdoutOmittedChars: numberOrUndefined(output.stdoutOmittedChars),
    stderrOmittedChars: numberOrUndefined(output.stderrOmittedChars),
    outputSummary: undefined,
    errorSummary: undefined,
  };
  return display;
}

function displayActionLabel(value: string): string {
  return /^[a-z][a-z0-9_:-]*$/i.test(value) ? toolDisplayName(value) : value;
}

function toolErrorDomainOrUndefined(value: unknown): ToolErrorDomain | undefined {
  return isToolErrorDomain(value) ? value : undefined;
}

function cloneToolFactValue(value: unknown): ToolFactValue | undefined {
  return value === undefined ? undefined : globalThis.structuredClone(value as ToolFactValue);
}

function toolErrorFactsOrUndefined(value: unknown): ToolErrorFacts | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? globalThis.structuredClone(value as ToolErrorFacts)
    : undefined;
}

function errorDomainFromToolFacts(
  payload: Readonly<Record<string, unknown>>,
  output: Readonly<Record<string, unknown>>,
): ToolErrorDomain | undefined {
  return toolErrorDomainOrUndefined(output.errorDomain) ?? toolErrorDomainOrUndefined(payload.errorDomain);
}

function errorFactsFromToolFacts(
  payload: Readonly<Record<string, unknown>>,
  output: Readonly<Record<string, unknown>>,
  display: ToolDisplayProjection | undefined,
): ToolErrorFacts | undefined {
  if (display?.kind === "read_result" && display.errorFacts !== undefined) {
    return display.errorFacts;
  }
  return readErrorFactsFromOutput(output) ?? toolErrorFactsOrUndefined(output.errorFacts) ?? toolErrorFactsOrUndefined(payload.errorFacts);
}

function toolRequestPreview(toolName: string, input: Readonly<Record<string, unknown>>): string | undefined {
  if (toolName === "read_file" || toolName === "list_dir") {
    const path = stringOrUndefined(input.path);
    return path;
  }
  if (toolName === "grep_files") {
    const query = stringOrUndefined(input.query);
    const path = stringOrUndefined(input.path);
    return query === undefined ? undefined : [query, path].filter((item): item is string => item !== undefined).join(" · ");
  }
  if (toolName === "write_file" || toolName === "create_file" || toolName === "edit_file" || toolName === "delete_file") {
    const path = stringOrUndefined(input.path);
    return path;
  }
  if (toolName === "shell_command") {
    return commandTextFromToolInput(input);
  }
  if (toolName === "browser_snapshot") {
    const url = stringOrUndefined(input.url);
    return url;
  }
  if (toolName === "http_request") {
    const method = stringOrUndefined(input.method) ?? "GET";
    const url = stringOrUndefined(input.url);
    return url === undefined ? method : `${method.toUpperCase()} ${url}`;
  }
  return undefined;
}

function safeFileChangePreview(
  toolName: string,
  input: Readonly<Record<string, unknown>>,
  output: Readonly<Record<string, unknown>>
): string | undefined {
  const display = normalizeToolDisplayForOperation({
    toolName,
    input,
    output,
    truncated: output.truncated === true,
  });
  if ((display.kind === "file_change_summary" || display.kind === "file_diff_preview") && display.preview !== undefined) {
    return display.preview;
  }
  const path = stringOrUndefined(output.path) ?? stringOrUndefined(input.path);
  if (toolName === "edit_file") {
    return path;
  }
  return path === undefined ? undefined : `文件：${path}`;
}

function toolResultPreview(
  toolName: string,
  output: Readonly<Record<string, unknown>>,
  payload: Readonly<Record<string, unknown>>
): string | undefined {
  const error = stringOrUndefined(payload.error);
  if (error !== undefined) {
    return compactStreamDetailText(error, 800);
  }
  if (toolName === "read_file") {
    return safeReadFilePreview(output);
  }
  if (toolName === "list_dir") {
    const entries = Array.isArray(output.entries) ? output.entries : [];
    const lines = entries.slice(0, 12).map((entry) => {
      const record = asRecord(entry);
      const name = stringOrUndefined(record.name) ?? "unknown";
      const kind = stringOrUndefined(record.kind) ?? "entry";
      return `${kind} ${name}`;
    });
    return lines.length === 0 ? undefined : lines.join("\n");
  }
  if (toolName === "grep_files") {
    const matches = Array.isArray(output.matches) ? output.matches : [];
    const lines = matches.slice(0, 12).map((match) => {
      const record = asRecord(match);
      const path = stringOrUndefined(record.path) ?? "unknown";
      const line = typeof record.line === "number" ? record.line : "?";
      const preview = stringOrUndefined(record.preview) ?? "";
      return `${path}:${line} ${preview}`;
    });
    return lines.length === 0 ? undefined : lines.join("\n");
  }
  if (toolName === "search") {
    const display = projectToolDisplay({
      callId: "panel-search",
      toolName,
      input: cloneToolFactValue(payload.input),
    }, output);
    if (display?.kind === "search_results") {
      return compactStreamDetailText([
        display.query,
        display.status,
        display.message,
        `results: ${display.resultsReturned ?? display.results.length}`,
      ].filter((item): item is string => item !== undefined && item.length > 0).join(" · "), 900);
    }
    return compactStreamDetailText(stringOrUndefined(output.message), 900);
  }
  if (toolName === "write_file" || toolName === "create_file" || toolName === "edit_file" || toolName === "delete_file") {
    return safeFileChangePreview(toolName, asRecord(payload.input), output);
  }
  if (toolName === "shell_command") {
    return safeCommandPreview(output, asRecord(payload.input), payload);
  }
  if (toolName === "read") {
    return safeReadPreview(output, asRecord(payload.input));
  }
  if (toolName === "browser_snapshot") {
    const title = stringOrUndefined(output.title);
    const url = stringOrUndefined(output.url);
    const text = stringOrUndefined(output.text);
    const headline = [title, url].filter((item): item is string => item !== undefined).join(" · ");
    return compactStreamDetailText([headline, text].filter((item) => item !== undefined && item.length > 0).join("\n"), 900);
  }
  if (toolName === "http_request") {
    const method = stringOrUndefined(output.method);
    const url = stringOrUndefined(output.url);
    const statusCode = typeof output.statusCode === "number" ? output.statusCode : undefined;
    const statusText = stringOrUndefined(output.statusText);
    const body = stringOrUndefined(output.body);
    const headline = [
      method,
      url,
      statusCode === undefined ? undefined : `${statusCode}${statusText === undefined ? "" : ` ${statusText}`}`,
    ].filter((item): item is string => item !== undefined).join(" · ");
    return compactStreamDetailText([headline, body].filter((item) => item !== undefined && item.length > 0).join("\n"), 900);
  }
  if (isMcpToolName(toolName)) {
    const displaySummary = genericDisplayPreview(toolName, output);
    if (displaySummary !== undefined) {
      return displaySummary;
    }
    const text = stringOrUndefined(output.text);
    if (text !== undefined) {
      return compactStreamDetailText(text, 900);
    }
  }
  return genericDisplayPreview(toolName, output);
}

function safeReadPreview(
  output: Readonly<Record<string, unknown>>,
  input: Readonly<Record<string, unknown>>
): string | undefined {
  const display = projectToolDisplay({
    callId: "panel-read",
    toolName: "read",
    input: cloneToolFactValue(input),
  }, output);
  if (display?.kind === "read_result") {
    return readDisplayPreview(display, input);
  }
  const error = readErrorMessageFromOutput(output);
  const facts = readErrorFactsFromOutput(output);
  const headline = [
    stringOrUndefined(output.title),
    stringOrUndefined(output.uri) ?? stringOrUndefined(output.url) ?? stringOrUndefined(input.ref),
  ].filter((item): item is string => item !== undefined).join(" · ");
  return compactStreamDetailText([
    headline,
    error,
    facts === undefined ? undefined : `errorFacts: ${compactFactsText(facts)}`,
    stringOrUndefined(output.contentPreview),
  ].filter((item): item is string => item !== undefined && item.length > 0).join("\n"), 900);
}

function readDisplayPreview(
  display: Extract<ToolDisplayProjection, { readonly kind: "read_result" }>,
  input: Readonly<Record<string, unknown>>
): string | undefined {
  const headline = [
    display.status,
    display.title ?? display.uri ?? display.url ?? display.ref ?? stringOrUndefined(input.ref),
  ].filter((item): item is string => item !== undefined).join(" · ");
  return compactStreamDetailText([
    headline,
    display.error,
    display.errorFacts === undefined ? undefined : `errorFacts: ${compactFactsText(display.errorFacts)}`,
    display.contentPreview,
  ].filter((item): item is string => item !== undefined && item.length > 0).join("\n"), 900);
}

function readErrorFactsFromOutput(output: Readonly<Record<string, unknown>>): ToolErrorFacts | undefined {
  return toolErrorFactsOrUndefined(output.errorFacts);
}

function readErrorMessageFromOutput(output: Readonly<Record<string, unknown>>): string | undefined {
  return stringOrUndefined(output.error);
}

function safeReadFilePreview(
  output: Readonly<Record<string, unknown>>
): string | undefined {
  return safeReadFileToolPreview({
    path: stringOrUndefined(output.path),
    bytes: typeof output.bytes === "number" ? output.bytes : undefined,
  });
}

function safeCommandPreview(
  output: Readonly<Record<string, unknown>>,
  input: Readonly<Record<string, unknown>>,
  payload: Readonly<Record<string, unknown>>
): string | undefined {
  const display = commandDisplayForReadModel("shell_command", input, output, payload);
  if (display?.kind === "command_summary") {
    const parts = commandSummaryParts({
      display,
      failed: typeof output.exitCode === "number" && output.exitCode !== 0,
    });
    const preview = compactStreamDetailText(parts.join(" · "), 900);
    if (preview !== undefined) {
      return preview;
    }
  }
  return safeCommandToolPreview({
    command: commandTextFromToolResult(output, input),
    exitCode: typeof output.exitCode === "number" ? output.exitCode : undefined,
  });
}

function compactFactsText(facts: ToolErrorFacts): string {
  return JSON.stringify(facts).slice(0, 500);
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return value === true ? true : value === false ? false : undefined;
}

export function compactStreamDetailText(value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const text = value.trim();
  if (text.length === 0) {
    return undefined;
  }
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function localToolLabel(toolName: string): string {
  return toolDisplayName(toolName);
}

function toolTargetText(
  toolName: string,
  input: Readonly<Record<string, unknown>>,
  output: Readonly<Record<string, unknown>>
): string | undefined {
  const path = stringOrUndefined(output.path) ?? stringOrUndefined(input.path);
  if (path !== undefined) {
    return path;
  }
  const query = stringOrUndefined(output.query) ?? stringOrUndefined(input.query);
  if (query !== undefined) {
    return query;
  }
  const url = stringOrUndefined(output.url) ?? stringOrUndefined(input.url);
  if (url !== undefined) {
    return url;
  }
  if (toolName === "shell_command") {
    return commandTextFromToolResult(output, input);
  }
  return undefined;
}

function isMcpToolName(toolName: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*__[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(toolName);
}

function genericDisplayPreview(
  toolName: string,
  output: Readonly<Record<string, unknown>>,
): string | undefined {
  const display = normalizeToolDisplayForOperation({
    toolName,
    output,
    truncated: output.truncated === true,
  });
  if (display?.kind !== "generic_tool_summary") {
    return undefined;
  }
  return compactStreamDetailText(
    [display.summary, ...(display.items ?? [])]
      .filter((item): item is string => item !== undefined && item.length > 0)
      .join("\n"),
    900
  );
}
