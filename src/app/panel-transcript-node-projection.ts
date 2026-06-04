import { isStaleModelProgressSummary } from "./panel-model-progress-copy.js";
import { userVisibleAnswer } from "./panel-assistant-visible-text.js";
import { genericItemLabel } from "./panel-transcript-tool-format.js";

export type TranscriptObservationRefLike = {
  readonly kind: string;
  readonly id: string;
};

export type TranscriptToolDisplayLike =
  | {
      readonly kind: "search_results";
      readonly query?: string;
      readonly results?: readonly unknown[];
    }
  | {
      readonly kind: "browser_snapshot";
      readonly title?: string;
      readonly url?: string;
    }
  | {
      readonly kind: "file_change_summary";
      readonly path?: string;
    }
  | {
      readonly kind: "file_diff_preview";
      readonly path?: string;
    }
  | {
      readonly kind: "command_summary";
      readonly command?: string;
      readonly args?: readonly string[];
      readonly exitCode?: number;
      readonly outputSummary?: string;
      readonly errorSummary?: string;
    }
  | {
      readonly kind: "generic_tool_summary";
      readonly action?: string;
      readonly summary?: string;
      readonly items?: readonly string[];
    };

export type ProjectableTranscriptNode = {
  readonly nodeId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly eventType: string;
  readonly kind: "thinking" | "tool" | "confirmation" | "user_decision" | "answer" | "system";
  readonly phase:
    | "noted"
    | "preparing"
    | "waiting_approval"
    | "approved"
    | "denied"
    | "guidance"
    | "executing"
    | "completed"
    | "failed"
    | "blocked"
    | "cancelled";
  readonly title: string;
  readonly summary?: string;
  readonly text?: string;
  readonly timestamp: string;
  readonly toolName?: string;
  readonly display?: TranscriptToolDisplayLike;
  readonly confirmation?: {
    readonly confirmationId?: string;
    readonly runId?: string;
    readonly actionSummary?: string;
  };
  readonly refs: readonly TranscriptObservationRefLike[];
};

export function visibleTranscriptNodes<TNode extends ProjectableTranscriptNode>(nodes: readonly TNode[]): readonly TNode[] {
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
  const result: TNode[] = [];
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

export function timelineVisibleNodes<TNode extends ProjectableTranscriptNode>(nodes: readonly TNode[]): readonly TNode[] {
  return workflowVisibleNodes(nodes).filter((node) => node.kind !== "answer");
}

export function workflowVisibleNodes<TNode extends ProjectableTranscriptNode>(nodes: readonly TNode[]): readonly TNode[] {
  const sorted = [...nodes]
    .filter((node) => !isLowValueNode(node))
    .sort(compareNodeOrder);
  const result: TNode[] = [];
  for (const node of sorted) {
    if (node.kind === "thinking") {
      if (!hasReadableModelText(node)) continue;
      result.push(node);
      continue;
    }
    if (isModelSideOutputNode(node)) {
      if (!hasReadableModelText(node)) continue;
      result.push(node);
      continue;
    }
    if (isDuplicatePreparingToolRequest(node, result)) {
      continue;
    }
    result.push(node);
  }
  return result;
}

export function nodesForRun<TNode extends { readonly runId: string }>(nodes: readonly TNode[], runId: string | undefined): readonly TNode[] {
  if (runId === undefined) return [];
  return nodes.filter((node) => node.runId === runId);
}

export function isModelSideOutputNode(node: ProjectableTranscriptNode): boolean {
  return node.kind === "system" && (node.eventType === "model.side.completed" || node.eventType === "model.output.side");
}

export function isFileReadNode(node: ProjectableTranscriptNode): boolean {
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

function toolCallIdsForNode(node: ProjectableTranscriptNode): readonly string[] {
  return node.refs.filter((ref) => ref.kind === "tool_call").map((ref) => ref.id);
}

function isDuplicatePreparingToolRequest(
  node: ProjectableTranscriptNode,
  previousNodes: readonly ProjectableTranscriptNode[]
): boolean {
  if (node.kind !== "tool" || node.eventType !== "tool.requested" || node.phase !== "preparing") {
    return false;
  }
  const ids = toolCallIdsForNode(node);
  if (ids.length === 0) {
    return false;
  }
  const confirmation = previousNodes.find((previous) =>
    previous.kind === "confirmation" &&
    toolCallIdsForNode(previous).some((id) => ids.includes(id))
  );
  return confirmation !== undefined;
}

function compareNodeOrder(left: ProjectableTranscriptNode, right: ProjectableTranscriptNode): number {
  if (left.sequence !== right.sequence) return left.sequence - right.sequence;
  const rank = transcriptNodeOrderRank(left) - transcriptNodeOrderRank(right);
  if (rank !== 0) return rank;
  if (left.nodeId === right.nodeId) return 0;
  return left.nodeId.localeCompare(right.nodeId);
}

function hasReadableModelText(node: ProjectableTranscriptNode): boolean {
  const text = (node.summary ?? node.text ?? "").trim();
  return text.length > 0;
}

function transcriptNodeOrderRank(node: ProjectableTranscriptNode): number {
  if (node.kind === "thinking") return 0;
  if (isModelSideOutputNode(node)) return 1;
  if (node.kind === "tool") return 2;
  if (node.kind === "confirmation") return 3;
  if (node.kind === "user_decision") return 4;
  if (node.kind === "system") return 5;
  return 6;
}

function canAggregateFileRead(previous: ProjectableTranscriptNode, next: ProjectableTranscriptNode): boolean {
  return isFileReadNode(previous) &&
    isFileReadNode(next) &&
    previous.phase === "completed" &&
    next.phase === "completed";
}

function aggregateFileReadNodes<TNode extends ProjectableTranscriptNode>(previous: TNode, next: TNode): TNode {
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
  } as TNode;
}

function fileReadLabels(node: ProjectableTranscriptNode): readonly string[] {
  const display = node.display;
  if (display?.kind === "generic_tool_summary" && display.items !== undefined && display.items.length > 0) {
    return display.items.map(genericItemLabel);
  }
  const summary = display?.kind === "generic_tool_summary" ? display.summary : undefined;
  return [summary, node.summary].filter((value): value is string => value !== undefined && value.trim().length > 0);
}

function isBoringSuccessfulToolResult(node: ProjectableTranscriptNode): boolean {
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

function isLowValueNode(node: ProjectableTranscriptNode): boolean {
  if (node.kind === "thinking" || isModelSideOutputNode(node)) {
    return false;
  }
  if (node.kind === "tool" || node.kind === "confirmation" || node.kind === "user_decision") {
    return false;
  }
  return lowValueCopy(node.text ?? node.summary ?? node.title);
}

function lowValueCopy(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = normalizeCopy(value);
  return isStaleModelProgressSummary(value) ||
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

function mergeRefs<TRef extends TranscriptObservationRefLike>(left: readonly TRef[], right: readonly TRef[]): readonly TRef[] {
  const seen = new Set<string>();
  const result: TRef[] = [];
  for (const ref of [...left, ...right]) {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result;
}
