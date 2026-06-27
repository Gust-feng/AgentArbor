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
import type { Constraint, GrowthPlan, TaskSpec } from "../../domain/contracts.js";
import { createMessage } from "../../kernel/messages/create-message.js";
import { assignTask } from "../../kernel/state-machine/task-state-machine.js";
import type { MinimalRuntime } from "../runtime.js";

export class WorkerAgent {
  readonly agentId = "worker-agent";

  assignTask(task: TaskSpec, growthPlan: GrowthPlan, constraints: Constraint[], traceId: string, runtime: MinimalRuntime): TaskSpec {
    const assignedTask = assignTask(task, growthPlan, constraints);
    runtime.bus.publish(
      createMessage({
        traceId,
        taskId: task.id,
        from: { id: "simple-router", role: "aboveground_center" },
        to: { role: "aboveground_growth" },
        type: "task.assigned",
        intent: "assign_task",
        payload: { task: assignedTask, assignedAgentId: this.agentId },
        requiredCapabilities: task.requiredCapabilities,
      })
    );
    return assignedTask;
  }

  produceArtifact(task: TaskSpec, traceId: string, runtime: MinimalRuntime) {
    const artifact = runtime.artifactStore.save({
      taskId: task.id,
      producedBy: this.agentId,
      type: "document",
      uri: `memory://artifacts/${task.id}`,
      content: "Minimal desktop-agent artifact produced by the local WorkerAgent.",
      summary: "Minimal desktop-agent artifact.",
    });
    runtime.bus.publish(
      createMessage({
        traceId,
        taskId: task.id,
        from: { id: this.agentId, role: "aboveground_growth" },
        to: { role: "verification" },
        type: "artifact.produced",
        intent: "produce_artifact",
        payload: { artifact: artifact.ref, summary: artifact.summary },
        artifacts: [artifact.ref],
      })
    );
    return artifact;
  }
}
