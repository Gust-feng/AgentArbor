import type { ContextLedger, ContextLedgerEntry, ContextLedgerSkillFacts } from "../../domain/basic-agent/index.js";
import type {
  BasicAgentContextBudget,
  BasicAgentContextItem,
  BasicAgentContextSourceKind,
  BasicAgentContextTruncationReport,
} from "./contracts.js";
import { safeContextText } from "./context-ledger-safe-text.js";

export function toContextLedgerReadModel(
  runId: string,
  items: readonly BasicAgentContextItem[],
  omittedItems: readonly BasicAgentContextItem[],
  budget: BasicAgentContextBudget,
  truncationReport: BasicAgentContextTruncationReport
): ContextLedger {
  const usedEntries = items.map((item): ContextLedgerEntry => ({
    entryId: item.itemId,
    kind: contextLedgerEntryKind(item.sourceKind),
    title: contextLedgerEntryTitle(item),
    summary: readModelSummaryForItem(item),
    refs: item.refs,
    status: item.skill?.loadStatus === "failed" ? "failed" : item.truncated ? "truncated" : "used",
    skill: skillFactsForEntry(item, item.skill?.loadStatus === "failed" ? "failed" : "injected"),
  }));
  const omittedEntries = omittedItems.slice(0, 12).map((item): ContextLedgerEntry => ({
    entryId: `${item.itemId}:omitted`,
    kind: contextLedgerEntryKind(item.sourceKind),
    title: contextLedgerEntryTitle(item),
    summary: item.sourceKind === "skill" ? readModelSummaryForItem(item) : "本轮暂未使用这项上下文。",
    refs: item.refs,
    status: "omitted",
    skill: skillFactsForEntry(item, "omitted"),
  }));
  const budgetEntries = contextBudgetEntries(runId, budget, truncationReport);
  const entries = [...usedEntries, ...omittedEntries, ...budgetEntries];
  return {
    runId,
    summary: contextUsageSummary(items, omittedItems),
    entries,
    budget,
    truncation: truncationReport,
  };
}

function readModelSummaryForItem(item: BasicAgentContextItem): string {
  if (item.sourceKind === "system") {
    return "当前任务的系统指令。";
  }
  if (item.sourceKind === "skill" && item.skill !== undefined) {
    return safeContextText(item.skill.summary, 360).text;
  }
  return safeContextText(item.summary, 360).text;
}

function skillFactsForEntry(
  item: BasicAgentContextItem,
  injectionStatus: ContextLedgerSkillFacts["injectionStatus"]
): ContextLedgerSkillFacts | undefined {
  if (item.skill === undefined) {
    return undefined;
  }
  const status = item.skill.loadStatus === "failed" ? "failed" : injectionStatus;
  return {
    ...item.skill,
    injectionStatus: status,
    truncated: item.truncated || item.skill.truncated,
    omitted: status === "omitted",
  };
}

function contextBudgetEntries(
  runId: string,
  budget: BasicAgentContextBudget,
  truncationReport: BasicAgentContextTruncationReport
): readonly ContextLedgerEntry[] {
  const entries: ContextLedgerEntry[] = [
    {
      entryId: `${runId}:context-budget`,
      kind: "budget",
      title: "上下文范围",
      summary: contextBudgetSummary(budget),
      refs: [],
      status: truncationReport.truncated ? "truncated" : "used",
    },
  ];
  if (truncationReport.omittedItemCount > 0) {
    entries.push({
      entryId: `${runId}:context-omitted`,
      kind: "truncation",
      title: "暂未使用的上下文",
      summary: `${truncationReport.omittedItemCount} 项上下文暂未用于本轮处理。`,
      refs: [],
      status: "omitted",
    });
  }
  if (truncationReport.truncatedItemIds.length > 0) {
    entries.push({
      entryId: `${runId}:context-truncated`,
      kind: "truncation",
      title: "已截断上下文",
      summary: `部分上下文已压缩：${truncationReport.truncatedItemIds.length} 项。`,
      refs: [],
      status: "truncated",
    });
  }
  return entries;
}

function contextBudgetSummary(budget: BasicAgentContextBudget): string {
  const parts = [
    budget.usedChars > 0 ? `已整理 ${budget.usedChars} 字符` : undefined,
    budget.maxChars > 0 ? `上限 ${budget.maxChars} 字符` : undefined,
    budget.usedInputTokens > 0 ? `约 ${budget.usedInputTokens} tokens` : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.length === 0 ? "已按当前任务整理上下文。" : parts.join("；");
}

function contextLedgerEntryKind(kind: BasicAgentContextSourceKind): ContextLedgerEntry["kind"] {
  if (kind === "system" || kind === "user_message") return "goal";
  if (
    kind === "conversation" ||
    kind === "conversation_summary" ||
    kind === "conversation_recent_turn" ||
    kind === "run_interruption"
  ) return "history";
  if (kind === "skill") return "skill";
  if (kind === "task_soil_ref") return "attachment";
  return assertNever(kind);
}

function contextLedgerEntryTitle(item: BasicAgentContextItem): string {
  const labels: Record<BasicAgentContextSourceKind, string> = {
    system: "系统指令",
    skill: "技能",
    conversation: "历史对话",
    conversation_summary: "历史摘要",
    conversation_recent_turn: "最近对话",
    run_interruption: "运行中断",
    user_message: "当前任务",
    task_soil_ref: "上下文引用",
  };
  return labels[item.sourceKind];
}

function contextUsageSummary(
  items: readonly BasicAgentContextItem[],
  omittedItems: readonly BasicAgentContextItem[] = []
): string {
  const counts = new Map<BasicAgentContextSourceKind, number>();
  for (const item of items) {
    counts.set(item.sourceKind, (counts.get(item.sourceKind) ?? 0) + 1);
  }
  const labels: Record<BasicAgentContextSourceKind, string> = {
    system: "系统指令",
    skill: "技能",
    conversation: "历史对话",
    conversation_summary: "历史摘要",
    conversation_recent_turn: "最近对话",
    run_interruption: "运行中断",
    user_message: "当前任务",
    task_soil_ref: "上下文引用",
  };
  const summary = [...counts.entries()]
    .map(([kind, count]) => `${labels[kind]} ${count}`)
    .join("；");
  return omittedItems.length === 0 ? summary : `${summary}；暂未使用 ${omittedItems.length}`;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported context source kind: ${String(value)}`);
}
