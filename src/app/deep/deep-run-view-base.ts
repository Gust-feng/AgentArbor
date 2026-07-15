import type { WorkspaceFolderSummary } from "../task-soil/workspace-folder-summary.js";

export function deepConversationRunEnvelope<TStatus extends string>(input: {
  readonly runId: string;
  readonly conversationId: string;
  readonly parentRunId?: string;
  readonly rootRunId?: string;
  readonly turnOrdinal?: number;
  readonly status: TStatus;
  readonly runKind: string;
  readonly runMode: string;
}) {
  return {
    runId: input.runId,
    conversationId: input.conversationId,
    parentRunId: input.parentRunId,
    rootRunId: input.rootRunId,
    turnOrdinal: input.turnOrdinal,
    status: input.status,
    runKind: input.runKind,
    runMode: input.runMode,
  };
}

export function deepConversationRunSummary<T extends ReturnType<typeof deepConversationRunEnvelope>>(input: T & {
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly workspaceFolder?: WorkspaceFolderSummary;
}) {
  return {
    ...input,
    startedAt: input.startedAt,
    updatedAt: input.updatedAt,
    workspaceFolder: input.workspaceFolder,
  };
}
