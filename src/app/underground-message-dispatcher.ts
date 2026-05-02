import type { ArborMessage, ArborMessageType } from "../domain/common.js";
import type { Constraint, DirectionHandoff, UndergroundExplorationReport } from "../domain/contracts.js";
import {
  createDirectionHandoffPackageRef,
  type DirectionHandoffPackage,
  type DirectionHandoffPackageRef,
} from "../domain/agentarbor/direction-handoff-package.js";
import type { IntelligenceChannel } from "../domain/intelligence/index.js";
import type {
  CandidatePool,
  GoalIntentProfile,
  RootletOutput,
  UndergroundAgentClusterPlan,
  UndergroundAgentClusterRun,
  UndergroundAgentInvocation,
  UndergroundConvergenceReport,
  UndergroundEvidenceLedger,
  UndergroundExplorationPlan,
} from "../domain/underground/index.js";
import { evidenceId } from "../domain/underground/index.js";
import { createId } from "../kernel/id.js";
import { createMessage } from "../kernel/messages/create-message.js";
import { undergroundRootletAgentId } from "./agents/manifests.js";
import {
  completeRootletClusters,
  createGoalIntentProfileForMinimalUnderground,
  createMinimalCandidatePool,
  createMinimalUndergroundExplorationPlan,
  createUndergroundExplorationReport,
  produceMinimalRootletOutputs,
  spendCandidateBudget,
  startRootletClusters,
} from "./minimal-underground.js";
import {
  createAwaitingUserDirectionMaterial,
  createMinimalDirectionMaterial,
  createStoppedDirectionMaterial,
} from "./minimal-direction.js";
import type { MinimalRuntime } from "./runtime.js";
import {
  cloneUndergroundAgentInvocation,
  completeUndergroundAgentInvocation,
  completeUndergroundRootletInvocations,
  convergeDefaultUndergroundCandidatePool,
  createUndergroundAgentClusterPlan,
  ensureUndergroundAgentClusterManifests,
  finalizeUndergroundAgentClusterRun,
  startUndergroundAgentInvocation,
} from "./underground-agent-cluster-runtime.js";
import {
  publishCandidatePoolUpdated,
  publishConvergenceReviewCompleted,
  publishExplorationCandidatesProduced,
  publishRootletClustersStarted,
  publishUndergroundExplorationPlanned,
} from "./underground-events.js";
import { requestUndergroundRootletCandidateAdvice } from "./underground-intelligence.js";

const UNDERGROUND_DISPATCH_MESSAGE_TYPES = [
  "goal.received",
  "underground.exploration_planned",
  "rootlet_cluster.started",
  "exploration_candidate.produced",
  "candidate_pool.updated",
  "convergence_review.completed",
] as const satisfies readonly ArborMessageType[];

type UndergroundDispatchMessageType = (typeof UNDERGROUND_DISPATCH_MESSAGE_TYPES)[number];

const DEFAULT_MAX_DISPATCH_STEPS = 32;

export class UndergroundMessageDispatcherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UndergroundMessageDispatcherError";
  }
}

export type MessageDrivenUndergroundDispatcherOptions = {
  readonly runtime: MinimalRuntime;
  readonly intelligenceChannel?: IntelligenceChannel;
  readonly maxDispatchSteps?: number;
};

export type UndergroundMessageDrivenDispatchResult = {
  readonly terminalStatus: "approved_package_created" | "awaiting_user" | "stopped";
  readonly undergroundReport: UndergroundExplorationReport;
  readonly directionHandoff?: DirectionHandoff;
  readonly directionHandoffPackage: DirectionHandoffPackage;
  readonly directionHandoffPackageRef: DirectionHandoffPackageRef;
  readonly loadedDirectionHandoffPackage: DirectionHandoffPackage;
  readonly processedMessageIds: readonly string[];
  readonly dispatchSteps: number;
};

type UndergroundTraceDispatchContext = {
  traceId: string;
  goalId: string;
  rawGoal: string;
  goalIntentProfile?: GoalIntentProfile;
  explorationPlan?: UndergroundExplorationPlan;
  startedPlan?: UndergroundExplorationPlan;
  completedPlan?: UndergroundExplorationPlan;
  agentClusterPlan?: UndergroundAgentClusterPlan;
  centerInvocations: UndergroundAgentInvocation[];
  runningRootletInvocations?: UndergroundAgentInvocation[];
  completedRootletInvocations?: UndergroundAgentInvocation[];
  runningHandoffInvocation?: UndergroundAgentInvocation;
  rootletOutputs?: RootletOutput[];
  candidatePool?: CandidatePool;
  convergenceReport?: UndergroundConvergenceReport;
  evidenceLedger?: UndergroundEvidenceLedger;
  agentClusterRun?: UndergroundAgentClusterRun;
  undergroundReport?: UndergroundExplorationReport;
};

export class MessageDrivenUndergroundDispatcher {
  private readonly queue: ArborMessage[] = [];
  private readonly contextsByTraceId = new Map<string, UndergroundTraceDispatchContext>();
  private readonly processedMessageIds = new Set<string>();
  private readonly processedPhaseKeys = new Set<string>();
  private readonly subscriptions: Array<() => void>;
  private readonly maxDispatchSteps: number;
  private dispatchSteps = 0;
  private result?: UndergroundMessageDrivenDispatchResult;

  constructor(private readonly options: MessageDrivenUndergroundDispatcherOptions) {
    this.maxDispatchSteps = options.maxDispatchSteps ?? DEFAULT_MAX_DISPATCH_STEPS;
    this.subscriptions = UNDERGROUND_DISPATCH_MESSAGE_TYPES.map((type) =>
      this.options.runtime.bus.subscribe(type, (message) => this.queue.push(message))
    );
  }

  dispose(): void {
    for (const unsubscribe of this.subscriptions) {
      unsubscribe();
    }
  }

  dispatchUntilIdle(): UndergroundMessageDrivenDispatchResult | undefined {
    while (this.queue.length > 0) {
      const message = this.queue.shift();
      if (message === undefined) {
        continue;
      }
      if (this.requiresAsyncHandler(message)) {
        throw new UndergroundMessageDispatcherError(
          "Asynchronous underground handler requires dispatchUntilIdleAsync()."
        );
      }
      const handlerResult = this.processMessage(message);
      if (isPromiseLike(handlerResult)) {
        throw new UndergroundMessageDispatcherError(
          "Asynchronous underground handler requires dispatchUntilIdleAsync()."
        );
      }
    }
    return this.result;
  }

  async dispatchUntilIdleAsync(): Promise<UndergroundMessageDrivenDispatchResult | undefined> {
    while (this.queue.length > 0) {
      const message = this.queue.shift();
      if (message === undefined) {
        continue;
      }
      await this.processMessage(message);
    }
    return this.result;
  }

  private processMessage(message: ArborMessage): void | Promise<void> {
    if (!isUndergroundDispatchMessageType(message.type) || this.result !== undefined) {
      return;
    }
    if (this.processedMessageIds.has(message.id)) {
      return;
    }
    const phaseKey = `${message.traceId}:${message.type}`;
    this.processedMessageIds.add(message.id);
    if (this.processedPhaseKeys.has(phaseKey)) {
      return;
    }
    this.processedPhaseKeys.add(phaseKey);
    this.dispatchSteps += 1;
    if (this.dispatchSteps > this.maxDispatchSteps) {
      throw new UndergroundMessageDispatcherError(
        `Underground message dispatch exceeded maxDispatchSteps=${this.maxDispatchSteps}.`
      );
    }

    switch (message.type) {
      case "goal.received":
        return this.handleGoalReceived(message);
      case "underground.exploration_planned":
        return this.handleExplorationPlanned(message);
      case "rootlet_cluster.started":
        return this.handleRootletClusterStarted(message);
      case "exploration_candidate.produced":
        return this.handleExplorationCandidateProduced(message);
      case "candidate_pool.updated":
        return this.handleCandidatePoolUpdated(message);
      case "convergence_review.completed":
        return this.handleConvergenceReviewCompleted(message);
    }
  }

  private requiresAsyncHandler(message: ArborMessage): boolean {
    if (
      this.options.intelligenceChannel === undefined ||
      message.type !== "rootlet_cluster.started" ||
      !isUndergroundDispatchMessageType(message.type) ||
      this.result !== undefined ||
      this.processedMessageIds.has(message.id)
    ) {
      return false;
    }
    return !this.processedPhaseKeys.has(`${message.traceId}:${message.type}`);
  }

  private handleGoalReceived(message: ArborMessage): void {
    ensureMessageFromAgent(message, "user");
    const payload = readPayloadRecord(message);
    const goalId = readRequiredString(payload, "goalId", message.type);
    const rawGoal = readRequiredString(payload, "goal", message.type);
    ensureUndergroundAgentClusterManifests(this.options.runtime);

    const intentInvocation = startUndergroundAgentInvocation({
      agentId: "underground-intent-core",
      role: "intent_core",
      inputRefs: [goalId, message.id, "goal.received"],
    });
    const goalIntentProfile = createGoalIntentProfileForMinimalUnderground({
      goalId,
      rawGoal,
      constraints: this.options.runtime.constraints,
    });
    const completedIntentInvocation = completeUndergroundAgentInvocation(intentInvocation, [
      evidenceId(goalId, "goal-intent"),
    ]);
    const explorationPlan = createMinimalUndergroundExplorationPlan(goalId, goalIntentProfile);
    const agentClusterPlan = createUndergroundAgentClusterPlan({
      rawGoal,
      explorationPlan,
      goalIntentProfile,
    });
    const context: UndergroundTraceDispatchContext = {
      traceId: message.traceId,
      goalId,
      rawGoal,
      goalIntentProfile,
      explorationPlan,
      agentClusterPlan,
      centerInvocations: [completedIntentInvocation],
    };
    this.contextsByTraceId.set(message.traceId, context);

    publishUndergroundExplorationPlanned({
      runtime: this.options.runtime,
      traceId: message.traceId,
      agentId: completedIntentInvocation.agentId,
      plan: explorationPlan,
      agentCluster: {
        plan: agentClusterPlan,
        invocations: [completedIntentInvocation],
      },
    });
  }

  private handleExplorationPlanned(message: ArborMessage): void {
    const context = this.requireContext(message);
    const explorationPlan = requireValue(context.explorationPlan, "explorationPlan");
    const agentClusterPlan = requireValue(context.agentClusterPlan, "agentClusterPlan");
    const payload = readPayloadRecord(message);
    ensureMessageFromAgent(message, "underground-intent-core");
    ensurePayloadStringEquals(payload, "goalId", context.goalId, message.type);
    ensurePayloadStringEquals(payload, "planId", explorationPlan.planId, message.type);
    const growthInvocation = startUndergroundAgentInvocation({
      agentId: "underground-growth-governor",
      role: "growth_governor",
      inputRefs: [explorationPlan.planId, agentClusterPlan.planId, message.id],
    });
    const startedPlan = startRootletClusters(explorationPlan);
    const completedGrowthInvocation = completeUndergroundAgentInvocation(growthInvocation, [
      startedPlan.planId,
      ...startedPlan.rootletClusters.map((cluster) => cluster.clusterId),
    ]);
    const runningRootletInvocations = startedPlan.rootletClusters.map((cluster) =>
      startUndergroundAgentInvocation({
        agentId: undergroundRootletAgentId(cluster.kind),
        role: "rootlet_agent",
        inputRefs: [context.goalId, startedPlan.planId, cluster.clusterId, message.id],
      })
    );

    context.startedPlan = startedPlan;
    context.centerInvocations = [...context.centerInvocations, completedGrowthInvocation];
    context.runningRootletInvocations = runningRootletInvocations;
    context.runningHandoffInvocation = startUndergroundAgentInvocation({
      agentId: "underground-handoff-steward",
      role: "handoff_steward",
      inputRefs: [context.goalId, startedPlan.planId],
    });

    publishRootletClustersStarted({
      runtime: this.options.runtime,
      traceId: message.traceId,
      agentId: completedGrowthInvocation.agentId,
      plan: startedPlan,
      agentCluster: {
        plan: agentClusterPlan,
        invocations: [...context.centerInvocations, ...runningRootletInvocations],
      },
    });
  }

  private handleRootletClusterStarted(message: ArborMessage): void | Promise<void> {
    if (this.options.intelligenceChannel !== undefined) {
      return this.handleRootletClusterStartedAsync(message);
    }
    this.completeRootletHandler(message, []);
  }

  private async handleRootletClusterStartedAsync(message: ArborMessage): Promise<void> {
    const intelligenceChannel = requireValue(this.options.intelligenceChannel, "intelligenceChannel");
    const context = this.requireContext(message);
    const startedPlan = requireValue(context.startedPlan, "startedPlan");
    const runningRootletInvocations = requireValue(
      context.runningRootletInvocations,
      "runningRootletInvocations"
    );
    const modelRootletOutputs: RootletOutput[] = [];
    for (const cluster of startedPlan.rootletClusters) {
      if (cluster.kind !== "option") {
        continue;
      }
      const invocation = runningRootletInvocations.find(
        (candidate) => candidate.agentId === undergroundRootletAgentId(cluster.kind)
      );
      if (invocation === undefined) {
        continue;
      }
      modelRootletOutputs.push(
        ...(await requestUndergroundRootletCandidateAdvice({
          intelligenceChannel,
          traceId: message.traceId,
          goalId: context.goalId,
          goal: context.rawGoal,
          cluster,
          invocation,
          constraints: this.options.runtime.constraints,
        }))
      );
    }
    this.completeRootletHandler(message, modelRootletOutputs);
  }

  private completeRootletHandler(message: ArborMessage, modelRootletOutputs: readonly RootletOutput[]): void {
    const context = this.requireContext(message);
    const startedPlan = requireValue(context.startedPlan, "startedPlan");
    const agentClusterPlan = requireValue(context.agentClusterPlan, "agentClusterPlan");
    const runningRootletInvocations = requireValue(
      context.runningRootletInvocations,
      "runningRootletInvocations"
    );
    const payload = readPayloadRecord(message);
    ensureMessageFromAgent(message, "underground-growth-governor");
    ensurePayloadStringEquals(payload, "planId", startedPlan.planId, message.type);
    const deterministicRootletOutputs = produceMinimalRootletOutputs({
      plan: startedPlan,
      rootletInvocations: runningRootletInvocations,
      constraints: this.options.runtime.constraints,
      goalIntentProfile: context.goalIntentProfile,
    });
    const rootletOutputs = [...deterministicRootletOutputs, ...modelRootletOutputs];
    const completedRootletInvocations = completeUndergroundRootletInvocations(
      runningRootletInvocations,
      rootletOutputs
    );
    context.rootletOutputs = rootletOutputs;
    context.completedRootletInvocations = completedRootletInvocations;

    const invocations = [...context.centerInvocations, ...completedRootletInvocations];
    publishExplorationCandidatesProduced({
      runtime: this.options.runtime,
      traceId: message.traceId,
      agentId: firstRootletAgentId(completedRootletInvocations),
      rootletOutputs,
      agentCluster: {
        plan: agentClusterPlan,
        invocations,
      },
    });
  }

  private handleExplorationCandidateProduced(message: ArborMessage): void {
    const context = this.requireContext(message);
    const rootletOutputs = requireValue(context.rootletOutputs, "rootletOutputs");
    const completedRootletInvocations = requireValue(
      context.completedRootletInvocations,
      "completedRootletInvocations"
    );
    const agentClusterPlan = requireValue(context.agentClusterPlan, "agentClusterPlan");
    const payload = readPayloadRecord(message);
    ensureMessageFromOneOf(
      message,
      completedRootletInvocations
        .filter((invocation) => invocation.role === "rootlet_agent")
        .map((invocation) => invocation.agentId)
    );
    ensurePayloadRecordArrayStringIdsEqual(
      payload,
      "rootletOutputs",
      "outputId",
      rootletOutputs.map((output) => output.outputId),
      message.type
    );
    const invocationsBeforeConvergence = [...context.centerInvocations, ...completedRootletInvocations];
    const candidatePool = createMinimalCandidatePool({
      goalId: context.goalId,
      rootletOutputs,
      agentInvocations: invocationsBeforeConvergence,
    });
    context.candidatePool = candidatePool;

    publishCandidatePoolUpdated({
      runtime: this.options.runtime,
      traceId: message.traceId,
      agentId: "underground-growth-governor",
      candidatePool,
      agentCluster: {
        plan: agentClusterPlan,
        invocations: invocationsBeforeConvergence,
      },
    });
  }

  private handleCandidatePoolUpdated(message: ArborMessage): void {
    const context = this.requireContext(message);
    const startedPlan = requireValue(context.startedPlan, "startedPlan");
    const rootletOutputs = requireValue(context.rootletOutputs, "rootletOutputs");
    const candidatePool = requireValue(context.candidatePool, "candidatePool");
    const completedRootletInvocations = requireValue(
      context.completedRootletInvocations,
      "completedRootletInvocations"
    );
    const agentClusterPlan = requireValue(context.agentClusterPlan, "agentClusterPlan");
    const runningHandoffInvocation = requireValue(context.runningHandoffInvocation, "runningHandoffInvocation");
    const payload = readPayloadRecord(message);
    ensureMessageFromAgent(message, "underground-growth-governor");
    ensurePayloadRecordStringEquals(payload, "candidatePool", "poolId", candidatePool.poolId, message.type);
    const invocationsBeforeConvergence = [...context.centerInvocations, ...completedRootletInvocations];
    const convergenceInvocation = startUndergroundAgentInvocation({
      agentId: "underground-convergence-judge",
      role: "convergence_judge",
      inputRefs: [candidatePool.poolId, message.id],
    });
    const completedPlan = spendCandidateBudget(completeRootletClusters(startedPlan), rootletOutputs.length);
    const convergence = convergeDefaultUndergroundCandidatePool({
      goalId: context.goalId,
      agentId: convergenceInvocation.agentId,
      plan: completedPlan,
      goalIntentProfile: context.goalIntentProfile,
      constraints: this.options.runtime.constraints,
      rootletOutputs,
      candidatePool,
    });
    const completedConvergenceInvocation = completeUndergroundAgentInvocation(convergenceInvocation, [
      convergence.convergenceReport.reviewId,
    ]);
    const agentClusterRun: UndergroundAgentClusterRun = {
      runId: createId("underground-agent-cluster-run"),
      plan: agentClusterPlan,
      invocations: [
        ...invocationsBeforeConvergence,
        completedConvergenceInvocation,
        cloneUndergroundAgentInvocation(runningHandoffInvocation),
      ],
      terminalStatus: "running",
      candidateRefs: [...convergence.convergenceReport.handoffCandidateRefs],
      startedAt: context.centerInvocations[0]?.startedAt ?? completedConvergenceInvocation.startedAt,
    };
    const undergroundReport = createUndergroundExplorationReport({
      plan: completedPlan,
      agentClusterRun,
      goalIntentProfile: context.goalIntentProfile,
      evidenceLedger: convergence.evidenceLedger,
      rootletOutputs: [...rootletOutputs],
      candidatePool: convergence.candidatePool,
      convergenceReport: convergence.convergenceReport,
    });

    context.completedPlan = completedPlan;
    context.candidatePool = convergence.candidatePool;
    context.convergenceReport = convergence.convergenceReport;
    context.evidenceLedger = convergence.evidenceLedger;
    context.agentClusterRun = agentClusterRun;
    context.undergroundReport = undergroundReport;

    publishConvergenceReviewCompleted({
      runtime: this.options.runtime,
      traceId: message.traceId,
      agentId: completedConvergenceInvocation.agentId,
      convergenceReport: convergence.convergenceReport,
      candidatePool: convergence.candidatePool,
      undergroundReport,
      agentCluster: {
        plan: agentClusterPlan,
        run: agentClusterRun,
        invocations: agentClusterRun.invocations,
      },
    });
  }

  private handleConvergenceReviewCompleted(message: ArborMessage): void {
    const context = this.requireContext(message);
    const candidatePool = requireValue(context.candidatePool, "candidatePool");
    const convergenceReport = requireValue(context.convergenceReport, "convergenceReport");
    const pendingAgentClusterRun = requireValue(context.agentClusterRun, "agentClusterRun");
    const completedPlan = requireValue(context.completedPlan, "completedPlan");
    const rootletOutputs = requireValue(context.rootletOutputs, "rootletOutputs");
    const payload = readPayloadRecord(message);
    ensureMessageFromAgent(message, "underground-convergence-judge");
    ensurePayloadRecordStringEquals(
      payload,
      "convergenceReport",
      "reviewId",
      convergenceReport.reviewId,
      message.type
    );
    const materialInput = {
      goalId: context.goalId,
      goal: context.rawGoal,
      producedByAgentId: "underground-handoff-steward",
      constraints: this.options.runtime.constraints as Constraint[],
      goalIntentProfile: context.goalIntentProfile,
      candidatePool,
      convergenceReport,
    };
    const material =
      convergenceReport.outcome === "approved"
        ? createMinimalDirectionMaterial(materialInput)
        : convergenceReport.outcome === "awaiting_user"
          ? createAwaitingUserDirectionMaterial(materialInput)
          : createStoppedDirectionMaterial(materialInput);
    const directionHandoffPackage = this.options.runtime.directionHandoffPackageStore.save(
      material.directionHandoffPackage
    );
    const loadedDirectionHandoffPackage = this.options.runtime.directionHandoffPackageStore.load(
      directionHandoffPackage.manifest.directionId,
      directionHandoffPackage.manifest.directionVersion
    );
    const directionHandoffPackageRef = createDirectionHandoffPackageRef(loadedDirectionHandoffPackage);
    const terminalStatus = terminalStatusForConvergence(convergenceReport.outcome);
    const agentClusterRun = finalizeUndergroundAgentClusterRun({
      run: pendingAgentClusterRun,
      terminalStatus,
      candidateRefs: convergenceReport.handoffCandidateRefs,
      packageRef: directionHandoffPackageRef,
      stopReason: convergenceReport.stopReason,
    });
    const undergroundReport = createUndergroundExplorationReport({
      plan: completedPlan,
      agentClusterRun,
      goalIntentProfile: context.goalIntentProfile,
      evidenceLedger: context.evidenceLedger,
      rootletOutputs: [...rootletOutputs],
      candidatePool,
      convergenceReport,
    });

    this.result = {
      terminalStatus,
      undergroundReport,
      directionHandoff: material.directionHandoff,
      directionHandoffPackage,
      directionHandoffPackageRef,
      loadedDirectionHandoffPackage,
      processedMessageIds: [...this.processedMessageIds],
      dispatchSteps: this.dispatchSteps,
    };

    if (terminalStatus === "approved_package_created") {
      this.options.runtime.bus.publish(
        createMessage({
          traceId: message.traceId,
          from: { id: "underground-handoff-steward", role: "underground_center" },
          to: { role: "aboveground_center" },
          type: "direction_handoff.completed",
          intent: "complete_direction_handoff",
          payload: {
            goalId: context.goalId,
            directionHandoff: material.directionHandoff,
            directionPackage: directionHandoffPackageRef,
            agentCluster: {
              plan: agentClusterRun.plan,
              run: agentClusterRun,
              invocation: agentClusterRun.invocations.find((invocation) => invocation.role === "handoff_steward"),
              invocations: agentClusterRun.invocations,
            },
          },
        })
      );
    } else if (terminalStatus === "awaiting_user" && "clarificationRequest" in material) {
      this.options.runtime.bus.publish(
        createMessage({
          traceId: message.traceId,
          from: { id: "underground-handoff-steward", role: "underground_center" },
          to: { role: "user" },
          type: "user_approval.requested",
          intent: "request_user_clarification",
          payload: {
            goalId: context.goalId,
            clarificationRequest: material.clarificationRequest,
            directionPackage: directionHandoffPackageRef,
            convergenceReport: {
              reviewId: convergenceReport.reviewId,
              outcome: convergenceReport.outcome,
            },
            agentCluster: {
              plan: agentClusterRun.plan,
              run: agentClusterRun,
              invocation: agentClusterRun.invocations.find((invocation) => invocation.role === "handoff_steward"),
              invocations: agentClusterRun.invocations,
            },
          },
        })
      );
    }
  }

  private requireContext(message: ArborMessage): UndergroundTraceDispatchContext {
    const context = this.contextsByTraceId.get(message.traceId);
    if (context === undefined) {
      throw new UndergroundMessageDispatcherError(
        `Underground dispatcher received ${message.type} before goal.received for trace ${message.traceId}.`
      );
    }
    return context;
  }
}

function isUndergroundDispatchMessageType(type: ArborMessageType): type is UndergroundDispatchMessageType {
  return UNDERGROUND_DISPATCH_MESSAGE_TYPES.some((candidate) => candidate === type);
}

function isPromiseLike(value: void | Promise<void>): value is Promise<void> {
  return typeof value === "object" && value !== null && "then" in value;
}

function readPayloadRecord(message: ArborMessage): Readonly<Record<string, unknown>> {
  if (typeof message.payload !== "object" || message.payload === null || Array.isArray(message.payload)) {
    throw new UndergroundMessageDispatcherError(`${message.type} payload must be a structured object.`);
  }
  return message.payload as Readonly<Record<string, unknown>>;
}

function readRequiredString(
  payload: Readonly<Record<string, unknown>>,
  key: string,
  eventType: ArborMessageType
): string {
  const value = payload[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new UndergroundMessageDispatcherError(`${eventType} payload requires string field ${key}.`);
  }
  return value;
}

function ensureMessageFromAgent(message: ArborMessage, expectedAgentId: string): void {
  if (message.from.id !== expectedAgentId) {
    throw new UndergroundMessageDispatcherError(
      `${message.type} must be published by ${expectedAgentId}; received from ${message.from.id}.`
    );
  }
}

function ensureMessageFromOneOf(message: ArborMessage, expectedAgentIds: readonly string[]): void {
  if (!expectedAgentIds.includes(message.from.id)) {
    throw new UndergroundMessageDispatcherError(
      `${message.type} must be published by one of [${expectedAgentIds.join(", ")}]; received from ${message.from.id}.`
    );
  }
}

function ensurePayloadStringEquals(
  payload: Readonly<Record<string, unknown>>,
  key: string,
  expected: string,
  eventType: ArborMessageType
): void {
  const value = readRequiredString(payload, key, eventType);
  if (value !== expected) {
    throw new UndergroundMessageDispatcherError(
      `${eventType} payload field ${key} must equal ${expected}; received ${value}.`
    );
  }
}

function ensurePayloadRecordStringEquals(
  payload: Readonly<Record<string, unknown>>,
  key: string,
  nestedKey: string,
  expected: string,
  eventType: ArborMessageType
): void {
  const record = readRequiredRecord(payload, key, eventType);
  ensurePayloadStringEquals(record, nestedKey, expected, eventType);
}

function ensurePayloadRecordArrayStringIdsEqual(
  payload: Readonly<Record<string, unknown>>,
  key: string,
  nestedKey: string,
  expected: readonly string[],
  eventType: ArborMessageType
): void {
  const records = readRequiredRecordArray(payload, key, eventType);
  const actual = records.map((record) => readRequiredString(record, nestedKey, eventType));
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new UndergroundMessageDispatcherError(
      `${eventType} payload field ${key}.${nestedKey} must match dispatcher context.`
    );
  }
}

function readRequiredRecord(
  payload: Readonly<Record<string, unknown>>,
  key: string,
  eventType: ArborMessageType
): Readonly<Record<string, unknown>> {
  const value = payload[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new UndergroundMessageDispatcherError(`${eventType} payload requires object field ${key}.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function readRequiredRecordArray(
  payload: Readonly<Record<string, unknown>>,
  key: string,
  eventType: ArborMessageType
): ReadonlyArray<Readonly<Record<string, unknown>>> {
  const value = payload[key];
  if (!Array.isArray(value)) {
    throw new UndergroundMessageDispatcherError(`${eventType} payload requires array field ${key}.`);
  }
  return value.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new UndergroundMessageDispatcherError(`${eventType} payload array ${key} must contain objects.`);
    }
    return item as Readonly<Record<string, unknown>>;
  });
}

function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new UndergroundMessageDispatcherError(`Underground dispatch context missing ${label}.`);
  }
  return value;
}

function firstRootletAgentId(invocations: readonly UndergroundAgentInvocation[]): string {
  return invocations.find((invocation) => invocation.role === "rootlet_agent")?.agentId ?? "underground-rootlet-option";
}

function terminalStatusForConvergence(
  outcome: UndergroundExplorationReport["convergenceReport"]["outcome"]
): UndergroundMessageDrivenDispatchResult["terminalStatus"] {
  switch (outcome) {
    case "approved":
      return "approved_package_created";
    case "awaiting_user":
      return "awaiting_user";
    case "stopped":
      return "stopped";
  }
}
