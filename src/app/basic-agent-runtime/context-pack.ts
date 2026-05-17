import type { ModelMessage } from "../../domain/intelligence/index.js";
import type { ModelCapabilities } from "../../domain/config/index.js";
import type { ObservationRef } from "../../domain/observation/index.js";
import type { TaskSoil } from "../../domain/soil/index.js";
import type { DesktopAgentConversationMessage } from "../desktop-agent-session.js";
import type { DesktopAgentSkillContext } from "../desktop-agent-prompts.js";
import { createBasicAgentContextLedger } from "./context-ledger.js";

export type BasicAgentContextSourceKind =
  | "system"
  | "skill"
  | "conversation"
  | "conversation_summary"
  | "conversation_recent_turn"
  | "user_message"
  | "task_soil_ref"
  | "tool_evidence";

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
  readonly inputTokenBudget?: number;
  readonly reservedOutputTokens?: number;
  readonly estimatedInputTokens?: number;
  readonly budgetSource: "default" | "model_capabilities" | "override";
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
  readonly modelCapabilities?: ModelCapabilities;
  readonly maxMessages?: number;
  readonly maxChars?: number;
};

export function buildBasicAgentContextPack(input: BuildBasicAgentContextPackInput): BasicAgentContextPack {
  const ledger = createBasicAgentContextLedger({
    runId: input.taskSoil.traceId ?? input.taskSoil.taskSoilId,
    goal: input.goal,
    taskSoil: input.taskSoil,
    conversationHistory: input.conversationHistory,
    skillContexts: input.skillContexts,
    modelCapabilities: input.modelCapabilities,
    maxMessages: input.maxMessages,
    maxChars: input.maxChars,
  });
  const selected = ledger.items;
  const messages = selected.map(contextMessageForItem).filter((message): message is ModelMessage => message !== undefined);
  return {
    messages,
    inputRefs: inputRefsForPack(input.taskSoil, selected),
    items: selected,
    budget: ledger.budget,
    usageSummary: ledger.readModel.summary,
    truncationReport: ledger.truncationReport,
    truncated: ledger.truncationReport.truncated,
  };
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
  if (item.sourceKind === "conversation" || item.sourceKind === "conversation_recent_turn") {
    return {
      role: item.role ?? "user",
      content: item.summary,
      ref: item.itemId,
    };
  }
  if (item.sourceKind === "conversation_summary") {
    return {
      role: "system",
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
  if (item.sourceKind === "tool_evidence") {
    return {
      role: "system",
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
