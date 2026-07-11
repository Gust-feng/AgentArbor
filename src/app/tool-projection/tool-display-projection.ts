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
  const result = asRecord(record.result);
  const action = displayActionForTool(stringOrUndefined(record.action), request.toolName);
  if (request.toolName === "search" && Array.isArray(record.results)) {
    const results = record.results
      .slice(0, SEARCH_DISPLAY_RESULTS_LIMIT)
      .map(projectSearchDisplayItem)
      .filter((item): item is NonNullable<ReturnType<typeof projectSearchDisplayItem>> => item !== undefined);
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

function displayActionForTool(action: string | undefined, toolName: string): string {
  if (action === undefined || action === toolName || /^[a-z][a-z0-9_:-]*$/i.test(action)) {
    return toolDisplayName(action ?? toolName);
  }
  return action;
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
