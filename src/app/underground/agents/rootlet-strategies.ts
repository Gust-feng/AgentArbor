/**
 * @deprecated 废弃候选（T4-1 / ADR-0025 deep 一期）— ②' 固定拓扑主体（强耦合 directionHandoffPackage/Plan，不做本期主线）。
 *
 * 替代物：src/app/deep/* DeepRuntime（manager 自由决策循环 → 一层 child 探索 → 父层综合）；
 * 正式入口 POST /api/deep/conversations + /api/deep/conversations/:id/runs。
 *
 * 删除前置条件（闭环4 §8.1 阶段④）：smoke/tests 迁移完成 + 等价能力验证通过 + 无活跃引用。
 * 当前保持运行不阻塞构建；禁止改名/删除（仍被 test/smoke/compat 引用）。
 * 边界：domain/underground 的 AgentLoop/Guard/run tree/事件契约为保留复用抽象，不在退役范围。
 */
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
