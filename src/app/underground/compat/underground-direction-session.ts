import type { ArborMessage, ArborMessageType } from "../../../domain/common.js";
import type { Constraint, DirectionHandoff, UndergroundExplorationReport } from "../../../domain/contracts.js";
import {
  FileSystemDirectionHandoffPackageStore,
  resolveDirectionHandoffPackageMetaPath,
  type DirectionHandoffPackage,
  type DirectionHandoffPackageRef,
  type DirectionHandoffPackageStore,
} from "../../../domain/agentarbor/direction-handoff-package.js";
import type { IntelligenceChannel } from "../../../domain/intelligence/index.js";
import type { ToolExecutionBroker } from "../../../domain/tools/index.js";
import type { RunObservationSnapshot } from "../../../domain/observation/contracts.js";
import { createRunObservationSnapshot } from "../../../domain/observation/index.js";
import { createId } from "../../../kernel/id.js";
import { AgentTurnRuntime } from "../../../kernel/intelligence/index.js";
import { createMessage } from "../../../kernel/messages/create-message.js";
import {
  UndergroundAgentOrchestrator,
  type UndergroundAgentOrchestratorResult,
  type UndergroundAgentOrchestratorRunTrace,
} from "../orchestrator.js";
import { createMinimalRuntime, type MinimalRuntime } from "../../runtime.js";

export type UndergroundDirectionSessionTerminalStatus =
  | "approved_package_created"
  | "awaiting_user"
  | "stopped";

export type UndergroundDirectionSessionRuntimeContext = {
  readonly runtime: MinimalRuntime;
  readonly traceId: string;
  readonly goalId: string;
};

export type RunUndergroundDirectionSessionOptions = {
  constraints?: readonly Constraint[];
  packageStore?: DirectionHandoffPackageStore;
  outputDirectory?: string;
  requireAutonomy?: boolean;
  maxAutonomyCycles?: number;
  onRuntimeReady?: (context: UndergroundDirectionSessionRuntimeContext) => void;
};

export type RunUndergroundDirectionSessionWithIntelligenceOptions = RunUndergroundDirectionSessionOptions & {
  createIntelligenceChannel: (runtime: MinimalRuntime) => IntelligenceChannel;
  createToolCenter?: (runtime: MinimalRuntime) => ToolExecutionBroker;
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
  undergroundOrchestratorRun: UndergroundAgentOrchestratorRunTrace;
  eventTypes: ArborMessageType[];
  packageVersions: number[];
  writtenPackagePath?: string;
  outputDirectory?: string;
};

export async function runUndergroundDirectionSession(
  goal: string,
  options: RunUndergroundDirectionSessionOptions = {}
): Promise<UndergroundDirectionSessionResult> {
  const { runtime, storage } = createUndergroundSessionRuntime(options);
  const { traceId, goalId, message } = createUndergroundGoalMessage(goal);
  const orchestrator = new UndergroundAgentOrchestrator({
    runtime,
    enableAutonomy: true,
    maxAutonomyCycles: options.maxAutonomyCycles,
  });
  options.onRuntimeReady?.({ runtime, traceId, goalId });
  const dispatchResult = await orchestrator.run(message);
  return completeUndergroundDirectionSession({ runtime, storage, traceId, goalId, dispatchResult });
}

/**
 * @deprecated 废弃候选（T3-5 / ADR-0025 deep 一期）—— compat→UndergroundAgentOrchestrator 链核心。
 *
 * 正式 deep 运行入口为 src/app/deep/*（DeepRuntime：manager 自由决策循环 → 一层 child →
 * 父层综合 → SynthesizedConclusion），经 /api/deep/* 端点暴露。
 *
 * 本函数实例化旧 UndergroundAgentOrchestrator 固定拓扑（与 directionHandoffPackage / Plan
 * 强耦合），是 compat 链的实际驱动者；ADR-0025 三段式重构不转正本路径，DeepRuntime 是替代物。
 *
 * 退役前置条件（闭环4）：所有调用方（clarification-flow / minimal-loop / underground-demo /
 * panel compat / 测试）迁移到 DeepRuntime 且等价能力验证完成。
 *
 * 边界：domain/underground 的 AgentLoop / Guard / run tree / 事件契约为保留复用抽象，不在退役范围。
 *
 * 当前保持运行不阻塞；禁止改名 / 删除（panel-server-structure.test.ts 结构断言要求签名存在）。
 */
export async function runUndergroundDirectionSessionWithIntelligence(
  goal: string,
  options: RunUndergroundDirectionSessionWithIntelligenceOptions
): Promise<UndergroundDirectionSessionResult> {
  const { runtime, storage } = createUndergroundSessionRuntime(options);
  const { traceId, goalId, message } = createUndergroundGoalMessage(goal);
  const intelligenceChannel = options.createIntelligenceChannel(runtime);
  const toolCenter = options.createToolCenter?.(runtime);
  toolCenter?.resetCallCount();
  const agentTurnRuntime = new AgentTurnRuntime({
    intelligenceChannel,
    toolCenter,
    publishToolEvent: (event) => runtime.bus.publish(event),
  });
  const orchestrator = new UndergroundAgentOrchestrator({
    runtime,
    intelligenceChannel,
    toolCenter,
    agentTurnRuntime,
    enableAutonomy: true,
    maxAutonomyCycles: options.maxAutonomyCycles,
  });
  options.onRuntimeReady?.({ runtime, traceId, goalId });
  const dispatchResult = await orchestrator.runAsync(message);
  return completeUndergroundDirectionSession({ runtime, storage, traceId, goalId, dispatchResult });
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
  dispatchResult: UndergroundAgentOrchestratorResult;
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
    undergroundOrchestratorRun: input.dispatchResult.orchestratorRun,
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
