import type { ObservationRef } from "../contracts/common";
import type { TranscriptNode } from "../contracts/run";
import { userVisibleAnswer } from "./chat-visible-text";
import { genericItemLabel } from "./transcript-tool-format";

export function visibleTranscriptNodes(nodes: readonly TranscriptNode[]): readonly TranscriptNode[] {
  const sorted = [...nodes]
    .filter((node) => node.kind !== "answer")
    .filter((node) => !isLowValueNode(node))
    .sort(compareNodeOrder);
  const terminalToolCallIds = new Set(
    sorted
      .filter((node) => node.eventType === "tool.completed" || node.eventType === "tool.failed")
      .flatMap(toolCallIdsForNode)
  );
  const source = sorted.filter((node) => {
    if (node.eventType !== "tool.requested" || node.phase === "preparing") return true;
    const ids = toolCallIdsForNode(node);
    return ids.length === 0 || !ids.some((id) => terminalToolCallIds.has(id));
  });
  const result: TranscriptNode[] = [];
  for (const node of source) {
    const previous = result.at(-1);
    if (previous !== undefined && canAggregateFileRead(previous, node)) {
      result[result.length - 1] = aggregateFileReadNodes(previous, node);
      continue;
    }
    if (isBoringSuccessfulToolResult(node)) {
      continue;
    }
    result.push(node);
  }
  return result;
}

export function timelineVisibleNodes(nodes: readonly TranscriptNode[]): readonly TranscriptNode[] {
  const sorted = [...nodes]
    .filter((node) => node.kind !== "answer")
    .filter((node) => !isLowValueNode(node))
    .sort(compareNodeOrder);
  const hasWorkActivity = sorted.some((node) => node.kind !== "thinking");
  const terminalToolCallIds = new Set(
    sorted
      .filter((node) => node.eventType === "tool.completed" || node.eventType === "tool.failed")
      .flatMap(toolCallIdsForNode)
  );
  return sorted.filter((node) => {
    if (node.kind === "thinking") {
      const text = (node.summary ?? node.text ?? "").trim();
      if (text.length === 0) return false;
      if (node.eventType === "model.reasoning.delta" || node.eventType === "model.reasoning.completed") return true;
      return hasWorkActivity || node.phase !== "completed";
    }
    if (isModelSideOutputNode(node)) {
      return (node.text ?? node.summary ?? "").trim().length > 0;
    }
    if (node.eventType !== "tool.requested" || node.phase === "preparing") return true;
    const ids = toolCallIdsForNode(node);
    return ids.length === 0 || !ids.some((id) => terminalToolCallIds.has(id));
  });
}

export function nodesForRun(nodes: readonly TranscriptNode[], runId: string | undefined): readonly TranscriptNode[] {
  if (runId === undefined) return [];
  return nodes.filter((node) => node.runId === runId);
}

export function isModelSideOutputNode(node: TranscriptNode): boolean {
  return node.kind === "system" && (node.eventType === "model.side.completed" || node.eventType === "model.output.side");
}

export function isFileReadNode(node: TranscriptNode): boolean {
  if (node.kind !== "tool") return false;
  const toolName = normalizedToolName(node.toolName);
  const action = node.display?.kind === "generic_tool_summary" ? node.display.action?.toLowerCase() ?? "" : "";
  return toolName === "read" ||
    toolName === "read_file" ||
    toolName.startsWith("read_") ||
    action === "read_file" ||
    action.includes("读取文件") ||
    node.title.includes("读取文件");
}

export function normalizedToolName(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function toolCallIdsForNode(node: TranscriptNode): readonly string[] {
  return node.refs.filter((ref) => ref.kind === "tool_call").map((ref) => ref.id);
}

function compareNodeOrder(left: TranscriptNode, right: TranscriptNode): number {
  if (left.sequence !== right.sequence) return left.sequence - right.sequence;
  const rank = transcriptNodeOrderRank(left) - transcriptNodeOrderRank(right);
  if (rank !== 0) return rank;
  if (left.nodeId === right.nodeId) return 0;
  return left.nodeId.localeCompare(right.nodeId);
}

function transcriptNodeOrderRank(node: TranscriptNode): number {
  if (node.kind === "thinking") return 0;
  if (isModelSideOutputNode(node)) return 1;
  if (node.kind === "tool") return 2;
  if (node.kind === "confirmation") return 3;
  if (node.kind === "user_decision") return 4;
  if (node.kind === "system") return 5;
  return 6;
}

function canAggregateFileRead(previous: TranscriptNode, next: TranscriptNode): boolean {
  return isFileReadNode(previous) &&
    isFileReadNode(next) &&
    previous.phase === "completed" &&
    next.phase === "completed";
}

function aggregateFileReadNodes(previous: TranscriptNode, next: TranscriptNode): TranscriptNode {
  const items = uniqueStrings([...fileReadLabels(previous), ...fileReadLabels(next)]);
  return {
    ...next,
    nodeId: previous.nodeId,
    sequence: previous.sequence,
    timestamp: previous.timestamp,
    refs: mergeRefs(previous.refs, next.refs),
    title: "读取文件",
    summary: `${items.length} 个文件`,
    display: {
      kind: "generic_tool_summary",
      action: "读取文件",
      summary: `${items.length} 个文件`,
      items,
    },
  };
}

function fileReadLabels(node: TranscriptNode): readonly string[] {
  const display = node.display;
  if (display?.kind === "generic_tool_summary" && display.items !== undefined && display.items.length > 0) {
    return display.items.map(genericItemLabel);
  }
  const summary = display?.kind === "generic_tool_summary" ? display.summary : undefined;
  return [summary, node.summary].filter((value): value is string => value !== undefined && value.trim().length > 0);
}

function isBoringSuccessfulToolResult(node: TranscriptNode): boolean {
  if (node.kind !== "tool" || node.phase !== "completed" || node.eventType !== "tool.completed") return false;
  const display = node.display;
  if (display === undefined) return lowValueCopy(node.summary);
  if (display.kind === "command_summary") {
    return display.exitCode === 0 &&
      display.outputSummary === undefined &&
      display.errorSummary === undefined;
  }
  return false;
}

function isLowValueNode(node: TranscriptNode): boolean {
  return [node.title, node.summary, node.text].some(lowValueCopy);
}

function lowValueCopy(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = normalizeCopy(value);
  return normalized === "等待模型输出" ||
    normalized === "正在组织直接回答" ||
    normalized === "等待模型路由结果" ||
    (normalized.includes("助手已选择使用工具") && normalized.includes("工具结果") && normalized.includes("进入后续处理")) ||
    (normalized.includes("模型调用完成") && normalized.includes("可见输出")) ||
    normalized === "内容已整理并已进入报告或详情";
}

function normalizeCopy(value: string | undefined): string {
  return userVisibleAnswer(value ?? "")
    .replace(/[。.!！?？；;:：、，,\s]/g, "")
    .trim();
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (normalized.length === 0 || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function mergeRefs(left: readonly ObservationRef[], right: readonly ObservationRef[]): readonly ObservationRef[] {
  const seen = new Set<string>();
  const result: ObservationRef[] = [];
  for (const ref of [...left, ...right]) {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result;
}
