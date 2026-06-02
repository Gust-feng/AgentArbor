import type { ConstraintRef } from "../constraints.js";

export const ROOTLET_CLUSTER_KINDS = [
  "option",
  "risk",
  "asset_fit",
  "evidence",
  "constraint",
  "counterfactual",
] as const;

export type RootletClusterKind = (typeof ROOTLET_CLUSTER_KINDS)[number];

export type ExplorationBudget = {
  maxRootletClusters: number;
  maxCandidateOutputs: number;
  spentRootletClusters: number;
  spentCandidateOutputs: number;
  exhausted: boolean;
};

export type RootletOutput = {
  outputId: string;
  invocationId: string;
  clusterId: string;
  kind: RootletClusterKind;
  producedByAgentId: string;
  summary: string;
  sourceRefs: string[];
  evidenceRefs: string[];
  soilAssetFitRefs: string[];
  constraintRefs: ConstraintRef[];
  riskRefs: string[];
  status: "produced";
  source: "ai" | "deterministic_fallback";
};
