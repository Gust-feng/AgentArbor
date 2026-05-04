import type { ArborMessage } from "../../../domain/common.js";
import type {
  CandidatePool,
  GoalIntentProfile,
  RootletOutput,
  UndergroundAgentClusterPlan,
  UndergroundAgentClusterRun,
  UndergroundAgentInvocation,
  UndergroundConvergenceAiAdvisory,
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
    this.subscriptions.push(
      ctx.subscribe(this.agentId, "candidate_pool.updated", (message) =>
        this.handleCandidatePoolUpdated(ctx, message)
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
    const input = this.prepareConvergenceInput(ctx, message);

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
    ensureMessageFromAgent(message, "underground-candidate-pool");
    ensurePayloadStringEquals(payload, "goalId", goalId, message.type);
    ensurePayloadStringEquals(payload, "planId", startedPlan.planId, message.type);
    ensurePayloadRecordStringEquals(payload, "candidatePool", "poolId", candidatePool.poolId, message.type);

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
      goalIntentProfile: state.goalIntentProfile,
    };
  }

  private completeConvergence(
    ctx: UndergroundAgentContext,
    input: PreparedConvergenceJudgeInput & { readonly aiAdvisory?: UndergroundConvergenceAiAdvisory }
  ): void {
    const invocationsBeforeConvergence = [
      ...input.centerInvocations,
      ...input.completedRootletInvocations,
      input.candidatePoolInvocation,
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
  readonly goalIntentProfile?: GoalIntentProfile;
};
