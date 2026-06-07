import {
  mergeTranscriptNodesByRunId,
  runIdsForConversation as cachedRunIdsForConversation,
  transcriptNodesForConversation as cachedTranscriptNodesForConversation,
} from "../../panel-ui-transcript-cache";
import {
  createRunReadModelPatch as createSharedRunReadModelPatch,
  detailForRun,
  nextWorkViewForRun,
  transcriptNodesFrom,
} from "../../panel-ui-run-projection";
import { ordinaryWorkViewFromRunView, safeBasicRunView } from "./runtime";
import type { Conversation } from "./contracts/conversation";
import type {
  BasicAgentRun,
  DesktopRunDetail,
  DesktopWorkView,
  RunCapabilityResolution,
  RunEvent,
  TranscriptNode,
} from "./contracts/run";
import type { LiveRunBuffer } from "../../panel-ui-live-run-buffer";

export type CurrentRunProjection = {
  readonly run?: BasicAgentRun;
  readonly workView?: DesktopWorkView;
  readonly capabilityResolution?: RunCapabilityResolution;
  readonly detail?: DesktopRunDetail;
  readonly live?: LiveRunBuffer;
  readonly events: readonly RunEvent[];
  readonly transcriptNodes: readonly TranscriptNode[];
};

export type RunReadModelPatch = {
  readonly workView?: DesktopWorkView;
  readonly detail?: DesktopRunDetail;
  readonly transcriptNodes: readonly TranscriptNode[];
  readonly transcriptNodesByRunId: Record<string, readonly TranscriptNode[]>;
};

type RunProjectionState = {
  readonly conversation?: Conversation;
  readonly run?: BasicAgentRun;
  readonly workView?: DesktopWorkView;
  readonly capabilityResolution?: RunCapabilityResolution;
  readonly capabilityResolutionRunId?: string;
  readonly transcriptNodesByRunId: Record<string, readonly TranscriptNode[]>;
  readonly events: readonly RunEvent[];
  readonly live?: LiveRunBuffer;
  readonly detail?: DesktopRunDetail;
};

export {
  detailForRun,
  nextWorkViewForRun,
  transcriptNodesFrom,
};

export function createRunReadModelPatch(
  previous: {
    readonly workView?: DesktopWorkView;
    readonly transcriptNodesByRunId: Record<string, readonly TranscriptNode[]>;
  },
  input: {
    readonly runId: string;
    readonly workView: DesktopWorkView | undefined;
    readonly detail: DesktopRunDetail | undefined;
    readonly reusePreviousWorkView?: boolean;
  }
): RunReadModelPatch {
  return createSharedRunReadModelPatch<DesktopWorkView, DesktopRunDetail, TranscriptNode>(previous, input);
}

export async function loadConversationTranscriptNodesByRunId(
  conversation: Conversation,
  exceptRunId: string | undefined
): Promise<Record<string, readonly TranscriptNode[]>> {
  const entries = await Promise.all(
    runIdsForConversation(conversation)
      .filter((runId) => runId !== exceptRunId)
      .map(async (runId) => {
        const view = await safeBasicRunView(runId, 0);
        return [
          runId,
          transcriptNodesFrom(ordinaryWorkViewFromRunView(view), view?.detail).filter((node) => node.runId === runId),
        ] as const;
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
  const workView = app.workView?.run.runId === runId ? app.workView : undefined;
  const capabilityResolution = app.capabilityResolutionRunId === runId ? app.capabilityResolution : undefined;
  const detail = app.detail?.runId === runId ? app.detail : undefined;
  const live = app.live?.runId === runId ? app.live : undefined;
  const events = app.events.filter((event) => event.runId === runId);
  const runTranscriptNodes = transcriptNodesFrom(workView, detail).filter((node) => node.runId === runId);
  const transcriptNodes = mergeConversationTranscriptNodes(app, runId, runTranscriptNodes);
  return {
    run: app.run,
    workView,
    capabilityResolution,
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
