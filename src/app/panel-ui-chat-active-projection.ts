import {
  projectLiveRunTranscript,
  type LiveAnswerProjection,
  type LiveTranscriptNode,
  type LiveRunTranscriptProjection,
} from "./panel-ui-live-transcript.js";
import { projectChatWorkline, type ChatWorklineProjection, type WorklineTaskStatus } from "./panel-ui-chat-workline.js";
import type { LiveRunBuffer } from "./panel-ui-live-run-buffer.js";
import { firstNonEmptyText, hasNonEmptyText } from "./panel-assistant-output.js";
import {
  nodesForRun,
} from "./panel-transcript-node-projection.js";

export type ChatActiveConversationTurn = {
  readonly turnId: string;
  readonly role: "user" | "assistant";
  readonly title?: string;
  readonly content: string;
  readonly status: string;
  readonly runId?: string;
};

export type ChatActiveConversation = {
  readonly turns: readonly ChatActiveConversationTurn[];
  readonly activeRunId?: string;
  readonly latestRunId?: string;
};

export type ChatActiveRun = {
  readonly runId: string;
  readonly status: WorklineTaskStatus;
  readonly eventCursor: {
    readonly lastSequence: number;
  };
};

export type ChatActiveTranscriptNode = LiveTranscriptNode;

export type ChatActiveStatusNotice = {
  readonly title: string;
  readonly message: string;
  readonly tone: "warning" | "error";
};

export type ChatActiveProjectionInput<TDeliverable, TPending> = {
  readonly conversation?: ChatActiveConversation;
  readonly run?: ChatActiveRun;
  readonly transcriptNodes: readonly ChatActiveTranscriptNode[];
  readonly live?: LiveRunBuffer;
  readonly workViewAnswer?: string;
  readonly detailAnswer?: string;
  readonly pending?: TPending;
  readonly deliverable?: TDeliverable;
  readonly problem?: ChatActiveStatusNotice;
  readonly appError?: string;
};

export type ChatActiveProjection<TDeliverable, TPending> = {
  readonly currentRunId?: string;
  readonly currentRunProjection: LiveRunTranscriptProjection;
  readonly transcriptNodes: readonly ChatActiveTranscriptNode[];
  readonly answer?: string;
  readonly pending?: TPending;
  readonly deliverable?: TDeliverable;
  readonly liveAnswer?: LiveAnswerProjection;
  readonly standaloneAssistant?: ChatActiveStandaloneAssistant;
  readonly running: boolean;
  readonly statusNotice?: ChatActiveStatusNotice;
  readonly workline: ChatWorklineProjection<ChatActiveConversationTurn>;
  readonly hasVisibleContent: boolean;
  readonly scrollKey: string;
};

export type ChatActiveStandaloneAssistant = {
  readonly content: string;
  readonly live: boolean;
  readonly keepStreamMounted: boolean;
  readonly animateOnMount: boolean;
  readonly liveTone?: LiveAnswerProjection["tone"];
};

export function projectChatActive<TDeliverable, TPending>(
  input: ChatActiveProjectionInput<TDeliverable, TPending>
): ChatActiveProjection<TDeliverable, TPending> {
  const currentRunId = input.run?.runId ?? input.conversation?.activeRunId ?? input.conversation?.latestRunId ?? input.live?.runId;
  const activeLive = activeLiveForCurrentRun(input.run, currentRunId, input.live);
  const currentRunProjection = projectLiveRunTranscript(
    nodesForRun(input.transcriptNodes, currentRunId),
    activeLive
  );
  const currentRunAssistantTurn = currentRunId === undefined
    ? undefined
    : [...(input.conversation?.turns ?? [])].reverse().find((turn) => (
        turn.role === "assistant" &&
        turn.runId === currentRunId &&
        turn.content.trim().length > 0
      ));
  const pending = input.pending;
  const turnContentAnswer = canUseConversationTurnAsAnswer({
    run: input.run,
    pending,
    turn: currentRunAssistantTurn,
    transcriptNodes: currentRunProjection.nodes,
    currentRunId,
  })
    ? currentRunAssistantTurn?.content
    : undefined;
  const answer = pending === undefined ? firstNonEmptyText([
    input.workViewAnswer,
    input.detailAnswer,
    turnContentAnswer,
  ]) : undefined;
  const liveAnswer = currentRunProjection.answer;
  const running = input.run !== undefined && !terminalStatuses.has(input.run.status);
  const statusNotice = shouldShowStatusNotice(input.problem, input.appError, input.run, currentRunAssistantTurn)
    ? input.problem
    : undefined;
  const workline = projectChatWorkline({
    turns: input.conversation?.turns ?? [],
    currentRunId,
    currentRunStatus: input.run?.status,
    transcriptNodes: input.transcriptNodes,
    hasAnswer: hasNonEmptyText(answer),
    hasLiveAnswer: liveAnswer !== undefined,
    hasPendingConfirmation: pending !== undefined,
    hasDeliverable: input.deliverable !== undefined,
  });
  const latestTurn = workline.turns.at(-1);
  const standaloneAssistant = workline.standaloneRun
    ? standaloneAssistantForProjection(input.run, answer, liveAnswer)
    : undefined;
  const scrollKey = [
    latestTurn?.turn.turnId,
    latestTurn?.turn.content.length,
    liveAnswer?.text.length,
    input.run?.status,
    input.run?.eventCursor.lastSequence,
    input.transcriptNodes.at(-1)?.nodeId,
  ].join(":");

  return {
    currentRunId,
    currentRunProjection,
    transcriptNodes: input.transcriptNodes,
    answer,
    pending,
    deliverable: input.deliverable,
    liveAnswer,
    standaloneAssistant,
    running,
    statusNotice,
    workline,
    hasVisibleContent: workline.turns.length > 0 || workline.standaloneRun || statusNotice !== undefined,
    scrollKey,
  };
}

const terminalStatuses = new Set<WorklineTaskStatus>(["completed", "failed", "cancelled", "blocked"]);
const refreshingStatuses = new Set<WorklineTaskStatus>(["queued", "planning", "running", "pending"]);

function canUseConversationTurnAsAnswer<TPending>(input: {
  readonly run: ChatActiveRun | undefined;
  readonly pending: TPending | undefined;
  readonly turn: ChatActiveConversationTurn | undefined;
  readonly transcriptNodes: readonly ChatActiveTranscriptNode[];
  readonly currentRunId: string | undefined;
}): boolean {
  if (input.turn === undefined || input.pending !== undefined) return false;
  if (input.run === undefined) return true;
  if (terminalStatuses.has(input.run.status)) return true;
  if (input.run.status !== "running" || input.turn.content.trim().length === 0) {
    return false;
  }
  const currentNodes = input.currentRunId === undefined
    ? []
    : input.transcriptNodes.filter((node) => node.runId === input.currentRunId);
  const latestNodeSequence = currentNodes.reduce((latest, node) => Math.max(latest, node.sequence), 0);
  return !hasToolOrApprovalBoundary(currentNodes) || input.run.eventCursor.lastSequence > latestNodeSequence;
}

function hasToolOrApprovalBoundary(nodes: readonly ChatActiveTranscriptNode[]): boolean {
  return nodes.some((node) =>
    node.kind === "tool" ||
    node.kind === "confirmation" ||
    node.kind === "user_decision"
  );
}

function activeLiveForCurrentRun(
  run: ChatActiveRun | undefined,
  currentRunId: string | undefined,
  live: LiveRunBuffer | undefined
): LiveRunBuffer | undefined {
  if (live === undefined || currentRunId === undefined || live.runId !== currentRunId) {
    return undefined;
  }
  if (run === undefined) {
    return live;
  }
  return refreshingStatuses.has(run.status) ? live : undefined;
}

function standaloneAssistantForProjection(
  run: ChatActiveRun | undefined,
  answer: string | undefined,
  liveAnswer: LiveAnswerProjection | undefined
): ChatActiveStandaloneAssistant {
  const liveStreamingAnswer = liveAnswer?.streaming === true ? liveAnswer : undefined;
  const refreshing = run !== undefined && refreshingStatuses.has(run.status);
  const content = liveStreamingAnswer?.text ?? answer ?? liveAnswer?.text ?? "";
  return {
    content,
    live: refreshing && liveStreamingAnswer !== undefined,
    keepStreamMounted: refreshing,
    animateOnMount: liveStreamingAnswer !== undefined || (!refreshing && content.trim().length > 0),
    liveTone: liveStreamingAnswer?.tone ?? liveAnswer?.tone,
  };
}

function shouldShowStatusNotice(
  problem: ChatActiveStatusNotice | undefined,
  appError: string | undefined,
  run: ChatActiveRun | undefined,
  assistantTurn: ChatActiveConversationTurn | undefined
): boolean {
  if (problem === undefined) return false;
  if (appError !== undefined) return true;
  if (assistantTurn === undefined) return true;
  if (run?.status === "failed" && assistantTurn.status !== "failed") return true;
  return run?.status === "blocked" || run?.status === "paused";
}
