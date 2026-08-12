import { describe, expect, test } from "vitest";

import { selectConversationRun } from "./use-conversation-controller";

const conversation = {
  conversationId: "conversation-1",
  title: "移动协同",
  updatedAt: "2026-08-03T00:00:00.000Z",
  status: "completed" as const,
};

const completedRun = {
  kind: "run.snapshot" as const,
  eventId: "run-completed-event",
  runId: "run-completed",
  conversationId: "conversation-1",
  status: "completed" as const,
  pendingConfirmations: [],
  updatedAt: "2026-08-03T00:00:00.000Z",
};

describe("Conversation run selection", () => {
  test("does not fall back to a completed historical run", () => {
    expect(selectConversationRun(conversation, [completedRun])).toBeUndefined();
  });

  test("uses the explicit active run even when another run is newer in the cache", () => {
    const active = {
      ...completedRun,
      eventId: "run-active-event",
      runId: "run-active",
      status: "running" as const,
    };
    expect(selectConversationRun({ ...conversation, activeRunId: "run-active" }, [completedRun, active])).toBe(active);
  });

  test("only uses the compatibility fallback for one live candidate", () => {
    const active = {
      ...completedRun,
      eventId: "run-active-event",
      runId: "run-active",
      status: "running" as const,
    };
    expect(selectConversationRun(conversation, [completedRun, active])).toBe(active);
    expect(selectConversationRun(conversation, [active, { ...active, runId: "run-other" }])).toBeUndefined();
  });
});
