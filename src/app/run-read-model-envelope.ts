export type RunEnvelopeViewBase<
  TStatus extends string = string,
  TRunKind extends string = string,
  TRunMode extends string = string,
> = {
  readonly runId: string;
  readonly status: TStatus;
  readonly runKind: TRunKind;
  readonly runMode: TRunMode;
};

export type ConversationRunEnvelopeViewBase<
  TStatus extends string = string,
  TRunKind extends string = string,
  TRunMode extends string = string,
> = RunEnvelopeViewBase<TStatus, TRunKind, TRunMode> & {
  readonly conversationId: string;
  readonly parentRunId?: string;
  readonly rootRunId?: string;
  readonly turnOrdinal?: number;
};

export function projectRunEnvelopeViewBase<
  TStatus extends string,
  TRunKind extends string,
  TRunMode extends string,
>(input: {
  readonly runId: string;
  readonly status: TStatus;
  readonly runKind: TRunKind;
  readonly runMode: TRunMode;
}): RunEnvelopeViewBase<TStatus, TRunKind, TRunMode> {
  return {
    runId: input.runId,
    status: input.status,
    runKind: input.runKind,
    runMode: input.runMode,
  };
}

export function projectConversationRunEnvelopeViewBase<
  TStatus extends string,
  TRunKind extends string,
  TRunMode extends string,
>(input: {
  readonly runId: string;
  readonly conversationId: string;
  readonly parentRunId?: string;
  readonly rootRunId?: string;
  readonly turnOrdinal?: number;
  readonly status: TStatus;
  readonly runKind: TRunKind;
  readonly runMode: TRunMode;
}): ConversationRunEnvelopeViewBase<TStatus, TRunKind, TRunMode> {
  return {
    ...projectRunEnvelopeViewBase(input),
    conversationId: input.conversationId,
    parentRunId: input.parentRunId,
    rootRunId: input.rootRunId,
    turnOrdinal: input.turnOrdinal,
  };
}
