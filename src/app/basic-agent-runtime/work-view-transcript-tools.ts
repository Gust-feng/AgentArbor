import type {
  RunEvent,
  TranscriptNodePhase,
} from "../../domain/basic-agent/index.js";
import { cleanOrdinaryToolText } from "../ordinary-tool-copy.js";

export function transcriptToolSummaryFromRunEvent(event: RunEvent): string | undefined {
  const errorFacts = event.detail?.errorFacts === undefined
    ? undefined
    : `errorFacts: ${JSON.stringify(event.detail.errorFacts)}`;
  return [
    cleanOrdinaryToolText(event.detail?.preview),
    event.type === "tool.failed" ? cleanOrdinaryToolText(event.detail?.error) : undefined,
    errorFacts,
    cleanOrdinaryToolText(event.summary),
  ].filter(isString)[0];
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
  const toolName = eventToolName(event)?.trim().toLowerCase() ?? "";
  const fileMutationTitle = fileMutationTitleSet(toolName);
  if (toolName === "shell_command" || toolName.includes("terminal") || toolName.includes("powershell") || toolName.includes("cmd")) {
    return { action: "执行 Shell", completed: "Shell 完成", failed: "Shell 未完成" };
  }
  if (toolName === "search" || toolName === "web_search") {
    return { action: "搜索资料", completed: "资料搜索完成", failed: "资料搜索未完成" };
  }
  if (fileMutationTitle !== undefined) {
    return fileMutationTitle;
  }
  if (toolName === "browser_snapshot" || toolName.includes("browser")) {
    return { action: "读取网页", completed: "网页读取完成", failed: "网页读取未完成" };
  }
  if (toolName === "http_request") {
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
  const action = event.detail?.action ?? event.title;
  return { action, completed: `${action}完成`, failed: `${action}未完成` };
}

function fileMutationTitleSet(
  toolName: string,
): { readonly action: string; readonly completed: string; readonly failed: string } | undefined {
  if (toolName === "delete_file" || toolName.includes("delete_file") || toolName.includes("remove_file")) {
    return { action: "删除文件", completed: "删除完成", failed: "删除未完成" };
  }
  if (toolName === "create_file" || toolName.includes("create_file")) {
    return { action: "创建文件", completed: "创建完成", failed: "创建未完成" };
  }
  if (
    toolName === "edit_file" ||
    toolName.includes("edit_file") ||
    toolName.includes("patch") ||
    toolName.includes("replace")
  ) {
    return { action: "编辑文件", completed: "编辑完成", failed: "编辑未完成" };
  }
  if (toolName === "write_file" || toolName.includes("write_file")) {
    return { action: "写入文件", completed: "写入完成", failed: "写入未完成" };
  }
  return undefined;
}

function eventToolName(event: RunEvent): string | undefined {
  const candidate = (event as RunEvent & { readonly toolName?: unknown }).toolName;
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : undefined;
}

function isString(value: string | undefined): value is string {
  return value !== undefined;
}
