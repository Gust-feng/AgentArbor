import type { ArborMessage } from "../../../domain/common.js";
import type { UndergroundAgentClusterRun } from "../../../domain/underground/index.js";
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

  private handleCandidatePoolUpdated(ctx: UndergroundAgentContext, message: ArborMessage): void {
    const state = ctx.shared.snapshot();
    const goalId = requireValue(state.goalId, "goalId");
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

    const invocationsBeforeConvergence = [
      ...state.centerInvocations,
      ...state.completedRootletInvocations,
      candidatePoolInvocation,
    ];
    const convergenceInvocation = startUndergroundAgentInvocation({
      agentId: this.agentId,
      role: "convergence_judge",
      inputRefs: [candidatePool.poolId, message.id],
    });
    const completedPlan = spendCandidateBudget(completeRootletClusters(startedPlan), rootletOutputs.length);
    const convergence = convergeDefaultUndergroundCandidatePool({
      goalId,
      agentId: convergenceInvocation.agentId,
      plan: completedPlan,
      goalIntentProfile: state.goalIntentProfile,
      constraints: ctx.runtime.constraints,
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
      ],
      terminalStatus: "running",
      candidateRefs: [...convergence.convergenceReport.handoffCandidateRefs],
      startedAt: state.centerInvocations[0]?.startedAt ?? completedConvergenceInvocation.startedAt,
    };
    const undergroundReport = createUndergroundExplorationReport({
      plan: completedPlan,
      agentClusterRun,
      goalIntentProfile: state.goalIntentProfile,
      evidenceLedger: convergence.evidenceLedger,
      rootletOutputs: [...rootletOutputs],
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
      traceId: message.traceId,
      agentId: completedConvergenceInvocation.agentId,
      goalId,
      planId: completedPlan.planId,
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
}
