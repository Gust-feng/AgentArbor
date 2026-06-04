import { appendLiveRunEvents } from "../../panel-ui-live-run-buffer.js";
import { createRunReadModelPatch } from "./app-run-projection.js";
import { shouldKeepRefreshing } from "./app-runtime-controls.js";
import type { AppState } from "./app-state";
import type { BasicAgentRun, RunEvent } from "./contracts/run";
import type { Conversation } from "./contracts/conversation";
import {
  safeBasicEvents,
  safeBasicRun,
  safeConversation,
  safeDesktopDetail,
  safeWorkSession,
} from "./runtime.js";

export type FollowUpActiveRunProjection = {
  readonly conversation?: Conversation;
  readonly run?: BasicAgentRun;
  readonly replay?: {
    readonly events: readonly RunEvent[];
    readonly cursor: {
      readonly lastSequence: number;
    };
  };
  readonly workSession?: Awaited<ReturnType<typeof safeWorkSession>>;
  readonly detail?: Awaited<ReturnType<typeof safeDesktopDetail>>;
};

export type SettledRunProjection = {
  readonly runId: string;
  readonly run: BasicAgentRun;
  readonly workSession?: Awaited<ReturnType<typeof safeWorkSession>>;
  readonly detail?: Awaited<ReturnType<typeof safeDesktopDetail>>;
  readonly conversation?: Conversation;
  readonly followUp: FollowUpActiveRunProjection;
};

export async function loadSettledRunProjection(input: {
  readonly runId: string;
  readonly run: BasicAgentRun;
  readonly workSession?: Awaited<ReturnType<typeof safeWorkSession>>;
}): Promise<SettledRunProjection> {
  const [detail, conversation] = await Promise.all([
    safeDesktopDetail(input.runId),
    input.run.conversationId === undefined ? undefined : safeConversation(input.run.conversationId),
  ]);
  return {
    runId: input.runId,
    run: input.run,
    workSession: input.workSession,
    detail,
    conversation,
    followUp: await loadFollowUpActiveRunProjection(conversation, input.runId),
  };
}

export function appStateWithSettledRunProjection(
  previous: AppState,
  settled: SettledRunProjection
): AppState {
  if (settled.followUp.run !== undefined) {
    return appStateWithFollowUpActiveRun(previous, settled.followUp);
  }
  const readModel = createRunReadModelPatch(previous, {
    runId: settled.runId,
    workSession: settled.workSession,
    detail: settled.detail,
  });
  return {
    ...previous,
    conversation: settled.conversation ?? previous.conversation,
    live: undefined,
    ...readModel,
  };
}

export function refreshingFollowUpRun(
  settled: SettledRunProjection
): { readonly runId: string; readonly cursor: number } | undefined {
  const followUp = settled.followUp;
  if (followUp.run === undefined || !shouldKeepRefreshing(followUp.run.status)) {
    return undefined;
  }
  return {
    runId: followUp.run.runId,
    cursor: followUp.replay?.cursor.lastSequence ?? 0,
  };
}

async function loadFollowUpActiveRunProjection(
  conversation: Conversation | undefined,
  completedRunId: string
): Promise<FollowUpActiveRunProjection> {
  const runId = followUpActiveRunId(conversation, completedRunId);
  if (runId === undefined) {
    return { conversation };
  }
  const [run, replay, workSession, detail] = await Promise.all([
    safeBasicRun(runId),
    safeBasicEvents(runId, 0),
    safeWorkSession(runId),
    safeDesktopDetail(runId),
  ]);
  return { conversation, run, replay, workSession, detail };
}

function appStateWithFollowUpActiveRun(
  previous: AppState,
  followUp: FollowUpActiveRunProjection
): AppState {
  if (followUp.run === undefined) {
    return previous;
  }
  const readModel = createRunReadModelPatch(previous, {
    runId: followUp.run.runId,
    workSession: followUp.workSession,
    detail: followUp.detail,
  });
  return {
    ...previous,
    conversation: followUp.conversation ?? previous.conversation,
    run: followUp.run,
    events: followUp.replay?.events ?? [],
    live: shouldKeepRefreshing(followUp.run.status)
      ? appendLiveRunEvents(followUp.run.runId, undefined, followUp.replay?.events ?? [])
      : undefined,
    ...readModel,
  };
}

function followUpActiveRunId(
  conversation: Conversation | undefined,
  completedRunId: string
): string | undefined {
  const activeRunId = conversation?.activeRunId;
  if (activeRunId === undefined || activeRunId === completedRunId) {
    return undefined;
  }
  return activeRunId;
}
