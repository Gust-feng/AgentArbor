import type { Constraint, ConstraintRef, DirectionHandoff, GrowthPlan, TaskSpec, TaskState } from "../../domain/contracts.js";

export class StateGuardError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "StateGuardError";
  }
}

export class ConstraintBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConstraintBlockedError";
  }
}

export class UserConfirmationRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserConfirmationRequiredError";
  }
}

export function enterPlanning(handoff: DirectionHandoff): TaskState {
  if (handoff.status !== "approved") {
    throw new StateGuardError(
      "DIRECTION_HANDOFF_NOT_APPROVED",
      "Planning requires an approved DirectionHandoff."
    );
  }
  return "Planning";
}

export function assignTask(
  task: TaskSpec,
  growthPlan: GrowthPlan | undefined,
  constraints: Constraint[]
): TaskSpec {
  if (growthPlan === undefined) {
    throw new StateGuardError("GROWTH_PLAN_REQUIRED", "Assigned requires an existing GrowthPlan.");
  }
  enforceHardConstraints("task_assignment", constraints, task.constraintRefs);
  return {
    ...task,
    status: "Assigned",
  };
}

export function enforceHardConstraints(
  gate: Constraint["enforcementGate"],
  constraints: Constraint[],
  refs: ConstraintRef[]
): void {
  const constraintById = new Map(constraints.map((constraint) => [constraint.id, constraint]));
  for (const ref of refs) {
    if (ref.requiredLevel !== "hard" || ref.enforcementGate !== gate) {
      continue;
    }
    const constraint = constraintById.get(ref.constraintId);
    if (constraint === undefined) {
      throw new ConstraintBlockedError(`Missing hard constraint at ${gate}: ${ref.constraintId}`);
    }
    if (constraint.status === "violated" || constraint.conflictPolicy === "block") {
      if (constraint.status === "active" || constraint.status === "approved") {
        continue;
      }
      throw new ConstraintBlockedError(`Hard constraint blocks ${gate}: ${constraint.id}`);
    }
    if (constraint.conflictPolicy === "ask_user" && constraint.status !== "active" && constraint.status !== "approved") {
      throw new UserConfirmationRequiredError(`Hard constraint requires user confirmation at ${gate}: ${constraint.id}`);
    }
  }
}

export function assertLayerCanCreateExplorationCandidate(layer: string): void {
  if (layer !== "underground_center") {
    throw new StateGuardError(
      "ABOVEGROUND_EXPLORATION_FORBIDDEN",
      "Aboveground organizations must request nutrients instead of creating direction exploration candidates."
    );
  }
}
