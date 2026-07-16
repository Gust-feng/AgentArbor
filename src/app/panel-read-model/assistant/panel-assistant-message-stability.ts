import {
  assistantActivitySegmentLifecycle,
  assistantMessageAwaitingFirstVisibleOutput,
  assistantMessageCopyTextFromSegments,
  assistantMessageHasTimeline,
  type AssistantMessageSegment,
  type AssistantMessageStructure,
} from "./panel-assistant-message-structure.js";
import {
  isModelNarrativeActivityItem,
  mergeModelNarrativeActivityItem,
  sameActivityItemCopy,
  sameModelNarrativeActivity,
} from "./panel-assistant-activity-identity.js";
import type { ActivityItem } from "../transcript/panel-transcript-activity-copy.js";
import {
  assistantSegmentUpdatePolicy,
  type AssistantSegmentUpdatePolicy,
} from "./panel-assistant-segment-policy.js";
import { assistantActivitySegmentKey } from "./panel-assistant-segment-identity.js";
import type { AssistantMessageView } from "./panel-assistant-message-view.js";
import type { ConfirmationIdentity } from "../transcript/panel-transcript-confirmation-projection.js";
import type { ProjectableTranscriptNode } from "../transcript/panel-transcript-node-projection.js";

export function stabilizeAssistantMessageView<
  TNode extends ProjectableTranscriptNode,
  TConfirmation extends ConfirmationIdentity = ConfirmationIdentity,
>(
  previous: AssistantMessageView<TNode, TConfirmation> | undefined,
  next: AssistantMessageView<TNode, TConfirmation>,
): AssistantMessageView<TNode, TConfirmation> {
  return {
    ...next,
    ...stabilizeAssistantMessageStructure(previous, next),
  };
}

export function stabilizeAssistantMessageStructure<
  TNode extends ProjectableTranscriptNode,
  TConfirmation extends ConfirmationIdentity = ConfirmationIdentity,
>(
  previous: AssistantMessageStructure<TNode, TConfirmation> | undefined,
  next: AssistantMessageStructure<TNode, TConfirmation>,
): AssistantMessageStructure<TNode, TConfirmation> {
  const segments = previous === undefined
    ? normalizeModelNarrativeSegments(next.segments, new Set())
    : stabilizeAssistantMessageSegments(previous.segments, next.segments);
  return {
    ...next,
    hasTimeline: assistantMessageHasTimeline(segments),
    awaitingFirstVisibleOutput: assistantMessageAwaitingFirstVisibleOutput(segments),
    segments,
    copyText: assistantMessageCopyTextFromSegments(segments),
  };
}

function stabilizeAssistantMessageSegments<
  TNode extends ProjectableTranscriptNode,
  TConfirmation extends ConfirmationIdentity,
>(
  previous: readonly AssistantMessageSegment<TNode, TConfirmation>[],
  next: readonly AssistantMessageSegment<TNode, TConfirmation>[],
): readonly AssistantMessageSegment<TNode, TConfirmation>[] {
  const nextMaterialized = next.filter((segment) => segment.kind !== "awaiting");
  const frozenModelNarrativeSegments = stableActivitySegmentIdentities(previous);
  if (previous.length === 0) {
    return normalizeModelNarrativeSegments(next, frozenModelNarrativeSegments);
  }
  if (nextMaterialized.length === 0) {
    const preserved = previous.filter((segment) => segment.kind !== "awaiting");
    const normalized = normalizeModelNarrativeSegments(
      preserved.length > 0 ? preserved : next,
      frozenModelNarrativeSegments,
    );
    return withTrailingAwaitingFromNext(normalized, next);
  }
  const previousMaterialized = previous.filter((segment) => segment.kind !== "awaiting");
  if (previousMaterialized.length === 0) {
    return withTrailingAwaitingFromNext(
      normalizeModelNarrativeSegments(nextMaterialized, frozenModelNarrativeSegments),
      next,
    );
  }
  const result: AssistantMessageSegment<TNode, TConfirmation>[] = [];
  const represented = new Set<string>();
  const consumedIndices = new Set<number>();
  let latestConsumedIndex = -1;

  for (const [previousIndex, previousSegment] of previousMaterialized.entries()) {
    const matchIndex = findContinuingSegmentIndex(previousSegment, nextMaterialized, consumedIndices);
    if (matchIndex >= 0) {
      const matched = nextMaterialized[matchIndex]!;
      const policy = assistantSegmentUpdatePolicy(previousSegment, matched);
      const stablePrefix =
        isStablePrefixActivitySegment(previousMaterialized, previousIndex) ||
        isStablePrefixActivitySegment(nextMaterialized, matchIndex);
      const stabilized = stablePrefixSegmentPresentation(
        stablePrefix,
        preserveStableSegmentPresentation(
          previousSegment,
          matched,
          stablePrefix
            ? { ...policy, updateContent: false, carryCollapsedHint: true }
            : policy,
        ),
      );
      result.push(stabilized);
      represented.add(segmentIdentity(stabilized));
      consumedIndices.add(matchIndex);
      latestConsumedIndex = Math.max(latestConsumedIndex, matchIndex);
    } else {
      const stabilized = stablePrefixSegmentPresentation(
        isStablePrefixActivitySegment(previousMaterialized, previousIndex),
        previousSegment,
      );
      result.push(stabilized);
      represented.add(segmentIdentity(stabilized));
    }
  }

  nextMaterialized.forEach((segment, index) => {
    if (consumedIndices.has(index)) {
      return;
    }
    if (latestConsumedIndex >= 0 && index <= latestConsumedIndex) {
      return;
    }
    if (represented.has(segmentIdentity(segment))) {
      mergeRepresentedSegmentPresentation(result, segment);
      return;
    }
    const displaySegment = segment;
    if (displaySegment.kind === "activity") {
      const existingIndex = result.findIndex((item) => item.kind === "activity" && sameActivitySegment(item, displaySegment));
      if (existingIndex >= 0) {
        const existing = result[existingIndex];
        if (existing?.kind === "activity") {
          result[existingIndex] = preserveStableSegmentPresentation(
            existing,
            displaySegment,
            assistantSegmentUpdatePolicy(existing, displaySegment),
          );
        }
        return;
      }
    }
    if (displaySegment.kind === "body" && result.some((item) => item.kind === "body" && sameBodySegment(item, displaySegment))) {
      return;
    }
    result.push(displaySegment);
    represented.add(segmentIdentity(displaySegment));
  });
  const normalized = normalizeModelNarrativeSegments(
    result.length > 0 ? result : nextMaterialized,
    frozenModelNarrativeSegments,
  );
  return withTrailingAwaitingFromNext(normalized, next);
}

function withTrailingAwaitingFromNext<
  TNode extends ProjectableTranscriptNode,
  TConfirmation extends ConfirmationIdentity,
>(
  materialized: readonly AssistantMessageSegment<TNode, TConfirmation>[],
  next: readonly AssistantMessageSegment<TNode, TConfirmation>[],
): readonly AssistantMessageSegment<TNode, TConfirmation>[] {
  const awaiting = next.at(-1);
  if (awaiting?.kind !== "awaiting") return materialized;
  if (awaiting.reason === "initial" && materialized.length > 0) return materialized;
  return [...materialized.filter((segment) => segment.kind !== "awaiting"), awaiting];
}

function stablePrefixSegmentPresentation<
  TNode extends ProjectableTranscriptNode,
  TConfirmation extends ConfirmationIdentity,
>(
  stablePrefix: boolean,
  segment: AssistantMessageSegment<TNode, TConfirmation>,
): AssistantMessageSegment<TNode, TConfirmation> {
  if (segment.kind !== "activity" || !stablePrefix) {
    return segment;
  }
  return closedActivityPrefixSegment(segment);
}

function closedActivityPrefixSegment<
  TNode extends ProjectableTranscriptNode,
  TConfirmation extends ConfirmationIdentity,
>(
  segment: Extract<AssistantMessageSegment<TNode, TConfirmation>, { readonly kind: "activity" }>,
): Extract<AssistantMessageSegment<TNode, TConfirmation>, { readonly kind: "activity" }> {
  if (segment.lifecycle === "attention" || segment.timeline.confirmation.current !== undefined) {
    return segment;
  }
  const items = segment.timeline.items.map((item) =>
    item.phase === "failed" ||
    item.phase === "blocked" ||
    item.phase === "waiting_approval"
      ? item
      : { ...item, phase: "completed" as const }
  );
  const timeline = {
    ...segment.timeline,
    items,
  };
  return {
    ...segment,
    lifecycle: assistantActivitySegmentLifecycle(timeline),
    timeline,
  };
}

function findContinuingSegmentIndex<
  TNode extends ProjectableTranscriptNode,
  TConfirmation extends ConfirmationIdentity,
>(
  previous: AssistantMessageSegment<TNode, TConfirmation>,
  next: readonly AssistantMessageSegment<TNode, TConfirmation>[],
  consumedIndices: ReadonlySet<number> = new Set<number>(),
): number {
  const exact = next.findIndex((segment, index) =>
    !consumedIndices.has(index) &&
    segment.kind === previous.kind &&
    segmentKey(segment) === segmentKey(previous)
  );
  if (exact >= 0) {
    return exact;
  }
  if (previous.kind === "activity") {
    return next.findIndex((segment, index) =>
      !consumedIndices.has(index) &&
      segment.kind === "activity" &&
      sameActivitySegment(previous, segment)
    );
  }
  if (previous.kind !== "body") {
    return -1;
  }
  return next.findIndex((segment, index) =>
    !consumedIndices.has(index) &&
    segment.kind === "body" &&
    sameBodySegment(previous, segment)
  );
}

function preserveStableSegmentPresentation<
  TNode extends ProjectableTranscriptNode,
  TConfirmation extends ConfirmationIdentity,
>(
  previous: AssistantMessageSegment<TNode, TConfirmation>,
  next: AssistantMessageSegment<TNode, TConfirmation>,
  policy: AssistantSegmentUpdatePolicy,
): AssistantMessageSegment<TNode, TConfirmation> {
  if (previous.kind === "activity" && next.kind === "activity" && (
    previous.segmentKey === next.segmentKey ||
    sameActivitySegment(previous, next)
  )) {
    const defaultCollapsed = policy.carryCollapsedHint
      ? previous.defaultCollapsed || next.defaultCollapsed
      : next.defaultCollapsed;
    if (!policy.updateContent) {
      return {
        ...previous,
        defaultCollapsed,
      };
    }
    return {
      ...next,
      segmentKey: previous.segmentKey,
      defaultCollapsed,
    };
  }
  if (previous.kind !== "body" || next.kind !== "body" || !sameBodySegment(previous, next)) {
    return next;
  }
  if (!policy.updateContent && previous.live !== true) {
    return previous;
  }
  if (previous.segmentKey === next.segmentKey) {
    return next;
  }
  return {
    ...next,
    segmentKey: previous.segmentKey,
  };
}

function mergeRepresentedSegmentPresentation<
  TNode extends ProjectableTranscriptNode,
  TConfirmation extends ConfirmationIdentity,
>(
  result: AssistantMessageSegment<TNode, TConfirmation>[],
  next: AssistantMessageSegment<TNode, TConfirmation>,
): void {
  const existingIndex = result.findIndex((item) => segmentIdentity(item) === segmentIdentity(next));
  const existing = result[existingIndex];
  if (existing === undefined) {
    return;
  }
  result[existingIndex] = preserveStableSegmentPresentation(
    existing,
    next,
    assistantSegmentUpdatePolicy(existing, next),
  );
}

type RepresentedModelNarrative = {
  readonly segmentIndex: number;
  readonly itemIndex: number;
  item: ActivityItem;
  readonly mutable: boolean;
};

function normalizeModelNarrativeSegments<
  TNode extends ProjectableTranscriptNode,
  TConfirmation extends ConfirmationIdentity,
>(
  segments: readonly AssistantMessageSegment<TNode, TConfirmation>[],
  frozenActivitySegmentIdentities: ReadonlySet<string>,
): readonly AssistantMessageSegment<TNode, TConfirmation>[] {
  const result: AssistantMessageSegment<TNode, TConfirmation>[] = [];
  const represented: RepresentedModelNarrative[] = [];
  for (const segment of segments) {
    if (segment.kind !== "activity") {
      result.push(segment);
      continue;
    }
    const items: ActivityItem[] = [];
    const nextRepresented: Array<{
      readonly itemIndex: number;
      readonly mutable: boolean;
    }> = [];
    for (const item of segment.timeline.items) {
      if (!isModelActivityItem(item)) {
        items.push(item);
        continue;
      }
      const previous = represented.find((entry) => sameModelNarrativeActivity(entry.item, item));
      if (previous !== undefined) {
        if (previous.mutable) {
          mergeRepresentedModelNarrative(result, previous, item);
        }
        continue;
      }
      const localIndex = items.findIndex((existing) =>
        isModelActivityItem(existing) && sameModelNarrativeActivity(existing, item)
      );
      if (localIndex >= 0) {
        const existing = items[localIndex];
        if (existing !== undefined) {
          items[localIndex] = mergeModelNarrativeActivityItem(existing, item);
        }
        continue;
      }
      nextRepresented.push({
        itemIndex: items.length,
        mutable: !frozenActivitySegmentIdentities.has(segmentIdentity(segment)),
      });
      items.push(item);
    }
    const normalized = activitySegmentWithItems(segment, items);
    if (normalized === undefined) {
      continue;
    }
    const resultIndex = result.length;
    result.push(normalized);
    const pushed = result[resultIndex];
    if (pushed?.kind !== "activity") {
      continue;
    }
    for (const entry of nextRepresented) {
      const representedItem = pushed.timeline.items[entry.itemIndex];
      if (representedItem === undefined || !isModelActivityItem(representedItem)) {
        continue;
      }
      represented.push({
        segmentIndex: resultIndex,
        itemIndex: entry.itemIndex,
        item: representedItem,
        mutable: entry.mutable,
      });
    }
  }
  return result;
}

function mergeRepresentedModelNarrative<
  TNode extends ProjectableTranscriptNode,
  TConfirmation extends ConfirmationIdentity,
>(
  result: AssistantMessageSegment<TNode, TConfirmation>[],
  represented: RepresentedModelNarrative,
  incoming: ActivityItem,
): void {
  const segment = result[represented.segmentIndex];
  if (segment?.kind !== "activity") {
    return;
  }
  const current = segment.timeline.items[represented.itemIndex];
  if (current === undefined || !sameModelNarrativeActivity(current, incoming)) {
    return;
  }
  const merged = mergeModelNarrativeActivityItem(current, incoming);
  if (merged === current) {
    return;
  }
  const items = segment.timeline.items.map((item, index) => index === represented.itemIndex ? merged : item);
  const timeline = {
    ...segment.timeline,
    items,
  };
  result[represented.segmentIndex] = {
    ...segment,
    lifecycle: assistantActivitySegmentLifecycle(timeline),
    timeline,
  };
  represented.item = merged;
}

function activitySegmentWithItems<
  TNode extends ProjectableTranscriptNode,
  TConfirmation extends ConfirmationIdentity,
>(
  segment: Extract<AssistantMessageSegment<TNode, TConfirmation>, { readonly kind: "activity" }>,
  items: readonly ActivityItem[],
): Extract<AssistantMessageSegment<TNode, TConfirmation>, { readonly kind: "activity" }> | undefined {
  if (items.length === segment.timeline.items.length) {
    return segment;
  }
  const hasContent = items.length > 0 || segment.timeline.confirmation.current !== undefined;
  if (!hasContent) {
    return undefined;
  }
  const itemNodeIds = new Set(items.map((item) => item.nodeId));
  const timeline = {
    ...segment.timeline,
    items,
    nodes: segment.timeline.nodes.filter((node) =>
      itemNodeIds.has(node.nodeId) ||
      (node.kind === "confirmation" && segment.timeline.confirmation.currentNodeId === node.nodeId)
    ),
    hasContent,
  };
  return {
    ...segment,
    segmentKey: assistantActivitySegmentKey({
      nodes: timeline.nodes,
      items,
      pending: timeline.confirmation.current,
      fallbackKey: segment.segmentKey,
    }),
    lifecycle: assistantActivitySegmentLifecycle(timeline),
    timeline,
  };
}

function sameBodySegment<
  TNode extends ProjectableTranscriptNode,
  TConfirmation extends ConfirmationIdentity,
>(
  left: Extract<AssistantMessageSegment<TNode, TConfirmation>, { readonly kind: "body" }>,
  right: Extract<AssistantMessageSegment<TNode, TConfirmation>, { readonly kind: "body" }>,
): boolean {
  return comparableBodyText(left.text, right.text) || comparableBodyText(left.copyText, right.copyText);
}

function sameActivitySegment<
  TNode extends ProjectableTranscriptNode,
  TConfirmation extends ConfirmationIdentity,
>(
  left: Extract<AssistantMessageSegment<TNode, TConfirmation>, { readonly kind: "activity" }>,
  right: Extract<AssistantMessageSegment<TNode, TConfirmation>, { readonly kind: "activity" }>,
): boolean {
  const leftConfirmationId = left.timeline.confirmation.current?.confirmationId;
  const rightConfirmationId = right.timeline.confirmation.current?.confirmationId;
  if (leftConfirmationId !== undefined || rightConfirmationId !== undefined) {
    return leftConfirmationId !== undefined && leftConfirmationId === rightConfirmationId;
  }
  if (sameOperationalActivityItems(left, right)) {
    return true;
  }
  if (operationalActivityItems(left).length > 0 || operationalActivityItems(right).length > 0) {
    return false;
  }
  const leftLeading = leadingModelActivityItems(left);
  const rightLeading = leadingModelActivityItems(right);
  if (leftLeading.length === 0 || rightLeading.length === 0) {
    return false;
  }
  const compareCount = Math.min(leftLeading.length, rightLeading.length);
  for (let index = 0; index < compareCount; index += 1) {
    const previous = leftLeading[index];
    const next = rightLeading[index];
    if (previous === undefined || next === undefined || !sameModelActivityItem(previous, next)) {
      return false;
    }
  }
  return true;
}

function sameOperationalActivityItems<
  TNode extends ProjectableTranscriptNode,
  TConfirmation extends ConfirmationIdentity,
>(
  left: Extract<AssistantMessageSegment<TNode, TConfirmation>, { readonly kind: "activity" }>,
  right: Extract<AssistantMessageSegment<TNode, TConfirmation>, { readonly kind: "activity" }>,
): boolean {
  const leftOperational = operationalActivityItems(left);
  const rightOperational = operationalActivityItems(right);
  if (leftOperational.length === 0 || rightOperational.length === 0 || leftOperational.length !== rightOperational.length) {
    return false;
  }
  return leftOperational.every((item, index) => sameOperationalActivityItem(item, rightOperational[index]));
}

function comparableBodyText(left: string, right: string): boolean {
  const normalizedLeft = normalizeBodyText(left);
  const normalizedRight = normalizeBodyText(right);
  return normalizedLeft.length > 0 &&
    normalizedRight.length > 0 &&
    (normalizedLeft === normalizedRight ||
      normalizedLeft.startsWith(normalizedRight) ||
      normalizedRight.startsWith(normalizedLeft));
}

function normalizeBodyText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function leadingModelActivityItems<
  TNode extends ProjectableTranscriptNode,
  TConfirmation extends ConfirmationIdentity,
>(
  segment: Extract<AssistantMessageSegment<TNode, TConfirmation>, { readonly kind: "activity" }>,
): readonly (typeof segment.timeline.items)[number][] {
  const result: Array<(typeof segment.timeline.items)[number]> = [];
  for (const item of segment.timeline.items) {
    if (item.tone !== "thinking" && item.tone !== "narration") {
      break;
    }
    result.push(item);
  }
  return result;
}

function operationalActivityItems<
  TNode extends ProjectableTranscriptNode,
  TConfirmation extends ConfirmationIdentity,
>(
  segment: Extract<AssistantMessageSegment<TNode, TConfirmation>, { readonly kind: "activity" }>,
): readonly (typeof segment.timeline.items)[number][] {
  return segment.timeline.items.filter((item) => item.tone !== "thinking" && item.tone !== "narration");
}

function sameOperationalActivityItem(
  left: {
    readonly key: string;
    readonly tone: string;
  } | undefined,
  right: {
    readonly key: string;
    readonly tone: string;
  } | undefined,
): boolean {
  return left !== undefined &&
    right !== undefined &&
    left.key === right.key &&
    left.tone === right.tone;
}

function sameModelActivityItem(
  left: {
    readonly tone: string;
    readonly copy: {
      readonly label?: string;
      readonly detail: string;
    };
  },
  right: {
    readonly tone: string;
    readonly copy: {
      readonly label?: string;
      readonly detail: string;
    };
  },
): boolean {
  return sameActivityItemCopy(left, right);
}

function isModelActivityItem(item: {
  readonly tone: string;
}): boolean {
  return isModelNarrativeActivityItem(item);
}

function stableActivitySegmentIdentities<
  TNode extends ProjectableTranscriptNode,
  TConfirmation extends ConfirmationIdentity,
>(
  segments: readonly AssistantMessageSegment<TNode, TConfirmation>[],
): ReadonlySet<string> {
  const materialized = segments.filter((segment) => segment.kind !== "awaiting");
  const result = new Set<string>();
  materialized.forEach((segment, index) => {
    if (segment.kind === "activity" && (
      segment.lifecycle === "settled" ||
      isStablePrefixActivitySegment(materialized, index)
    )) {
      result.add(segmentIdentity(segment));
    }
  });
  return result;
}

function isStablePrefixActivitySegment<
  TNode extends ProjectableTranscriptNode,
  TConfirmation extends ConfirmationIdentity,
>(
  segments: readonly AssistantMessageSegment<TNode, TConfirmation>[],
  index: number,
): boolean {
  const segment = segments[index];
  if (segment?.kind !== "activity") {
    return false;
  }
  if (segment.lifecycle === "attention") {
    return false;
  }
  return segments.slice(index + 1).some((item) => item.kind !== "awaiting");
}

function segmentIdentity<
  TNode extends ProjectableTranscriptNode,
  TConfirmation extends ConfirmationIdentity,
>(
  segment: AssistantMessageSegment<TNode, TConfirmation>,
): string {
  if (segment.kind === "awaiting") {
    return "awaiting";
  }
  return `${segment.kind}:${segment.segmentKey}`;
}

function segmentKey<
  TNode extends ProjectableTranscriptNode,
  TConfirmation extends ConfirmationIdentity,
>(
  segment: AssistantMessageSegment<TNode, TConfirmation>,
): string | undefined {
  return segment.kind === "awaiting" ? undefined : segment.segmentKey;
}
