import { mergeTranscriptNodesByRunId } from "./panel-ui-transcript-cache.js";

export type RunProjectionNode = {
  readonly nodeId: string;
  readonly runId: string;
  readonly sequence: number;
};

export type RunProjectionWorkSession<TNode extends RunProjectionNode = RunProjectionNode> = {
  readonly run: {
    readonly runId: string;
  };
  readonly transcriptNodes?: readonly TNode[];
};

export type RunProjectionDetail<TNode extends RunProjectionNode = RunProjectionNode> = {
  readonly runId: string;
  readonly transcript?: {
    readonly transcriptNodes?: readonly TNode[];
  };
};

export type RunReadModelPatchState = {
  readonly workSession?: RunProjectionWorkSession;
  readonly transcriptNodesByRunId: Record<string, readonly RunProjectionNode[]>;
};

export type RunReadModelPatch<
  TWorkSession extends RunProjectionWorkSession<TNode>,
  TDetail extends RunProjectionDetail<TNode>,
  TNode extends RunProjectionNode
> = {
  readonly workSession: TWorkSession | undefined;
  readonly detail: TDetail | undefined;
  readonly transcriptNodes: readonly TNode[];
  readonly transcriptNodesByRunId: Record<string, readonly TNode[]>;
};

export function transcriptNodesFrom<TNode extends RunProjectionNode>(
  workSession: RunProjectionWorkSession<TNode> | undefined,
  detail: RunProjectionDetail<TNode> | undefined
): readonly TNode[] {
  return workSession?.transcriptNodes ?? detail?.transcript?.transcriptNodes ?? [];
}

export function nextWorkSessionForRun<TWorkSession extends RunProjectionWorkSession>(
  runId: string,
  incoming: TWorkSession | undefined,
  previous: TWorkSession | undefined
): TWorkSession | undefined {
  if (incoming?.run.runId === runId) return incoming;
  if (previous?.run.runId === runId) return previous;
  return undefined;
}

export function detailForRun<T extends RunProjectionDetail | undefined>(
  runId: string,
  detail: T
): T | undefined {
  return detail?.runId === runId ? detail : undefined;
}

export function createRunReadModelPatch<
  TWorkSession extends RunProjectionWorkSession<TNode>,
  TDetail extends RunProjectionDetail<TNode>,
  TNode extends RunProjectionNode
>(
  previous: {
    readonly workSession?: TWorkSession;
    readonly transcriptNodesByRunId: Record<string, readonly TNode[]>;
  },
  input: {
    readonly runId: string;
    readonly workSession: TWorkSession | undefined;
    readonly detail: TDetail | undefined;
  }
): RunReadModelPatch<TWorkSession, TDetail, TNode> {
  const workSession = nextWorkSessionForRun(input.runId, input.workSession, previous.workSession);
  const transcriptNodes = transcriptNodesFrom(workSession, input.detail);
  return {
    workSession,
    detail: input.detail,
    transcriptNodes,
    transcriptNodesByRunId: mergeTranscriptNodesByRunId(previous.transcriptNodesByRunId, input.runId, transcriptNodes),
  };
}
