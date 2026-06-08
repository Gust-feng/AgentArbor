import type { BasicAgentRun, ConfirmationDecision, RunEvent } from "../../domain/basic-agent/index.js";
import type {
  RuntimeDatabase,
  RuntimeRunRecord,
  RuntimeRunSnapshot,
} from "../../domain/runtime-database/index.js";
import { redactOrdinaryText } from "../safe-projection.js";
import {
  nextBasicEventSequence,
  restoredBlockedEvent,
  restoredConfirmationDecisionEvent,
  upsertRestoredConfirmation,
} from "./persistence-confirmations.js";
import { restoredBasicEventsFromRuntimeSnapshot } from "./persistence-restored-events.js";
import {
  agentTaskStatusFromSnapshot,
  basicRunNextStepFromStatus,
  basicRunTitleFromStatus,
} from "./persistence-status.js";
import { ORDINARY_RUN_BLOCKED_FALLBACK } from "../restored-run-projection.js";

export { restoredBasicEventsFromRuntimeSnapshot } from "./persistence-restored-events.js";

export type BasicAgentPersistedReplay = {
  readonly cursor: {
    readonly runId: string;
    readonly lastSequence: number;
    readonly eventCount: number;
  };
  readonly events: readonly RunEvent[];
};

export function basicRunFromRuntimeSnapshot(snapshot: RuntimeRunSnapshot): BasicAgentRun {
  const status = agentTaskStatusFromSnapshot(snapshot);
  const events = restoredBasicEventsFromRuntimeSnapshot(snapshot);
  const latestEvent = [...events].reverse().find((event) => event.summary !== undefined);
  const persisted = snapshot.basicRun;
  return {
    runId: persisted?.runId ?? snapshot.run.runId,
    conversationId: persisted?.conversationId ?? snapshot.run.conversationId,
    title: basicRunTitleFromStatus(status, snapshot.run.resultTitle),
    goalSummary: persisted?.goalSummary ?? redactOrdinaryText(snapshot.run.goalSummary, 400),
    status,
    runMode: persisted?.runMode ?? snapshot.run.runMode,
    agentDefinitionRef: snapshot.run.agentDefinitionRef ?? persisted?.agentDefinitionRef,
    createdAt: persisted?.createdAt ?? snapshot.run.createdAt,
    updatedAt: persisted?.updatedAt ?? snapshot.run.updatedAt,
    currentStep: latestEvent?.summary,
    nextStep: basicRunNextStepFromStatus(status),
    requiresUserAction: status === "approval_needed" || status === "blocked" || status === "needs_input",
    eventCursor: {
      lastSequence: events.at(-1)?.sequence ?? 0,
      eventCount: events.length,
    },
  };
}

export function basicRunReplayFromRuntimeSnapshot(snapshot: RuntimeRunSnapshot): BasicAgentPersistedReplay {
  const events = restoredBasicEventsFromRuntimeSnapshot(snapshot);
  return {
    cursor: {
      runId: snapshot.run.runId,
      lastSequence: events.at(-1)?.sequence ?? 0,
      eventCount: events.length,
    },
    events,
  };
}

export async function submitRestoredBasicConfirmationDecision(input: {
  readonly runtimeDatabase: RuntimeDatabase | undefined;
  readonly runId: string;
  readonly confirmationId: string;
  readonly decision: Pick<ConfirmationDecision, "decision" | "guidance">;
}): Promise<BasicAgentRun | undefined> {
  const snapshot = await input.runtimeDatabase?.getRun(input.runId);
  if (input.runtimeDatabase === undefined || snapshot === undefined) {
    return undefined;
  }
  const pending = snapshot.confirmations.find(
    (confirmation) => confirmation.confirmationId === input.confirmationId && confirmation.status === "pending"
  );
  if (pending === undefined) {
    return undefined;
  }
  const decidedAt = new Date().toISOString();
  const blockedByMissingContinuation = input.decision.decision === "approve_once";
  const nextRun: RuntimeRunRecord = {
    ...snapshot.run,
    status: input.decision.decision === "guidance" ? "needs_input" : "blocked",
    updatedAt: decidedAt,
    completedAt: input.decision.decision === "guidance" ? undefined : decidedAt,
    error:
      input.decision.decision === "guidance"
        ? snapshot.run.error
        : {
            code: blockedByMissingContinuation ? "confirmation_continuation_lost" : "confirmation_denied",
            message: blockedByMissingContinuation
              ? ORDINARY_RUN_BLOCKED_FALLBACK
              : "已不执行。",
          },
  };
  const nextConfirmations = upsertRestoredConfirmation({
    snapshot,
    confirmationId: input.confirmationId,
    decision: input.decision,
    decidedAt,
  });
  const events = [
    ...restoredBasicEventsFromRuntimeSnapshot(snapshot),
    restoredConfirmationDecisionEvent({
      runId: input.runId,
      confirmationId: input.confirmationId,
      decision: input.decision,
      decidedAt,
      sequence: nextBasicEventSequence(restoredBasicEventsFromRuntimeSnapshot(snapshot)),
    }),
  ];
  const blockedEvents =
    input.decision.decision === "guidance"
      ? events
      : [
          ...events,
          restoredBlockedEvent({
            runId: input.runId,
            decidedAt,
            sequence: nextBasicEventSequence(events),
            summary: nextRun.error?.message ?? ORDINARY_RUN_BLOCKED_FALLBACK,
          }),
        ];
  const nextSnapshot: RuntimeRunSnapshot = {
    ...snapshot,
    run: nextRun,
    basicEvents: blockedEvents,
    confirmations: nextConfirmations,
  };
  const basicRun = basicRunFromRuntimeSnapshot(nextSnapshot);

  await input.runtimeDatabase.upsertRun(nextRun);
  await input.runtimeDatabase.replaceConfirmations(input.runId, nextConfirmations);
  await input.runtimeDatabase.replaceBasicRunEvents(input.runId, blockedEvents);
  await input.runtimeDatabase.upsertBasicRun(basicRun);
  return basicRun;
}
