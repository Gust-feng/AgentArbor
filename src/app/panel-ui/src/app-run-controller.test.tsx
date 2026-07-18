import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInitialAppState, type AppState } from "./app-state";
import { createAppRunController } from "./app-run-controller";
import type { BasicAgentRun, BasicAgentRunView } from "./contracts/run";

describe("ordinary run cancellation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("settles local interaction before the command returns and consumes the durable cancelled run without notices", async () => {
    const running = run("running");
    const cancelled = run("cancelled");
    const cancelledView = runView(cancelled);
    let app: AppState = {
      ...createInitialAppState(),
      conversation: conversation(cancelledView),
      run: running,
      workView: runView(running).workView,
    };
    let cancellingRunId: string | undefined;
    const streamClose = vi.fn();
    const stream: Partial<EventSource> = { close: streamClose };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(`/api/basic-agent/runs/${running.runId}/cancel`)) {
        return jsonResponse({ ok: true, run: cancelled });
      }
      if (url.endsWith(`/api/basic-agent/runs/${running.runId}/view`)) {
        return jsonResponse({ ok: true, view: cancelledView });
      }
      if (url.endsWith("/api/conversations/conversation-1")) {
        return jsonResponse({ ok: true, conversation: conversation(cancelledView) });
      }
      if (url.endsWith("/api/conversations")) {
        return jsonResponse({ conversations: [] });
      }
      return jsonResponse({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const controller = createAppRunController({
      app,
      setApp: dispatch((next) => { app = next; }, () => app),
      setScreen: () => undefined,
      setGoal: () => undefined,
      attachments: [],
      setAttachments: () => undefined,
      goal: "",
      aiMode: "openai-responses",
      composerReasoningEffort: "",
      toolConfirmationPolicy: "full_access",
      selectedModelId: "model-1",
      selectedModelSupportsReasoningEffort: false,
      confirmationBusy: false,
      setConfirmationBusy: () => undefined,
      mountedRef: { current: true },
      pollTimer: { current: undefined },
      streamRef: { current: stream as EventSource },
      activeRunIdRef: { current: running.runId },
      viewEpochRef: { current: 1 },
      conversationLoadAbortRef: { current: undefined },
      setCancellingRunId: dispatch<string | undefined>(
        (next) => { cancellingRunId = next; },
        () => cancellingRunId,
      ),
    });

    const cancelling = controller.cancelRun();
    expect(cancellingRunId).toBe(running.runId);
    expect(streamClose).toHaveBeenCalledOnce();

    await cancelling;
    expect(cancellingRunId).toBeUndefined();
    expect(app.run).toEqual(cancelled);
    expect(app.error).toBeUndefined();
    await vi.waitFor(() => {
      expect(app.workView?.stage).toBe("cancelled");
      expect(app.conversation?.turns[1]?.interruption).toBe("user_cancelled");
    });
  });
});

function dispatch<T>(
  write: (value: T) => void,
  read?: () => T | undefined,
): React.Dispatch<React.SetStateAction<T>> {
  return (action) => {
    const current = read?.();
    const next = typeof action === "function"
      ? (action as (previous: T) => T)(current as T)
      : action;
    write(next);
  };
}

function runView(value: BasicAgentRun): BasicAgentRunView {
  return {
    run: value,
    workView: {
      run: value,
      stage: value.status === "cancelled" ? "cancelled" : "understanding",
      headline: "",
      currentAction: "",
      contextAttachments: [],
      visibleEvents: [],
      transcriptNodes: [],
      workSummary: {
        summary: "",
        pendingActionCount: 0,
        toolResultCount: 0,
        contextAttachmentCount: 0,
      },
    },
    detail: {
      runId: value.runId,
      status: value.status,
      toolResults: [],
      usage: {},
    },
    replay: {
      reset: false,
      events: [],
      cursor: { token: "cursor", lastSequence: value.eventCursor.lastSequence },
    },
  };
}

function conversation(currentRun: BasicAgentRunView) {
  return {
    conversationId: "conversation-1",
    title: "Conversation",
    latestRunId: currentRun.run.runId,
    currentRun,
    turns: [{
      turnId: "user-1",
      role: "user" as const,
      content: "Wait for cancellation",
      status: "completed",
      runId: currentRun.run.runId,
    }, {
      turnId: "assistant-1",
      role: "assistant" as const,
      content: "partial response",
      status: currentRun.run.status,
      interruption: currentRun.run.status === "cancelled" ? "user_cancelled" as const : undefined,
      runId: currentRun.run.runId,
    }],
  };
}

function run(status: BasicAgentRun["status"]): BasicAgentRun {
  return {
    runId: "run-cancel",
    conversationId: "conversation-1",
    title: "Run",
    goalSummary: "Wait for cancellation",
    status,
    runMode: "agent",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    requiresUserAction: false,
    eventCursor: { lastSequence: 3, eventCount: 3 },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
