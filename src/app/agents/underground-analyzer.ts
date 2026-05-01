import { createMessage } from "../../kernel/messages/create-message.js";
import { createMinimalDirectionMaterial } from "../minimal-direction.js";
import {
  completeRootletClusters,
  convergeMinimalCandidatePool,
  createMinimalCandidatePool,
  createMinimalUndergroundExplorationPlan,
  createUndergroundExplorationReport,
  produceMinimalRootletOutputs,
  spendCandidateBudget,
  startRootletClusters,
} from "../minimal-underground.js";
import {
  publishCandidatePoolUpdated,
  publishConvergenceReviewCompleted,
  publishExplorationCandidatesProduced,
  publishRootletClustersStarted,
  publishUndergroundExplorationPlanned,
} from "../underground-events.js";
import type { MinimalRuntime } from "../runtime.js";
import type { DirectionOutput } from "./types.js";

export class UndergroundAnalyzer {
  readonly agentId = "underground-analyzer";

  analyze(goalId: string, goal: string, traceId: string, runtime: MinimalRuntime): DirectionOutput {
    const plan = createMinimalUndergroundExplorationPlan(goalId);
    publishUndergroundExplorationPlanned({ runtime, traceId, agentId: this.agentId, plan });

    const startedPlan = startRootletClusters(plan);
    publishRootletClustersStarted({ runtime, traceId, agentId: this.agentId, plan: startedPlan });

    const rootletOutputs = produceMinimalRootletOutputs({
      plan: startedPlan,
      producedByAgentId: this.agentId,
      constraints: runtime.constraints,
    });
    publishExplorationCandidatesProduced({ runtime, traceId, agentId: this.agentId, rootletOutputs });

    const candidatePool = createMinimalCandidatePool({
      goalId,
      producedByAgentId: this.agentId,
      rootletOutputs,
    });
    publishCandidatePoolUpdated({ runtime, traceId, agentId: this.agentId, candidatePool });

    const completedPlan = spendCandidateBudget(completeRootletClusters(startedPlan), rootletOutputs.length);
    const { candidatePool: convergedCandidatePool, convergenceReport } = convergeMinimalCandidatePool({
      pool: candidatePool,
      plan: completedPlan,
      leadAgentId: this.agentId,
    });
    const undergroundReport = createUndergroundExplorationReport({
      plan: completedPlan,
      rootletOutputs,
      candidatePool: convergedCandidatePool,
      convergenceReport,
    });
    publishConvergenceReviewCompleted({
      runtime,
      traceId,
      agentId: this.agentId,
      convergenceReport,
      candidatePool: convergedCandidatePool,
      undergroundReport,
    });

    const material = createMinimalDirectionMaterial({
      goalId,
      goal,
      producedByAgentId: this.agentId,
      constraints: runtime.constraints,
      candidatePool: convergedCandidatePool,
      convergenceReport,
    });
    const directionHandoffPackage = runtime.directionHandoffPackageStore.save(material.directionHandoffPackage);

    runtime.bus.publish(
      createMessage({
        traceId,
        from: { id: this.agentId, role: "underground_center" },
        to: { role: "aboveground_center" },
        type: "direction_handoff.completed",
        intent: "complete_direction_handoff",
        payload: {
          directionHandoff: material.directionHandoff,
          directionPackage: {
            packageId: directionHandoffPackage.manifest.packageId,
            directionId: directionHandoffPackage.manifest.directionId,
            version: directionHandoffPackage.manifest.directionVersion,
            status: directionHandoffPackage.manifest.status,
          },
        },
      })
    );

    return { ...material, directionHandoffPackage, undergroundReport };
  }
}
