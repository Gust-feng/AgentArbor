import type { ArborMessage, ArborMessageType } from "../domain/common.js";
import type { Constraint, DirectionHandoff, UndergroundExplorationReport } from "../domain/contracts.js";
import {
  FileSystemDirectionHandoffPackageStore,
  resolveDirectionHandoffPackageMetaPath,
  type DirectionHandoffPackage,
  type DirectionHandoffPackageRef,
  type DirectionHandoffPackageStore,
} from "../domain/agentarbor/direction-handoff-package.js";
import type { IntelligenceChannel } from "../domain/intelligence/index.js";
import type { RunObservationSnapshot } from "../domain/observation/contracts.js";
import { createRunObservationSnapshot } from "../domain/observation/index.js";
import { createId } from "../kernel/id.js";
import { createMessage } from "../kernel/messages/create-message.js";
import {
  MessageDrivenUndergroundDispatcher,
  type UndergroundMessageDrivenDispatchResult,
} from "./underground-message-dispatcher.js";
import { createMinimalRuntime, type MinimalRuntime } from "./runtime.js";

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
  const { traceId, goalId, message } = createUndergroundGoalMessage(goal);
  const dispatcher = new MessageDrivenUndergroundDispatcher({ runtime });
  try {
    runtime.bus.publish(message);
    const dispatchResult = requireDispatchResult(dispatcher.dispatchUntilIdle());
    return completeUndergroundDirectionSession({ runtime, storage, traceId, goalId, dispatchResult });
  } finally {
    dispatcher.dispose();
  }
}

export async function runUndergroundDirectionSessionWithIntelligence(
  goal: string,
  options: RunUndergroundDirectionSessionWithIntelligenceOptions
): Promise<UndergroundDirectionSessionResult> {
  const { runtime, storage } = createUndergroundSessionRuntime(options);
  const { traceId, goalId, message } = createUndergroundGoalMessage(goal);
  const intelligenceChannel = options.createIntelligenceChannel(runtime);
  const dispatcher = new MessageDrivenUndergroundDispatcher({ runtime, intelligenceChannel });
  try {
    runtime.bus.publish(message);
    const dispatchResult = requireDispatchResult(await dispatcher.dispatchUntilIdleAsync());
    return completeUndergroundDirectionSession({ runtime, storage, traceId, goalId, dispatchResult });
  } finally {
    dispatcher.dispose();
  }
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

function createUndergroundGoalMessage(goal: string): {
  traceId: string;
  goalId: string;
  message: ArborMessage<{ goalId: string; goal: string }>;
} {
  const traceId = createId("trace");
  const goalId = createId("goal");
  return {
    traceId,
    goalId,
    message: createMessage({
      traceId,
      from: { id: "user", role: "user" },
      to: { role: "underground_center" },
      type: "goal.received",
      intent: "receive_user_goal",
      payload: { goalId, goal },
    }),
  };
}

function completeUndergroundDirectionSession(input: {
  runtime: MinimalRuntime;
  storage: { packageStore?: DirectionHandoffPackageStore; outputDirectory?: string };
  traceId: string;
  goalId: string;
  dispatchResult: UndergroundMessageDrivenDispatchResult;
}): UndergroundDirectionSessionResult {
  const observationSnapshot = createRunObservationSnapshot({
    traceId: input.traceId,
    goalId: input.goalId,
    eventEntries: input.runtime.eventLog.list(),
    undergroundReport: input.dispatchResult.undergroundReport,
    directionHandoffPackage: input.dispatchResult.loadedDirectionHandoffPackage,
  });

  return {
    runtime: input.runtime,
    traceId: input.traceId,
    goalId: input.goalId,
    terminalStatus: input.dispatchResult.terminalStatus,
    undergroundReport: input.dispatchResult.undergroundReport,
    directionHandoff: input.dispatchResult.directionHandoff,
    directionHandoffPackage: input.dispatchResult.directionHandoffPackage,
    directionHandoffPackageRef: input.dispatchResult.directionHandoffPackageRef,
    loadedDirectionHandoffPackage: input.dispatchResult.loadedDirectionHandoffPackage,
    observationSnapshot,
    eventTypes: input.runtime.eventLog.types(),
    packageVersions: input.runtime.directionHandoffPackageStore.listVersions(
      input.dispatchResult.loadedDirectionHandoffPackage.manifest.directionId
    ),
    writtenPackagePath:
      input.storage.outputDirectory === undefined
        ? undefined
        : resolveDirectionHandoffPackageMetaPath(
            input.storage.outputDirectory,
            input.dispatchResult.loadedDirectionHandoffPackage.manifest.directionId,
            input.dispatchResult.loadedDirectionHandoffPackage.manifest.directionVersion
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

function requireDispatchResult(
  result: UndergroundMessageDrivenDispatchResult | undefined
): UndergroundMessageDrivenDispatchResult {
  if (result === undefined) {
    throw new Error("Underground dispatcher reached idle state without a terminal handoff result.");
  }
  return result;
}
