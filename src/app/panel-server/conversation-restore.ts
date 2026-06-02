import type {
  RuntimeConversationRecord,
  RuntimeDatabase,
  RuntimeModelCallRecord,
  RuntimeRunSnapshot,
} from "../../domain/runtime-database/index.js";
import {
  trimRuntimeConversationToClosedPairs,
  turnModelFromConfig,
  toRuntimeConversationRecord,
  type PanelConversationReadModel,
  type PanelConversationStore,
} from "../panel-conversations.js";
import { unique } from "./request-parsers.js";

export type PanelConversationRestoreRuntime = {
  readonly conversations: PanelConversationStore;
  readonly runtimeDatabase?: RuntimeDatabase;
};

export async function restorePersistedPanelConversation(
  runtime: PanelConversationRestoreRuntime,
  record: RuntimeConversationRecord
): Promise<PanelConversationReadModel> {
  const withResponseModels = await backfillConversationResponseModels(runtime, record);
  const completedRunIds = await completedAssistantRunIds(runtime, withResponseModels.record);
  const trimmed = trimRuntimeConversationToClosedPairs({ record: withResponseModels.record, completedRunIds });
  const restored = runtime.conversations.restore(trimmed.record);
  if ((trimmed.trimmed || withResponseModels.changed) && runtime.runtimeDatabase !== undefined) {
    await runtime.runtimeDatabase.upsertConversation(toRuntimeConversationRecord(restored));
  }
  return restored;
}

async function backfillConversationResponseModels(
  runtime: PanelConversationRestoreRuntime,
  record: RuntimeConversationRecord
): Promise<{ readonly record: RuntimeConversationRecord; readonly changed: boolean }> {
  if (runtime.runtimeDatabase === undefined) {
    return { record, changed: false };
  }
  const missingRunIds = unique(
    record.turns
      .filter((turn) => turn.role === "assistant" && turn.responseModel === undefined && turn.runId !== undefined)
      .map((turn) => turn.runId!)
  );
  if (missingRunIds.length === 0) {
    return { record, changed: false };
  }
  const snapshots = await Promise.all(
    missingRunIds.map(async (runId): Promise<readonly [string, RuntimeRunSnapshot | undefined]> => [
      runId,
      await runtime.runtimeDatabase?.getRun(runId),
    ])
  );
  const modelsByRunId = new Map(
    snapshots.flatMap(([runId, snapshot]) => {
      const model = snapshot === undefined ? undefined : conversationTurnModelFromRunSnapshot(snapshot);
      return model === undefined ? [] : [[runId, model] as const];
    })
  );
  if (modelsByRunId.size === 0) {
    return { record, changed: false };
  }
  let changed = false;
  const turns = record.turns.map((turn) => {
    if (turn.role !== "assistant" || turn.responseModel !== undefined || turn.runId === undefined) {
      return turn;
    }
    const responseModel = modelsByRunId.get(turn.runId);
    if (responseModel === undefined) {
      return turn;
    }
    changed = true;
    return {
      ...turn,
      responseModel,
    };
  });
  return {
    record: changed ? { ...record, turns } : record,
    changed,
  };
}

function conversationTurnModelFromRunSnapshot(
  snapshot: RuntimeRunSnapshot
): RuntimeConversationRecord["turns"][number]["responseModel"] | undefined {
  const activeModel = snapshot.run.capabilitySnapshot?.activeModel;
  if (activeModel !== undefined) {
    const latestCallModel = latestRuntimeModelCall(snapshot.modelCalls)?.model;
    return {
      ...turnModelFromConfig(activeModel),
      model: latestCallModel ?? activeModel.model,
    };
  }
  const latestCall = latestRuntimeModelCall(snapshot.modelCalls);
  if (latestCall === undefined || latestCall.model === undefined) {
    return undefined;
  }
  return {
    profileId: latestCall.providerKind ?? `run:${snapshot.run.runId}`,
    providerKind: latestCall.providerKind,
    protocolKind: latestCall.protocolKind,
    model: latestCall.model,
  };
}

function latestRuntimeModelCall(
  calls: readonly RuntimeModelCallRecord[]
): RuntimeModelCallRecord | undefined {
  return [...calls].reverse().find((call) => call.model !== undefined);
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
      const snapshot = await runtime.runtimeDatabase?.getRun(runId);
      return snapshot?.run.status === "completed" ? runId : undefined;
    })
  );
  return new Set(completed.filter((runId): runId is string => runId !== undefined));
}
