# ADR-0022: AgentArbor 桌面通用 Agent 与双运行时架构

日期：2026-05-07

状态：Partially Superseded by [ADR-0028-AgentArbor统一Workbench与功能模块化单体架构](ADR-0028-AgentArbor统一Workbench与功能模块化单体架构.md)

取代关系：Partially supersedes [ADR-0018-AgentArbor原生概念树架构](ADR-0018-AgentArbor原生概念树架构.md)。ADR-0018 保留为历史概念树和植物语义来源。自 2026-07-12 起，统一 Workbench、功能模块所有权和唯一 Composition Root 以 ADR-0028 为当前事实源；本文保留 Soil、Plan、Aboveground、Fruits、Governance 和 Global Soil 等长期能力边界，不再定义两个并列产品 runtime。

> 阅读提示：下文“双运行时”与完整流水线描述是本 ADR 当时的架构判断。当前实现不能据此建设 universal Run runtime、全局业务状态或每次请求必经的 Underground -> Plan -> Aboveground 流程。

## 决策

AgentArbor 的当前产品形态收缩为桌面通用 Agent：

```text
Desktop Shell
  -> Task Soil
  -> Underground Cognitive Runtime
  -> Plan
  -> Aboveground Execution Runtime
  -> Fruits
  -> Governance Pipeline
  -> Global Soil
```

一句话定义：

> AgentArbor 是一个桌面通用 Agent。用户给一个任务，系统从任务土壤出发，地下认知运行时按需动态派生子 Agent 做多方调研，父层综合裁决后形成 Plan，地上执行运行时按 Plan 执行交付，结果经过治理门回流长期土壤，因此越用越聪明。

本 ADR 不推翻现有地下 AI-first 代码基础，而是重新解释产品结构：地下 runtime 不再作为孤立研发目标，`.agentarbor` 不再作为产品概念树节点，Aboveground 不再是远未来概念，而是 Plan 的轻量执行 consumer。

## 动机

旧文档以 `Soil -> Underground Center -> .agentarbor -> Aboveground Center -> Fruits -> Governance -> Soil` 为事实源。它保留了有价值的职责边界，但作为当前产品主线存在三个问题：

1. **产品入口不清**：用户会误以为 Underground 和 Aboveground 是两个入口，而不是 Desktop Shell 背后的两个内部 runtime。
2. **`.agentarbor` 过度概念化**：它应是 Plan Package 的实现/存储形态，而不是宏大产品节点。
3. **平台愿景过大**：完整 Governance、Capability Asset、多层递归 Agent Fabric 和 AgentApp 出生机制不适合作为比赛 MVP 主线。

新的架构把 AgentArbor 解释为桌面任务工作台：用户给任务，系统组织上下文、派生 agent、形成 Plan、执行交付、沉淀经验。

## 产品形态

用户只面对 Desktop Shell 一个产品入口。Desktop Shell 包含：

- Task Inbox / 输入区。
- Workspace Context / 文件、项目、网页上下文。
- Main Canvas / 当前任务主画布。
- Artifact Area / 结果与 Plan。
- Observation Panel / 监督面板。

Main Canvas 解释“这个结果为什么合理”。Observation Panel 解释“agent 集群如何形成这个结果”。

三层解释结构：

```text
主画布默认：
  结论
  一句话理由
  关键证据引用

主画布展开：
  为什么选 A
  为什么不选 B
  主要风险
  不确定性
  相关 agent 摘要

Observation Panel：
  agent run tree
  child 输出摘要
  父层 synthesis
  convergence 事件
  模型和工具 refs
  budget
  trace
```

界面只展示 reasoningTrace 的安全投影，不展示 raw chain-of-thought、raw prompt、raw provider response、raw tool output、密钥或 token。

## Shared Agent Kernel + Two Product Runtimes

AgentArbor 不采用两个完全割裂的技术栈。正确结构是一个共享能力内核加两个产品语义 runtime。

Shared Agent Kernel：

- `AgentLoop`。
- `AgentTurnRuntime`。
- `ToolCenter`。
- `WorkspaceView`。
- `Mailbox`。
- `Guard`。
- `Trace`。
- Budget / Permission boundary。

Product Runtimes：

- Underground Cognitive Runtime：负责方向智能。
- Aboveground Execution Runtime：负责执行智能。

Underground 允许不确定、分叉、追问和停止。Aboveground 默认消费已成形 Plan，进入执行和验证。

## Task Soil + Global Soil

AgentArbor 引入双层 Soil。

Global Soil：

- 长期偏好。
- Capability Asset。
- Path Bias。
- 历史约束。
- 失败模式。
- 治理后的长期事实。

Task Soil：

- 当前任务目标。
- 文件引用。
- 项目上下文。
- 网页材料。
- 用户临时约束。
- 权限边界。
- 本轮运行材料。

Task Soil 是任务级临时土壤，避免每个杂任务直接污染长期 Soil。只有经过 Governance Pipeline 的内容才能回流 Global Soil。

## Plan 与 `.agentarbor`

保留可持久化 Plan / Plan Package。

Plan 的价值：

- 暂停恢复。
- 版本管理。
- 人类可读。
- 审计复盘。
- 跨进程消费。
- 防止 child output 直通执行。

`.agentarbor` 降级为 Plan Package 的实现/存储形态或目录名。对用户和产品文档，主要讲 Plan；如保留“方向交接”说法，限定为 Underground 到 Aboveground 的内部边界。

旧 10 文件方向交接包契约不再扩张。当前 Plan Package 应以少量稳定文件或内存结构承载 Plan、refs、validation 和 manifest。

## Agent Fabric

Agent Fabric 是动态派生 child agent 的执行机制，不是独立产品入口。

MVP 阶段：

- 只允许一层 child agent。
- `depth = 1`。
- Center Manager 可以派生 rootlet child。
- child 不可再派生孙 agent。
- descendant output 不能直接进入 Plan，必须经过父层 synthesis / convergence。

长期可扩展：

- `depth = 2+`。
- 需要 `maxDepth`、`maxChildrenPerAgent`、`maxTotalChildren`、`maxBudgetPerSubtree`、`allowedDelegationKinds`、`parentSynthesisRequired`、`noDirectHandoffFromDescendant` 等硬约束。

## 父层职责

- Center Manager：决定是否派生、等待、打断、继续探索、追问用户或停止。
- Growth Governor：建议探索预算、并行度、rootlet 类型、停止条件。
- Agent Fabric：按 `AgentSpec` 创建 child agent，执行权限、预算、上下文隔离。
- Parent Synthesis / Convergence：消费 child outputs，综合冲突材料，决定方向是否足够成立。
- Handoff / Plan Steward：组织 Plan，但不能绕过父层 convergence。

父层中枢默认不直接使用外部探索工具。父层可以读取内部观察材料，如 run tree、mailbox、trace、workspace summary。证据不足时应派 child 继续探索，而不是父层自己搜索。

## 四层权限模型

本轮实际能力由四层相交决定：

```text
AgentSpec 静态能力上限
  ∩ Parent DelegationDecision 动态授权
  ∩ AgentRunContext 当前阶段 / 任务 / 预算 / 用户授权裁剪
  ∩ ToolCenter / Guard 强制执行
  = 本轮实际能力
```

关键原则：

- `AgentSpec` 只定义上限。
- 父层只能在上限内授予能力。
- 当前运行阶段、任务权限、预算和 hard constraint 继续缩小权限。
- `ToolCenter` 是最终执行边界，不信任 prompt，也不信任模型自称权限。
- `ToolCenter` 最终应读取 `AgentRunContext` 中的有效权限，而不是只看 agent role。

## Nutrient Request 回路

Aboveground Execution Runtime 如果发现信息不足，不应自己重做地下探索，而应发起 Nutrient Request。

```text
Aboveground Execution Runtime
  -> Nutrient Request
  -> Underground Cognitive Runtime
  -> Nutrient Patch / Plan vNext
  -> Aboveground Execution Runtime
```

这个回路是执行智能和方向智能的边界保护机制。

## Governance Pipeline

Governance 不是 Memory 或 Candidate 本身。正确链路是：

```text
Fruits / Run Trace
  -> Run Memory
  -> Experience Candidate
  -> Governance Pipeline
  -> Capability Asset / Path Bias / Soil Update
```

Governance Pipeline 负责筛选、验证、归因、去重、版本化和退役管理。Governance 之前的经验只能是候选，不能直接进入 Global Soil。

## AI-first 边界

- agent 的 `reason()` 承担语义推理。
- `guard()` 只守 schema、预算、权限、hard constraint、脱敏和包结构。
- rootlet / child output 默认不可信，必须经父层综合。
- 无 `AgentTurnRuntime` 不允许产出 approved Plan。
- fake/stub AI runtime 是默认稳定测试路径。
- reasoningTrace 只保存安全投影，不保存 raw chain-of-thought。
- 工程边界不能替 agent 判断目标理解、候选排序、是否继续探索、工具选择、风险权衡或方向综合。

## MVP 范围

比赛阶段应优先完成：

1. Desktop Shell 产品骨架。
2. Task Soil 契约。
3. 当前 Underground Cognitive Runtime 与 Plan 的产品化收缩。
4. 轻量 Aboveground Execution Runtime，至少产出一种可见 Fruit。
5. Main Canvas 与 Observation Panel 的信息分工。

明确不做：

- 完整 IDE。
- 完整终端代理。
- 插件市场。
- 多用户系统。
- 完整 Governance / Capability Asset 平台。
- 多层递归 Agent Fabric。

## 后果

- 历史结论：当时要求活跃开发指南以 Desktop Shell 和双运行时架构为事实源；该要求现由 ADR-0028 的统一 Workbench 与功能模块化单体取代。
- ADR-0018 保留历史脉络，但不再作为当前产品主线。
- `.agentarbor` 只作为 Plan Package 的实现/存储形态出现。
- 地下 runtime 的成功标准从“交接包复杂”转为“能形成可执行、可解释、可监督的 Plan”。
- Aboveground 不再无限延后，MVP 至少需要轻量 consumer。
- Governance 保留长期位置，但 MVP 只做最小 Run Memory / Experience Candidate 沉淀。

## 相关文档

- [开发指南总览](../../开发指南/00-总览.md)
- [系统总览](../../开发指南/03-系统架构/01-系统总览.md)
- [Agent 集群运行结构](../../开发指南/03-系统架构/04-Agent集群运行结构.md)
- [Plan Package 与执行计划](../../开发指南/04-模型与契约/05-PlanPackage与执行计划.md)
- [ADR-0021: 地下 Agent 集群 AI 优先架构重构](ADR-0021-地下Agent集群AI优先架构重构.md)
