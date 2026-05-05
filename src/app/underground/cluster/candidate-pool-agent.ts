import type { ArborMessage } from "../../../domain/common.js";
import {
  completeUndergroundAgentInvocation,
  startUndergroundAgentInvocation,
} from "../../underground-agent-cluster-runtime.js";
import { createMinimalCandidatePool } from "../../underground-candidates.js";
import { publishCandidatePoolUpdated } from "../../underground-events.js";
import type { UndergroundAgent, UndergroundAgentContext } from "./agent-context.js";
import {
  ensureMessageFromOneOf,
  ensurePayloadRecordArrayStringIdsEqual,
  ensurePayloadStringEquals,
  readPayloadRecord,
  requireValue,
} from "./agent-context.js";

export class CandidatePoolAgent implements UndergroundAgent {
  readonly agentId = "underground-candidate-pool";
  private subscriptions: Array<() => void> = [];

  start(ctx: UndergroundAgentContext): void {
    this.subscriptions.push(
      ctx.subscribe(this.agentId, "exploration_candidate.produced", (message) =>
        this.handleExplorationCandidateProduced(ctx, message)
      )
    );
  }

  stop(): void {
    for (const unsubscribe of this.subscriptions) {
      unsubscribe();
    }
    this.subscriptions = [];
  }

  private handleExplorationCandidateProduced(ctx: UndergroundAgentContext, message: ArborMessage): void {
    const state = ctx.shared.snapshot();
    const goalId = requireValue(state.goalId, "goalId");
    const startedPlan = requireValue(state.startedPlan, "startedPlan");
    const agentClusterPlan = requireValue(state.agentClusterPlan, "agentClusterPlan");
    const currentCycle = requireValue(state.currentCycle, "currentCycle");
    const rootletOutputs = state.rootletOutputs;
    const completedRootletInvocations = state.completedRootletInvocations;
    const payload = readPayloadRecord(message);
    ensureMessageFromOneOf(
      message,
      completedRootletInvocations
        .filter((invocation) => invocation.role === "rootlet_agent")
        .map((invocation) => invocation.agentId)
    );
    ensurePayloadStringEquals(payload, "goalId", goalId, message.type);
    ensurePayloadStringEquals(payload, "planId", startedPlan.planId, message.type);
    ensurePayloadRecordArrayStringIdsEqual(
      payload,
      "rootletOutputs",
      "outputId",
      rootletOutputs.map((output) => output.outputId),
      message.type
    );

    const candidatePoolInvocation = startUndergroundAgentInvocation({
      agentId: this.agentId,
      role: "candidate_pool",
      inputRefs: [goalId, startedPlan.planId, message.id, ...rootletOutputs.map((output) => output.outputId)],
    });
    const invocationsBeforeCandidatePool = [...state.centerInvocations, ...completedRootletInvocations];
    const candidatePool = createMinimalCandidatePool({
      goalId,
      rootletOutputs,
      agentInvocations: invocationsBeforeCandidatePool,
    });
    const completedCandidatePoolInvocation = completeUndergroundAgentInvocation(candidatePoolInvocation, [
      candidatePool.poolId,
    ]);

    ctx.shared.write(this.agentId, {
      candidatePool,
      candidatePoolInvocation: completedCandidatePoolInvocation,
    });

    publishCandidatePoolUpdated({
      runtime: ctx.runtime,
      traceId: message.traceId,
      agentId: this.agentId,
      goalId,
      planId: startedPlan.planId,
      candidatePool,
      cycle: currentCycle,
      agentCluster: {
        plan: agentClusterPlan,
        invocations: [...invocationsBeforeCandidatePool, completedCandidatePoolInvocation],
      },
    });
  }
}
