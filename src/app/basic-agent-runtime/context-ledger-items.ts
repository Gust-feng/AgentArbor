import type { ObservationRef } from "../../domain/observation/index.js";
import type { TaskSoil } from "../../domain/soil/index.js";
import type { ToolResultEnvelope } from "../../domain/tools/index.js";
import type { AgentDefinition } from "../agent-prompts/contracts.js";
import type { DesktopAgentConversationMessage, DesktopAgentSkillContext } from "../desktop-agent-contracts.js";
import type { BasicAgentContextItem } from "./contracts.js";
import type { BasicAgentConversationSummary } from "./conversation-compaction.js";
import {
  safeContextText as safeText,
  safeConversationContextText as safeConversationText,
  safePlainContextText as safePlain,
  safeUnboundedContextText as safeUnboundedText,
} from "./context-ledger-safe-text.js";

export type BasicAgentContextAgentDefinition = Pick<AgentDefinition, "agentId" | "prompt">;

export type BuildContextLedgerDraftInput = {
  readonly agentDefinition: BasicAgentContextAgentDefinition;
  readonly goal: string;
  readonly taskSoil: TaskSoil;
  readonly conversationHistory: readonly DesktopAgentConversationMessage[];
  readonly conversationSummary?: BasicAgentConversationSummary;
  readonly skillContexts?: readonly DesktopAgentSkillContext[];
  readonly toolEvidence?: readonly ToolResultEnvelope[];
};

const MAX_HISTORY_CHARS = 1_200;
const MAX_HISTORY_SUMMARY_CHARS = 2_400;
const RECENT_HISTORY_PAIR_COUNT = 4;
const MAX_SKILL_BODY_CHARS = 4_000;
const MAX_SKILL_REASON_CHARS = 240;
const MAX_REF_SUMMARY_CHARS = 240;
const MAX_PREVIEW_CHARS = 700;
const MAX_TOOL_EVIDENCE_CHARS = 1_400;

export function buildContextLedgerDraftItems(input: BuildContextLedgerDraftInput): readonly BasicAgentContextItem[] {
  return [
    systemContextItem(input.agentDefinition),
    ...skillContextItems(input.skillContexts ?? []),
    ...historyContextItems(input.conversationHistory, input.conversationSummary),
    ...taskSoilRefItems(input.taskSoil),
    ...toolEvidenceItems(input.toolEvidence ?? []),
    currentUserMessageItem(input.goal, input.taskSoil),
  ];
}

export function toolEvidenceItems(envelopes: readonly ToolResultEnvelope[]): readonly BasicAgentContextItem[] {
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

function systemContextItem(agentDefinition: BasicAgentContextAgentDefinition): BasicAgentContextItem {
  return {
    itemId: `context:system:${agentDefinition.agentId}`,
    sourceKind: "system",
    summary: agentDefinition.prompt.systemPrompt,
    refs: [{ kind: "event", id: agentDefinition.prompt.promptRef }],
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
      "Earlier conversation summary (model-compacted; use only as background):",
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

function isString(value: unknown): value is string {
  return typeof value === "string";
}
