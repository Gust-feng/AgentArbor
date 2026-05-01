import type { RuntimeShape, TaskState } from "../common.js";
import type { ConstraintRef } from "../constraints.js";

export type TaskSpec = {
  id: string;
  goalId: string;
  growthPlanId: string;
  title: string;
  description: string;
  requiredCapabilities: string[];
  acceptanceCriteria: string[];
  constraintRefs: ConstraintRef[];
  status: TaskState;
  createdAt: string;
};

export type GrowthPlan = {
  id: string;
  version: number;
  goalId: string;
  directionHandoffId: string;
  directionHandoffVersion: number;
  selectedOptionId: string;
  pathBiasDecision: "adopt" | "adapt" | "reject" | "none";
  pathBiasRationale: string;
  workflowId: string;
  runtimeShape: RuntimeShape;
  tasks: TaskSpec[];
  reuseStrategy: string[];
  sedimentationStrategy: string[];
  constraintRefs: ConstraintRef[];
  constraintDistribution: Array<{
    taskId: string;
    constraintRefs: ConstraintRef[];
  }>;
  verificationGates: string[];
  nutrientRequestTriggers: string[];
  createdAt: string;
};

export type WorkflowIRNodeType =
  | "clarify"
  | "research"
  | "design"
  | "generate"
  | "execute"
  | "verify"
  | "memory"
  | "govern"
  | "nutrient_request";

export type WorkflowIRNode = {
  id: string;
  type: WorkflowIRNodeType;
  taskId?: string;
  dependsOn: string[];
  inputs: string[];
  outputs: string[];
  executionCondition: string;
  requiredPermissions: string[];
  constraintRefs: ConstraintRef[];
  verificationGate?: string;
  failureHandling: "block" | "request_nutrient" | "revise_plan";
  pausePoints: string[];
  resumeHints: string[];
  pathBiasRefs: string[];
  nutrientRequestTriggers: string[];
  harvestOutputs: string[];
};

export type WorkflowIR = {
  id: string;
  goalId: string;
  directionHandoffId: string;
  directionHandoffVersion: number;
  growthPlanId: string;
  growthPlanVersion: number;
  nodes: WorkflowIRNode[];
  dependencies: Array<{ fromNodeId: string; toNodeId: string }>;
  inputs: string[];
  outputs: string[];
  executionConditions: string[];
  permissions: {
    canRead: string[];
    canWrite: string[];
    canExecute: string[];
  };
  constraintRefs: ConstraintRef[];
  verificationGates: string[];
  failureHandling: string[];
  pausePoints: string[];
  resumeState?: string;
  pathBiasInputs: string[];
  nutrientRequestTriggers: string[];
  harvestOutputs: string[];
  createdAt: string;
};

export type GrowthPlanRevision = {
  id: string;
  goalId: string;
  revisesGrowthPlanId: string;
  nextGrowthPlanId: string;
  nutrientRequestId?: string;
  nutrientPatchId?: string;
  directionHandoffId: string;
  directionHandoffVersion: number;
  reason: string;
  impactScope: string[];
  decision: "continue" | "rollback" | "branch" | "stop";
  changedTasks: string[];
  createdAt: string;
};
