import type { RunObservationSnapshot, RunObservationSnapshotInput } from "./contracts.js";
import { createRunObservationEventViews } from "./event-view.js";
import { finalizeJsonSafeSnapshot } from "./json-safe.js";
import { createRunObservationLayerViews } from "./layer-views.js";
import { resolveRunObservationPosition } from "./phase-stage.js";

export function createRunObservationSnapshot(input: RunObservationSnapshotInput): RunObservationSnapshot {
  const events = createRunObservationEventViews(input.eventEntries);
  const lastEvent = input.eventEntries.at(-1);
  const position = resolveRunObservationPosition(input.eventEntries);
  const layers = createRunObservationLayerViews(input);

  const snapshot: RunObservationSnapshot = {
    traceId: input.traceId,
    goalId: input.goalId,
    currentPhase: position.currentPhase,
    currentStage: position.currentStage,
    eventCursor: {
      eventCount: events.length,
      lastSequence: lastEvent?.sequence ?? 0,
      lastEventType: lastEvent?.type,
    },
    events,
    underground: layers.underground,
    handoff: layers.handoff,
    aboveground: layers.aboveground,
    fruits: layers.fruits,
    governance: layers.governance,
    soilReturnStub: layers.soilReturnStub,
    directionPackageRef: {
      packageId: layers.handoff.packageId,
      directionId: layers.handoff.directionId,
      version: layers.handoff.version,
      status: layers.handoff.directionStatus,
      validationPassed: layers.handoff.validationPassed,
    },
    artifactRefs: layers.fruits.artifactRefs,
    verification: layers.fruits.verification,
  };

  return finalizeJsonSafeSnapshot(snapshot);
}
