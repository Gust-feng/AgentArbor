export type ContextWindowUsageSource = "provider_usage" | "unavailable";

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
  readonly latestAgentRequest?: {
    readonly inputTokens?: number;
  };
};

export type ContextWindowUsageTranscriptNode = {
  readonly runId?: string;
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
}): ContextWindowUsage | undefined {
  const maxTokens = positiveNumber(input.contextWindowTokens);
  if (maxTokens === undefined) {
    return undefined;
  }

  const providerInputTokens = finiteTokenCount(input.modelUsage?.latestAgentRequest?.inputTokens);
  if (providerInputTokens !== undefined) {
    return availableContextWindowUsage({
      source: "provider_usage",
      usedTokens: providerInputTokens,
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

export function latestModelUsageForRunFromTranscript(
  runId: string,
  nodes: readonly ContextWindowUsageTranscriptNode[]
): ContextWindowUsageModelUsage | undefined {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node?.runId !== runId) continue;
    const usage = node.modelUsage;
    if (finiteTokenCount(usage?.latestAgentRequest?.inputTokens) !== undefined) {
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
    if (finiteTokenCount(usage?.latestAgentRequest?.inputTokens) !== undefined) {
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
    label: `最近一次模型请求已用${displayPercent}%上下文容量`,
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
