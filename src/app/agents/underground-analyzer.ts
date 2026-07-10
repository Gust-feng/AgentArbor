/**
 * @deprecated 废弃候选（T4-1 / ADR-0025 deep 一期）— ① fake 骨架（确定性假实现）。
 *
 * 替代物：src/app/deep/* DeepRuntime（manager 自由决策循环 → 一层 child 探索 → 父层综合）；
 * 正式入口 POST /api/deep/conversations + /api/deep/conversations/:id/runs。
 *
 * 删除前置条件（闭环4 §8.1 阶段④）：smoke/tests 迁移完成 + 等价能力验证通过 + 无活跃引用。
 * 当前保持运行不阻塞构建；禁止改名/删除（仍被 test/smoke/compat 引用）。
 * 边界：domain/underground 的 AgentLoop/Guard/run tree/事件契约为保留复用抽象，不在退役范围。
 */
import { createDirectionHandoffPackageRef } from "../../domain/agentarbor/direction-handoff-package.js";
import { createMessage } from "../../kernel/messages/create-message.js";
import { finalizeUndergroundAgentClusterRun } from "../underground-agent-cluster-runtime.js";
import { createMinimalDirectionMaterial } from "../underground/minimal/minimal-direction.js";
import type { MinimalRuntime } from "../runtime.js";
import { createUndergroundExplorationReport } from "../underground/primitives/underground-report.js";
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
