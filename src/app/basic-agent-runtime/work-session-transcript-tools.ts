import type {
  RunEvent,
  TranscriptNodePhase,
} from "../../domain/basic-agent/index.js";
import { commandDisplayText, type ToolDisplayProjection } from "../../domain/tools/index.js";
import { cleanOrdinaryToolText } from "../ordinary-tool-copy.js";

export function transcriptToolSummaryFromRunEvent(event: RunEvent): string | undefined {
  const display = event.detail?.display;
  if (display?.kind === "command_summary") {
    const command = commandDisplayText(display);
    const error = event.type === "tool.failed" ? display.errorSummary : undefined;
    return [command, display.outputSummary, error]
      .filter((value): value is string => value !== undefined && value.trim().length > 0)
      .join(" · ");
  }
  if (display?.kind === "search_results") {
    return [display.query, display.message, `${display.results.length} 条结果`]
      .filter((value): value is string => value !== undefined && value.trim().length > 0)
      .join(" · ");
  }
  if (display?.kind === "read_result") {
    const target = display.title ?? display.uri ?? display.url ?? event.detail?.preview ?? event.summary;
    return [
      target,
      display.error,
      display.errorFacts === undefined ? undefined : `errorFacts: ${JSON.stringify(display.errorFacts)}`,
    ].filter(isString).join(" · ");
  }
  if (display?.kind === "browser_snapshot") {
    return display.title ?? display.url ?? event.detail?.preview ?? event.summary;
  }
  if (display?.kind === "http_response") {
    return [
      display.method,
      display.url,
      display.statusCode === undefined ? undefined : `${display.statusCode}${display.statusText === undefined ? "" : ` ${display.statusText}`}`,
    ].filter(isString).join(" · ") || event.detail?.preview || event.summary;
  }
  if (display?.kind === "file_change_summary" || display?.kind === "file_diff_preview") {
    return fileDisplaySummary(display) ?? cleanOrdinaryToolText(event.detail?.preview) ?? cleanOrdinaryToolText(event.summary);
  }
  if (display?.kind === "generic_tool_summary") {
    const items = display.items?.slice(0, 6).map(cleanOrdinaryToolText).filter(isString) ?? [];
    return cleanOrdinaryToolText(display.summary) ??
      (items.length > 0 ? items.join("\n") : undefined) ??
      cleanOrdinaryToolText(event.detail?.preview) ??
      cleanOrdinaryToolText(event.summary);
  }
  return cleanOrdinaryToolText(event.detail?.preview) ?? cleanOrdinaryToolText(event.summary);
}

export function toolTranscriptTitleFromRunEvent(event: RunEvent, phase: TranscriptNodePhase): string {
  const title = toolTranscriptTitleSetFromRunEvent(event);
  if (phase === "preparing") return `准备${title.action}`;
  if (phase === "executing") return title.action;
  if (phase === "completed") return title.completed;
  if (phase === "failed") return title.failed;
  return title.action;
}

function toolTranscriptTitleSetFromRunEvent(event: RunEvent): {
  readonly action: string;
  readonly completed: string;
  readonly failed: string;
} {
  const display = event.detail?.display;
  const toolName = eventToolName(event)?.trim().toLowerCase() ?? "";
  const fileMutationTitle = fileMutationTitleSet(toolName, display);
  if (display?.kind === "command_summary" || toolName === "run_command") {
    return { action: "运行命令", completed: "命令完成", failed: "命令未完成" };
  }
  if (toolName === "shell_command" || toolName.includes("terminal") || toolName.includes("powershell") || toolName.includes("cmd")) {
    return { action: "执行 Shell", completed: "Shell 完成", failed: "Shell 未完成" };
  }
  if (display?.kind === "search_results" || toolName === "search" || toolName === "web_search") {
    return { action: "搜索资料", completed: "资料搜索完成", failed: "资料搜索未完成" };
  }
  if (fileMutationTitle !== undefined) {
    return fileMutationTitle;
  }
  if (display?.kind === "read_result") {
    return { action: "读取资料", completed: "资料读取完成", failed: "资料读取未完成" };
  }
  if (display?.kind === "browser_snapshot" || toolName === "browser_snapshot" || toolName.includes("browser")) {
    return { action: "读取网页", completed: "网页读取完成", failed: "网页读取未完成" };
  }
  if (display?.kind === "http_response" || toolName === "http_request") {
    return { action: "发送 HTTP 请求", completed: "HTTP 请求完成", failed: "HTTP 请求未完成" };
  }
  if (toolName === "grep_files" || toolName.includes("grep")) {
    return { action: "搜索文件", completed: "搜索完成", failed: "搜索未完成" };
  }
  if (toolName === "list_dir" || toolName === "list_files" || toolName.includes("list") || toolName.includes("dir")) {
    return { action: "浏览目录", completed: "目录浏览完成", failed: "目录浏览未完成" };
  }
  if (toolName === "read") {
    return { action: "读取资料", completed: "资料读取完成", failed: "资料读取未完成" };
  }
  if (toolName === "read_file" || toolName.startsWith("read_") || toolName.includes("file")) {
    return { action: "读取文件", completed: "读取完成", failed: "读取未完成" };
  }
  const action = event.detail?.action ??
    (event.detail?.display?.kind === "generic_tool_summary" ? event.detail.display.action : undefined) ??
    event.title;
  return { action, completed: `${action}完成`, failed: `${action}未完成` };
}

function fileMutationTitleSet(
  toolName: string,
  display: ToolDisplayProjection | undefined,
): { readonly action: string; readonly completed: string; readonly failed: string } | undefined {
  const genericText = display?.kind === "generic_tool_summary"
    ? [display.action, display.summary].filter((value): value is string => value !== undefined).join(" ").toLowerCase()
    : "";
  if (toolName === "delete_file" || toolName.includes("delete_file") || toolName.includes("remove_file") || mentionsDeleteFile(genericText)) {
    return { action: "删除文件", completed: "删除完成", failed: "删除未完成" };
  }
  if (toolName === "create_file" || toolName.includes("create_file") || mentionsCreateFile(genericText)) {
    return { action: "创建文件", completed: "创建完成", failed: "创建未完成" };
  }
  if (
    display?.kind === "file_diff_preview" ||
    toolName === "edit_file" ||
    toolName.includes("edit_file") ||
    toolName.includes("patch") ||
    toolName.includes("replace") ||
    mentionsEditFile(genericText)
  ) {
    return { action: "编辑文件", completed: "编辑完成", failed: "编辑未完成" };
  }
  if (display?.kind === "file_change_summary" || toolName === "write_file" || toolName.includes("write_file") || mentionsWriteFile(genericText)) {
    return { action: "写入文件", completed: "写入完成", failed: "写入未完成" };
  }
  return undefined;
}

function mentionsWriteFile(value: string): boolean {
  return value.includes("写入文件") || value.includes("write_file") || value.includes("write file") || value.includes("written");
}

function mentionsCreateFile(value: string): boolean {
  return value.includes("创建文件") || value.includes("create_file") || value.includes("create file") || value.includes("created");
}

function mentionsDeleteFile(value: string): boolean {
  return value.includes("删除文件") || value.includes("delete_file") || value.includes("delete file") || value.includes("deleted");
}

function mentionsEditFile(value: string): boolean {
  return value.includes("编辑文件") || value.includes("修改文件") || value.includes("edit_file") || value.includes("edit file");
}

function eventToolName(event: RunEvent): string | undefined {
  const candidate = (event as RunEvent & { readonly toolName?: unknown }).toolName;
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : undefined;
}

function fileDisplaySummary(display: Extract<ToolDisplayProjection, { readonly kind: "file_change_summary" | "file_diff_preview" }>): string | undefined {
  const changes =
    display.kind === "file_diff_preview"
      ? [
          display.replacements === undefined ? undefined : `${display.replacements} 处修改`,
        ]
      : [
          display.append === true ? "追加写入" : undefined,
        ];
  return [display.path, ...changes]
    .filter((value): value is string => value !== undefined && value.trim().length > 0)
    .join(" · ") || undefined;
}

function isString(value: string | undefined): value is string {
  return value !== undefined;
}
