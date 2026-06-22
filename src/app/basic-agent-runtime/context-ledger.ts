import type { ContextLedger } from "../../domain/basic-agent/index.js";
import type { ModelCapabilities } from "../../domain/config/index.js";
import type { TaskSoil } from "../../domain/soil/index.js";
import type { ToolResultEnvelope } from "../../domain/tools/index.js";
import { createId } from "../../kernel/id.js";
import type { DesktopAgentConversationMessage, DesktopAgentSkillContext } from "../desktop-agent-contracts.js";
import type { BasicAgentContextItem } from "./contracts.js";
import type { BasicAgentConversationSummary } from "./conversation-compaction.js";
import {
  type BasicAgentContextAgentDefinition,
  buildContextLedgerDraftItems,
  toolEvidenceItems,
} from "./context-ledger-items.js";
import { toContextLedgerReadModel } from "./context-ledger-read-model.js";
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
  readonly agentDefinition: BasicAgentContextAgentDefinition;
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

// The ledger is the Basic Agent's single model-input governor. Context Pack
// serialization must consume this selected ledger instead of
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
  const draft = buildContextLedgerDraftItems(input);
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
  let usedChars = required.reduce((total, item) => total + contextItemContentLength(item), 0);
  let usedInputTokens = required.reduce((total, item) => total + contextItemTokenCount(input.tokenCounter, item), 0);
  let truncatedByBudget = usedInputTokens > input.maxInputTokens || usedChars > input.maxChars || required.length > input.maxMessages;

  for (const item of prioritizedOptionalContextItems(input.draft)) {
    if (selectedIds.has(item.itemId)) {
      continue;
    }
    const itemChars = contextItemContentLength(item);
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
  return item.sourceKind === "system" ||
    item.sourceKind === "user_message" ||
    (item.sourceKind === "skill" && item.skill?.loadStatus === "failed");
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
  return counter.countMessage({ role, content: contextItemModelContent(item) });
}

function contextItemContentLength(item: BasicAgentContextItem): number {
  return contextItemModelContent(item).length;
}

function contextItemModelContent(item: BasicAgentContextItem): string {
  return item.modelContent ?? item.summary;
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

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
