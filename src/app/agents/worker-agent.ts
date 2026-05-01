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
      content: "Minimal AgentApp artifact produced by deterministic WorkerAgent.",
      summary: "Minimal deterministic AgentApp artifact.",
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
