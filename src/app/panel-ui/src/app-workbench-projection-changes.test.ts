import { afterEach, expect, test, vi } from "vitest";
import {
  resetWorkbenchProjectionChangesForTesting,
  subscribeWorkbenchProjectionChanges,
} from "./app-workbench-projection-changes";

afterEach(() => {
  resetWorkbenchProjectionChangesForTesting();
  vi.unstubAllGlobals();
});

test("fans one Panel SSE connection out to projection consumers", () => {
  const streams: FakeEventSource[] = [];
  vi.stubGlobal("EventSource", class extends FakeEventSource {
    constructor(url: string) {
      super(url);
      streams.push(this);
    }
  });
  const received: number[] = [];
  const unsubscribeFirst = subscribeWorkbenchProjectionChanges((change) => received.push(change.revision));
  const unsubscribeSecond = subscribeWorkbenchProjectionChanges((change) => received.push(change.revision * 10));

  expect(streams).toHaveLength(1);
  streams[0]!.emit(JSON.stringify({ revision: 4, reset: false, owners: ["spaces"] }));
  expect(received).toEqual([4, 40]);
  unsubscribeFirst();
  unsubscribeSecond();
  expect(streams[0]?.closed).toBe(true);
});

class FakeEventSource {
  readonly listeners = new Map<string, EventListener[]>();
  closed = false;

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener));
  }

  close(): void { this.closed = true; }

  emit(data: string): void {
    for (const listener of this.listeners.get("workbench.projection.changed") ?? []) {
      listener({ data } as MessageEvent<string>);
    }
  }
}
