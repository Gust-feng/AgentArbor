import type { TranscriptNode } from "../contracts/run";
import { isModelSideOutputNode, normalizedToolName } from "./transcript-node-visibility";

export type TimelineRowCategory = "thought" | "context" | "web" | "change" | "command" | "approval" | "danger";
export type TimelineNodeTone = "active" | "warning" | "danger" | "done";

export function timelineRowIdentity(node: TranscriptNode): string {
  if (node.kind === "thinking") {
    const modelRefs = node.refs.filter((ref) => ref.kind === "model_call").map((ref) => ref.id).join("|");
    return `${node.runId}:thinking:${modelRefs || node.nodeId}`;
  }
  if (isModelSideOutputNode(node)) {
    const modelRefs = node.refs.filter((ref) => ref.kind === "model_call").map((ref) => ref.id).join("|");
    return `${node.runId}:model-output:${modelRefs || node.nodeId}`;
  }
  return node.nodeId;
}

export function timelineRowUsesEventLayout(node: TranscriptNode): boolean {
  if (isModelSideOutputNode(node)) return true;
  if (isInlineSystemNote(node)) return false;
  return node.kind === "tool" || node.kind === "confirmation" || node.kind === "thinking" || node.kind === "user_decision" || node.kind === "system";
}

export function isInlineSystemNote(node: TranscriptNode): boolean {
  return node.kind === "system" && (node.eventType === "model.side.completed" || node.eventType === "model.output.side");
}

export function timelineRowCategory(node: TranscriptNode): TimelineRowCategory {
  if (nodeTone(node) === "danger") return "danger";
  if (node.kind === "confirmation") return "approval";
  if (node.kind !== "tool") return "thought";
  if (isCommandTool(node)) return "command";
  if (isChangeTool(node)) return "change";
  if (isWebTool(node)) return "web";
  return "context";
}

export function timelineRowCanExpand(node: TranscriptNode): boolean {
  if (node.kind === "confirmation") return true;
  if (node.kind === "thinking") return false;
  if (isInlineSystemNote(node)) return false;
  if (node.kind === "system" || node.kind === "user_decision") return (node.summary?.length ?? 0) > 160;
  if (node.kind !== "tool") return false;
  const display = node.display;
  if (display === undefined) return false;
  if (display.kind === "command_summary") return true;
  if (display.kind === "search_results" || display.kind === "browser_snapshot") return true;
  if (display.kind === "file_change_summary" || display.kind === "file_diff_preview") return true;
  return display.kind === "generic_tool_summary" && (display.items?.length ?? 0) > 0;
}

export function isCommandTool(node: TranscriptNode): boolean {
  const toolName = normalizedToolName(node.toolName);
  return node.kind === "tool" &&
    (node.display?.kind === "command_summary" || toolName === "run_command" || toolName === "shell_command" || toolName.includes("terminal") || toolName.includes("powershell") || toolName.includes("cmd"));
}

export function isChangeTool(node: TranscriptNode): boolean {
  if (node.kind !== "tool") return false;
  const display = node.display;
  const toolName = normalizedToolName(node.toolName);
  const action = display?.kind === "generic_tool_summary" ? display.action?.toLowerCase() ?? "" : "";
  return display?.kind === "file_change_summary" ||
    display?.kind === "file_diff_preview" ||
    toolName === "edit_file" ||
    toolName === "write_file" ||
    toolName === "create_file" ||
    toolName === "delete_file" ||
    toolName.includes("edit") ||
    toolName.includes("write") ||
    toolName.includes("create") ||
    toolName.includes("delete") ||
    toolName.includes("remove") ||
    action.includes("编辑") ||
    action.includes("写入") ||
    action.includes("创建") ||
    action.includes("删除");
}

export function isWebTool(node: TranscriptNode): boolean {
  if (node.kind !== "tool") return false;
  const display = node.display;
  const toolName = normalizedToolName(node.toolName);
  return display?.kind === "search_results" ||
    display?.kind === "browser_snapshot" ||
    toolName === "search" ||
    toolName === "web_search" ||
    toolName === "browser_snapshot" ||
    toolName.includes("browser") ||
    toolName.includes("grep");
}

export function nodeTone(node: TranscriptNode): TimelineNodeTone {
  if (node.phase === "failed" || node.phase === "blocked" || node.phase === "cancelled") return "danger";
  if (node.phase === "waiting_approval") return "warning";
  if (node.phase === "preparing" || node.phase === "executing" || node.phase === "noted") return "active";
  return "done";
}

export function defaultOpenForNode(node: TranscriptNode): boolean {
  if (node.kind === "thinking") return node.phase !== "completed";
  if (node.kind === "confirmation") return true;
  if (node.phase === "waiting_approval") return true;
  if (node.phase === "failed" || node.phase === "blocked" || node.phase === "cancelled") return true;
  if (node.display?.kind === "command_summary" && (node.display.exitCode ?? 0) !== 0) return true;
  return false;
}
