import type { RootletClusterKind } from "../../../domain/underground/index.js";

export type RootletKindStrategy = {
  readonly kind: RootletClusterKind;
  readonly availableTools: readonly ("search" | "read" | "soil_query")[];
  readonly promptFocus: string;
};

export {
  type UndergroundRootletCandidateFieldType,
  type UndergroundRootletCandidateFieldContract,
  type UndergroundRootletCandidateAdviceContract,
  UNDERGROUND_ROOTLET_CANDIDATE_ADVICE_CONTRACTS,
  getUndergroundRootletCandidateAdviceContract,
} from "../intelligence-contracts.js";

export {
  type SoilRefSummary,
  type BuildUndergroundRootletCandidateAdviceMessagesInput,
  buildUndergroundRootletCandidateAdviceMessages,
} from "../intelligence-prompts.js";

export {
  type UndergroundRootletCandidateAdviceValue,
  type ParsedUndergroundRootletCandidateAdvice,
  type UndergroundRootletCandidateAdviceParseIssue,
  type ParseUndergroundRootletCandidateAdviceOutputResult,
  parseUndergroundRootletCandidateAdviceOutput,
  formatUndergroundRootletCandidateAdviceSummary,
} from "../intelligence-output.js";

export const ROOTLET_KIND_STRATEGIES: Record<RootletClusterKind, RootletKindStrategy> = {
  option: {
    kind: "option",
    availableTools: ["search", "read"],
    promptFocus: "Generate candidate directions with concrete tradeoffs and applicability conditions.",
  },
  risk: {
    kind: "risk",
    availableTools: ["search", "read"],
    promptFocus: "Identify specific failure scenarios with probability, impact, and bounded mitigation candidates.",
  },
  evidence: {
    kind: "evidence",
    availableTools: ["search", "read"],
    promptFocus: "Collect evidence refs with source, confidence, and citation requirements.",
  },
  constraint: {
    kind: "constraint",
    availableTools: ["soil_query"],
    promptFocus: "Extract hard/soft constraints with enforcement gates and applicable scope.",
  },
  asset_fit: {
    kind: "asset_fit",
    availableTools: ["soil_query"],
    promptFocus: "Evaluate Soil asset fit with applicable and non-applicable conditions.",
  },
  counterfactual: {
    kind: "counterfactual",
    availableTools: ["search", "read"],
    promptFocus: "Propose why-not alternatives and counter-directions for convergence review.",
  },
};

export function getRootletKindStrategy(kind: RootletClusterKind): RootletKindStrategy {
  return ROOTLET_KIND_STRATEGIES[kind];
}
