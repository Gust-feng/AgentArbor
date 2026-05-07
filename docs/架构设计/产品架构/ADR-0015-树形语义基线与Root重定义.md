# ADR-0015: 树形语义基线与 Root 重定义

## 状态

已采纳为历史语义材料，当前产品事实源为 [ADR-0022](ADR-0022-AgentArbor桌面通用Agent与双运行时架构.md)。本 ADR 保留为植物学语义来源材料。

以下正文保留历史语义原貌。进入当前开发口径时，应以 ADR-0022 的 Desktop Shell、Task Soil、Underground Cognitive Runtime、Plan、Aboveground Execution Runtime、Fruits、Governance Pipeline 和 Global Soil 为准。

本 ADR 的树形语义由 [ADR-0018](ADR-0018-AgentArbor原生概念树架构.md) 统一为 Soil、Underground Center、`.agentarbor`、Aboveground Center、Fruits、Governance 的原生概念树；约束工程由 [ADR-0017](ADR-0017-约束工程与可执行约束模型.md) 补充。

## 背景

AgentArbor 的架构借用树形隐喻。树形语义要求地下组织吸收土壤养料并形成方向，地上组织承接方向并向上生长，果实经过治理后才能回流土壤。

正式语义是：土壤是固定资产，地下中枢负责需求成形、证据探索、方向综合和养料供给，地上中枢制定 Growth Plan，地上生长执行，验证组织判断成熟度，果实交付或成为候选沉淀，治理决定能否入土。

## 决策

AgentArbor 采用以下树形语义作为基础语义：

```text
Soil -> Underground Center -> .agentarbor -> Aboveground Center
  -> Workflow IR -> Aboveground Growth -> Fruits
  -> Governance -> Capability Asset / Path Bias / Soil
```

核心定义：

| 概念 | 定义 |
| --- | --- |
| Soil | 固定资产、长期资料、Capability Asset、治理规则、历史证据和失败模式。 |
| Underground Center | 探索型地下中枢，负责需求成形、资产适配、证据探索、约束提取、方向综合和养料供给。 |
| Direction Handoff | 地下中枢输出的方向交接包，不是最终计划。 |
| Aboveground Center | 地上中枢，读取 Direction Handoff，决定方向并形成 Growth Plan。 |
| Growth Plan | 执行前计划入口，包含选定方向、Workflow IR、运行组织、复用策略和沉淀策略。 |
| Aboveground Growth / Verification | 按 Growth Plan 和 Workflow IR 组织执行、验证和沉淀的地上组织。 |
| Run Memory | 单次运行后的经验摘要，来自 EventLog、Artifact、Verification 和 Acceptance。 |
| Experience Candidate | 可复用经验候选，不能直接等同长期资产。 |
| Capability Asset | 经过治理后进入土壤的正式能力资产。 |
| Path Bias | 历史运行对新任务的路径牵引，Underground Center 发现，Aboveground Center 决定是否采用。 |
| Ring Memory | EventLog、Run Memory 和 Experience Candidate 的聚合视图，不是新的平行事实源。 |
| Fruit | 成熟交付物、AgentApp、能力包或可脱离子 agent。 |

## 边界

- Underground Center 不制定最终计划，不直接执行任务。
- Aboveground Center 不能跳过 Direction Handoff，也不能被 Path Bias 机械锁定。
- Aboveground Growth / Verification 不能绕过 MessageBus、Router 和状态机。
- Run Memory 和 Experience Candidate 不能直接写入 Soil。
- Capability Asset 和 Fruit 必须经过 Governance Gate。
- Ring Memory 只能聚合事实源，不能替代 EventLog 或治理记录。

## 影响

- 开发指南、模型契约和植物学融合架构必须承接 Soil、Underground Center、`.agentarbor`、Aboveground Center、Fruits、Governance 的语义边界。
- 研究资料可以保留原文，但进入当前开发口径前必须映射为 Direction Handoff、Growth Plan、Nutrient Request / Patch、Run Memory、Experience Candidate、Capability Asset 和 Path Bias。

## 相关文档

- [植物学融合架构](植物学融合架构/)
- [开发指南总览](../../开发指南/00-总览.md)
- [Plan Package 与执行计划](../../开发指南/04-模型与契约/05-PlanPackage与执行计划.md)
- [ADR-0022: AgentArbor 桌面通用 Agent 与双运行时架构](ADR-0022-AgentArbor桌面通用Agent与双运行时架构.md)
