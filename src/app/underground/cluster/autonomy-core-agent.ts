import type { ArborMessage } from "../../../domain/common.js";
import {
  UNDERGROUND_CENTER_ROLES,
  type CandidatePool,
  type RootletClusterPlan,
  type UndergroundAgentClusterPlan,
  type UndergroundAgentInvocation,
  type UndergroundAutonomyDecision,
  type UndergroundExplorationCycle,
  type UndergroundExplorationPlan,
} from "../../../domain/underground/index.js";
import { createId, nowIso } from "../../../kernel/id.js";
import {
  completeUndergroundAgentInvocation,
  startUndergroundAgentInvocation,
} from "../../underground-agent-cluster-runtime.js";
import { undergroundRootletAgentId } from "../../agents/manifests.js";
import { createSpawnedRootletClusterPlan, startRootletClusters } from "../../underground-rootlets.js";
import {
  publishAutonomyReviewCompleted,
  publishConvergenceReviewRequested,
  publishRootletClustersStarted,
} from "../../underground-events.js";
import { failedAutonomyDecision, requestUndergroundAutonomyDecision } from "../autonomy-intelligence.js";
import type { UndergroundAgent, UndergroundAgentContext } from "./agent-context.js";
import {
  ensureMessageFromAgent,
  ensurePayloadRecordStringEquals,
  ensurePayloadStringEquals,
  readPayloadRecord,
  requireValue,
} from "./agent-context.js";

export class AutonomyCoreAgent implements UndergroundAgent {
  readonly agentId = "underground-autonomy-core";
  private subscriptions: Array<() => void> = [];

  start(ctx: UndergroundAgentContext): void {
    this.subscriptions.push(
      ctx.subscribe(
        this.agentId,
        "candidate_pool.updated",
        (message) => this.handleCandidatePoolUpdated(ctx, message),
        { requiresAsync: () => ctx.agentTurnRuntime !== undefined }
      )
    );
  }

  stop(): void {
    for (const unsubscribe of this.subscriptions) {
      unsubscribe();
    }
    this.subscriptions = [];
  }

  private handleCandidatePoolUpdated(ctx: UndergroundAgentContext, message: ArborMessage): void | Promise<void> {
    const state = ctx.shared.snapshot();
    const goalId = requireValue(state.goalId, "goalId");
    const rawGoal = requireValue(state.rawGoal, "rawGoal");
    const startedPlan = requireValue(state.startedPlan, "startedPlan");
    const candidatePool = requireValue(state.candidatePool, "candidatePool");
    const agentClusterPlan = requireValue(state.agentClusterPlan, "agentClusterPlan");
    const currentCycle = requireValue(state.currentCycle, "currentCycle");
    const payload = readPayloadRecord(message);
    ensureMessageFromAgent(message, "underground-candidate-pool");
    ensurePayloadStringEquals(payload, "goalId", goalId, message.type);
    ensurePayloadStringEquals(payload, "planId", startedPlan.planId, message.type);
    ensurePayloadRecordStringEquals(payload, "candidatePool", "poolId", candidatePool.poolId, message.type);

    const autonomyInvocation = startUndergroundAgentInvocation({
      agentId: this.agentId,
      role: "autonomy_core",
      inputRefs: [candidatePool.poolId, currentCycle.explorationCycleId, message.id],
    });
    const decisionInput = {
      agentTurnRuntime: ctx.agentTurnRuntime,
      traceId: message.traceId,
      goalId,
      goal: rawGoal,
      goalIntentProfile: state.goalIntentProfile,
      candidatePool,
      rootletOutputs: state.rootletOutputs,
      constraints: ctx.runtime.constraints,
      cycle: currentCycle,
      cycles: state.autonomyCycles.length === 0 ? [currentCycle] : state.autonomyCycles,
      maxCycles: ctx.maxAutonomyCycles,
    };

    if (ctx.agentTurnRuntime === undefined) {
      this.completeAutonomyDecision(ctx, message, {
        goalId,
        startedPlan,
        candidatePool,
        agentClusterPlan,
        currentCycle,
        state,
        autonomyInvocation,
        decision: failedAutonomyDecision({
          decisionId: createId("autonomy-decision"),
          cycleId: currentCycle.explorationCycleId,
          candidatePoolId: candidatePool.poolId,
          reason: "ai_required_for_autonomy",
          rationale: "Autonomy review is AI-required and no AgentTurnRuntime was provided.",
        }),
      });
      return;
    }

    return requestUndergroundAutonomyDecision(decisionInput).then((decision) =>
      this.completeAutonomyDecision(ctx, message, {
        goalId,
        startedPlan,
        candidatePool,
        agentClusterPlan,
        currentCycle,
        state,
        autonomyInvocation,
        decision,
      })
    );
  }

  private completeAutonomyDecision(
    ctx: UndergroundAgentContext,
    message: ArborMessage,
    input: {
      readonly goalId: string;
      readonly startedPlan: UndergroundExplorationPlan;
      readonly candidatePool: CandidatePool;
      readonly agentClusterPlan: UndergroundAgentClusterPlan;
      readonly currentCycle: UndergroundExplorationCycle;
      readonly state: ReturnType<UndergroundAgentContext["shared"]["snapshot"]>;
      readonly autonomyInvocation: UndergroundAgentInvocation;
      readonly decision: UndergroundAutonomyDecision;
    }
  ): void {
    const { goalId, startedPlan, candidatePool, agentClusterPlan, currentCycle, state, autonomyInvocation, decision } =
      input;
    const completedAutonomyInvocation = completeUndergroundAgentInvocation(autonomyInvocation, [decision.decisionId]);
    const updatedCurrentCycle = updateCycleAfterDecision(currentCycle, candidatePool.poolId, decision);
    const cyclesAfterDecision = upsertCycle(state.autonomyCycles, updatedCurrentCycle);
    const autonomyDecisions = [...state.autonomyDecisions, decision];
    const autonomyReview = {
      enabled: true,
      latestDecision: decision,
      decisions: autonomyDecisions,
      cycles: cyclesAfterDecision,
      stopReason: decision.stopReason,
    };

    ctx.shared.write(this.agentId, {
      currentCycle: updatedCurrentCycle,
      autonomyCycles: cyclesAfterDecision,
      autonomyDecisions,
      autonomyReview,
      completedAutonomyInvocations: [...state.completedAutonomyInvocations, completedAutonomyInvocation],
    });

    publishAutonomyReviewCompleted({
      runtime: ctx.runtime,
      traceId: message.traceId,
      agentId: completedAutonomyInvocation.agentId,
      goalId,
      planId: startedPlan.planId,
      candidatePool,
      autonomyDecision: decision,
      cycle: currentCycle,
      agentCluster: {
        plan: agentClusterPlan,
        invocations: [
          ...state.centerInvocations,
          ...state.completedRootletInvocations,
          requireValue(state.candidatePoolInvocation, "candidatePoolInvocation"),
          completedAutonomyInvocation,
        ],
      },
    });

    if (decision.action === "continue_exploration") {
      this.startNextExplorationCycle(ctx, {
        traceId: message.traceId,
        goalId,
        decision,
        previousCycles: cyclesAfterDecision,
      });
      return;
    }

    publishConvergenceReviewRequested({
      runtime: ctx.runtime,
      traceId: message.traceId,
      agentId: this.agentId,
      goalId,
      planId: startedPlan.planId,
      candidatePool,
      autonomyDecision: decision,
      cycle: currentCycle,
      agentCluster: {
        plan: agentClusterPlan,
        invocations: [
          ...state.centerInvocations,
          ...state.completedRootletInvocations,
          requireValue(state.candidatePoolInvocation, "candidatePoolInvocation"),
          completedAutonomyInvocation,
        ],
      },
    });
  }

  private startNextExplorationCycle(
    ctx: UndergroundAgentContext,
    input: {
      readonly traceId: string;
      readonly goalId: string;
      readonly decision: UndergroundAutonomyDecision;
      readonly previousCycles: readonly UndergroundExplorationCycle[];
    }
  ): void {
    const state = ctx.shared.snapshot();
    const goalIntentProfile = requireValue(state.goalIntentProfile, "goalIntentProfile");
    const agentClusterPlan = requireValue(state.agentClusterPlan, "agentClusterPlan");
    const rootletClusters = input.decision.spawnRequests.map((request) =>
      createSpawnedRootletClusterPlan({
        kind: request.rootletKind,
        goalIntentProfile,
        objective: request.objective,
        inputRefs: [
          goalIntentProfile.goalId,
          input.decision.decisionId,
          request.requestId,
          ...request.sourceHints,
        ],
        exitCriteria:
          request.expectedEvidence.length === 0
            ? request.informationNeeds
            : request.expectedEvidence,
      })
    );
    const nextPlan = startRootletClusters(createCycleExplorationPlan({
      goalId: input.goalId,
      rootletClusters,
    }));
    const nextCycle: UndergroundExplorationCycle = {
      explorationCycleId: createId("exploration-cycle"),
      cycleIndex: input.previousCycles.length + 1,
      rootletKinds: rootletClusters.map((cluster) => cluster.kind),
      spawnedRootletCount: rootletClusters.length,
      status: "running",
    };
    const runningRootletInvocations = nextPlan.rootletClusters.map((cluster) =>
      startUndergroundAgentInvocation({
        agentId: undergroundRootletAgentId(cluster.kind),
        role: "rootlet_agent",
        inputRefs: [input.goalId, nextPlan.planId, cluster.clusterId, input.decision.decisionId],
      })
    );
    const nextCycles = [...input.previousCycles, nextCycle];

    ctx.shared.write(this.agentId, {
      currentCycle: nextCycle,
      autonomyCycles: nextCycles,
      startedPlan: nextPlan,
      runningRootletInvocations,
      expectedRootletKinds: nextPlan.rootletClusters.map((cluster) => cluster.kind),
    });

    publishRootletClustersStarted({
      runtime: ctx.runtime,
      traceId: input.traceId,
      agentId: this.agentId,
      plan: nextPlan,
      cycle: nextCycle,
      agentCluster: {
        plan: agentClusterPlan,
        invocations: [
          ...state.centerInvocations,
          ...state.completedRootletInvocations,
          ...state.completedAutonomyInvocations,
          ...runningRootletInvocations,
        ],
      },
    });
  }
}

function createCycleExplorationPlan(input: {
  readonly goalId: string;
  readonly rootletClusters: readonly RootletClusterPlan[];
}): UndergroundExplorationPlan {
  const maxCandidateOutputs = input.rootletClusters.reduce(
    (total, cluster) => total + cluster.budget.maxCandidateOutputs,
    0
  );
  return {
    planId: createId("underground-plan-cycle"),
    goalId: input.goalId,
    centerRoles: UNDERGROUND_CENTER_ROLES,
    budget: {
      maxRootletClusters: input.rootletClusters.length,
      maxCandidateOutputs,
      spentRootletClusters: 0,
      spentCandidateOutputs: 0,
      exhausted: false,
    },
    rootletClusters: input.rootletClusters.map((cluster) => ({ ...cluster })),
    createdAt: nowIso(),
  };
}

function updateCycleAfterDecision(
  cycle: UndergroundExplorationCycle,
  candidatePoolId: string,
  decision: UndergroundAutonomyDecision
): UndergroundExplorationCycle {
  return {
    ...cycle,
    candidatePoolId,
    autonomyDecisionId: decision.decisionId,
    action: decision.action,
    spawnedRootletCount: decision.spawnRequests.length,
    stopReason: decision.stopReason,
    status:
      decision.status === "failed" || decision.stopReason !== undefined
        ? "failed"
        : decision.action === "stop"
          ? "stopped"
          : "completed",
  };
}

function upsertCycle(
  cycles: readonly UndergroundExplorationCycle[],
  cycle: UndergroundExplorationCycle
): UndergroundExplorationCycle[] {
  const withoutCurrent = cycles.filter((candidate) => candidate.explorationCycleId !== cycle.explorationCycleId);
  return [...withoutCurrent, cycle].sort((left, right) => left.cycleIndex - right.cycleIndex);
}
