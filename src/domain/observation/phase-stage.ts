import type { ArborMessageType } from "../common.js";
import type { RunObservationEventEntry, RunPhase, RunStage } from "./contracts.js";
import { getEventObservationMetadata } from "./event-metadata.js";

export type RunObservationPosition = {
  readonly currentPhase: RunPhase;
  readonly currentStage: RunStage;
};

export function resolveRunObservationPosition(
  entries: readonly Pick<RunObservationEventEntry, "type">[]
): RunObservationPosition {
  const lastEventType = entries.at(-1)?.type;
  if (lastEventType === undefined) {
    return { currentPhase: "not_started", currentStage: "not_started" };
  }
  return {
    currentPhase: phaseForEvent(lastEventType),
    currentStage: stageForEvent(lastEventType),
  };
}

export function phaseForEvent(type: ArborMessageType): RunPhase {
  return getEventObservationMetadata(type).phase;
}

export function stageForEvent(type: ArborMessageType): RunStage {
  return getEventObservationMetadata(type).stage;
}
