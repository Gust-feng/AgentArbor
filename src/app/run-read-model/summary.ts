import type { WorkspaceFolderSummary } from "../task-soil/workspace-folder-summary.js";
import type { ConversationRunEnvelopeViewBase, RunEnvelopeViewBase } from "./envelope.js";

export type SharedRunSummaryBase<
  TStatus extends string = string,
  TRunKind extends string = string,
  TRunMode extends string = string,
> = RunEnvelopeViewBase<TStatus, TRunKind, TRunMode> & {
  readonly startedAt: string;
  readonly updatedAt: string;
};

export type SharedConversationRunSummaryBase<
  TStatus extends string = string,
  TRunKind extends string = string,
  TRunMode extends string = string,
> = ConversationRunEnvelopeViewBase<TStatus, TRunKind, TRunMode> & {
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly workspaceFolder?: WorkspaceFolderSummary;
};

export function projectSharedRunSummaryBase<
  TStatus extends string,
  TRunKind extends string,
  TRunMode extends string,
>(input: RunEnvelopeViewBase<TStatus, TRunKind, TRunMode> & {
  readonly startedAt: string;
  readonly updatedAt: string;
}): SharedRunSummaryBase<TStatus, TRunKind, TRunMode> {
  return {
    ...input,
    startedAt: input.startedAt,
    updatedAt: input.updatedAt,
  };
}

export function projectSharedConversationRunSummaryBase<
  TStatus extends string,
  TRunKind extends string,
  TRunMode extends string,
>(input: ConversationRunEnvelopeViewBase<TStatus, TRunKind, TRunMode> & {
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly workspaceFolder?: WorkspaceFolderSummary;
}): SharedConversationRunSummaryBase<TStatus, TRunKind, TRunMode> {
  return {
    ...input,
    startedAt: input.startedAt,
    updatedAt: input.updatedAt,
    workspaceFolder: input.workspaceFolder,
  };
}
