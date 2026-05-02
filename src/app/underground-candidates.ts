import {
  createCandidatePool,
  type CandidatePool,
  type ExplorationCandidateRef,
  type RootletClusterKind,
  type RootletOutput,
} from "../domain/underground/index.js";
import { createId, nowIso } from "../kernel/id.js";

export function createMinimalCandidatePool(input: {
  goalId: string;
  producedByAgentId: string;
  rootletOutputs: readonly RootletOutput[];
}): CandidatePool {
  const candidates = input.rootletOutputs.map((output) => createCandidateFromRootletOutput(output, input.producedByAgentId));
  return createCandidatePool({
    poolId: createId("candidate-pool"),
    goalId: input.goalId,
    rootletOutputs: input.rootletOutputs,
    candidates,
    updatedAt: nowIso(),
  });
}

function createCandidateFromRootletOutput(
  output: RootletOutput,
  producedByAgentId: string
): ExplorationCandidateRef {
  return {
    id: createId("candidate"),
    kind: candidateKindForRootlet(output.kind),
    producedByAgentId,
    clusterId: output.clusterId,
    sourceRefs: [output.outputId],
    status: "candidate",
  };
}

function candidateKindForRootlet(kind: RootletClusterKind): ExplorationCandidateRef["kind"] {
  switch (kind) {
    case "option":
    case "constraint":
      return "claim_candidate";
    case "asset_fit":
    case "evidence":
      return "evidence_candidate";
    case "risk":
    case "counterfactual":
      return "observation";
  }
}
