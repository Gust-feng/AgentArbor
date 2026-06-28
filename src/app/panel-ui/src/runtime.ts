import { getJson } from "./api";
import type { Conversation } from "./contracts/conversation";
import type { DeepStreamEvent } from "./contracts/deep";
import type { BasicAgentRunView, DesktopRunDetail, DesktopWorkView, RunEvent } from "./contracts/run";
import type { ToolDisplayProjection } from "./contracts/tools";

const BASIC_RUN_EVENT_TYPES = [
  "run.started",
  "run.resumed",
  "run.blocked",
  "run.cancelled",
  "run.failed",
  "final.result",
  "tool.requested",
  "tool.completed",
  "tool.failed",
  "confirmation.needed",
  "user_approval.received",
  "user.guidance",
  "agent.note.delta",
  "agent.note.completed",
  "model.reasoning.delta",
  "model.reasoning.completed",
  "model.output.delta",
  "model.output.completed",
  "model.side.completed",
  "model.failed",
  "context.compaction.completed",
  "context.compaction.failed",
] as const;

const DEEP_RUN_EVENT_TYPES = [
  "deep.goal_received",
  "deep.manager.decided",
  "deep.child.started",
  "deep.child.waiting",
  "deep.child.instruction_queued",
  "deep.child.completed",
  "deep.child.blocked",
  "deep.child.interrupted",
  "deep.child.failed",
  "deep.parent_synthesis.completed",
  "deep.interrupted",
  "deep.corrected",
  "deep.stopped",
  "deep.conclusion.produced",
] as const;

export async function safeBasicRunView(
  runId: string,
  cursor = 0,
  init?: RequestInit
): Promise<BasicAgentRunView | undefined> {
  try {
    return (await getJson<{ readonly view: BasicAgentRunView }>(
      `/api/basic-agent/runs/${encodeURIComponent(runId)}/view?cursor=${cursor}`,
      init
    )).view;
  } catch {
    return undefined;
  }
}

export async function safeConversation(conversationId: string, init?: RequestInit): Promise<Conversation | undefined> {
  try {
    return (await getJson<{ readonly conversation: Conversation }>(
      `/api/conversations/${encodeURIComponent(conversationId)}`,
      init
    )).conversation;
  } catch {
    return undefined;
  }
}

export function ordinaryWorkViewFromRunView(
  view: {
    readonly workView?: DesktopWorkView;
  } | undefined
): DesktopWorkView | undefined {
  return view?.workView;
}

export function openBasicRunStream(input: {
  readonly runId: string;
  readonly cursor: number;
  readonly onEvent: (event: RunEvent) => void;
  readonly onError: () => void;
}): EventSource | undefined {
  if (typeof EventSource === "undefined") {
    return undefined;
  }
  const stream = new EventSource(`/api/basic-agent/runs/${encodeURIComponent(input.runId)}/stream?cursor=${input.cursor}`);
  const handle = (message: MessageEvent<string>): void => {
    try {
      input.onEvent(JSON.parse(message.data) as RunEvent);
    } catch {
      input.onError();
    }
  };
  for (const type of BASIC_RUN_EVENT_TYPES) {
    stream.addEventListener(type, handle as EventListener);
  }
  stream.onerror = () => {
    stream.close();
    input.onError();
  };
  return stream;
}

export function openDeepRunStream(input: {
  readonly runId: string;
  readonly cursor: number;
  readonly onEvent: (event: DeepStreamEvent) => void;
  readonly onError: () => void;
}): EventSource | undefined {
  if (typeof EventSource === "undefined") {
    return undefined;
  }
  const stream = new EventSource(`/api/deep/runs/${encodeURIComponent(input.runId)}/events?cursor=${input.cursor}`);
  const handle = (message: MessageEvent<string>): void => {
    try {
      input.onEvent(JSON.parse(message.data) as DeepStreamEvent);
    } catch {
      input.onError();
    }
  };
  for (const type of DEEP_RUN_EVENT_TYPES) {
    stream.addEventListener(type, handle as EventListener);
  }
  stream.onerror = () => {
    stream.close();
    input.onError();
  };
  return stream;
}

export function typedToolDisplays(detail: DesktopRunDetail | undefined): readonly ToolDisplayProjection[] {
  const events = detail?.transcript?.events ?? [];
  return events
    .map((event) => event.detail?.display)
    .filter((display): display is ToolDisplayProjection => display !== undefined);
}
