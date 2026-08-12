import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunEvent } from "./contracts/run";
import { openBasicRunStream, safeConversation } from "./runtime";

describe("Panel runtime adapters", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeEventSource.instances = [];
  });

  it("forwards the SSE event id as the delivered replay cursor", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const observed: Array<{ readonly event: RunEvent; readonly cursor: string }> = [];
    const onError = vi.fn();

    openBasicRunStream({
      runId: "run-1",
      onEvent: (event, cursor) => observed.push({ event, cursor }),
      onReset: () => undefined,
      onError,
    });
    const source = FakeEventSource.instances[0];
    source?.emit("model.output.delta", {
      data: JSON.stringify(runEvent()),
      lastEventId: "cursor-5",
    });

    expect(observed).toEqual([{ event: runEvent(), cursor: "cursor-5" }]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("propagates non-missing conversation read failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: "projection_unavailable", message: "投影暂时不可用" },
    }), { status: 503 })));

    await expect(safeConversation("conversation-1")).rejects.toMatchObject({
      status: 503,
      code: "projection_unavailable",
    });
  });
});

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly listeners = new Map<string, EventListener[]>();
  onerror: ((event: Event) => void) | null = null;

  constructor(readonly url: string | URL) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (listener === null) return;
    const callback = typeof listener === "function"
      ? listener
      : (event: Event): void => listener.handleEvent(event);
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]);
  }

  emit(type: string, message: Pick<MessageEvent<string>, "data" | "lastEventId">): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(message as MessageEvent<string>);
    }
  }

  close(): void {}
}

function runEvent(): RunEvent {
  return {
    id: "event-5",
    runId: "run-1",
    sequence: 5,
    type: "model.output.delta",
    title: "",
    delta: "完整流式正文",
    status: "running",
    timestamp: "2026-01-01T00:00:05.000Z",
    refs: [{ kind: "event", id: "event-5" }],
    visibility: "compact",
  };
}