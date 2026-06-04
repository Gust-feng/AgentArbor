import type { ProjectableTranscriptNode } from "./panel-transcript-node-projection.js";

export type StartupTranscriptRunLike = {
  readonly runId: string;
  readonly status: string;
};

export function isRefreshingTranscriptRun(run: StartupTranscriptRunLike | undefined): boolean {
  return run?.status === "queued" || run?.status === "planning" || run?.status === "running" || run?.status === "pending";
}

export function withStartupWorkflowNode<TNode extends ProjectableTranscriptNode>(
  nodes: readonly TNode[],
  input: {
    readonly runId: string | undefined;
    readonly refreshing: boolean;
  }
): readonly (TNode | ProjectableTranscriptNode)[] {
  void input;
  return nodes;
}
