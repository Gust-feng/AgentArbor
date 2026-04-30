# Agent 集群运行结构

## 总结构

AgentArbor 的 Agent 集群依附于树形运行架构，而不是独立漂浮的一组角色。

```text
Seed Cluster
  -> Root System
      -> Rootlet Agents
      -> Root Agents
      -> Root Crown Cluster
  -> Core Control Cluster
  -> Branch System
      -> Branch Agents
      -> Branch Clusters
      -> Leaf Agents
  -> Flower Cluster
  -> Fruit
```

## 固定核心集群与动态任务集群

| 类型 | 位置 | 自由度 | 目的 |
| --- | --- | --- | --- |
| 固定核心集群 | Seed Cluster、Root Crown Cluster、Core Control Cluster、Flower Cluster | 低 | 抵抗单点认知失败，保证汇总、决策和验证稳定 |
| 动态任务集群 | Rootlet Cluster、Branch Cluster、Leaf Agents | 高 | 扩展探索和执行能力 |

原则是：越靠近探索和执行，集群越动态；越靠近汇总和决策，集群越固定、低自由度、强验证。

## Seed Cluster

Seed Cluster 是启动门。它把 Imagination 转化为 Seed Packet，并通过用户确认门决定是否种入 Soil。

它不调度 Root System，不执行正式任务，不创建长期资产。

## Root System

Root System 是持续地下生命系统。

- Rootlet Agents 是根须个体，负责探索、检索、外部事实、历史路径和局部风险。
- Root Agents 管一组根须，负责一个探索方向。
- Root Crown Cluster 是根颈固定核心，汇总所有根系报告，审计证据，识别冲突，形成 Root Brief。

Root System 的交付物是版本化 Root Brief。

## Core Control Cluster

Core Control Cluster 是主干固定核心，负责制定和修订 Growth Plan 与 Workflow IR。

它建议包含：

- Trunk Synthesizer：主导者，使用最强模型。
- Plan Critic：反审查。
- Risk Governor：治理权限、成本、风险和不可逆动作。
- Growth Recorder：记录决策、Root Callback、偏离和沉淀策略。

## Branch System

Branch Agent 是局部分支负责人。它接收 Growth Plan 中的分支目标，组织自己的 Branch Cluster，并向 Core Control Cluster 提交 Branch Report。

Branch Cluster 中的个体 agent 负责具体任务。它们不能自行修订 Growth Plan，也不能绕过 MessageBus、Router 和状态机。

## Flower Cluster

Flower Cluster 负责验证、评审、成熟度判断和验收建议。它可以触发 Root Callback，但不能替代用户确认，也不能自行让 Experience Candidate 入土。

## Root Callback

当地上组织遇到问题时，可以通过 Root Callback 回调地下组织：

```text
Branch / Leaf / Flower 发现问题
  -> Root Callback Request
  -> Root System 侧根扩展或深根重探
  -> 新 Root Brief 版本
  -> Core Control Cluster 修订 Growth Plan
```

## 第一阶段边界

第一阶段不需要实现完整多集群自治网络，但必须保留结构边界：

- `SeedAnalyzer`：模拟 Seed Cluster。
- `RootSystemExplorer`：模拟 Initial Rooting。
- `CorePlanner`：模拟 Core Control Cluster。
- `WorkerAgent`：模拟 Branch / Leaf。
- `Verifier`：模拟 Flower Cluster。
- `MemoryWriter`：形成 Run Memory 和 Experience Candidate。

这样第一阶段仍然很小，但不会把 AgentArbor 错做成线性脚手架。
