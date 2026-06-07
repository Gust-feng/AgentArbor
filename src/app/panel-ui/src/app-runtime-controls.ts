import type { MutableRefObject } from "react";
import type { BasicAgentRun } from "./contracts/run";

export function stopPolling(ref: MutableRefObject<number | undefined>): void {
  if (ref.current !== undefined) {
    window.clearInterval(ref.current);
    ref.current = undefined;
  }
}

export function stopStream(ref: MutableRefObject<EventSource | undefined>): void {
  ref.current?.close();
  ref.current = undefined;
}

export function stopLiveUpdates(
  pollRef: MutableRefObject<number | undefined>,
  streamRef: MutableRefObject<EventSource | undefined>
): void {
  stopPolling(pollRef);
  stopStream(streamRef);
}

export function shouldKeepRefreshing(status: BasicAgentRun["status"]): boolean {
  return status === "queued" || status === "planning" || status === "running";
}

export function isObservedRunSettled(run: BasicAgentRun): boolean {
  return !shouldKeepRefreshing(run.status);
}
