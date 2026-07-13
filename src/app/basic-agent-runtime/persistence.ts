import type { BasicAgentRun, ConfirmationDecision, RunEvent } from "../../domain/basic-agent/index.js";
import type {
  RuntimeDatabase,
  RuntimeRunRecord,
  RuntimeRunSnapshot,
} from "../../domain/runtime-database/index.js";
import { isGenericApprovalDecisionText } from "../text-projection/confirmation-copy.js";
import {
  nextBasicEventSequence,
  restoredBlockedEvent,
  restoredConfirmationDecisionEvent,
  upsertRestoredConfirmation,
} from "./persistence-confirmations.js";
import {
  durableBasicRunEvents,
  restoredBasicEventsFromRuntimeSnapshot,
} from "./persistence-restored-events.js";
import {
  agentTaskStatusFromSnapshot,
  basicRunNextStepFromStatus,
  basicRunTitleFromStatus,
} from "./persistence-status.js";
import { ORDINARY_RUN_BLOCKED_FALLBACK } from "../run-read-model/restored-run-projection.js";
import { requireRestorableOrdinaryRuntimeSnapshot } from "./persistence-snapshot-contract.js";

export {
  durableBasicRunEvents,
  restoredBasicEventsFromRuntimeSnapshot,
} from "./persistence-restored-events.js";

export type BasicAgentPersistedReplay = {
  readonly cursor: {
    readonly runId: string;
    readonly lastSequence: number;
    readonly eventCount: number;
  };
  readonly events: readonly RunEvent[];
};

export function basicRunFromRuntimeSnapshot(snapshot: RuntimeRunSnapshot): BasicAgentRun {
  const persistedSnapshot = requireRestorableOrdinaryRuntimeSnapshot(snapshot);
  const status = agentTaskStatusFromSnapshot(persistedSnapshot);
  const events = restoredBasicEventsFromRuntimeSnapshot(persistedSnapshot);
  const latestEvent = [...events].reverse().find((event) => event.summary !== undefined && !isLowValuePersistedCurrentStepEvent(event));
  const persisted = persistedSnapshot.basicRun;
  return {
    runId: persisted.runId,
    conversationId: persisted.conversationId,
    title: basicRunTitleFromStatus(status, persistedSnapshot.run.resultTitle),
    goalSummary: persisted.goalSummary,
    status,
    runMode: persisted.runMode,
    agentDefinitionRef: persistedSnapshot.run.agentDefinitionRef,
    createdAt: persisted.createdAt,
    updatedAt: persisted.updatedAt,
    currentStep: latestEvent?.summary,
    nextStep: basicRunNextStepFromStatus(status),
    requiresUserAction: status === "approval_needed" || status === "blocked" || status === "needs_input",
    eventCursor: {
      lastSequence: events.at(-1)?.sequence ?? 0,
      eventCount: events.length,
    },
  };
}

function isLowValuePersistedCurrentStepEvent(event: RunEvent): boolean {
  if (event.type === "run.started" || event.type === "goal.received" || event.type === "run.resumed") {
    return true;
  }
  if (event.type === "user_approval.received") {
    return isGenericApprovalDecisionText(event.summary ?? event.detail?.preview ?? event.title);
  }
  return false;
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
    stopReason:
      input.decision.decision === "guidance"
        ? "needs_input"
        : blockedByMissingContinuation
          ? "confirmation_continuation_lost"
          : "confirmation_denied",
    continuationAvailability: input.decision.decision === "guidance" ? "new_turn" : "lost_after_restart",
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
  const restoredEvents = restoredBasicEventsFromRuntimeSnapshot({
    ...snapshot,
    confirmations: nextConfirmations,
  });
  const events = [
    ...restoredEvents,
    ...(input.decision.decision === "approve_once"
      ? []
      : [restoredConfirmationDecisionEvent({
          runId: input.runId,
          confirmationId: input.confirmationId,
          decision: input.decision,
          decidedAt,
          sequence: nextBasicEventSequence(restoredEvents),
        })]),
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
  const nextSnapshotBeforeBasicRun: RuntimeRunSnapshot = {
    ...snapshot,
    run: nextRun,
    basicEvents: blockedEvents,
    confirmations: nextConfirmations,
  };
  const basicRun = basicRunFromRuntimeSnapshot(nextSnapshotBeforeBasicRun);
  await input.runtimeDatabase.saveRunSnapshot({
    ...nextSnapshotBeforeBasicRun,
    basicRun,
    basicEvents: durableBasicRunEvents(blockedEvents),
  });
  return basicRun;
}
