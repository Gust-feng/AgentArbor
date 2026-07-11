import type { ModelUsage } from "../../../domain/intelligence/index.js";
import type { ToolDisplayProjection } from "../../../domain/observation/index.js";
import type { ToolErrorDomain, ToolErrorFacts } from "../../../domain/tools/index.js";
import { isToolErrorDomain, normalizeToolErrorFacts, toolDisplayName } from "../../../domain/tools/index.js";
import { commandTextFromToolInput, commandTextFromToolResult } from "../../command-text.js";
import { cleanOrdinaryToolText } from "../../ordinary-tool-copy.js";
import { asRecord, stringArray, stringOrUndefined } from "../../run-read-model/value-utils.js";
import { safeCommandToolPreview, safeReadFileToolPreview } from "../../safe-tool-preview.js";
import {
  normalizeToolDisplayForOperation,
  toolDisplayProjectionOrUndefined,
} from "../../tool-display-normalization.js";
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
  const result = asRecord(output.result);
  const target = toolTargetText(toolName, input, result);
  const targetText = target === undefined ? "" : `：${target}`;
  if (type === "tool.requested") {
    return `正在${displayName}${targetText}。`;
  }
  const summary = cleanOrdinaryToolText(stringOrUndefined(output.summary));
  const resultSummary = summary === target ? undefined : summary;
  if (type === "tool.completed") {
    return resultSummary === undefined
      ? `${displayName}完成${targetText}。`
      : `${displayName}完成${targetText}：${resultSummary}`;
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
  const result = asRecord(output.result);
  const display = commandDisplayForReadModel(toolName, input, output, result, payload) ??
    normalizeToolDisplayForOperation({
      toolName,
      input,
      output,
      existingDisplay: output.display,
      truncated: output.truncated === true,
    });
  const errorDomain = errorDomainFromToolFacts(payload, output);
  const errorFacts = errorFactsFromToolFacts(payload, output, display);
  return {
    kind: "tool",
    action: displayActionLabel(stringOrUndefined(output.action) ?? localToolLabel(toolName)),
    path: stringOrUndefined(result.path) ?? stringOrUndefined(input.path),
    query: stringOrUndefined(result.query) ?? stringOrUndefined(input.query),
    command: commandTextFromToolResult(result, input),
    exitCode: typeof result.exitCode === "number" ? result.exitCode : undefined,
    preview: type === "tool.requested" ? toolRequestPreview(toolName, input) : toolResultPreview(toolName, output, result, payload),
    display,
    truncated: output.truncated === true,
    error: type === "tool.failed"
      ? stringOrUndefined(payload.error)
      : type === "tool.cancelled"
        ? stringOrUndefined(payload.reason)
        : undefined,
    errorDomain,
    errorFacts,
  };
}

function toolDisplayOrUndefined(value: unknown): ToolDisplayProjection | undefined {
  const display = toolDisplayProjectionOrUndefined(value);
  if (display?.kind !== "generic_tool_summary") {
    return display;
  }
  return {
    ...display,
    action: display.action === undefined ? undefined : displayActionLabel(display.action),
  };
}

function commandDisplayForReadModel(
  toolName: string,
  input: Readonly<Record<string, unknown>>,
  output: Readonly<Record<string, unknown>>,
  result: Readonly<Record<string, unknown>>,
  payload: Readonly<Record<string, unknown>>
): ToolDisplayProjection | undefined {
  if (toolName !== "run_command" && toolName !== "shell_command") {
    return undefined;
  }
  const existing = toolDisplayOrUndefined(output.display);
  const existingCommand = existing?.kind === "command_summary" ? existing : undefined;
  const stdout = stringOrUndefined(result.stdout);
  const stderr = stringOrUndefined(result.stderr);
  const display: ToolDisplayProjection & { readonly cancelled?: boolean } = {
    kind: "command_summary",
    ...existingCommand,
    command: existingCommand?.command ?? stringOrUndefined(result.command) ?? stringOrUndefined(input.command),
    args: existingCommand?.args ?? (stringArray(result.args).length > 0 ? stringArray(result.args) : stringArray(input.args)),
    commandLine: existingCommand?.commandLine ?? commandTextFromToolResult(result, input),
    cwd: existingCommand?.cwd ?? stringOrUndefined(result.cwd) ?? stringOrUndefined(input.cwd),
    shell: existingCommand?.shell ?? stringOrUndefined(asRecord(result.shell).label),
    exitCode: existingCommand?.exitCode ?? numberOrUndefined(result.exitCode),
    timedOut: existingCommand?.timedOut ?? booleanOrUndefined(result.timedOut),
    cancelled: booleanOrUndefined((existingCommand as { readonly cancelled?: unknown } | undefined)?.cancelled) ?? booleanOrUndefined(result.cancelled),
    background: existingCommand?.background ?? booleanOrUndefined(result.background),
    pid: existingCommand?.pid ?? numberOrUndefined(result.pid),
    logRef: existingCommand?.logRef ?? stringOrUndefined(result.logRef),
    logPath: existingCommand?.logPath ?? stringOrUndefined(result.logPath),
    stopCommand: existingCommand?.stopCommand ?? stringOrUndefined(result.stopCommand),
    durationMs: existingCommand?.durationMs ?? numberOrUndefined(result.durationMs) ?? numberOrUndefined(payload.durationMs),
    waitForPort: existingCommand?.waitForPort ?? numberOrUndefined(result.waitForPort),
    portReady: existingCommand?.portReady ?? booleanOrUndefined(result.portReady),
    stdoutTruncated: existingCommand?.stdoutTruncated ?? booleanOrUndefined(result.stdoutTruncated),
    stderrTruncated: existingCommand?.stderrTruncated ?? booleanOrUndefined(result.stderrTruncated),
    stdoutChars: existingCommand?.stdoutChars ?? numberOrUndefined(result.stdoutChars),
    stderrChars: existingCommand?.stderrChars ?? numberOrUndefined(result.stderrChars),
    stdoutOmittedChars: existingCommand?.stdoutOmittedChars ?? numberOrUndefined(result.stdoutOmittedChars),
    stderrOmittedChars: existingCommand?.stderrOmittedChars ?? numberOrUndefined(result.stderrOmittedChars),
    outputSummary: existingCommand?.outputSummary ?? summarizeCommandOutput(stdout),
    errorSummary: existingCommand?.errorSummary ?? summarizeCommandOutput(stderr),
  };
  return display;
}

function displayActionLabel(value: string): string {
  return /^[a-z][a-z0-9_:-]*$/i.test(value) ? toolDisplayName(value) : value;
}

function toolErrorDomainOrUndefined(value: unknown): ToolErrorDomain | undefined {
  return isToolErrorDomain(value) ? value : undefined;
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
  return readErrorFactsFromOutput(output) ?? normalizeToolErrorFacts(output.errorFacts) ?? normalizeToolErrorFacts(payload.errorFacts);
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
  if (toolName === "run_command" || toolName === "shell_command") {
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
  output: Readonly<Record<string, unknown>>,
  result: Readonly<Record<string, unknown>>
): string | undefined {
  const display = normalizeToolDisplayForOperation({
    toolName,
    input,
    output,
    existingDisplay: output.display,
    truncated: output.truncated === true,
  });
  if ((display.kind === "file_change_summary" || display.kind === "file_diff_preview") && display.preview !== undefined) {
    return display.preview;
  }
  const path = stringOrUndefined(result.path) ?? stringOrUndefined(input.path);
  const summary = cleanOrdinaryToolText(stringOrUndefined(output.summary));
  if (toolName === "edit_file") {
    return path ?? summary;
  }
  return [summary, path === undefined ? undefined : `文件：${path}`].filter((item): item is string => item !== undefined && item.length > 0).join("\n");
}

function toolResultPreview(
  toolName: string,
  output: Readonly<Record<string, unknown>>,
  result: Readonly<Record<string, unknown>>,
  payload: Readonly<Record<string, unknown>>
): string | undefined {
  const error = stringOrUndefined(payload.error);
  if (error !== undefined) {
    return compactStreamDetailText(error, 800);
  }
  if (toolName === "read_file") {
    return safeReadFilePreview(output, result);
  }
  if (toolName === "list_dir") {
    const entries = Array.isArray(result.entries) ? result.entries : [];
    const lines = entries.slice(0, 12).map((entry) => {
      const record = asRecord(entry);
      const name = stringOrUndefined(record.name) ?? "unknown";
      const kind = stringOrUndefined(record.kind) ?? "entry";
      return `${kind} ${name}`;
    });
    return lines.length === 0 ? stringOrUndefined(output.summary) : lines.join("\n");
  }
  if (toolName === "grep_files") {
    const matches = Array.isArray(result.matches) ? result.matches : [];
    const lines = matches.slice(0, 12).map((match) => {
      const record = asRecord(match);
      const path = stringOrUndefined(record.path) ?? "unknown";
      const line = typeof record.line === "number" ? record.line : "?";
      const preview = stringOrUndefined(record.preview) ?? "";
      return `${path}:${line} ${preview}`;
    });
    return lines.length === 0 ? stringOrUndefined(output.summary) : lines.join("\n");
  }
  if (toolName === "search") {
    const display = toolDisplayOrUndefined(output.display);
    if (display?.kind === "search_results") {
      return compactStreamDetailText([
        display.query,
        display.status,
        display.message,
        `results: ${display.resultsReturned ?? display.results.length}`,
      ].filter((item): item is string => item !== undefined && item.length > 0).join(" · "), 900);
    }
    return compactStreamDetailText(stringOrUndefined(output.summary), 900);
  }
  if (toolName === "write_file" || toolName === "create_file" || toolName === "edit_file" || toolName === "delete_file") {
    return safeFileChangePreview(toolName, asRecord(payload.input), output, result);
  }
  if (toolName === "run_command" || toolName === "shell_command") {
    return safeCommandPreview(output, result, asRecord(payload.input), payload);
  }
  if (toolName === "read") {
    return safeReadPreview(output, result, asRecord(payload.input));
  }
  if (toolName === "browser_snapshot") {
    const title = stringOrUndefined(result.title);
    const url = stringOrUndefined(result.url);
    const text = stringOrUndefined(result.text);
    const headline = [title, url].filter((item): item is string => item !== undefined).join(" · ");
    return compactStreamDetailText([headline, text].filter((item) => item !== undefined && item.length > 0).join("\n"), 900);
  }
  if (toolName === "http_request") {
    const method = stringOrUndefined(result.method);
    const url = stringOrUndefined(result.url);
    const statusCode = typeof result.statusCode === "number" ? result.statusCode : undefined;
    const statusText = stringOrUndefined(result.statusText);
    const body = stringOrUndefined(result.body);
    const headline = [
      method,
      url,
      statusCode === undefined ? undefined : `${statusCode}${statusText === undefined ? "" : ` ${statusText}`}`,
    ].filter((item): item is string => item !== undefined).join(" · ");
    return compactStreamDetailText([headline, body].filter((item) => item !== undefined && item.length > 0).join("\n"), 900);
  }
  if (isMcpToolName(toolName)) {
    const displaySummary = genericDisplayPreview(output);
    if (displaySummary !== undefined) {
      return displaySummary;
    }
    const text = stringOrUndefined(result.text);
    if (text !== undefined) {
      return compactStreamDetailText(text, 900);
    }
  }
  return compactStreamDetailText(stringOrUndefined(output.summary), 900);
}

function safeReadPreview(
  output: Readonly<Record<string, unknown>>,
  result: Readonly<Record<string, unknown>>,
  input: Readonly<Record<string, unknown>>
): string | undefined {
  const display = toolDisplayOrUndefined(output.display);
  if (display?.kind === "read_result") {
    return readDisplayPreview(display, input);
  }
  const error = readErrorMessageFromOutput(output);
  const facts = readErrorFactsFromOutput(output);
  const headline = [
    stringOrUndefined(result.title),
    stringOrUndefined(result.uri) ?? stringOrUndefined(result.url) ?? stringOrUndefined(input.ref),
  ].filter((item): item is string => item !== undefined).join(" · ");
  return compactStreamDetailText([
    headline,
    error,
    facts === undefined ? undefined : `errorFacts: ${compactFactsText(facts)}`,
    stringOrUndefined(result.contentPreview),
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
  const direct = normalizeToolErrorFacts(output.errorFacts);
  if (direct !== undefined) {
    return direct;
  }
  if (stringOrUndefined(output.action) !== "read") {
    return undefined;
  }
  const trace = asRecord(output.trace);
  const sourceSteps = Array.isArray(trace.sourceSteps) ? trace.sourceSteps : [];
  for (const value of sourceSteps) {
    const step = asRecord(value);
    if (stringOrUndefined(step.status) === "completed") {
      continue;
    }
    const facts = normalizeToolErrorFacts(step.errorFacts);
    if (facts !== undefined) {
      return facts;
    }
  }
  return undefined;
}

function readErrorMessageFromOutput(output: Readonly<Record<string, unknown>>): string | undefined {
  const direct = stringOrUndefined(output.error);
  if (direct !== undefined) {
    return direct;
  }
  if (stringOrUndefined(output.action) !== "read") {
    return undefined;
  }
  const trace = asRecord(output.trace);
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

function safeReadFilePreview(
  output: Readonly<Record<string, unknown>>,
  result: Readonly<Record<string, unknown>>
): string | undefined {
  return safeReadFileToolPreview({
    summary: stringOrUndefined(output.summary),
    path: stringOrUndefined(result.path),
    bytes: typeof result.bytes === "number" ? result.bytes : undefined,
  });
}

function safeCommandPreview(
  output: Readonly<Record<string, unknown>>,
  result: Readonly<Record<string, unknown>>,
  input: Readonly<Record<string, unknown>>,
  payload: Readonly<Record<string, unknown>>
): string | undefined {
  const display = commandDisplayForReadModel("shell_command", input, output, result, payload);
  if (display?.kind === "command_summary") {
    const parts = commandSummaryParts({
      display,
      failed: typeof result.exitCode === "number" && result.exitCode !== 0,
    });
    const preview = compactStreamDetailText(parts.join(" · "), 900);
    if (preview !== undefined) {
      return preview;
    }
  }
  return safeCommandToolPreview({
    summary: stringOrUndefined(output.summary),
    command: commandTextFromToolResult(result, input),
    exitCode: typeof result.exitCode === "number" ? result.exitCode : undefined,
  });
}

function compactFactsText(facts: ToolErrorFacts): string {
  return JSON.stringify(facts).slice(0, 500);
}

function summarizeCommandOutput(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 4);
  return compactStreamDetailText(lines.join("\n"), 420);
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
  result: Readonly<Record<string, unknown>>
): string | undefined {
  const path = stringOrUndefined(result.path) ?? stringOrUndefined(input.path);
  if (path !== undefined) {
    return path;
  }
  const query = stringOrUndefined(result.query) ?? stringOrUndefined(input.query);
  if (query !== undefined) {
    return query;
  }
  const url = stringOrUndefined(result.url) ?? stringOrUndefined(input.url);
  if (url !== undefined) {
    return url;
  }
  if (toolName === "run_command" || toolName === "shell_command") {
    return commandTextFromToolResult(result, input);
  }
  return undefined;
}

function isMcpToolName(toolName: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*__[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(toolName);
}

function genericDisplayPreview(output: Readonly<Record<string, unknown>>): string | undefined {
  const display = toolDisplayOrUndefined(output.display);
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
