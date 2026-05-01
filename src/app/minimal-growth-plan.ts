import type { DirectionHandoff, GrowthPlan, TaskSpec, WorkflowIR, WorkflowIRNode } from "../domain/contracts.js";
import { createId, nowIso } from "../kernel/id.js";

export type MinimalGrowthPlanMaterial = {
  growthPlan: GrowthPlan;
  workflow: WorkflowIR;
  task: TaskSpec;
};

export function createMinimalGrowthPlanMaterial(directionHandoff: DirectionHandoff): MinimalGrowthPlanMaterial {
  const growthPlanId = createId("growth-plan");
  const workflowId = createId("workflow");
  const taskId = createId("task");
  const createdAt = nowIso();
  const task = createMinimalTask({ directionHandoff, growthPlanId, taskId, createdAt });
  const workflow = createMinimalWorkflow({ directionHandoff, growthPlanId, workflowId, taskId, createdAt });
  const growthPlan = createMinimalGrowthPlan({ directionHandoff, growthPlanId, workflowId, task, createdAt });

  return { growthPlan, workflow, task };
}

function createMinimalTask(input: {
  directionHandoff: DirectionHandoff;
  growthPlanId: string;
  taskId: string;
  createdAt: string;
}): TaskSpec {
  return {
    id: input.taskId,
    goalId: input.directionHandoff.sourceGoalId,
    growthPlanId: input.growthPlanId,
    title: "Produce minimal deterministic AgentApp artifact",
    description: "Produce an in-memory artifact proving the first AgentArbor runtime loop.",
    requiredCapabilities: ["artifact.produce", "minimal.agentapp.write"],
    acceptanceCriteria: [
      "Artifact exists in InMemoryArtifactStore.",
      "VerificationReport status is passed.",
      "Governance produces fruit, run memory, experience candidate, and path bias.",
    ],
    constraintRefs: input.directionHandoff.constraintRefs.filter((ref) => ref.enforcementGate === "task_assignment"),
    status: "Draft",
    createdAt: input.createdAt,
  };
}

function createMinimalWorkflow(input: {
  directionHandoff: DirectionHandoff;
  growthPlanId: string;
  workflowId: string;
  taskId: string;
  createdAt: string;
}): WorkflowIR {
  const workflowNode = (id: string, type: WorkflowIRNode["type"], dependsOn: string[]): WorkflowIRNode => ({
    id,
    type,
    taskId: type === "generate" || type === "verify" ? input.taskId : undefined,
    dependsOn,
    inputs: type === "generate" ? [input.directionHandoff.id] : [],
    outputs: type === "generate" ? ["artifact"] : [type],
    executionCondition: "approved_direction_handoff",
    requiredPermissions: [],
    constraintRefs: input.directionHandoff.constraintRefs,
    verificationGate: type === "verify" ? "minimal-verification" : undefined,
    failureHandling: type === "verify" ? "request_nutrient" : "block",
    pausePoints: [],
    resumeHints: [],
    pathBiasRefs: [],
    nutrientRequestTriggers: ["verification_failed", "nutrient_gap"],
    harvestOutputs: type === "memory" ? ["run_memory", "experience_candidate", "path_bias"] : [],
  });

  return {
    id: input.workflowId,
    goalId: input.directionHandoff.sourceGoalId,
    directionHandoffId: input.directionHandoff.id,
    directionHandoffVersion: input.directionHandoff.version,
    growthPlanId: input.growthPlanId,
    growthPlanVersion: 1,
    nodes: [
      workflowNode("node-generate", "generate", []),
      workflowNode("node-verify", "verify", ["node-generate"]),
      workflowNode("node-memory", "memory", ["node-verify"]),
      workflowNode("node-govern", "govern", ["node-memory"]),
    ],
    dependencies: [
      { fromNodeId: "node-generate", toNodeId: "node-verify" },
      { fromNodeId: "node-verify", toNodeId: "node-memory" },
      { fromNodeId: "node-memory", toNodeId: "node-govern" },
    ],
    inputs: [input.directionHandoff.id],
    outputs: ["artifact", "verification_report", "fruit_candidate", "run_memory", "experience_candidate", "path_bias"],
    executionConditions: ["DirectionHandoff.status == approved"],
    permissions: {
      canRead: ["direction_handoff", "task_spec"],
      canWrite: ["artifact_store", "verification_report", "fruit_candidate", "run_memory", "experience_candidate", "path_bias"],
      canExecute: [],
    },
    constraintRefs: input.directionHandoff.constraintRefs,
    verificationGates: ["minimal-verification"],
    failureHandling: ["verification_failed -> nutrient_request.requested"],
    pausePoints: [],
    pathBiasInputs: [],
    nutrientRequestTriggers: ["verification_failed", "nutrient_gap"],
    harvestOutputs: ["run_memory", "experience_candidate", "path_bias"],
    createdAt: input.createdAt,
  };
}

function createMinimalGrowthPlan(input: {
  directionHandoff: DirectionHandoff;
  growthPlanId: string;
  workflowId: string;
  task: TaskSpec;
  createdAt: string;
}): GrowthPlan {
  return {
    id: input.growthPlanId,
    version: 1,
    goalId: input.directionHandoff.sourceGoalId,
    directionHandoffId: input.directionHandoff.id,
    directionHandoffVersion: input.directionHandoff.version,
    selectedOptionId: input.directionHandoff.recommendedOptionId ?? input.directionHandoff.options[0]?.optionId ?? "unknown-option",
    pathBiasDecision: "none",
    pathBiasRationale: "No prior PathBias is required for the first deterministic loop.",
    workflowId: input.workflowId,
    runtimeShape: "single_agent",
    tasks: [input.task],
    reuseStrategy: ["Reuse the deterministic kernel contracts before adding adapters."],
    sedimentationStrategy: ["Capture run memory and propose experience candidate after verification."],
    constraintRefs: input.directionHandoff.constraintRefs,
    constraintDistribution: [{ taskId: input.task.id, constraintRefs: input.task.constraintRefs }],
    verificationGates: ["minimal-verification"],
    nutrientRequestTriggers: ["verification_failed", "nutrient_gap"],
    createdAt: input.createdAt,
  };
}
