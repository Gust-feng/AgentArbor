import type {
  ToolCallRequest,
  ToolDisplayProjection,
  ToolResultEnvelope,
} from "../../domain/tools/index.js";
import { toolDisplayName } from "../../domain/tools/index.js";

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

// The envelope is the compact UI/context evidence form of tool output. It is
// deliberately separate from ToolSafeProjection.agentContent, which carries the
// fuller model-visible result when the agent needs to continue working.
export function projectToolResultEnvelope(input: ProjectToolResultEnvelopeInput): ToolResultEnvelope {
  const display = compactToolDisplayForUi(input.display);
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
  const agentSummary = compactOrdinaryToolText(input.summary, 1_200);
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

export function compactOrdinaryToolText(value: string, maxLength = 1_200): string {
  const text = value.trim();
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1))}...`;
}

// Compatibility export for older call sites. It now only compacts text; it
// does not mask tokens, passwords, stdout/stderr, file content, or errors.
export const redactOrdinaryToolText = compactOrdinaryToolText;

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
    return compactOrdinaryToolText(
      [`${label}已完成${display.query === undefined ? "" : `：${display.query}`}。`, results || fallback]
        .filter((item) => item.trim().length > 0)
        .join("\n"),
      1_800
    );
  }
  if (display.kind === "browser_snapshot") {
    return compactOrdinaryToolText(
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
  if (display.kind === "read_result") {
    return compactOrdinaryToolText(
      [
        `${label}已完成。`,
        display.title,
        display.uri ?? display.url,
        display.source === undefined ? undefined : `来源：${display.source}`,
        compactSafeText(display.contentPreview, 1_200),
        summary,
      ].filter(isString).join("\n"),
      1_800
    );
  }
  if (display.kind === "command_summary") {
    return compactOrdinaryToolText(
      [
        `${label}已完成${display.exitCode === undefined ? "" : `，退出码 ${display.exitCode}`}。`,
        display.shell === undefined ? undefined : `Shell：${display.shell}`,
        display.cwd === undefined ? undefined : `目录：${display.cwd}`,
        display.timedOut === true ? "状态：命令超时。" : undefined,
        display.background === true ? "状态：后台运行。" : undefined,
        display.pid === undefined ? undefined : `PID：${display.pid}`,
        display.logPath === undefined ? undefined : `日志：${display.logPath}`,
        display.stopCommand === undefined ? undefined : `停止命令：${display.stopCommand}`,
        display.commandLine ?? display.command,
        display.outputSummary === undefined ? undefined : `输出摘要：\n${display.outputSummary}`,
        display.errorSummary === undefined ? undefined : `错误摘要：\n${display.errorSummary}`,
      ].filter(isString).join("\n"),
      1_500
    );
  }
  if (display.kind === "file_change_summary") {
    return compactOrdinaryToolText(
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
    return compactOrdinaryToolText(
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
  return compactOrdinaryToolText([summary ?? display.summary ?? fallback, items].filter(isString).join("\n"), 1_400);
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
        refs.add(compactOrdinaryToolText(ref, 220));
      }
    }
  }
  if (display.kind === "browser_snapshot" && display.url !== undefined) {
    refs.add(compactOrdinaryToolText(display.url, 220));
  }
  if (display.kind === "read_result") {
    for (const ref of [display.ref, display.sourceSearchRef, display.uri, display.url]) {
      if (ref !== undefined) {
        refs.add(compactOrdinaryToolText(ref, 220));
      }
    }
  }
  if ((display.kind === "file_change_summary" || display.kind === "file_diff_preview") && display.path !== undefined) {
    refs.add(`file:${compactOrdinaryToolText(display.path, 220)}`);
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
  const text = value.trim();
  if (text.length === 0) {
    return undefined;
  }
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1))}...`;
}

function compactToolDisplayForUi(display: ToolDisplayProjection): ToolDisplayProjection {
  if (display.kind === "search_results") {
    return {
      kind: "search_results",
      query: compactSafeText(display.query, 240),
      status: compactSafeText(display.status, 120),
      results: display.results.slice(0, 8).map((result) => ({
        title: compactOrdinaryToolText(result.title, 180),
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
  if (display.kind === "read_result") {
    return {
      kind: "read_result",
      ref: compactSafeText(display.ref, 220),
      source: compactSafeText(display.source, 120),
      status: compactSafeText(display.status, 120),
      title: compactSafeText(display.title, 220),
      url: compactSafeText(display.url, 260),
      uri: compactSafeText(display.uri, 260),
      sourceSearchRef: compactSafeText(display.sourceSearchRef, 220),
      contentPreview: compactSafeText(display.contentPreview, 1_200),
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
      args: display.args?.slice(0, 16).map((arg) => compactOrdinaryToolText(arg, 180)),
      commandLine: compactSafeText(display.commandLine, 420),
      cwd: compactSafeText(display.cwd, 260),
      shell: compactSafeText(display.shell, 120),
      exitCode: display.exitCode,
      timedOut: display.timedOut,
      background: display.background,
      pid: display.pid,
      logPath: compactSafeText(display.logPath, 260),
      stopCommand: compactSafeText(display.stopCommand, 260),
      outputSummary: compactSafeText(display.outputSummary, 520),
      errorSummary: compactSafeText(display.errorSummary, 520),
    };
  }
  return {
    kind: "generic_tool_summary",
    action: compactSafeText(display.action, 160),
    summary: compactSafeText(display.summary, 700),
    items: display.items?.slice(0, 12).map((item) => compactOrdinaryToolText(item, 260)),
  };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
