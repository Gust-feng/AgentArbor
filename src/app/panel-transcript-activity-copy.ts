import { cleanConfirmationSummary } from "./confirmation-copy.js";
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

export type ActivityItem = {
  readonly nodeId: string;
  readonly key: string;
  readonly copy: ActivityLineCopy;
  readonly tone: "thinking" | "narration" | "tool" | "confirmation" | "decision" | "system";
  readonly phase: ProjectableTranscriptNode["phase"];
};

export function activityLineForNode(node: ProjectableTranscriptNode): ActivityLineCopy | undefined {
  if (node.kind === "thinking") {
    return readableThinkingCopy(node.text ?? node.summary ?? "");
  }
  if (node.kind === "tool") {
    const target = toolTargetCopy(node);
    const copy = {
      label: toolVerb(node),
      detail: target?.detail ?? toolStatusText(node),
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
      return { label: "问题", detail: readableNarrationText(node.text ?? node.summary ?? node.title) ?? "任务未完成。" };
    }
    if (node.phase === "cancelled") return { label: "已停止", detail: "任务已取消。" };
    const detail = readableNarrationText(node.text ?? node.summary ?? node.title);
    return detail === undefined ? undefined : { detail };
  }
  return undefined;
}

export function activityItemsForNodes(nodes: readonly ProjectableTranscriptNode[]): readonly ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const node of nodes) {
    const copy = activityLineForNode(node);
    if (copy === undefined) continue;
    items.push({
      nodeId: node.nodeId,
      key: activityItemKey(node),
      copy,
      tone: activityToneForNode(node),
      phase: node.phase,
    });
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
    items.push(item);
  }
  return items;
}

function activityItemFromNode(node: ProjectableTranscriptNode, copy: ActivityLineCopy): ActivityItem {
  return {
    nodeId: node.nodeId,
    key: activityItemKey(node),
    copy,
    tone: activityToneForNode(node),
    phase: node.phase,
  };
}

function toolCallIdForActivityNode(node: ProjectableTranscriptNode): string | undefined {
  return node.refs.find((item) => item.kind === "tool_call")?.id;
}

function isTerminalToolNode(node: ProjectableTranscriptNode): boolean {
  return node.eventType === "tool.completed" || node.eventType === "tool.failed";
}

function mergeToolActivityItems(requested: ActivityItem, terminal: ActivityItem): ActivityItem {
  return {
    ...terminal,
    key: requested.key,
    copy: {
      ...terminal.copy,
      expandedDetail: mergedToolExpandedDetail(requested.copy, terminal.copy, terminal.phase),
    },
  };
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
    return { label: "待确认", detail: "等待确认。" };
  }
  const detail = compact(readableActivityText(action), 180);
  return detail === action ? { label: "待确认", detail } : { label: "待确认", detail, expandedDetail: action };
}

function readableUserDecisionCopy(node: ProjectableTranscriptNode): ActivityLineCopy {
  const fallback = userDecisionFallback(node.phase);
  const raw = cleanConfirmationSummary(node.text ?? node.summary ?? "");
  const detail = readableActivityText(stripUserDecisionBoilerplate(stripMarkdownStructure(raw)));
  if (detail.length === 0) {
    return { detail: fallback };
  }
  const compactDetail = compact(detail, 180);
  return compactDetail === detail
    ? { detail }
    : { detail: compactDetail, expandedDetail: detail };
}

function userDecisionFallback(phase: ProjectableTranscriptNode["phase"]): string {
  if (phase === "denied") return "已拒绝。";
  if (phase === "guidance") return "已补充要求。";
  return "已批准。";
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
  return detail === expandedDetail ? { detail } : { detail, expandedDetail };
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
  return detail === expandedDetail ? { detail } : { detail, expandedDetail };
}

function toolVerb(node: ProjectableTranscriptNode): string {
  const display = node.display;
  const toolName = normalizedToolName(node.toolName);
  const action = display?.kind === "generic_tool_summary" ? display.action?.toLowerCase() ?? "" : "";
  if (display?.kind === "command_summary" || toolName === "run_command" || toolName === "shell_command" || toolName.includes("terminal") || toolName.includes("powershell") || toolName.includes("cmd")) return "命令";
  if (display?.kind === "search_results" || toolName === "search" || toolName === "web_search" || toolName.includes("grep")) return "搜索";
  if (display?.kind === "browser_snapshot" || toolName === "browser_snapshot" || toolName.includes("browser")) return "网页";
  if (display?.kind === "file_diff_preview" || toolName === "edit_file" || toolName.includes("patch") || toolName.includes("replace")) return "编辑";
  if (toolName === "delete_file" || toolName.includes("delete") || toolName.includes("remove")) return "删除";
  if (toolName === "create_file" || toolName.includes("create")) return "创建";
  if (display?.kind === "file_change_summary") {
    return "写入";
  }
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

function toolTargetCopy(node: ProjectableTranscriptNode): Pick<ActivityLineCopy, "detail" | "expandedDetail"> | undefined {
  const display = node.display;
  if (display?.kind === "command_summary") {
    const command = cleanToolTargetText(commandText(display) ?? node.summary);
    const failure = node.phase === "failed" ? cleanToolTargetText(display.errorSummary) : undefined;
    return readableToolTarget([command, failure].filter((value): value is string => value !== undefined && value.trim().length > 0).join(" · "));
  }
  if (display?.kind === "search_results") {
    return readableToolTarget(cleanToolTargetText(display.query ?? node.summary));
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
    return readableToolTarget(summary);
  }
  return readableToolTarget(cleanToolTargetText(node.summary));
}

function toolStatusText(node: ProjectableTranscriptNode): string {
  if (node.phase === "preparing") return "正在准备。";
  if (node.phase === "executing") return "正在处理。";
  if (node.phase === "failed") return "动作未完成。";
  if (node.phase === "blocked") return "等待确认后继续。";
  return readableToolTarget(node.title)?.detail ?? "动作已记录。";
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
