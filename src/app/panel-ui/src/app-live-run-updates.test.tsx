import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLiveRunUpdateController } from "./app-live-run-updates";
import { createInitialAppState, type AppState } from "./app-state";
import type { BasicAgentRunView, RunEvent } from "./contracts/run";

const runtimeMocks = vi.hoisted(() => ({
  safeBasicRunView: vi.fn(),
  streamInput: undefined as unknown,
  stream: { close: vi.fn() },
}));

vi.mock("./runtime", () => ({
  safeBasicRunView: runtimeMocks.safeBasicRunView,
  ordinaryWorkViewFromRunView: () => undefined,
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
      readonly onEvent: (event: RunEvent) => void;
      readonly onHeartbeat: () => void;
    };
    stream.onEvent(runEvent("tool.requested", 2));
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
});

function runningView(cursor: string): BasicAgentRunView {
  return {
    run: { runId: "run-1", status: "running" },
    replay: {
      reset: false,
      events: [],
      cursor: { token: cursor },
    },
  } as unknown as BasicAgentRunView;
}

function runEvent(type: string, sequence: number): RunEvent {
  return {
    id: `event-${sequence}`,
    runId: "run-1",
    sequence,
    type,
    title: "",
    status: "running",
    timestamp: "2026-01-01T00:00:00.000Z",
    refs: [{ kind: "tool_call", id: "call-1" }],
    visibility: "compact",
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
