import type { ToolDisplayProjection } from "../../domain/observation/index.js";
import type { ToolCallRequest } from "../../domain/tools/index.js";
import { toolDisplayName } from "../../domain/tools/index.js";
import { commandProgramFromToolResult, commandTextFromToolResult } from "./command-text.js";
import { normalizeToolDisplayForOperation } from "./tool-display-normalization.js";
import {
  asRecord,
  isMcpToolName,
  isString,
  numberOrUndefined,
  readErrorMessageFromOutput,
  searchMessageFromOutput,
  stringArray,
  stringOrUndefined,
} from "./tool-result-facts.js";
const SEARCH_DISPLAY_RESULTS_LIMIT = 20;

export function projectToolDisplay(request: ToolCallRequest, output: unknown): ToolDisplayProjection {
  const record = asRecord(output);
  const input = asRecord(request.input);
  if (request.toolName === "search") {
    const results = (Array.isArray(record.results) ? record.results : [])
      .slice(0, SEARCH_DISPLAY_RESULTS_LIMIT)
      .map(projectSearchDisplayItem)
      .filter((item): item is NonNullable<ReturnType<typeof projectSearchDisplayItem>> => item !== undefined);
    return {
      kind: "search_results",
      query: stringOrUndefined(record.query) ?? stringOrUndefined(input.query),
      message: stringOrUndefined(searchMessageFromOutput(record)),
      results,
    };
  }
  if (request.toolName === "read" && Array.isArray(record.items)) {
    return {
      kind: "generic_tool_summary",
      action: toolDisplayName(request.toolName),
      summary: `${record.items.length} 个来源`,
      items: record.items.slice(0, 8).map(batchReadDisplayItem).filter(isString),
    };
  }
  if (request.toolName === "read") {
    const error = readErrorMessageFromOutput(record);
    const uri = stringOrUndefined(record.uri) ?? stringOrUndefined(input.uri) ?? stringOrUndefined(input.ref);
    const url = httpUrl(uri);
    return {
      kind: "read_result",
      title: stringOrUndefined(record.title) ?? stringOrUndefined(input.title),
      url,
      uri,
      contentPreview: url === undefined ? stringOrUndefined(record.contentPreview) : undefined,
      error,
    };
  }
  if (isContentReadTool(request.toolName)) {
    const uri = stringOrUndefined(record.uri) ?? stringOrUndefined(input.uri) ?? stringOrUndefined(input.ref);
    const url = stringOrUndefined(record.url) ?? stringOrUndefined(input.url) ?? httpUrl(uri);
    return {
      kind: "read_result",
      title: stringOrUndefined(record.title) ?? stringOrUndefined(record.path) ??
        stringOrUndefined(input.title) ?? stringOrUndefined(input.path),
      url,
      uri,
      contentPreview: url === undefined
        ? stringOrUndefined(record.content) ?? stringOrUndefined(record.text)
        : undefined,
    };
  }
  if (request.toolName === "browser_snapshot") {
    return {
      kind: "browser_snapshot",
      title: stringOrUndefined(record.title) ?? stringOrUndefined(input.title),
      url: stringOrUndefined(record.url) ?? stringOrUndefined(input.url),
    };
  }
  if (request.toolName === "http_request") {
    return {
      kind: "http_response",
      method: stringOrUndefined(record.method) ?? stringOrUndefined(input.method),
      url: stringOrUndefined(record.url) ?? stringOrUndefined(input.url),
      statusCode: numberOrUndefined(record.statusCode),
      statusText: stringOrUndefined(record.statusText),
      bodyPreview: stringOrUndefined(record.body),
    };
  }
  if (isAgentTaskTool(request.toolName)) {
    return {
      kind: "agent_task",
      agentName: stringOrUndefined(input.sub_agent_name) ?? stringOrUndefined(input.role),
      task: stringOrUndefined(input.task),
      result: stringOrUndefined(output),
    };
  }
  if (isMcpToolName(request.toolName)) {
    return normalizeToolDisplayForOperation({
      toolName: request.toolName,
      input: request.input,
      output,
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
      exitCode: numberOrUndefined(record.exitCode),
      timedOut: record.timedOut === true,
      stdoutPreview: stdout,
      stderrPreview: stderr,
    };
  }
  return normalizeToolDisplayForOperation({
    toolName: request.toolName,
    input: request.input,
    output,
  });
}

function httpUrl(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function isContentReadTool(toolName: string): boolean {
  return toolName === "read_file" ||
    toolName === "read_context_attachment_text" ||
    toolName === "read_context_attachment_pdf_text" ||
    toolName === "read_skill_resource";
}

function isAgentTaskTool(toolName: string): boolean {
  return toolName === "call_sub_agent" || toolName === "spawn_sub_agent";
}

function batchReadDisplayItem(value: unknown): string | undefined {
  const item = asRecord(value);
  const ref = stringOrUndefined(item.ref);
  const title = stringOrUndefined(item.title);
  const error = stringOrUndefined(item.error);
  const headline = title ?? ref;
  if (headline === undefined) {
    return error;
  }
  return error === undefined ? headline : `${headline} · ${error}`;
}

export function projectSearchDisplayItem(value: unknown): Extract<ToolDisplayProjection, { readonly kind: "search_results" }>["results"][number] | undefined {
  const item = asRecord(value);
  const title = stringOrUndefined(item.title);
  if (title === undefined) {
    return undefined;
  }
  return {
    title,
    url: stringOrUndefined(item.url) ?? stringOrUndefined(item.uri),
    source: stringOrUndefined(item.source),
  };
}
