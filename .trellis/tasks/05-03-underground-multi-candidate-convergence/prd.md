# 地下根须多候选探索与交叉裁决对齐

## Goal

当前地下 agent 集群已经完成消息驱动和动态根须运行单元化，但根须探索和收束仍偏薄：每个根须默认只产出一个候选，候选池主要是扁平列表，Convergence Judge 的裁决还不能充分体现多方案探索、交叉校验、去重、来源归因和冲突裁决。

本任务把地下组织推进到更接近正式设计的候选收束模型：根须按预算产出多个候选，候选池按 rootlet kind 分组，Convergence Judge 对候选完成去重、交叉校验、保留、合并、淘汰、用户确认和地上参考标记，Handoff Steward 只能把已收束结果写入方向交接包。

## Requirements

- RootletAgent / rootlet helper 支持一个 rootlet invocation 产出多个 `RootletOutput`：
  - `option`：2-3 个方向选项，包含不同方案、取舍和适用条件。
  - `risk`：2-3 个风险条目，包含来源、影响范围和阻断等级。
  - `asset_fit`：1-2 个资产适配，包含适配条件和不适用条件。
  - `evidence`：2-3 个证据候选，包含来源和可信度。
  - `constraint`：2-3 个约束映射，覆盖不同 `enforcementGate`。
  - `counterfactual`：1-2 个反事实，包含反例和替代方向。
- 多候选数量必须受既有探索预算控制；不得引入无限生成或隐藏全局状态。
- `CandidatePool` 增加 `candidatesByKind: Record<RootletClusterKind, ExplorationCandidateRef[]>` 或等价 JSON-safe 分组视图。
- CandidatePool 创建必须继续验证 rootlet output 来自同一运行的 completed rootlet invocation。
- Convergence Judge 必须完成：
  - 同 kind 候选去重 / 合并，并保留来源归因。
  - option 与 constraint 的冲突校验。
  - option 假设与 evidence 支持关系校验。
  - risk 与 option 覆盖关系校验。
  - 推荐主方向、合并候选、淘汰候选、用户确认冲突、地上参考方向标记。
- 收束报告必须能表达：
  - `candidateComparisons`
  - `recommendedOptionId`
  - `mergedCandidateRefs`
  - `rejectedCandidateRefs` 及原因
  - `userDecisionRequired`
  - `abovegroundReferenceOptionIds`
- Direction Handoff 必须更完整：
  - `options` 包含所有候选方向，不只推荐方向。
  - `decisionRecord` 记录推荐、合并、淘汰、用户确认、地上参考和来源依据。
  - `riskRegister` 包含所有风险条目。
  - `sourceCandidateRefs` 仍只能包含 accepted / merged 的已收束候选，不允许 rootlet output、unknown 或 rejected 直接进入。
  - `convergenceReviewRef` 指向本次裁决记录。

## Boundaries

- 不接入 LLM，不调用真实 `IntelligenceChannel`。
- 不改变消息驱动架构、现有消息类型、Runner 生命周期或 SharedContext owner 规则。
- 不删除现有测试；可修改断言以适配更丰富的候选结构。
- 不写 repo-root `.agentarbor/` 运行资产。
- 不引入数据库、UI、HTTP、SSE、WebSocket、MCP、A2A、AG-UI 或外部 SDK。
- 不重新引入 SeedPacket / RootCallback 作为活跃开发口径；现有路径不存在时以 `.agentarbor` Direction Handoff Package 契约为准。

## Acceptance Criteria

- `pnpm build` passes。
- `pnpm test` passes。
- `pnpm demo:underground -- "构建任务管理平台，包含测试和监控，不接数据库"` passes，基本 7 步流程不变，但摘要可展示更丰富的候选 / 收束内容。
- 单个 rootlet 可以产出多个候选，且受预算控制。
- CandidatePool 按 kind 分组。
- Convergence Judge 有去重合并、option/constraint 冲突、保留/合并/淘汰/用户确认/地上参考的测试。
- DirectionHandoff options / decisionRecord / riskRegister 包含多候选裁决信息。
- 现有 package validation、awaiting_user、stopped、AI 候选边界和完整 demo 测试不回归。

## Notes

- 这是地下组织收束质量增强，不是地上组织、Nutrient Request 或真实模型接入任务。
- AI 未来只允许进入候选、草案、解释或证据建议层；本轮用确定性多候选模拟这个边界。
