import type { ModelUsage } from "../../../domain/intelligence/index.js";
import type { ToolDisplayProjection } from "../../../domain/observation/index.js";
import type { LiveModelTurnBuffer, LiveRunBuffer, LiveToolActivity } from "../run/panel-run-live-buffer.js";
import {
  comparableTranscriptText,
  mergeTranscriptRefs,
  moreCompleteTranscriptText,
} from "./panel-transcript-node-identity.js";

export type LiveTranscriptObservationRef = {
  readonly kind: string;
  readonly id: string;
  readonly label?: string;
};

export type LiveTranscriptNode = {
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
  readonly modelUsage?: ModelUsage;
  readonly toolName?: string;
  readonly parentToolCallFactId?: string;
  readonly display?: ToolDisplayProjection;
  readonly refs: readonly LiveTranscriptObservationRef[];
};

export type LiveAnswerTone = "formal" | "process";

export type LiveAnswerProjection = {
  readonly text: string;
  readonly tone: LiveAnswerTone;
  readonly streaming: boolean;
};

export type LiveRunTranscriptProjection = {
  readonly nodes: readonly LiveTranscriptNode[];
  readonly answer?: LiveAnswerProjection;
};

export function projectLiveRunTranscript(
  nodes: readonly LiveTranscriptNode[],
  live: LiveRunBuffer | undefined
): LiveRunTranscriptProjection {
  const projectedNodes = withLiveTranscriptNodes(nodes, live);
  return {
    nodes: projectedNodes,
    answer: liveStreamingAnswer(live, projectedNodes),
  };
}

export function withLiveTranscriptNodes(
  nodes: readonly LiveTranscriptNode[],
  live: LiveRunBuffer | undefined
): readonly LiveTranscriptNode[] {
  if (live === undefined) return nodes;
  let next = withLiveToolNodes(nodes, live);

  for (const turn of live.turns) {
    if (turn.reasoning.text.trim().length > 0) {
      const existing = findLiveThinkingNode(next, turn);
      const liveNode = liveThinkingNode(live.runId, turn, existing);
      next = existing === undefined ? [...next, liveNode] : next.map((node) => node === existing ? liveNode : node);
    }
    if (turn.sideText.trim().length > 0) {
      const existing = next.find((node) =>
        node.kind === "system" &&
        (node.eventType === "model.side.completed" || node.eventType === "model.output.side") &&
        (sameModelRefs(node, turn.modelRefs) || sameSideText(node, turn))
      );
      const liveNode = liveSideTextNode(live.runId, turn, existing);
      next = existing === undefined ? [...next, liveNode] : next.map((node) => node === existing ? liveNode : node);
    }
    if (turn.output.text.trim().length > 0) {
      const existing = next.find((node) =>
        node.kind === "body" &&
        (node.eventType === "model.output.delta" || node.eventType === "model.output.completed") &&
        (
          sameModelRefs(node, turn.modelRefs) ||
          (
            ((node.phase !== "completed" || node.eventType === "model.output.delta") && sameBodyText(node, turn)) ||
            (node.phase === "completed" && sameExactComparableText(node.text ?? node.summary ?? "", turn.output.text))
          )
        )
      );
      const liveNode = liveBodyNode(live.runId, turn, existing);
      next = existing === undefined ? [...next, liveNode] : next.map((node) => node === existing ? liveNode : node);
    }
  }

  return next;
}

function withLiveToolNodes(
  nodes: readonly LiveTranscriptNode[],
  live: LiveRunBuffer,
): readonly LiveTranscriptNode[] {
  let next = nodes;
  for (const tool of live.tools) {
    if (hasTerminalToolNode(next, tool.callId)) continue;
    const existing = next.find((node) =>
      node.nodeId === tool.nodeId ||
      (node.kind === "tool" && node.eventType === "tool.requested" && hasToolCallRef(node, tool.callId)));
    const node = liveToolNode(live.runId, tool);
    next = existing === undefined
      ? [...next, node]
      : next.map((item) => item === existing ? node : item);
  }
  return next;
}

function liveToolNode(runId: string, tool: LiveToolActivity): LiveTranscriptNode {
  return {
    nodeId: tool.nodeId,
    runId,
    sequence: tool.sequence,
    eventType: "tool.requested",
    kind: "tool",
    phase: "executing",
    title: "",
    summary: tool.summary,
    timestamp: tool.timestamp,
    toolName: tool.toolName,
    parentToolCallFactId: tool.parentToolCallFactId,
    display: tool.display,
    refs: tool.refs,
  };
}

function hasTerminalToolNode(nodes: readonly LiveTranscriptNode[], callId: string): boolean {
  return nodes.some((node) =>
    node.kind === "tool" &&
    (node.eventType === "tool.completed" || node.eventType === "tool.failed" || node.eventType === "tool.cancelled") &&
    hasToolCallRef(node, callId));
}

function hasToolCallRef(node: LiveTranscriptNode, callId: string): boolean {
  return node.refs.some((ref) => ref.kind === "tool_call" && ref.id === callId);
}

export function liveStreamingAnswer(
  live: LiveRunBuffer | undefined,
  nodes: readonly LiveTranscriptNode[]
): LiveAnswerProjection | undefined {
  const liveTurn = live === undefined
    ? undefined
    : [...live.turns].reverse().find((turn) => turn.output.text.trim().length > 0);
  if (liveTurn !== undefined) {
    return {
      text: liveTurn.output.text,
      tone: liveOutputFollowsToolResult(liveTurn, nodes) ? "formal" : "process",
      streaming: true,
    };
  }
  const answerNode = [...nodes].reverse().find((node) => node.kind === "answer" && (node.text?.trim().length ?? 0) > 0);
  const answerText = answerNode?.text ?? [...nodes].reverse().find((node) => node.kind === "answer" && (node.summary?.trim().length ?? 0) > 0)?.summary;
  return answerText === undefined ? undefined : { text: answerFallbackText(answerText), tone: "formal", streaming: false };
}

function findLiveThinkingNode(nodes: readonly LiveTranscriptNode[], turn: LiveModelTurnBuffer): LiveTranscriptNode | undefined {
  return nodes.find((node) => node.kind === "thinking" && sameModelRefs(node, turn.modelRefs)) ??
    nodes.find((node) =>
      node.kind === "thinking" &&
      isModelReasoningNode(node) &&
      (
        (node.phase !== "completed" && sameReasoningText(node, turn)) ||
        (node.phase === "completed" && sameExactComparableText(node.text ?? node.summary ?? "", turn.reasoning.text))
      )
    );
}

function sameModelRefs(node: LiveTranscriptNode, modelRefs: readonly string[]): boolean {
  if (modelRefs.length === 0) return false;
  const refs = node.refs.filter((ref) => ref.kind === "model_call").map((ref) => ref.id);
  return refs.some((ref) => modelRefs.includes(ref));
}

function isModelReasoningNode(node: LiveTranscriptNode): boolean {
  return node.eventType === "model.reasoning.delta" || node.eventType === "model.reasoning.completed";
}

function sameReasoningText(node: LiveTranscriptNode, turn: LiveModelTurnBuffer): boolean {
  const nodeText = compactComparableText(node.text ?? node.summary ?? "");
  const liveText = compactComparableText(turn.reasoning.text);
  if (nodeText.length === 0 || liveText.length === 0) return false;
  if (nodeText === liveText) return true;
  return !turn.reasoningCompleted && (nodeText.startsWith(liveText) || liveText.startsWith(nodeText));
}

function sameSideText(node: LiveTranscriptNode, turn: LiveModelTurnBuffer): boolean {
  const nodeText = compactComparableText(node.text ?? node.summary ?? "");
  const liveText = compactComparableText(turn.sideText);
  return nodeText.length > 0 && nodeText === liveText;
}

function sameBodyText(node: LiveTranscriptNode, turn: LiveModelTurnBuffer): boolean {
  const nodeText = compactComparableText(node.text ?? node.summary ?? "");
  const liveText = compactComparableText(turn.output.text);
  return nodeText.length > 0 && liveText.length > 0 && (nodeText === liveText || nodeText.startsWith(liveText) || liveText.startsWith(nodeText));
}

function liveThinkingNode(runId: string, turn: LiveModelTurnBuffer, existing: LiveTranscriptNode | undefined): LiveTranscriptNode {
  const text = stableLiveNodeText(existing, turn.reasoning.text, liveReasoningSequence(turn), turn.reasoningCompleted);
  const completed = turn.reasoningCompleted || existing?.eventType === "model.reasoning.completed" || existing?.phase === "completed";
  const modelRefs = turn.modelRefs.map((id): LiveTranscriptObservationRef => ({ kind: "model_call", id }));
  return {
    nodeId: existing?.nodeId ?? `${runId}:live:${turn.requestId}:thinking`,
    runId,
    sequence: existing?.sequence ?? liveReasoningSequence(turn),
    eventType: completed ? "model.reasoning.completed" : "model.reasoning.delta",
    kind: "thinking",
    phase: completed ? "completed" : "noted",
    title: "思考",
    summary: compact(text, 180),
    text,
    timestamp: existing?.timestamp ?? "",
    refs: existing === undefined ? modelRefs : mergeRefs(existing.refs, modelRefs),
  };
}

function liveSideTextNode(runId: string, turn: LiveModelTurnBuffer, existing: LiveTranscriptNode | undefined): LiveTranscriptNode {
  const text = turn.sideText.trim();
  const modelRefs = turn.modelRefs.map((id): LiveTranscriptObservationRef => ({ kind: "model_call", id }));
  return {
    nodeId: existing?.nodeId ?? `${runId}:live:${turn.requestId}:side-text`,
    runId,
    sequence: existing?.sequence ?? Math.max(0, liveSideTextSequence(turn) - 0.1),
    eventType: "model.output.side",
    kind: "system",
    phase: "completed",
    title: "",
    summary: compact(text, 220),
    text,
    timestamp: existing?.timestamp ?? "",
    modelUsage: existing?.modelUsage,
    refs: existing === undefined ? modelRefs : mergeRefs(existing.refs, modelRefs),
  };
}

function liveBodyNode(runId: string, turn: LiveModelTurnBuffer, existing: LiveTranscriptNode | undefined): LiveTranscriptNode {
  const text = stableLiveNodeText(existing, turn.output.text, liveOutputSequence(turn), turn.outputCompleted === true);
  const completed = turn.outputCompleted === true || existing?.eventType === "model.output.completed" || existing?.phase === "completed";
  const modelRefs = turn.modelRefs.map((id): LiveTranscriptObservationRef => ({ kind: "model_call", id }));
  return {
    nodeId: existing?.nodeId ?? `${runId}:live:${turn.requestId}:body`,
    runId,
    sequence: existing?.sequence ?? liveOutputSequence(turn),
    eventType: completed ? "model.output.completed" : "model.output.delta",
    kind: "body",
    phase: completed ? "completed" : "noted",
    title: "",
    summary: compact(text, 220),
    text,
    timestamp: existing?.timestamp ?? "",
    refs: existing === undefined ? modelRefs : mergeRefs(existing.refs, modelRefs),
  };
}

function liveOutputFollowsToolResult(turn: LiveModelTurnBuffer, nodes: readonly LiveTranscriptNode[]): boolean {
  const latestToolResultSequence = nodes.reduce((latest, node) => (
    node.kind === "tool" && (node.eventType === "tool.completed" || node.eventType === "tool.failed" || node.eventType === "tool.cancelled")
      ? Math.max(latest, node.sequence)
      : latest
  ), 0);
  return latestToolResultSequence > 0 && liveOutputSequence(turn) > latestToolResultSequence;
}

function liveOutputSequence(turn: LiveModelTurnBuffer): number {
  return turn.outputSequence ?? turn.updatedAtSequence;
}

function liveReasoningSequence(turn: LiveModelTurnBuffer): number {
  return turn.reasoningSequence ?? turn.updatedAtSequence;
}

function liveSideTextSequence(turn: LiveModelTurnBuffer): number {
  return turn.sideTextSequence ?? turn.updatedAtSequence;
}

function mergeRefs(
  left: readonly LiveTranscriptObservationRef[],
  right: readonly LiveTranscriptObservationRef[]
): readonly LiveTranscriptObservationRef[] {
  return mergeTranscriptRefs(left, right);
}

function compactComparableText(value: string): string {
  return comparableTranscriptText(value);
}

function sameExactComparableText(left: string, right: string): boolean {
  const compactLeft = compactComparableText(left);
  const compactRight = compactComparableText(right);
  return compactLeft.length > 0 && compactLeft === compactRight;
}

function stableLiveNodeText(
  existing: LiveTranscriptNode | undefined,
  liveText: string,
  liveSequence: number,
  liveCompleted: boolean
): string {
  const nextText = liveText.trim();
  const existingText = (existing?.text ?? existing?.summary ?? "").trim();
  if (nextText.length === 0 || existingText.length === 0) {
    return nextText;
  }
  const nextCompact = compactComparableText(nextText);
  const existingCompact = compactComparableText(existingText);
  if (
    nextCompact.length === 0 ||
    existingCompact.length === 0 ||
    (
      nextCompact !== existingCompact &&
      !nextCompact.startsWith(existingCompact) &&
      !existingCompact.startsWith(nextCompact)
    )
  ) {
    return nextText;
  }
  if (liveCompleted || (existing?.phase === "completed" && existing.sequence >= liveSequence)) {
    return moreCompleteComparableText(existingText, nextText);
  }
  if (nextCompact.startsWith(existingCompact)) {
    return nextText;
  }
  if (existingCompact.startsWith(nextCompact)) {
    return existingText;
  }
  return moreCompleteComparableText(existingText, nextText);
}

function moreCompleteComparableText(left: string, right: string): string {
  return moreCompleteTranscriptText(left, right) ?? right;
}

function answerFallbackText(value: string): string {
  return value.replace(/^已(?:回答|完成|生成)[:：]\s*/u, "").trim();
}

function compact(value: string, maxLength: number): string {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}
