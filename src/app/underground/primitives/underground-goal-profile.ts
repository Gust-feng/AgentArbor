import { createGoalIntentProfile, type GoalIntentProfile } from "../../../domain/underground/index.js";
import type { Constraint } from "../../../domain/contracts.js";

export function createGoalIntentProfileForMinimalUnderground(input: {
  goalId: string;
  rawGoal: string;
  constraints: readonly Constraint[];
  createdAt?: string;
}): GoalIntentProfile {
  return createGoalIntentProfile(input);
}
