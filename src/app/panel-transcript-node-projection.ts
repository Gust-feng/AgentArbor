import { isStaleModelProgressSummary } from "./panel-model-progress-copy.js";
import { userVisibleAnswer } from "./panel-assistant-visible-text.js";
import { genericItemLabel } from "./panel-transcript-tool-format.js";
import { isGenericApprovalDecisionText } from "./confirmation-copy.js";
import {
  isMergeableModelTranscriptNode,
  isModelSideTranscriptNode,
  mergeTranscriptNodes,
  sameTranscriptNodeIdentity,
} from "./panel-transcript-node-identity.js";

export type TranscriptObservationRefLike = {
  readonly kind: string;
  readonly id: string;
};

export type TranscriptToolDisplayLike =
  | {
      readonly kind: "search_results";
      readonly query?: string;
      readonly message?: string;
      readonly results?: readonly unknown[];
    }
  | {
      readonly kind: "read_result";
      readonly title?: string;
      readonly url?: string;
      readonly uri?: string;
    }
  | {
      readonly kind: "browser_snapshot";
      readonly title?: string;
      readonly url?: string;
    }
  | {
      readonly kind: "http_response";
      readonly method?: string;
      readonly url?: string;
      readonly statusCode?: number;
      readonly statusText?: string;
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
      readonly commandLine?: string;
      readonly cwd?: string;
      readonly shell?: string;
      readonly exitCode?: number;
      readonly timedOut?: boolean;
      readonly cancelled?: boolean;
      readonly background?: boolean;
      readonly pid?: number;
      readonly logPath?: string;
      readonly stopCommand?: string;
      readonly durationMs?: number;
      readonly waitForPort?: number;
      readonly portReady?: boolean;
      readonly stdoutTruncated?: boolean;
      readonly stderrTruncated?: boolean;
      readonly stdoutChars?: number;
      readonly stderrChars?: number;
      readonly stdoutOmittedChars?: number;
      readonly stderrOmittedChars?: number;
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
  readonly kind: "thinking" | "tool" | "confirmation" | "user_decision" | "answer" | "body" | "system";
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
    .filter((node) => node.kind !== "body")
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
  return activityVisibleNodes(nodes)
    .filter((node) => node.kind !== "answer")
    .filter((node) => node.kind !== "body");
}

export function activityVisibleNodes<TNode extends ProjectableTranscriptNode>(nodes: readonly TNode[]): readonly TNode[] {
  const sorted = [...nodes]
    .filter((node) => !isLowValueNode(node))
    .sort(compareNodeOrder);
  const confirmationToolCallIds = new Set(
    sorted
      .filter((node) => node.kind === "confirmation")
      .flatMap(toolCallIdsForNode)
  );
  const result: TNode[] = [];
  for (const node of sorted) {
    if (node.kind === "thinking") {
      if (!hasReadableModelText(node)) continue;
      const duplicateThinkingIndex = duplicateModelActivityIndex(result, node);
      if (duplicateThinkingIndex >= 0) {
        const previous = result[duplicateThinkingIndex];
        if (previous !== undefined) {
          result[duplicateThinkingIndex] = mergeModelActivityNodes(previous, node);
        }
        continue;
      }
      result.push(node);
      continue;
    }
    if (isModelSideOutputNode(node)) {
      if (!hasReadableModelText(node)) continue;
      const duplicateNarrationIndex = duplicateModelActivityIndex(result, node);
      if (duplicateNarrationIndex >= 0) {
        const previous = result[duplicateNarrationIndex];
        if (previous !== undefined) {
          result[duplicateNarrationIndex] = mergeModelActivityNodes(previous, node);
        }
        continue;
      }
      result.push(node);
      continue;
    }
    if (isDuplicatePreparingToolRequest(node, confirmationToolCallIds)) {
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
  return isModelSideTranscriptNode(node);
}

function isMergeableModelActivityNode(node: ProjectableTranscriptNode): boolean {
  return isMergeableModelTranscriptNode(node);
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

export function isLowValueUserDecisionNode(node: ProjectableTranscriptNode): boolean {
  return node.kind === "user_decision" &&
    node.phase === "approved" &&
    isGenericApprovalDecisionText(node.text ?? node.summary ?? node.title);
}

export function normalizedToolName(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function toolCallIdsForNode(node: ProjectableTranscriptNode): readonly string[] {
  return node.refs.filter((ref) => ref.kind === "tool_call").map((ref) => ref.id);
}

function isDuplicatePreparingToolRequest(
  node: ProjectableTranscriptNode,
  confirmationToolCallIds: ReadonlySet<string>
): boolean {
  if (node.kind !== "tool" || node.eventType !== "tool.requested" || node.phase !== "preparing") {
    return false;
  }
  const ids = toolCallIdsForNode(node);
  return ids.length > 0 && ids.some((id) => confirmationToolCallIds.has(id));
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
  if (node.kind === "body") return 2;
  if (node.kind === "tool") return 3;
  if (node.kind === "confirmation") return 4;
  if (node.kind === "user_decision") return 5;
  if (node.kind === "system") return 6;
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
      display.timedOut !== true &&
      display.cancelled !== true &&
      display.background !== true &&
      display.pid === undefined &&
      display.logPath === undefined &&
      display.stopCommand === undefined &&
      display.durationMs === undefined &&
      display.waitForPort === undefined &&
      display.portReady === undefined &&
      display.stdoutTruncated !== true &&
      display.stderrTruncated !== true &&
      display.outputSummary === undefined &&
      display.errorSummary === undefined;
  }
  return false;
}

function isLowValueNode(node: ProjectableTranscriptNode): boolean {
  if (node.kind === "thinking" || isModelSideOutputNode(node)) {
    return false;
  }
  if (node.kind === "user_decision") {
    return isLowValueUserDecisionNode(node);
  }
  if (node.kind === "tool" || node.kind === "confirmation" || node.kind === "body") {
    return false;
  }
  return lowValueCopy(node.text ?? node.summary ?? node.title);
}

function duplicateModelActivityIndex<TNode extends ProjectableTranscriptNode>(
  nodes: readonly TNode[],
  candidate: TNode,
): number {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const existing = nodes[index];
    if (existing === undefined || !sameModelActivity(existing, candidate)) {
      continue;
    }
    return index;
  }
  return -1;
}

function sameModelActivity(left: ProjectableTranscriptNode, right: ProjectableTranscriptNode): boolean {
  if (!sameModelActivityKind(left, right)) {
    return false;
  }
  return sameTranscriptNodeIdentity(left, right);
}

function sameModelActivityKind(left: ProjectableTranscriptNode, right: ProjectableTranscriptNode): boolean {
  return isMergeableModelActivityNode(left) && isMergeableModelActivityNode(right);
}

function mergeModelActivityNodes<TNode extends ProjectableTranscriptNode>(previous: TNode, next: TNode): TNode {
  return mergeTranscriptNodes(previous, next);
}

function lowValueCopy(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = normalizeCopy(value);
  return isStaleModelProgressSummary(value) ||
    (normalized.includes("助手已选择使用工具") && normalized.includes("工具结果") && normalized.includes("进入后续处理")) ||
    (normalized.includes("模型调用完成") && normalized.includes("可见输出")) ||
    normalized === "内容已整理" ||
    normalized === "内容已整理并已进入报告或详情" ||
    normalized === "较早上下文已整理" ||
    normalized === "较早上下文暂未整理";
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
