import type { ArborMessage } from "../../../domain/common.js";
import { undergroundRootletAgentId } from "../../agents/manifests.js";
import {
  completeUndergroundAgentInvocation,
  startUndergroundAgentInvocation,
} from "../../underground-agent-cluster-runtime.js";
import { startRootletClusters } from "../../underground-rootlets.js";
import { publishRootletClustersStarted } from "../../underground-events.js";
import type { UndergroundAgent, UndergroundAgentContext } from "./agent-context.js";
import {
  ensureMessageFromAgent,
  ensurePayloadStringEquals,
  readPayloadRecord,
  requireValue,
} from "./agent-context.js";

export class GrowthGovernorAgent implements UndergroundAgent {
  readonly agentId = "underground-growth-governor";
  private subscriptions: Array<() => void> = [];

  start(ctx: UndergroundAgentContext): void {
    this.subscriptions.push(
      ctx.subscribe(this.agentId, "underground.exploration_planned", (message) =>
        this.handleExplorationPlanned(ctx, message)
      )
    );
  }

  stop(): void {
    for (const unsubscribe of this.subscriptions) {
      unsubscribe();
    }
    this.subscriptions = [];
  }

  private handleExplorationPlanned(ctx: UndergroundAgentContext, message: ArborMessage): void {
    const state = ctx.shared.snapshot();
    const explorationPlan = requireValue(state.explorationPlan, "explorationPlan");
    const agentClusterPlan = requireValue(state.agentClusterPlan, "agentClusterPlan");
    const goalId = requireValue(state.goalId, "goalId");
    const currentCycle = requireValue(state.currentCycle, "currentCycle");
    const payload = readPayloadRecord(message);
    ensureMessageFromAgent(message, "underground-intent-core");
    ensurePayloadStringEquals(payload, "goalId", goalId, message.type);
    ensurePayloadStringEquals(payload, "planId", explorationPlan.planId, message.type);

    const growthInvocation = startUndergroundAgentInvocation({
      agentId: this.agentId,
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
        inputRefs: [goalId, startedPlan.planId, cluster.clusterId, message.id],
      })
    );
    const centerInvocations = [...state.centerInvocations, completedGrowthInvocation];

    ctx.shared.write(this.agentId, {
      centerInvocations,
      startedPlan,
      runningRootletInvocations,
      expectedRootletKinds: startedPlan.rootletClusters.map((cluster) => cluster.kind),
    });

    publishRootletClustersStarted({
      runtime: ctx.runtime,
      traceId: message.traceId,
      agentId: completedGrowthInvocation.agentId,
      plan: startedPlan,
      cycle: currentCycle,
      agentCluster: {
        plan: agentClusterPlan,
        invocations: [...centerInvocations, ...runningRootletInvocations],
      },
    });
  }
}
