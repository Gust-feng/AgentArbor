import { cleanConfirmationSummary, isGenericApprovalDecisionText } from "./confirmation-copy.js";
import {
  isFileReadNode,
  isModelSideOutputNode,
  normalizedToolName,
  type ProjectableTranscriptNode,
} from "./panel-transcript-node-projection.js";
import { commandText, genericItemLabel } from "./panel-transcript-tool-format.js";
import { cleanOrdinaryToolText } from "./ordinary-tool-copy.js";

const EXPANDED_SEARCH_RESULTS_LIMIT = 20;
const EXPANDED_DIRECTORY_ENTRIES_LIMIT = 80;
const EXPANDED_FILE_SEARCH_MATCHES_LIMIT = 80;

function isString(value: string | undefined): value is string {
  return value !== undefined && value.length > 0;
}

export type ActivityLineCopy = {
  readonly label?: string;
  readonly detail: string;
  readonly expandedDetail?: string;
};

export type ActivityExpandedMeta = {
  readonly label?: string;
  readonly value: string;
};

export type ActivityExpandedSection = {
  readonly title: string;
  readonly content: string;
  readonly format?: "plain" | "code" | "list" | "source" | "quote" | "diff";
  readonly href?: string;
  readonly meta?: readonly ActivityExpandedMeta[];
  readonly tone?: "neutral" | "accent" | "success" | "warning" | "danger";
};

export type ActivityBadge = {
  readonly label: string;
  readonly tone?: "neutral" | "accent" | "success" | "warning" | "danger";
  readonly monospace?: boolean;
};

export type ActivityItem = {
  readonly nodeId: string;
  readonly key: string;
  readonly variant?: "context_compaction" | "sub_agent";
  readonly copy: ActivityLineCopy;
  readonly tone: "thinking" | "narration" | "tool" | "confirmation" | "decision" | "sub_agent" | "system";
  readonly phase: ProjectableTranscriptNode["phase"];
  readonly toolKind?: "command" | "search" | "read" | "edit" | "web" | "thinking" | "system" | "confirmation" | "decision" | "sub_agent" | "other";
  readonly subAgentRunId?: string;
  readonly subAgentBatchId?: string;
  readonly subAgentTotalCount?: number;
  readonly subAgentSuccessCount?: number;
  readonly subAgentFailedCount?: number;
  readonly subAgentCancelledCount?: number;
  readonly subAgentApprovalRequiredCount?: number;
  readonly subAgentNotStartedCount?: number;
  readonly statusBadge?: ActivityBadge;
  readonly badges?: readonly ActivityBadge[];
  readonly expandedSections?: readonly ActivityExpandedSection[];
};

export type ActivityToolKind = NonNullable<ActivityItem["toolKind"]>;

export function activityLineForNode(node: ProjectableTranscriptNode): ActivityLineCopy | undefined {
  if (node.kind === "thinking") {
    return readableThinkingCopy(node.text ?? node.summary ?? "");
  }
  if (node.kind === "tool") {
    const target = toolTargetCopy(node);
    const statusText = target === undefined ? toolStatusText(node) : undefined;
    if (target === undefined && statusText === undefined) {
      return undefined;
    }
    const copy = {
      label: toolVerb(node),
      detail: target?.detail ?? statusText ?? "",
    };
    return target?.expandedDetail === undefined ? copy : { ...copy, expandedDetail: target.expandedDetail };
  }
  if (node.kind === "confirmation") {
    return readableConfirmationCopy(node);
  }
  if (node.kind === "user_decision") {
    return readableUserDecisionCopy(node);
  }
  if (node.kind === "sub_agent") {
    return readableSubAgentCopy(node);
  }
  if (node.kind === "system") {
    if (isContextCompactionNode(node)) {
      return contextCompactionActivityCopy(node);
    }
    if (isModelSideOutputNode(node)) {
      return readableNarrationCopy(node.text ?? node.summary ?? "");
    }
    if (node.phase === "failed" || node.phase === "blocked") {
      return {
        label: node.eventType === "model.failed" ? "模型" : "问题",
        detail: readableNarrationText(node.text ?? node.summary ?? node.title) ?? "任务未完成。",
      };
    }
    if (node.phase === "cancelled") return { label: "已停止", detail: "任务已取消。" };
    const detail = readableNarrationText(node.text ?? node.summary ?? node.title);
    return detail === undefined ? undefined : { detail };
  }
  return undefined;
}

export function resolveActivityToolKind(item: {
  readonly tone: ActivityItem["tone"];
  readonly copy: { readonly label?: string };
}): ActivityToolKind {
  if (item.tone === "thinking") return "thinking";
  if (item.tone === "confirmation") return "confirmation";
  if (item.tone === "decision") return "decision";
  if (item.tone === "sub_agent") return "sub_agent";
  if (item.tone === "system") return "system";
  const label = item.copy.label;
  if (label === "命令") return "command";
  if (label === "搜索") return "search";
  if (label === "读取" || label === "查看") return "read";
  if (label === "编辑" || label === "写入" || label === "创建" || label === "删除") return "edit";
  if (label === "网页") return "web";
  if (label === "生成") return "edit";
  return "other";
}

export function activityItemsForNodes(nodes: readonly ProjectableTranscriptNode[]): readonly ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const node of nodes) {
    const copy = activityLineForNode(node);
    if (copy === undefined) continue;
    const tone = activityToneForNode(node);
    const item: ActivityItem = {
      nodeId: node.nodeId,
      key: activityItemKey(node),
      variant: activityVariantForNode(node),
      copy,
      tone,
      phase: node.phase,
      toolKind: resolveActivityToolKind({ tone, copy }),
      subAgentRunId: node.subAgentRunId,
      subAgentBatchId: node.subAgentBatchId,
      subAgentTotalCount: node.subAgentTotalCount,
      subAgentSuccessCount: node.subAgentSuccessCount,
      subAgentFailedCount: node.subAgentFailedCount,
      subAgentCancelledCount: node.subAgentCancelledCount,
      subAgentApprovalRequiredCount: node.subAgentApprovalRequiredCount,
      subAgentNotStartedCount: node.subAgentNotStartedCount,
      statusBadge: activityStatusBadge(node),
      badges: activityBadgesForNode(node),
      expandedSections: activityExpandedSectionsForNode(node, copy),
    };
    items.push(item);
  }
  return items;
}

export function displayActivityItemsForNodes(nodes: readonly ProjectableTranscriptNode[]): readonly ActivityItem[] {
  const items: ActivityItem[] = [];
  const requestedToolItemIndexByCall = new Map<string, number>();
  const subAgentItemIndexByKey = new Map<string, number>();
  const failureCauseKeysByRun = new Map<string, Set<string>>();
  for (const node of nodes) {
    const copy = activityLineForNode(node);
    if (copy === undefined) continue;
    const item = activityItemFromNode(node, copy);
    if (isRedundantRunFailureItem(node, item, failureCauseKeysByRun)) {
      continue;
    }
    recordFailureCauseKey(node, item, failureCauseKeysByRun);
    const subAgentKey = subAgentActivityKey(node);
    if (subAgentKey !== undefined) {
      const previousIndex = subAgentItemIndexByKey.get(subAgentKey);
      if (previousIndex !== undefined) {
        const previous = items[previousIndex];
        if (previous !== undefined) {
          items[previousIndex] = mergeSubAgentActivityItems(previous, item);
          continue;
        }
      }
      subAgentItemIndexByKey.set(subAgentKey, items.length);
    }
    const toolCallId = toolCallIdForActivityNode(node);
    if (toolCallId !== undefined && node.kind === "tool") {
      const previousIndex = requestedToolItemIndexByCall.get(toolCallId);
      if (previousIndex !== undefined && isTerminalToolNode(node)) {
        const previous = items[previousIndex];
        if (previous !== undefined) {
          items[previousIndex] = mergeToolActivityItems(previous, item);
          continue;
        }
      }
      if (node.eventType === "tool.requested") {
        requestedToolItemIndexByCall.set(toolCallId, items.length);
      }
    }
    items.push(
      item.copy.expandedDetail !== undefined && item.expandedSections === undefined
        ? { ...item, expandedSections: [{ title: "详情", content: item.copy.expandedDetail }] }
        : item,
    );
  }
  return items;
}

function isRedundantRunFailureItem(
  node: ProjectableTranscriptNode,
  item: ActivityItem,
  failureCauseKeysByRun: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  if (!isRunFailureNode(node)) {
    return false;
  }
  const key = failureCauseKey(item);
  return key.length > 0 && failureCauseKeysByRun.get(node.runId)?.has(key) === true;
}

function recordFailureCauseKey(
  node: ProjectableTranscriptNode,
  item: ActivityItem,
  failureCauseKeysByRun: Map<string, Set<string>>,
): void {
  if (!isFailureCauseNode(node)) {
    return;
  }
  const key = failureCauseKey(item);
  if (key.length === 0) {
    return;
  }
  const existing = failureCauseKeysByRun.get(node.runId) ?? new Set<string>();
  existing.add(key);
  failureCauseKeysByRun.set(node.runId, existing);
}

function isFailureCauseNode(node: ProjectableTranscriptNode): boolean {
  return !isRunFailureNode(node) &&
    (node.phase === "failed" || node.phase === "blocked" || node.phase === "cancelled");
}

function isRunFailureNode(node: ProjectableTranscriptNode): boolean {
  return node.kind === "system" &&
    (node.eventType === "run.failed" || node.eventType === "run.blocked" || node.eventType === "run.cancelled");
}

function failureCauseKey(item: ActivityItem): string {
  return item.copy.detail.replace(/\s+/g, " ").trim();
}

function activityItemFromNode(node: ProjectableTranscriptNode, copy: ActivityLineCopy): ActivityItem {
  const tone = activityToneForNode(node);
  return {
    nodeId: node.nodeId,
    key: activityItemKey(node),
    variant: activityVariantForNode(node),
    copy,
    tone,
    phase: node.phase,
    toolKind: resolveActivityToolKind({ tone, copy }),
    subAgentRunId: node.subAgentRunId,
    subAgentBatchId: node.subAgentBatchId,
    subAgentTotalCount: node.subAgentTotalCount,
    subAgentSuccessCount: node.subAgentSuccessCount,
    subAgentFailedCount: node.subAgentFailedCount,
    subAgentCancelledCount: node.subAgentCancelledCount,
    subAgentApprovalRequiredCount: node.subAgentApprovalRequiredCount,
    subAgentNotStartedCount: node.subAgentNotStartedCount,
    statusBadge: activityStatusBadge(node),
    badges: activityBadgesForNode(node),
    expandedSections: activityExpandedSectionsForNode(node, copy),
  };
}

function activityStatusBadge(node: ProjectableTranscriptNode): ActivityBadge | undefined {
  if (isContextCompactionNode(node)) {
    if (node.phase === "executing" || node.phase === "noted") return { label: "压缩中", tone: "accent" };
    if (node.phase === "completed") return { label: "压缩完成", tone: "success" };
    if (node.phase === "failed" || node.phase === "blocked") return { label: "压缩失败", tone: "danger" };
  }
  if (node.kind === "confirmation") {
    return { label: "待确认", tone: "warning" };
  }
  if (node.kind === "user_decision") {
    if (node.phase === "guidance") return { label: "已补充", tone: "accent" };
    if (node.phase === "denied") return { label: "已拒绝", tone: "danger" };
    if (node.phase === "approved") return { label: "已允许", tone: "success" };
    return undefined;
  }
  if (node.kind === "sub_agent") {
    if (node.phase === "executing") return { label: "运行中", tone: "accent" };
    if (node.phase === "waiting_approval") return { label: "待确认", tone: "warning" };
    if (node.phase === "completed") return { label: "已完成", tone: "success" };
    if (node.phase === "failed" || node.phase === "blocked" || node.phase === "cancelled") return { label: "未完成", tone: "danger" };
    return undefined;
  }
  if (node.kind !== "tool") {
    if (node.phase === "failed" || node.phase === "blocked") return { label: "未完成", tone: "danger" };
    if (node.phase === "cancelled") return { label: "已停止", tone: "warning" };
    return undefined;
  }
  if (node.phase === "preparing" || node.phase === "executing" || node.phase === "noted") {
    return { label: "进行中", tone: "accent" };
  }
  if (node.phase === "completed") {
    return { label: "已完成", tone: "success" };
  }
  if (node.phase === "failed" || node.phase === "blocked" || node.phase === "cancelled") {
    return { label: "未完成", tone: "danger" };
  }
  return undefined;
}

function activityBadgesForNode(node: ProjectableTranscriptNode): readonly ActivityBadge[] | undefined {
  const display = node.display;
  const badges: ActivityBadge[] = [];
  if (isContextCompactionNode(node)) {
    return undefined;
  }
  if (display?.kind === "command_summary") {
    if (display.exitCode !== undefined && display.exitCode !== 0) {
      badges.push({
        label: `exit ${display.exitCode}`,
        tone: "danger",
        monospace: true,
      });
    }
    if (node.phase !== "completed" && display.durationMs !== undefined) {
      badges.push({ label: durationLabel(display.durationMs), monospace: true });
    }
    if (display.background === true) badges.push({ label: "后台", tone: "accent" });
    if (display.waitForPort !== undefined) {
      badges.push({
        label: display.portReady === true ? `端口 ${display.waitForPort}` : `等待端口 ${display.waitForPort}`,
        tone: display.portReady === false ? "warning" : "accent",
      });
    }
    if (display.stdoutTruncated === true || display.stderrTruncated === true) {
      badges.push({ label: "输出截断", tone: "warning" });
    }
  } else if (display?.kind === "search_results") {
    badges.push({ label: `${searchResultsReturned(display)} 条结果`, tone: "accent" });
  } else if (display?.kind === "directory_listing") {
    badges.push({ label: `${directoryListingCount(display)} 项`, tone: "accent" });
    if (display.depth !== undefined) badges.push({ label: `深度 ${display.depth}` });
    if ((display.unreadableDirectories ?? 0) > 0) {
      badges.push({ label: `${display.unreadableDirectories} 个异常目录`, tone: "warning" });
    }
  } else if (display?.kind === "file_search_results") {
    badges.push({ label: `${fileSearchMatchesReturned(display)} 处匹配`, tone: "accent" });
    if (display.searchedFiles !== undefined) badges.push({ label: `${display.searchedFiles} 个文件` });
    if ((display.skippedFiles ?? 0) > 0) badges.push({ label: `${display.skippedFiles} 个跳过`, tone: "warning" });
  } else if (display?.kind === "read_result") {
    const source = compactHttpHostLabel(display.url ?? display.uri);
    if (source !== undefined) badges.push({ label: source });
    if (display.truncated === true) badges.push({ label: "已截断", tone: "warning" });
  } else if (display?.kind === "browser_snapshot") {
    const source = compactHostLabel(display.url);
    if (source !== undefined) badges.push({ label: source });
    if (display.truncated === true) badges.push({ label: "已截断", tone: "warning" });
  } else if (display?.kind === "http_response") {
    if (display.statusCode !== undefined) {
      badges.push({
        label: `${display.statusCode}`,
        tone: httpStatusTone(display.statusCode),
        monospace: true,
      });
    }
    if (display.durationMs !== undefined) {
      badges.push({ label: durationLabel(display.durationMs), monospace: true });
    }
    if (display.truncated === true) badges.push({ label: "已截断", tone: "warning" });
  } else if (display?.kind === "file_change_summary" || display?.kind === "file_diff_preview") {
    const operationBadge = fileOperationBadge(display);
    if (operationBadge !== undefined) {
      badges.push(operationBadge);
    }
    if (display.append === true && operationBadge?.label !== "追加") badges.push({ label: "追加", tone: "accent" });
    if (display.truncated === true) badges.push({ label: "预览截断", tone: "warning" });
  } else if (display?.kind === "generic_tool_summary") {
    if ((display.items?.length ?? 0) > 1) {
      badges.push({ label: `${display.items?.length ?? 0} 项` });
    }
  }
  return badges.length === 0 ? undefined : badges;
}

function activityVariantForNode(node: ProjectableTranscriptNode): ActivityItem["variant"] {
  if (isContextCompactionNode(node)) return "context_compaction";
  if (node.kind === "sub_agent") return "sub_agent";
  return undefined;
}

function isContextCompactionNode(node: ProjectableTranscriptNode): boolean {
  return node.eventType === "context.compaction.requested" ||
    node.eventType === "context.compaction.completed" ||
    node.eventType === "context.compaction.failed";
}

function readableSubAgentCopy(node: ProjectableTranscriptNode): ActivityLineCopy {
  const label = node.subAgentBatchId === undefined ? "子 Agent" : "子 Agent 批次";
  const detail = readableNarrationText(node.summary ?? node.text ?? node.title);
  return {
    label,
    detail: detail ?? (node.subAgentBatchId === undefined ? "子 Agent 运行。" : "子 Agent 批次运行。"),
  };
}

function contextCompactionActivityCopy(node: ProjectableTranscriptNode): ActivityLineCopy {
  if (node.eventType === "context.compaction.requested" || node.phase === "executing") {
    return { detail: "正在上下文压缩" };
  }
  if (node.eventType === "context.compaction.completed") {
    return { detail: "上下文压缩完成" };
  }
  const detail = readableNarrationText(node.text ?? node.summary ?? "");
  return {
    detail: detail === undefined ? "上下文压缩失败" : `上下文压缩失败：${detail}`,
  };
}

function activityExpandedSectionsForNode(
  node: ProjectableTranscriptNode,
  copy: ActivityLineCopy,
): readonly ActivityExpandedSection[] | undefined {
  const display = node.display;
  const sections: ActivityExpandedSection[] = [];
  if (display?.kind === "command_summary") {
    if (display.outputSummary !== undefined) {
      sections.push({ title: "输出摘要", content: display.outputSummary });
    }
    if (display.errorSummary !== undefined) {
      sections.push({ title: "错误摘要", content: display.errorSummary, tone: "danger" });
    }
    const context = commandContextLines(display, node.phase);
    if (context.length > 0) {
      sections.push({ title: "执行信息", content: context.join("\n"), format: "list" });
    }
  } else if (display?.kind === "search_results") {
    const results = (display.results ?? [])
      .slice(0, EXPANDED_SEARCH_RESULTS_LIMIT)
      .map((result) => searchResultLine(result.title, result.source, result.url, result.summary ?? result.snippet));
    if (results.length > 0) {
      const tail = searchResultsTailLine(display, results.length);
      sections.push({ title: "命中结果", content: [...results, tail].filter((line): line is string => line !== undefined).join("\n"), format: "list" });
    } else if (display.message !== undefined) {
      sections.push({ title: "结果", content: display.message });
    }
  } else if (display?.kind === "directory_listing") {
    const entries = display.entries.slice(0, EXPANDED_DIRECTORY_ENTRIES_LIMIT).map(directoryEntryLine);
    if (entries.length > 0) {
      const tail = directoryListingTailLine(display, entries.length);
      sections.push({ title: "条目", content: [...entries, tail].filter((line): line is string => line !== undefined).join("\n"), format: "list" });
    }
    const unreadable = display.unreadableSamples
      ?.slice(0, 6)
      .map((item) => [item.path, item.errorCode].filter((value): value is string => value !== undefined && value.length > 0).join(" · "))
      .filter((value) => value.length > 0);
    if ((unreadable?.length ?? 0) > 0) {
      sections.push({ title: "异常目录", content: unreadable!.join("\n"), format: "list", tone: "warning" });
    }
  } else if (display?.kind === "file_search_results") {
    const matches = display.matches.slice(0, EXPANDED_FILE_SEARCH_MATCHES_LIMIT).map(fileSearchMatchLine);
    if (matches.length > 0) {
      const tail = fileSearchTailLine(display, matches.length);
      sections.push({ title: "命中", content: [...matches, tail].filter((line): line is string => line !== undefined).join("\n"), format: "list" });
    }
    const skipped = fileSearchSkippedSummary(display);
    if (skipped !== undefined) {
      sections.push({ title: "跳过", content: skipped, format: "list", tone: "warning" });
    }
  } else if (display?.kind === "read_result") {
    const source = sourceSection("资料", {
      title: display.title ?? display.url ?? display.uri,
      url: display.url ?? urlLikeValue(display.uri),
    });
    if (source !== undefined) {
      sections.push(source);
    }
    if (display.contentPreview !== undefined) {
      sections.push({
        title: "摘录",
        content: display.contentPreview,
        format: source?.format === "source" ? "quote" : "code",
      });
    }
    if (display.error !== undefined) {
      sections.push({ title: "错误摘要", content: display.error, tone: "danger" });
    }
  } else if (display?.kind === "browser_snapshot") {
    const source = sourceSection("网页", {
      title: display.title ?? display.url,
      url: display.url,
    });
    if (source !== undefined) {
      sections.push(source);
    }
    if (display.summary !== undefined) {
      if (display.text === undefined) {
        sections.push({ title: "页面摘要", content: display.summary });
      }
    }
    if (display.text !== undefined) {
      sections.push({ title: "页面摘录", content: display.text, format: "quote" });
    }
  } else if (display?.kind === "http_response") {
    if (display.bodyPreview !== undefined) {
      sections.push({ title: "内容预览", content: display.bodyPreview, format: "code" });
    }
    const responseLine = httpResponseContextLine(display, node.phase);
    if (responseLine !== undefined) {
      sections.push({ title: "响应", content: responseLine });
    }
  } else if (display?.kind === "file_change_summary" || display?.kind === "file_diff_preview") {
    const preview = filePreviewContentForActivity(display, node, copy);
    if (preview !== undefined) {
      sections.push({
        title: filePreviewSectionTitle(display),
        content: preview,
        format: display.kind === "file_diff_preview" || filePreviewLooksLikeDiff(preview) ? "diff" : "code",
      });
    } else if (node.phase !== "completed") {
      const changeSummary = fileChangeSummary(display);
      if (changeSummary !== undefined) {
        sections.push({
          title: "变更",
          content: changeSummary,
          tone: fileOperationTone(fileDisplayOperation(display)),
        });
      }
      if (display.summary !== undefined && display.summary.trim() !== copy.detail.trim()) {
        sections.push({ title: "摘要", content: display.summary });
      }
    }
  } else if (display?.kind === "generic_tool_summary") {
    sections.push(...genericToolSections(display, copy));
  }
  const fallback = copy.expandedDetail === undefined ? [] : [{ title: "详情", content: copy.expandedDetail }];
  const allSections = dedupeExpandedSections(appendSectionsWithoutDuplicateContent(sections, fallback));
  return allSections.length === 0 ? undefined : allSections;
}

function toolCallIdForActivityNode(node: ProjectableTranscriptNode): string | undefined {
  return node.refs.find((item) => item.kind === "tool_call")?.id;
}

function isTerminalToolNode(node: ProjectableTranscriptNode): boolean {
  return node.eventType === "tool.completed" || node.eventType === "tool.failed";
}

function mergeToolActivityItems(requested: ActivityItem, terminal: ActivityItem): ActivityItem {
  const sections = buildExpandedSections(requested, terminal);
  const expandedDetail = mergedToolExpandedDetail(terminal.copy, terminal.phase);
  return {
    ...terminal,
    key: requested.key,
    copy: {
      ...terminal.copy,
      expandedDetail,
    },
    toolKind: resolveActivityToolKind(terminal),
    expandedSections: sections.length > 0
      ? sections
      : expandedDetail === undefined
        ? undefined
        : fallbackExpandedSections({ ...terminal.copy, expandedDetail }),
  };
}

function subAgentActivityKey(node: ProjectableTranscriptNode): string | undefined {
  if (node.kind !== "sub_agent") {
    return undefined;
  }
  if (node.subAgentBatchId !== undefined) {
    return `batch:${node.subAgentBatchId}`;
  }
  if (node.subAgentRunId !== undefined) {
    return `run:${node.subAgentRunId}`;
  }
  return undefined;
}

function mergeSubAgentActivityItems(previous: ActivityItem, next: ActivityItem): ActivityItem {
  return {
    ...next,
    nodeId: previous.nodeId,
    key: previous.key,
    subAgentRunId: next.subAgentRunId ?? previous.subAgentRunId,
    subAgentBatchId: next.subAgentBatchId ?? previous.subAgentBatchId,
    subAgentTotalCount: next.subAgentTotalCount ?? previous.subAgentTotalCount,
    subAgentSuccessCount: next.subAgentSuccessCount ?? previous.subAgentSuccessCount,
    subAgentFailedCount: next.subAgentFailedCount ?? previous.subAgentFailedCount,
    subAgentCancelledCount: next.subAgentCancelledCount ?? previous.subAgentCancelledCount,
    subAgentApprovalRequiredCount: next.subAgentApprovalRequiredCount ?? previous.subAgentApprovalRequiredCount,
    subAgentNotStartedCount: next.subAgentNotStartedCount ?? previous.subAgentNotStartedCount,
  };
}

function buildExpandedSections(
  requested: ActivityItem,
  terminal: ActivityItem,
): readonly ActivityExpandedSection[] {
  const terminalSections = terminal.expandedSections ?? fallbackExpandedSections(terminal.copy);
  if (terminal.phase === "completed") {
    const sections = terminalSections.length > 0
      ? terminalSections
      : completedPayloadFallbackSections(requested);
    return dedupeExpandedSections(sections);
  }
  return dedupeExpandedSections(terminalSections);
}

function completedPayloadFallbackSections(item: ActivityItem): readonly ActivityExpandedSection[] {
  if (item.toolKind !== "edit") {
    return [];
  }
  const sections = item.expandedSections ?? fallbackExpandedSections(item.copy);
  return sections.filter((section) => section.format === "diff" || section.format === "code");
}

function mergedToolExpandedDetail(
  terminal: ActivityLineCopy,
  phase: ProjectableTranscriptNode["phase"]
): string | undefined {
  if (phase === "completed") {
    return terminal.expandedDetail;
  }
  return terminal.expandedDetail;
}

function fallbackExpandedSections(copy: ActivityLineCopy): readonly ActivityExpandedSection[] {
  return copy.expandedDetail === undefined ? [] : [{ title: "详情", content: copy.expandedDetail }];
}

function dedupeExpandedSections(sections: readonly ActivityExpandedSection[]): readonly ActivityExpandedSection[] {
  const seen = new Set<string>();
  const result: ActivityExpandedSection[] = [];
  for (const section of sections) {
    const title = section.title.trim();
    const content = section.content.trim();
    if (title.length === 0 || content.length === 0) {
      continue;
    }
    const key = `${title}\u0000${content}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({ ...section, title, content });
  }
  return result;
}

function appendSectionsWithoutDuplicateContent(
  base: readonly ActivityExpandedSection[],
  incoming: readonly ActivityExpandedSection[],
): readonly ActivityExpandedSection[] {
  const seenContent = new Set(base.map((section) => section.content.trim()).filter((value) => value.length > 0));
  const result = [...base];
  for (const section of incoming) {
    const content = section.content.trim();
    if (content.length > 0 && seenContent.has(content) && section.title.trim() !== "文件") {
      continue;
    }
    if (content.length > 0) {
      seenContent.add(content);
    }
    result.push(section);
  }
  return result;
}

function readableConfirmationCopy(node: ProjectableTranscriptNode): ActivityLineCopy {
  const action = cleanConfirmationSummary(node.confirmation?.actionSummary ?? node.summary ?? "");
  if (action.length === 0) {
    return { label: "待处理", detail: "等待你判断。" };
  }
  const detail = compact(readableActivityText(action), 180);
  return detail === action ? { label: "待处理", detail } : { label: "待处理", detail, expandedDetail: action };
}

function readableUserDecisionCopy(node: ProjectableTranscriptNode): ActivityLineCopy | undefined {
  if (node.phase === "approved") {
    return undefined;
  }
  const fallback = userDecisionFallback(node.phase);
  const raw = cleanConfirmationSummary(node.text ?? node.summary ?? "");
  const detail = readableActivityText(stripUserDecisionBoilerplate(stripMarkdownStructure(raw)));
  if (detail.length === 0) {
    return fallback === undefined ? undefined : { detail: fallback };
  }
  if (isGenericApprovalDecisionText(detail)) {
    return fallback === undefined ? undefined : { detail: fallback };
  }
  const compactDetail = compact(detail, 180);
  return compactDetail === detail
    ? { detail }
    : { detail: compactDetail, expandedDetail: detail };
}

function userDecisionFallback(phase: ProjectableTranscriptNode["phase"]): string | undefined {
  if (phase === "denied") return "已不执行。";
  if (phase === "guidance") return "已补充要求。";
  return undefined;
}

function stripUserDecisionBoilerplate(value: string): string {
  return value
    .replace(/^已收到补充(?:指导|要求)[:：]?\s*/u, "")
    .replace(/^已补充(?:指导|要求)[:：]?\s*/u, "")
    .replace(/^用户(?:已)?补充(?:指导|要求)[:：]?\s*/u, "")
    .trim();
}

export function readableThinkingText(value: string): string | undefined {
  const text = readableModelActivityText(value);
  if (text.length === 0) return undefined;
  return compact(takeNaturalSentences(text, 2), 180);
}

export function readableThinkingCopy(value: string): ActivityLineCopy | undefined {
  const expandedDetail = readableExpandedModelText(value);
  if (expandedDetail.length === 0) return undefined;
  const detail = compact(takeNaturalSentences(expandedDetail.replace(/\s*\n+\s*/g, " "), 2), 180);
  return copyWithNonRepeatingExpandedDetail(detail, expandedDetail);
}

export function readableNarrationText(value: string): string | undefined {
  const candidate = narrationCandidate(value);
  if (candidate === undefined) return undefined;
  const text = readableActivityText(candidate);
  if (text.length === 0) return undefined;
  return compact(takeNaturalSentences(text, 2), 180);
}

export function readableNarrationCopy(value: string): ActivityLineCopy | undefined {
  const candidate = narrationCandidate(value);
  if (candidate === undefined) return undefined;
  const expandedDetail = readableModelActivityText(candidate);
  if (expandedDetail.length === 0) return undefined;
  const detail = compact(takeNaturalSentences(expandedDetail, 2), 180);
  return copyWithNonRepeatingExpandedDetail(detail, expandedDetail);
}

function copyWithNonRepeatingExpandedDetail(detail: string, expandedDetail: string): ActivityLineCopy {
  const rest = nonRepeatingExpandedDetail(detail, expandedDetail);
  return rest === undefined ? { detail } : { detail, expandedDetail: rest };
}

function nonRepeatingExpandedDetail(detail: string, expandedDetail: string): string | undefined {
  const expanded = expandedDetail.replace(/\s+/g, " ").trim();
  const prefix = detail.replace(/…$/, "").replace(/\s+/g, " ").trim();
  if (expanded.length === 0 || prefix.length === 0) return undefined;
  if (expanded === prefix) return undefined;
  if (detail.endsWith("…") && prefix.length < expanded.length) {
    return cleanExpandedRemainder(expanded.slice(prefix.length), true);
  }
  if (!expanded.startsWith(prefix)) return expanded;
  return cleanExpandedRemainder(expanded.slice(prefix.length), false);
}

function cleanExpandedRemainder(value: string, dropPartialSentence: boolean): string | undefined {
  let rest = value
    .replace(/^[\s,;:，；：、。.!?？!-]+/u, "")
    .trim();
  if (dropPartialSentence && shouldDropPartialSentence(rest)) {
    const boundary = rest.search(/[。！？!?\.]\s+/u);
    if (boundary >= 0) {
      rest = rest.slice(boundary + 1).trim();
    }
  }
  return rest.length === 0 ? undefined : rest;
}

function shouldDropPartialSentence(value: string): boolean {
  const first = value.trim()[0];
  return first !== undefined && /[a-z0-9]/u.test(first);
}

function directoryEntryLine(
  entry: Extract<NonNullable<ProjectableTranscriptNode["display"]>, { readonly kind: "directory_listing" }>["entries"][number],
): string {
  const suffix = [
    entry.kind,
    entry.bytes === undefined ? undefined : byteLabel(entry.bytes),
  ].filter((value): value is string => value !== undefined && value.trim().length > 0);
  return suffix.length === 0 ? entry.path : `${entry.path} (${suffix.join(", ")})`;
}

function directoryListingCount(
  display: Extract<NonNullable<ProjectableTranscriptNode["display"]>, { readonly kind: "directory_listing" }>,
): number {
  return display.totalEntries ?? display.entriesReturned ?? display.entries.length;
}

function searchResultsReturned(
  display: Extract<NonNullable<ProjectableTranscriptNode["display"]>, { readonly kind: "search_results" }>,
): number {
  return display.resultsReturned ?? display.results?.length ?? 0;
}

function fileSearchMatchesReturned(
  display: Extract<NonNullable<ProjectableTranscriptNode["display"]>, { readonly kind: "file_search_results" }>,
): number {
  return display.matchesReturned ?? display.matches.length;
}

function directoryListingHeadline(
  display: Extract<NonNullable<ProjectableTranscriptNode["display"]>, { readonly kind: "directory_listing" }>,
): string {
  return [
    toolPathLabel(display.path),
    `${directoryListingCount(display)} 项`,
    display.depth === undefined ? undefined : `深度 ${display.depth}`,
  ].filter((value): value is string => value !== undefined && value.trim().length > 0).join(" · ");
}

function fileSearchHeadline(
  display: Extract<NonNullable<ProjectableTranscriptNode["display"]>, { readonly kind: "file_search_results" }>,
): string {
  return [
    cleanToolTargetText(display.query),
    toolPathLabel(display.path),
    `${fileSearchMatchesReturned(display)} 处匹配`,
  ].filter((value): value is string => value !== undefined && value.trim().length > 0).join(" · ") || `${fileSearchMatchesReturned(display)} 处匹配`;
}

function toolPathLabel(value: string | undefined): string | undefined {
  if (value === ".") {
    return "当前目录";
  }
  return cleanToolTargetText(value);
}

function fileSearchMatchLine(
  match: Extract<NonNullable<ProjectableTranscriptNode["display"]>, { readonly kind: "file_search_results" }>["matches"][number],
): string {
  const location = match.line === undefined ? match.path : `${match.path}:${match.line}`;
  return match.preview === undefined || match.preview.trim().length === 0
    ? location
    : `${location} - ${match.preview.trim()}`;
}

function fileSearchSkippedSummary(
  display: Extract<NonNullable<ProjectableTranscriptNode["display"]>, { readonly kind: "file_search_results" }>,
): string | undefined {
  const lines = [
    display.skippedFiles === undefined ? undefined : `文件：${display.skippedFiles}`,
    display.skippedBinaryFiles === undefined ? undefined : `二进制：${display.skippedBinaryFiles}`,
    display.skippedTooLargeFiles === undefined ? undefined : `过大：${display.skippedTooLargeFiles}`,
    display.skippedUnreadableFiles === undefined ? undefined : `不可读：${display.skippedUnreadableFiles}`,
    display.skippedDirectories === undefined ? undefined : `目录：${display.skippedDirectories}`,
    ...(display.skippedSamples ?? []).slice(0, 6).map((item) =>
      [item.path, item.reason ?? item.errorCode].filter((value): value is string => value !== undefined && value.trim().length > 0).join(" · ")
    ),
  ].filter((value): value is string => value !== undefined && value.trim().length > 0);
  return lines.length === 0 ? undefined : lines.join("\n");
}

function searchResultsTailLine(
  display: Extract<NonNullable<ProjectableTranscriptNode["display"]>, { readonly kind: "search_results" }>,
  shown: number,
): string | undefined {
  const returned = searchResultsReturned(display);
  if (display.truncated !== true && returned <= shown) {
    return undefined;
  }
  return `仅显示前 ${shown} 条结果；可缩小查询范围。`;
}

function directoryListingTailLine(
  display: Extract<NonNullable<ProjectableTranscriptNode["display"]>, { readonly kind: "directory_listing" }>,
  shown: number,
): string | undefined {
  const total = directoryListingCount(display);
  if (display.truncated !== true && total <= shown) {
    return undefined;
  }
  return `仅显示前 ${shown} 项；可缩小目录范围或提高 limit。`;
}

function fileSearchTailLine(
  display: Extract<NonNullable<ProjectableTranscriptNode["display"]>, { readonly kind: "file_search_results" }>,
  shown: number,
): string | undefined {
  const returned = fileSearchMatchesReturned(display);
  if (display.truncated !== true && returned <= shown) {
    return undefined;
  }
  return `仅显示前 ${shown} 处匹配；可缩小范围或提高 limit。`;
}

function commandContextLines(
  display: Extract<NonNullable<ProjectableTranscriptNode["display"]>, { readonly kind: "command_summary" }>,
  phase: ProjectableTranscriptNode["phase"],
): readonly string[] {
  const hasIssue = phase === "failed" ||
    phase === "blocked" ||
    phase === "cancelled" ||
    (display.exitCode !== undefined && display.exitCode !== 0) ||
    display.timedOut === true ||
    display.cancelled === true;
  const hasRuntimeContext = display.background === true ||
    display.logPath !== undefined ||
    display.stopCommand !== undefined ||
    display.waitForPort !== undefined ||
    display.portReady === false;
  if (!hasIssue && !hasRuntimeContext) {
    return [];
  }
  const command = commandText(display);
  return [
    command === undefined ? undefined : `命令：${command}`,
    hasIssue && display.cwd !== undefined ? `目录：${display.cwd}` : undefined,
    hasIssue && display.shell !== undefined ? `Shell：${display.shell}` : undefined,
    display.background === true ? `后台：${display.pid === undefined ? "是" : `PID ${display.pid}`}` : undefined,
    display.logPath === undefined ? undefined : `日志：${display.logPath}`,
    display.stopCommand === undefined ? undefined : `停止：${display.stopCommand}`,
    display.waitForPort === undefined ? undefined : `等待端口：${display.waitForPort}`,
    display.portReady === false ? "端口：未就绪" : undefined,
  ].filter((value): value is string => value !== undefined && value.trim().length > 0);
}

function httpResponseContextLine(
  display: Extract<NonNullable<ProjectableTranscriptNode["display"]>, { readonly kind: "http_response" }>,
  phase: ProjectableTranscriptNode["phase"],
): string | undefined {
  const statusFailed = display.statusCode !== undefined && display.statusCode >= 400;
  const phaseFailed = phase === "failed" || phase === "blocked" || phase === "cancelled";
  if (!statusFailed && !phaseFailed) {
    return undefined;
  }
  const status = display.statusCode === undefined
    ? undefined
    : `${display.statusCode}${display.statusText === undefined ? "" : ` ${display.statusText}`}`;
  const line = [display.method, display.url, status]
    .filter((value): value is string => value !== undefined && value.trim().length > 0)
    .join(" · ");
  return line.length === 0 ? undefined : line;
}

type FileDisplay = Extract<NonNullable<ProjectableTranscriptNode["display"]>, { readonly kind: "file_change_summary" | "file_diff_preview" }>;

type FileDisplayOperation = NonNullable<FileDisplay["operation"]>;

function fileDisplayOperation(display: FileDisplay): FileDisplayOperation | undefined {
  if (display.operation !== undefined) {
    return display.operation;
  }
  if (display.kind === "file_diff_preview") {
    return "edit";
  }
  if (display.append === true) {
    return "append";
  }
  return undefined;
}

function fileOperationBadge(display: FileDisplay): ActivityBadge | undefined {
  const operation = fileDisplayOperation(display);
  if (operation !== "append") {
    return undefined;
  }
  return {
    label: fileOperationShortLabel(operation),
    tone: fileOperationTone(operation),
  };
}

function fileOperationShortLabel(operation: FileDisplayOperation): string {
  if (operation === "create") return "新增";
  if (operation === "append") return "追加";
  if (operation === "delete") return "删除";
  if (operation === "edit") return "编辑";
  return "写入";
}

function fileOperationTone(operation: FileDisplayOperation | undefined): ActivityBadge["tone"] | undefined {
  if (operation === "create") return "success";
  if (operation === "delete") return "danger";
  if (operation === "append") return "accent";
  if (operation === "edit" || operation === "write") return "warning";
  return undefined;
}

function fileChangeSummary(display: FileDisplay): string | undefined {
  const operation = fileDisplayOperation(display);
  const lines = [
    operation === undefined ? undefined : `${fileOperationSentence(operation)}。`,
    display.bytes === undefined ? undefined : `大小：${byteLabel(display.bytes)}`,
    display.replacements === undefined ? undefined : `修改：${display.replacements} 处`,
    display.previousLength === undefined ? undefined : `原长度：${display.previousLength}`,
    display.nextLength === undefined ? undefined : `新长度：${display.nextLength}`,
  ].filter((value): value is string => value !== undefined && value.trim().length > 0);
  return lines.length === 0 ? undefined : lines.join("\n");
}

function fileOperationSentence(operation: FileDisplayOperation): string {
  if (operation === "create") return "已新增文件";
  if (operation === "append") return "已追加内容";
  if (operation === "delete") return "已删除文件";
  if (operation === "edit") return "已编辑文件";
  return "已写入文件";
}

function filePreviewSectionTitle(display: FileDisplay): string {
  if (display.kind === "file_diff_preview") {
    return "差异预览";
  }
  const operation = fileDisplayOperation(display);
  if (operation === "create") return "新增内容";
  if (operation === "append") return "追加内容";
  if (operation === "write") return "写入内容";
  return "内容预览";
}

function filePreviewContentForActivity(
  display: FileDisplay,
  node: ProjectableTranscriptNode,
  copy: ActivityLineCopy,
): string | undefined {
  return cleanFilePreviewContent(display.preview) ??
    cleanFilePreviewContent(copy.expandedDetail) ??
    cleanFilePreviewContent(node.summary);
}

function cleanFilePreviewContent(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const cleaned = value
    .replace(/^变更预览\s*$/gmu, "")
    .replace(/^替换[:：]\s*\d+\s*处\s*$/gmu, "")
    .trim();
  return cleaned.length === 0 ? undefined : cleaned;
}

function filePreviewLooksLikeDiff(value: string): boolean {
  return value
    .split("\n")
    .some((line) => line.startsWith("+") || line.startsWith("-") || line.startsWith("@@"));
}

type GenericToolSummaryDisplay = Extract<NonNullable<ProjectableTranscriptNode["display"]>, { readonly kind: "generic_tool_summary" }>;

type GenericArticleFacts = {
  readonly title?: string;
  readonly url?: string;
  readonly published?: string;
  readonly author?: string;
  readonly excerpt?: string;
};

function genericToolRole(
  toolName: string,
  display: GenericToolSummaryDisplay,
): "网页" | "搜索" | "读取" | "查看" | "命令" | undefined {
  const text = genericToolJoinedText(display).toLowerCase();
  const action = display.action?.toLowerCase() ?? "";
  if (
    action.includes("搜索") ||
    action.includes("search") ||
    toolName.includes("search")
  ) {
    return "搜索";
  }
  if (
    action.includes("命令") ||
    action.includes("shell") ||
    toolName.includes("command")
  ) {
    return "命令";
  }
  if (
    action.includes("列出") ||
    action.includes("目录") ||
    action.includes("list") ||
    toolName.includes("list") ||
    toolName.includes("dir")
  ) {
    return "查看";
  }
  if (
    action.includes("浏览") ||
    action.includes("网页") ||
    action.includes("browser") ||
    action.includes("web") ||
    text.includes("url: http") ||
    /^https?:\/\//u.test(text.trim())
  ) {
    return "网页";
  }
  if (
    action.includes("读取") ||
    action.includes("read") ||
    toolName.startsWith("read") ||
    (text.includes("title:") && text.includes("published:"))
  ) {
    return "读取";
  }
  return undefined;
}

function genericToolSections(
  display: GenericToolSummaryDisplay,
  copy: ActivityLineCopy,
): readonly ActivityExpandedSection[] {
  const directory = genericDirectoryFacts(display);
  if (directory !== undefined) {
    return directory.items.length === 0
      ? []
      : [{ title: "条目", content: directory.items.join("\n"), format: "list" }];
  }

  const article = genericArticleFacts(display);
  const sections: ActivityExpandedSection[] = [];
  if (article.title !== undefined || article.url !== undefined || article.published !== undefined || article.author !== undefined) {
    const source = sourceSection("来源", {
      title: article.title ?? article.url,
      url: article.url,
      published: article.published,
      author: article.author,
    });
    if (source !== undefined) {
      sections.push(source);
    }
  }
  if (article.excerpt !== undefined) {
    sections.push({ title: "摘录", content: article.excerpt, format: "quote" });
  }

  const summary = cleanGenericSummaryText(display.summary);
  if (
    summary !== undefined &&
    !genericTextMatchesArticle(summary, article) &&
    !genericTextAlreadyRepresented(summary, sections, copy)
  ) {
    sections.push({ title: "摘要", content: summary });
  }

  const items = uniqueStrings(
    (display.items ?? [])
      .map((item) => cleanGenericSummaryText(genericItemLabel(item)) ?? "")
      .filter((value) => value.length > 0)
      .filter((value) => !genericTextMatchesArticle(value, article))
      .filter((value) => !genericTextAlreadyRepresented(value, sections, copy))
  );
  if (items.length > 0) {
    sections.push({ title: "条目", content: items.join("\n"), format: "list" });
  }
  return sections;
}

function genericArticleFacts(display: GenericToolSummaryDisplay): GenericArticleFacts {
  const text = genericToolJoinedText(display);
  const title = fieldValue(text, "Title");
  const url = fieldValue(text, "URL");
  const published = fieldValue(text, "Published");
  const author = fieldValue(text, "Author");
  return {
    title,
    url,
    published,
    author,
    excerpt: articleExcerpt(text, title),
  };
}

function genericToolJoinedText(display: GenericToolSummaryDisplay): string {
  return uniqueStrings([
    display.summary,
    ...(display.items ?? []).map(genericItemLabel),
  ].filter((value): value is string => value !== undefined && value.trim().length > 0)).join("\n");
}

type GenericDirectoryFacts = {
  readonly path?: string;
  readonly count?: number;
  readonly depth?: number;
  readonly items: readonly string[];
};

function genericDirectoryFacts(display: GenericToolSummaryDisplay): GenericDirectoryFacts | undefined {
  const action = display.action?.toLowerCase() ?? "";
  const text = genericToolJoinedText(display).toLowerCase();
  const looksLikeDirectory =
    action.includes("目录") ||
    action.includes("list") ||
    action.includes("dir") ||
    text.includes("entries") ||
    text.includes("depth=");
  if (!looksLikeDirectory) {
    return undefined;
  }
  const summary = display.summary ?? "";
  const count = genericDirectoryCount(summary);
  const depth = genericDirectoryDepth(summary) ?? genericDirectoryDepth(display.items?.join(" ") ?? "");
  const path = genericDirectoryPath(summary);
  const items = uniqueStrings(
    (display.items ?? [])
      .map(genericDirectoryItemLabel)
      .filter((item): item is string => item !== undefined && item.length > 0)
  );
  if (count === undefined && path === undefined && depth === undefined && items.length === 0) {
    return undefined;
  }
  return { path, count, depth, items };
}

function genericDirectoryHeadline(display: GenericToolSummaryDisplay): string | undefined {
  const facts = genericDirectoryFacts(display);
  if (facts === undefined) {
    return undefined;
  }
  return [
    toolPathLabel(facts.path),
    facts.count === undefined ? undefined : `${facts.count} 项`,
    facts.depth === undefined ? undefined : `深度 ${facts.depth}`,
  ].filter((value): value is string => value !== undefined && value.trim().length > 0).join(" · ") || undefined;
}

function genericDirectoryPath(summary: string): string | undefined {
  const first = summary.split(/[·\n]/u)[0]?.trim();
  if (first === undefined || first.length === 0 || /\d+\s*(?:entries|项)/iu.test(first)) {
    return undefined;
  }
  if (first === ".") {
    return first;
  }
  return cleanToolTargetText(first);
}

function genericDirectoryCount(summary: string): number | undefined {
  const match = /(?:^|[^\d])(\d+)\s*(?:of\s+\d+\s*)?(?:entries|entry|项)\b/iu.exec(summary);
  if (match?.[1] === undefined) {
    return undefined;
  }
  const count = Number.parseInt(match[1], 10);
  return Number.isFinite(count) ? count : undefined;
}

function genericDirectoryDepth(value: string): number | undefined {
  const match = /\bdepth\s*=?\s*(\d+)\b/iu.exec(value);
  if (match?.[1] === undefined) {
    return undefined;
  }
  const depth = Number.parseInt(match[1], 10);
  return Number.isFinite(depth) ? depth : undefined;
}

function genericDirectoryItemLabel(value: string): string | undefined {
  const withoutPrefix = genericItemLabel(value)
    .replace(/\s+depth\s*=?\s*\d+\b/giu, "")
    .replace(/\s+\[truncated\]\s*$/iu, "")
    .trim();
  if (
    withoutPrefix.length === 0 ||
    withoutPrefix === "[truncated]" ||
    /\b\d+\s*(?:entries|entry|项)\b/iu.test(withoutPrefix)
  ) {
    return undefined;
  }
  return withoutPrefix;
}

function fieldValue(text: string, field: string): string | undefined {
  const pattern = new RegExp(`(?:^|\\n)\\s*${field}\\s*:\\s*(.+?)(?=\\n\\s*(?:Title|URL|Published|Author|Highlights?)\\s*:|$)`, "isu");
  const value = pattern.exec(text)?.[1]?.trim();
  return value === undefined || value.length === 0 ? undefined : compact(value.replace(/\s+/g, " "), 300);
}

function articleExcerpt(text: string, title: string | undefined): string | undefined {
  const withoutFields = text
    .replace(/(?:^|\n)\s*(?:Title|URL|Published|Author)\s*:\s*.+?(?=\n\s*(?:Title|URL|Published|Author|Highlights?)\s*:|\n#|\n{2,}|$)/gis, "\n")
    .replace(/(?:^|\n)\s*Highlights?\s*:\s*/giu, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const lines = withoutFields
    .split("\n")
    .map((line) => stripMarkdownLinePrefix(line.trim()))
    .map((line) => stripArticleTitlePrefix(line, title))
    .filter((line): line is string => line !== undefined && line.length > 0 && !isMarkdownDivider(line));
  const uniqueLines = uniqueByNormalizedContent(lines);
  const excerpt = uniqueLines.join("\n").trim();
  return excerpt.length === 0 ? undefined : compact(excerpt, 700);
}

function stripArticleTitlePrefix(line: string, title: string | undefined): string | undefined {
  if (title === undefined || title.trim().length === 0) {
    return line;
  }
  const trimmed = line.trim();
  for (const variant of articleTitleVariants(title)) {
    const normalizedVariant = variant.toLowerCase();
    const normalizedLine = trimmed.toLowerCase();
    if (normalizedLine === normalizedVariant) {
      return undefined;
    }
    if (normalizedLine.startsWith(normalizedVariant)) {
      const rest = trimmed
        .slice(variant.length)
        .replace(/^[\s:：|·\-–—.。,…]+/u, "")
        .trim();
      return rest.length === 0 ? undefined : rest;
    }
  }
  return line;
}

function articleTitleVariants(title: string): readonly string[] {
  return uniqueStrings([
    title,
    title.split("|")[0],
    title.split(" - ")[0],
    title.split(" — ")[0],
    title.split(" – ")[0],
  ].map((value) => value?.trim() ?? "").filter((value) => value.length > 0));
}

function uniqueByNormalizedContent(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeSectionContent(value);
    if (normalized.length === 0 || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(value.trim());
  }
  return result;
}

function sourceSection(
  title: string,
  input: {
    readonly title?: string;
    readonly url?: string;
    readonly published?: string;
    readonly author?: string;
  },
): ActivityExpandedSection | undefined {
  const content = cleanToolTargetText(input.title) ?? cleanToolTargetText(input.url);
  if (content === undefined) {
    return undefined;
  }
  const href = httpHref(input.url);
  const meta = sourceMeta(input);
  return {
    title,
    content,
    format: href === undefined && meta.length === 0 ? "plain" : "source",
    href,
    meta: meta.length === 0 ? undefined : meta,
  };
}

function sourceMeta(input: {
  readonly url?: string;
  readonly published?: string;
  readonly author?: string;
}): readonly ActivityExpandedMeta[] {
  const meta: ActivityExpandedMeta[] = [];
  const host = compactHostLabel(input.url);
  if (host !== undefined) {
    meta.push({ label: "站点", value: host });
  }
  if (input.published !== undefined) {
    meta.push({ label: "时间", value: sourceDateLabel(input.published) });
  }
  if (input.author !== undefined) {
    meta.push({ label: "作者", value: compact(input.author, 80) });
  }
  return meta.filter((item) => item.value.trim().length > 0);
}

function sourceDateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return compact(value, 80);
  }
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function urlLikeValue(value: string | undefined): string | undefined {
  return httpHref(value);
}

function httpHref(value: string | undefined): string | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function cleanGenericSummaryText(value: string | undefined): string | undefined {
  const cleaned = cleanToolTargetText(value);
  if (cleaned === undefined) return undefined;
  return cleaned
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function genericTextAlreadyRepresented(
  value: string,
  sections: readonly ActivityExpandedSection[],
  copy: ActivityLineCopy,
): boolean {
  const normalized = normalizeSectionContent(value);
  if (normalized.length === 0) return true;
  if (normalizeSectionContent(copy.detail) === normalized) return true;
  return sections.some((section) => {
    const content = normalizeSectionContent(section.content);
    return content === normalized || content.includes(normalized) || normalized.includes(content);
  });
}

function genericTextMatchesArticle(value: string, article: GenericArticleFacts): boolean {
  const normalized = normalizeSectionContent(value);
  if (normalized.length === 0) return true;
  const title = article.title === undefined ? undefined : normalizeSectionContent(article.title);
  const url = article.url === undefined ? undefined : normalizeSectionContent(article.url);
  const excerpt = article.excerpt === undefined ? undefined : normalizeSectionContent(article.excerpt);
  return (title !== undefined && normalized.includes(title) && (url === undefined || normalized.includes(url))) ||
    (excerpt !== undefined && excerpt.length > 0 && normalized.includes(excerpt));
}

function normalizeSectionContent(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/[。.!！?？；;:：、，,\s]/g, "")
    .trim()
    .toLowerCase();
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

function toolVerb(node: ProjectableTranscriptNode): string {
  const display = node.display;
  const toolName = normalizedToolName(node.toolName);
  const action = display?.kind === "generic_tool_summary" ? display.action?.toLowerCase() ?? "" : "";
  const fileMutationVerb = fileMutationVerbForTool(toolName, display);
  if (display?.kind === "command_summary" || toolName === "run_command" || toolName === "shell_command" || toolName.includes("terminal") || toolName.includes("powershell") || toolName.includes("cmd")) return "命令";
  if (display?.kind === "search_results" || toolName === "search" || toolName === "web_search" || toolName.includes("grep")) return "搜索";
  if (display?.kind === "file_search_results") return "搜索";
  if (display?.kind === "directory_listing") return "查看";
  if (fileMutationVerb !== undefined) return fileMutationVerb;
  if (display?.kind === "generic_tool_summary") {
    const role = genericToolRole(toolName, display);
    if (role !== undefined) return role;
  }
  if (display?.kind === "read_result") return "读取";
  if (display?.kind === "browser_snapshot" || toolName === "browser_snapshot" || toolName.includes("browser")) return "网页";
  if (toolName === "list_dir" || toolName === "list_files" || toolName.includes("list") || toolName.includes("dir")) return "查看";
  if (toolName === "read" || toolName === "read_file" || toolName.startsWith("read_") || toolName.includes("file")) return "读取";
  if (action.includes("读取")) return "读取";
  if (action.includes("搜索") || action.includes("查找")) return "搜索";
  if (action.includes("浏览")) return "网页";
  if (action.includes("列出")) return "查看";
  if (action.includes("命令") || action.includes("shell") || action.includes("执行")) return "命令";
  if (action.includes("写入")) return "写入";
  if (action.includes("编辑") || action.includes("修改")) return "编辑";
  if (action.includes("删除")) return "删除";
  if (toolName.includes("generate") || action.includes("生成")) return "生成";
  return "动作";
}

function fileMutationVerbForTool(
  toolName: string,
  display: ProjectableTranscriptNode["display"],
): "写入" | "创建" | "删除" | "编辑" | undefined {
  if (display?.kind === "file_change_summary" || display?.kind === "file_diff_preview") {
    const operation = fileDisplayOperation(display);
    if (operation === "create") return "创建";
    if (operation === "delete") return "删除";
    if (operation === "edit") return "编辑";
    if (operation === "append" || operation === "write") return "写入";
  }
  const genericText = display?.kind === "generic_tool_summary"
    ? [display.action, display.summary].filter((value): value is string => value !== undefined).join(" ").toLowerCase()
    : "";
  if (toolName === "delete_file" || toolName.includes("delete_file") || toolName.includes("remove_file") || mentionsDeleteFile(genericText)) {
    return "删除";
  }
  if (toolName === "create_file" || toolName.includes("create_file") || mentionsCreateFile(genericText)) {
    return "创建";
  }
  if (
    display?.kind === "file_diff_preview" ||
    toolName === "edit_file" ||
    toolName.includes("edit_file") ||
    toolName.includes("patch") ||
    toolName.includes("replace") ||
    mentionsEditFile(genericText)
  ) {
    return "编辑";
  }
  if (display?.kind === "file_change_summary" || toolName === "write_file" || toolName.includes("write_file") || mentionsWriteFile(genericText)) {
    return "写入";
  }
  return undefined;
}

function mentionsWriteFile(value: string): boolean {
  return value.includes("写入文件") || value.includes("write_file") || value.includes("write file") || value.includes("written");
}

function mentionsCreateFile(value: string): boolean {
  return value.includes("创建文件") || value.includes("create_file") || value.includes("create file") || value.includes("created");
}

function mentionsDeleteFile(value: string): boolean {
  return value.includes("删除文件") || value.includes("delete_file") || value.includes("delete file") || value.includes("deleted");
}

function mentionsEditFile(value: string): boolean {
  return value.includes("编辑文件") || value.includes("修改文件") || value.includes("edit_file") || value.includes("edit file");
}

function toolTargetCopy(node: ProjectableTranscriptNode): Pick<ActivityLineCopy, "detail" | "expandedDetail"> | undefined {
  const display = node.display;
  if (display?.kind === "command_summary") {
    const command = cleanToolTargetText(node.summary) ?? cleanToolTargetText(commandText(display));
    const failure = node.phase === "failed" ? cleanToolTargetText(display.errorSummary) : undefined;
    return readableToolTarget([command, failure].filter((value): value is string => value !== undefined && value.trim().length > 0).join(" · ")) ??
      fallbackToolTargetCopy(node);
  }
  if (display?.kind === "search_results") {
    return readableToolTarget(cleanToolTargetText(
      [display.query, display.message].filter((value): value is string => value !== undefined && value.trim().length > 0).join(" · ") || node.summary
    )) ?? fallbackToolTargetCopy(node);
  }
  if (display?.kind === "directory_listing") {
    return {
      detail: compact(readableActivityText(directoryListingHeadline(display)), 120),
    };
  }
  if (display?.kind === "file_search_results") {
    return {
      detail: compact(readableActivityText(fileSearchHeadline(display)), 120),
    };
  }
  if (display?.kind === "read_result") {
    return readableToolTarget(readResultTarget(display, node.summary)) ?? fallbackToolTargetCopy(node);
  }
  if (display?.kind === "browser_snapshot") {
    return readableToolTarget(cleanToolTargetText(display.title ?? display.url ?? node.summary)) ?? fallbackToolTargetCopy(node);
  }
  if (display?.kind === "http_response") {
    const target = [
      display.method,
      display.url,
    ].filter((value): value is string => value !== undefined && value.trim().length > 0).join(" ");
    return readableToolTarget(cleanToolTargetText(target || node.summary)) ?? fallbackToolTargetCopy(node);
  }
  if (display?.kind === "file_change_summary" || display?.kind === "file_diff_preview") {
    return readableToolTarget(cleanToolTargetText(display.path ?? node.summary)) ?? fallbackToolTargetCopy(node);
  }
  if (display?.kind === "generic_tool_summary") {
    const directoryHeadline = genericDirectoryHeadline(display);
    if (directoryHeadline !== undefined) {
      return {
        detail: compact(readableActivityText(directoryHeadline), 120),
      };
    }
    const article = genericArticleFacts(display);
    if (article.title !== undefined || article.url !== undefined) {
      return readableToolTarget(
        [article.title, compactHostLabel(article.url)].filter((value): value is string => value !== undefined && value.length > 0).join(" · ")
      );
    }
    const items = display.items
      ?.map((item) => cleanToolTargetText(genericItemLabel(item)) ?? "")
      .filter((value) => value.length > 0) ?? [];
    const summary = cleanToolTargetText(display.summary ?? node.summary);
    if (summary !== undefined && items.length > 1) {
      return {
        detail: compact(readableActivityText(summary), 120),
        expandedDetail: items.join("\n"),
      };
    }
    if (items.length === 1) return readableToolTarget(items[0]);
    if (items.length > 1) {
      return {
        detail: isFileReadNode(node) ? `${items.length} 个文件` : `${items.length} 项`,
        expandedDetail: items.join("\n"),
      };
    }
    return readableToolTarget(summary ?? genericActionTargetText(display.action)) ?? fallbackToolTargetCopy(node);
  }
  return readableToolTarget(cleanToolTargetText(node.summary)) ?? fallbackToolTargetCopy(node);
}

function toolStatusText(node: ProjectableTranscriptNode): string | undefined {
  if (node.phase === "failed") return "动作未完成。";
  return undefined;
}

function fallbackToolTargetCopy(node: ProjectableTranscriptNode): Pick<ActivityLineCopy, "detail" | "expandedDetail"> | undefined {
  return readableToolTarget(fallbackToolTargetText(node));
}

function fallbackToolTargetText(node: ProjectableTranscriptNode): string | undefined {
  const display = node.display;
  if (display?.kind === "command_summary") {
    return cleanToolTargetText(display.errorSummary) ??
      cleanToolTargetText(display.outputSummary) ??
      fallbackToolActionText(node);
  }
  if (display?.kind === "search_results") {
    const firstResult = display.results
      ?.map((result) => cleanToolTargetText(result.title) ?? cleanToolTargetText(result.source) ?? cleanToolTargetText(result.url) ?? cleanToolTargetText(result.summary ?? result.snippet))
      .find((value): value is string => value !== undefined && value.length > 0);
    return firstResult ??
      (searchResultsReturned(display) > 0 ? `${searchResultsReturned(display)} 条结果` : undefined) ??
      fallbackToolActionText(node);
  }
  if (display?.kind === "read_result") {
    return cleanToolTargetText(display.error) ??
      previewLineTarget(display.contentPreview) ??
      cleanToolTargetText(display.source ?? display.ref ?? display.status) ??
      fallbackToolActionText(node);
  }
  if (display?.kind === "browser_snapshot") {
    return previewLineTarget(display.text ?? display.summary) ?? fallbackToolActionText(node);
  }
  if (display?.kind === "http_response") {
    const status = display.statusCode === undefined ? undefined : `HTTP ${display.statusCode}`;
    return previewLineTarget(display.bodyPreview) ?? cleanToolTargetText(status) ?? fallbackToolActionText(node);
  }
  if (display?.kind === "file_change_summary" || display?.kind === "file_diff_preview") {
    return cleanToolTargetText(display.summary) ??
      fileChangeFallbackTarget(display) ??
      fallbackToolActionText(node);
  }
  if (display?.kind === "generic_tool_summary") {
    return genericActionTargetText(display.action) ?? fallbackToolActionText(node);
  }
  return fallbackToolActionText(node);
}

function genericActionTargetText(value: string | undefined): string | undefined {
  const cleaned = cleanToolTargetText(value);
  if (cleaned === undefined || isLowValueToolFallback(cleaned)) {
    return undefined;
  }
  return cleaned;
}

function previewLineTarget(value: string | undefined): string | undefined {
  const firstLine = value
    ?.split(/\r?\n/)
    .map((line) => cleanToolTargetText(line))
    .find((line): line is string => line !== undefined && line.length > 0);
  return firstLine === undefined ? undefined : compact(firstLine, 120);
}

function fileChangeFallbackTarget(display: FileDisplay): string | undefined {
  const operation = fileDisplayOperation(display);
  if (operation === "create") return "新增文件";
  if (operation === "delete") return "删除文件";
  if (operation === "append") return "追加内容";
  if (operation === "write") return "写入内容";
  if (operation === "edit" || display.preview !== undefined) return "内容变更";
  return undefined;
}

function fallbackToolActionText(node: ProjectableTranscriptNode): string | undefined {
  return cleanFallbackToolTitle(node.title) ?? fallbackToolNameText(node);
}

function cleanFallbackToolTitle(value: string | undefined): string | undefined {
  const cleaned = cleanToolTargetText(value)
    ?.replace(/^准备\s*/u, "")
    .replace(/(?:已)?完成$/u, "")
    .replace(/未完成$/u, "")
    .trim();
  if (cleaned === undefined || cleaned.length === 0 || isLowValueToolFallback(cleaned)) {
    return undefined;
  }
  return cleaned;
}

function fallbackToolNameText(node: ProjectableTranscriptNode): string | undefined {
  const toolName = normalizedToolName(node.toolName);
  if (toolName.length === 0) {
    return undefined;
  }
  const verb = toolVerb(node);
  if (verb === "读取") return toolName.includes("file") ? "读取文件" : "读取资料";
  if (verb === "查看") return "浏览目录";
  if (verb === "搜索") return "搜索";
  if (verb === "命令") return "运行命令";
  if (verb === "网页") return "读取网页";
  if (verb === "创建") return "创建文件";
  if (verb === "删除") return "删除文件";
  if (verb === "写入") return "写入文件";
  if (verb === "编辑") return "编辑文件";
  if (verb === "生成") return "生成内容";
  return cleanToolTargetText(toolName.replace(/[_-]+/g, " "));
}

function isLowValueToolFallback(value: string): boolean {
  const normalized = value.replace(/[。.!！?？；;:：、，,\s_-]/g, "").trim().toLowerCase();
  return normalized.length === 0 ||
    normalized === "tool" ||
    normalized === "工具" ||
    normalized === "使用工具" ||
    normalized === "工具结果" ||
    normalized === "工具调用" ||
    normalized === "动作";
}

function activityItemKey(node: ProjectableTranscriptNode): string {
  const ref = node.refs.find((item) =>
    item.kind === "tool_call" ||
    item.kind === "model_call" ||
    item.kind === "confirmation"
  );
  const owner = ref === undefined ? node.nodeId : `${ref.kind}:${ref.id}`;
  return `${node.runId}:${node.kind}:${owner}:${stableActivityEventKey(node)}`;
}

function stableActivityEventKey(node: ProjectableTranscriptNode): string {
  if (node.kind === "thinking" && node.eventType.startsWith("model.reasoning.")) {
    return "model.reasoning";
  }
  if (isModelSideOutputNode(node)) {
    return "model.side";
  }
  return node.eventType;
}

function activityToneForNode(node: ProjectableTranscriptNode): ActivityItem["tone"] {
  if (node.kind === "thinking") return "thinking";
  if (isModelSideOutputNode(node)) return "narration";
  if (node.kind === "tool") return "tool";
  if (node.kind === "confirmation") return "confirmation";
  if (node.kind === "user_decision") return "decision";
  if (node.kind === "sub_agent") return "sub_agent";
  return "system";
}

function readableActivityText(value: string): string {
  return value
    .replace(/`([^`]+)`/g, " $1 ")
    .replace(/([A-Za-z0-9])--(?=[A-Za-z])/g, "$1 --")
    .replace(/([A-Za-z])(?=\d)/g, "$1 ")
    .replace(/(\d(?:-\d+)?)(?=[A-Za-z])/g, "$1 ")
    .replace(/([A-Za-z]+'(?:ve|re|ll|d|m|t))(?=[A-Za-z])/gi, "$1 ")
    .replace(/([A-Za-z]+'s)(?=[A-Za-z])/g, "$1 ")
    .replace(/([A-Za-z0-9][.!?])(?=[A-Z])/g, "$1 ")
    .replace(/([A-Za-z0-9]),(?=[A-Za-z])/g, "$1, ")
    .replace(/([A-Za-z0-9]);(?=[A-Za-z])/g, "$1; ")
    .replace(/^[,;:，；：]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function readableModelActivityText(value: string): string {
  return readableExpandedModelText(value).replace(/\s+/g, " ").trim();
}

function readableExpandedModelText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0 || isMarkdownDivider(trimmed)) {
        return "";
      }
      return stripMarkdownLinePrefix(trimmed);
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function readableToolTarget(value: string | undefined): Pick<ActivityLineCopy, "detail" | "expandedDetail"> | undefined {
  const text = readableActivityText(value ?? "");
  if (text.length === 0) return undefined;
  const detail = compact(text, 120);
  return detail === text ? { detail } : { detail, expandedDetail: text };
}

function readResultTarget(
  display: Extract<NonNullable<ProjectableTranscriptNode["display"]>, { readonly kind: "read_result" }>,
  summary: string | undefined,
): string | undefined {
  const target = cleanToolTargetText(display.title ?? display.uri ?? display.url ?? summary);
  if (target === undefined) {
    return undefined;
  }
  return compactReadTarget(target);
}

function compactReadTarget(value: string): string {
  const firstLine = value.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? value.trim();
  return firstLine
    .replace(/\s*[·•]\s*\d+(?:\.\d+)?\s*(?:bytes?|b|kb|mb)\b.*$/iu, "")
    .replace(/\s*[·•]\s*lines?\s+\d+(?:-\d+)?\s+of\s+\d+.*$/iu, "")
    .replace(/\s*[·•]\s*truncated\b.*$/iu, "")
    .replace(/\s+\d+(?:\.\d+)?\s*(?:bytes?|b|kb|mb)\b.*$/iu, "")
    .replace(/\s+lines?\s+\d+(?:-\d+)?\s+of\s+\d+.*$/iu, "")
    .replace(/\s+truncated\b.*$/iu, "")
    .trim();
}

function cleanToolTargetText(value: string | undefined): string | undefined {
  const text = cleanConfirmationSummary(value ?? "")
    .split(/\r?\n/)
    .map((line) => cleanOrdinaryToolText(line) ?? "")
    .join("\n")
    .replace(/^generic_tool_summary[:：]?\s*/i, "")
    .replace(/^(?:目标|搜索|命令|路径|文件|查询)[:：]\s*/u, "")
    .replace(/^\.(\s*·\s*)/u, "当前目录$1")
    .replace(/^\.$/u, "当前目录")
    .trim();
  return text.length === 0 ? undefined : text;
}

function searchResultLine(
  title: string | undefined,
  source: string | undefined,
  url: string | undefined,
  summary: string | undefined,
): string {
  const headline = [title, source ?? compactHostLabel(url)]
    .filter((value): value is string => value !== undefined && value.trim().length > 0)
    .join(" · ");
  const detail = cleanToolTargetText(summary);
  if (headline.length === 0) {
    return detail ?? "";
  }
  return detail === undefined ? headline : `${headline}\n${detail}`;
}

function compactHostLabel(value: string | undefined): string | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  try {
    return new URL(value).host || value;
  } catch {
    return value;
  }
}

function compactHttpHostLabel(value: string | undefined): string | undefined {
  const href = httpHref(value);
  return href === undefined ? undefined : compactHostLabel(href);
}

function httpStatusTone(code: number): ActivityBadge["tone"] {
  if (code >= 500) return "danger";
  if (code >= 400) return "warning";
  if (code >= 200 && code < 300) return "success";
  return "neutral";
}

function durationLabel(value: number): string {
  if (!Number.isFinite(value)) {
    return "0ms";
  }
  if (value < 1_000) {
    return `${Math.max(0, Math.round(value))}ms`;
  }
  const seconds = value / 1_000;
  const rounded = seconds < 10 ? seconds.toFixed(1) : Math.round(seconds).toString();
  return `${rounded.replace(/\.0$/, "")}s`;
}

function byteLabel(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return "0 B";
  }
  if (value < 1_024) {
    return `${Math.round(value)} B`;
  }
  if (value < 1_024 * 1_024) {
    return `${(value / 1_024).toFixed(value < 10 * 1_024 ? 1 : 0).replace(/\.0$/, "")} KB`;
  }
  return `${(value / (1_024 * 1_024)).toFixed(1).replace(/\.0$/, "")} MB`;
}

function narrationCandidate(value: string): string | undefined {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const collected: string[] = [];
  for (const line of lines) {
    if (isMarkdownDivider(line)) {
      continue;
    }
    const cleaned = stripMarkdownLinePrefix(line);
    if (cleaned.length === 0) continue;
    collected.push(cleaned);
    if (sentenceCount(collected.join(" ")) >= 2) break;
  }
  const joined = collected.join(" ");
  const text = stripMarkdownStructure(joined);
  return text.length === 0 ? undefined : text;
}

function stripMarkdownStructure(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      return isMarkdownDivider(trimmed) ? "" : stripMarkdownLinePrefix(trimmed);
    })
    .filter((line) => line.length > 0)
    .join(" ");
}

function stripMarkdownLinePrefix(value: string): string {
  return stripMarkdownEmphasis(value)
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+[.)、]\s+/, "")
    .replace(/^(?:\d\uFE0F?\u20E3|[①-⑳])\s*/u, "")
    .replace(/^[🔍📁📄📝✏️⚡🧠✅🖥️]\s*/u, "")
    .replace(/^>\s*/, "")
    .trim();
}

function stripMarkdownEmphasis(value: string): string {
  return value
    .replace(/^\*{1,2}\s*/, "")
    .replace(/\s*\*{1,2}$/, "")
    .trim();
}

function isMarkdownDivider(value: string): boolean {
  return /^-{3,}$/.test(value);
}

function takeNaturalSentences(value: string, maxSentences: number): string {
  const sentences: string[] = [];
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] ?? "";
    if (!isSentenceBoundary(value, index, char)) {
      continue;
    }
    const sentence = value.slice(start, index + 1).trim();
    if (sentence.length > 0) {
      sentences.push(sentence);
    }
    start = index + 1;
    if (sentences.length >= maxSentences) {
      return sentences.join(" ").trim();
    }
  }
  const rest = value.slice(start).trim();
  if (rest.length > 0) {
    sentences.push(rest);
  }
  return sentences.length === 0 ? value : sentences.slice(0, maxSentences).join(" ").trim();
}

function sentenceCount(value: string): number {
  return value.split(/[。！？!?\.]+/).filter((part) => part.trim().length > 0).length;
}

function isSentenceBoundary(value: string, index: number, char: string): boolean {
  if (/[。！？!?]/u.test(char)) {
    return true;
  }
  if (char !== ".") {
    return false;
  }
  const next = value[index + 1] ?? "";
  return next.length === 0 || /\s/u.test(next);
}

function compact(value: string | undefined, maxLength: number): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}
