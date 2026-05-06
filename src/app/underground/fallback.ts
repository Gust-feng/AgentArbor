import type { Constraint } from "../../domain/contracts.js";
import type { GoalIntentProfile, UndergroundAgentInvocation, RootletClusterPlan, RootletOutput } from "../../domain/underground/index.js";
import { createRootletOutputsForInvocation } from "../underground-rootlets.js";

export * from "../underground-rootlets.js";

export type DeterministicFallbackRootletOutputInput = {
  readonly goalId: string;
  readonly cluster: RootletClusterPlan;
  readonly invocation: UndergroundAgentInvocation;
  readonly constraints: readonly Constraint[];
  readonly sourceRefs?: readonly string[];
  readonly goalIntentProfile?: GoalIntentProfile;
};

export function createDeterministicFallbackRootletOutputs(
  input: DeterministicFallbackRootletOutputInput
): RootletOutput[] {
  return createRootletOutputsForInvocation({
    goalId: input.goalId,
    cluster: input.cluster,
    invocation: input.invocation,
    constraints: [...input.constraints],
    sourceRefs: input.sourceRefs,
    goalIntentProfile: input.goalIntentProfile,
  }).map((output) => ({ ...output, source: "deterministic_fallback" as const }));
}
