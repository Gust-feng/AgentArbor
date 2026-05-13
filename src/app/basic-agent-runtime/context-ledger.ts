import type { ContextLedger, ContextLedgerEntry } from "../../domain/basic-agent/index.js";
import type { ModelCapabilities } from "../../domain/config/index.js";
import type { ObservationRef } from "../../domain/observation/index.js";
import type { TaskSoil } from "../../domain/soil/index.js";
import type { ToolResultEnvelope } from "../../domain/tools/index.js";
import { createId } from "../../kernel/id.js";
import { redactSensitiveText } from "../../kernel/redaction.js";
import type { DesktopAgentConversationMessage } from "../desktop-agent-session.js";
import type { DesktopAgentSkillContext } from "../desktop-agent-prompts.js";
import type { BasicAgentContextItem, BasicAgentContextSourceKind } from "./context-pack.js";

export type BasicAgentContextLedger = {
  readonly ledgerId: string;
  readonly runId: string;
  readonly items: readonly BasicAgentContextItem[];
  readonly evidenceRefs: readonly string[];
  readonly budget: {
    readonly maxMessages: number;
    readonly maxChars: number;
    readonly usedChars: number;
    readonly inputTokenBudget?: number;
    readonly reservedOutputTokens?: number;
    readonly estimatedInputTokens?: number;
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
  readonly skillContexts?: readonly DesktopAgentSkillContext[];
  readonly toolEvidence?: readonly ToolResultEnvelope[];
  readonly modelCapabilities?: ModelCapabilities;
  readonly maxMessages?: number;
  readonly maxChars?: number;
};

const DEFAULT_MAX_MESSAGES = 24;
const DEFAULT_MAX_CHARS = 18_000;
const MAX_HISTORY_CHARS = 1_200;
const MAX_SKILL_BODY_CHARS = 4_000;
const MAX_SKILL_REASON_CHARS = 240;
const MAX_REF_SUMMARY_CHARS = 240;
const MAX_PREVIEW_CHARS = 700;
const MAX_GOAL_CHARS = 1_200;
const MAX_TOOL_EVIDENCE_CHARS = 1_400;

const DESKTOP_AGENT_SYSTEM_PROMPT = [
  "You are AgentArbor Desktop Root Agent, the default local desktop working agent.",
  "Own the ordinary agent path: understand the task, answer directly when enough, use authorized tools when evidence is needed, ask for concrete confirmation or user guidance when context or permission is missing, and produce a usable result.",
  "Available tools may include web/research tools and local read-only workspace tools. Prefer read-only inspection before asking the user for repo facts that can be derived safely.",
  "Use the user's language. Keep the visible answer focused on result, evidence, uncertainty, and next step.",
  "If conversation history appears before the final user message, use it only as dialogue context. The final user message is the current instruction.",
  "If the user asks to inspect local desktop files but no file/folder ref or preview is provided, ask for explicit file selection or read-only authorization. Do not pretend you can see files.",
  "Do not route, package, or suggest this ordinary turn as a deeper organization flow. Explicit deep mode is a separate product entry selected outside this agent turn.",
  "Do not expose raw prompts, hidden reasoning, provider internals, or internal architecture terms unless the user asks for developer diagnostics.",
].join("\n");

// The ledger is the Basic Agent's single model-input governor. Context Pack
// serialization must consume this selected, redacted ledger instead of
// reassembling prompts from session, panel, or tool-specific helpers.
export function createBasicAgentContextLedger(input: CreateBasicAgentContextLedgerInput): BasicAgentContextLedger {
  const maxMessages = Math.max(4, Math.floor(input.maxMessages ?? DEFAULT_MAX_MESSAGES));
  const tokenBudget = tokenBudgetFor(input.modelCapabilities);
  const modelMaxChars = tokenBudget === undefined ? DEFAULT_MAX_CHARS : tokenBudget.inputTokenBudget * 4;
  const maxChars = Math.max(2_000, Math.floor(input.maxChars ?? modelMaxChars));
  const draft = [
    systemContextItem(),
    ...skillContextItems(input.skillContexts ?? []),
    ...historyContextItems(input.conversationHistory),
    currentUserMessageItem(input.goal, input.taskSoil),
    ...taskSoilRefItems(input.taskSoil),
    ...toolEvidenceItems(input.toolEvidence ?? []),
  ];
  return buildContextLedgerFromItems({
    runId: input.runId,
    draft,
    maxMessages,
    maxChars,
    budget: {
      inputTokenBudget: tokenBudget?.inputTokenBudget,
      reservedOutputTokens: tokenBudget?.reservedOutputTokens,
      budgetSource: input.maxChars !== undefined ? "override" : tokenBudget === undefined ? "default" : "model_capabilities",
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
    draft: [...ledger.items, ...toolEvidenceItems([envelope])],
    maxMessages: ledger.budget.maxMessages,
    maxChars: ledger.budget.maxChars,
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
  readonly maxChars: number;
  readonly budget: {
    readonly inputTokenBudget?: number;
    readonly reservedOutputTokens?: number;
    readonly budgetSource: BasicAgentContextLedger["budget"]["budgetSource"];
  };
  readonly extraEvidenceRefs?: readonly string[];
}): BasicAgentContextLedger {
  const selected: BasicAgentContextItem[] = [];
  let omittedItemCount = 0;
  let usedChars = 0;
  let truncatedByBudget = false;
  for (const item of input.draft) {
    const itemChars = item.summary.length;
    if (selected.length >= input.maxMessages || usedChars + itemChars > input.maxChars) {
      truncatedByBudget = true;
      omittedItemCount += 1;
      continue;
    }
    selected.push(item);
    usedChars += itemChars;
  }
  const budget = {
    maxMessages: input.maxMessages,
    maxChars: input.maxChars,
    usedChars,
    inputTokenBudget: input.budget.inputTokenBudget,
    reservedOutputTokens: input.budget.reservedOutputTokens,
    estimatedInputTokens: estimateTokens(usedChars),
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
    readModel: toContextLedgerReadModel(input.runId, selected, budget, truncationReport),
  };
}

function toContextLedgerReadModel(
  runId: string,
  items: readonly BasicAgentContextItem[],
  budget: BasicAgentContextLedger["budget"],
  truncationReport: BasicAgentContextLedger["truncationReport"]
): ContextLedger {
  const entries = items.map((item): ContextLedgerEntry => ({
    entryId: item.itemId,
    kind: contextLedgerEntryKind(item.sourceKind),
    title: contextLedgerEntryTitle(item),
    summary: safeText(item.sourceKind === "system" ? "桌面基础 Agent 系统边界。" : item.summary, 360).text,
    refs: item.refs,
    status: item.truncated ? "truncated" : "used",
  }));
  return {
    runId,
    summary: contextUsageSummary(items),
    entries,
    budget,
    truncation: truncationReport,
  };
}

function contextLedgerEntryKind(kind: BasicAgentContextSourceKind): ContextLedgerEntry["kind"] {
  if (kind === "system" || kind === "user_message") return "goal";
  if (kind === "conversation") return "history";
  if (kind === "skill") return "skill";
  if (kind === "task_soil_ref") return "attachment";
  return "tool_evidence";
}

function contextLedgerEntryTitle(item: BasicAgentContextItem): string {
  const labels: Record<BasicAgentContextSourceKind, string> = {
    system: "系统边界",
    skill: "技能",
    conversation: "历史对话",
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
  const reservedOutputTokens = Math.max(512, Math.min(capabilities.maxOutputTokens, Math.floor(capabilities.contextWindowTokens * 0.25)));
  const safetyMargin = Math.max(512, Math.floor(capabilities.contextWindowTokens * 0.05));
  return {
    inputTokenBudget: Math.max(1_000, capabilities.contextWindowTokens - reservedOutputTokens - safetyMargin),
    reservedOutputTokens,
  };
}

function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
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

function historyContextItems(history: readonly DesktopAgentConversationMessage[]): readonly BasicAgentContextItem[] {
  return history.map((message, index) => {
    const safe = safeText(message.content, MAX_HISTORY_CHARS);
    return {
      itemId: message.ref ?? `context:conversation:${index}`,
      sourceKind: "conversation" as const,
      role: message.role,
      summary: safe.text,
      refs: [{ kind: "event" as const, id: message.ref ?? `conversation:history:${index}` }],
      visibility: "model" as const,
      truncated: safe.truncated,
    };
  }).filter((item) => item.summary.length > 0);
}

function currentUserMessageItem(goal: string, taskSoil: TaskSoil): BasicAgentContextItem {
  const safe = safeText(goal, MAX_GOAL_CHARS);
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

function contextUsageSummary(items: readonly BasicAgentContextItem[]): string {
  const counts = new Map<BasicAgentContextSourceKind, number>();
  for (const item of items) {
    counts.set(item.sourceKind, (counts.get(item.sourceKind) ?? 0) + 1);
  }
  const labels: Record<BasicAgentContextSourceKind, string> = {
    system: "系统边界",
    skill: "技能",
    conversation: "历史对话",
    user_message: "当前任务",
    task_soil_ref: "上下文引用",
    tool_evidence: "工具证据",
  };
  return [...counts.entries()]
    .map(([kind, count]) => `${labels[kind]} ${count}`)
    .join("；");
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

function safePlain(value: string, maxLength: number): string {
  return safeText(value, maxLength).text;
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
