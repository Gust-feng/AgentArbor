export type ContextWindowUsageSource = "provider_usage" | "context_ledger" | "unavailable";

export type ContextWindowUsageTone = "normal" | "warning" | "danger" | "muted";

export type ContextWindowUsage = {
  readonly source: ContextWindowUsageSource;
  readonly usedTokens?: number;
  readonly maxTokens: number;
  readonly percent?: number;
  readonly ringPercent: number;
  readonly tone: ContextWindowUsageTone;
  readonly label: string;
};

export type ContextWindowUsageModelUsage = {
  readonly inputTokens?: number;
};

export type ContextWindowUsageLedgerBudget = {
  readonly maxInputTokens?: number;
  readonly usedInputTokens?: number;
  readonly tokenCountSource?: string;
  readonly inputTokenBudget?: number;
};

export type ContextWindowUsageTranscriptNode = {
  readonly modelUsage?: ContextWindowUsageModelUsage;
};

export type ContextWindowUsageEvent = {
  readonly detail?: Readonly<Record<string, unknown>> & {
    readonly modelUsage?: ContextWindowUsageModelUsage;
  };
};

export function contextWindowUsageFrom(input: {
  readonly contextWindowTokens?: number;
  readonly modelUsage?: ContextWindowUsageModelUsage;
  readonly ledgerBudget?: ContextWindowUsageLedgerBudget;
}): ContextWindowUsage | undefined {
  const maxTokens = positiveNumber(input.contextWindowTokens) ??
    positiveNumber(input.ledgerBudget?.inputTokenBudget) ??
    positiveNumber(input.ledgerBudget?.maxInputTokens);
  if (maxTokens === undefined) {
    return undefined;
  }

  const providerInputTokens = finiteTokenCount(input.modelUsage?.inputTokens);
  if (providerInputTokens !== undefined) {
    return availableContextWindowUsage({
      source: "provider_usage",
      usedTokens: providerInputTokens,
      maxTokens,
    });
  }

  const ledgerInputTokens = finiteTokenCount(input.ledgerBudget?.usedInputTokens);
  if (
    ledgerInputTokens !== undefined &&
    input.ledgerBudget?.tokenCountSource !== undefined &&
    isTokenSourceUsableForContextUsage(input.ledgerBudget.tokenCountSource)
  ) {
    return availableContextWindowUsage({
      source: "context_ledger",
      usedTokens: ledgerInputTokens,
      maxTokens,
    });
  }

  return {
    source: "unavailable",
    maxTokens,
    ringPercent: 0,
    tone: "muted",
    label: `上下文容量 ${formatCompactTokenCount(maxTokens)}，等待模型用量`,
  };
}

export function latestModelUsageFromTranscript(
  nodes: readonly ContextWindowUsageTranscriptNode[]
): ContextWindowUsageModelUsage | undefined {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const usage = nodes[index]?.modelUsage;
    if (finiteTokenCount(usage?.inputTokens) !== undefined) {
      return usage;
    }
  }
  return undefined;
}

export function latestModelUsageFromEvents(
  events: readonly ContextWindowUsageEvent[]
): ContextWindowUsageModelUsage | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const usage = events[index]?.detail?.modelUsage;
    if (finiteTokenCount(usage?.inputTokens) !== undefined) {
      return usage;
    }
  }
  return undefined;
}

function availableContextWindowUsage(input: {
  readonly source: Exclude<ContextWindowUsageSource, "unavailable">;
  readonly usedTokens: number;
  readonly maxTokens: number;
}): ContextWindowUsage {
  const percent = (input.usedTokens / input.maxTokens) * 100;
  const displayPercent = formatUsagePercent(percent);
  return {
    source: input.source,
    usedTokens: input.usedTokens,
    maxTokens: input.maxTokens,
    percent,
    ringPercent: clamp(percent, 0, 100),
    tone: usageTone(percent),
    label: `已用${displayPercent}%上下文容量`,
  };
}

function usageTone(percent: number): ContextWindowUsageTone {
  if (percent >= 90) return "danger";
  if (percent >= 75) return "warning";
  return "normal";
}

function formatUsagePercent(percent: number): string {
  if (percent > 0 && percent < 1) return "<1";
  return String(Math.round(percent));
}

function isTokenSourceUsableForContextUsage(source: string): boolean {
  const normalized = source.trim().toLowerCase();
  if (normalized.length === 0) return false;
  return !normalized.includes("char") && !normalized.includes("character");
}

function positiveNumber(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function finiteTokenCount(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatCompactTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${formatCompactNumber(tokens / 1_000_000)}M`;
  }
  if (tokens >= 1_000) {
    return `${formatCompactNumber(tokens / 1_000)}K`;
  }
  return String(Math.round(tokens));
}

function formatCompactNumber(value: number): string {
  const rounded = value >= 10 ? Math.round(value).toString() : value.toFixed(value >= 1 ? 1 : 2);
  return rounded.replace(/\.0$/u, "");
}
