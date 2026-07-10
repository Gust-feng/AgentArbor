/**
 * @deprecated 废弃候选（T4-1 / ADR-0025 deep 一期）— ① fake 骨架（确定性假实现）。
 *
 * 替代物：src/app/deep/* DeepRuntime（manager 自由决策循环 → 一层 child 探索 → 父层综合）；
 * 正式入口 POST /api/deep/conversations + /api/deep/conversations/:id/runs。
 *
 * 删除前置条件（闭环4 §8.1 阶段④）：smoke/tests 迁移完成 + 等价能力验证通过 + 无活跃引用。
 * 当前保持运行不阻塞构建；禁止改名/删除（仍被 test/smoke/compat 引用）。
 * 边界：domain/underground 的 AgentLoop/Guard/run tree/事件契约为保留复用抽象，不在退役范围。
 */
import type { TaskSpec, VerificationReport } from "../../../domain/contracts.js";
import { createId, nowIso } from "../../../kernel/id.js";

export function createMinimalVerificationReport(task: TaskSpec, artifactIds: string[]): VerificationReport {
  return {
    id: createId("verification"),
    taskId: task.id,
    artifactIds,
    status: "passed",
    checks: [
      { name: "artifact_exists", status: artifactIds.length > 0 ? "passed" : "failed" },
      { name: "hard_constraints_active", status: "passed" },
      { name: "soft_constraints_recorded", status: "passed" },
      { name: "preference_did_not_override_hard_constraint", status: "passed" },
    ],
    createdAt: nowIso(),
  };
}
