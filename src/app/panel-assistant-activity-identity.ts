import type { ActivityItem } from "./panel-read-model/transcript/panel-transcript-activity-copy.js";
import { comparableTranscriptText } from "./panel-read-model/transcript/panel-transcript-node-identity.js";
import type { ProjectableTranscriptNode } from "./panel-read-model/transcript/panel-transcript-node-projection.js";

export function isModelNarrativeActivityItem(item: { readonly tone: string }): boolean {
  return item.tone === "thinking" || item.tone === "narration";
}

export function sameModelNarrativeActivity(
  left: Pick<ActivityItem, "tone" | "copy">,
  right: Pick<ActivityItem, "tone" | "copy">,
): boolean {
  return isModelNarrativeActivityItem(left) &&
    isModelNarrativeActivityItem(right) &&
    comparableAnyActivityText(modelNarrativeTextCandidates(left.copy), modelNarrativeTextCandidates(right.copy));
}

export function mergeModelNarrativeActivityItem(previous: ActivityItem, incoming: ActivityItem): ActivityItem {
  const detail = moreCompleteActivityText(previous.copy.detail, incoming.copy.detail) ?? previous.copy.detail;
  const expandedDetail = moreCompleteActivityText(previous.copy.expandedDetail, incoming.copy.expandedDetail);
  const label = previous.copy.label ?? incoming.copy.label;
  if (
    detail === previous.copy.detail &&
    expandedDetail === previous.copy.expandedDetail &&
    label === previous.copy.label &&
    previous.phase === incoming.phase
  ) {
    return previous;
  }
  return {
    ...previous,
    copy: {
      ...previous.copy,
      label,
      detail,
      expandedDetail,
    },
    phase: activityPhaseAfterMerge(previous.phase, incoming.phase),
  };
}

export function sameActivityItemCopy(
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
  return sameActivityTone(left.tone, right.tone) &&
    comparableActivityText(left.copy.label, right.copy.label) &&
    comparableActivityText(left.copy.detail, right.copy.detail);
}

function moreCompleteActivityText(left: string | undefined, right: string | undefined): string | undefined {
  const leftText = left?.trim() ?? "";
  const rightText = right?.trim() ?? "";
  if (leftText.length === 0) {
    return rightText.length === 0 ? undefined : rightText;
  }
  if (rightText.length === 0) {
    return leftText;
  }
  const comparableLeft = comparableActivityTextValue(leftText);
  const comparableRight = comparableActivityTextValue(rightText);
  if (comparableRight.length > comparableLeft.length) {
    return rightText;
  }
  if (comparableLeft.length > comparableRight.length) {
    return leftText;
  }
  return rightText.length > leftText.length ? rightText : leftText;
}

function activityPhaseAfterMerge(
  previous: ProjectableTranscriptNode["phase"],
  incoming: ProjectableTranscriptNode["phase"],
): ProjectableTranscriptNode["phase"] {
  if (isAttentionActivityPhase(previous) || isAttentionActivityPhase(incoming)) {
    return isAttentionActivityPhase(incoming) ? incoming : previous;
  }
  if (incoming === "completed" || previous === "completed") {
    return "completed";
  }
  return incoming;
}

function isAttentionActivityPhase(phase: ProjectableTranscriptNode["phase"]): boolean {
  return phase === "waiting_approval" ||
    phase === "failed" ||
    phase === "blocked";
}

function sameActivityTone(left: string, right: string): boolean {
  return left === right || (isModelNarrativeTone(left) && isModelNarrativeTone(right));
}

function isModelNarrativeTone(value: string): boolean {
  return value === "thinking" || value === "narration";
}

function comparableActivityText(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = comparableActivityTextValue(left ?? "");
  const normalizedRight = comparableActivityTextValue(right ?? "");
  if (normalizedLeft.length === 0 || normalizedRight.length === 0) {
    return normalizedLeft.length === normalizedRight.length;
  }
  return normalizedLeft === normalizedRight ||
    normalizedLeft.startsWith(normalizedRight) ||
    normalizedRight.startsWith(normalizedLeft);
}

function comparableAnyActivityText(left: readonly string[], right: readonly string[]): boolean {
  return left.some((leftText) => right.some((rightText) => comparableActivityText(leftText, rightText)));
}

function modelNarrativeTextCandidates(copy: ActivityItem["copy"]): readonly string[] {
  const detail = copy.detail.trim();
  const expanded = copy.expandedDetail?.trim();
  return [
    detail,
    expanded,
    expanded === undefined ? undefined : `${detail} ${expanded}`.trim(),
  ].filter((value): value is string => value !== undefined && value.length > 0);
}

function comparableActivityTextValue(value: string): string {
  return comparableTranscriptText(value).replace(/…/g, "");
}
