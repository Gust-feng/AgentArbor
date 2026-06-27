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
import type { ModelOutputContract } from "../../domain/intelligence/index.js";
import type { RootletClusterKind } from "../../domain/underground/index.js";

export type UndergroundRootletCandidateFieldType = "string" | "string_array";

export type UndergroundRootletCandidateFieldContract = {
  readonly name: string;
  readonly type: UndergroundRootletCandidateFieldType;
  readonly description: string;
};

export type UndergroundRootletCandidateAdviceContract = {
  readonly kind: RootletClusterKind;
  readonly modelOutputContract: ModelOutputContract;
  readonly candidateArrayField: "candidates";
  readonly candidateFields: readonly UndergroundRootletCandidateFieldContract[];
};

const candidateField = (
  name: string,
  type: UndergroundRootletCandidateFieldType,
  description: string
): UndergroundRootletCandidateFieldContract => ({ name, type, description });

export const UNDERGROUND_ROOTLET_CANDIDATE_ADVICE_CONTRACTS = {
  option: createAdviceContract("option", [
    candidateField("summary", "string", "A concise candidate direction."),
    candidateField("tradeoffs", "string_array", "Material tradeoffs for convergence review."),
    candidateField("applicability", "string", "When this candidate direction should apply."),
  ]),
  risk: createAdviceContract("risk", [
    candidateField("summary", "string", "A concise risk candidate."),
    candidateField("impactScope", "string", "The affected scope if this risk materializes."),
    candidateField("severity", "string", "Risk severity as low, medium, high, or blocking."),
    candidateField("mitigation", "string", "A bounded mitigation candidate."),
  ]),
  asset_fit: createAdviceContract("asset_fit", [
    candidateField("summary", "string", "A concise Soil asset fit candidate."),
    candidateField("assetRefs", "string_array", "Soil or capability refs only, without asset body content."),
    candidateField("fitConditions", "string_array", "Conditions where the referenced asset could fit."),
    candidateField("doNotApplyWhen", "string_array", "Conditions where the asset refs should not apply."),
  ]),
  evidence: createAdviceContract("evidence", [
    candidateField("summary", "string", "A concise evidence candidate."),
    candidateField("evidenceType", "string", "The kind of evidence to collect or cite."),
    candidateField("confidence", "string", "Confidence level for the evidence suggestion."),
  ]),
  constraint: createAdviceContract("constraint", [
    candidateField("summary", "string", "A concise constraint candidate."),
    candidateField("constraintLevel", "string", "hard, soft, or preference."),
    candidateField("enforcementGate", "string", "The gate where this constraint must be enforced."),
  ]),
  counterfactual: createAdviceContract("counterfactual", [
    candidateField("summary", "string", "A concise counterfactual candidate."),
    candidateField("alternativeDirection", "string", "A plausible alternative direction."),
    candidateField("whyNotChosen", "string", "Why this direction should not drive the first path."),
  ]),
} as const satisfies Record<RootletClusterKind, UndergroundRootletCandidateAdviceContract>;

export function getUndergroundRootletCandidateAdviceContract(
  kind: RootletClusterKind
): UndergroundRootletCandidateAdviceContract {
  return UNDERGROUND_ROOTLET_CANDIDATE_ADVICE_CONTRACTS[kind];
}

function createAdviceContract(
  kind: RootletClusterKind,
  candidateFields: readonly UndergroundRootletCandidateFieldContract[]
): UndergroundRootletCandidateAdviceContract {
  const visibleFields = candidateFields.map((field) => field.name);
  const visibleFieldTypes = Object.fromEntries(candidateFields.map((field) => [field.name, field.type]));
  return {
    kind,
    modelOutputContract: {
      contractId: `underground.rootlet_candidate_advice.${kind}.v2`,
      outputKind: "candidate",
      format: "json_object",
      requiredFields: ["candidates"],
      visibleOutput: {
        arrayField: "candidates",
        fields: visibleFields,
        fieldTypes: visibleFieldTypes,
        maxItems: 3,
        maxFieldLength: 180,
      },
    },
    candidateArrayField: "candidates",
    candidateFields,
  };
}
