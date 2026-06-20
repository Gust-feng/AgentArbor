import type {
  ConfirmationRiskLevel,
  DesktopWorkViewReadModel,
  TranscriptNode,
} from "../domain/basic-agent/index.js";
import { commandDisplayText, type ToolDisplayProjection } from "../domain/tools/index.js";
import { displayActivityItemsForNodes } from "./panel-transcript-activity-copy.js";
import { activityVisibleNodes } from "./panel-transcript-node-projection.js";
import { redactOrdinaryMarkdownFragment, redactOrdinaryText } from "./safe-projection.js";

export type PanelRunResultStatus =
  | "queued"
  | "running"
  | "waiting_confirmation"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked";

export type PanelRunResultReadModel = {
  readonly runId: string;
  readonly conversationId?: string;
  readonly status: PanelRunResultStatus;
  readonly answer?: {
    readonly markdown: string;
    readonly copyText: string;
    readonly tone?: "live" | "final" | "error";
  };
  readonly actions: readonly PanelRunResultActionReadModel[];
  readonly evidence: {
    readonly files: readonly PanelRunResultFileEvidenceReadModel[];
    readonly commands: readonly PanelRunResultCommandEvidenceReadModel[];
    readonly sources: readonly PanelRunResultSourceEvidenceReadModel[];
  };
  readonly process: {
    readonly summary: string;
    readonly items: readonly PanelRunResultProcessItemReadModel[];
    readonly defaultCollapsed: boolean;
  };
  readonly confirmation?: PanelRunResultConfirmationReadModel;
};

export type PanelRunResultActionReadModel = {
  readonly id: string;
  readonly label: string;
  readonly kind: "next" | "confirm" | "retry" | "open_file" | "inspect";
  readonly status?: "available" | "pending" | "done";
};

export type PanelRunResultFileEvidenceReadModel = {
  readonly path: string;
  readonly kind: "created" | "modified" | "deleted" | "changed";
  readonly summary?: string;
  readonly preview?: string;
};

export type PanelRunResultCommandEvidenceReadModel = {
  readonly command?: string;
  readonly exitCode?: number;
  readonly summary?: string;
  readonly logRef?: string;
};

export type PanelRunResultSourceEvidenceReadModel = {
  readonly label: string;
  readonly ref?: string;
  readonly url?: string;
  readonly summary?: string;
};

export type PanelRunResultProcessItemReadModel = {
  readonly id: string;
  readonly label: string;
  readonly status: string;
  readonly kind: string;
};

export type PanelRunResultConfirmationReadModel = {
  readonly confirmationId: string;
  readonly title: string;
  readonly body: string;
  readonly riskLevel?: ConfirmationRiskLevel;
  readonly affectedResources: readonly string[];
};

export function createPanelRunResultReadModel(input: {
  readonly workView: DesktopWorkViewReadModel;
  readonly transcriptNodes?: readonly TranscriptNode[];
  readonly restoredResult?: {
    readonly title: string;
    readonly summary: string;
  };
}): PanelRunResultReadModel {
  const workView = input.workView;
  const nodes = input.transcriptNodes ?? workView.transcriptNodes;
  const displays = toolDisplaysForResult(workView, nodes);
  const confirmation = confirmationForResult(workView);
  const processItems = processItemsForResult(nodes);
  const answer = answerForResult(workView, input.restoredResult);

  return {
    runId: workView.run.runId,
    conversationId: workView.run.conversationId,
    status: statusForResult(workView),
    answer,
    actions: actionsForResult(workView, confirmation),
    evidence: {
      files: fileEvidenceForResult(displays),
      commands: commandEvidenceForResult(displays),
      sources: sourceEvidenceForResult(displays),
    },
    process: {
      summary: processSummaryForResult(workView, processItems),
      items: processItems,
      defaultCollapsed: workView.run.status === "completed" || workView.run.status === "cancelled",
    },
    confirmation,
  };
}

function statusForResult(workView: DesktopWorkViewReadModel): PanelRunResultStatus {
  if (workView.pendingConfirmation !== undefined || workView.run.status === "approval_needed") return "waiting_confirmation";
  if (workView.run.status === "queued") return "queued";
  if (workView.run.status === "completed") return "completed";
  if (workView.run.status === "failed") return "failed";
  if (workView.run.status === "cancelled") return "cancelled";
  if (workView.run.status === "blocked" || workView.run.status === "needs_input") return "blocked";
  return "running";
}

function answerForResult(
  workView: DesktopWorkViewReadModel,
  restoredResult: { readonly title: string; readonly summary: string } | undefined
): PanelRunResultReadModel["answer"] {
  const direct = workView.answer?.content;
  if (direct !== undefined && direct.trim().length > 0) {
    return {
      markdown: redactOrdinaryMarkdownFragment(direct, 128_000),
      copyText: redactOrdinaryText(direct, 128_000),
      tone: workView.run.status === "completed" ? "final" : "live",
    };
  }
  const deliverable = workView.deliverable;
  if (deliverable !== undefined) {
    const markdown = deliverableMarkdown(deliverable);
    if (markdown.trim().length > 0) {
      return {
        markdown: redactOrdinaryMarkdownFragment(markdown, 128_000),
        copyText: redactOrdinaryText(markdown, 128_000),
        tone: workView.run.status === "completed" ? "final" : "live",
      };
    }
  }
  const restoredSummary = restoredResult?.summary.trim();
  if (restoredSummary !== undefined && restoredSummary.length > 0) {
    return {
      markdown: redactOrdinaryMarkdownFragment(restoredSummary, 128_000),
      copyText: redactOrdinaryText(restoredSummary, 128_000),
      tone: workView.run.status === "completed" ? "final" : "live",
    };
  }
  if (workView.run.status === "failed" || workView.run.status === "blocked") {
    const text = workView.currentAction || workView.headline || "任务未完成。";
    return {
      markdown: redactOrdinaryMarkdownFragment(text, 2_000),
      copyText: redactOrdinaryText(text, 2_000),
      tone: "error",
    };
  }
  return undefined;
}

function deliverableMarkdown(deliverable: NonNullable<DesktopWorkViewReadModel["deliverable"]>): string {
  const parts = [deliverable.summary];
  for (const section of deliverable.sections) {
    parts.push(`## ${section.title}\n\n${section.content}`);
  }
  return parts.filter((part) => part.trim().length > 0).join("\n\n");
}

function actionsForResult(
  workView: DesktopWorkViewReadModel,
  confirmation: PanelRunResultConfirmationReadModel | undefined
): readonly PanelRunResultActionReadModel[] {
  const actions: PanelRunResultActionReadModel[] = [];
  if (confirmation !== undefined) {
    actions.push({
      id: `confirm:${confirmation.confirmationId}`,
      label: "确认继续",
      kind: "confirm",
      status: "pending",
    });
  }
  const nextActions = uniqueStrings([
    ...(workView.deliverable?.nextActions ?? []),
    ...(workView.answer?.nextActions ?? []),
  ]);
  nextActions.slice(0, 5).forEach((label, index) => {
    actions.push({
      id: `next:${workView.run.runId}:${index + 1}`,
      label: redactOrdinaryText(label, 220),
      kind: "next",
      status: "available",
    });
  });
  if (workView.run.status === "failed" || workView.run.status === "blocked") {
    actions.push({
      id: `retry:${workView.run.runId}`,
      label: "重试",
      kind: "retry",
      status: "available",
    });
  }
  return actions;
}

function confirmationForResult(workView: DesktopWorkViewReadModel): PanelRunResultConfirmationReadModel | undefined {
  const pending = workView.pendingConfirmation;
  if (pending === undefined) return undefined;
  return {
    confirmationId: pending.confirmationId,
    title: redactOrdinaryText(pending.title, 160),
    body: redactOrdinaryText(pending.actionSummary, 1_000),
    riskLevel: pending.riskLevel,
    affectedResources: pending.affectedResources.map((item) => redactOrdinaryText(item, 240)).filter((item) => item.length > 0),
  };
}

function toolDisplaysForResult(
  workView: DesktopWorkViewReadModel,
  nodes: readonly TranscriptNode[]
): readonly ToolDisplayProjection[] {
  return uniqueDisplays([
    ...(workView.deliverable?.toolDisplays ?? []),
    ...workView.toolEvidence.map((item) => item.uiDisplay).filter(isToolDisplayProjection),
    ...workView.visibleEvents.map((event) => event.detail?.display).filter(isToolDisplayProjection),
    ...nodes.map((node) => node.display).filter(isToolDisplayProjection),
  ]);
}

function fileEvidenceForResult(displays: readonly ToolDisplayProjection[]): readonly PanelRunResultFileEvidenceReadModel[] {
  const files = new Map<string, PanelRunResultFileEvidenceReadModel>();
  for (const display of displays) {
    if (display.kind !== "file_change_summary" && display.kind !== "file_diff_preview") continue;
    const path = redactOrdinaryText(display.path ?? "", 500);
    if (path.length === 0) continue;
    const evidence: PanelRunResultFileEvidenceReadModel = {
      path,
      kind: fileChangeKind(display),
      summary: fileSummary(display),
      preview: display.preview === undefined ? undefined : redactOrdinaryText(display.preview, 2_000),
    };
    files.set(path, mergeFileEvidence(files.get(path), evidence));
  }
  return [...files.values()].slice(0, 20);
}

function mergeFileEvidence(
  previous: PanelRunResultFileEvidenceReadModel | undefined,
  next: PanelRunResultFileEvidenceReadModel
): PanelRunResultFileEvidenceReadModel {
  if (previous === undefined) return next;
  return {
    path: next.path,
    kind: previous.kind === next.kind ? next.kind : "changed",
    summary: next.summary ?? previous.summary,
    preview: next.preview ?? previous.preview,
  };
}

function fileChangeKind(display: Extract<ToolDisplayProjection, { readonly kind: "file_change_summary" | "file_diff_preview" }>): PanelRunResultFileEvidenceReadModel["kind"] {
  if (display.operation === "create") return "created";
  if (display.operation === "delete") return "deleted";
  if (display.operation === "edit" || display.operation === "append" || display.operation === "write") return "modified";
  return "changed";
}

function fileSummary(display: Extract<ToolDisplayProjection, { readonly kind: "file_change_summary" | "file_diff_preview" }>): string | undefined {
  const parts = [
    fileOperationLabel(display.operation),
    display.replacements === undefined ? undefined : `${display.replacements} 处修改`,
    display.truncated === true ? "预览已截断" : undefined,
  ].filter((item): item is string => item !== undefined);
  return parts.length === 0 ? undefined : redactOrdinaryText(parts.join("；"), 220);
}

function fileOperationLabel(operation: Extract<ToolDisplayProjection, { readonly kind: "file_change_summary" | "file_diff_preview" }>["operation"]): string | undefined {
  switch (operation) {
    case "create":
      return "创建";
    case "delete":
      return "删除";
    case "append":
      return "追加写入";
    case "edit":
      return "编辑";
    case "write":
      return "写入";
    case undefined:
      return undefined;
  }
}

function commandEvidenceForResult(displays: readonly ToolDisplayProjection[]): readonly PanelRunResultCommandEvidenceReadModel[] {
  return displays
    .flatMap((display) => {
      if (display.kind === "command_summary") {
        return [{
          command: commandDisplayText(display),
          exitCode: display.exitCode,
          summary: commandSummary(display),
          logRef: display.logRef ?? display.logPath,
        }];
      }
      if (display.kind === "http_response") {
        return [{
          command: httpCommandText(display),
          exitCode: display.statusCode,
          summary: httpSummary(display),
        }];
      }
      return [];
    })
    .filter((item) => item.command !== undefined || item.summary !== undefined)
    .slice(0, 20);
}

function commandSummary(display: Extract<ToolDisplayProjection, { readonly kind: "command_summary" }>): string | undefined {
  const parts = [
    display.exitCode === undefined ? undefined : `exit ${display.exitCode}`,
    display.timedOut === true ? "超时" : undefined,
    display.background === true ? "后台运行" : undefined,
    display.portReady === true && display.waitForPort !== undefined ? `port ${display.waitForPort} ready` : undefined,
    display.outputSummary,
    display.errorSummary,
  ].filter((item): item is string => item !== undefined && item.trim().length > 0);
  return parts.length === 0 ? undefined : redactOrdinaryText(parts.join("；"), 500);
}

function httpCommandText(display: Extract<ToolDisplayProjection, { readonly kind: "http_response" }>): string | undefined {
  if (display.url === undefined) return undefined;
  return redactOrdinaryText([display.method ?? "HTTP", display.url].join(" "), 500);
}

function httpSummary(display: Extract<ToolDisplayProjection, { readonly kind: "http_response" }>): string | undefined {
  const status = display.statusCode === undefined
    ? undefined
    : `${display.statusCode}${display.statusText === undefined ? "" : ` ${display.statusText}`}`;
  const parts = [status, display.bodyPreview, display.truncated === true ? "响应已截断" : undefined]
    .filter((item): item is string => item !== undefined && item.trim().length > 0);
  return parts.length === 0 ? undefined : redactOrdinaryText(parts.join("；"), 500);
}

function sourceEvidenceForResult(displays: readonly ToolDisplayProjection[]): readonly PanelRunResultSourceEvidenceReadModel[] {
  const sources = new Map<string, PanelRunResultSourceEvidenceReadModel>();
  for (const display of displays) {
    const source = sourceEvidenceItem(display);
    if (source === undefined) continue;
    sources.set(sourceKey(source), source);
  }
  return [...sources.values()].slice(0, 20);
}

function sourceEvidenceItem(display: ToolDisplayProjection): PanelRunResultSourceEvidenceReadModel | undefined {
  if (display.kind === "read_result") {
    const label = display.title ?? display.uri ?? display.url ?? display.ref;
    if (label === undefined) return undefined;
    return {
      label: redactOrdinaryText(label, 300),
      ref: display.ref ?? display.sourceSearchRef,
      url: display.url,
      summary: redactOrdinaryText(display.summary ?? display.preview ?? display.contentPreview ?? "", 500) || undefined,
    };
  }
  if (display.kind === "browser_snapshot") {
    const label = display.title ?? display.url;
    if (label === undefined) return undefined;
    return {
      label: redactOrdinaryText(label, 300),
      url: display.url,
      summary: redactOrdinaryText(display.text ?? "", 500) || undefined,
    };
  }
  if (display.kind === "search_results") {
    const label = display.query ?? display.message;
    if (label === undefined) return undefined;
    return {
      label: redactOrdinaryText(label, 300),
      summary: redactOrdinaryText(display.message ?? `${display.results.length} 条结果`, 500),
    };
  }
  return undefined;
}

function processItemsForResult(nodes: readonly TranscriptNode[]): readonly PanelRunResultProcessItemReadModel[] {
  return displayActivityItemsForNodes(activityVisibleNodes(nodes))
    .slice(-12)
    .map((item) => ({
      id: item.key,
      label: redactOrdinaryText([item.copy.label, item.copy.detail].filter(isNonEmptyString).join("："), 260),
      status: item.phase,
      kind: item.toolKind ?? item.tone,
    }))
    .filter((item) => item.label.length > 0);
}

function processSummaryForResult(
  workView: DesktopWorkViewReadModel,
  items: readonly PanelRunResultProcessItemReadModel[]
): string {
  if (workView.pendingConfirmation !== undefined) return "等待确认。";
  if (workView.run.status === "completed") {
    return items.length === 0 ? "任务已完成。" : `任务已完成，记录 ${items.length} 个关键步骤。`;
  }
  if (workView.run.status === "failed") return "任务未完成。";
  if (workView.run.status === "cancelled") return "任务已取消。";
  if (workView.run.status === "blocked" || workView.run.status === "needs_input") return "任务需要处理。";
  return workView.currentAction.trim().length > 0 ? redactOrdinaryText(workView.currentAction, 260) : "任务处理中。";
}

function uniqueDisplays(displays: readonly ToolDisplayProjection[]): readonly ToolDisplayProjection[] {
  const seen = new Set<string>();
  const result: ToolDisplayProjection[] = [];
  for (const display of displays) {
    const key = displayKey(display);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(display);
  }
  return result;
}

function displayKey(display: ToolDisplayProjection): string {
  if (display.kind === "command_summary") return `${display.kind}:${commandDisplayText(display) ?? ""}:${display.exitCode ?? ""}:${display.logRef ?? display.logPath ?? ""}`;
  if (display.kind === "http_response") return `${display.kind}:${display.method ?? ""}:${display.url ?? ""}:${display.statusCode ?? ""}`;
  if (display.kind === "file_change_summary" || display.kind === "file_diff_preview") return `${display.kind}:${display.path ?? ""}:${display.preview ?? ""}`;
  if (display.kind === "read_result") return `${display.kind}:${display.ref ?? display.uri ?? display.url ?? display.title ?? ""}`;
  if (display.kind === "browser_snapshot") return `${display.kind}:${display.url ?? display.title ?? ""}`;
  if (display.kind === "search_results") return `${display.kind}:${display.query ?? display.message ?? ""}`;
  if (display.kind === "generic_tool_summary") return `${display.kind}:${display.action ?? ""}:${display.summary ?? ""}:${display.items?.join("|") ?? ""}`;
  return JSON.stringify(display);
}

function sourceKey(source: PanelRunResultSourceEvidenceReadModel): string {
  return source.ref ?? source.url ?? source.label;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = value.trim();
    if (text.length === 0 || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function isToolDisplayProjection(value: ToolDisplayProjection | undefined): value is ToolDisplayProjection {
  return value !== undefined;
}

function isNonEmptyString(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}
