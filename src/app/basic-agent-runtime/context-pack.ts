import type { ModelMessage } from "../../domain/intelligence/index.js";
import type { ModelCapabilities } from "../../domain/config/index.js";
import type { ObservationRef } from "../../domain/observation/index.js";
import type { TaskSoil } from "../../domain/soil/index.js";
import type {
  DesktopAgentConversationMessage,
  DesktopAgentInterruptedRunContext,
  DesktopAgentSkillContext,
} from "../desktop-agent/desktop-agent-contracts.js";
import { createBasicAgentContextLedger } from "./context-ledger.js";
import type { BasicAgentConversationSummary } from "./conversation-compaction.js";
import type { BasicAgentContextAgentDefinition } from "./context-ledger-items.js";
import type {
  BasicAgentContextItem,
  BasicAgentContextPack,
} from "./contracts.js";
import type { BasicAgentTokenCounter } from "./token-counter.js";

export type {
  BasicAgentContextBudget,
  BasicAgentContextItem,
  BasicAgentContextPack,
  BasicAgentContextSourceKind,
  BasicAgentContextTruncationReport,
} from "./contracts.js";

export type BuildBasicAgentContextPackInput = {
  readonly agentDefinition: BasicAgentContextAgentDefinition;
  readonly goal: string;
  readonly taskSoil: TaskSoil;
  readonly conversationHistory: readonly DesktopAgentConversationMessage[];
  readonly conversationSummary?: BasicAgentConversationSummary;
  readonly interruptedRunContexts?: readonly DesktopAgentInterruptedRunContext[];
  readonly skillContexts?: readonly DesktopAgentSkillContext[];
  readonly modelCapabilities?: ModelCapabilities;
  readonly tokenCounter?: BasicAgentTokenCounter;
  readonly maxMessages?: number;
  readonly maxChars?: number;
  readonly maxInputTokens?: number;
};

export function buildBasicAgentContextPack(input: BuildBasicAgentContextPackInput): BasicAgentContextPack {
  const ledger = createBasicAgentContextLedger({
    agentDefinition: input.agentDefinition,
    runId: input.taskSoil.traceId ?? input.taskSoil.taskSoilId,
    goal: input.goal,
    taskSoil: input.taskSoil,
    conversationHistory: input.conversationHistory,
    conversationSummary: input.conversationSummary,
    interruptedRunContexts: input.interruptedRunContexts,
    skillContexts: input.skillContexts,
    modelCapabilities: input.modelCapabilities,
    tokenCounter: input.tokenCounter,
    maxMessages: input.maxMessages,
    maxChars: input.maxChars,
    maxInputTokens: input.maxInputTokens,
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
  const content = item.modelContent ?? item.summary;
  if (item.sourceKind === "system" || item.sourceKind === "skill") {
    return {
      role: "system",
      content,
      ref: item.itemId,
    };
  }
  if (item.sourceKind === "conversation" || item.sourceKind === "conversation_recent_turn") {
    return {
      role: item.role ?? "user",
      content,
      ref: item.itemId,
    };
  }
  if (item.sourceKind === "conversation_summary" || item.sourceKind === "run_interruption") {
    return {
      role: "system",
      content,
      ref: item.itemId,
    };
  }
  if (item.sourceKind === "task_soil_ref") {
    return {
      role: "system",
      content,
      ref: item.itemId,
    };
  }
  if (item.sourceKind === "user_message") {
    return {
      role: "user",
      content,
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
