# Agent 集群运行结构

## 总结构

AgentArbor 的 Agent 集群依附于原生概念树，而不是独立漂浮的一组角色。

```text
Soil
  -> Underground Center
      -> Goal Framer
      -> Constraint Framer
      -> Evidence Explorer
      -> Direction Critic
      -> Direction Synthesizer
  -> .agentarbor
  -> Aboveground Center
      -> Growth Planner
      -> Plan Critic
      -> Risk Governor
      -> Context Topology Builder
      -> Revision Controller
  -> Aboveground Growth
      -> single agent
      -> sub-agent tree
      -> shared team cluster
      -> competitive team cluster
  -> Fruits
  -> Governance
  -> Soil
```

约束工程贯穿这条结构。每个集群只接收自己需要的约束切片，但所有切片都必须能回溯到统一的 `Constraint`。

## 固定核心集群与动态任务集群

| 类型 | 位置 | 自由度 | 目的 |
| --- | --- | --- | --- |
| 固定核心集群 | Underground Center、Aboveground Center、Governance | 低 | 抵抗单点认知失败，保证方向、计划、验证和入土裁决稳定 |
| 动态任务集群 | Aboveground Growth | 高 | 扩展执行、协作、竞争验证和局部问题解决能力 |

原则是：越靠近执行，集群越动态；越靠近方向、计划和治理，集群越固定、低自由度、强验证。

## Underground Center

地下中枢负责需求成形、证据探索和方向综合。它可以包含多个探索 agent，但交付物必须收敛为 `.agentarbor` 方向交接包。

地下中枢不调度地上执行，不创建长期资产，不让候选约束自动变成 hard constraint。

## Aboveground Center

地上中枢负责制定和修订 Growth Plan 与 Workflow IR。它也是约束裁决点，必须判断哪些 hard constraint 阻断行动，哪些 soft constraint 可以带解释偏离，哪些 preference 只用于方案排序或 Path Bias。

## Aboveground Growth

地上生长组织根据 Growth Plan 动态选择运行形态：

- single agent：目标简单、风险低、验证清楚。
- sub-agent tree：任务可自然分解为父子上下文。
- shared team cluster：多个 agent 需要共享同一事实池和协作状态。
- competitive team cluster：需要并行方案、反审查或高风险验证。

地上生长组织不需要掌握完整全局，但必须掌握任务相关约束切片、验收标准、权限边界和证据提交要求。它们发现约束前提不成立或养料不足时，应报告偏离或发起 Nutrient Request，而不是自行豁免或自建方向探索集群。

## Verification And Fruits

验证组织负责检查 hard constraint、soft constraint 和 preference 的满足或偏离情况。它可以建议 Nutrient Request 或计划修订，但不能替代用户确认，也不能自行让候选果实入土。

Fruits 是交付和候选沉淀区。子 agent、能力包或 AgentApp 只有在经过 Governance 后，才可以成为 Soil 中的 Capability Asset 或 Path Bias 来源。

## 第一阶段边界

第一阶段不需要实现完整多集群自治网络，但必须保留结构边界：

- `UndergroundAnalyzer`：模拟地下中枢的需求成形和证据探索。
- `HandoffBuilder`：模拟 `.agentarbor` 方向交接包生成。
- `GrowthPlanner`：模拟地上中枢。
- `WorkerAgent`：模拟地上生长执行。
- `Verifier`：模拟验证组织。
- `MemoryWriter`：形成 Run Memory 和 Experience Candidate。
- `GovernanceReview`：判断候选果实是否能进入 Soil。

这样第一阶段仍然很小，但不会把 AgentArbor 错做成线性脚手架。
