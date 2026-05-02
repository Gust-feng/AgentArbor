import { createDirectionHandoffPackageRef } from "../../domain/agentarbor/direction-handoff-package.js";
import { createMessage } from "../../kernel/messages/create-message.js";
import { finalizeUndergroundAgentClusterRun } from "../underground-agent-cluster-runtime.js";
import { createMinimalDirectionMaterial } from "../minimal-direction.js";
import type { MinimalRuntime } from "../runtime.js";
import { createUndergroundExplorationReport } from "../underground-report.js";
import { runUndergroundExploration } from "../underground-runner.js";
import type { DirectionOutput } from "./types.js";

export class UndergroundAnalyzer {
  readonly agentId = "underground-analyzer";

  analyze(goalId: string, goal: string, traceId: string, runtime: MinimalRuntime): DirectionOutput {
    const { candidatePool, convergenceReport, undergroundReport, agentClusterRun: pendingAgentClusterRun } = runUndergroundExploration({
      runtime,
      traceId,
      goalId,
      rawGoal: goal,
      coordinatorAgentId: this.agentId,
    });

    const material = createMinimalDirectionMaterial({
      goalId,
      goal,
      producedByAgentId: this.agentId,
      constraints: runtime.constraints,
      goalIntentProfile: undergroundReport.goalIntentProfile,
      candidatePool,
      convergenceReport,
    });
    const directionHandoffPackage = runtime.directionHandoffPackageStore.save(material.directionHandoffPackage);
    const directionHandoffPackageRef = createDirectionHandoffPackageRef(directionHandoffPackage);
    const agentClusterRun = finalizeUndergroundAgentClusterRun({
      run: pendingAgentClusterRun,
      terminalStatus: "approved_package_created",
      candidateRefs: convergenceReport.handoffCandidateRefs,
      packageRef: directionHandoffPackageRef,
      stopReason: convergenceReport.stopReason,
    });
    const finalizedUndergroundReport = createUndergroundExplorationReport({
      plan: undergroundReport.plan,
      agentClusterRun,
      goalIntentProfile: undergroundReport.goalIntentProfile,
      evidenceLedger: undergroundReport.evidenceLedger,
      rootletOutputs: [...undergroundReport.rootletOutputs],
      candidatePool,
      convergenceReport,
    });

    runtime.bus.publish(
      createMessage({
        traceId,
        from: { id: "underground-handoff-steward", role: "underground_center" },
        to: { role: "aboveground_center" },
        type: "direction_handoff.completed",
        intent: "complete_direction_handoff",
        payload: {
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

    return { ...material, directionHandoffPackage, undergroundReport: finalizedUndergroundReport };
  }
}
