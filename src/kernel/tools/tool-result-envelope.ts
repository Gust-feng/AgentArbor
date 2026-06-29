import type {
  ToolCallRequest,
  ToolDisplayProjection,
  ToolErrorDomain,
  ToolErrorFacts,
  ToolResultEnvelope,
} from "../../domain/tools/index.js";
import { toolDisplayName } from "../../domain/tools/index.js";

const UI_SEARCH_RESULTS_LIMIT = 20;
const UI_DIRECTORY_ENTRIES_LIMIT = 80;
const UI_FILE_SEARCH_MATCHES_LIMIT = 80;
const UI_SKIPPED_SAMPLES_LIMIT = 8;

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
  readonly errorDomain?: ToolErrorDomain;
  readonly errorFacts?: ToolErrorFacts;
};

// The envelope is the compact UI/context evidence form of tool output. It is
// deliberately separate from ToolSafeProjection.agentContent, which carries the
// fuller model-visible result when the agent needs to continue working.
export function projectToolResultEnvelope(input: ProjectToolResultEnvelopeInput): ToolResultEnvelope {
  const display = compactToolDisplayForUi(input.display);
  const agentSummary = agentSummaryForToolDisplay(display, input.summary, input.request.toolName);
  const evidenceRefs = evidenceRefsForToolDisplay(display, input.request.callId, input.diagnosticRef);
  const errorFacts = errorFactsForToolDisplay(display);
  return {
    agentSummary,
    evidenceRefs,
    uiDisplay: display,
    tokenEstimate: estimateTokens(agentSummary),
    truncated: input.truncated || displayIsTruncated(input.display),
    redacted: false,
    diagnosticRef: input.diagnosticRef,
    rawRetention: "none",
    errorFacts,
  };
}

export function projectToolStatusEnvelope(input: ProjectToolStatusEnvelopeInput): ToolResultEnvelope {
  const agentSummary = compactOrdinaryToolText(input.summary, 1_200);
  const errorDomain = input.errorDomain ?? defaultToolStatusErrorDomain(input.request.toolName, input.status);
  return {
    agentSummary,
    evidenceRefs: unique([`tool:${input.request.callId}`, input.diagnosticRef, ...(input.evidenceRefs ?? [])]),
    tokenEstimate: estimateTokens(agentSummary),
    truncated: false,
    redacted: false,
    diagnosticRef: input.diagnosticRef,
    rawRetention: "none",
    errorDomain,
    errorFacts: input.errorFacts,
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
      .slice(0, Math.min(8, UI_SEARCH_RESULTS_LIMIT))
      .map((result, index) => {
        const snippet = compactSafeText(result.snippet, 220);
        const url = compactSafeText(result.url, 180);
        return `${index + 1}. ${result.title}${url === undefined ? "" : ` (${url})`}${snippet === undefined ? "" : ` - ${snippet}`}`;
      })
      .join("\n");
    return compactOrdinaryToolText(
      [`${label}已完成${display.query === undefined ? "" : `：${display.query}`}。`, display.message, results || fallback]
        .filter(isString)
        .filter((item) => item.trim().length > 0)
        .join("\n"),
      1_800
    );
  }
  if (display.kind === "directory_listing") {
    const entries = display.entries
      .slice(0, Math.min(24, UI_DIRECTORY_ENTRIES_LIMIT))
      .map((entry) => {
        const meta = [
          entry.kind,
          entry.bytes === undefined ? undefined : `${entry.bytes} bytes`,
        ].filter(isString).join(", ");
        return `${entry.path}${meta.length === 0 ? "" : ` (${meta})`}`;
      })
      .join("\n");
    return compactOrdinaryToolText(
      [
        `${label}已完成${display.path === undefined ? "" : `：${display.path}`}。`,
        display.totalEntries === undefined ? undefined : `总数：${display.totalEntries}`,
        display.unreadableDirectories === undefined ? undefined : `不可读目录：${display.unreadableDirectories}`,
        entries || fallback,
      ].filter(isString).join("\n"),
      1_800
    );
  }
  if (display.kind === "file_search_results") {
    const matches = display.matches
      .slice(0, Math.min(24, UI_FILE_SEARCH_MATCHES_LIMIT))
      .map((match) => {
        const location = match.line === undefined ? match.path : `${match.path}:${match.line}`;
        return `${location}${match.preview === undefined ? "" : ` - ${compactSafeText(match.preview, 220) ?? ""}`}`;
      })
      .join("\n");
    return compactOrdinaryToolText(
      [
        `${label}已完成${display.query === undefined ? "" : `：${display.query}`}。`,
        display.path === undefined ? undefined : `目录：${display.path}`,
        display.searchedFiles === undefined ? undefined : `已检索文件：${display.searchedFiles}`,
        display.skippedFiles === undefined ? undefined : `跳过文件：${display.skippedFiles}`,
        matches || fallback,
      ].filter(isString).join("\n"),
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
  if (display.kind === "http_response") {
    const status = display.statusCode === undefined
      ? undefined
      : `${display.statusCode}${display.statusText === undefined ? "" : ` ${display.statusText}`}`;
    return compactOrdinaryToolText(
      [
        `${label}已完成。`,
        [display.method, display.url, status].filter(isString).join(" · "),
        display.durationMs === undefined ? undefined : `耗时：${display.durationMs}ms`,
        compactSafeText(display.bodyPreview, 1_200),
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
        display.error === undefined ? undefined : `错误：${display.error}`,
        display.errorFacts === undefined ? undefined : `错误事实：${compactFactsText(display.errorFacts)}`,
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
        display.logRef === undefined
          ? display.logPath === undefined ? undefined : `日志路径：${display.logPath}`
          : `日志：${display.logRef}`,
        display.stopCommand === undefined ? undefined : `停止命令：${display.stopCommand}`,
        display.durationMs === undefined ? undefined : `耗时：${display.durationMs}ms`,
        display.waitForPort === undefined ? undefined : `等待端口：${display.waitForPort}`,
        display.portReady === undefined ? undefined : `端口状态：${display.portReady ? "就绪" : "未就绪"}`,
        display.stdoutTruncated === true
          ? `stdout：${display.stdoutChars ?? "unknown"} chars，省略 ${display.stdoutOmittedChars ?? "unknown"} chars`
          : undefined,
        display.stderrTruncated === true
          ? `stderr：${display.stderrChars ?? "unknown"} chars，省略 ${display.stderrOmittedChars ?? "unknown"} chars`
          : undefined,
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
  if (display.kind === "directory_listing") {
    for (const entry of display.entries.slice(0, 8)) {
      refs.add(`file:${compactOrdinaryToolText(entry.path, 220)}`);
    }
  }
  if (display.kind === "file_search_results") {
    for (const match of display.matches.slice(0, 8)) {
      refs.add(`file:${compactOrdinaryToolText(match.path, 220)}`);
    }
  }
  if (display.kind === "browser_snapshot" && display.url !== undefined) {
    refs.add(compactOrdinaryToolText(display.url, 220));
  }
  if (display.kind === "http_response" && display.url !== undefined) {
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

function errorFactsForToolDisplay(display: ToolDisplayProjection): ToolErrorFacts | undefined {
  return display.kind === "read_result" ? display.errorFacts : undefined;
}

function compactFactsText(facts: ToolErrorFacts): string | undefined {
  return compactSafeText(JSON.stringify(facts), 800);
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
    const results = display.results.slice(0, UI_SEARCH_RESULTS_LIMIT);
    return {
      kind: "search_results",
      query: compactSafeText(display.query, 240),
      status: compactSafeText(display.status, 120),
      message: compactSafeText(display.message, 500),
      results: results.map((result) => ({
        title: compactOrdinaryToolText(result.title, 180),
        url: compactSafeText(result.url, 260),
        refId: compactSafeText(result.refId, 180),
        source: compactSafeText(result.source, 120),
        snippet: compactSafeText(result.snippet, 320),
      })),
      resultsReturned: display.resultsReturned ?? display.results.length,
      truncated: display.truncated === true || display.results.length > results.length,
    };
  }
  if (display.kind === "directory_listing") {
    const entries = display.entries.slice(0, UI_DIRECTORY_ENTRIES_LIMIT);
    return {
      kind: "directory_listing",
      path: compactSafeText(display.path, 260),
      depth: display.depth,
      entriesReturned: display.entriesReturned,
      totalEntries: display.totalEntries,
      unreadableDirectories: display.unreadableDirectories,
      unreadableSamples: display.unreadableSamples?.slice(0, 6).map((item) => ({
        path: compactSafeText(item.path, 260),
        errorCode: compactSafeText(item.errorCode, 80),
      })),
      entries: entries.map((entry) => ({
        path: compactOrdinaryToolText(entry.path, 260),
        name: compactSafeText(entry.name, 160),
        kind: compactSafeText(entry.kind, 40),
        bytes: entry.bytes,
        depth: entry.depth,
      })),
      truncated: display.truncated === true || display.entries.length > entries.length,
    };
  }
  if (display.kind === "file_search_results") {
    const matches = display.matches.slice(0, UI_FILE_SEARCH_MATCHES_LIMIT);
    return {
      kind: "file_search_results",
      query: compactSafeText(display.query, 240),
      path: compactSafeText(display.path, 260),
      engine: compactSafeText(display.engine, 80),
      searchedFiles: display.searchedFiles,
      skippedFactsAvailable: display.skippedFactsAvailable,
      skippedFiles: display.skippedFiles,
      skippedBinaryFiles: display.skippedBinaryFiles,
      skippedTooLargeFiles: display.skippedTooLargeFiles,
      skippedUnreadableFiles: display.skippedUnreadableFiles,
      skippedDirectories: display.skippedDirectories,
      skippedOtherEntries: display.skippedOtherEntries,
      skippedSamples: display.skippedSamples?.slice(0, UI_SKIPPED_SAMPLES_LIMIT).map((item) => ({
        path: compactSafeText(item.path, 260),
        reason: compactSafeText(item.reason, 160),
        bytes: item.bytes,
        errorCode: compactSafeText(item.errorCode, 80),
      })),
      matches: matches.map((match) => ({
        path: compactOrdinaryToolText(match.path, 260),
        line: match.line,
        preview: compactSafeText(match.preview, 320),
      })),
      matchesReturned: display.matchesReturned ?? display.matches.length,
      truncated: display.truncated === true || display.matches.length > matches.length,
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
      error: compactSafeText(display.error, 500),
      errorFacts: display.errorFacts,
      truncated: display.truncated,
    };
  }
  if (display.kind === "http_response") {
    return {
      kind: "http_response",
      method: compactSafeText(display.method, 20),
      url: compactSafeText(display.url, 260),
      statusCode: display.statusCode,
      statusText: compactSafeText(display.statusText, 120),
      durationMs: display.durationMs,
      bodyPreview: compactSafeText(display.bodyPreview, 1_200),
      truncated: display.truncated,
    };
  }
  if (display.kind === "file_change_summary") {
    return {
      kind: "file_change_summary",
      path: compactSafeText(display.path, 260),
      operation: display.operation,
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
      operation: display.operation,
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
      logRef: compactSafeText(display.logRef, 260),
      logPath: compactSafeText(display.logPath, 260),
      stopCommand: compactSafeText(display.stopCommand, 260),
      durationMs: display.durationMs,
      waitForPort: display.waitForPort,
      portReady: display.portReady,
      stdoutTruncated: display.stdoutTruncated,
      stderrTruncated: display.stderrTruncated,
      stdoutChars: display.stdoutChars,
      stderrChars: display.stderrChars,
      stdoutOmittedChars: display.stdoutOmittedChars,
      stderrOmittedChars: display.stderrOmittedChars,
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

function defaultToolStatusErrorDomain(
  toolName: string,
  status: ProjectToolStatusEnvelopeInput["status"]
): ToolErrorDomain | undefined {
  if (status !== "failed") {
    return undefined;
  }
  return isProcessTool(toolName) ? "process_error" : "tool_error";
}

function isProcessTool(toolName: string): boolean {
  return toolName === "run_command" || toolName === "shell_command";
}
