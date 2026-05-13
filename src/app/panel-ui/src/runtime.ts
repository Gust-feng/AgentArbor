import { getJson } from "./api";
import type { BasicAgentRun, Conversation, DesktopRunDetail, DesktopWorkSession, RunEvent, ToolDisplayProjection } from "./types";

export function mergeEvents(previous: readonly RunEvent[], incoming: readonly RunEvent[]): readonly RunEvent[] {
  const byId = new Map<string, RunEvent>();
  for (const event of previous) byId.set(event.id, event);
  for (const event of incoming) byId.set(event.id, event);
  return [...byId.values()].sort((left, right) => left.sequence - right.sequence);
}

export async function safeBasicRun(runId: string): Promise<BasicAgentRun | undefined> {
  try {
    return (await getJson<{ readonly run: BasicAgentRun }>(`/api/basic-agent/runs/${encodeURIComponent(runId)}`)).run;
  } catch {
    return undefined;
  }
}

export async function safeBasicEvents(runId: string, cursor: number): Promise<{ readonly events: readonly RunEvent[] } | undefined> {
  try {
    return await getJson<{ readonly events: readonly RunEvent[] }>(`/api/basic-agent/runs/${encodeURIComponent(runId)}/events?cursor=${cursor}`);
  } catch {
    return undefined;
  }
}

export async function safeDesktopDetail(runId: string): Promise<DesktopRunDetail | undefined> {
  try {
    return await getJson<DesktopRunDetail>(`/api/desktop/runs/${encodeURIComponent(runId)}`);
  } catch {
    return undefined;
  }
}

export async function safeWorkSession(runId: string): Promise<DesktopWorkSession | undefined> {
  try {
    return (await getJson<{ readonly workSession: DesktopWorkSession }>(`/api/basic-agent/runs/${encodeURIComponent(runId)}/work-session`)).workSession;
  } catch {
    return undefined;
  }
}

export async function safeConversation(conversationId: string): Promise<Conversation | undefined> {
  try {
    return (await getJson<{ readonly conversation: Conversation }>(`/api/conversations/${encodeURIComponent(conversationId)}`)).conversation;
  } catch {
    return undefined;
  }
}

export function typedToolDisplays(detail: DesktopRunDetail | undefined): readonly ToolDisplayProjection[] {
  const events = detail?.transcript?.events ?? [];
  return events
    .map((event) => event.detail?.display)
    .filter((display): display is ToolDisplayProjection => display !== undefined);
}
