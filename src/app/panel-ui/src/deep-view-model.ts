import {
  type ActivityBadge,
  type ActivityExpandedSection,
  type ActivityItem,
} from "../../panel-transcript-activity-copy.js";
import type {
  DeepChildAgentRunView,
  DeepChildRunStatus,
  DeepConclusionView,
  DeepChildSummaryView,
  DeepLiveChildProjection,
  DeepLiveChildWorkflowItem,
  DeepLiveDecisionProjection,
  DeepParentSynthesisChildReviewView,
  DeepRunView,
} from "./contracts/deep.js";

export type DeepTaskPlanItemViewModel = {
  readonly itemId: string;
  readonly kind: string;
  readonly title: string;
  readonly detail?: string;
  readonly status: DeepLiveChildWorkflowItem["status"];
  readonly timestamp: string;
};

export type DeepSelectedWorkItem = {
  readonly kind: "manager_step" | "child_agent" | "synthesis" | "conclusion";
  readonly id: string;
};

export type DeepRunChildSummaryViewModel = {
  readonly childRunId: string;
  readonly title: string;
  readonly status: DeepLiveChildWorkflowItem["status"];
  readonly summary: string;
  readonly objective: string;
  readonly latestResult?: string;
  readonly findings: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly uncertainty?: string;
  readonly confidence?: number;
  readonly updatedAt: string;
  readonly workflowItems: readonly DeepLiveChildWorkflowItem[];
  readonly childRun?: DeepChildAgentRunView;
  readonly needsAttention: boolean;
  readonly pendingApproval?: DeepLiveChildProjection["pendingApproval"];
  readonly synthesisReview?: DeepParentSynthesisChildReviewView;
};

export type DeepWorkItemDetailViewModel = {
  readonly kind: DeepSelectedWorkItem["kind"];
  readonly detailId: string;
  readonly title: string;
  readonly status: DeepLiveChildWorkflowItem["status"];
  readonly summary: string;
  readonly workflowItems: readonly DeepLiveChildWorkflowItem[];
  readonly worklineItems: readonly DeepWorklineItemViewModel[];
  readonly child?: DeepRunChildSummaryViewModel;
};

export type DeepWorklineItemViewModel = {
  readonly itemId: string;
  readonly title: string;
  readonly label: string;
  readonly detail?: string;
  readonly status: DeepLiveChildWorkflowItem["status"];
  readonly timestamp: string;
  readonly tone: ActivityItem["tone"];
  readonly phase: ActivityItem["phase"];
  readonly toolKind?: ActivityItem["toolKind"];
  readonly badges?: readonly ActivityBadge[];
  readonly expandedSections?: readonly ActivityExpandedSection[];
};

export type DeepChildAgentWorkflowSegment =
  | {
      readonly kind: "model";
      readonly segmentId: string;
      readonly text: string;
      readonly tone: "thinking" | "narration" | "system";
    }
  | {
      readonly kind: "activity";
      readonly segmentId: string;
      readonly items: readonly DeepWorklineItemViewModel[];
      readonly lifecycle: "open" | "settled" | "attention";
    };

export function deepRunWorkItemExists(view: DeepRunView, selected: DeepSelectedWorkItem): boolean {
  if (selected.kind === "child_agent") {
    return childAgentSummaryItems(view).some((child) => child.childRunId === selected.id);
  }
  return runTranscriptWorkflowItems(view).some((item) => selectedWorkItemEquals(selected, {
    kind: item.kind === "summary" ? "synthesis" : item.kind === "result" ? "conclusion" : "manager_step",
    id: item.itemId,
  }));
}

export function visibleWorkflowStatusLabel(
  status: DeepLiveChildWorkflowItem["status"],
): string | undefined {
  if (status === "failed" || status === "blocked" || status === "interrupted" || status === "cancelled") {
    return workflowItemStatusLabel(status);
  }
  return undefined;
}

export function meaningfulChildResultText(value: string | undefined, objective?: string): string | undefined {
  const text = value?.trim();
  if (text === undefined || text.length === 0) {
    return undefined;
  }
  if (isNaturalChildStateText(text)) {
    return undefined;
  }
  const objectiveText = objective?.trim();
  if (objectiveText !== undefined && objectiveText.length > 0 && normalizeChildText(text) === normalizeChildText(objectiveText)) {
    return undefined;
  }
  return text;
}

export function childAgentSummaryItem(
  view: DeepRunView,
  childRunId: string,
): DeepRunChildSummaryViewModel {
  const liveChild = view.liveProjection.children.find((child) => child.childRunId === childRunId);
  const childRun = view.report?.agentRunTree.childRuns.find((child) => child.childRunId === childRunId);
  const childSummary = view.report?.childSummaries.find((child) => child.childRunId === childRunId);
  const synthesisReview = view.report?.synthesisRecords
    .flatMap((record) => record.childReviews ?? [])
    .find((review) => review.childRunId === childRunId);
  const status = liveChild?.status ?? childRun?.status ?? childSummary?.status ?? "planned";
  const objective = liveChild?.objective ?? childRun?.spec.instructions?.objective ?? childSummary?.spec.objective ?? "";
  const latestResult = meaningfulChildResultText(
    liveChild?.latestResult ?? liveChild?.summary ?? childSummary?.summary,
    objective,
  );
  const findings = childSummary?.findings ?? [];
  const evidenceRefs = childSummary?.evidenceRefs ?? childRun?.evidenceRefs ?? [];
  const uncertainty = liveChild?.uncertainty ?? childSummary?.uncertainty ?? childRun?.uncertainty;
  const confidence = liveChild?.confidence ?? childSummary?.confidence ?? childRun?.confidence;
  const pendingApproval = liveChild?.pendingApproval ?? childRun?.pendingApproval;
  const workflowItems = liveChild?.workflowItems ?? childSummaryWorkflowItems(childRun, childSummary, view.liveProjection.updatedAt);
  const title = displayAgentName(
    liveChild?.displayName ?? childRun?.spec.displayName ?? childSummary?.spec.displayName ?? `协作项 ${childRunId}`,
  );
  const childStatus = childWorkflowStatus(status);
  return {
    childRunId,
    title,
    status: childStatus,
    summary: latestResult ?? childFailureTextFromRecord(status, uncertainty ?? childRun?.failureReason) ?? objective,
    objective,
    latestResult,
    findings,
    evidenceRefs,
    uncertainty,
    confidence,
    updatedAt: liveChild?.updatedAt ?? childRun?.completedAt ?? childRun?.startedAt ?? workflowItems.at(-1)?.timestamp ?? view.liveProjection.updatedAt,
    workflowItems,
    childRun,
    needsAttention: childStatus === "blocked" || pendingApproval !== undefined,
    pendingApproval,
    synthesisReview,
  };
}

export function runTranscriptWorkflowItems(view: DeepRunView): readonly DeepTaskPlanItemViewModel[] {
  const items: DeepTaskPlanItemViewModel[] = [goalReceivedTaskPlanItem(view)];
  const decision = view.liveProjection.decision;
  if (view.brief !== undefined) {
    items.push({
      itemId: `brief:${view.run.runId}`,
      kind: "brief",
      title: "确认范围",
      detail: view.brief.scopeSummary,
      status: "completed",
      timestamp: view.run.startedAt,
    });
  }
  if (decision !== undefined) {
    items.push({
      itemId: `decision:${decision.decisionId}`,
      kind: "decision",
      title: runTranscriptDecisionTitle(decision.action),
      detail: decision.summary,
      status: decision.action === "wait_children" ? "pending" : decision.action === "stop" ? "completed" : "running",
      timestamp: decision.updatedAt,
    });
  }
  if (view.liveProjection.children.length > 0) {
    const childTone = childActivityTone(view.liveProjection.children);
    items.push({
      itemId: `children:${view.run.runId}`,
      kind: "children",
      title: "协作处理",
      detail: childActivityIntro(view.liveProjection.children),
      status: childTone === "complete" ? "completed" : childTone === "problem" ? "blocked" : "running",
      timestamp: view.liveProjection.updatedAt,
    });
  }
  const synthesis = parentSynthesisText(view);
  if (synthesis !== undefined) {
    items.push({
      itemId: `summary:${view.run.runId}`,
      kind: "summary",
      title: "整理结果",
      detail: synthesis,
      status: view.liveProjection.synthesis?.status === "pending" ? "pending" : "completed",
      timestamp: view.liveProjection.synthesis?.updatedAt ?? view.run.updatedAt,
    });
  }
  const conclusion = parentConclusionText(view.report?.conclusion, view.liveProjection.conclusion);
  if (conclusion !== undefined) {
    items.push({
      itemId: `result:${view.run.runId}`,
      kind: "result",
      title: "完成回答",
      detail: conclusion,
      status: "completed",
      timestamp: view.report?.conclusion?.createdAt ?? view.liveProjection.conclusion?.updatedAt ?? view.run.updatedAt,
    });
  }
  return items;
}

function workflowItemStatusLabel(status: DeepLiveChildWorkflowItem["status"]): string {
  switch (status) {
    case "pending":
      return "等待";
    case "running":
      return "进行中";
    case "completed":
      return "完成";
    case "blocked":
      return "待处理";
    case "failed":
      return "失败";
    case "interrupted":
      return "中断";
    case "cancelled":
      return "取消";
    default:
      return status;
  }
}

export function childAgentSummaryItems(view: DeepRunView): readonly DeepRunChildSummaryViewModel[] {
  const childRunIds = new Set<string>();
  for (const liveChild of view.liveProjection.children) {
    childRunIds.add(liveChild.childRunId);
  }
  for (const childRun of view.report?.agentRunTree.childRuns ?? []) {
    childRunIds.add(childRun.childRunId);
  }
  for (const childSummary of view.report?.childSummaries ?? []) {
    childRunIds.add(childSummary.childRunId);
  }
  return [...childRunIds].map((childRunId) => childAgentSummaryItem(view, childRunId));
}

function displayAgentName(value: string): string {
  if (value === "Deep Manager") {
    return "助手";
  }
  const childMatch = /^Deep Child (\d+)$/.exec(value);
  if (childMatch) {
    return `协作项 ${childMatch[1]}`;
  }
  return value;
}

function isNaturalChildStateText(value: string): boolean {
  const normalized = normalizeChildText(value);
  return normalized === "等待启动" ||
    normalized === "等待确认" ||
    normalized === "等待工具确认" ||
    normalized === "等待处理" ||
    normalized === "等待外部条件" ||
    normalized === "进行中" ||
    normalized === "正在探索" ||
    normalized === "结果已返回" ||
    normalized === "已产生执行结果" ||
    normalized === "已中断" ||
    normalized === "未完成" ||
    normalized === "执行未完成" ||
    normalized === "状态更新" ||
    normalized === "完成";
}

function normalizeChildText(value: string): string {
  return value.replace(/\s+/g, "");
}

function childSummaryWorkflowItems(
  childRun: DeepChildAgentRunView | undefined,
  childSummary: DeepChildSummaryView | undefined,
  updatedAt: string,
): readonly DeepLiveChildWorkflowItem[] {
  if (childRun === undefined && childSummary === undefined) {
    return [];
  }
  const childRunId = childRun?.childRunId ?? childSummary?.childRunId ?? "child";
  const objective = childRun?.spec.instructions?.objective ?? childSummary?.spec.objective ?? "";
  const summary = childSummary?.summary;
  return [
    {
      itemId: `objective:${childRunId}`,
      kind: "objective_set",
      title: "目标已明确",
      detail: objective,
      status: "completed",
      timestamp: childRun?.startedAt ?? updatedAt,
    },
    {
      itemId: `status:${childRunId}:${childRun?.status ?? childSummary?.status ?? "completed"}`,
      kind: childRun?.status === "blocked" || childRun?.status === "failed" || childRun?.status === "interrupted"
        ? childRun.status
        : "completed",
      title: childRun?.status === "blocked" ? "等待处理" : childRun?.status === "failed" ? "未完成" : "结果已返回",
      detail: childRun?.failureReason ?? summary,
      status: childRun?.status === "blocked" || childRun?.status === "failed" || childRun?.status === "interrupted"
        ? childRun.status
        : "completed",
      timestamp: childRun?.completedAt ?? updatedAt,
    },
  ];
}

function goalReceivedTaskPlanItem(view: DeepRunView): DeepTaskPlanItemViewModel {
  const goalEvent = view.eventSequence.find((event) => event.type === "deep.goal_received");
  return {
    itemId: `manager-goal:${view.run.runId}`,
    kind: "goal_received",
    title: "目标已接收",
    detail: view.run.goal,
    status: "completed",
    timestamp: goalEvent?.timestamp ?? view.run.startedAt,
  };
}

export function runWorkflowStatus(view: DeepRunView): DeepLiveChildWorkflowItem["status"] {
  switch (view.run.status) {
    case "pending":
      return "pending";
    case "running":
    case "corrected":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "interrupted":
    case "stopped":
      return "interrupted";
    default:
      return "running";
  }
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

function childFailureTextFromRecord(status: DeepChildRunStatus, detail: string | undefined): string | undefined {
  if (status !== "failed" && status !== "interrupted" && status !== "blocked") {
    return undefined;
  }
  return meaningfulChildResultText(detail);
}

export function parentDecisionText(view: DeepRunView): string | undefined {
  return view.liveProjection.decision?.summary;
}

function childActivityIntro(children: readonly DeepLiveChildProjection[]): string {
  const running = children.filter((child) => child.status === "running" || child.status === "resumed").length;
  const completed = children.filter((child) => child.status === "completed").length;
  const blocked = children.filter((child) => child.status === "blocked").length;
  if (running > 0) {
    return `我已经安排 ${children.length} 个协作项，正在等待其中 ${running} 个继续返回材料。`;
  }
  if (blocked > 0) {
    return `${blocked} 个协作项需要处理后才能继续，我会把可操作项列在下面。`;
  }
  if (completed === children.length) {
    return "协作项已全部返回，我会审查这些结论后再综合回答。";
  }
  return `我已经安排 ${children.length} 个协作项，并会把关键结论汇总回来。`;
}

function childActivityTone(children: readonly DeepLiveChildProjection[]): "current" | "complete" | "problem" {
  if (children.some((child) => child.status === "blocked" || child.status === "failed" || child.status === "interrupted")) {
    return "problem";
  }
  if (children.length > 0 && children.every((child) => child.status === "completed")) {
    return "complete";
  }
  return "current";
}

export function parentSynthesisText(view: DeepRunView): string | undefined {
  if (view.liveProjection.synthesis?.summary !== undefined) {
    return view.liveProjection.synthesis.summary;
  }
  const latestSynthesis = view.report?.synthesisRecords.at(-1);
  return latestSynthesis?.decisionSummary;
}

export function parentConclusionText(
  conclusion: DeepConclusionView | undefined,
  liveConclusion: DeepRunView["liveProjection"]["conclusion"],
): string | undefined {
  if (conclusion !== undefined) {
    return conclusion.conclusion;
  }
  return liveConclusion?.oneLineRationale;
}

export function conclusionNeedsResynthesis(view: DeepRunView, conclusionText: string | undefined): boolean {
  return conclusionText !== undefined && view.liveProjection.synthesis?.status === "pending";
}

function selectedWorkItemEquals(
  left: DeepSelectedWorkItem,
  right: DeepSelectedWorkItem,
): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function runTranscriptDecisionTitle(action: DeepLiveDecisionProjection["action"]): string {
  switch (action) {
    case "direct_answer":
      return "直接回答";
    case "spawn_children":
      return "安排协作";
    case "wait_children":
      return "等待结果";
    case "continue_child":
      return "补充协作项";
    case "synthesize":
      return "整理材料";
    case "ask_user":
      return "需要补充";
    case "stop":
      return "完成";
    default:
      return "继续处理";
  }
}

export function childAgentImportantSignal(child: DeepRunChildSummaryViewModel): string | undefined {
  const objective = compactWorklineText(child.objective, 150);
  const signal = childAgentSignalText(child);
  if (signal === undefined || signal === objective) {
    return undefined;
  }
  return signal;
}

function childAgentSignalText(child: DeepRunChildSummaryViewModel): string | undefined {
  if (child.pendingApproval !== undefined) {
    return compactWorklineText(child.pendingApproval.title || child.pendingApproval.actionSummary, 110);
  }
  const result = meaningfulChildResultText(child.latestResult ?? child.summary, child.objective);
  if (child.status === "completed") {
    return result === undefined ? undefined : compactWorklineText(result, 120);
  }
  if (child.status === "failed" || child.status === "blocked" || child.status === "interrupted" || child.status === "cancelled") {
    return result === undefined ? undefined : compactWorklineText(result, 120);
  }
  return child.latestResult === undefined || result === undefined ? undefined : compactWorklineText(result, 120);
}

export function compactWorklineText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}
