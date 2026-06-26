import { userVisibleAnswer } from "./panel-assistant-visible-text.js";

export type TranscriptNodeRefLike = {
  readonly kind: string;
  readonly id: string;
  readonly label?: string;
};

export type TranscriptNodeIdentityLike = {
  readonly nodeId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly eventType?: string;
  readonly kind?: string;
  readonly phase?: string;
  readonly title?: string;
  readonly summary?: string;
  readonly text?: string;
  readonly timestamp?: string;
  readonly modelUsage?: unknown;
  readonly refs?: readonly TranscriptNodeRefLike[];
};

type TranscriptMergeClass = "model_activity" | "body";

export function transcriptNodeText(node: TranscriptNodeIdentityLike): string {
  return node.text ?? node.summary ?? "";
}

export function comparableTranscriptText(value: string | undefined): string {
  return userVisibleAnswer(value ?? "")
    .replace(/[。.!！?？；;:：、，,\s]/g, "")
    .trim();
}

export function isModelSideTranscriptNode(node: TranscriptNodeIdentityLike): boolean {
  return node.kind === "system" &&
    (node.eventType === "model.side.completed" || node.eventType === "model.output.side");
}

export function isMergeableModelTranscriptNode(node: TranscriptNodeIdentityLike): boolean {
  return node.kind === "thinking" || isModelSideTranscriptNode(node);
}

export function sameTranscriptNodeIdentity(
  left: TranscriptNodeIdentityLike,
  right: TranscriptNodeIdentityLike,
): boolean {
  if (left.runId !== right.runId) {
    return false;
  }
  if (left.nodeId === right.nodeId) {
    return true;
  }
  const leftClass = transcriptMergeClass(left);
  const rightClass = transcriptMergeClass(right);
  if (leftClass === undefined || leftClass !== rightClass) {
    return false;
  }
  const leftText = comparableTranscriptText(transcriptNodeText(left));
  const rightText = comparableTranscriptText(transcriptNodeText(right));
  if (leftText.length === 0 || rightText.length === 0) {
    return false;
  }
  if (leftText === rightText) {
    return leftClass === "model_activity" || transcriptModelRefsCompatible(left, right);
  }
  if (!leftText.startsWith(rightText) && !rightText.startsWith(leftText)) {
    return false;
  }
  if (leftClass === "model_activity") {
    return true;
  }
  return transcriptModelRefsCompatible(left, right);
}

export function mergeTranscriptNodes<TNode extends TranscriptNodeIdentityLike>(
  previous: TNode,
  incoming: TNode,
): TNode {
  const mergeClass = transcriptMergeClass(previous);
  if (mergeClass === undefined || mergeClass !== transcriptMergeClass(incoming)) {
    return incoming;
  }
  const text = moreCompleteTranscriptText(transcriptNodeText(previous), transcriptNodeText(incoming));
  const merged = {
    ...incoming,
    nodeId: previous.nodeId,
    sequence: previous.sequence,
    timestamp: previous.timestamp ?? incoming.timestamp,
    modelUsage: incoming.modelUsage ?? previous.modelUsage,
    refs: mergeTranscriptRefs(previous.refs ?? [], incoming.refs ?? []),
    text,
    summary: text === undefined ? incoming.summary ?? previous.summary : compactTranscriptSummary(text),
  } as TNode;
  if (mergeClass !== "model_activity") {
    return merged;
  }
  return preserveModelActivityPresentation(previous, incoming, merged);
}

export function mergeTranscriptNodeLists<TNode extends TranscriptNodeIdentityLike>(
  previous: readonly TNode[],
  incoming: readonly TNode[],
): readonly TNode[] {
  const merged: TNode[] = [...previous];
  const index = transcriptNodeMergeIndex(merged);
  for (const node of incoming) {
    const existingIndex = findTranscriptNodeMergeIndex(merged, index, node);
    if (existingIndex >= 0) {
      const existing = merged[existingIndex];
      if (existing !== undefined) {
        merged[existingIndex] = mergeTranscriptNodes(existing, node);
        indexTranscriptNode(index, merged[existingIndex]!, existingIndex);
      }
      continue;
    }
    merged.push(node);
    indexTranscriptNode(index, node, merged.length - 1);
  }
  return sortTranscriptNodes(merged);
}

export function mergeReplacingTranscriptNodeLists<TNode extends TranscriptNodeIdentityLike>(
  previous: readonly TNode[],
  incoming: readonly TNode[],
): readonly TNode[] {
  const merged: TNode[] = [];
  const mergedIndex = transcriptNodeMergeIndex(merged);
  const previousIndex = transcriptNodeMergeIndex(previous);
  for (const node of incoming) {
    const existingMergedIndex = findTranscriptNodeMergeIndex(merged, mergedIndex, node);
    if (existingMergedIndex >= 0) {
      const existing = merged[existingMergedIndex];
      if (existing !== undefined) {
        merged[existingMergedIndex] = mergeTranscriptNodes(existing, node);
        indexTranscriptNode(mergedIndex, merged[existingMergedIndex]!, existingMergedIndex);
      }
      continue;
    }
    const existingPreviousIndex = findTranscriptNodeMergeIndex(previous, previousIndex, node);
    const existingPrevious = existingPreviousIndex >= 0 ? previous[existingPreviousIndex] : undefined;
    const nextNode = existingPrevious === undefined ? node : mergeTranscriptNodes(existingPrevious, node);
    merged.push(nextNode);
    indexTranscriptNode(mergedIndex, nextNode, merged.length - 1);
  }
  return sortTranscriptNodes(merged);
}

export function moreCompleteTranscriptText(left: string, right: string): string | undefined {
  const leftText = left.trim();
  const rightText = right.trim();
  if (leftText.length === 0) return rightText.length === 0 ? undefined : rightText;
  if (rightText.length === 0) return leftText;
  const compactLeft = comparableTranscriptText(leftText);
  const compactRight = comparableTranscriptText(rightText);
  if (compactRight.length > compactLeft.length) return rightText;
  if (compactLeft.length > compactRight.length) return leftText;
  return rightText.length >= leftText.length ? rightText : leftText;
}

export function mergeTranscriptRefs<TRef extends TranscriptNodeRefLike>(
  left: readonly TRef[],
  right: readonly TRef[],
): readonly TRef[] {
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

function transcriptMergeClass(node: TranscriptNodeIdentityLike): TranscriptMergeClass | undefined {
  if (isMergeableModelTranscriptNode(node)) {
    return "model_activity";
  }
  if (node.kind === "body") {
    return "body";
  }
  return undefined;
}

type TranscriptNodeMergeIndex = {
  readonly byNodeId: Map<string, number>;
  readonly byModelText: Map<string, number[]>;
  readonly byBodyText: Map<string, number[]>;
};

function transcriptNodeMergeIndex<TNode extends TranscriptNodeIdentityLike>(
  nodes: readonly TNode[],
): TranscriptNodeMergeIndex {
  const index: TranscriptNodeMergeIndex = {
    byNodeId: new Map<string, number>(),
    byModelText: new Map<string, number[]>(),
    byBodyText: new Map<string, number[]>(),
  };
  nodes.forEach((node, nodeIndex) => indexTranscriptNode(index, node, nodeIndex));
  return index;
}

function indexTranscriptNode(
  index: TranscriptNodeMergeIndex,
  node: TranscriptNodeIdentityLike,
  nodeIndex: number,
): void {
  index.byNodeId.set(transcriptNodeIdKey(node), nodeIndex);
  const textKey = transcriptNodeTextKey(node);
  if (textKey === undefined) return;
  const target = transcriptMergeClass(node) === "body" ? index.byBodyText : index.byModelText;
  const existing = target.get(textKey) ?? [];
  target.set(textKey, [...existing.filter((item) => item !== nodeIndex), nodeIndex]);
}

function findTranscriptNodeMergeIndex<TNode extends TranscriptNodeIdentityLike>(
  nodes: readonly TNode[],
  index: TranscriptNodeMergeIndex,
  node: TNode,
): number {
  const nodeIdMatch = index.byNodeId.get(transcriptNodeIdKey(node));
  if (nodeIdMatch !== undefined && sameTranscriptNodeIdentity(nodes[nodeIdMatch]!, node)) {
    return nodeIdMatch;
  }
  const textKey = transcriptNodeTextKey(node);
  const mergeClass = transcriptMergeClass(node);
  const candidates = textKey === undefined
    ? undefined
    : (mergeClass === "body" ? index.byBodyText : index.byModelText).get(textKey);
  if (candidates !== undefined) {
    for (let indexIndex = candidates.length - 1; indexIndex >= 0; indexIndex -= 1) {
      const nodeIndex = candidates[indexIndex]!;
      const candidate = nodes[nodeIndex];
      if (candidate !== undefined && sameTranscriptNodeIdentity(candidate, node)) {
        return nodeIndex;
      }
    }
  }
  return nodes.findIndex((item) => sameTranscriptNodeIdentity(item, node));
}

function transcriptNodeIdKey(node: TranscriptNodeIdentityLike): string {
  return `${node.runId}:${node.nodeId}`;
}

function transcriptNodeTextKey(node: TranscriptNodeIdentityLike): string | undefined {
  const mergeClass = transcriptMergeClass(node);
  if (mergeClass === undefined) return undefined;
  const text = comparableTranscriptText(transcriptNodeText(node));
  if (text.length === 0) return undefined;
  return `${node.runId}:${mergeClass}:${text}`;
}

function transcriptModelRefsCompatible(
  left: TranscriptNodeIdentityLike,
  right: TranscriptNodeIdentityLike,
): boolean {
  const leftRefs = modelCallIds(left);
  const rightRefs = modelCallIds(right);
  if (leftRefs.length === 0 || rightRefs.length === 0) {
    return true;
  }
  return leftRefs.some((id) => rightRefs.includes(id));
}

function modelCallIds(node: TranscriptNodeIdentityLike): readonly string[] {
  return (node.refs ?? []).filter((ref) => ref.kind === "model_call").map((ref) => ref.id);
}

function preserveModelActivityPresentation<TNode extends TranscriptNodeIdentityLike>(
  previous: TNode,
  incoming: TNode,
  merged: TNode,
): TNode {
  if (previous.kind === incoming.kind || (previous.kind !== "thinking" && incoming.kind !== "thinking")) {
    return merged;
  }
  if (previous.kind !== "thinking") {
    return {
      ...merged,
      kind: previous.kind,
      phase: previous.phase ?? merged.phase,
      eventType: previous.eventType ?? merged.eventType,
      title: previous.title ?? merged.title,
    } as TNode;
  }
  const completed = previous.phase === "completed" ||
    incoming.phase === "completed" ||
    previous.eventType === "model.reasoning.completed" ||
    incoming.eventType === "model.reasoning.completed";
  const eventType = completed ? "model.reasoning.completed" : previous.eventType ?? merged.eventType;
  return {
    ...merged,
    kind: "thinking",
    phase: completed ? "completed" : merged.phase,
    eventType,
    title: previous.title ?? merged.title,
  } as TNode;
}

function sortTranscriptNodes<TNode extends TranscriptNodeIdentityLike>(nodes: readonly TNode[]): readonly TNode[] {
  return [...nodes].sort((left, right) => left.sequence - right.sequence || left.nodeId.localeCompare(right.nodeId));
}

function compactTranscriptSummary(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= 220 ? normalized : `${normalized.slice(0, 219)}…`;
}
