import type {
  RuntimeConversationRecord,
  RuntimeDatabase,
} from "../../domain/runtime-database/index.js";
import {
  trimRuntimeConversationToClosedPairs,
  toRuntimeConversationRecord,
  type PanelConversationReadModel,
  type PanelConversationStore,
} from "../panel-conversation/panel-conversations.js";
import { readRuntimeSnapshotWithOrdinaryContract } from "../basic-agent-runtime/persistence-snapshot-contract.js";
import { unique } from "./request-parsers.js";

export type PanelConversationRestoreRuntime = {
  readonly conversations: PanelConversationStore;
  readonly runtimeDatabase?: Pick<RuntimeDatabase, "getRun" | "upsertConversation">;
};

export async function restorePersistedPanelConversation(
  runtime: PanelConversationRestoreRuntime,
  record: RuntimeConversationRecord
): Promise<PanelConversationReadModel> {
  const completedRunIds = await completedAssistantRunIds(runtime, record);
  const trimmed = trimRuntimeConversationToClosedPairs({ record, completedRunIds });
  const restored = runtime.conversations.restore(trimmed.record);
  if (trimmed.trimmed && runtime.runtimeDatabase !== undefined) {
    await runtime.runtimeDatabase.upsertConversation(toRuntimeConversationRecord(restored));
  }
  return restored;
}

async function completedAssistantRunIds(
  runtime: PanelConversationRestoreRuntime,
  record: RuntimeConversationRecord
): Promise<ReadonlySet<string> | undefined> {
  if (runtime.runtimeDatabase === undefined) {
    return undefined;
  }
  const assistantRunIds = unique(
    record.turns
      .filter((turn) => turn.role === "assistant" && turn.runId !== undefined)
      .map((turn) => turn.runId!)
  );
  const completed = await Promise.all(
    assistantRunIds.map(async (runId): Promise<string | undefined> => {
      const snapshot = await readRuntimeSnapshotWithOrdinaryContract(runtime.runtimeDatabase, runId);
      return snapshot?.run.status === "completed" ? runId : undefined;
    })
  );
  return new Set(completed.filter((runId): runId is string => runId !== undefined));
}
