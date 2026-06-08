import type { ToolDisplayProjection, ToolResultEnvelope } from "../domain/tools/index.js";
import { toolDisplayName } from "../domain/tools/index.js";
import { redactSensitiveText } from "../kernel/redaction.js";
import { asRecord, stringArray, stringOrUndefined } from "./panel-read-model-utils.js";
import { safeCommandToolPreview, safeReadFileToolPreview } from "./safe-tool-preview.js";
import { cleanOrdinaryToolText } from "./ordinary-tool-copy.js";

export type PanelRunStreamEventDetail = {
  readonly kind: "thinking" | "tool" | "confirmation" | "work";
  readonly action?: string;
  readonly path?: string;
  readonly query?: string;
  readonly command?: string;
  readonly exitCode?: number;
  readonly preview?: string;
  readonly display?: ToolDisplayProjection;
  readonly envelope?: ToolResultEnvelope;
  readonly truncated?: boolean;
  readonly error?: string;
};

export function toolSummary(
  type: "tool.requested" | "tool.completed" | "tool.failed",
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
  return `${displayName}未完成${targetText}。`;
}

export function toolStreamDetail(
  type: "tool.requested" | "tool.completed" | "tool.failed",
  payload: Readonly<Record<string, unknown>>
): PanelRunStreamEventDetail {
  const toolName = stringOrUndefined(payload.toolName) ?? "tool";
  const input = asRecord(payload.input);
  const output = asRecord(payload.output);
  const result = asRecord(output.result);
  const display = toolDisplayOrUndefined(output.display);
  const envelope = toolResultEnvelopeOrUndefined(output.envelope);
  const command = stringOrUndefined(result.command) ?? stringOrUndefined(input.command);
  const args = stringArray(result.args).length > 0 ? stringArray(result.args) : stringArray(input.args);
  return {
    kind: "tool",
    action: displayActionLabel(stringOrUndefined(output.action) ?? localToolLabel(toolName)),
    path: stringOrUndefined(result.path) ?? stringOrUndefined(input.path),
    query: stringOrUndefined(result.query) ?? stringOrUndefined(input.query),
    command: command === undefined ? undefined : [command, ...args].join(" ").trim(),
    exitCode: typeof result.exitCode === "number" ? result.exitCode : undefined,
    preview: type === "tool.requested" ? toolRequestPreview(toolName, input) : toolResultPreview(toolName, output, result, payload),
    display,
    envelope,
    truncated: output.truncated === true,
    error: type === "tool.failed" ? stringOrUndefined(payload.error) : undefined,
  };
}

function toolDisplayOrUndefined(value: unknown): ToolDisplayProjection | undefined {
  const record = asRecord(value);
  const kind = stringOrUndefined(record.kind);
  if (
    kind === "search_results" ||
    kind === "browser_snapshot" ||
    kind === "file_change_summary" ||
    kind === "file_diff_preview" ||
    kind === "command_summary" ||
    kind === "generic_tool_summary"
  ) {
    return normalizeToolDisplayForReadModel(value as ToolDisplayProjection);
  }
  return undefined;
}

function normalizeToolDisplayForReadModel(display: ToolDisplayProjection): ToolDisplayProjection {
  if (display.kind !== "generic_tool_summary") {
    return display;
  }
  const action = display.action;
  return {
    ...display,
    action: action === undefined ? undefined : displayActionLabel(action),
  };
}

function displayActionLabel(value: string): string {
  return /^[a-z][a-z0-9_:-]*$/i.test(value) ? toolDisplayName(value) : value;
}

function toolResultEnvelopeOrUndefined(value: unknown): ToolResultEnvelope | undefined {
  const record = asRecord(value);
  const agentSummary = stringOrUndefined(record.agentSummary);
  const rawRetention = stringOrUndefined(record.rawRetention);
  if (agentSummary === undefined || (rawRetention !== "none" && rawRetention !== "diagnostic_ref_only")) {
    return undefined;
  }
  return {
    agentSummary: redactAndCompact(agentSummary, 1_800),
    evidenceRefs: stringArray(record.evidenceRefs).map((ref) => redactAndCompact(ref, 220)).slice(0, 12),
    uiDisplay: toolDisplayOrUndefined(record.uiDisplay),
    tokenEstimate: typeof record.tokenEstimate === "number" && Number.isFinite(record.tokenEstimate)
      ? Math.max(1, Math.floor(record.tokenEstimate))
      : Math.max(1, Math.ceil(agentSummary.length / 4)),
    truncated: record.truncated === true,
    redacted: record.redacted !== false,
    diagnosticRef: stringOrUndefined(record.diagnosticRef),
    rawRetention,
  };
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
    const command = stringOrUndefined(input.command);
    const args = stringArray(input.args);
    return command === undefined ? undefined : [command, ...args].join(" ").trim();
  }
  if (toolName === "browser_snapshot") {
    const url = stringOrUndefined(input.url);
    return url;
  }
  return undefined;
}

function safeFileChangePreview(
  toolName: string,
  input: Readonly<Record<string, unknown>>,
  output: Readonly<Record<string, unknown>>,
  result: Readonly<Record<string, unknown>>
): string | undefined {
  const path = stringOrUndefined(result.path) ?? stringOrUndefined(input.path);
  const summary = cleanOrdinaryToolText(stringOrUndefined(output.summary));
  if (toolName === "edit_file") {
    const replacements = typeof result.replacements === "number" ? `替换：${result.replacements} 处` : undefined;
    const diffPreview = ["变更预览", replacements]
      .filter((item): item is string => item !== undefined && item.length > 0)
      .join("\n");
    return [summary, path === undefined ? undefined : `文件：${path}`, diffPreview].filter((item): item is string => item !== undefined && item.length > 0).join("\n");
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
  if (toolName === "write_file" || toolName === "create_file" || toolName === "edit_file" || toolName === "delete_file") {
    return safeFileChangePreview(toolName, asRecord(payload.input), output, result);
  }
  if (toolName === "run_command" || toolName === "shell_command") {
    return safeCommandPreview(output, result);
  }
  if (toolName === "browser_snapshot") {
    const title = stringOrUndefined(result.title);
    const url = stringOrUndefined(result.url);
    const text = stringOrUndefined(result.text);
    const headline = [title, url].filter((item): item is string => item !== undefined).join(" · ");
    return compactStreamDetailText([headline, text].filter((item) => item !== undefined && item.length > 0).join("\n"), 900);
  }
  return compactStreamDetailText(stringOrUndefined(output.summary), 900);
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
  result: Readonly<Record<string, unknown>>
): string | undefined {
  return safeCommandToolPreview({
    summary: stringOrUndefined(output.summary),
    command: stringOrUndefined(result.command),
    exitCode: typeof result.exitCode === "number" ? result.exitCode : undefined,
  });
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

function redactAndCompact(value: string, maxLength: number): string {
  const redacted = redactSensitiveText(value).replace(/\s+/g, " ").trim();
  return redacted.length <= maxLength ? redacted : `${redacted.slice(0, Math.max(0, maxLength - 1))}…`;
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
    const command = stringOrUndefined(result.command) ?? stringOrUndefined(input.command);
    const args = stringArray(result.args).length > 0 ? stringArray(result.args) : stringArray(input.args);
    return command === undefined ? undefined : [command, ...args].join(" ").trim();
  }
  return undefined;
}
