# 植物学融合架构

## 概述

植物学融合架构是 AgentArbor 当前产品架构资料。它采用原生概念树描述系统如何从土壤出发，经地下成形、方向交接、地上生长、果实治理，再把成熟能力回流土壤。

当前正式语义以 [ADR-0018](../ADR-0018-AgentArbor原生概念树架构.md) 为准：

```text
Soil
  -> Underground Center
  -> .agentarbor
  -> Aboveground Center
  -> Fruits
  -> Governance
  -> Soil
```

## 文档索引

| 文档 | 说明 |
| --- | --- |
| [01-根层.md](01-根层.md) | 地下中枢：需求成形、证据探索、方向综合和养料供给 |
| [02-干层.md](02-干层.md) | 地上中枢：Growth Plan、Workflow IR、上下文拓扑和计划修订 |
| [03-枝层.md](03-枝层.md) | 地上生长协调：分支任务、团队组织和执行状态 |
| [04-叶层.md](04-叶层.md) | 地上生长执行：具体执行个体、工具调用和产物提交 |
| [05-花层.md](05-花层.md) | 验证生长：验证、评审、成熟判断和养料请求建议 |
| [06-果层.md](06-果层.md) | Fruits：交付、复用、可脱离能力和候选沉淀 |
| [07-土壤层.md](07-土壤层.md) | Soil 与 Governance：固定资产、治理规则和入土门 |
| [08-状态机.md](08-状态机.md) | 状态机：Direction、Handoff、Plan、Run、Nutrient、Memory 的合法转换 |
| [09-学习系统.md](09-学习系统.md) | 运行沉淀系统：Run Memory、Experience Candidate、Path Bias 和 Ring Memory |
| [10-演化系统.md](10-演化系统.md) | 演化系统：基于证据的修订、分叉、停止和果实治理 |
| [11-通信机制.md](11-通信机制.md) | MessageBus、Router、状态机和事件记录 |
| [12-资产管理.md](12-资产管理.md) | 能力资产治理 |
| [13-工作流示例.md](13-工作流示例.md) | 工作流程示例 |

## 架构全景

```text
土壤 Soil
  长期事实、Capability Asset、治理规则、失败模式、历史证据和稳定约束

地下中枢 Underground Center
  用户想象成形、约束提取、证据探索、方向综合、用户升级确认和养料供给

方向交接包 .agentarbor
  Direction Brief、ConstraintRef、Soil 引用、证据索引、升级条件和 Growth Entry

地上中枢 Aboveground Center
  Growth Plan、Workflow IR、Context Topology、执行组织、验证门和计划修订

地上生长 Aboveground Growth
  分支协调、执行个体、工具调用、产物提交、验证和成熟判断

果层 Fruit
  AgentApp、能力包、可脱离子 agent、Run Memory、Experience Candidate 或其他候选沉淀

治理 Governance
  成熟度评估、权限审查、谱系归因、版本、导出、退役和入土裁决
```

## 核心约束

- 地下中枢负责需求成形、证据探索、方向综合和养料供给，不能制定地上执行计划。
- 约束工程贯穿 Soil、Underground Center、`.agentarbor`、Aboveground Center、Fruits、Governance 和回流后的 Soil，约束必须以 Constraint / ConstraintRef 形式进入计划、执行和验证。
- `.agentarbor` 是方向交接包，不是最终资产库，也不是 Soil 的副本。
- 地上中枢负责 Growth Plan、Workflow IR、Context Topology、执行组织、验证门和计划修订，不能退化为单个万能 agent。
- Growth Plan 必须引用具体方向交接包版本，并派生可执行、可验证、可修订的 Workflow IR。
- 地上组织发现信息不足、验证失败、目标变化或 Path Bias 失效时，必须通过 Nutrient Request 向地下中枢请求养料，不能自建方向探索集群。
- 地上生长组织只能通过 MessageBus、Router、状态机和 EventLog 协作。
- Run Memory 是单次运行摘要，Experience Candidate 是候选，Capability Asset 才能进入土壤。
- Path Bias 是牵引，不是复刻。
- Path Bias 只能影响 preference 和方案排序，不能覆盖 hard constraint。
- Ring Memory 是聚合视图，不是平行事实源。
- Fruit 脱离母体或进入 Soil 前必须经过治理门。

## 相关文档

- [ADR-0018: AgentArbor 原生概念树架构](../ADR-0018-AgentArbor原生概念树架构.md)
- [ADR-0017: 约束工程与可执行约束模型](../ADR-0017-约束工程与可执行约束模型.md)
- [开发指南总览](../../../开发指南/00-总览.md)
