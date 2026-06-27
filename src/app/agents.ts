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
export * from "./agents/types.js";
export * from "./agents/manifests.js";
export * from "./agents/underground-analyzer.js";
export * from "./agents/aboveground-planner.js";
export * from "./agents/worker-agent.js";
export * from "./agents/verifier.js";
export * from "./agents/governance-review.js";
