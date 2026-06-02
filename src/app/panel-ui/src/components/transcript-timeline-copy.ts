import { compact } from "../text";
import type { TranscriptNode } from "../contracts/run";
import { cleanConfirmationSummary, confirmationActionPreview, confirmationDisplayTitle } from "./transcript-confirmation";
import { isFileReadNode, normalizedToolName } from "./transcript-node-visibility";
import { commandText, genericItemLabel } from "./transcript-tool-format";
import { isCommandTool } from "./transcript-timeline-classification";

export function timelineNarration(node: TranscriptNode): string {
  if (node.kind === "thinking") {
    return (node.text ?? node.summary ?? "").trim();
  }
  if (node.kind === "user_decision") {
    return node.summary ?? (node.phase === "denied" ? "用户拒绝了这一步操作。" : node.phase === "guidance" ? "用户补充了新的要求。" : "用户确认继续执行。");
  }
  if (node.kind === "system") {
    return node.summary ?? node.title;
  }
  return node.summary ?? node.title;
}

export function timelineRowPrimary(node: TranscriptNode): string {
  if (node.kind === "confirmation") {
    return confirmationDisplayTitle(node.confirmation, node.summary ?? "");
  }
  if (node.kind === "thinking") {
    return compact((node.text ?? node.summary ?? "").trim(), 180);
  }
  if (node.kind === "user_decision") {
    return node.phase === "denied" ? "你已拒绝" : node.phase === "guidance" ? "你补充了要求" : "你已确认";
  }
  if (node.kind === "system") {
    if (node.phase === "failed" || node.phase === "blocked") return "任务未完成";
    if (node.phase === "cancelled") return "任务已取消";
    return node.title;
  }
  if (node.kind !== "tool") return nodeTitle(node);
  return timelineToolVerb(node);
}

export function timelineRowSecondary(node: TranscriptNode): string | undefined {
  if (node.kind === "confirmation") {
    const action = cleanConfirmationSummary(node.summary ?? node.confirmation?.actionSummary ?? "");
    return action.length === 0 ? undefined : compact(confirmationActionPreview(action), 140) || undefined;
  }
  if (node.kind === "thinking") {
    return undefined;
  }
  if (node.kind === "user_decision" || node.kind === "system") {
    return compact(node.summary ?? "", 160) || undefined;
  }
  return undefined;
}

export function timelineRowMeta(node: TranscriptNode): string | undefined {
  if (node.kind === "confirmation") return undefined;
  if (node.kind !== "tool") return undefined;
  const display = node.display;
  if (display?.kind === "command_summary" && display.exitCode !== undefined && display.exitCode !== 0) {
    return `exit ${display.exitCode}`;
  }
  return undefined;
}

export function timelineToolVerb(node: TranscriptNode): string {
  const display = node.display;
  const toolName = normalizedToolName(node.toolName);
  const action = display?.kind === "generic_tool_summary" ? display.action?.toLowerCase() ?? "" : "";
  if (isCommandTool(node)) return "运行命令";
  if (display?.kind === "search_results" || toolName === "search" || toolName === "web_search" || toolName.includes("grep")) return "搜索资料";
  if (display?.kind === "browser_snapshot" || toolName === "browser_snapshot" || toolName.includes("browser")) return "读取网页";
  if (display?.kind === "file_diff_preview" || toolName === "edit_file" || toolName.includes("patch") || toolName.includes("replace")) return "编辑文件";
  if (display?.kind === "file_change_summary") {
    if (toolName === "create_file" || toolName.includes("create")) return "创建文件";
    if (toolName === "delete_file" || toolName.includes("delete") || toolName.includes("remove")) return "删除文件";
    return "写入文件";
  }
  if (toolName === "list_dir" || toolName === "list_files" || toolName.includes("list") || toolName.includes("dir")) return "浏览目录";
  if (toolName === "read" || toolName === "read_file" || toolName.startsWith("read_") || toolName.includes("file")) return "读取文件";
  if (toolName.includes("generate") || action.includes("生成")) return "生成内容";
  return sentenceCaseLabel(display?.kind === "generic_tool_summary" ? display.action ?? node.title : node.title);
}

export function timelineToolTarget(node: TranscriptNode): string | undefined {
  const display = node.display;
  if (display?.kind === "command_summary") {
    return compact(commandText(display) ?? node.summary ?? "", 180) || undefined;
  }
  if (display?.kind === "search_results") {
    return compact(display.query ?? node.summary ?? "", 180) || undefined;
  }
  if (display?.kind === "browser_snapshot") {
    return compact(display.title ?? display.url ?? node.summary ?? "", 180) || undefined;
  }
  if (display?.kind === "file_change_summary" || display?.kind === "file_diff_preview") {
    return compact(display.path ?? node.summary ?? "", 180) || undefined;
  }
  if (display?.kind === "generic_tool_summary") {
    const items = display.items?.map(genericItemLabel).filter((value) => value.length > 0) ?? [];
    if (items.length === 1) return compact(items[0], 180) || undefined;
    if (items.length > 1) return isFileReadNode(node) ? `${items.length} 个文件` : `${items.length} 项`;
    return compact(display.summary ?? node.summary ?? "", 180) || undefined;
  }
  return compact(node.summary ?? "", 180) || undefined;
}

export function nodeTitle(node: TranscriptNode): string {
  if (node.kind === "thinking") return "思考";
  if (node.kind === "confirmation") return "待确认";
  if (node.kind === "user_decision") return node.phase === "denied" ? "已拒绝" : node.phase === "guidance" ? "补充要求" : "已确认";
  if (node.kind === "tool") return toolNodeTitle(node);
  if (node.kind === "system") return node.title;
  return node.title;
}

export function toolActionLabel(node: TranscriptNode): string {
  const display = node.display;
  const toolName = normalizedToolName(node.toolName);
  if (display?.kind === "command_summary" || toolName === "run_command") return "运行命令";
  if (toolName === "shell_command" || toolName.includes("terminal") || toolName.includes("powershell") || toolName.includes("cmd")) return "执行 Shell";
  if (display?.kind === "search_results" || toolName === "search" || toolName === "web_search") return "搜索资料";
  if (display?.kind === "browser_snapshot" || toolName === "browser_snapshot" || toolName.includes("browser")) return "读取网页";
  if (display?.kind === "file_diff_preview" || toolName === "edit_file" || toolName.includes("patch") || toolName.includes("replace")) return "编辑文件";
  if (display?.kind === "file_change_summary") {
    if (toolName === "create_file" || toolName.includes("create")) return "创建文件";
    if (toolName === "delete_file" || toolName.includes("delete") || toolName.includes("remove")) return "删除文件";
    return "写入文件";
  }
  if (toolName === "list_dir" || toolName === "list_files" || toolName.includes("list") || toolName.includes("dir")) return "浏览目录";
  if (toolName === "grep_files" || toolName.includes("grep")) return "搜索文件";
  if (toolName === "read") return "读取资料";
  if (toolName === "read_file" || toolName.startsWith("read_") || toolName.includes("file")) return "读取文件";
  if (toolName.includes("generate")) return "生成内容";
  if (display?.kind === "generic_tool_summary" && display.action !== undefined) return display.action;
  return node.title || "使用工具";
}

function toolNodeTitle(node: TranscriptNode): string {
  const display = node.display;
  const action = toolActionLabel(node);
  if (node.phase === "preparing") return `准备${action}`;
  if (node.phase === "executing") return action;
  if (node.phase === "failed") return `${action}未完成`;
  if (display?.kind === "command_summary") return action;
  if (display?.kind === "search_results") return "搜索资料";
  if (display?.kind === "browser_snapshot") return "读取网页";
  if (display?.kind === "file_change_summary" || display?.kind === "file_diff_preview") return action;
  if (isFileReadNode(node)) return "读取文件";
  return action;
}

function sentenceCaseLabel(value: string | undefined): string {
  const normalized = (value ?? "").replace(/[_-]+/g, " ").trim();
  if (normalized.length === 0) return "Tool";
  if (!/[A-Za-z]/.test(normalized)) return normalized;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
