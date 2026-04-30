# 植物学融合架构

## 概述

植物学融合架构是 AgentArbor 当前产品架构资料。它采用树形语义描述系统如何把用户的 Imagination 孕育成可运行、可验证、可沉淀、可分叉、可脱离的 AgentApp 或子 agent 果实。

当前正式语义以 [ADR-0016](../ADR-0016-种子层与持续根系架构.md) 为准：

```text
Imagination
  -> Seed Cluster
  -> Seed Packet
  -> User Approval Gate
  -> Soil
  -> Initial Rooting
  -> Root Brief
  -> Core Control Cluster
  -> Growth Plan
  -> Workflow IR
  -> Branch / Leaf / Flower / Fruit
  -> Root Callback / Re-rooting
  -> Run Memory / Ring Memory / Soil
```

## 文档索引

| 文档 | 说明 |
| --- | --- |
| [01-根层.md](01-根层.md) | Root System：持续地下探索、吸收、Root Brief 版本化和 Root Callback |
| [02-干层.md](02-干层.md) | Core Control Cluster：主干固定核心、Growth Plan 和 Growth Plan Revision |
| [03-枝层.md](03-枝层.md) | Branch System：动态分支执行集群的协调结构 |
| [04-叶层.md](04-叶层.md) | Leaf Agents：具体执行个体 |
| [05-花层.md](05-花层.md) | Flower Cluster：验证、评审和成熟判断 |
| [06-果层.md](06-果层.md) | Fruit：交付、复用和脱离母体 |
| [07-土壤层.md](07-土壤层.md) | Soil：固定资产和治理层 |
| [08-状态机.md](08-状态机.md) | 状态机：Seed、Root、Plan、Run、Callback、Memory 的合法转换 |
| [09-学习系统.md](09-学习系统.md) | 运行沉淀系统：Run Memory、Experience Candidate、Path Bias 和 Ring Memory |
| [10-演化系统.md](10-演化系统.md) | 演化系统：基于证据的修订、分叉、停止和果实治理 |
| [11-通信机制.md](11-通信机制.md) | MessageBus、Router、状态机和事件记录 |
| [12-资产管理.md](12-资产管理.md) | 能力资产治理 |
| [13-工作流示例.md](13-工作流示例.md) | 工作流程示例 |

## 架构全景

```text
想象 Imagination
  用户原始提示词、意图、约束和模糊目标

种子层 Seed
  Seed Cluster 前置成像，形成 Seed Packet，并经过 User Approval Gate

土壤层 Soil
  固定资产、Capability Asset、治理规则、失败模式、历史证据

根系 Root System
  Initial Rooting / Lateral Rooting / Deep Rooting
  Root Crown Cluster 汇总根须信息，输出 Root Brief vN

主干 Core Control Cluster
  Trunk Synthesis、Critic、Planner、Revision Controller
  输出 Growth Plan vN 和 Workflow IR

枝叶 Branch / Leaf
  Branch System 组织动态执行集群，Leaf Agents 执行具体任务

花层 Flower
  验证、评审、成熟度判断、Root Callback 建议和交付前确认

果层 Fruit
  AgentApp、能力包、可脱离子 agent 或其他成熟交付物

年轮 Ring
  聚合 EventLog、Run Memory 和 Experience Candidate，观察生长趋势
```

## 核心约束

- Seed Cluster 是启动门，不是地下根系，也不是正式执行层。
- Root System 是持续地下生命系统，不能在生成第一版 Root Brief 后停止。
- Root Crown Cluster 负责汇总根系信息，但不能制定最终 Growth Plan。
- Core Control Cluster 是主干固定核心，不应退化为单个万能 agent；它通过低自由度集群抵抗单点认知失败。
- Growth Plan 必须引用具体 Root Brief 版本，并派生可执行、可验证、可修订的 Workflow IR。
- 地上组织发现信息不足、验证失败、目标变化或 Path Bias 失效时，可以触发 Root Callback。
- Branch / Leaf / Flower 只能通过 MessageBus、Router、状态机和 EventLog 协作。
- Run Memory 是单次运行摘要，Experience Candidate 是候选，Capability Asset 才能进入土壤。
- Path Bias 是牵引，不是复刻。
- Ring Memory 是聚合视图，不是平行事实源。
- Fruit 脱离母体前必须经过治理门。

## 与早期研究的关系

早期深度研究报告中的目标驱动、验证、演化、谱系、能力治理和 Agent 组织思想继续保留为资料来源，但旧 Canopy / Trunk / Root 分层不能直接作为当前产品语义。

当前映射：

| 早期结构 | 当前处理 |
| --- | --- |
| Canopy | 拆入 Seed Cluster、Core Control Cluster、Flower Cluster 和 Governance |
| Trunk | 收敛为 Core Control Cluster 内的主干综合与计划职责 |
| Root 能力执行层 | 不沿用 Root 命名；执行进入 Leaf，能力资产进入 Soil，交付进入 Fruit |

## 相关文档

- [ADR-0016: 种子层与持续根系架构](../ADR-0016-种子层与持续根系架构.md)
- [ADR-0015: 树形语义基线与 Root 重定义](../ADR-0015-树形语义基线与Root重定义.md)
- [开发指南总览](../../../开发指南/00-总览.md)
