import type { ModelMessage } from "../../domain/intelligence/index.js";
import type { ObservationRef } from "../../domain/observation/index.js";
import type { TaskSoil } from "../../domain/soil/index.js";
import { redactSensitiveText } from "../../kernel/redaction.js";
import type { DesktopAgentConversationMessage } from "../desktop-agent-session.js";
import type { DesktopAgentSkillContext } from "../desktop-agent-prompts.js";

export type BasicAgentContextSourceKind =
  | "system"
  | "skill"
  | "conversation"
  | "user_message"
  | "task_soil_ref";

export type BasicAgentContextItem = {
  readonly itemId: string;
  readonly sourceKind: BasicAgentContextSourceKind;
  readonly role?: "user" | "assistant";
  readonly summary: string;
  readonly refs: readonly ObservationRef[];
  readonly visibility: "model" | "diagnostic";
  readonly truncated: boolean;
};

export type BasicAgentContextBudget = {
  readonly maxMessages: number;
  readonly maxChars: number;
  readonly usedChars: number;
};

export type BasicAgentContextTruncationReport = {
  readonly truncated: boolean;
  readonly omittedItemCount: number;
  readonly truncatedItemIds: readonly string[];
};

export type BasicAgentContextPack = {
  readonly messages: readonly ModelMessage[];
  readonly inputRefs: readonly ObservationRef[];
  readonly items: readonly BasicAgentContextItem[];
  readonly budget: BasicAgentContextBudget;
  readonly usageSummary: string;
  readonly truncationReport: BasicAgentContextTruncationReport;
  readonly truncated: boolean;
};

export type BuildBasicAgentContextPackInput = {
  readonly goal: string;
  readonly taskSoil: TaskSoil;
  readonly conversationHistory: readonly DesktopAgentConversationMessage[];
  readonly skillContexts?: readonly DesktopAgentSkillContext[];
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

export function buildBasicAgentContextPack(input: BuildBasicAgentContextPackInput): BasicAgentContextPack {
  const maxMessages = Math.max(4, Math.floor(input.maxMessages ?? DEFAULT_MAX_MESSAGES));
  const maxChars = Math.max(2_000, Math.floor(input.maxChars ?? DEFAULT_MAX_CHARS));
  const draft = [
    systemContextItem(),
    ...skillContextItems(input.skillContexts ?? []),
    ...historyContextItems(input.conversationHistory),
    currentUserMessageItem(input.goal, input.taskSoil),
    ...taskSoilRefItems(input.taskSoil),
  ];
  const selected: BasicAgentContextItem[] = [];
  let omittedItemCount = 0;
  let usedChars = 0;
  let truncatedByBudget = false;
  for (const item of draft) {
    const itemChars = item.summary.length;
    if (selected.length >= maxMessages || usedChars + itemChars > maxChars) {
      truncatedByBudget = true;
      omittedItemCount += 1;
      continue;
    }
    selected.push(item);
    usedChars += itemChars;
  }
  const messages = selected.map(contextMessageForItem).filter((message): message is ModelMessage => message !== undefined);
  return {
    messages,
    inputRefs: inputRefsForPack(input.taskSoil, selected),
    items: selected,
    budget: {
      maxMessages,
      maxChars,
      usedChars,
    },
    usageSummary: contextUsageSummary(selected),
    truncationReport: {
      truncated: truncatedByBudget || selected.some((item) => item.truncated),
      omittedItemCount,
      truncatedItemIds: selected.filter((item) => item.truncated).map((item) => item.itemId),
    },
    truncated: truncatedByBudget || selected.some((item) => item.truncated),
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
        `Triggered skill: ${safeText(context.skill.name, 120)}`,
        `Why: ${reason}`,
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

function contextMessageForItem(item: BasicAgentContextItem): ModelMessage | undefined {
  if (item.visibility !== "model") {
    return undefined;
  }
  if (item.sourceKind === "system" || item.sourceKind === "skill") {
    return {
      role: "system",
      content: item.summary,
      ref: item.itemId,
    };
  }
  if (item.sourceKind === "conversation") {
    return {
      role: item.role ?? "user",
      content: item.summary,
      ref: item.itemId,
    };
  }
  if (item.sourceKind === "user_message") {
    return {
      role: "user",
      content: item.summary,
      ref: item.itemId,
    };
  }
  return undefined;
}

function inputRefsForPack(taskSoil: TaskSoil, items: readonly BasicAgentContextItem[]): readonly ObservationRef[] {
  const refs: ObservationRef[] = [
    { kind: "trace", id: taskSoil.traceId ?? taskSoil.taskSoilId },
    { kind: "goal", id: taskSoil.goalId ?? taskSoil.taskSoilId },
    ...items.flatMap((item) => item.refs),
  ];
  return refs.filter((ref, index, values) => values.findIndex((candidate) => candidate.kind === ref.kind && candidate.id === ref.id) === index);
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
