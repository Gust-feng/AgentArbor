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
