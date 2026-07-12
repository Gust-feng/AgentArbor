import type { ToolDisplayProjection } from "../../domain/observation/index.js";
import type { ToolCallRequest } from "../../domain/tools/index.js";
import { toolDisplayName } from "../../domain/tools/index.js";
import { commandProgramFromToolResult, commandTextFromToolResult } from "./command-text.js";
import { normalizeToolDisplayForOperation } from "./tool-display-normalization.js";
import {
  asRecord,
  booleanOrUndefined,
  isMcpToolName,
  isString,
  numberOrUndefined,
  readErrorFactsFromOutput,
  readErrorMessageFromOutput,
  searchMessageFromOutput,
  stringArray,
  stringOrUndefined,
} from "./tool-result-facts.js";
import { compactSafeText, redactOrdinaryText } from "./tool-projection-text.js";

const SEARCH_DISPLAY_RESULTS_LIMIT = 20;
export function projectToolDisplay(request: ToolCallRequest, output: unknown): ToolDisplayProjection {
  const record = asRecord(output);
  if (request.toolName === "search" && Array.isArray(record.results)) {
    const results = record.results
      .slice(0, SEARCH_DISPLAY_RESULTS_LIMIT)
      .map(projectSearchDisplayItem)
      .filter((item): item is NonNullable<ReturnType<typeof projectSearchDisplayItem>> => item !== undefined);
    return {
      kind: "search_results",
      query: stringOrUndefined(record.query),
      status: stringOrUndefined(record.researchStatus),
      message: compactSafeText(searchMessageFromOutput(record), 500),
      results,
      resultsReturned: record.results.length,
      truncated: record.results.length > results.length || record.truncated === true,
    };
  }
  if (request.toolName === "read" && Array.isArray(record.items)) {
    return {
      kind: "generic_tool_summary",
      action: toolDisplayName(request.toolName),
      summary: `读取 ${record.items.length} 个 ref。`,
      items: record.items.slice(0, 8).map(batchReadDisplayItem).filter(isString),
    };
  }
  if (request.toolName === "read") {
    const errorFacts = readErrorFactsFromOutput(record);
    const error = readErrorMessageFromOutput(record);
    return {
      kind: "read_result",
      ref: stringOrUndefined(record.ref) ?? stringOrUndefined(asRecord(request.input).ref),
      source: stringOrUndefined(record.source),
      status: stringOrUndefined(record.researchStatus),
      title: stringOrUndefined(record.title),
      url: stringOrUndefined(record.uri),
      uri: stringOrUndefined(record.uri),
      sourceSearchRef: stringOrUndefined(record.sourceSearchRef),
      contentPreview: compactSafeText(stringOrUndefined(record.contentPreview), 1_200),
      error,
      errorFacts,
      truncated: record.truncated === true,
    };
  }
  if (isContentReadTool(request.toolName)) {
    return {
      kind: "read_result",
      ref: stringOrUndefined(record.refId),
      source: stringOrUndefined(record.source),
      status: stringOrUndefined(record.status) ?? "completed",
      title: stringOrUndefined(record.title) ?? stringOrUndefined(record.path),
      url: stringOrUndefined(record.url),
      uri: stringOrUndefined(record.uri),
      contentPreview: compactSafeText(stringOrUndefined(record.content) ?? stringOrUndefined(record.text), 1_200),
      truncated: record.truncated === true,
    };
  }
  if (request.toolName === "browser_snapshot") {
    return {
      kind: "browser_snapshot",
      title: stringOrUndefined(record.title),
      url: stringOrUndefined(record.url),
      text: compactSafeText(stringOrUndefined(record.text), 900),
      truncated: record.truncated === true,
    };
  }
  if (request.toolName === "http_request") {
    return {
      kind: "http_response",
      method: stringOrUndefined(record.method),
      url: stringOrUndefined(record.url),
      statusCode: numberOrUndefined(record.statusCode),
      statusText: stringOrUndefined(record.statusText),
      durationMs: numberOrUndefined(record.durationMs),
      bodyPreview: compactSafeText(stringOrUndefined(record.body), 900),
      truncated: record.truncated === true,
    };
  }
  if (isMcpToolName(request.toolName)) {
    return normalizeToolDisplayForOperation({
      toolName: request.toolName,
      input: request.input,
      output,
      truncated: record.truncated === true,
    });
  }
  if (request.toolName === "shell_command") {
    const stdout = stringOrUndefined(record.stdout);
    const stderr = stringOrUndefined(record.stderr);
    const commandLine = commandTextFromToolResult(record, request.input);
    return {
      kind: "command_summary",
      command: commandProgramFromToolResult(record, request.input),
      args: stringArray(record.args).length > 0 ? stringArray(record.args) : stringArray(asRecord(request.input).args),
      commandLine,
      cwd: stringOrUndefined(record.cwd),
      shell: stringOrUndefined(asRecord(record.shell).label),
      exitCode: numberOrUndefined(record.exitCode),
      timedOut: record.timedOut === true,
      background: record.background === true,
      pid: numberOrUndefined(record.pid),
      logRef: stringOrUndefined(record.logRef),
      logPath: stringOrUndefined(record.logPath),
      stopCommand: stringOrUndefined(record.stopCommand),
      durationMs: numberOrUndefined(record.durationMs),
      waitForPort: numberOrUndefined(record.waitForPort),
      portReady: record.portReady === true ? true : record.portReady === false ? false : undefined,
      stdoutTruncated: record.stdoutTruncated === true ? true : record.stdoutTruncated === false ? false : undefined,
      stderrTruncated: record.stderrTruncated === true ? true : record.stderrTruncated === false ? false : undefined,
      stdoutChars: numberOrUndefined(record.stdoutChars),
      stderrChars: numberOrUndefined(record.stderrChars),
      stdoutOmittedChars: numberOrUndefined(record.stdoutOmittedChars),
      stderrOmittedChars: numberOrUndefined(record.stderrOmittedChars),
      outputSummary: stdout === undefined ? undefined : summarizeCommandOutput(stdout),
      errorSummary: stderr === undefined ? undefined : summarizeCommandOutput(stderr),
    };
  }
  return normalizeToolDisplayForOperation({
    toolName: request.toolName,
    input: request.input,
    output,
    truncated: record.truncated === true,
  });
}

function isContentReadTool(toolName: string): boolean {
  return toolName === "read_file" ||
    toolName === "read_context_attachment_text" ||
    toolName === "read_context_attachment_pdf_text" ||
    toolName === "read_skill_resource" ||
    toolName === "read_sub_agent_output";
}

function batchReadDisplayItem(value: unknown): string | undefined {
  const item = asRecord(value);
  const ref = stringOrUndefined(item.ref);
  const status = stringOrUndefined(item.researchStatus);
  const title = stringOrUndefined(item.title);
  const error = stringOrUndefined(item.error);
  const headline = title ?? ref;
  if (headline === undefined && status === undefined) {
    return undefined;
  }
  return [status, headline, error].filter(isString).join(" · ");
}

export function projectSearchDisplayItem(value: unknown): Extract<ToolDisplayProjection, { readonly kind: "search_results" }>["results"][number] | undefined {
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
