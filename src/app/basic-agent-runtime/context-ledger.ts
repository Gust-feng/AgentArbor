import type { ContextLedger, ContextLedgerEntry } from "../../domain/basic-agent/index.js";
import type { ModelCapabilities } from "../../domain/config/index.js";
import type { ObservationRef } from "../../domain/observation/index.js";
import type { TaskSoil } from "../../domain/soil/index.js";
import type { ToolResultEnvelope } from "../../domain/tools/index.js";
import { createId } from "../../kernel/id.js";
import { redactSensitiveText } from "../../kernel/redaction.js";
import type { DesktopAgentConversationMessage } from "../desktop-agent-session.js";
import type { DesktopAgentSkillContext } from "../desktop-agent-prompts.js";
import { sanitizeConversationHistoryText } from "../visible-text-safety.js";
import type { BasicAgentContextItem, BasicAgentContextSourceKind } from "./context-pack.js";
import type { BasicAgentConversationSummary } from "./conversation-compaction.js";
import { createOpenAITokenCounter, type BasicAgentTokenCounter } from "./token-counter.js";

export type BasicAgentContextLedger = {
  readonly ledgerId: string;
  readonly runId: string;
  readonly items: readonly BasicAgentContextItem[];
  readonly evidenceRefs: readonly string[];
  readonly budget: {
    readonly maxMessages: number;
    readonly maxInputTokens: number;
    readonly usedInputTokens: number;
    readonly tokenCountSource: string;
    readonly maxChars: number;
    readonly usedChars: number;
    readonly inputTokenBudget?: number;
    readonly reservedOutputTokens?: number;
    readonly budgetSource: "default" | "model_capabilities" | "override";
  };
  readonly truncationReport: {
    readonly truncated: boolean;
    readonly omittedItemCount: number;
    readonly truncatedItemIds: readonly string[];
  };
  readonly readModel: ContextLedger;
};

export type CreateBasicAgentContextLedgerInput = {
  readonly runId: string;
  readonly goal: string;
  readonly taskSoil: TaskSoil;
  readonly conversationHistory: readonly DesktopAgentConversationMessage[];
  readonly conversationSummary?: BasicAgentConversationSummary;
  readonly skillContexts?: readonly DesktopAgentSkillContext[];
  readonly toolEvidence?: readonly ToolResultEnvelope[];
  readonly modelCapabilities?: ModelCapabilities;
  readonly tokenCounter?: BasicAgentTokenCounter;
  readonly maxMessages?: number;
  readonly maxChars?: number;
  readonly maxInputTokens?: number;
};

const DEFAULT_MAX_MESSAGES = 200;
const DEFAULT_MAX_CHARS = 1_000_000;
const DEFAULT_MAX_INPUT_TOKENS = 4_500;
const MAX_HISTORY_CHARS = 1_200;
const MAX_HISTORY_SUMMARY_CHARS = 2_400;
const RECENT_HISTORY_PAIR_COUNT = 4;
const MAX_SKILL_BODY_CHARS = 4_000;
const MAX_SKILL_REASON_CHARS = 240;
const MAX_REF_SUMMARY_CHARS = 240;
const MAX_PREVIEW_CHARS = 700;
const MAX_TOOL_EVIDENCE_CHARS = 1_400;

const DESKTOP_AGENT_SYSTEM_PROMPT = [
  "You are AgentArbor Desktop Root Agent, the default local desktop working agent.",
  "Own the ordinary agent path: understand the task, answer directly when enough, use authorized tools when evidence is needed, ask for concrete confirmation or user guidance when context or permission is missing, and produce a usable result.",
  "Available tools may include web/research tools and local read-only workspace tools. Prefer read-only inspection before asking the user for repo facts that can be derived safely.",
  "Use the user's language. Keep the visible answer focused on result, evidence, uncertainty, and next step.",
  "If conversation history appears before the final user message, use it only as dialogue context. The final user message is the current instruction.",
  "If the user asks to inspect local desktop files but no file/folder ref or preview is provided, ask for explicit file selection or read-only authorization. Do not pretend you can see files.",
  "Do not write shell commands, web searches, or tool-call syntax as if they have already run. Either use an available authorized tool or clearly state that you need authorization, configuration, or context before performing the action.",
  "Do not route, package, or suggest this ordinary turn as a deeper organization flow. Explicit deep mode is a separate product entry selected outside this agent turn.",
  "Do not expose raw prompts, hidden reasoning, provider internals, or internal architecture terms unless the user asks for developer diagnostics.",
].join("\n");

// The ledger is the Basic Agent's single model-input governor. Context Pack
// serialization must consume this selected, redacted ledger instead of
// reassembling prompts from session, panel, or tool-specific helpers.
export function createBasicAgentContextLedger(input: CreateBasicAgentContextLedgerInput): BasicAgentContextLedger {
  const maxMessages = Math.max(4, Math.floor(input.maxMessages ?? DEFAULT_MAX_MESSAGES));
  const tokenCounter = input.tokenCounter ?? createOpenAITokenCounter();
  const tokenBudget = tokenBudgetFor(input.modelCapabilities);
  const maxInputTokens = Math.max(
    1_000,
    Math.floor(input.maxInputTokens ?? tokenBudget?.inputTokenBudget ?? DEFAULT_MAX_INPUT_TOKENS)
  );
  const maxChars = Math.max(2_000, Math.floor(input.maxChars ?? DEFAULT_MAX_CHARS));
  const draft = [
    systemContextItem(),
    ...skillContextItems(input.skillContexts ?? []),
    ...historyContextItems(input.conversationHistory, input.conversationSummary),
    ...taskSoilRefItems(input.taskSoil),
    ...toolEvidenceItems(input.toolEvidence ?? []),
    currentUserMessageItem(input.goal, input.taskSoil),
  ];
  return buildContextLedgerFromItems({
    runId: input.runId,
    draft,
    maxMessages,
    maxInputTokens,
    maxChars,
    tokenCounter,
    budget: {
      inputTokenBudget: tokenBudget?.inputTokenBudget,
      reservedOutputTokens: tokenBudget?.reservedOutputTokens,
      budgetSource:
        input.maxChars !== undefined || input.maxInputTokens !== undefined
          ? "override"
          : tokenBudget === undefined
            ? "default"
            : "model_capabilities",
    },
    extraEvidenceRefs: (input.toolEvidence ?? []).flatMap((envelope) => envelope.evidenceRefs),
  });
}

export function appendToolEnvelopeToContextLedger(
  ledger: BasicAgentContextLedger,
  envelope: ToolResultEnvelope
): BasicAgentContextLedger {
  return buildContextLedgerFromItems({
    runId: ledger.runId,
    draft: insertBeforeCurrentUser(ledger.items, toolEvidenceItems([envelope])),
    maxMessages: ledger.budget.maxMessages,
    maxInputTokens: ledger.budget.maxInputTokens,
    maxChars: ledger.budget.maxChars,
    tokenCounter: createOpenAITokenCounter(),
    budget: {
      inputTokenBudget: ledger.budget.inputTokenBudget,
      reservedOutputTokens: ledger.budget.reservedOutputTokens,
      budgetSource: ledger.budget.budgetSource,
    },
    extraEvidenceRefs: envelope.evidenceRefs,
  });
}

function buildContextLedgerFromItems(input: {
  readonly runId: string;
  readonly draft: readonly BasicAgentContextItem[];
  readonly maxMessages: number;
  readonly maxInputTokens: number;
  readonly maxChars: number;
  readonly tokenCounter: BasicAgentTokenCounter;
  readonly budget: {
    readonly inputTokenBudget?: number;
    readonly reservedOutputTokens?: number;
    readonly budgetSource: BasicAgentContextLedger["budget"]["budgetSource"];
  };
  readonly extraEvidenceRefs?: readonly string[];
}): BasicAgentContextLedger {
  const required = input.draft.filter(isRequiredContextItem);
  const selectedIds = new Set(required.map((item) => item.itemId));
  let usedChars = required.reduce((total, item) => total + item.summary.length, 0);
  let usedInputTokens = required.reduce((total, item) => total + contextItemTokenCount(input.tokenCounter, item), 0);
  let truncatedByBudget = usedInputTokens > input.maxInputTokens || usedChars > input.maxChars || required.length > input.maxMessages;

  for (const item of prioritizedOptionalContextItems(input.draft)) {
    if (selectedIds.has(item.itemId)) {
      continue;
    }
    const itemChars = item.summary.length;
    const itemTokens = contextItemTokenCount(input.tokenCounter, item);
    if (
      selectedIds.size >= input.maxMessages ||
      usedInputTokens + itemTokens > input.maxInputTokens ||
      usedChars + itemChars > input.maxChars
    ) {
      truncatedByBudget = true;
      continue;
    }
    selectedIds.add(item.itemId);
    usedChars += itemChars;
    usedInputTokens += itemTokens;
  }

  const selected = input.draft.filter((item) => selectedIds.has(item.itemId));
  const omitted = input.draft.filter((item) => !selectedIds.has(item.itemId));
  const omittedItemCount = omitted.length;
  const budget = {
    maxMessages: input.maxMessages,
    maxInputTokens: input.maxInputTokens,
    usedInputTokens,
    tokenCountSource: input.tokenCounter.source,
    maxChars: input.maxChars,
    usedChars,
    inputTokenBudget: input.budget.inputTokenBudget,
    reservedOutputTokens: input.budget.reservedOutputTokens,
    budgetSource: input.budget.budgetSource,
  };
  const truncationReport = {
    truncated: truncatedByBudget || selected.some((item) => item.truncated),
    omittedItemCount,
    truncatedItemIds: selected.filter((item) => item.truncated).map((item) => item.itemId),
  };
  const evidenceRefs = unique([
    ...selected.flatMap((item) => item.refs.map((ref) => `${ref.kind}:${ref.id}`)),
    ...(input.extraEvidenceRefs ?? []),
  ]);
  return {
    ledgerId: createId("context-ledger"),
    runId: input.runId,
    items: selected,
    evidenceRefs,
    budget,
    truncationReport,
    readModel: toContextLedgerReadModel(input.runId, selected, omitted, budget, truncationReport),
  };
}

function isRequiredContextItem(item: BasicAgentContextItem): boolean {
  return item.sourceKind === "system" || item.sourceKind === "user_message";
}

function prioritizedOptionalContextItems(
  draft: readonly BasicAgentContextItem[]
): readonly BasicAgentContextItem[] {
  return draft
    .filter((item) => !isRequiredContextItem(item))
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const priority = contextItemRetentionPriority(left.item) - contextItemRetentionPriority(right.item);
      return priority === 0 ? left.index - right.index : priority;
    })
    .map((entry) => entry.item);
}

function contextItemRetentionPriority(item: BasicAgentContextItem): number {
  if (item.sourceKind === "tool_evidence") return 0;
  if (item.sourceKind === "conversation_recent_turn") return 1;
  if (item.sourceKind === "task_soil_ref") return 2;
  if (item.sourceKind === "skill") return 3;
  if (item.sourceKind === "conversation") return 3;
  if (item.sourceKind === "conversation_summary") return 4;
  return 5;
}

function contextItemTokenCount(counter: BasicAgentTokenCounter, item: BasicAgentContextItem): number {
  const role =
    item.sourceKind === "system" || item.sourceKind === "skill" || item.sourceKind === "conversation_summary" || item.sourceKind === "tool_evidence"
      ? "system"
      : item.sourceKind === "user_message"
        ? "user"
        : item.role ?? "user";
  return counter.countMessage({ role, content: item.summary });
}

function insertBeforeCurrentUser(
  items: readonly BasicAgentContextItem[],
  additions: readonly BasicAgentContextItem[]
): readonly BasicAgentContextItem[] {
  let currentUserIndex = -1;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.sourceKind === "user_message") {
      currentUserIndex = index;
      break;
    }
  }
  if (currentUserIndex < 0) {
    return [...items, ...additions];
  }
  return [
    ...items.slice(0, currentUserIndex),
    ...additions,
    ...items.slice(currentUserIndex),
  ];
}

function toContextLedgerReadModel(
  runId: string,
  items: readonly BasicAgentContextItem[],
  omittedItems: readonly BasicAgentContextItem[],
  budget: BasicAgentContextLedger["budget"],
  truncationReport: BasicAgentContextLedger["truncationReport"]
): ContextLedger {
  const usedEntries = items.map((item): ContextLedgerEntry => ({
    entryId: item.itemId,
    kind: contextLedgerEntryKind(item.sourceKind),
    title: contextLedgerEntryTitle(item),
    summary: safeText(item.sourceKind === "system" ? "桌面基础 Agent 系统边界。" : item.summary, 360).text,
    refs: item.refs,
    status: item.truncated ? "truncated" : "used",
  }));
  const omittedEntries = omittedItems.slice(0, 12).map((item): ContextLedgerEntry => ({
    entryId: `${item.itemId}:omitted`,
    kind: contextLedgerEntryKind(item.sourceKind),
    title: contextLedgerEntryTitle(item),
    summary: "因上下文预算限制，该项未进入模型输入；普通视图只保留安全引用和状态。",
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
  budget: BasicAgentContextLedger["budget"],
  truncationReport: BasicAgentContextLedger["truncationReport"]
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

function tokenBudgetFor(capabilities: ModelCapabilities | undefined): {
  readonly inputTokenBudget: number;
  readonly reservedOutputTokens: number;
} | undefined {
  if (capabilities === undefined) {
    return undefined;
  }
  // Context Pack should assemble safe continuity, not pre-compress the agent's
  // working memory. The loop-level token gate owns the 0.8-window compaction
  // boundary immediately before each model call.
  const reservedOutputTokens = Math.max(512, Math.min(capabilities.maxOutputTokens, Math.floor(capabilities.contextWindowTokens * 0.25)));
  return {
    inputTokenBudget: Math.max(1_000, capabilities.contextWindowTokens),
    reservedOutputTokens,
  };
}

function systemContextItem(): BasicAgentContextItem {
  return {
    itemId: "context:system:desktop-agent",
    sourceKind: "system",
    summary: DESKTOP_AGENT_SYSTEM_PROMPT,
    refs: [{ kind: "event", id: "prompt:desktop.agent_response.v1" }],
    visibility: "model",
    truncated: false,
  };
}

function skillContextItems(skills: readonly DesktopAgentSkillContext[]): readonly BasicAgentContextItem[] {
  return skills.slice(0, 4).map((context) => {
    const body = safeText(context.body, MAX_SKILL_BODY_CHARS);
    const reason = safeText(context.triggerReason, MAX_SKILL_REASON_CHARS);
    return {
      itemId: `context:skill:${context.skill.id}`,
      sourceKind: "skill",
      summary: [
        `Triggered skill: ${safeText(context.skill.name, 120).text}`,
        `Why: ${reason.text}`,
        "Use these skill instructions when relevant. Do not mention internal skill loading unless the user asks.",
        body.text,
      ].join("\n"),
      refs: [{ kind: "event", id: `skill:${context.skill.id}` }],
      visibility: "model" as const,
      truncated: body.truncated || reason.truncated,
    };
  });
}

function historyContextItems(
  history: readonly DesktopAgentConversationMessage[],
  conversationSummary: BasicAgentConversationSummary | undefined
): readonly BasicAgentContextItem[] {
  const safeHistory = history
    .map((message, index) => {
      const safe = safeConversationText(message.content, MAX_HISTORY_CHARS);
      return {
        message,
        index,
        safe,
      };
    })
    .filter((entry) => entry.safe.text.length > 0);
  const recentMessageCount = RECENT_HISTORY_PAIR_COUNT * 2;
  const earlier = safeHistory.slice(0, Math.max(0, safeHistory.length - recentMessageCount));
  const recent = safeHistory.slice(Math.max(0, safeHistory.length - recentMessageCount));
  const earlierItems = conversationSummary === undefined
    ? earlier.map((entry): BasicAgentContextItem => ({
        itemId: entry.message.ref ?? `context:conversation:${entry.index}`,
        sourceKind: "conversation",
        role: entry.message.role,
        summary: entry.safe.text,
        refs: [{ kind: "event" as const, id: entry.message.ref ?? `conversation:history:${entry.index}` }],
        visibility: "model" as const,
        truncated: entry.safe.truncated,
      }))
    : [];
  const summaryItem = conversationSummary === undefined
    ? undefined
    : aiConversationSummaryItem(conversationSummary, earlier);
  const recentItems = recent.map((entry): BasicAgentContextItem => ({
    itemId: entry.message.ref ?? `context:conversation:${entry.index}`,
    sourceKind: "conversation_recent_turn",
    role: entry.message.role,
    summary: entry.safe.text,
    refs: [{ kind: "event" as const, id: entry.message.ref ?? `conversation:history:${entry.index}` }],
    visibility: "model" as const,
    truncated: entry.safe.truncated,
  }));
  return summaryItem === undefined ? [...earlierItems, ...recentItems] : [summaryItem, ...recentItems];
}

function aiConversationSummaryItem(
  summary: BasicAgentConversationSummary,
  fallbackEntries: readonly {
    readonly message: DesktopAgentConversationMessage;
    readonly index: number;
    readonly safe: { readonly text: string; readonly truncated: boolean };
  }[]
): BasicAgentContextItem | undefined {
  const safeSummary = safeText(
    [
      "Earlier conversation summary (model-compacted, redacted; use only as background):",
      summary.summary,
    ].join("\n"),
    MAX_HISTORY_SUMMARY_CHARS
  );
  if (safeSummary.text.length === 0) {
    return undefined;
  }
  return {
    itemId: summary.summaryId,
    sourceKind: "conversation_summary",
    summary: safeSummary.text,
    refs: summary.coveredRefs.length > 0
      ? summary.coveredRefs.map((id): ObservationRef => ({ kind: "event", id }))
      : fallbackEntries.slice(0, 12).map((entry): ObservationRef => ({
          kind: "event",
          id: entry.message.ref ?? `conversation:history:${entry.index}`,
        })),
    visibility: "model",
    truncated: safeSummary.truncated,
  };
}

function currentUserMessageItem(goal: string, taskSoil: TaskSoil): BasicAgentContextItem {
  const safe = safeUnboundedText(goal);
  return {
    itemId: `context:goal:${taskSoil.goalId}`,
    sourceKind: "user_message",
    summary: [
      `Current user message: ${safe.text}`,
      "Context refs:",
      ...(taskSoil.contextRefs.length === 0 ? ["- none"] : taskSoil.contextRefs.map(contextRefPromptLine)),
      `Permission refs: ${taskSoil.permissionBoundaryRefs.join("; ") || "none"}`,
    ].join("\n"),
    refs: [{ kind: "goal", id: taskSoil.goalId ?? taskSoil.taskSoilId }],
    visibility: "model",
    truncated: safe.truncated,
  };
}

function taskSoilRefItems(taskSoil: TaskSoil): readonly BasicAgentContextItem[] {
  return taskSoil.contextRefs.map((ref, index) => {
    const summary = safeText(contextRefPromptLine(ref), MAX_REF_SUMMARY_CHARS + MAX_PREVIEW_CHARS);
    return {
      itemId: `context:task-soil:${index}`,
      sourceKind: "task_soil_ref",
      summary: summary.text,
      refs: [{ kind: "goal", id: taskSoil.goalId ?? taskSoil.taskSoilId }],
      visibility: "diagnostic" as const,
      truncated: summary.truncated,
    };
  });
}

function toolEvidenceItems(envelopes: readonly ToolResultEnvelope[]): readonly BasicAgentContextItem[] {
  return envelopes.slice(0, 12).map((envelope, index) => {
    const summary = safeText(
      [
        envelope.agentSummary,
        envelope.evidenceRefs.length === 0 ? undefined : `Evidence refs: ${envelope.evidenceRefs.slice(0, 8).join("; ")}`,
      ].filter(isString).join("\n"),
      MAX_TOOL_EVIDENCE_CHARS
    );
    return {
      itemId: envelope.diagnosticRef ?? `context:tool-evidence:${index}`,
      sourceKind: "tool_evidence",
      summary: summary.text,
      refs: envelope.evidenceRefs.slice(0, 8).map((ref): ObservationRef => ({ kind: "event", id: safeText(ref, 220).text })),
      visibility: "model" as const,
      truncated: summary.truncated || envelope.truncated,
    };
  });
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

function contextRefPromptLine(ref: TaskSoil["contextRefs"][number]): string {
  if (ref.kind === "user_goal") {
    return `- user message summary=${safeText(ref.summary ?? "none", MAX_REF_SUMMARY_CHARS).text}`;
  }
  if (ref.ref.startsWith("workspace:goal-")) {
    return `- workspace:current-task summary=${safeText(ref.summary ?? "current task context refs only", MAX_REF_SUMMARY_CHARS).text}`;
  }
  const preview = ref.readonlyPreview;
  const previewText =
    preview === undefined
      ? ""
      : ` preview=${safeText([preview.title, preview.text].filter(Boolean).join(": "), MAX_PREVIEW_CHARS).text}`;
  return `- ${ref.kind}:${safePlain(ref.ref, 220)} summary=${safeText(ref.summary ?? "none", MAX_REF_SUMMARY_CHARS).text}${previewText}`;
}

function safeText(value: string, maxLength: number): { readonly text: string; readonly truncated: boolean } {
  const redacted = redactSensitiveText(value).replace(/\b(runtime|store|secret):[^\s]+/gi, "[redacted-ref]").trim();
  if (redacted.length <= maxLength) {
    return { text: redacted, truncated: false };
  }
  return {
    text: `${redacted.slice(0, Math.max(0, maxLength - 1))}…`,
    truncated: true,
  };
}

function safeUnboundedText(value: string): { readonly text: string; readonly truncated: false } {
  return {
    text: redactSensitiveText(value).replace(/\b(runtime|store|secret):[^\s]+/gi, "[redacted-ref]").trim(),
    truncated: false,
  };
}

function safeConversationText(value: string, maxLength: number): { readonly text: string; readonly truncated: boolean } {
  return safeText(
    sanitizeConversationHistoryText(value)
      .replace(/\binternal loop\b/gi, "[redacted-internal]"),
    maxLength
  );
}

function safePlain(value: string, maxLength: number): string {
  return safeText(value, maxLength).text;
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
