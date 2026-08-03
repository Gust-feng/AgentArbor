import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInitialAppState, type AppState } from "./app-state";
import { createAppRunController } from "./app-run-controller";
import { createAppSidebarConversationController } from "./app-sidebar-conversation-controller";
import type { ContextAttachment } from "./contracts/context";
import type { BasicAgentRun, BasicAgentRunView } from "./contracts/run";

const statisticsMocks = vi.hoisted(() => ({
  invalidateUsageStatistics: vi.fn(),
}));

vi.mock("./usage-statistics-query", () => ({
  invalidateUsageStatistics: statisticsMocks.invalidateUsageStatistics,
}));

describe("ordinary run cancellation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    statisticsMocks.invalidateUsageStatistics.mockReset();
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
      fallbackPollRef: { current: undefined },
      activeRunIdRef: { current: running.runId },
      viewEpochRef: { current: 1 },
      submissionAttemptRef: { current: undefined },
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
      expect(statisticsMocks.invalidateUsageStatistics).toHaveBeenCalledOnce();
    });
  });
});

describe("sidebar conversation mutations", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("deletes inactive history without resetting the active conversation", async () => {
    let app: AppState = {
      ...createInitialAppState(),
      conversation: conversation(runView(run("completed"))),
      conversations: [
        { conversationId: "conversation-1", title: "Active" },
        { conversationId: "conversation-history", title: "History" },
      ],
    };
    const resetChat = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      conversations: [{ conversationId: "conversation-1", title: "Active" }],
    })));
    const controller = sidebarController(() => app, (next) => { app = next; }, resetChat);

    await controller.deleteConversation("conversation-history");

    expect(resetChat).not.toHaveBeenCalled();
    expect(app.conversation?.conversationId).toBe("conversation-1");
    expect(app.conversations.map((item) => item.conversationId)).toEqual(["conversation-1"]);
  });

  it("does not reset a newer active conversation when an earlier delete finishes late", async () => {
    let app: AppState = {
      ...createInitialAppState(),
      conversation: conversation(runView(run("completed"))),
      conversations: [{ conversationId: "conversation-1", title: "Deleting" }],
    };
    let resolveDelete!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { resolveDelete = resolve; })));
    const resetChat = vi.fn();
    const controller = sidebarController(() => app, (next) => { app = next; }, resetChat);

    const deleting = controller.deleteConversation("conversation-1");
    app = {
      ...app,
      conversation: { ...conversation(runView(run("completed"))), conversationId: "conversation-2", title: "Current" },
      conversations: [{ conversationId: "conversation-2", title: "Current" }],
    };
    resolveDelete(jsonResponse({ conversations: [{ conversationId: "conversation-2", title: "Current" }] }));
    await deleting;

    expect(resetChat).not.toHaveBeenCalled();
    expect(app.conversation?.conversationId).toBe("conversation-2");
  });

  it("deduplicates concurrent mutations for one conversation and clears pending state", async () => {
    let app: AppState = {
      ...createInitialAppState(),
      conversations: [{ conversationId: "conversation-1", title: "Before" }],
    };
    let resolveRequest!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolveRequest = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const pendingRef = { current: new Set<string>() };
    let pending: ReadonlySet<string> = new Set();
    const controller = sidebarController(
      () => app,
      (next) => { app = next; },
      vi.fn(),
      pendingRef,
      (next) => { pending = next; },
    );

    const first = controller.renameConversation("conversation-1", "After");
    const duplicate = controller.renameConversation("conversation-1", "Duplicate");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(pending.has("conversation-1")).toBe(true);

    resolveRequest(jsonResponse({
      conversation: { conversationId: "conversation-1", title: "After", turns: [] },
    }));
    await Promise.all([first, duplicate]);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(pending.size).toBe(0);
    expect(app.conversations[0]?.title).toBe("After");
  });
});

describe("conversation switching", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps a stale first load from winning after a second conversation is opened", async () => {
    const requests: Array<{ path: string; signal?: AbortSignal | null; resolve: (response: Response) => void }> = [];
    vi.stubGlobal("fetch", vi.fn((path: string | URL | Request, init?: RequestInit) => new Promise<Response>((resolve) => {
      requests.push({ path: String(path), signal: init?.signal, resolve });
    })));
    let app = createInitialAppState();
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
      streamRef: { current: undefined },
      fallbackPollRef: { current: undefined },
      activeRunIdRef: { current: undefined },
      viewEpochRef: { current: 0 },
      submissionAttemptRef: { current: undefined },
      conversationLoadAbortRef: { current: undefined },
      setCancellingRunId: () => undefined,
    });

    const first = controller.loadConversation("conversation-first");
    const second = controller.loadConversation("conversation-second");
    expect(requests[0]?.signal?.aborted).toBe(true);
    requests[0]?.resolve(jsonResponse({ conversation: emptyConversation("conversation-first") }));
    requests[1]?.resolve(jsonResponse({ conversation: emptyConversation("conversation-second") }));

    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(true);
    expect(app.conversation?.conversationId).toBe("conversation-second");
  });
});

describe("new conversation submission", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a new conversation even when a completed conversation is still projected", async () => {
    const completed = run("completed");
    const freshRun = {
      ...completed,
      runId: "run-new",
      conversationId: "conversation-new",
      title: "Fresh run",
      goalSummary: "Fresh goal",
    };
    const freshConversation = {
      ...conversation(runView(freshRun)),
      conversationId: "conversation-new",
      title: "Fresh goal",
      latestRunId: freshRun.runId,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/conversations" && init?.method === "POST") {
        return jsonResponse({ conversation: freshConversation, run: freshRun });
      }
      if (path === "/api/conversations/conversation-new") {
        return jsonResponse({ conversation: freshConversation });
      }
      if (path === "/api/conversations") {
        return jsonResponse({ conversations: [{ conversationId: "conversation-new", title: "Fresh goal" }] });
      }
      return jsonResponse({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    let app: AppState = {
      ...createInitialAppState(),
      conversation: conversation(runView(completed)),
      run: completed,
      workView: runView(completed).workView,
    };
    let goal = "Fresh goal";
    let attachments: readonly ContextAttachment[] = [];
    let screen: "chat-empty" | "chat-active" = "chat-empty";
    const activeRunIdRef = { current: completed.runId as string | undefined };
    const controller = submissionController({
      readApp: () => app,
      writeApp: (next) => { app = next; },
      readGoal: () => goal,
      writeGoal: (next) => { goal = next; },
      readAttachments: () => attachments,
      writeAttachments: (next) => { attachments = next; },
      writeScreen: (next) => { screen = next; },
      activeRunIdRef,
    });

    await expect(controller.startNewConversation()).resolves.toBe(true);

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/conversations");
    expect(fetchMock.mock.calls.some(([path]) => String(path).includes("conversation-1/messages"))).toBe(false);
    expect(app.conversation?.conversationId).toBe("conversation-new");
    expect(app.run?.runId).toBe("run-new");
    expect(activeRunIdRef.current).toBe("run-new");
    expect(goal).toBe("");
    expect(screen).toBe("chat-active");
  });

  it("keeps a failed fresh submission on an empty entry and restores its input", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network unavailable");
    }));
    const completed = run("completed");
    let app: AppState = {
      ...createInitialAppState(),
      conversation: conversation(runView(completed)),
      run: completed,
      workView: runView(completed).workView,
    };
    let goal = "Retry this";
    let attachments: readonly ContextAttachment[] = [{
      attachmentId: "attachment-1",
      kind: "file",
      ref: "C:\\notes.md",
      title: "notes.md",
      summary: "Local note",
      permissionRefs: [],
      readonlyPreviewMeta: { available: false },
      status: "ready",
    }];
    let screen: "chat-empty" | "chat-active" = "chat-empty";
    const controller = submissionController({
      readApp: () => app,
      writeApp: (next) => { app = next; },
      readGoal: () => goal,
      writeGoal: (next) => { goal = next; },
      readAttachments: () => attachments,
      writeAttachments: (next) => { attachments = next; },
      writeScreen: (next) => { screen = next; },
      activeRunIdRef: { current: completed.runId },
    });

    await expect(controller.startNewConversation()).resolves.toBe(false);

    expect(app.conversation).toBeUndefined();
    expect(app.run).toBeUndefined();
    expect(app.workView).toBeUndefined();
    expect(app.error).toBe("network unavailable");
    expect(goal).toBe("Retry this");
    expect(attachments.map((attachment) => attachment.attachmentId)).toEqual(["attachment-1"]);
    expect(screen).toBe("chat-empty");
  });

  it("reuses the submission identity when the create response is lost", async () => {
    const completed = run("completed");
    const freshRun = {
      ...completed,
      runId: "run-retry",
      conversationId: "conversation-retry",
      title: "Retry run",
      goalSummary: "Retry goal",
    };
    const freshConversation = {
      ...conversation(runView(freshRun)),
      conversationId: "conversation-retry",
      title: "Retry goal",
      latestRunId: freshRun.runId,
    };
    let submissionPosts = 0;
    const submissionIds: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/conversations" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { readonly submissionId: string };
        submissionIds.push(body.submissionId);
        submissionPosts += 1;
        if (submissionPosts === 1) throw new Error("response lost");
        return jsonResponse({ conversation: freshConversation, run: freshRun });
      }
      if (path === "/api/conversations/conversation-retry") {
        return jsonResponse({ conversation: freshConversation });
      }
      if (path === "/api/conversations") {
        return jsonResponse({ conversations: [{ conversationId: "conversation-retry", title: "Retry goal" }] });
      }
      return jsonResponse({}, 404);
    }));
    let app: AppState = {
      ...createInitialAppState(),
      conversation: conversation(runView(completed)),
      run: completed,
      workView: runView(completed).workView,
    };
    let goal = "Retry goal";
    let attachments: readonly ContextAttachment[] = [];
    let screen: "chat-empty" | "chat-active" = "chat-empty";
    const submissionAttemptRef = { current: undefined as { readonly key: string; readonly id: string } | undefined };
    const controller = submissionController({
      readApp: () => app,
      writeApp: (next) => { app = next; },
      readGoal: () => goal,
      writeGoal: (next) => { goal = next; },
      readAttachments: () => attachments,
      writeAttachments: (next) => { attachments = next; },
      writeScreen: (next) => { screen = next; },
      activeRunIdRef: { current: completed.runId },
      submissionAttemptRef,
    });

    await expect(controller.startNewConversation()).resolves.toBe(false);
    await expect(controller.startNewConversation()).resolves.toBe(true);

    expect(submissionIds).toHaveLength(2);
    expect(submissionIds[1]).toBe(submissionIds[0]);
    expect(submissionAttemptRef.current).toBeUndefined();
    expect(app.conversation?.conversationId).toBe("conversation-retry");
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

function sidebarController(
  readApp: () => AppState,
  writeApp: (app: AppState) => void,
  resetChat: () => void,
  mutationConversationIdsRef = { current: new Set<string>() },
  writePending: (pending: ReadonlySet<string>) => void = () => undefined,
) {
  return createAppSidebarConversationController({
    app: readApp(),
    appRef: {
      get current() { return readApp(); },
      set current(value: AppState) { writeApp(value); },
    },
    setApp: dispatch(writeApp, readApp),
    mountedRef: { current: true },
    mutationConversationIdsRef,
    setMutationConversationIds: dispatch(writePending),
    resetChat,
    setSelectedWorkspaceDirectory: () => undefined,
    setInputCloseSignal: () => undefined,
    setGoal: () => undefined,
    setAttachments: () => undefined,
    setScreen: () => undefined,
  });
}

function submissionController(input: {
  readonly readApp: () => AppState;
  readonly writeApp: (app: AppState) => void;
  readonly readGoal: () => string;
  readonly writeGoal: (goal: string) => void;
  readonly readAttachments: () => readonly ContextAttachment[];
  readonly writeAttachments: (attachments: readonly ContextAttachment[]) => void;
  readonly writeScreen: (screen: "chat-empty" | "chat-active") => void;
  readonly activeRunIdRef: React.MutableRefObject<string | undefined>;
  readonly submissionAttemptRef?: React.MutableRefObject<{ readonly key: string; readonly id: string } | undefined>;
}) {
  return createAppRunController({
    app: input.readApp(),
    setApp: dispatch(input.writeApp, input.readApp),
    setScreen: input.writeScreen,
    setGoal: input.writeGoal,
    attachments: input.readAttachments(),
    setAttachments: dispatch(input.writeAttachments, input.readAttachments),
    goal: input.readGoal(),
    aiMode: "openai-responses",
    composerReasoningEffort: "",
    toolConfirmationPolicy: "full_access",
    selectedModelId: "model-1",
    selectedModelSupportsReasoningEffort: false,
    confirmationBusy: false,
    setConfirmationBusy: () => undefined,
    mountedRef: { current: true },
    pollTimer: { current: undefined },
    streamRef: { current: undefined },
    fallbackPollRef: { current: undefined },
    activeRunIdRef: input.activeRunIdRef,
    viewEpochRef: { current: 0 },
    submissionAttemptRef: input.submissionAttemptRef ?? { current: undefined },
    conversationLoadAbortRef: { current: undefined },
    setCancellingRunId: () => undefined,
  });
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

function emptyConversation(conversationId: string) {
  return { conversationId, title: conversationId, turns: [] };
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
