import {
  mergeRunEvents,
  stateWithAppendOnlyRunEvent,
  stateWithObservedRunEvent,
  stateWithObservedRunEvents,
  stateWithObservedRunProjection,
} from "../../panel-run-observation-state";
import type { AppState } from "./app-state";
import type { BasicAgentRun, DesktopRunDetail, DesktopWorkSession, RunEvent } from "./contracts/run";

export { mergeRunEvents };

export function appStateWithObservedRunEvents(
  previous: AppState,
  input: {
    readonly runId: string;
    readonly events: readonly RunEvent[];
  }
): AppState {
  return stateWithObservedRunEvents(previous, input);
}

export function appStateWithObservedRunProjection(
  previous: AppState,
  input: {
    readonly runId: string;
    readonly run?: BasicAgentRun;
    readonly events?: readonly RunEvent[];
    readonly workSession?: DesktopWorkSession;
    readonly detail?: DesktopRunDetail;
  }
): AppState {
  return stateWithObservedRunProjection(previous, input);
}

export function appStateWithObservedRunEvent(
  previous: AppState,
  input: {
    readonly runId: string;
    readonly event: RunEvent;
    readonly run?: BasicAgentRun;
    readonly workSession?: DesktopWorkSession;
    readonly detail?: DesktopRunDetail;
  }
): AppState {
  return stateWithObservedRunEvent(previous, input);
}

export function appStateWithAppendOnlyRunEvent(
  previous: AppState,
  input: {
    readonly runId: string;
    readonly event: RunEvent;
  }
): AppState {
  return stateWithAppendOnlyRunEvent(previous, input);
}
