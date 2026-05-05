import type { ArborMessage } from "../../../domain/common.js";
import type {
  CandidatePool,
  GoalIntentProfile,
  RootletOutput,
  UndergroundAgentClusterPlan,
  UndergroundAgentClusterRun,
  UndergroundAgentInvocation,
  UndergroundAutonomyReview,
  UndergroundAutonomyDecision,
  UndergroundConvergenceAiAdvisory,
  UndergroundExplorationCycle,
  UndergroundExplorationPlan,
} from "../../../domain/underground/index.js";
import { createId } from "../../../kernel/id.js";
import {
  completeUndergroundAgentInvocation,
  convergeDefaultUndergroundCandidatePool,
  startUndergroundAgentInvocation,
} from "../../underground-agent-cluster-runtime.js";
import {
  completeRootletClusters,
  createUndergroundExplorationReport,
  spendCandidateBudget,
} from "../../minimal-underground.js";
import { convergeAutonomyTerminalCandidatePool } from "../../underground-convergence.js";
import { publishConvergenceReviewCompleted } from "../../underground-events.js";
import { requestConvergenceAiAdvisoryForCandidatePool } from "../convergence-intelligence.js";
import type { UndergroundAgent, UndergroundAgentContext } from "./agent-context.js";
import {
  ensureMessageFromAgent,
  ensurePayloadRecordStringEquals,
  ensurePayloadStringEquals,
  readPayloadRecord,
  requireValue,
} from "./agent-context.js";

export class ConvergenceJudgeAgent implements UndergroundAgent {
  readonly agentId = "underground-convergence-judge";
  private subscriptions: Array<() => void> = [];

  start(ctx: UndergroundAgentContext): void {
    if (ctx.autonomyEnabled) {
      this.subscriptions.push(
        ctx.subscribe(
          this.agentId,
          "convergence_review.requested",
          (message) => this.handleConvergenceReviewRequested(ctx, message),
          { requiresAsync: () => ctx.agentTurnRuntime !== undefined }
        )
      );
      return;
    }
    this.subscriptions.push(
      ctx.subscribe(this.agentId, "candidate_pool.updated", (message) =>
        this.handleConvergenceReviewRequested(ctx, message)
      )
    );
  }

  stop(): void {
    for (const unsubscribe of this.subscriptions) {
      unsubscribe();
    }
    this.subscriptions = [];
  }

  private handleConvergenceReviewRequested(ctx: UndergroundAgentContext, message: ArborMessage): void | Promise<void> {
    const input = this.prepareConvergenceInput(ctx, message);
    const autonomyDecision = input.autonomyDecision;

    if (isTerminalAutonomyDecision(autonomyDecision)) {
      this.completeTerminalConvergence(ctx, { ...input, autonomyDecision });
      return;
    }

    if (ctx.agentTurnRuntime === undefined) {
      this.completeConvergence(ctx, input);
      return;
    }

    return this.handleCandidatePoolUpdatedWithAdvisory(ctx, input);
  }

  private async handleCandidatePoolUpdatedWithAdvisory(
    ctx: UndergroundAgentContext,
    input: PreparedConvergenceJudgeInput
  ): Promise<void> {
    const aiAdvisory = await requestConvergenceAiAdvisoryForCandidatePool({
      agentTurnRuntime: ctx.agentTurnRuntime!,
      traceId: input.message.traceId,
      goalId: input.goalId,
      goal: input.rawGoal,
      goalIntentProfile: input.goalIntentProfile,
      candidatePool: input.candidatePool,
      rootletOutputs: input.rootletOutputs,
      constraints: ctx.runtime.constraints,
    });
    this.completeConvergence(ctx, { ...input, aiAdvisory });
  }

  private prepareConvergenceInput(
    ctx: UndergroundAgentContext,
    message: ArborMessage
  ): PreparedConvergenceJudgeInput {
    const state = ctx.shared.snapshot();
    const goalId = requireValue(state.goalId, "goalId");
    const rawGoal = requireValue(state.rawGoal, "rawGoal");
    const startedPlan = requireValue(state.startedPlan, "startedPlan");
    const rootletOutputs = state.rootletOutputs;
    const candidatePool = requireValue(state.candidatePool, "candidatePool");
    const candidatePoolInvocation = requireValue(state.candidatePoolInvocation, "candidatePoolInvocation");
    const agentClusterPlan = requireValue(state.agentClusterPlan, "agentClusterPlan");
    const payload = readPayloadRecord(message);
    ensureMessageFromAgent(
      message,
      ctx.autonomyEnabled ? "underground-autonomy-core" : "underground-candidate-pool"
    );
    ensurePayloadStringEquals(payload, "goalId", goalId, message.type);
    ensurePayloadStringEquals(payload, "planId", startedPlan.planId, message.type);
    ensurePayloadRecordStringEquals(payload, "candidatePool", "poolId", candidatePool.poolId, message.type);
    const autonomyDecision = ctx.autonomyEnabled
      ? requireLatestAutonomyDecision({
          message,
          payload,
          state,
        })
      : undefined;

    return {
      message,
      goalId,
      rawGoal,
      startedPlan,
      rootletOutputs,
      candidatePool,
      candidatePoolInvocation,
      agentClusterPlan,
      centerInvocations: state.centerInvocations,
      completedRootletInvocations: state.completedRootletInvocations,
      completedAutonomyInvocations: state.completedAutonomyInvocations,
      autonomyReview: state.autonomyReview,
      autonomyDecision,
      currentCycle: state.currentCycle,
      goalIntentProfile: state.goalIntentProfile,
    };
  }

  private completeTerminalConvergence(
    ctx: UndergroundAgentContext,
    input: PreparedConvergenceJudgeInput & { readonly autonomyDecision: UndergroundAutonomyDecision }
  ): void {
    const invocationsBeforeConvergence = [
      ...input.centerInvocations,
      ...input.completedRootletInvocations,
      input.candidatePoolInvocation,
      ...input.completedAutonomyInvocations,
    ];
    const convergenceInvocation = startUndergroundAgentInvocation({
      agentId: this.agentId,
      role: "convergence_judge",
      inputRefs: [input.candidatePool.poolId, input.message.id, input.autonomyDecision.decisionId],
    });
    const completedPlan = spendCandidateBudget(completeRootletClusters(input.startedPlan), input.rootletOutputs.length);
    const convergence = convergeAutonomyTerminalCandidatePool({
      pool: input.candidatePool,
      plan: completedPlan,
      leadAgentId: convergenceInvocation.agentId,
      rootletOutputs: input.rootletOutputs,
      goalIntentProfile: input.goalIntentProfile,
      constraints: ctx.runtime.constraints,
      autonomyDecision: input.autonomyDecision,
    });
    const completedConvergenceInvocation = completeUndergroundAgentInvocation(convergenceInvocation, [
      convergence.convergenceReport.reviewId,
    ]);
    const agentClusterRun: UndergroundAgentClusterRun = {
      runId: createId("underground-agent-cluster-run"),
      plan: input.agentClusterPlan,
      invocations: [
        ...invocationsBeforeConvergence,
        completedConvergenceInvocation,
      ],
      terminalStatus: "running",
      candidateRefs: [...convergence.convergenceReport.handoffCandidateRefs],
      startedAt: input.centerInvocations[0]?.startedAt ?? completedConvergenceInvocation.startedAt,
      stopReason: convergence.convergenceReport.stopReason,
    };
    const undergroundReport = createUndergroundExplorationReport({
      plan: completedPlan,
      agentClusterRun,
      goalIntentProfile: input.goalIntentProfile,
      evidenceLedger: convergence.evidenceLedger,
      autonomy: input.autonomyReview,
      rootletOutputs: [...input.rootletOutputs],
      candidatePool: convergence.candidatePool,
      convergenceReport: convergence.convergenceReport,
    });

    ctx.shared.write(this.agentId, {
      convergenceReport: convergence.convergenceReport,
      evidenceLedger: convergence.evidenceLedger,
      agentClusterRun,
      undergroundReport,
    });

    publishConvergenceReviewCompleted({
      runtime: ctx.runtime,
      traceId: input.message.traceId,
      agentId: completedConvergenceInvocation.agentId,
      goalId: input.goalId,
      planId: completedPlan.planId,
      convergenceReport: convergence.convergenceReport,
      candidatePool: convergence.candidatePool,
      undergroundReport,
      cycle: input.currentCycle,
      agentCluster: {
        plan: input.agentClusterPlan,
        run: agentClusterRun,
        invocations: agentClusterRun.invocations,
      },
    });
  }

  private completeConvergence(
    ctx: UndergroundAgentContext,
    input: PreparedConvergenceJudgeInput & { readonly aiAdvisory?: UndergroundConvergenceAiAdvisory }
  ): void {
    const invocationsBeforeConvergence = [
      ...input.centerInvocations,
      ...input.completedRootletInvocations,
      input.candidatePoolInvocation,
      ...input.completedAutonomyInvocations,
    ];
    const convergenceInvocation = startUndergroundAgentInvocation({
      agentId: this.agentId,
      role: "convergence_judge",
      inputRefs: [input.candidatePool.poolId, input.message.id],
    });
    const completedPlan = spendCandidateBudget(completeRootletClusters(input.startedPlan), input.rootletOutputs.length);
    const convergence = convergeDefaultUndergroundCandidatePool({
      goalId: input.goalId,
      agentId: convergenceInvocation.agentId,
      plan: completedPlan,
      goalIntentProfile: input.goalIntentProfile,
      constraints: ctx.runtime.constraints,
      rootletOutputs: input.rootletOutputs,
      candidatePool: input.candidatePool,
      aiAdvisory: input.aiAdvisory,
    });
    const completedConvergenceInvocation = completeUndergroundAgentInvocation(convergenceInvocation, [
      convergence.convergenceReport.reviewId,
    ]);
    const agentClusterRun: UndergroundAgentClusterRun = {
      runId: createId("underground-agent-cluster-run"),
      plan: input.agentClusterPlan,
      invocations: [
        ...invocationsBeforeConvergence,
        completedConvergenceInvocation,
      ],
      terminalStatus: "running",
      candidateRefs: [...convergence.convergenceReport.handoffCandidateRefs],
      startedAt: input.centerInvocations[0]?.startedAt ?? completedConvergenceInvocation.startedAt,
    };
    const undergroundReport = createUndergroundExplorationReport({
      plan: completedPlan,
      agentClusterRun,
      goalIntentProfile: input.goalIntentProfile,
      evidenceLedger: convergence.evidenceLedger,
      autonomy: input.autonomyReview,
      rootletOutputs: [...input.rootletOutputs],
      candidatePool: convergence.candidatePool,
      convergenceReport: convergence.convergenceReport,
    });

    ctx.shared.write(this.agentId, {
      convergenceReport: convergence.convergenceReport,
      evidenceLedger: convergence.evidenceLedger,
      agentClusterRun,
      undergroundReport,
    });

    publishConvergenceReviewCompleted({
      runtime: ctx.runtime,
      traceId: input.message.traceId,
      agentId: completedConvergenceInvocation.agentId,
      goalId: input.goalId,
      planId: completedPlan.planId,
      convergenceReport: convergence.convergenceReport,
      candidatePool: convergence.candidatePool,
      undergroundReport,
      cycle: input.currentCycle,
      agentCluster: {
        plan: input.agentClusterPlan,
        run: agentClusterRun,
        invocations: agentClusterRun.invocations,
      },
    });
  }
}

type PreparedConvergenceJudgeInput = {
  readonly message: ArborMessage;
  readonly goalId: string;
  readonly rawGoal: string;
  readonly startedPlan: UndergroundExplorationPlan;
  readonly rootletOutputs: readonly RootletOutput[];
  readonly candidatePool: CandidatePool;
  readonly candidatePoolInvocation: UndergroundAgentInvocation;
  readonly agentClusterPlan: UndergroundAgentClusterPlan;
  readonly centerInvocations: readonly UndergroundAgentInvocation[];
  readonly completedRootletInvocations: readonly UndergroundAgentInvocation[];
  readonly completedAutonomyInvocations: readonly UndergroundAgentInvocation[];
  readonly autonomyReview?: UndergroundAutonomyReview;
  readonly autonomyDecision?: UndergroundAutonomyDecision;
  readonly currentCycle?: UndergroundExplorationCycle;
  readonly goalIntentProfile?: GoalIntentProfile;
};

function requireLatestAutonomyDecision(input: {
  readonly message: ArborMessage;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly state: ReturnType<UndergroundAgentContext["shared"]["snapshot"]>;
}): UndergroundAutonomyDecision {
  const latestDecision = input.state.autonomyReview?.latestDecision;
  if (latestDecision === undefined) {
    throw new Error("convergence_review.requested requires a latest autonomy decision.");
  }
  ensurePayloadStringEquals(input.payload, "autonomyDecisionId", latestDecision.decisionId, input.message.type);
  ensurePayloadStringEquals(input.payload, "autonomyAction", latestDecision.action, input.message.type);
  ensurePayloadStringEquals(input.payload, "explorationCycleId", latestDecision.cycleId, input.message.type);
  return latestDecision;
}

function isTerminalAutonomyDecision(
  decision: UndergroundAutonomyDecision | undefined
): decision is UndergroundAutonomyDecision {
  return decision !== undefined && (decision.status !== "completed" || decision.action !== "request_convergence");
}
