import type { ArborMessage } from "../../../domain/common.js";
import type { DirectionHandoff, UndergroundExplorationReport } from "../../../domain/contracts.js";
import type {
  DirectionHandoffPackage,
  DirectionHandoffPackageRef,
} from "../../../domain/agentarbor/direction-handoff-package.js";
import type { IntelligenceChannel } from "../../../domain/intelligence/index.js";
import type { ToolExecutionBroker } from "../../../domain/tools/index.js";
import type { AgentTurnRuntime } from "../../../kernel/intelligence/index.js";
import type { RootletClusterKind } from "../../../domain/underground/index.js";
import { ensureUndergroundAgentClusterManifests } from "../../underground-agent-cluster-runtime.js";
import type { MinimalRuntime } from "../../runtime.js";
import { CandidatePoolAgent } from "./candidate-pool-agent.js";
import { ConvergenceJudgeAgent } from "./convergence-judge-agent.js";
import { GrowthGovernorAgent } from "./growth-governor-agent.js";
import { HandoffStewardAgent } from "./handoff-steward-agent.js";
import { IntentCoreAgent } from "./intent-core-agent.js";
import { RootletAgent } from "./rootlet-agent.js";
import {
  UndergroundAgentContext,
  UndergroundAgentRuntimeError,
  type UndergroundAgent,
  type UndergroundQueuedAgentMessage,
  ensureMessageFromAgent,
  ensurePayloadStringEquals,
  readPayloadRecord,
  requireValue,
} from "./agent-context.js";
import { UndergroundSharedContext } from "./shared-context.js";

const DEFAULT_MAX_DISPATCH_STEPS = 32;

export class UndergroundAgentRunnerError extends UndergroundAgentRuntimeError {}

export type UndergroundAgentRunnerOptions = {
  readonly runtime: MinimalRuntime;
  readonly intelligenceChannel?: IntelligenceChannel;
  readonly toolCenter?: ToolExecutionBroker;
  readonly agentTurnRuntime?: AgentTurnRuntime;
  readonly maxDispatchSteps?: number;
};

export type UndergroundAgentRunnerResult = {
  readonly terminalStatus: "approved_package_created" | "awaiting_user" | "stopped";
  readonly undergroundReport: UndergroundExplorationReport;
  readonly directionHandoff?: DirectionHandoff;
  readonly directionHandoffPackage: DirectionHandoffPackage;
  readonly directionHandoffPackageRef: DirectionHandoffPackageRef;
  readonly loadedDirectionHandoffPackage: DirectionHandoffPackage;
  readonly processedMessageIds: readonly string[];
  readonly dispatchSteps: number;
};

export class UndergroundAgentRunner {
  private readonly shared = new UndergroundSharedContext();
  private readonly queue: UndergroundQueuedAgentMessage[] = [];
  private readonly fixedAgents: UndergroundAgent[];
  private readonly dynamicRootletAgents = new Map<string, RootletAgent>();
  private readonly context: UndergroundAgentContext;
  private readonly rootletClusterSubscription: () => void;
  private readonly maxDispatchSteps: number;
  private readonly processedMessageIds = new Set<string>();
  private readonly processedPhaseKeys = new Set<string>();
  private dispatchSteps = 0;
  private disposed = false;

  constructor(private readonly options: UndergroundAgentRunnerOptions) {
    this.maxDispatchSteps = options.maxDispatchSteps ?? DEFAULT_MAX_DISPATCH_STEPS;
    ensureUndergroundAgentClusterManifests(options.runtime);
    this.context = new UndergroundAgentContext({
      runtime: options.runtime,
      shared: this.shared,
      intelligenceChannel: options.intelligenceChannel,
      toolCenter: options.toolCenter,
      agentTurnRuntime: options.agentTurnRuntime,
      enqueue: (message) => this.queue.push(message),
    });
    this.fixedAgents = [
      new IntentCoreAgent(),
      new GrowthGovernorAgent(),
      new CandidatePoolAgent(),
      new ConvergenceJudgeAgent(),
      new HandoffStewardAgent(),
    ];
    for (const agent of this.fixedAgents) {
      agent.start(this.context);
    }
    this.rootletClusterSubscription = options.runtime.bus.subscribe("rootlet_cluster.started", (message) => {
      this.queue.push({
        agentId: "underground-agent-runner",
        message,
        handler: (queuedMessage) => this.handleRootletClusterStarted(queuedMessage as ArborMessage),
        isPublicMessage: true,
        requiresAsync: false,
      });
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.rootletClusterSubscription();
    for (const agent of this.fixedAgents) {
      agent.stop();
    }
    for (const agent of this.dynamicRootletAgents.values()) {
      agent.stop();
    }
    this.disposed = true;
  }

  dispatchUntilIdle(): UndergroundAgentRunnerResult | undefined {
    while (this.queue.length > 0) {
      const queuedMessage = this.queue.shift();
      if (queuedMessage === undefined) {
        continue;
      }
      if (queuedMessage.requiresAsync) {
        throw new UndergroundAgentRunnerError("Asynchronous underground agent requires dispatchUntilIdleAsync().");
      }
      const handlerResult = this.processQueuedMessage(queuedMessage);
      if (isPromiseLike(handlerResult)) {
        throw new UndergroundAgentRunnerError("Asynchronous underground agent requires dispatchUntilIdleAsync().");
      }
    }
    return this.buildResult();
  }

  async dispatchUntilIdleAsync(): Promise<UndergroundAgentRunnerResult | undefined> {
    while (this.queue.length > 0) {
      const queuedMessage = this.queue.shift();
      if (queuedMessage === undefined) {
        continue;
      }
      await this.processQueuedMessage(queuedMessage);
    }
    return this.buildResult();
  }

  private processQueuedMessage(message: UndergroundQueuedAgentMessage): void | Promise<void> {
    if (this.buildResult() !== undefined) {
      return;
    }
    if (message.isPublicMessage) {
      const publicMessage = message.message as ArborMessage;
      if (this.processedMessageIds.has(publicMessage.id)) {
        return;
      }
      const phaseKey = `${publicMessage.traceId}:${publicMessage.type}`;
      this.processedMessageIds.add(publicMessage.id);
      if (this.processedPhaseKeys.has(phaseKey)) {
        return;
      }
      this.processedPhaseKeys.add(phaseKey);
      this.dispatchSteps += 1;
      if (this.dispatchSteps > this.maxDispatchSteps) {
        throw new UndergroundAgentRunnerError(
          `Underground agent runner exceeded maxDispatchSteps=${this.maxDispatchSteps}.`
        );
      }
    }
    return message.handler(message.message);
  }

  private handleRootletClusterStarted(message: ArborMessage): void {
    const state = this.shared.snapshot();
    const goalId = requireValue(state.goalId, "goalId");
    const startedPlan = requireValue(state.startedPlan, "startedPlan");
    const runningRootletInvocations = requireValue(
      state.runningRootletInvocations,
      "runningRootletInvocations"
    );
    const payload = readPayloadRecord(message);
    ensureMessageFromAgent(message, "underground-growth-governor");
    ensurePayloadStringEquals(payload, "goalId", goalId, message.type);
    ensurePayloadStringEquals(payload, "planId", startedPlan.planId, message.type);

    for (const cluster of startedPlan.rootletClusters) {
      this.ensureDynamicRootletAgent(cluster.kind);
      const invocation = requireValue(
        runningRootletInvocations.find((candidate) => candidate.inputRefs.includes(cluster.clusterId)),
        `rootlet invocation for ${cluster.clusterId}`
      );
      this.context.publishRootletInvocationRequested({
        traceId: message.traceId,
        goalId,
        planId: startedPlan.planId,
        clusterId: cluster.clusterId,
        rootletKind: cluster.kind,
        invocationId: invocation.invocationId,
      });
    }
  }

  private ensureDynamicRootletAgent(kind: RootletClusterKind): void {
    if (this.dynamicRootletAgents.has(kind)) {
      return;
    }
    const agent = new RootletAgent(kind);
    agent.start(this.context);
    this.dynamicRootletAgents.set(kind, agent);
  }

  private buildResult(): UndergroundAgentRunnerResult | undefined {
    const state = this.shared.snapshot();
    if (
      state.terminalStatus === undefined ||
      state.undergroundReport === undefined ||
      state.directionHandoffPackage === undefined ||
      state.directionHandoffPackageRef === undefined ||
      state.loadedDirectionHandoffPackage === undefined
    ) {
      return undefined;
    }
    return {
      terminalStatus: state.terminalStatus,
      undergroundReport: state.undergroundReport,
      directionHandoff: state.directionHandoff,
      directionHandoffPackage: state.directionHandoffPackage,
      directionHandoffPackageRef: state.directionHandoffPackageRef,
      loadedDirectionHandoffPackage: state.loadedDirectionHandoffPackage,
      processedMessageIds: [...this.processedMessageIds],
      dispatchSteps: this.dispatchSteps,
    };
  }
}

function isPromiseLike(value: void | Promise<void>): value is Promise<void> {
  return typeof value === "object" && value !== null && "then" in value;
}
