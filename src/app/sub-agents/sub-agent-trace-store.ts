import type { SubAgentRunTrace, SubAgentRunTraceSink } from "../../domain/sub-agents/contracts.js";

export class InMemorySubAgentRunTraceStore implements SubAgentRunTraceSink {
  private readonly traces = new Map<string, SubAgentRunTrace>();

  upsert(trace: SubAgentRunTrace): void {
    const previous = this.traces.get(trace.subRunId);
    this.traces.set(trace.subRunId, cloneJson(previous === undefined ? trace : mergeSubAgentTrace(previous, trace)));
  }

  list(): readonly SubAgentRunTrace[] {
    return [...this.traces.values()]
      .map(cloneJson)
      .sort(compareSubAgentRuns);
  }

  get(subRunId: string): SubAgentRunTrace | undefined {
    const trace = this.traces.get(subRunId);
    return trace === undefined ? undefined : cloneJson(trace);
  }
}

function compareSubAgentRuns(left: SubAgentRunTrace, right: SubAgentRunTrace): number {
  const started = left.startedAt.localeCompare(right.startedAt);
  if (started !== 0) {
    return started;
  }
  return (left.batchIndex ?? 0) - (right.batchIndex ?? 0);
}

function mergeSubAgentTrace(previous: SubAgentRunTrace, next: SubAgentRunTrace): SubAgentRunTrace {
  const modelExchanges = mergeByKey(previous.modelExchanges, next.modelExchanges, (exchange) => exchange.requestId);
  const toolTraces = mergeToolTraces(previous.toolTraces, next.toolTraces);
  return {
    ...previous,
    ...next,
    parentRunId: next.parentRunId ?? previous.parentRunId,
    parentToolCallId: next.parentToolCallId ?? previous.parentToolCallId,
    batchId: next.batchId ?? previous.batchId,
    batchIndex: next.batchIndex ?? previous.batchIndex,
    context: next.context ?? previous.context,
    startedAt: previous.startedAt,
    completedAt: next.completedAt ?? previous.completedAt,
    durationMs: mergedDurationMs(previous, next),
    modelRounds: modelExchanges.length,
    toolCalls: toolTraces.length,
    modelExchanges,
    toolTraces,
  };
}

function mergeToolTraces(
  previous: SubAgentRunTrace["toolTraces"],
  next: SubAgentRunTrace["toolTraces"],
): SubAgentRunTrace["toolTraces"] {
  const merged = new Map(previous.map((tool) => [tool.callId, tool]));
  for (const tool of next) {
    const existing = merged.get(tool.callId);
    merged.set(tool.callId, existing === undefined ? tool : {
      ...existing,
      ...tool,
      startedAt: existing.startedAt ?? tool.startedAt,
      completedAt: tool.completedAt ?? existing.completedAt,
      confirmationId: tool.confirmationId ?? existing.confirmationId,
      error: tool.error ?? existing.error,
      errorDomain: tool.errorDomain ?? existing.errorDomain,
      errorFacts: tool.errorFacts ?? existing.errorFacts,
    });
  }
  return [...merged.values()];
}

function mergeByKey<T>(
  previous: readonly T[],
  next: readonly T[],
  keyOf: (item: T) => string
): readonly T[] {
  const merged = new Map<string, T>();
  for (const item of previous) {
    merged.set(keyOf(item), item);
  }
  for (const item of next) {
    const key = keyOf(item);
    merged.set(key, {
      ...(merged.get(key) as object | undefined),
      ...(item as object),
    } as T);
  }
  return [...merged.values()];
}

function mergedDurationMs(previous: SubAgentRunTrace, next: SubAgentRunTrace): number {
  const startedAt = Date.parse(previous.startedAt);
  const completedAt = Date.parse(next.completedAt ?? previous.completedAt ?? "");
  if (Number.isFinite(startedAt) && Number.isFinite(completedAt) && completedAt >= startedAt) {
    return completedAt - startedAt;
  }
  return Math.max(previous.durationMs, next.durationMs);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
