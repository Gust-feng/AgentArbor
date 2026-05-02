import type { ArborMessageType } from "../domain/common.js";
import type { Constraint, DirectionHandoff, UndergroundExplorationReport } from "../domain/contracts.js";
import {
  createDirectionHandoffPackageRef,
  type DirectionHandoffPackage,
  type DirectionHandoffPackageRef,
} from "../domain/agentarbor/direction-handoff-package.js";
import type { RunObservationSnapshot } from "../domain/observation/contracts.js";
import { createRunObservationSnapshot } from "../domain/observation/index.js";
import { createId } from "../kernel/id.js";
import { createMessage } from "../kernel/messages/create-message.js";
import {
  createAwaitingUserDirectionMaterial,
  createMinimalDirectionMaterial,
  createStoppedDirectionMaterial,
} from "./minimal-direction.js";
import { createMinimalRuntime, type MinimalRuntime } from "./runtime.js";
import { runUndergroundExploration } from "./underground-runner.js";

export type UndergroundDirectionSessionTerminalStatus =
  | "approved_package_created"
  | "awaiting_user"
  | "stopped";

export type RunUndergroundDirectionSessionOptions = {
  constraints?: readonly Constraint[];
};

export type UndergroundDirectionSessionResult = {
  runtime: MinimalRuntime;
  traceId: string;
  goalId: string;
  terminalStatus: UndergroundDirectionSessionTerminalStatus;
  undergroundReport: UndergroundExplorationReport;
  directionHandoff?: DirectionHandoff;
  directionHandoffPackage: DirectionHandoffPackage;
  directionHandoffPackageRef: DirectionHandoffPackageRef;
  loadedDirectionHandoffPackage: DirectionHandoffPackage;
  observationSnapshot: RunObservationSnapshot;
  eventTypes: ArborMessageType[];
};

export function runUndergroundDirectionSession(
  goal: string,
  options: RunUndergroundDirectionSessionOptions = {}
): UndergroundDirectionSessionResult {
  const runtime = createMinimalRuntime();
  if (options.constraints !== undefined) {
    runtime.constraints = options.constraints.map((constraint) => ({
      ...constraint,
      appliesTo: [...constraint.appliesTo],
      evidenceRefs: [...constraint.evidenceRefs],
    }));
  }

  const traceId = createId("trace");
  const goalId = createId("goal");
  const agentId = "underground-analyzer";
  runtime.bus.publish(
    createMessage({
      traceId,
      from: { id: "user", role: "user" },
      to: { role: "underground_center" },
      type: "goal.received",
      intent: "receive_user_goal",
      payload: { goalId, goal },
    })
  );

  const { candidatePool, convergenceReport, undergroundReport } = runUndergroundExploration({
    runtime,
    traceId,
    goalId,
    rawGoal: goal,
    agentId,
  });
  const materialInput = {
    goalId,
    goal,
    producedByAgentId: agentId,
    constraints: runtime.constraints,
    goalIntentProfile: undergroundReport.goalIntentProfile,
    candidatePool,
    convergenceReport,
  };
  const material =
    convergenceReport.outcome === "approved"
      ? createMinimalDirectionMaterial(materialInput)
      : convergenceReport.outcome === "awaiting_user"
        ? createAwaitingUserDirectionMaterial(materialInput)
        : createStoppedDirectionMaterial(materialInput);
  const directionHandoffPackage = runtime.directionHandoffPackageStore.save(material.directionHandoffPackage);
  const loadedDirectionHandoffPackage = runtime.directionHandoffPackageStore.load(
    directionHandoffPackage.manifest.directionId,
    directionHandoffPackage.manifest.directionVersion
  );
  const directionHandoffPackageRef = createDirectionHandoffPackageRef(loadedDirectionHandoffPackage);
  const terminalStatus = terminalStatusForConvergence(convergenceReport.outcome);

  if (terminalStatus === "approved_package_created") {
    runtime.bus.publish(
      createMessage({
        traceId,
        from: { id: agentId, role: "underground_center" },
        to: { role: "aboveground_center" },
        type: "direction_handoff.completed",
        intent: "complete_direction_handoff",
        payload: {
          goalId,
          directionHandoff: material.directionHandoff,
          directionPackage: directionHandoffPackageRef,
        },
      })
    );
  } else if (terminalStatus === "awaiting_user" && "clarificationRequest" in material) {
    runtime.bus.publish(
      createMessage({
        traceId,
        from: { id: agentId, role: "underground_center" },
        to: { role: "user" },
        type: "user_approval.requested",
        intent: "request_user_clarification",
        payload: {
          goalId,
          clarificationRequest: material.clarificationRequest,
          directionPackage: directionHandoffPackageRef,
          convergenceReport: {
            reviewId: convergenceReport.reviewId,
            outcome: convergenceReport.outcome,
          },
        },
      })
    );
  }

  const observationSnapshot = createRunObservationSnapshot({
    traceId,
    goalId,
    eventEntries: runtime.eventLog.list(),
    undergroundReport,
    directionHandoffPackage: loadedDirectionHandoffPackage,
  });

  return {
    runtime,
    traceId,
    goalId,
    terminalStatus,
    undergroundReport,
    directionHandoff: material.directionHandoff,
    directionHandoffPackage,
    directionHandoffPackageRef,
    loadedDirectionHandoffPackage,
    observationSnapshot,
    eventTypes: runtime.eventLog.types(),
  };
}

function terminalStatusForConvergence(
  outcome: UndergroundExplorationReport["convergenceReport"]["outcome"]
): UndergroundDirectionSessionTerminalStatus {
  switch (outcome) {
    case "approved":
      return "approved_package_created";
    case "awaiting_user":
      return "awaiting_user";
    case "stopped":
      return "stopped";
  }
}
