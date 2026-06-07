# Agent 集群运行结构

## 总结构

AgentArbor 的 agent 集群依附于 Desktop 任务闭环，而不是独立漂浮的一组角色。

Agent 集群是未来 deep / 深入模式的组织结构，不是当前默认普通 Agent 的隐式实现方式。普通会话、普通文件编辑、helper、adapter 和一次模型工具循环不应套用本章术语。

```text
Desktop Shell
  -> Task Soil
  -> Underground Cognitive Runtime
      -> Center Manager
      -> Growth Governor
      -> Agent Fabric
          -> rootlet / child agents
      -> Parent Synthesis
      -> Convergence
      -> Handoff / Plan Steward
  -> Plan
  -> Aboveground Execution Runtime
      -> execution agents / tool actions / verification
  -> Fruits
  -> Governance Pipeline
  -> Global Soil
```

约束工程贯穿这条结构。每个 agent 只接收自己需要的上下文和约束切片，但所有切片都必须能回溯到统一的 Task Soil、Plan 或 Global Soil 引用。

## Shared Agent Kernel

所有 agent 共享同一套能力内核：

- `AgentLoop`。
- `AgentTurnRuntime`。
- `ToolCenter`。
- `WorkspaceView`。
- `Mailbox`。
- `Guard`。
- `Trace`。
- Budget / Permission boundary。

新增 agent 不应靠复制固定 class 堆角色，而应先定义 `AgentSpec`、输入切片、输出契约、预算、权限和可观察投影。

## 权限模型

本轮实际能力由四层相交决定：

```text
AgentSpec 静态能力上限
  ∩ Parent DelegationDecision 动态授权
  ∩ AgentRunContext 当前阶段 / 任务 / 预算 / 用户授权裁剪
  ∩ ToolCenter / Guard 强制执行
  = 本轮实际能力
```

关键规则：

- `AgentSpec` 只定义上限。
- 父层只能在上限内授予能力。
- 当前运行阶段、任务权限、预算和 hard constraint 继续缩小权限。
- `ToolCenter` 是最终执行边界，不信任 prompt，也不信任模型自称权限。
- `ToolCenter` 最终应读取 `AgentRunContext` 中的有效权限，而不是只看 agent role。

## Underground Cognitive Runtime

地下运行时负责目标成形、证据探索、方向综合、追问、停止和 Plan 成形。它可以派生临时 child/rootlet agent，但所有局部产物必须回到父层综合。

### 父层职责

| 角色 | 职责 |
| --- | --- |
| Center Manager | 决定是否派生、等待、打断、继续探索、追问用户或停止 |
| Growth Governor | 建议探索预算、并行度、rootlet 类型和停止条件 |
| Agent Fabric | 按 `AgentSpec` 创建 child agent，执行权限、预算和上下文隔离 |
| Parent Synthesis / Convergence | 消费 child outputs，综合冲突材料，决定方向是否足够成立 |
| Handoff / Plan Steward | 组织 Plan，但不能绕过父层 convergence |

父层中枢默认不直接使用外部探索工具。父层可以读取内部观察材料，如 run tree、mailbox、trace 和 workspace summary。证据不足时应派 child 继续探索，而不是父层自己搜索。

### Child / Rootlet

child/rootlet 是最小探索单元，输出默认不可信。它们可以使用被授权的 search、read、workspace read 或其他工具做局部调研，但不能直接决定目标、约束、方向、风险裁决或 Plan 内容。

MVP 阶段：

- 只允许一层 child agent。
- `depth = 1`。
- Center Manager 可以派生 rootlet child。
- child 不可再派生孙 agent。
- descendant output 不能直接进入 Plan，必须经过父层 synthesis / convergence。

长期可扩展：

- `depth = 2+`。
- 只有被授予 delegate 权限的 child 可以继续派生。
- 必须有 `maxDepth`、`maxChildrenPerAgent`、`maxTotalChildren`、`maxBudgetPerSubtree`、`allowedDelegationKinds`、`parentSynthesisRequired` 和 `noDirectHandoffFromDescendant` 等硬约束。

## Aboveground Execution Runtime

地上执行运行时消费 Plan，组织执行和验证。它可以使用执行 agent、工具动作和验证节点，但不应自建方向探索集群。

当地上发现证据、约束、上下文或资产适配不足时，应发起 Nutrient Request。地下补充探索后产出 Nutrient Patch 或 Plan vNext，地上再决定继续、回退、分叉或停止。

## Verification And Fruits

验证组织负责检查 hard constraint、soft constraint 和 preference 的满足或偏离情况。它可以建议 Nutrient Request、执行修订或停止，但不能自行让候选果实入土。

Fruits 是交付和候选沉淀区。Run Memory、Experience Candidate、能力候选或可脱离 agent 只有在经过 Governance Pipeline 后，才可以成为 Global Soil 中的 Capability Asset 或 Path Bias 来源。

## 第一阶段边界

第一阶段不实现完整多集群自治网络。当前代码基础中已有的地下 AI-first cognitive runtime、动态派生 Agent Fabric 和监督面板可作为未来 deep 能力基础保留。当前活跃实现仍应围绕默认普通 Agent 和共享基础设施，避免把简单任务自动升级为集群流程。下一阶段若显式重启 deep，应围绕：

- Desktop Shell 产品骨架。
- Task Soil 契约。
- Plan Package 的产品化收缩。
- 轻量 Aboveground Execution Runtime。
- Main Canvas 与 Observation Panel 的信息分工。

这些能力形成可演示闭环后，再讨论多层递归 agent、完整治理资产系统和更广泛平台适配。
