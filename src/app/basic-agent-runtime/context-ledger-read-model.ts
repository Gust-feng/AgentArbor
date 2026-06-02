import type { ContextLedger, ContextLedgerEntry } from "../../domain/basic-agent/index.js";
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
    summary: safeContextText(item.sourceKind === "system" ? "桌面基础 Agent 系统边界。" : item.summary, 360).text,
    refs: item.refs,
    status: item.truncated ? "truncated" : "used",
  }));
  const omittedEntries = omittedItems.slice(0, 12).map((item): ContextLedgerEntry => ({
    entryId: `${item.itemId}:omitted`,
    kind: contextLedgerEntryKind(item.sourceKind),
    title: contextLedgerEntryTitle(item),
    summary: "因上下文预算限制，该项未进入模型输入；普通视图只保留引用和状态。",
    refs: item.refs,
    status: "omitted",
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

function contextBudgetEntries(
  runId: string,
  budget: BasicAgentContextBudget,
  truncationReport: BasicAgentContextTruncationReport
): readonly ContextLedgerEntry[] {
  const entries: ContextLedgerEntry[] = [
    {
      entryId: `${runId}:context-budget`,
      kind: "budget",
      title: "上下文预算",
      summary: [
        `maxInputTokens=${budget.maxInputTokens}`,
        `usedInputTokens=${budget.usedInputTokens}`,
        `tokenCountSource=${budget.tokenCountSource}`,
        `maxChars=${budget.maxChars}`,
        `usedChars=${budget.usedChars}`,
        `source=${budget.budgetSource}`,
      ].join("；"),
      refs: [],
      status: truncationReport.truncated ? "truncated" : "used",
    },
  ];
  if (truncationReport.omittedItemCount > 0) {
    entries.push({
      entryId: `${runId}:context-omitted`,
      kind: "truncation",
      title: "未进入模型的上下文",
      summary: `因上下文预算限制，${truncationReport.omittedItemCount} 项上下文未进入模型输入。`,
      refs: [],
      status: "omitted",
    });
  }
  if (truncationReport.truncatedItemIds.length > 0) {
    entries.push({
      entryId: `${runId}:context-truncated`,
      kind: "truncation",
      title: "已截断上下文",
      summary: `已截断上下文项：${truncationReport.truncatedItemIds.slice(0, 8).join("；")}`,
      refs: [],
      status: "truncated",
    });
  }
  return entries;
}

function contextLedgerEntryKind(kind: BasicAgentContextSourceKind): ContextLedgerEntry["kind"] {
  if (kind === "system" || kind === "user_message") return "goal";
  if (kind === "conversation" || kind === "conversation_summary" || kind === "conversation_recent_turn") return "history";
  if (kind === "skill") return "skill";
  if (kind === "task_soil_ref") return "attachment";
  return "tool_evidence";
}

function contextLedgerEntryTitle(item: BasicAgentContextItem): string {
  const labels: Record<BasicAgentContextSourceKind, string> = {
    system: "系统边界",
    skill: "技能",
    conversation: "历史对话",
    conversation_summary: "历史摘要",
    conversation_recent_turn: "最近对话",
    user_message: "当前任务",
    task_soil_ref: "上下文引用",
    tool_evidence: "工具证据",
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
    system: "系统边界",
    skill: "技能",
    conversation: "历史对话",
    conversation_summary: "历史摘要",
    conversation_recent_turn: "最近对话",
    user_message: "当前任务",
    task_soil_ref: "上下文引用",
    tool_evidence: "工具证据",
  };
  const summary = [...counts.entries()]
    .map(([kind, count]) => `${labels[kind]} ${count}`)
    .join("；");
  return omittedItems.length === 0 ? summary : `${summary}；未进入模型 ${omittedItems.length}`;
}
