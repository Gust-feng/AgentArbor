import type { ArborMessageType } from "../domain/common.js";
import type { Constraint, DirectionHandoff, UndergroundExplorationReport } from "../domain/contracts.js";
import {
  createDirectionHandoffPackageRef,
  FileSystemDirectionHandoffPackageStore,
  resolveDirectionHandoffPackageMetaPath,
  type DirectionHandoffPackage,
  type DirectionHandoffPackageRef,
  type DirectionHandoffPackageStore,
} from "../domain/agentarbor/direction-handoff-package.js";
import type { IntelligenceChannel } from "../domain/intelligence/index.js";
import type { RunObservationSnapshot } from "../domain/observation/contracts.js";
import type { RootletOutput } from "../domain/underground/index.js";
import { createRunObservationSnapshot } from "../domain/observation/index.js";
import { createId } from "../kernel/id.js";
import { createMessage } from "../kernel/messages/create-message.js";
import {
  createAwaitingUserDirectionMaterial,
  createMinimalDirectionMaterial,
  createStoppedDirectionMaterial,
} from "./minimal-direction.js";
import { createMinimalRuntime, type MinimalRuntime } from "./runtime.js";
import { requestUndergroundRootletCandidateAdvice } from "./underground-intelligence.js";
import { runUndergroundExploration } from "./underground-runner.js";

export type UndergroundDirectionSessionTerminalStatus =
  | "approved_package_created"
  | "awaiting_user"
  | "stopped";

export type RunUndergroundDirectionSessionOptions = {
  constraints?: readonly Constraint[];
  packageStore?: DirectionHandoffPackageStore;
  outputDirectory?: string;
};

export type RunUndergroundDirectionSessionWithIntelligenceOptions = RunUndergroundDirectionSessionOptions & {
  createIntelligenceChannel: (runtime: MinimalRuntime) => IntelligenceChannel;
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
  packageVersions: number[];
  writtenPackagePath?: string;
  outputDirectory?: string;
};

export function runUndergroundDirectionSession(
  goal: string,
  options: RunUndergroundDirectionSessionOptions = {}
): UndergroundDirectionSessionResult {
  const { runtime, storage } = createUndergroundSessionRuntime(options);
  const { traceId, goalId, agentId } = publishUndergroundGoal(runtime, goal);

  return completeUndergroundDirectionSession({
    runtime,
    storage,
    traceId,
    goalId,
    agentId,
    goal,
  });
}

export async function runUndergroundDirectionSessionWithIntelligence(
  goal: string,
  options: RunUndergroundDirectionSessionWithIntelligenceOptions
): Promise<UndergroundDirectionSessionResult> {
  const { runtime, storage } = createUndergroundSessionRuntime(options);
  const { traceId, goalId, agentId } = publishUndergroundGoal(runtime, goal);
  const intelligenceChannel = options.createIntelligenceChannel(runtime);
  const extraRootletOutputs = await requestUndergroundRootletCandidateAdvice({
    intelligenceChannel,
    traceId,
    goalId,
    goal,
    producedByAgentId: agentId,
    constraints: runtime.constraints,
  });

  return completeUndergroundDirectionSession({
    runtime,
    storage,
    traceId,
    goalId,
    agentId,
    goal,
    extraRootletOutputs,
  });
}

function createUndergroundSessionRuntime(options: RunUndergroundDirectionSessionOptions): {
  runtime: MinimalRuntime;
  storage: { packageStore?: DirectionHandoffPackageStore; outputDirectory?: string };
} {
  const storage = resolveDirectionHandoffSessionStorage(options);
  const runtime = createMinimalRuntime({ directionHandoffPackageStore: storage.packageStore });
  if (options.constraints !== undefined) {
    runtime.constraints = options.constraints.map((constraint) => ({
      ...constraint,
      appliesTo: [...constraint.appliesTo],
      evidenceRefs: [...constraint.evidenceRefs],
    }));
  }
  return { runtime, storage };
}

function publishUndergroundGoal(runtime: MinimalRuntime, goal: string): {
  traceId: string;
  goalId: string;
  agentId: string;
} {
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
  return { traceId, goalId, agentId };
}

function completeUndergroundDirectionSession(input: {
  runtime: MinimalRuntime;
  storage: { packageStore?: DirectionHandoffPackageStore; outputDirectory?: string };
  traceId: string;
  goalId: string;
  agentId: string;
  goal: string;
  extraRootletOutputs?: readonly RootletOutput[];
}): UndergroundDirectionSessionResult {
  const { candidatePool, convergenceReport, undergroundReport } = runUndergroundExploration({
    runtime: input.runtime,
    traceId: input.traceId,
    goalId: input.goalId,
    rawGoal: input.goal,
    agentId: input.agentId,
    extraRootletOutputs: input.extraRootletOutputs,
  });
  const materialInput = {
    goalId: input.goalId,
    goal: input.goal,
    producedByAgentId: input.agentId,
    constraints: input.runtime.constraints,
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
  const directionHandoffPackage = input.runtime.directionHandoffPackageStore.save(material.directionHandoffPackage);
  const loadedDirectionHandoffPackage = input.runtime.directionHandoffPackageStore.load(
    directionHandoffPackage.manifest.directionId,
    directionHandoffPackage.manifest.directionVersion
  );
  const directionHandoffPackageRef = createDirectionHandoffPackageRef(loadedDirectionHandoffPackage);
  const terminalStatus = terminalStatusForConvergence(convergenceReport.outcome);

  if (terminalStatus === "approved_package_created") {
    input.runtime.bus.publish(
      createMessage({
        traceId: input.traceId,
        from: { id: input.agentId, role: "underground_center" },
        to: { role: "aboveground_center" },
        type: "direction_handoff.completed",
        intent: "complete_direction_handoff",
        payload: {
          goalId: input.goalId,
          directionHandoff: material.directionHandoff,
          directionPackage: directionHandoffPackageRef,
        },
      })
    );
  } else if (terminalStatus === "awaiting_user" && "clarificationRequest" in material) {
    input.runtime.bus.publish(
      createMessage({
        traceId: input.traceId,
        from: { id: input.agentId, role: "underground_center" },
        to: { role: "user" },
        type: "user_approval.requested",
        intent: "request_user_clarification",
        payload: {
          goalId: input.goalId,
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
    traceId: input.traceId,
    goalId: input.goalId,
    eventEntries: input.runtime.eventLog.list(),
    undergroundReport,
    directionHandoffPackage: loadedDirectionHandoffPackage,
  });

  return {
    runtime: input.runtime,
    traceId: input.traceId,
    goalId: input.goalId,
    terminalStatus,
    undergroundReport,
    directionHandoff: material.directionHandoff,
    directionHandoffPackage,
    directionHandoffPackageRef,
    loadedDirectionHandoffPackage,
    observationSnapshot,
    eventTypes: input.runtime.eventLog.types(),
    packageVersions: input.runtime.directionHandoffPackageStore.listVersions(
      loadedDirectionHandoffPackage.manifest.directionId
    ),
    writtenPackagePath:
      input.storage.outputDirectory === undefined
        ? undefined
        : resolveDirectionHandoffPackageMetaPath(
            input.storage.outputDirectory,
            loadedDirectionHandoffPackage.manifest.directionId,
            loadedDirectionHandoffPackage.manifest.directionVersion
          ),
    outputDirectory: input.storage.outputDirectory,
  };
}

function resolveDirectionHandoffSessionStorage(
  options: RunUndergroundDirectionSessionOptions
): { packageStore?: DirectionHandoffPackageStore; outputDirectory?: string } {
  if (options.packageStore !== undefined && options.outputDirectory !== undefined) {
    throw new Error("Specify either packageStore or outputDirectory, not both.");
  }

  if (options.outputDirectory !== undefined) {
    return {
      packageStore: new FileSystemDirectionHandoffPackageStore(options.outputDirectory),
      outputDirectory: options.outputDirectory,
    };
  }

  return {
    packageStore: options.packageStore,
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
