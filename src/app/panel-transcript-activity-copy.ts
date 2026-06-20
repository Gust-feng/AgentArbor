import { cleanConfirmationSummary, isGenericApprovalDecisionText } from "./confirmation-copy.js";
import {
  isFileReadNode,
  isModelSideOutputNode,
  normalizedToolName,
  type ProjectableTranscriptNode,
} from "./panel-transcript-node-projection.js";
import { commandText, genericItemLabel } from "./panel-transcript-tool-format.js";
import { cleanOrdinaryToolText } from "./ordinary-tool-copy.js";

export type ActivityLineCopy = {
  readonly label?: string;
  readonly detail: string;
  readonly expandedDetail?: string;
};

export type ActivityExpandedSection = {
  readonly title: string;
  readonly content: string;
  readonly format?: "plain" | "code" | "list";
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
  readonly copy: ActivityLineCopy;
  readonly tone: "thinking" | "narration" | "tool" | "confirmation" | "decision" | "system";
  readonly phase: ProjectableTranscriptNode["phase"];
  readonly toolKind?: "command" | "search" | "read" | "edit" | "web" | "thinking" | "system" | "confirmation" | "decision" | "other";
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
  if (node.kind === "system") {
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
      copy,
      tone,
      phase: node.phase,
      toolKind: resolveActivityToolKind({ tone, copy }),
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
  for (const node of nodes) {
    const copy = activityLineForNode(node);
    if (copy === undefined) continue;
    const item = activityItemFromNode(node, copy);
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

function activityItemFromNode(node: ProjectableTranscriptNode, copy: ActivityLineCopy): ActivityItem {
  const tone = activityToneForNode(node);
  return {
    nodeId: node.nodeId,
    key: activityItemKey(node),
    copy,
    tone,
    phase: node.phase,
    toolKind: resolveActivityToolKind({ tone, copy }),
    statusBadge: activityStatusBadge(node),
    badges: activityBadgesForNode(node),
    expandedSections: activityExpandedSectionsForNode(node, copy),
  };
}

function activityStatusBadge(node: ProjectableTranscriptNode): ActivityBadge | undefined {
  if (node.kind === "confirmation") {
    return { label: "待确认", tone: "warning" };
  }
  if (node.kind === "user_decision") {
    if (node.phase === "guidance") return { label: "已补充", tone: "accent" };
    if (node.phase === "denied") return { label: "已拒绝", tone: "danger" };
    if (node.phase === "approved") return { label: "已允许", tone: "success" };
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
  if (display?.kind === "command_summary") {
    if (display.exitCode !== undefined) {
      badges.push({
        label: `exit ${display.exitCode}`,
        tone: display.exitCode === 0 ? "success" : "danger",
        monospace: true,
      });
    }
    if (display.durationMs !== undefined) {
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
    badges.push({ label: `${display.results?.length ?? 0} 条结果`, tone: "accent" });
    if (display.truncated === true) badges.push({ label: "已截断", tone: "warning" });
  } else if (display?.kind === "read_result") {
    const source = compactHostLabel(display.url ?? display.uri);
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
    if (display.replacements !== undefined) {
      badges.push({ label: `${display.replacements} 处修改`, tone: "warning" });
    }
    if (display.bytes !== undefined) {
      badges.push({ label: byteLabel(display.bytes), monospace: true });
    }
    if (display.append === true) badges.push({ label: "追加", tone: "accent" });
    if (display.truncated === true) badges.push({ label: "预览截断", tone: "warning" });
  } else if (display?.kind === "generic_tool_summary") {
    if ((display.items?.length ?? 0) > 1) {
      badges.push({ label: `${display.items?.length ?? 0} 项` });
    }
  }
  return badges.length === 0 ? undefined : badges;
}

function activityExpandedSectionsForNode(
  node: ProjectableTranscriptNode,
  copy: ActivityLineCopy,
): readonly ActivityExpandedSection[] | undefined {
  const display = node.display;
  const sections: ActivityExpandedSection[] = [];
  if (display?.kind === "command_summary") {
    const command = commandText(display);
    if (command !== undefined) {
      sections.push({ title: "命令", content: command, format: "code" });
    }
    const context = [
      display.cwd === undefined ? undefined : `目录：${display.cwd}`,
      display.shell === undefined ? undefined : `Shell：${display.shell}`,
      display.logPath === undefined ? undefined : `日志：${display.logPath}`,
      display.stopCommand === undefined ? undefined : `停止：${display.stopCommand}`,
    ].filter((value): value is string => value !== undefined && value.trim().length > 0);
    if (context.length > 0) {
      sections.push({ title: "执行环境", content: context.join("\n"), format: "list" });
    }
    if (display.outputSummary !== undefined) {
      sections.push({ title: "输出摘要", content: display.outputSummary });
    }
    if (display.errorSummary !== undefined) {
      sections.push({ title: "错误摘要", content: display.errorSummary, tone: "danger" });
    }
  } else if (display?.kind === "search_results") {
    if (display.query !== undefined) {
      sections.push({ title: "查询", content: display.query });
    }
    if (display.message !== undefined) {
      sections.push({ title: "摘要", content: display.message });
    }
    const results = (display.results ?? [])
      .slice(0, 5)
      .map((result) => searchResultLine(result.title, result.source, result.url, result.summary ?? result.snippet));
    if (results.length > 0) {
      sections.push({ title: "命中结果", content: results.join("\n"), format: "list" });
    }
  } else if (display?.kind === "read_result") {
    const source = [display.title, display.url ?? display.uri]
      .filter((value): value is string => value !== undefined && value.trim().length > 0)
      .join("\n");
    if (source.length > 0) {
      sections.push({ title: "资料", content: source });
    }
    if (display.contentPreview !== undefined) {
      sections.push({ title: "摘录", content: display.contentPreview, format: "code" });
    }
    if (display.error !== undefined) {
      sections.push({ title: "错误摘要", content: display.error, tone: "danger" });
    }
  } else if (display?.kind === "browser_snapshot") {
    const source = [display.title, display.url]
      .filter((value): value is string => value !== undefined && value.trim().length > 0)
      .join("\n");
    if (source.length > 0) {
      sections.push({ title: "网页", content: source });
    }
    if (display.summary !== undefined) {
      sections.push({ title: "页面摘要", content: display.summary });
    }
    if (display.text !== undefined) {
      sections.push({ title: "页面摘录", content: display.text, format: "code" });
    }
  } else if (display?.kind === "http_response") {
    const responseLine = [
      display.method,
      display.url,
      display.statusCode === undefined ? undefined : `${display.statusCode}${display.statusText === undefined ? "" : ` ${display.statusText}`}`,
    ].filter((value): value is string => value !== undefined && value.trim().length > 0).join("\n");
    if (responseLine.length > 0) {
      sections.push({ title: "响应", content: responseLine });
    }
    if (display.bodyPreview !== undefined) {
      sections.push({ title: "内容预览", content: display.bodyPreview, format: "code" });
    }
  } else if (display?.kind === "file_change_summary" || display?.kind === "file_diff_preview") {
    if (display.path !== undefined) {
      sections.push({ title: "文件", content: display.path, format: "code" });
    }
    if (display.summary !== undefined && display.summary.trim() !== copy.detail.trim()) {
      sections.push({ title: "摘要", content: display.summary });
    }
    if (display.preview !== undefined) {
      sections.push({
        title: display.kind === "file_diff_preview" ? "差异预览" : "内容预览",
        content: display.preview,
        format: "code",
      });
    }
  } else if (display?.kind === "generic_tool_summary") {
    if (display.summary !== undefined && display.summary.trim() !== copy.detail.trim()) {
      sections.push({ title: "摘要", content: display.summary });
    }
    const items = display.items
      ?.map((item) => cleanToolTargetText(genericItemLabel(item)) ?? "")
      .filter((value) => value.length > 0);
    if ((items?.length ?? 0) > 0) {
      sections.push({ title: "条目", content: items!.join("\n"), format: "list" });
    }
  }
  const fallback = copy.expandedDetail === undefined ? [] : [{ title: "详情", content: copy.expandedDetail }];
  const allSections = dedupeExpandedSections([...sections, ...fallback]);
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
  return {
    ...terminal,
    key: requested.key,
    copy: {
      ...terminal.copy,
      expandedDetail: mergedToolExpandedDetail(requested.copy, terminal.copy, terminal.phase),
    },
    toolKind: resolveActivityToolKind(terminal),
    expandedSections: sections.length > 0 ? sections : undefined,
  };
}

function buildExpandedSections(
  requested: ActivityItem,
  terminal: ActivityItem,
): readonly ActivityExpandedSection[] {
  const sections: ActivityExpandedSection[] = [];
  const reqDetail = requested.copy.detail.trim();
  const termDetail = terminal.copy.detail.trim();

  if (reqDetail.length > 0) {
    sections.push({ title: "发起", content: reqDetail });
  }
  if (termDetail !== reqDetail && termDetail.length > 0) {
    sections.push({
      title: terminal.phase === "failed" ? "失败" : "结果",
      content: termDetail,
    });
  }
  const terminalSections = terminal.expandedSections ?? fallbackExpandedSections(terminal.copy);
  return dedupeExpandedSections(appendSectionsWithoutDuplicateContent(sections, terminalSections));
}

function mergedToolExpandedDetail(
  requested: ActivityLineCopy,
  terminal: ActivityLineCopy,
  phase: ProjectableTranscriptNode["phase"]
): string | undefined {
  if (terminal.expandedDetail === undefined && terminal.detail.trim() === requested.detail.trim()) {
    return undefined;
  }
  const lines = uniqueDetailLines([
    phaseDetailLine("发起", requested),
    terminal.detail === requested.detail ? undefined : phaseDetailLine(phase === "failed" ? "失败" : "结果", terminal),
    terminal.expandedDetail,
  ]);
  return lines.length === 0 ? undefined : lines.join("\n");
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

function phaseDetailLine(label: string, copy: ActivityLineCopy): string | undefined {
  const detail = copy.detail.trim();
  if (detail.length === 0) return undefined;
  return `${label}：${detail}`;
}

function uniqueDetailLines(values: readonly (string | undefined)[]): readonly string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const value of values) {
    if (value === undefined) continue;
    for (const line of value.split("\n")) {
      const normalized = line.trim();
      if (normalized.length === 0 || seen.has(normalized)) continue;
      seen.add(normalized);
      lines.push(normalized);
    }
  }
  return lines;
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

function toolVerb(node: ProjectableTranscriptNode): string {
  const display = node.display;
  const toolName = normalizedToolName(node.toolName);
  const action = display?.kind === "generic_tool_summary" ? display.action?.toLowerCase() ?? "" : "";
  const fileMutationVerb = fileMutationVerbForTool(toolName, display);
  if (display?.kind === "command_summary" || toolName === "run_command" || toolName === "shell_command" || toolName.includes("terminal") || toolName.includes("powershell") || toolName.includes("cmd")) return "命令";
  if (display?.kind === "search_results" || toolName === "search" || toolName === "web_search" || toolName.includes("grep")) return "搜索";
  if (fileMutationVerb !== undefined) return fileMutationVerb;
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
    return readableToolTarget([command, failure].filter((value): value is string => value !== undefined && value.trim().length > 0).join(" · "));
  }
  if (display?.kind === "search_results") {
    return readableToolTarget(cleanToolTargetText(
      [display.query, display.message].filter((value): value is string => value !== undefined && value.trim().length > 0).join(" · ") || node.summary
    ));
  }
  if (display?.kind === "read_result") {
    return readableToolTarget(cleanToolTargetText(display.title ?? display.uri ?? display.url ?? node.summary));
  }
  if (display?.kind === "browser_snapshot") {
    return readableToolTarget(cleanToolTargetText(display.title ?? display.url ?? node.summary));
  }
  if (display?.kind === "file_change_summary" || display?.kind === "file_diff_preview") {
    return readableToolTarget(cleanToolTargetText(display.path ?? node.summary));
  }
  if (display?.kind === "generic_tool_summary") {
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
    return readableToolTarget(summary ?? (fileMutationVerbForTool(normalizedToolName(node.toolName), display) === undefined ? undefined : display.action));
  }
  return readableToolTarget(cleanToolTargetText(node.summary));
}

function toolStatusText(node: ProjectableTranscriptNode): string | undefined {
  if (node.phase === "failed") return "动作未完成。";
  return undefined;
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
