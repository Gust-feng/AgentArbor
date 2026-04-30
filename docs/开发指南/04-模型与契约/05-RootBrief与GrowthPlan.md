# RootBrief 与 GrowthPlan

## 关系

RootBrief 和 GrowthPlan 是探索与决策的边界。

```text
Seed Packet -> Root System -> RootBrief vN -> Core Control Cluster -> GrowthPlan vN -> Workflow IR
```

RootBrief 只表达探索结果，不直接决定执行。GrowthPlan 才是执行前计划入口。

## RootBrief 必填内容

- `seedPacketId`：来源 Seed Packet。
- `version`：Root Brief 版本。
- `rootingMode`：`initial`、`lateral` 或 `deep`。
- `goalUnderstanding`：对目标的结构化理解。
- `reusableAssets`：可能复用的 Capability Asset。
- `similarRuns`：相似 Run Memory。
- `pathBias`：可参考的路径倾向。
- `unknowns`：仍未确认的信息。
- `constraints`：目标、权限、时间、技术和治理约束。
- `risks`：执行和交付风险。
- `options`：可选方向。
- `recommendedOption`：Root System 推荐方向。
- `evidence`：证据来源。

## GrowthPlan 必填内容

- `goal`：目标摘要。
- `rootBriefVersion`：引用的 Root Brief 版本。
- `planVersion`：计划版本。
- `selectedDirection`：主干选定方向。
- `pathBiasDecision`：采用、调整、拒绝或无可用 Path Bias。
- `workflowIr`：工作流中间表示。
- `runtimeShape`：运行组织形态。
- `tasks`：任务列表。
- `reuseStrategy`：资产复用策略。
- `sedimentationStrategy`：Run Memory、Experience Candidate 和 Capability Asset 的沉淀策略。
- `verificationGates`：验证和验收门。
- `rootCallbackTriggers`：允许回调地下组织的触发点。

## GrowthPlan Revision

GrowthPlan 必须支持修订。修订必须记录：

- 来源 GrowthPlan 版本。
- 新 RootBrief 版本。
- 修订原因。
- 影响范围。
- 继续、回退、分叉或停止决策。
- Workflow IR 变化。

## 决策规则

Core Control Cluster 制定或修订 GrowthPlan 时必须显式回答：

- 为什么选择这个方向。
- 哪些 RootBrief 证据被采用。
- 哪些 Path Bias 被采用或拒绝。
- 本次任务是否需要 Branch Cluster。
- 哪些结果有沉淀价值。
- 哪些节点需要人工确认。
- 哪些情况会触发 Root Callback。

如果 RootBrief 缺少关键证据，Core Control Cluster 应要求 Root System 继续 Lateral Rooting 或 Deep Rooting，而不是用猜测补齐计划。
