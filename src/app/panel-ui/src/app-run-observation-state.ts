import {
  canApplyRunSubscriptionToState,
  createAppendOnlyRunEventBatcher,
  mergeRunEvents,
  stateWithConversationGuard,
  stateWithAppendOnlyRunEvent,
  stateWithAppendOnlyRunEvents,
  stateWithObservedRunEvent,
  stateWithObservedRunEvents,
  stateWithObservedRunProjection,
} from "../../panel-read-model/run/panel-run-observation-state";
import { nextRunCapabilityState } from "../../panel-ui-run-capability-state";
import type { AppState } from "./app-state";
import type {
  BasicAgentRun,
  DesktopRunDetail,
  DesktopWorkView,
  RunCapabilityResolution,
  RunEvent,
} from "./contracts/run";

export { mergeRunEvents };
export { createAppendOnlyRunEventBatcher };

export function canApplyRunSubscriptionToAppState(input: {
  readonly previous: Pick<AppState, "conversation">;
  readonly activeRunId: string | undefined;
  readonly currentEpoch: number;
  readonly runId: string;
  readonly conversationId?: string;
  readonly epoch: number;
}): boolean {
  return canApplyRunSubscriptionToState(input);
}

export function appStateWithSettledConversationGuard(
  previous: AppState,
  input: {
    readonly expectedConversationId?: string;
    readonly next: AppState;
  }
): AppState {
  return stateWithConversationGuard(previous, input);
}

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
    readonly workView?: DesktopWorkView;
    readonly capabilityResolution?: RunCapabilityResolution;
    readonly detail?: DesktopRunDetail;
  }
): AppState {
  return {
    ...stateWithObservedRunProjection(previous, input),
    ...nextCapabilityResolutionState(previous, input.runId, input.capabilityResolution),
  };
}

export function appStateWithObservedRunEvent(
  previous: AppState,
  input: {
    readonly runId: string;
    readonly event: RunEvent;
    readonly run?: BasicAgentRun;
    readonly workView?: DesktopWorkView;
    readonly capabilityResolution?: RunCapabilityResolution;
    readonly detail?: DesktopRunDetail;
  }
): AppState {
  return {
    ...stateWithObservedRunEvent(previous, input),
    ...nextCapabilityResolutionState(previous, input.runId, input.capabilityResolution),
  };
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

export function appStateWithAppendOnlyRunEvents(
  previous: AppState,
  input: {
    readonly runId: string;
    readonly events: readonly RunEvent[];
  }
): AppState {
  return stateWithAppendOnlyRunEvents(previous, input);
}

function nextCapabilityResolutionState(
  previous: AppState,
  runId: string,
  incoming: RunCapabilityResolution | undefined
): Pick<AppState, "capabilityResolution" | "capabilityResolutionRunId"> {
  return nextRunCapabilityState(previous, { runId, capabilityResolution: incoming });
}
