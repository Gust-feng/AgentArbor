import {
  mergeTranscriptNodesByRunId,
  runIdsForConversation as cachedRunIdsForConversation,
  transcriptNodesForConversation as cachedTranscriptNodesForConversation,
} from "../../panel-ui-transcript-cache";
import {
  createRunReadModelPatch as createSharedRunReadModelPatch,
  detailForRun,
  nextWorkSessionForRun,
  transcriptNodesFrom,
} from "../../panel-ui-run-projection";
import { safeDesktopDetail, safeWorkSession } from "./runtime";
import type { Conversation } from "./contracts/conversation";
import type { BasicAgentRun, DesktopRunDetail, DesktopWorkSession, RunEvent, TranscriptNode } from "./contracts/run";
import type { LiveRunBuffer } from "../../panel-ui-live-run-buffer";

export type CurrentRunProjection = {
  readonly run?: BasicAgentRun;
  readonly workSession?: DesktopWorkSession;
  readonly detail?: DesktopRunDetail;
  readonly live?: LiveRunBuffer;
  readonly events: readonly RunEvent[];
  readonly transcriptNodes: readonly TranscriptNode[];
};

export type RunReadModelPatch = {
  readonly workSession?: DesktopWorkSession;
  readonly detail?: DesktopRunDetail;
  readonly transcriptNodes: readonly TranscriptNode[];
  readonly transcriptNodesByRunId: Record<string, readonly TranscriptNode[]>;
};

type RunProjectionState = {
  readonly conversation?: Conversation;
  readonly run?: BasicAgentRun;
  readonly workSession?: DesktopWorkSession;
  readonly transcriptNodesByRunId: Record<string, readonly TranscriptNode[]>;
  readonly events: readonly RunEvent[];
  readonly live?: LiveRunBuffer;
  readonly detail?: DesktopRunDetail;
};

export {
  detailForRun,
  nextWorkSessionForRun,
  transcriptNodesFrom,
};

export function createRunReadModelPatch(
  previous: {
    readonly workSession?: DesktopWorkSession;
    readonly transcriptNodesByRunId: Record<string, readonly TranscriptNode[]>;
  },
  input: {
    readonly runId: string;
    readonly workSession: DesktopWorkSession | undefined;
    readonly detail: DesktopRunDetail | undefined;
  }
): RunReadModelPatch {
  return createSharedRunReadModelPatch<DesktopWorkSession, DesktopRunDetail, TranscriptNode>(previous, input);
}

export async function loadConversationTranscriptNodesByRunId(
  conversation: Conversation,
  exceptRunId: string | undefined
): Promise<Record<string, readonly TranscriptNode[]>> {
  const entries = await Promise.all(
    runIdsForConversation(conversation)
      .filter((runId) => runId !== exceptRunId)
      .map(async (runId) => {
        const [workSession, detail] = await Promise.all([
          safeWorkSession(runId),
          safeDesktopDetail(runId),
        ]);
        return [runId, transcriptNodesFrom(workSession, detail).filter((node) => node.runId === runId)] as const;
      })
  );
  const byRunId: Record<string, readonly TranscriptNode[]> = {};
  for (const [runId, nodes] of entries) {
    byRunId[runId] = nodes;
  }
  return byRunId;
}

export function projectCurrentRun(app: RunProjectionState): CurrentRunProjection {
  const runId = app.run?.runId;
  if (runId === undefined) {
    return { events: [], transcriptNodes: transcriptNodesForConversation(app) };
  }
  const workSession = app.workSession?.run.runId === runId ? app.workSession : undefined;
  const detail = app.detail?.runId === runId ? app.detail : undefined;
  const live = app.live?.runId === runId ? app.live : undefined;
  const events = app.events.filter((event) => event.runId === runId);
  const runTranscriptNodes = transcriptNodesFrom(workSession, detail).filter((node) => node.runId === runId);
  const transcriptNodes = mergeConversationTranscriptNodes(app, runId, runTranscriptNodes);
  return {
    run: app.run,
    workSession,
    detail,
    live,
    events,
    transcriptNodes,
  };
}

function transcriptNodesForConversation(app: RunProjectionState): readonly TranscriptNode[] {
  return cachedTranscriptNodesForConversation(app.conversation?.turns ?? [], app.transcriptNodesByRunId);
}

function mergeConversationTranscriptNodes(
  app: RunProjectionState,
  currentRunId: string,
  currentRunNodes: readonly TranscriptNode[]
): readonly TranscriptNode[] {
  const byRunId = mergeTranscriptNodesByRunId(app.transcriptNodesByRunId, currentRunId, currentRunNodes);
  return runIdsForConversation(app.conversation).flatMap((runId) => byRunId[runId] ?? []);
}

function runIdsForConversation(conversation: Conversation | undefined): readonly string[] {
  return cachedRunIdsForConversation(conversation?.turns ?? []);
}
