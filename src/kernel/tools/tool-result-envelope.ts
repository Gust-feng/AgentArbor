import type {
  ToolCallRequest,
  ToolDisplayProjection,
  ToolResultEnvelope,
} from "../../domain/tools/index.js";
import { toolDisplayName } from "../../domain/tools/index.js";
import { redactSensitiveText } from "../redaction.js";

export type ProjectToolResultEnvelopeInput = {
  readonly request: ToolCallRequest;
  readonly display: ToolDisplayProjection;
  readonly summary?: string;
  readonly diagnosticRef: string;
  readonly truncated: boolean;
};

export type ProjectToolStatusEnvelopeInput = {
  readonly request: ToolCallRequest;
  readonly status: "failed" | "approval_required" | "cancelled";
  readonly summary: string;
  readonly diagnosticRef: string;
  readonly evidenceRefs?: readonly string[];
};

// The envelope is the compact cross-boundary form of tool output. Adapters may
// still expose richer agentContent when the model needs details.
export function projectToolResultEnvelope(input: ProjectToolResultEnvelopeInput): ToolResultEnvelope {
  const display = sanitizeToolDisplay(input.display);
  const agentSummary = agentSummaryForToolDisplay(display, input.summary, input.request.toolName);
  const evidenceRefs = evidenceRefsForToolDisplay(display, input.request.callId, input.diagnosticRef);
  return {
    agentSummary,
    evidenceRefs,
    uiDisplay: display,
    tokenEstimate: estimateTokens(agentSummary),
    truncated: input.truncated || displayIsTruncated(input.display),
    redacted: false,
    diagnosticRef: input.diagnosticRef,
    rawRetention: "none",
  };
}

export function projectToolStatusEnvelope(input: ProjectToolStatusEnvelopeInput): ToolResultEnvelope {
  const agentSummary = redactOrdinaryToolText(input.summary, 1_200);
  return {
    agentSummary,
    evidenceRefs: unique([`tool:${input.request.callId}`, input.diagnosticRef, ...(input.evidenceRefs ?? [])]),
    tokenEstimate: estimateTokens(agentSummary),
    truncated: false,
    redacted: false,
    diagnosticRef: input.diagnosticRef,
    rawRetention: "none",
  };
}

export function redactOrdinaryToolText(value: string, maxLength = 1_200): string {
  const text = redactSensitiveText(value).trim();
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1))}...`;
}

function agentSummaryForToolDisplay(
  display: ToolDisplayProjection,
  summary: string | undefined,
  toolName: string
): string {
  const label = toolDisplayName(toolName);
  const fallback = summary ?? `${label}已完成。`;
  if (display.kind === "search_results") {
    const results = display.results
      .slice(0, 5)
      .map((result, index) => {
        const snippet = compactSafeText(result.snippet, 220);
        const url = compactSafeText(result.url, 180);
        return `${index + 1}. ${result.title}${url === undefined ? "" : ` (${url})`}${snippet === undefined ? "" : ` - ${snippet}`}`;
      })
      .join("\n");
    return redactOrdinaryToolText(
      [`${label}已完成${display.query === undefined ? "" : `：${display.query}`}。`, results || fallback]
        .filter((item) => item.trim().length > 0)
        .join("\n"),
      1_800
    );
  }
  if (display.kind === "browser_snapshot") {
    return redactOrdinaryToolText(
      [
        `${label}已完成。`,
        display.title,
        display.url,
        compactSafeText(display.text, 1_200),
        summary,
      ].filter(isString).join("\n"),
      1_800
    );
  }
  if (display.kind === "command_summary") {
    return redactOrdinaryToolText(
      [
        `${label}已完成${display.exitCode === undefined ? "" : `，退出码 ${display.exitCode}`}。`,
        [display.command, ...(display.args ?? [])].filter(isString).join(" "),
        display.outputSummary === undefined ? undefined : `输出摘要：\n${display.outputSummary}`,
        display.errorSummary === undefined ? undefined : `错误摘要：\n${display.errorSummary}`,
      ].filter(isString).join("\n"),
      1_500
    );
  }
  if (display.kind === "file_change_summary") {
    return redactOrdinaryToolText(
      [
        `${label}：${display.path ?? "工作区文件"}。`,
        display.append === true ? "模式：追加。" : undefined,
        display.bytes === undefined ? undefined : `大小：${display.bytes} 字节。`,
        display.preview === undefined ? undefined : `变更片段：\n${display.preview}`,
        summary,
      ].filter(isString).join("\n"),
      1_200
    );
  }
  if (display.kind === "file_diff_preview") {
    return redactOrdinaryToolText(
      [
        `${label}：${display.path ?? "工作区文件"}。`,
        display.replacements === undefined ? undefined : `替换次数：${display.replacements}。`,
        display.previousLength === undefined ? undefined : `修改前长度：${display.previousLength}。`,
        display.nextLength === undefined ? undefined : `修改后长度：${display.nextLength}。`,
        display.preview === undefined ? undefined : `变更片段：\n${display.preview}`,
        summary,
      ].filter(isString).join("\n"),
      1_200
    );
  }
  const items = display.items?.slice(0, 8).join("\n");
  return redactOrdinaryToolText([summary ?? display.summary ?? fallback, items].filter(isString).join("\n"), 1_400);
}

function evidenceRefsForToolDisplay(
  display: ToolDisplayProjection,
  callId: string,
  diagnosticRef: string
): readonly string[] {
  const refs = new Set<string>([`tool:${callId}`, diagnosticRef]);
  if (display.kind === "search_results") {
    for (const result of display.results.slice(0, 8)) {
      const ref = result.refId ?? result.url ?? result.title;
      if (ref !== undefined) {
        refs.add(redactOrdinaryToolText(ref, 220));
      }
    }
  }
  if (display.kind === "browser_snapshot" && display.url !== undefined) {
    refs.add(redactOrdinaryToolText(display.url, 220));
  }
  if ((display.kind === "file_change_summary" || display.kind === "file_diff_preview") && display.path !== undefined) {
    refs.add(`file:${redactOrdinaryToolText(display.path, 220)}`);
  }
  return [...refs].filter((ref) => ref.length > 0).slice(0, 12);
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

function displayIsTruncated(display: ToolDisplayProjection): boolean {
  return "truncated" in display && display.truncated === true;
}

function compactSafeText(value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const text = redactSensitiveText(value).trim();
  if (text.length === 0) {
    return undefined;
  }
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1))}...`;
}

function sanitizeToolDisplay(display: ToolDisplayProjection): ToolDisplayProjection {
  if (display.kind === "search_results") {
    return {
      kind: "search_results",
      query: compactSafeText(display.query, 240),
      status: compactSafeText(display.status, 120),
      results: display.results.slice(0, 8).map((result) => ({
        title: redactOrdinaryToolText(result.title, 180),
        url: compactSafeText(result.url, 260),
        refId: compactSafeText(result.refId, 180),
        source: compactSafeText(result.source, 120),
        snippet: compactSafeText(result.snippet, 320),
      })),
      truncated: display.truncated === true || display.results.length > 8,
    };
  }
  if (display.kind === "browser_snapshot") {
    return {
      kind: "browser_snapshot",
      title: compactSafeText(display.title, 220),
      url: compactSafeText(display.url, 260),
      text: compactSafeText(display.text, 1_200),
      truncated: display.truncated,
    };
  }
  if (display.kind === "file_change_summary") {
    return {
      kind: "file_change_summary",
      path: compactSafeText(display.path, 260),
      bytes: display.bytes,
      append: display.append,
      replacements: display.replacements,
      previousLength: display.previousLength,
      nextLength: display.nextLength,
      preview: compactSafeText(display.preview, 1_800),
      truncated: display.truncated,
    };
  }
  if (display.kind === "file_diff_preview") {
    return {
      kind: "file_diff_preview",
      path: compactSafeText(display.path, 260),
      replacements: display.replacements,
      previousLength: display.previousLength,
      nextLength: display.nextLength,
      preview: compactSafeText(display.preview, 1_800),
      truncated: display.truncated,
    };
  }
  if (display.kind === "command_summary") {
    return {
      kind: "command_summary",
      command: compactSafeText(display.command, 260),
      args: display.args?.slice(0, 16).map((arg) => redactOrdinaryToolText(arg, 180)),
      exitCode: display.exitCode,
      outputSummary: compactSafeText(display.outputSummary, 520),
      errorSummary: compactSafeText(display.errorSummary, 520),
    };
  }
  return {
    kind: "generic_tool_summary",
    action: compactSafeText(display.action, 160),
    summary: compactSafeText(display.summary, 700),
    items: display.items?.slice(0, 12).map((item) => redactOrdinaryToolText(item, 260)),
  };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
