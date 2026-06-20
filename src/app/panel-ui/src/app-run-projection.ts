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
  PanelRunResultReadModel,
  RunCapabilityResolution,
  RunEvent,
  TranscriptNode,
} from "./contracts/run";
import type { LiveRunBuffer } from "../../panel-ui-live-run-buffer";

export type CurrentRunProjection = {
  readonly run?: BasicAgentRun;
  readonly workView?: DesktopWorkView;
  readonly result?: PanelRunResultReadModel;
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

export type ConversationTranscriptLoadOptions = {
  readonly signal?: AbortSignal;
  readonly onPartial?: (partial: Record<string, readonly TranscriptNode[]>) => void;
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
  exceptRunId: string | undefined,
  options: ConversationTranscriptLoadOptions = {}
): Promise<Record<string, readonly TranscriptNode[]>> {
  // 按最近优先（倒序）、分批加载历史 run 的 transcript 节点。
  // 长会话（20+ 轮）不再一次性并发 20+ 个 HTTP 请求，
  // 而是分批处理，并且只把本批新增节点交给视图，避免重复合并旧批次。
  const allRunIds = runIdsForConversation(conversation)
    .filter((runId) => runId !== exceptRunId)
    .reverse();
  if (allRunIds.length === 0) return {};
  const byRunId: Record<string, readonly TranscriptNode[]> = {};
  const batchSize = 5;
  for (let batchStart = 0; batchStart < allRunIds.length; batchStart += batchSize) {
    if (options.signal?.aborted) return byRunId;
    const batch = allRunIds.slice(batchStart, batchStart + batchSize);
    const entries = await Promise.all(
      batch.map(async (runId) => {
        const view = await safeBasicRunView(runId, 0, { signal: options.signal });
        return [
          runId,
          transcriptNodesFrom(ordinaryWorkViewFromRunView(view), view?.detail).filter((node) => node.runId === runId),
        ] as const;
      })
    );
    if (options.signal?.aborted) return byRunId;
    const batchByRunId: Record<string, readonly TranscriptNode[]> = {};
    for (const [runId, nodes] of entries) {
      byRunId[runId] = nodes;
      batchByRunId[runId] = nodes;
    }
    options.onPartial?.(batchByRunId);
  }
  return byRunId;
}

export function projectCurrentRun(app: RunProjectionState): CurrentRunProjection {
  const runId = app.run?.runId;
  if (runId === undefined) {
    return { events: [], transcriptNodes: transcriptNodesForConversation(app) };
  }
  const workView = app.workView?.run.runId === runId ? app.workView : undefined;
  const result = app.conversation?.currentRun?.run.runId === runId ? app.conversation.currentRun.result : undefined;
  const capabilityResolution = app.capabilityResolutionRunId === runId ? app.capabilityResolution : undefined;
  const detail = app.detail?.runId === runId ? app.detail : undefined;
  const live = app.live?.runId === runId ? app.live : undefined;
  const events = app.events.filter((event) => event.runId === runId);
  const runTranscriptNodes = transcriptNodesFrom(workView, detail).filter((node) => node.runId === runId);
  const transcriptNodes = mergeConversationTranscriptNodes(app, runId, runTranscriptNodes);
  return {
    run: app.run,
    workView,
    result,
    capabilityResolution,
    detail,
    live,
    events,
    transcriptNodes,
  };
}

export function currentRunProjectionDeps(app: RunProjectionState): readonly unknown[] {
  return [
    app.conversation,
    app.run,
    app.workView,
    app.conversation?.currentRun?.result,
    app.capabilityResolution,
    app.capabilityResolutionRunId,
    app.transcriptNodesByRunId,
    app.events,
    app.live,
    app.detail,
  ];
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
