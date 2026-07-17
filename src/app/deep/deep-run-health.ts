import { nowIso } from "../../kernel/id.js";
import type { DeepRunStatus } from "./contracts.js";
import type { DeepRunRecord } from "./deep-run-record-store.js";

const DEEP_RUN_STALE_AFTER_MS = 2 * 60 * 1_000;

export type DeepRunRuntimeHealthView = {
  readonly state: "terminal" | "active" | "stalled" | "orphaned";
  readonly lastActivityAt: string;
  readonly inactiveMs: number;
  readonly staleAfterMs: number;
  readonly canStop: boolean;
  readonly reason: string;
};

export function deriveDeepRunRuntimeHealth(input: {
  readonly status: DeepRunStatus;
  readonly runId: string;
  readonly activeRunIds: ReadonlySet<string>;
  readonly lastActivityAt: string;
  readonly nowMs?: number;
  readonly staleAfterMs?: number;
}): DeepRunRuntimeHealthView {
  const staleAfterMs = input.staleAfterMs ?? DEEP_RUN_STALE_AFTER_MS;
  const inactiveMs = Math.max(0, (input.nowMs ?? Date.now()) - timestampMs(input.lastActivityAt));
  if (isTerminalDeepRunStatus(input.status)) {
    return {
      state: "terminal",
      lastActivityAt: input.lastActivityAt,
      inactiveMs,
      staleAfterMs,
      canStop: false,
      reason: "run reached terminal status",
    };
  }
  if (!input.activeRunIds.has(input.runId)) {
    return {
      state: "orphaned",
      lastActivityAt: input.lastActivityAt,
      inactiveMs,
      staleAfterMs,
      canStop: true,
      reason: "running record has no active background task in this process",
    };
  }
  if (inactiveMs >= staleAfterMs) {
    return {
      state: "stalled",
      lastActivityAt: input.lastActivityAt,
      inactiveMs,
      staleAfterMs,
      canStop: true,
      reason: "no new multi-agent event within stale threshold",
    };
  }
  return {
    state: "active",
    lastActivityAt: input.lastActivityAt,
    inactiveMs,
    staleAfterMs,
    canStop: true,
    reason: "background task is active",
  };
}

export function deepRunRuntimeHealth(
  isRunActive: (runId: string) => boolean,
  record: DeepRunRecord,
  nowMs = Date.now(),
): DeepRunRuntimeHealthView {
  const activeRunIds = isRunActive(record.run.runId)
    ? new Set([record.run.runId])
    : new Set<string>();
  return deriveDeepRunRuntimeHealth({
    status: record.run.status,
    runId: record.run.runId,
    activeRunIds,
    lastActivityAt: latestDeepRunActivityAt(record),
    nowMs,
    staleAfterMs: DEEP_RUN_STALE_AFTER_MS,
  });
}

export function isTerminalDeepRunStatus(status: DeepRunStatus): boolean {
  return status === "completed"
    || status === "failed"
    || status === "interrupted"
    || status === "corrected"
    || status === "stopped";
}

function latestDeepRunActivityAt(record: DeepRunRecord): string {
  return latestTimestampForHealth(
    record.eventSequence.at(-1)?.timestamp,
    record.liveProjection?.updatedAt,
    record.updatedAt,
    record.run.updatedAt,
    record.run.startedAt,
  );
}

function latestTimestampForHealth(...values: readonly (string | undefined)[]): string {
  return values
    .filter((value): value is string => value !== undefined && value.trim().length > 0)
    .sort((left, right) => timestampMs(right) - timestampMs(left))[0] ?? nowIso();
}

function timestampMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
