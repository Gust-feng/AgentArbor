import type { DirectionHandoffPackageRef } from "../agentarbor/direction-handoff-package/contracts.js";
import type { ExplorationBudget } from "./rootlet-contracts.js";

export const UNDERGROUND_AGENT_ROLES = [
  "intent_core",
  "growth_governor",
  "rootlet_agent",
  "candidate_pool",
  "autonomy_core",
  "convergence_judge",
  "handoff_steward",
] as const;

export type UndergroundAgentRole = (typeof UNDERGROUND_AGENT_ROLES)[number];

export type UndergroundAgentInvocationStatus = "running" | "completed" | "failed" | "skipped";

export type UndergroundAgentClusterPlanAgent = {
  readonly agentId: string;
  readonly role: UndergroundAgentRole;
  readonly rootletKind?: string;
  readonly inputRefs: readonly string[];
  readonly schedulingReason: string;
};

export type UndergroundAgentClusterPlan = {
  readonly planId: string;
  readonly goalId: string;
  readonly rawGoal: string;
  readonly budget: ExplorationBudget;
  readonly agents: readonly UndergroundAgentClusterPlanAgent[];
  readonly rootletKinds: readonly string[];
  readonly schedulingReasons: readonly string[];
  readonly createdAt: string;
};

export type UndergroundAgentInvocation = {
  readonly invocationId: string;
  readonly agentId: string;
  readonly role: UndergroundAgentRole;
  readonly inputRefs: readonly string[];
  readonly outputRefs: readonly string[];
  readonly status: UndergroundAgentInvocationStatus;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly failureReason?: string;
};

export type UndergroundAgentClusterTerminalStatus =
  | "running"
  | "approved_package_created"
  | "awaiting_user"
  | "stopped"
  | "failed";

export type UndergroundAgentClusterRun = {
  readonly runId: string;
  readonly plan: UndergroundAgentClusterPlan;
  readonly invocations: readonly UndergroundAgentInvocation[];
  readonly terminalStatus: UndergroundAgentClusterTerminalStatus;
  readonly candidateRefs: readonly string[];
  readonly packageRef?: DirectionHandoffPackageRef;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly stopReason?: string;
};
