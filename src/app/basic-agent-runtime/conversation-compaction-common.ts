import type { ModelCapabilities } from "../../domain/config/index.js";
import type { ModelOutputContract } from "../../domain/intelligence/index.js";

export const DEFAULT_THRESHOLD_RATIO = 0.8;
export const DEFAULT_INPUT_TOKEN_BUDGET = 4_500;

export function conversationCompactionOutputContract(): ModelOutputContract {
  return {
    contractId: "desktop.context_compaction.v1",
    outputKind: "explanation",
    format: "text",
    minTextLength: 1,
    maxTextLength: 6000,
    visibleOutput: {
      fields: ["text"],
      maxFieldLength: 1200,
    },
  };
}

export function inputTokenBudgetFor(capabilities: ModelCapabilities | undefined): number {
  if (capabilities === undefined) {
    return DEFAULT_INPUT_TOKEN_BUDGET;
  }
  const reservedOutputTokens = Math.max(512, Math.min(capabilities.maxOutputTokens, Math.floor(capabilities.contextWindowTokens * 0.25)));
  const safetyMargin = Math.max(512, Math.floor(capabilities.contextWindowTokens * 0.05));
  return Math.max(1_000, capabilities.contextWindowTokens - reservedOutputTokens - safetyMargin);
}

export function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_THRESHOLD_RATIO;
  }
  return Math.min(0.95, Math.max(0.1, value));
}

export function compactionAgentDisplayName(input: {
  readonly displayName: string;
} | undefined): string {
  const displayName = input?.displayName.replace(/\s+/g, " ").trim();
  return displayName === undefined || displayName.length === 0 ? "AgentArbor" : displayName;
}
