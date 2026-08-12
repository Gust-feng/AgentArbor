import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLiveRunUpdateController } from "./app-live-run-updates";
import { projectCurrentRun } from "./app-run-projection";
import { createInitialAppState, type AppState } from "./app-state";
import type { BasicAgentRunView, RunEvent } from "./contracts/run";

const runtimeMocks = vi.hoisted(() => ({
  safeBasicRunView: vi.fn(),
  safeConversation: vi.fn(),
  streamInput: undefined as unknown,
  stream: { close: vi.fn() },
}));

vi.mock("./runtime", () => ({
  safeBasicRunView: runtimeMocks.safeBasicRunView,
  safeConversation: runtimeMocks.safeConversation,
  ordinaryWorkViewFromRunView: (view: BasicAgentRunView | undefined) => view?.workView,
  openBasicRunStream: (input: unknown) => {
    runtimeMocks.streamInput = input;
    return runtimeMocks.stream;
  },
}));

describe("live Ordinary run updates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    runtimeMocks.safeBasicRunView.mockReset();
    runtimeMocks.safeBasicRunView.mockResolvedValue(runningView("cursor-1"));
    runtimeMocks.safeConversation.mockReset();
    runtimeMocks.safeConversation.mockResolvedValue(undefined);
    runtimeMocks.stream.close.mockReset();
    runtimeMocks.streamInput = undefined;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("serializes fallback polls and ignores an aborted response after polling restarts", async () => {
    const requests: Array<{
      readonly signal: AbortSignal | undefined;
      readonly resolve: (view: BasicAgentRunView) => void;
    }> = [];
    runtimeMocks.safeBasicRunView.mockImplementation((
      _runId: string,
      _cursor: string | undefined,
      init?: RequestInit,
    ) => init?.signal === undefined
      ? Promise.resolve(completedView("cursor-settled"))
      : new Promise<BasicAgentRunView>((resolve) => {
          requests.push({ signal: init.signal ?? undefined, resolve });
        }));
    let state: AppState = {
      ...createInitialAppState(),
      conversation: { conversationId: "conversation-1" } as AppState["conversation"],
      run: { runId: "run-1", status: "running" } as AppState["run"],
    };
    const fallbackPollRef = { current: undefined as AbortController | undefined };
    const controller = createLiveRunUpdateController({
      setApp: ((next) => {
        state = typeof next === "function" ? next(state) : next;
      }) as React.Dispatch<React.SetStateAction<AppState>>,
      mountedRef: { current: true },
      pollTimer: { current: undefined },
      streamRef: { current: undefined },
      fallbackPollRef,
      activeRunIdRef: { current: "run-1" },
      viewEpochRef: { current: 1 },
      refreshConversations: async () => undefined,
    });
    const subscription = {
      runId: "run-1",
      conversationId: "conversation-1",
      epoch: 1,
    } as const;

    controller.startPolling(subscription);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(3_600);
    expect(requests).toHaveLength(1);

    controller.startPolling({ ...subscription, cursor: "cursor-restart" });
    await flushPromises();
    expect(requests).toHaveLength(2);
    expect(requests[0]?.signal?.aborted).toBe(true);

    requests[1]?.resolve(completedView("cursor-terminal"));
    await flushPromises();
    expect(state.run?.status).toBe("completed");

    requests[0]?.resolve(runningView("cursor-stale"));
    await flushPromises();
    expect(state.run?.status).toBe("completed");
    expect(state.error).toBeUndefined();
  });

  it("keeps low-frequency reconciliation after the first SSE event and falls back when heartbeats stop", async () => {
    let state: AppState = {
      ...createInitialAppState(),
      conversation: { conversationId: "conversation-1" } as AppState["conversation"],
    };
    const pollTimer = { current: undefined as number | undefined };
    const streamRef = { current: undefined as EventSource | undefined };
    const controller = createLiveRunUpdateController({
      setApp: ((next) => {
        state = typeof next === "function" ? next(state) : next;
      }) as React.Dispatch<React.SetStateAction<AppState>>,
      mountedRef: { current: true },
      pollTimer,
      streamRef,
      fallbackPollRef: { current: undefined },
      activeRunIdRef: { current: "run-1" },
      viewEpochRef: { current: 1 },
      refreshConversations: async () => undefined,
    });

    controller.startLiveUpdates({
      runId: "run-1",
      conversationId: "conversation-1",
      epoch: 1,
    });
    await flushPromises();

    const stream = runtimeMocks.streamInput as {
      readonly onEvent: (event: RunEvent, cursor: string) => void;
      readonly onHeartbeat: () => void;
    };
    stream.onEvent(runEvent("tool.requested", 2), "cursor-2");
    await flushPromises();
    runtimeMocks.safeBasicRunView.mockClear();

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await vi.advanceTimersByTimeAsync(4_000);
      stream.onHeartbeat();
      await flushPromises();
    }

    expect(runtimeMocks.safeBasicRunView.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(runtimeMocks.stream.close).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(16_000);
    await flushPromises();
    expect(runtimeMocks.stream.close).toHaveBeenCalledTimes(1);
  });

  it("reconciles from the cursor delivered with an append-only SSE event", async () => {
    let state: AppState = {
      ...createInitialAppState(),
      conversation: { conversationId: "conversation-1" } as AppState["conversation"],
    };
    const controller = createLiveRunUpdateController({
      setApp: ((next) => {
        state = typeof next === "function" ? next(state) : next;
      }) as React.Dispatch<React.SetStateAction<AppState>>,
      mountedRef: { current: true },
      pollTimer: { current: undefined },
      streamRef: { current: undefined },
      fallbackPollRef: { current: undefined },
      activeRunIdRef: { current: "run-1" },
      viewEpochRef: { current: 1 },
      refreshConversations: async () => undefined,
    });

    controller.startLiveUpdates({
      runId: "run-1",
      conversationId: "conversation-1",
      epoch: 1,
    });
    await flushPromises();
    runtimeMocks.safeBasicRunView.mockClear();

    const stream = runtimeMocks.streamInput as {
      readonly onEvent: (event: RunEvent, cursor: string) => void;
    };
    stream.onEvent(runEvent("model.output.delta", 5, "完整流式正文"), "cursor-5");
    await flushPromises();
    await vi.advanceTimersByTimeAsync(4_000);
    await flushPromises();

    expect(runtimeMocks.safeBasicRunView).toHaveBeenCalledWith("run-1", "cursor-5");
  });

  it("ignores an in-flight bootstrap replay after SSE takes ownership", async () => {
    let resolveBootstrap: ((view: BasicAgentRunView) => void) | undefined;
    runtimeMocks.safeBasicRunView.mockImplementationOnce(() => new Promise<BasicAgentRunView>((resolve) => {
      resolveBootstrap = resolve;
    }));
    let state: AppState = {
      ...createInitialAppState(),
      conversation: { conversationId: "conversation-1" } as AppState["conversation"],
      run: { runId: "run-1", status: "running" } as AppState["run"],
    };
    const controller = createLiveRunUpdateController({
      setApp: ((next) => {
        state = typeof next === "function" ? next(state) : next;
      }) as React.Dispatch<React.SetStateAction<AppState>>,
      mountedRef: { current: true },
      pollTimer: { current: undefined },
      streamRef: { current: undefined },
      fallbackPollRef: { current: undefined },
      activeRunIdRef: { current: "run-1" },
      viewEpochRef: { current: 1 },
      refreshConversations: async () => undefined,
    });

    controller.startLiveUpdates({
      runId: "run-1",
      conversationId: "conversation-1",
      epoch: 1,
    });
    await flushPromises();
    const stream = runtimeMocks.streamInput as {
      readonly onEvent: (event: RunEvent, cursor: string) => void;
    };
    stream.onEvent(runEvent("model.output.delta", 5, "ABC"), "cursor-5");
    stream.onEvent(runEvent("model.output.completed", 6), "cursor-6");
    await flushPromises();
    expect(state.live?.turns[0]?.output.text).toBe("ABC");

    resolveBootstrap?.(runningView("cursor-5", [
      runEvent("model.output.delta", 3, "A"),
      runEvent("model.output.delta", 4, "B"),
      runEvent("model.output.delta", 5, "C"),
    ]));
    await flushPromises();

    expect(state.live?.turns[0]?.output.text).toBe("ABC");
  });

  it("commits a terminal run and its settled reasoning projection in one state transition", async () => {
    let state: AppState = {
      ...createInitialAppState(),
      conversation: { conversationId: "conversation-1" } as AppState["conversation"],
      run: { runId: "run-1", status: "running" } as AppState["run"],
    };
    const snapshots: AppState[] = [];
    const controller = createLiveRunUpdateController({
      setApp: ((next) => {
        state = typeof next === "function" ? next(state) : next;
        snapshots.push(state);
      }) as React.Dispatch<React.SetStateAction<AppState>>,
      mountedRef: { current: true },
      pollTimer: { current: undefined },
      streamRef: { current: undefined },
      fallbackPollRef: { current: undefined },
      activeRunIdRef: { current: "run-1" },
      viewEpochRef: { current: 1 },
      refreshConversations: async () => undefined,
    });

    controller.startLiveUpdates({
      runId: "run-1",
      conversationId: "conversation-1",
      epoch: 1,
    });
    await flushPromises();

    const settled = completedView("cursor-3");
    runtimeMocks.safeBasicRunView.mockReset();
    runtimeMocks.safeBasicRunView.mockResolvedValue(settled);
    runtimeMocks.safeConversation.mockResolvedValue({
      conversationId: "conversation-1",
      latestRunId: "run-1",
      turns: [
        { turnId: "user-1", role: "user", status: "completed", content: "继续", runId: "run-1" },
        { turnId: "assistant-1", role: "assistant", status: "completed", content: "最终回答", runId: "run-1" },
      ],
      currentRun: settled,
    });
    snapshots.length = 0;

    const stream = runtimeMocks.streamInput as {
      readonly onEvent: (event: RunEvent, cursor: string) => void;
    };
    stream.onEvent(runEvent("final.result", 3), "cursor-3");
    await flushPromises();

    const terminalSnapshots = snapshots.filter((snapshot) => snapshot.run?.status === "completed");
    expect(terminalSnapshots).toHaveLength(1);
    expect(terminalSnapshots[0]?.live).toBeUndefined();
    expect(terminalSnapshots[0]?.workView?.transcriptNodes?.map((node) => node.eventType)).toEqual([
      "model.reasoning.completed",
      "final.result",
    ]);
    expect(projectCurrentRun(terminalSnapshots[0]!).transcriptNodes.map((node) => node.eventType)).toEqual([
      "model.reasoning.completed",
      "final.result",
    ]);

  });

  it("retries a terminal projection after a transient read failure", async () => {
    let state: AppState = {
      ...createInitialAppState(),
      conversation: { conversationId: "conversation-1" } as AppState["conversation"],
      run: { runId: "run-1", status: "running" } as AppState["run"],
    };
    const pollTimer = { current: undefined as number | undefined };
    const fallbackPollRef = { current: undefined as AbortController | undefined };
    const refreshConversations = vi.fn(async () => undefined);
    const controller = createLiveRunUpdateController({
      setApp: ((next) => {
        state = typeof next === "function" ? next(state) : next;
      }) as React.Dispatch<React.SetStateAction<AppState>>,
      mountedRef: { current: true },
      pollTimer,
      streamRef: { current: undefined },
      fallbackPollRef,
      activeRunIdRef: { current: "run-1" },
      viewEpochRef: { current: 1 },
      refreshConversations,
    });

    controller.startLiveUpdates({
      runId: "run-1",
      conversationId: "conversation-1",
      epoch: 1,
    });
    await flushPromises();

    runtimeMocks.safeBasicRunView.mockReset();
    runtimeMocks.safeBasicRunView.mockResolvedValue(completedView("cursor-3"));
    runtimeMocks.safeConversation
      .mockRejectedValueOnce(new Error("投影读取暂时失败"))
      .mockResolvedValue(undefined);

    const stream = runtimeMocks.streamInput as {
      readonly onEvent: (event: RunEvent, cursor: string) => void;
    };
    stream.onEvent(runEvent("final.result", 3), "cursor-3");
    await flushPromises();
    await flushPromises();

    expect(runtimeMocks.safeConversation).toHaveBeenCalledTimes(2);
    expect(state.run?.status).toBe("completed");
    expect(pollTimer.current).toBeUndefined();
    expect(fallbackPollRef.current).toBeUndefined();
    expect(refreshConversations).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.stream.close).toHaveBeenCalledTimes(1);
  });
});

function runningView(cursor: string, events: readonly RunEvent[] = []): BasicAgentRunView {
  return {
    run: { runId: "run-1", status: "running" },
    replay: {
      reset: false,
      events,
      cursor: { token: cursor },
    },
  } as unknown as BasicAgentRunView;
}

function completedView(cursor: string): BasicAgentRunView {
  const transcriptNodes = [
    {
      nodeId: "reasoning-1",
      runId: "run-1",
      sequence: 2,
      eventType: "model.reasoning.completed",
      kind: "thinking",
      phase: "completed",
      title: "思考",
      text: "先确认用户意图，再组织回答。",
      timestamp: "2026-01-01T00:00:00.000Z",
      refs: [{ kind: "model_call", id: "model-1" }],
    },
    {
      nodeId: "answer-1",
      runId: "run-1",
      sequence: 3,
      eventType: "final.result",
      kind: "answer",
      phase: "completed",
      title: "已回答",
      text: "最终回答",
      timestamp: "2026-01-01T00:00:00.000Z",
      refs: [{ kind: "model_call", id: "model-1" }],
    },
  ];
  return {
    run: { runId: "run-1", conversationId: "conversation-1", status: "completed" },
    replay: {
      reset: false,
      events: [runEvent("model.reasoning.completed", 2, "先确认用户意图，再组织回答。"), runEvent("final.result", 3)],
      cursor: { token: cursor },
    },
    workView: {
      run: { runId: "run-1" },
      transcriptNodes,
    },
    detail: {
      runId: "run-1",
      transcript: { transcriptNodes },
    },
  } as unknown as BasicAgentRunView;
}

function runEvent(type: string, sequence: number, delta?: string): RunEvent {
  return {
    id: `event-${sequence}`,
    runId: "run-1",
    sequence,
    type,
    delta,
    title: "",
    status: "running",
    timestamp: "2026-01-01T00:00:00.000Z",
    refs: [{ kind: "tool_call", id: "call-1" }],
    visibility: "compact",
  };
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}