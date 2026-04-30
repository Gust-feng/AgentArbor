# ADR-0015: 树形语义基线与 Root 重定义

## 状态

已采纳。

本 ADR 的树形语义已由 [ADR-0016](ADR-0016-种子层与持续根系架构.md) 扩展为当前正式持续生长架构：Seed Cluster 负责前置成像，Root System 负责持续生根与 Root Callback，Core Control Cluster 负责 Growth Plan 修订。

## 背景

AgentArbor 的架构一直借用树形隐喻，但此前 Root 曾被解释为方向、目标、治理和元控制。这一口径有助于修正早期研究中把 Root 命名为能力执行层的问题，但仍然不够贴合树的自然结构。

新的正式语义是：土壤是固定资产，根是探索型 Agent 集群，主干汇总根系信息并制定 Growth Plan，枝叶执行，花验证，果交付，年轮沉淀并反哺土壤。

## 决策

AgentArbor 采用以下树形语义作为基础语义修正。当前运行主线以 ADR-0016 为准，并在此基线前补入 Seed Cluster，在运行期补入 Root Callback。

```text
Soil -> Root Cluster -> Root Brief -> Trunk Synthesis -> Growth Plan
  -> Workflow IR -> Branch / Leaf / Flower
  -> Run Memory -> Experience Candidate / Path Bias
  -> Governance Gate -> Capability Asset / Fruit
```

核心定义：

| 概念 | 定义 |
| --- | --- |
| Soil | 固定资产、长期资料、Capability Asset、治理规则、历史证据和失败模式。 |
| Root Cluster | 探索型 Agent 集群，向不同方向探索目标、资产、相似运行、未知项、约束、风险和可选路径。 |
| Root Brief | Root Cluster 的探索输出，不是最终计划。 |
| Trunk Synthesis | 主干综合职责，读取 Root Brief，决定方向并形成 Growth Plan。 |
| Growth Plan | 执行前计划入口，包含选定方向、Workflow IR、运行组织、复用策略和沉淀策略。 |
| Branch / Leaf / Flower | 按 Growth Plan 和 Workflow IR 组织执行、验证和沉淀的地上组织。 |
| Run Memory | 单次运行后的经验摘要，来自 EventLog、Artifact、Verification 和 Acceptance。 |
| Experience Candidate | 可复用经验候选，不能直接等同长期资产。 |
| Capability Asset | 经过治理后进入土壤的正式能力资产。 |
| Path Bias | 历史运行对新任务的路径牵引，Root Cluster 发现，Trunk Synthesis 决定是否采用。 |
| Ring Memory | EventLog、Run Memory 和 Experience Candidate 的聚合视图，不是新的平行事实源。 |
| Fruit | 成熟交付物、AgentApp、能力包或可脱离子 agent。 |

## 边界

- Root Cluster 不制定最终计划，不直接执行任务。
- Trunk Synthesis 不能跳过 Root Brief，也不能被 Path Bias 机械锁定。
- Branch / Leaf / Flower 不能绕过 MessageBus、Router 和状态机。
- Run Memory 和 Experience Candidate 不能直接写入 Soil。
- Capability Asset 和 Fruit 必须经过 Governance Gate。
- Ring Memory 只能聚合事实源，不能替代 EventLog 或治理记录。

## 影响

- ADR-0012 中旧 Root 口径被本 ADR 修正。
- 开发指南、模型契约和植物学融合架构以 ADR-0016 为当前运行主线，本 ADR 作为 Root 语义修正依据。
- 旧研究资料可以保留原文，但进入当前开发口径前必须按本 ADR 重新映射。
- 不再使用无来源的版本命名表达当前架构；当前架构称为“树形语义基线”或“植物学融合架构”。

## 相关文档

- [ADR-0012: 植物学融合架构候选基线](ADR-0012-植物学融合架构候选基线.md)
- [植物学融合架构](植物学融合架构/)
- [开发指南总览](../../开发指南/00-总览.md)
- [RootBrief 与 GrowthPlan](../../开发指南/04-模型与契约/05-RootBrief与GrowthPlan.md)
