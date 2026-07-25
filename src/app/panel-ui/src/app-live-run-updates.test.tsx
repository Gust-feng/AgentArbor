import type React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectChatWorkline } from "../../panel-read-model/assistant/panel-assistant-workline";
import { createLiveRunUpdateController } from "./app-live-run-updates";
import { projectCurrentRun } from "./app-run-projection";
import { createInitialAppState, type AppState } from "./app-state";
import { ChatTranscriptDisplay } from "./components/chat-transcript-display";
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

    const terminalState = terminalSnapshots[0]!;
    const currentRun = projectCurrentRun(terminalState);
    const turns = terminalState.conversation?.turns ?? [];
    const workline = projectChatWorkline({
      turns,
      currentRunId: currentRun.run?.runId,
      currentRunStatus: currentRun.run?.status,
      transcriptNodes: currentRun.transcriptNodes,
      hasAnswer: turns.some((turn) => turn.role === "assistant" && turn.content.trim().length > 0),
      hasLiveAnswer: currentRun.live?.turns.some((turn) => turn.output.text.length > 0) === true,
      hasPendingConfirmation: false,
      hasDeliverable: false,
    });
    render(
      <ChatTranscriptDisplay
        conversationId="conversation-1"
        projectedTurns={workline.turns}
        turns={turns}
        currentRunId={currentRun.run?.runId}
        currentRunNodes={currentRun.transcriptNodes}
        run={currentRun.run}
        live={currentRun.live}
        workView={currentRun.workView}
        showModelUsage={false}
        models={[]}
        selectedModelId=""
        onDecision={() => undefined}
        confirmationBusy={false}
      />,
    );

    expect(document.querySelectorAll(".typing-dots > span")).toHaveLength(0);
    expect(screen.getByText("最终回答")).toBeTruthy();
    const reasoning = screen.getByText("思考过程").closest("details");
    expect(reasoning?.open).toBe(false);
    expect(reasoning?.contains(screen.getByText("先确认用户意图，再组织回答。"))).toBe(true);
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
