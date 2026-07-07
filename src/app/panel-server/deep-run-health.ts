import { nowIso } from "../../kernel/id.js";
import {
  projectDeepConversationSummary,
  projectDeepRunSummary,
} from "../deep/deep-read-model.js";
import type { DeepConversation, DeepRunStatus } from "../deep/contracts.js";
import type { DeepRunRecord } from "../deep/deep-runtime.js";

const DEEP_RUN_STALE_AFTER_MS = 2 * 60 * 1_000;

export type DeepRunRuntimeHealthView = {
  readonly state: "terminal" | "active" | "stalled" | "orphaned";
  readonly lastActivityAt: string;
  readonly inactiveMs: number;
  readonly staleAfterMs: number;
  readonly canStop: boolean;
  readonly reason: string;
};

type DeepRunHealthState = {
  readonly activeRunIds: ReadonlySet<string>;
};

export function projectDeepRunSummaryWithHealth(
  state: DeepRunHealthState,
  record: DeepRunRecord,
  rootRecord?: DeepRunRecord,
): Record<string, unknown> {
  return {
    ...projectDeepRunSummary(record, rootRecord),
    runtimeHealth: deepRunRuntimeHealth(state, record),
  };
}

export function projectDeepConversationSummaryWithHealth(
  state: DeepRunHealthState,
  conversation: DeepConversation,
  latestRunRecord?: DeepRunRecord,
  latestRootRecord?: DeepRunRecord,
): Record<string, unknown> {
  const summary = projectDeepConversationSummary(conversation, latestRunRecord, latestRootRecord);
  if (latestRunRecord === undefined || summary.latestRun === undefined) {
    return summary;
  }
  return {
    ...summary,
    latestRun: {
      ...asRecord(summary.latestRun),
      runtimeHealth: deepRunRuntimeHealth(state, latestRunRecord),
    },
  };
}

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
  state: DeepRunHealthState,
  record: DeepRunRecord,
  nowMs = Date.now(),
): DeepRunRuntimeHealthView {
  return deriveDeepRunRuntimeHealth({
    status: record.run.status,
    runId: record.run.runId,
    activeRunIds: state.activeRunIds,
    lastActivityAt: latestDeepRunActivityAt(record),
    nowMs,
    staleAfterMs: DEEP_RUN_STALE_AFTER_MS,
  });
}

export function isTerminalDeepRunStatus(status: DeepRunStatus): boolean {
  return status !== "running";
}

function latestDeepRunActivityAt(record: DeepRunRecord): string {
  const lastEventAt = record.eventSequence.at(-1)?.timestamp;
  return latestTimestampForHealth(
    lastEventAt,
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

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
