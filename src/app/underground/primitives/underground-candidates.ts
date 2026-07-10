import {
  createCandidatePool,
  type CandidatePool,
  type ExplorationCandidateRef,
  type RootletClusterKind,
  type RootletOutput,
  type UndergroundAgentInvocation,
} from "../../../domain/underground/index.js";
import { createId, nowIso } from "../../../kernel/id.js";

export function createMinimalCandidatePool(input: {
  goalId: string;
  rootletOutputs: readonly RootletOutput[];
  agentInvocations: readonly UndergroundAgentInvocation[];
}): CandidatePool {
  const candidates = input.rootletOutputs.map(createCandidateFromRootletOutput);
  return createCandidatePool({
    poolId: createId("candidate-pool"),
    goalId: input.goalId,
    rootletOutputs: input.rootletOutputs,
    agentInvocations: input.agentInvocations,
    candidates,
    updatedAt: nowIso(),
  });
}

function createCandidateFromRootletOutput(output: RootletOutput): ExplorationCandidateRef {
  return {
    id: createId("candidate"),
    kind: candidateKindForRootlet(output.kind),
    producedByAgentId: output.producedByAgentId,
    clusterId: output.clusterId,
    summary: output.summary,
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
