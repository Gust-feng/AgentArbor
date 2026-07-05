import {
  displayActivityItemsForNodes,
  type ActivityBadge,
  type ActivityExpandedSection,
  type ActivityItem,
} from "../../panel-transcript-activity-copy.js";
import type {
  DeepChildAgentRunExecutionSegmentView,
  DeepChildAgentRunExecutionView,
  DeepChildAgentRunModelMessageTraceView,
  DeepChildAgentRunParentInstructionView,
  DeepChildAgentRunPendingApprovalView,
  DeepChildAgentRunToolCallTraceView,
  DeepChildAgentRunView,
  DeepChildRunStatus,
  DeepLiveChildWorkflowItem,
  DeepParentSynthesisChildReviewView,
  DeepRunView,
} from "./contracts/deep.js";
import type { TranscriptNode } from "./contracts/run.js";
import {
  childAgentSummaryItem,
  meaningfulChildResultText,
  runTranscriptWorkflowItems,
  visibleWorkflowStatusLabel,
} from "./deep-view-model.js";
import type {
  DeepChildAgentWorkflowSegment,
  DeepRunChildSummaryViewModel,
  DeepSelectedWorkItem,
  DeepTaskPlanItemViewModel,
  DeepWorkItemDetailViewModel,
  DeepWorklineItemViewModel,
} from "./deep-view-model.js";

export function deepWorkItemDetailViewModel(
  view: DeepRunView,
  selected: DeepSelectedWorkItem,
): DeepWorkItemDetailViewModel | undefined {
  if (selected.kind === "child_agent") {
    const child = childAgentSummaryItem(view, selected.id);
    return {
      kind: selected.kind,
      detailId: selected.id,
      title: child.title,
      status: child.status,
      summary: child.objective || meaningfulChildResultText(child.latestResult ?? child.summary, child.objective) || "",
      workflowItems: child.workflowItems,
      worklineItems: childDetailWorklineItems(child),
      child,
    };
  }
  const workflowItem = runTranscriptWorkflowItems(view).find((item) => item.itemId === selected.id);
  if (workflowItem === undefined) {
    return undefined;
  }
  const detailWorkflowItem = workflowItemFromTaskPlanItem(workflowItem);
  return {
    kind: selected.kind,
    detailId: selected.id,
    title: workflowItem.title,
    status: workflowItem.status,
    summary: workflowItem.detail ?? workflowItem.title,
    workflowItems: [detailWorkflowItem],
    worklineItems: deepWorklineItems([detailWorkflowItem]),
  };
}

export function deepChildWorkflowHasRenderableSegments(
  child: DeepRunChildSummaryViewModel,
  fallbackItems: readonly DeepWorklineItemViewModel[],
): boolean {
  return deepChildAgentWorkflowSegments(child, fallbackItems).length > 0;
}

export function deepChildAgentWorkflowSegments(
  child: DeepRunChildSummaryViewModel,
  fallbackItems: readonly DeepWorklineItemViewModel[],
): readonly DeepChildAgentWorkflowSegment[] {
  const childRun = child.childRun;
  const segments = childRun === undefined
    ? deepChildAgentWorkflowSegmentsFromItems(fallbackItems)
    : deepChildAgentWorkflowSegmentsFromRun(child, childRun);
  return appendLatestResultWorkflowSegment(child, mergeAdjacentChildAgentActivitySegments(segments));
}

function deepChildAgentWorkflowSegmentsFromRun(
  child: DeepRunChildSummaryViewModel,
  childRun: DeepChildAgentRunView,
): readonly DeepChildAgentWorkflowSegment[] {
  const segments: DeepChildAgentWorkflowSegment[] = [];
  for (const instruction of childRun.parentInstructions ?? []) {
    const instructionText = instruction.instructionSummary.trim();
    if (instructionText.length > 0) {
      segments.push({
        kind: "model",
        segmentId: `parent-instruction:${childRun.childRunId}:${instruction.instructionId}`,
        text: instructionText,
        tone: "narration",
      });
    }
  }
  for (const [segmentIndex, segment] of (childRun.executionHistory ?? []).entries()) {
    appendExecutionSegmentWorkflow(segments, childRun.childRunId, segmentIndex, segment, segment.recordedAt);
  }
  if ((childRun.executionHistory?.length ?? 0) === 0 && childRun.execution !== undefined) {
    appendExecutionSegmentWorkflow(
      segments,
      childRun.childRunId,
      "latest",
      childRun.execution,
      childRun.completedAt ?? child.updatedAt,
    );
  }
  return segments;
}

function appendExecutionSegmentWorkflow(
  segments: DeepChildAgentWorkflowSegment[],
  childRunId: string,
  segmentIndex: string | number,
  execution: DeepChildAgentRunExecutionView,
  recordedAt: string,
): void {
  const emittedToolCallIds = new Set<string>();
  const messages = execution.modelMessages ?? [];
  for (const [messageIndex, message] of messages.entries()) {
    const messageText = childModelMessageText(message);
    if (messageText !== undefined) {
      segments.push({
        kind: "model",
        segmentId: `model:${childRunId}:${segmentIndex}:${message.responseId ?? message.requestId}:${messageIndex}`,
        text: messageText,
        tone: message.status === "failed" || message.status === "cancelled" ? "system" : "thinking",
      });
    }
    const matchedCalls = matchingToolCalls(message.toolCallIds, execution.toolCalls);
    if (matchedCalls.length > 0) {
      for (const call of matchedCalls) {
        emittedToolCallIds.add(call.callId);
      }
      segments.push(toolActivityWorkflowSegment(childRunId, segmentIndex, `message:${messageIndex}`, matchedCalls, recordedAt));
    }
  }
  const remainingCalls = execution.toolCalls.filter((call) => !emittedToolCallIds.has(call.callId));
  if (remainingCalls.length > 0) {
    segments.push(toolActivityWorkflowSegment(childRunId, segmentIndex, "remaining", remainingCalls, recordedAt));
  }
}

function toolActivityWorkflowSegment(
  childRunId: string,
  segmentIndex: string | number,
  groupId: string,
  toolCalls: readonly DeepChildAgentRunToolCallTraceView[],
  recordedAt: string,
): DeepChildAgentWorkflowSegment {
  return {
    kind: "activity",
    segmentId: `tools:${childRunId}:${segmentIndex}:${groupId}`,
    items: toolCalls.map((call, callIndex) => childToolCallWorklineItem(childRunId, segmentIndex, callIndex, call, recordedAt)),
    lifecycle: toolCalls.some((call) => call.status === "approval_required" || call.status === "failed" || call.status === "cancelled")
      ? "attention"
      : "settled",
  };
}

function deepChildAgentWorkflowSegmentsFromItems(
  items: readonly DeepWorklineItemViewModel[],
): readonly DeepChildAgentWorkflowSegment[] {
  const segments: DeepChildAgentWorkflowSegment[] = [];
  let pendingTools: DeepWorklineItemViewModel[] = [];
  let groupIndex = 0;
  const flushTools = (): void => {
    if (pendingTools.length === 0) {
      return;
    }
    segments.push({
      kind: "activity",
      segmentId: `tools:projection:${groupIndex}`,
      items: pendingTools,
      lifecycle: workflowLifecycleForToolItems(pendingTools),
    });
    pendingTools = [];
    groupIndex += 1;
  };
  for (const item of items) {
    if (isToolWorklineItem(item)) {
      pendingTools.push(item);
      continue;
    }
    flushTools();
    if (isModelWorklineItem(item) || item.itemId.startsWith("latest-result:") || item.itemId.startsWith("parent-instruction:")) {
      const text = item.detail?.trim();
      if (text !== undefined && text.length > 0) {
        segments.push({
          kind: "model",
          segmentId: item.itemId,
          text,
          tone: item.tone === "system" ? "system" : item.tone === "thinking" ? "thinking" : "narration",
        });
      }
    }
  }
  flushTools();
  return segments;
}

function isToolWorklineItem(item: DeepWorklineItemViewModel): boolean {
  return item.itemId.startsWith("tool:") || item.itemId.startsWith("tool-waiting:") || item.tone === "tool";
}

function isModelWorklineItem(item: DeepWorklineItemViewModel): boolean {
  return item.itemId.startsWith("model:") || item.tone === "thinking";
}

function workflowLifecycleForToolItems(items: readonly DeepWorklineItemViewModel[]): "open" | "settled" | "attention" {
  if (items.some((item) => item.status === "failed" || item.status === "blocked" || item.status === "interrupted" || item.status === "cancelled")) {
    return "attention";
  }
  if (items.some((item) => item.status === "running" || item.status === "pending")) {
    return "open";
  }
  return "settled";
}

function mergeAdjacentChildAgentActivitySegments(
  segments: readonly DeepChildAgentWorkflowSegment[],
): readonly DeepChildAgentWorkflowSegment[] {
  const merged: DeepChildAgentWorkflowSegment[] = [];
  for (const segment of segments) {
    const previous = merged.at(-1);
    if (segment.kind === "activity" && previous?.kind === "activity") {
      merged[merged.length - 1] = {
        kind: "activity",
        segmentId: `${previous.segmentId}+${segment.segmentId}`,
        items: [...previous.items, ...segment.items],
        lifecycle: mergeChildAgentActivityLifecycle(previous.lifecycle, segment.lifecycle),
      };
      continue;
    }
    merged.push(segment);
  }
  return merged;
}

function mergeChildAgentActivityLifecycle(
  left: Extract<DeepChildAgentWorkflowSegment, { readonly kind: "activity" }>["lifecycle"],
  right: Extract<DeepChildAgentWorkflowSegment, { readonly kind: "activity" }>["lifecycle"],
): Extract<DeepChildAgentWorkflowSegment, { readonly kind: "activity" }>["lifecycle"] {
  if (left === "attention" || right === "attention") {
    return "attention";
  }
  if (left === "open" || right === "open") {
    return "open";
  }
  return "settled";
}

function appendLatestResultWorkflowSegment(
  child: DeepRunChildSummaryViewModel,
  segments: readonly DeepChildAgentWorkflowSegment[],
): readonly DeepChildAgentWorkflowSegment[] {
  const resultText = childMaterialResultText(child);
  if (resultText === undefined) {
    return segments;
  }
  const normalized = resultText.replace(/\s+/g, " ");
  const alreadyShown = segments.some((segment) =>
    segment.kind === "model" && segment.text.replace(/\s+/g, " ") === normalized
  );
  if (alreadyShown) {
    return segments;
  }
  return [
    ...segments,
    {
      kind: "model",
      segmentId: `latest-result:${child.childRunId}`,
      text: resultText,
      tone: child.status === "failed" || child.status === "blocked" || child.status === "interrupted" || child.status === "cancelled"
        ? "system"
        : "narration",
    },
  ];
}

function childMaterialResultText(child: DeepRunChildSummaryViewModel): string | undefined {
  const sections: string[] = [];
  const findings = child.findings.map((finding) => finding.trim()).filter((finding) => finding.length > 0);
  const evidenceRefs = child.evidenceRefs.map((ref) => ref.trim()).filter((ref) => ref.length > 0);
  const uncertainty = meaningfulChildResultText(child.uncertainty);
  const summary = meaningfulChildResultText(child.latestResult, child.objective);
  if (summary !== undefined) {
    sections.push(summary);
  }
  if (findings.length > 0) {
    sections.push(`发现：\n${findings.map((finding) => `- ${finding}`).join("\n")}`);
  }
  if (uncertainty !== undefined && uncertainty.length > 0) {
    sections.push(`不确定性：${uncertainty}`);
  }
  if (evidenceRefs.length > 0) {
    sections.push(`证据：${evidenceRefs.join("、")}`);
  }
  return sections.length === 0 ? undefined : sections.join("\n\n");
}

function childDetailWorklineItems(child: DeepRunChildSummaryViewModel): readonly DeepWorklineItemViewModel[] {
  const projectionItems = deepWorklineItems(child.workflowItems);
  const childRunItems = childRunWorklineItems(child);
  const itemById = new Map<string, DeepWorklineItemViewModel>();
  for (const item of projectionItems) {
    itemById.set(item.itemId, item);
  }
  for (const item of childRunItems) {
    itemById.set(item.itemId, item);
  }
  const items = [...childDetailVisibleWorklineItems(sortWorklineItems([...itemById.values()]))];
  const latestResult = meaningfulChildResultText(child.latestResult, child.objective);
  if (latestResult !== undefined && latestResult.length > 0 && !items.some((item) => item.detail === latestResult)) {
    items.push({
      itemId: `latest-result:${child.childRunId}`,
      title: "结果已返回",
      label: "结果",
      detail: latestResult,
      status: child.status === "completed" ? "completed" : child.status,
      timestamp: child.updatedAt,
      tone: child.status === "failed" || child.status === "blocked" || child.status === "interrupted" || child.status === "cancelled"
        ? "system"
        : "narration",
      phase: worklinePhase(child.status),
    });
  }
  return items;
}

function childDetailVisibleWorklineItems(
  items: readonly DeepWorklineItemViewModel[],
): readonly DeepWorklineItemViewModel[] {
  const concreteItems = items.filter(isChildDetailConcreteActionItem);
  if (concreteItems.length > 0) {
    return concreteItems;
  }
  const fallback = items.find((item) => item.itemId.startsWith("status:")) ??
    items.find((item) => item.itemId.startsWith("execution:")) ??
    items.find((item) => item.itemId.startsWith("objective:"));
  return fallback === undefined ? items : [fallback];
}

function isChildDetailConcreteActionItem(item: DeepWorklineItemViewModel): boolean {
  if (
    item.itemId.startsWith("model:") ||
    item.itemId.startsWith("tool:") ||
    item.itemId.startsWith("tool-waiting:") ||
    item.itemId.startsWith("parent-instruction:") ||
    item.itemId.startsWith("latest-result:")
  ) {
    return true;
  }
  return item.itemId.startsWith("status:") &&
    (item.status === "failed" ||
      item.status === "blocked" ||
      item.status === "interrupted" ||
      item.status === "cancelled");
}

function childRunWorklineItems(child: DeepRunChildSummaryViewModel): readonly DeepWorklineItemViewModel[] {
  const childRun = child.childRun;
  if (childRun === undefined) {
    return [];
  }
  const items: DeepWorklineItemViewModel[] = [];
  if (child.objective.trim().length > 0) {
    items.push({
      itemId: `objective:${childRun.childRunId}`,
      title: "目标已明确",
      label: "目标",
      detail: child.objective,
      status: "completed",
      timestamp: childRun.startedAt,
      tone: "narration",
      phase: "completed",
    });
  }
  for (const instruction of childRun.parentInstructions ?? []) {
    items.push(parentInstructionWorklineItem(childRun.childRunId, instruction));
  }
  for (const [segmentIndex, segment] of (childRun.executionHistory ?? []).entries()) {
    const segmentModelItems: DeepWorklineItemViewModel[] = [];
    for (const [messageIndex, message] of (segment.modelMessages ?? []).entries()) {
      const item = childModelMessageWorklineItem(childRun.childRunId, segmentIndex, messageIndex, message);
      if (item !== undefined) {
        segmentModelItems.push(item);
      }
    }
    items.push(...segmentModelItems);
    for (const [callIndex, call] of segment.toolCalls.entries()) {
      items.push(childToolCallWorklineItem(childRun.childRunId, segmentIndex, callIndex, call, segment.recordedAt));
    }
    items.push(executionSegmentWorklineItem(childRun.childRunId, segmentIndex, segment));
  }
  if ((childRun.executionHistory?.length ?? 0) === 0 && childRun.execution !== undefined) {
    const recordedAt = childRun.completedAt ?? child.updatedAt;
    const latestModelItems: DeepWorklineItemViewModel[] = [];
    for (const [messageIndex, message] of (childRun.execution.modelMessages ?? []).entries()) {
      const item = childModelMessageWorklineItem(childRun.childRunId, "latest", messageIndex, message);
      if (item !== undefined) {
        latestModelItems.push(item);
      }
    }
    items.push(...latestModelItems);
    for (const [callIndex, call] of childRun.execution.toolCalls.entries()) {
      items.push(childToolCallWorklineItem(childRun.childRunId, "latest", callIndex, call, recordedAt));
    }
    items.push({
      itemId: `execution:${childRun.childRunId}`,
      title: child.status === "running" ? "正在探索" : "已产生执行结果",
      label: "模型",
      detail: `模型 ${childRun.execution.modelRounds} 轮，工具 ${childRun.execution.toolRounds} 次`,
      status: child.status === "running" ? "running" : "completed",
      timestamp: recordedAt,
      tone: "thinking",
      phase: child.status === "running" ? "executing" : "completed",
      toolKind: "thinking",
    });
  }
  if (childRun.pendingApproval !== undefined) {
    items.push(childPendingApprovalWorklineItem(childRun.childRunId, childRun.pendingApproval));
  }
  items.push(childRunStatusWorklineItem(child, childRun));
  return sortWorklineItems(items);
}

function childModelMessageWorklineItem(
  childRunId: string,
  segmentIndex: string | number,
  messageIndex: number,
  message: DeepChildAgentRunModelMessageTraceView,
): DeepWorklineItemViewModel | undefined {
  const detail = childModelMessageText(message);
  if (detail === undefined) {
    return undefined;
  }
  const status: DeepLiveChildWorkflowItem["status"] =
    message.status === "completed"
      ? "completed"
      : message.status === "cancelled"
        ? "cancelled"
        : "failed";
  return {
    itemId: `model:${childRunId}:${segmentIndex}:${message.responseId ?? message.requestId}:${messageIndex}`,
    title: childModelMessageTitle(message, messageIndex),
    label: message.reasoningSummary !== undefined && message.text === undefined ? "推理" : "模型",
    detail,
    status,
    timestamp: message.completedAt,
    tone: status === "failed" || status === "cancelled" ? "system" : "thinking",
    phase: worklinePhase(status),
    toolKind: status === "failed" || status === "cancelled" ? "system" : "thinking",
  };
}

function childModelMessageText(message: DeepChildAgentRunModelMessageTraceView): string | undefined {
  const text = message.text?.trim();
  if (text !== undefined && text.length > 0) {
    return childMaterialTextFromModelOutput(text) ?? text;
  }
  const reasoning = message.reasoningSummary?.trim();
  if (reasoning !== undefined && reasoning.length > 0) {
    return reasoning;
  }
  return undefined;
}

function childMaterialTextFromModelOutput(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  return childMaterialTextFromUnknown(parsed);
}

function childMaterialTextFromUnknown(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const sections: string[] = [];
  const summary = stringField(value, "summary");
  if (summary !== undefined) {
    sections.push(summary);
  }
  const findings = arrayField(value, "findings").map(formatChildMaterialFinding).filter(isNonEmptyString);
  if (findings.length > 0) {
    sections.push(`发现：\n${findings.map((finding) => `- ${finding}`).join("\n")}`);
  }
  const uncertainty = childMaterialUncertaintyText(value.uncertainty);
  if (uncertainty !== undefined) {
    sections.push(`不确定性：${uncertainty}`);
  }
  const evidenceRefs = arrayField(value, "evidenceRefs").map(formatChildMaterialEvidenceRef).filter(isNonEmptyString);
  if (evidenceRefs.length > 0) {
    sections.push(`证据：${evidenceRefs.join("、")}`);
  }
  return sections.length === 0 ? undefined : sections.join("\n\n");
}

function formatChildMaterialFinding(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const title = stringField(value, "title");
  const detail = stringField(value, "detail");
  const applicability = stringField(value, "applicability");
  const text = [title, detail].filter(isNonEmptyString).join("：");
  if (text.length === 0) {
    return applicability;
  }
  return applicability === undefined ? text : `${text}（${applicability}）`;
}

function formatChildMaterialEvidenceRef(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const path = stringField(value, "path");
  const type = stringField(value, "type");
  const notes = stringField(value, "notes");
  const head = path ?? type;
  if (head === undefined) {
    return notes;
  }
  return notes === undefined ? head : `${head}（${notes}）`;
}

function childMaterialUncertaintyText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(isNonEmptyString);
  return items.length === 0 ? undefined : items.join("；");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function arrayField(record: Record<string, unknown>, key: string): readonly unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function isNonEmptyString(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function matchingToolCalls(
  toolCallIds: readonly string[],
  toolCalls: readonly DeepChildAgentRunToolCallTraceView[],
): readonly DeepChildAgentRunToolCallTraceView[] {
  if (toolCallIds.length === 0) {
    return [];
  }
  const ids = new Set(toolCallIds);
  const matched = toolCalls.filter((call) => ids.has(call.callId));
  return matched.length > 0 ? matched : [];
}

function childModelMessageTitle(
  message: DeepChildAgentRunModelMessageTraceView,
  messageIndex: number,
): string {
  if ((message.toolCallIds?.length ?? 0) > 0) {
    return "工具调用前说明";
  }
  return `模型回答 ${messageIndex + 1}`;
}

function parentInstructionWorklineItem(
  childRunId: string,
  instruction: DeepChildAgentRunParentInstructionView,
): DeepWorklineItemViewModel {
  const status = parentInstructionWorkflowStatus(instruction.status);
  return {
    itemId: `parent-instruction:${childRunId}:${instruction.instructionId}`,
    title: parentInstructionTitle(instruction.status),
    label: "补充",
    detail: instruction.instructionSummary,
    status,
    timestamp: instruction.executedAt ?? instruction.cancelledAt ?? instruction.queuedAt ?? instruction.requestedAt,
    tone: instruction.status === "queued" ? "confirmation" : "narration",
    phase: worklinePhase(status),
  };
}

function childToolCallWorklineItem(
  childRunId: string,
  segmentIndex: string | number,
  callIndex: number,
  call: DeepChildAgentRunToolCallTraceView,
  recordedAt: string,
): DeepWorklineItemViewModel {
  const status = childToolCallWorkflowStatus(call.status);
  const projected = toolCallActivityItem(childRunId, segmentIndex, callIndex, call, recordedAt);
  const toolKind = projected?.toolKind ?? toolKindFromName(call.toolName);
  const detail = projected?.copy.detail ?? call.summary ?? call.inputSummary ?? childToolCallStatusLabel(call.status);
  return {
    itemId: `tool:${childRunId}:${segmentIndex}:${call.callId || callIndex}`,
    title: call.toolName,
    label: projected?.copy.label ?? toolLabelForKind(toolKind),
    detail,
    status,
    timestamp: recordedAt,
    tone: projected?.tone ?? "tool",
    phase: projected?.phase ?? worklinePhase(status),
    toolKind,
    badges: mergeActivityBadges(projected?.badges, toolCallBadges(call)),
    expandedSections: mergeExpandedSections(projected?.expandedSections, toolCallExpandedSections(call)),
  };
}

function toolCallActivityItem(
  childRunId: string,
  segmentIndex: string | number,
  callIndex: number,
  call: DeepChildAgentRunToolCallTraceView,
  recordedAt: string,
): ActivityItem | undefined {
  const node: TranscriptNode = {
    nodeId: `deep-tool:${childRunId}:${segmentIndex}:${call.callId || callIndex}`,
    runId: childRunId,
    sequence: toolCallSequence(segmentIndex, callIndex),
    eventType: toolCallEventType(call.status),
    kind: "tool",
    phase: toolCallTranscriptPhase(call.status),
    title: call.toolName,
    summary: call.summary ?? call.inputSummary ?? childToolCallStatusLabel(call.status),
    timestamp: recordedAt,
    toolName: call.toolName,
    display: call.display,
    refs: call.callId.trim().length === 0 ? [] : [{ kind: "tool_call", id: call.callId }],
  };
  return displayActivityItemsForNodes([node])[0];
}

function toolCallSequence(segmentIndex: string | number, callIndex: number): number {
  if (typeof segmentIndex === "number") {
    return segmentIndex * 1_000 + callIndex;
  }
  return callIndex;
}

function toolCallEventType(status: DeepChildAgentRunToolCallTraceView["status"]): string {
  if (status === "completed") {
    return "tool.completed";
  }
  if (status === "approval_required") {
    return "tool.requested";
  }
  return "tool.failed";
}

function toolCallTranscriptPhase(
  status: DeepChildAgentRunToolCallTraceView["status"],
): TranscriptNode["phase"] {
  switch (status) {
    case "completed":
      return "completed";
    case "approval_required":
      return "blocked";
    case "cancelled":
      return "cancelled";
    case "failed":
    default:
      return "failed";
  }
}

function mergeActivityBadges(
  left: readonly ActivityBadge[] | undefined,
  right: readonly ActivityBadge[] | undefined,
): readonly ActivityBadge[] | undefined {
  const badges = [...(left ?? []), ...(right ?? [])];
  const seen = new Set<string>();
  const merged: ActivityBadge[] = [];
  for (const badge of badges) {
    const key = `${badge.label.trim()}\u0000${badge.tone ?? ""}\u0000${badge.monospace === true ? "1" : "0"}`;
    if (badge.label.trim().length === 0 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(badge);
  }
  return merged.length === 0 ? undefined : merged;
}

function mergeExpandedSections(
  left: readonly ActivityExpandedSection[] | undefined,
  right: readonly ActivityExpandedSection[] | undefined,
): readonly ActivityExpandedSection[] | undefined {
  const sections = [...(left ?? []), ...(right ?? [])];
  const seen = new Set<string>();
  const merged: ActivityExpandedSection[] = [];
  for (const section of sections) {
    const title = section.title.trim();
    const content = section.content.trim();
    const key = `${title}\u0000${content}`;
    if (title.length === 0 || content.length === 0 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push({ ...section, title, content });
  }
  return merged.length === 0 ? undefined : merged;
}

function toolCallBadges(call: DeepChildAgentRunToolCallTraceView): readonly ActivityBadge[] | undefined {
  const badges: ActivityBadge[] = [];
  if (call.durationMs !== undefined && Number.isFinite(call.durationMs)) {
    badges.push({ label: durationLabel(call.durationMs), monospace: true });
  }
  if (call.status === "completed") {
    badges.push({ label: "已完成", tone: "success" });
  } else if (call.status === "failed") {
    badges.push({ label: "失败", tone: "danger" });
  } else if (call.status === "approval_required") {
    badges.push({ label: "待确认", tone: "warning" });
  } else if (call.status === "cancelled") {
    badges.push({ label: "已取消", tone: "warning" });
  }
  return badges.length === 0 ? undefined : badges;
}

function toolCallExpandedSections(
  call: DeepChildAgentRunToolCallTraceView,
): readonly ActivityExpandedSection[] | undefined {
  const sections: ActivityExpandedSection[] = [];
  if (call.inputSummary !== undefined) {
    sections.push({ title: "输入", content: call.inputSummary, format: "code" });
  }
  if (call.summary !== undefined) {
    sections.push({
      title: call.status === "failed" ? "失败" : "结果",
      content: call.summary,
      tone: call.status === "failed" ? "danger" : undefined,
    });
  }
  return sections.length === 0 ? undefined : sections;
}

function durationLabel(value: number): string {
  if (value < 1_000) {
    return `${Math.max(0, Math.round(value))}ms`;
  }
  const seconds = value / 1_000;
  const rounded = seconds < 10 ? seconds.toFixed(1) : Math.round(seconds).toString();
  return `${rounded.replace(/\.0$/, "")}s`;
}

function executionSegmentWorklineItem(
  childRunId: string,
  segmentIndex: number,
  segment: DeepChildAgentRunExecutionSegmentView,
): DeepWorklineItemViewModel {
  return {
    itemId: `segment:${childRunId}:${segmentIndex}`,
    title: executionSegmentTitle(segment.outcome),
    label: "模型",
    detail: `模型 ${segment.modelRounds} 轮，工具 ${segment.toolRounds} 次`,
    status: segment.outcome,
    timestamp: segment.recordedAt,
    tone: segment.outcome === "completed" ? "thinking" : "system",
    phase: worklinePhase(segment.outcome),
    toolKind: segment.outcome === "completed" ? "thinking" : "system",
  };
}

function childPendingApprovalWorklineItem(
  childRunId: string,
  pendingApproval: DeepChildAgentRunPendingApprovalView,
): DeepWorklineItemViewModel {
  const toolKind = toolKindFromName(pendingApproval.toolName);
  return {
    itemId: `tool-waiting:${childRunId}:${pendingApproval.confirmationId}`,
    title: pendingApproval.toolName,
    label: toolLabelForKind(toolKind),
    detail: pendingApproval.actionSummary,
    status: "blocked",
    timestamp: pendingApproval.requestedAt,
    tone: "confirmation",
    phase: "blocked",
    toolKind,
  };
}

function childRunStatusWorklineItem(
  child: DeepRunChildSummaryViewModel,
  childRun: DeepChildAgentRunView,
): DeepWorklineItemViewModel {
  const status = childWorkflowStatus(childRun.status);
  const detail = childRun.failureReason ??
    meaningfulChildResultText(child.latestResult, child.objective) ??
    meaningfulChildResultText(child.summary, child.objective);
  return {
    itemId: `status:${childRun.childRunId}:${childRun.status}`,
    title: childRunStatusTitle(childRun.status),
    label: "状态",
    detail,
    status,
    timestamp: childRun.completedAt ?? child.updatedAt,
    tone: status === "failed" || status === "blocked" || status === "interrupted" || status === "cancelled" ? "system" : "narration",
    phase: worklinePhase(status),
  };
}

function childWorkflowStatus(status: DeepChildRunStatus): DeepLiveChildWorkflowItem["status"] {
  switch (status) {
    case "planned":
      return "pending";
    case "running":
    case "resumed":
      return "running";
    case "blocked":
      return "blocked";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "interrupted":
      return "interrupted";
    default:
      return "pending";
  }
}

function parentInstructionWorkflowStatus(
  status: DeepChildAgentRunParentInstructionView["status"],
): DeepLiveChildWorkflowItem["status"] {
  if (status === "queued") {
    return "pending";
  }
  if (status === "cancelled") {
    return "cancelled";
  }
  return "completed";
}

function parentInstructionTitle(status: DeepChildAgentRunParentInstructionView["status"]): string {
  if (status === "queued") {
    return "收到补充要求";
  }
  if (status === "cancelled") {
    return "补充要求已取消";
  }
  return "执行补充要求";
}

function childToolCallWorkflowStatus(
  status: DeepChildAgentRunToolCallTraceView["status"],
): DeepLiveChildWorkflowItem["status"] {
  switch (status) {
    case "completed":
      return "completed";
    case "approval_required":
      return "blocked";
    case "cancelled":
      return "cancelled";
    case "failed":
    default:
      return "failed";
  }
}

function childToolCallStatusLabel(status: DeepChildAgentRunToolCallTraceView["status"]): string {
  switch (status) {
    case "completed":
      return "完成";
    case "failed":
      return "失败";
    case "approval_required":
      return "等待确认";
    case "cancelled":
      return "已取消";
    default:
      return status;
  }
}

function executionSegmentTitle(outcome: DeepChildAgentRunExecutionSegmentView["outcome"]): string {
  switch (outcome) {
    case "completed":
      return "模型回合完成";
    case "blocked":
      return "模型回合等待处理";
    case "failed":
      return "模型回合失败";
    case "interrupted":
      return "模型回合中断";
    default:
      return "模型回合";
  }
}

function childRunStatusTitle(status: DeepChildRunStatus): string {
  switch (status) {
    case "planned":
      return "等待启动";
    case "running":
    case "resumed":
      return "正在探索";
    case "blocked":
      return "等待处理";
    case "completed":
      return "结果已返回";
    case "failed":
      return "未完成";
    case "interrupted":
      return "已中断";
    default:
      return "状态更新";
  }
}

function sortWorklineItems(
  items: readonly DeepWorklineItemViewModel[],
): readonly DeepWorklineItemViewModel[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const timestampOrder = left.item.timestamp.localeCompare(right.item.timestamp);
      return timestampOrder === 0 ? left.index - right.index : timestampOrder;
    })
    .map(({ item }) => item);
}

function workflowItemFromTaskPlanItem(item: DeepTaskPlanItemViewModel): DeepLiveChildWorkflowItem {
  return {
    itemId: item.itemId,
    kind: item.status === "running" ? "running" : item.status === "failed" ? "failed" : item.status === "interrupted" ? "interrupted" : "completed",
    title: item.title,
    detail: item.detail,
    status: item.status,
    timestamp: item.timestamp,
  };
}

function deepWorklineItems(items: readonly DeepLiveChildWorkflowItem[]): readonly DeepWorklineItemViewModel[] {
  return items.map(deepWorklineItem);
}

function deepWorklineItem(item: DeepLiveChildWorkflowItem): DeepWorklineItemViewModel {
  const toolName = workflowItemToolName(item);
  const toolKind = toolKindFromName(toolName);
  return {
    itemId: item.itemId,
    title: worklineTitle(item, toolName),
    label: worklineLabel(item, toolName),
    detail: worklineDetail(item, toolName),
    status: item.status,
    timestamp: item.timestamp,
    tone: worklineTone(item, toolKind),
    phase: worklinePhase(item.status),
    toolKind,
  };
}

function worklineLabel(item: DeepLiveChildWorkflowItem, toolName: string | undefined): string {
  if (toolName !== undefined) {
    return toolLabelForKind(toolKindFromName(toolName));
  }
  switch (item.kind) {
    case "objective_set":
      return "目标";
    case "model_message":
      return "模型";
    case "running":
      return "运行";
    case "parent_message_queued":
    case "parent_message_applied":
      return "补充";
    case "completed":
      return "结果";
    case "blocked":
    case "interrupted":
    case "failed":
      return "状态";
    case "tool_waiting":
    case "tool_completed":
      return "工具";
    default:
      return "工作";
  }
}

function workflowItemToolName(item: DeepLiveChildWorkflowItem): string | undefined {
  const detail = item.detail?.trim();
  const detailMatch = detail?.match(/^([a-zA-Z][\w.-]{1,40})\s*[:：]/);
  if (detailMatch?.[1]) {
    return detailMatch[1];
  }
  const kind = item.kind.trim();
  if (/^(search|read|edit|write|command|shell|web|list_dir|grep|rg)$/i.test(kind)) {
    return kind;
  }
  return undefined;
}

function toolKindFromName(toolName: string | undefined): DeepWorklineItemViewModel["toolKind"] | undefined {
  if (toolName === undefined) {
    return undefined;
  }
  const normalized = toolName.toLowerCase();
  if (normalized.includes("search") || normalized === "rg" || normalized === "grep") {
    return "search";
  }
  if (normalized.includes("read") || normalized === "cat" || normalized === "list_dir") {
    return "read";
  }
  if (normalized.includes("edit") || normalized.includes("write") || normalized.includes("patch")) {
    return "edit";
  }
  if (normalized.includes("web") || normalized.includes("browser")) {
    return "web";
  }
  if (normalized.includes("command") || normalized.includes("shell") || normalized === "exec") {
    return "command";
  }
  return "other";
}

function toolLabelForKind(toolKind: DeepWorklineItemViewModel["toolKind"] | undefined): string {
  switch (toolKind) {
    case "command":
      return "命令";
    case "search":
      return "搜索";
    case "read":
      return "读取";
    case "edit":
      return "编辑";
    case "web":
      return "网页";
    case "confirmation":
      return "确认";
    default:
      return "工具";
  }
}

function worklineTitle(item: DeepLiveChildWorkflowItem, toolName: string | undefined): string {
  if (toolName !== undefined) {
    return toolName;
  }
  return item.title;
}

function worklineDetail(item: DeepLiveChildWorkflowItem, toolName: string | undefined): string | undefined {
  if (toolName !== undefined) {
    return workflowToolStatusDetail(item, toolName);
  }
  return item.detail;
}

function workflowToolStatusDetail(
  item: DeepLiveChildWorkflowItem,
  _toolName: string,
): string | undefined {
  const detail = item.detail?.trim();
  if (detail !== undefined && detail.length > 0) {
    const prefixed = detail.match(/^[^:：]+[:：]\s*(.+)$/);
    return prefixed?.[1]?.trim() || detail;
  }
  return visibleWorkflowStatusLabel(item.status);
}

function worklineTone(
  item: DeepLiveChildWorkflowItem,
  toolKind: DeepWorklineItemViewModel["toolKind"] | undefined,
): DeepWorklineItemViewModel["tone"] {
  if (toolKind !== undefined) {
    return "tool";
  }
  if (item.status === "pending") {
    return "confirmation";
  }
  if (item.status === "failed" || item.status === "blocked" || item.status === "interrupted") {
    return "system";
  }
  if (item.kind.includes("decision")) {
    return "decision";
  }
  if (item.kind === "model_message") {
    return "thinking";
  }
  if (item.kind.includes("running") || item.status === "running") {
    return "thinking";
  }
  return "narration";
}

function worklinePhase(status: DeepLiveChildWorkflowItem["status"]): DeepWorklineItemViewModel["phase"] {
  switch (status) {
    case "running":
      return "executing";
    case "failed":
      return "failed";
    case "interrupted":
      return "failed";
    case "blocked":
      return "blocked";
    case "pending":
      return "waiting_approval";
    case "cancelled":
      return "cancelled";
    case "completed":
    default:
      return "completed";
  }
}

export function synthesisReviewLabel(review: DeepParentSynthesisChildReviewView): string {
  if (review.decision === "accepted") {
    return `已采纳：${review.reason}`;
  }
  if (review.decision === "rejected") {
    return `未采纳：${review.reason}`;
  }
  return `待继续跟进：${review.reason}`;
}
