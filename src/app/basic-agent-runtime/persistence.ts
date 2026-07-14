import type { BasicAgentRun, ConfirmationDecision, RunEvent } from "../../domain/basic-agent/index.js";
import type {
  RuntimeDatabase,
  RuntimeRunRecord,
  RuntimeRunSnapshot,
} from "../../domain/runtime-database/index.js";
import { isGenericApprovalDecisionText } from "../text-projection/confirmation-copy.js";
import {
  upsertRestoredConfirmation,
} from "./persistence-confirmations.js";
import {
  agentTaskStatusFromSnapshot,
  basicRunNextStepFromStatus,
  basicRunTitleFromStatus,
} from "./persistence-status.js";
import { ORDINARY_RUN_BLOCKED_FALLBACK } from "../run-read-model/restored-run-projection.js";
import { requireRestorableOrdinaryRuntimeSnapshot } from "./persistence-snapshot-contract.js";

export function basicRunFromRuntimeSnapshot(
  snapshot: RuntimeRunSnapshot,
  events: readonly RunEvent[] = []
): BasicAgentRun {
  const persistedSnapshot = requireRestorableOrdinaryRuntimeSnapshot(snapshot);
  const status = agentTaskStatusFromSnapshot(persistedSnapshot);
  const latestEvent = [...events].reverse().find((event) => event.summary !== undefined && !isLowValuePersistedCurrentStepEvent(event));
  const persisted = persistedSnapshot.run;
  return {
    runId: persisted.runId,
    conversationId: persisted.conversationId,
    title: basicRunTitleFromStatus(status, persistedSnapshot.run.resultTitle),
    goalSummary: persisted.goalSummary,
    status,
    runMode: persisted.runMode,
    agentDefinitionRef: persisted.agentDefinitionRef,
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

export async function submitRestoredBasicConfirmationDecision(input: {
  readonly runtimeDatabase: RuntimeDatabase | undefined;
  readonly runId: string;
  readonly confirmationId: string;
  readonly decision: Pick<ConfirmationDecision, "decision" | "guidance">;
}): Promise<RuntimeRunSnapshot | undefined> {
  const loadedSnapshot = await input.runtimeDatabase?.getRun(input.runId);
  if (input.runtimeDatabase === undefined || loadedSnapshot === undefined) {
    return undefined;
  }
  const snapshot = requireRestorableOrdinaryRuntimeSnapshot(loadedSnapshot);
  if (snapshot.run.status !== "approval_needed") {
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
  const nextSnapshot: RuntimeRunSnapshot = {
    run: nextRun,
    workspace: snapshot.workspace,
    events: snapshot.events,
    modelCalls: snapshot.modelCalls,
    toolCalls: snapshot.toolCalls,
    artifacts: snapshot.artifacts,
    confirmations: nextConfirmations,
    subAgentRuns: snapshot.subAgentRuns,
    ordinaryModelContext: snapshot.ordinaryModelContext,
  };
  await input.runtimeDatabase.saveRunSnapshot(nextSnapshot);
  return nextSnapshot;
}
