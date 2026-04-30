# ADR-0014 Agent 集群与运行即沉淀

## 状态

已采纳。

本 ADR 的运行沉淀口径已被 [ADR-0015](ADR-0015-树形语义基线与Root重定义.md) 和 [ADR-0016](ADR-0016-种子层与持续根系架构.md) 细化：Seed Cluster 负责前置成像，Root System 负责持续探索，Branch / Leaf 负责执行，运行结束后形成 Run Memory、Experience Candidate 和 Path Bias。

## 背景

早期资料中反复出现 Agent 集群、多智能体群落、Cluster Router、Council / Forge / Trial / Asset Cluster 等概念。此前正式开发指南已经沉淀了内核、自研消息、状态、路由、产物、事件和治理边界，但 Agent 集群在正式指南中仍然偏弱。

如果只保留内核骨架，而不定义 agent 集群怎样运转，AgentArbor 会退化成一次性生成器或普通工作流工具。相反，Agent 集群应当解释 AgentArbor 如何在真实任务中看清目标、组织执行、验证结果、沉淀能力。

同时，能力沉淀不能等到重复任务出现时才补做。每一次运行都应该留下 Run Memory，并提取 Experience Candidate，让下一次相似任务形成 Path Bias（路径倾向）：不强行复刻上一轮流程，但天然倾向于参考上一轮已经开拓并验证过的工作流。

## 决策

AgentArbor 正式采用以下规则：

1. Agent 集群是运行层的核心组织形态，是内核骨架之上的运行血肉。
2. Agent 集群包括前置成像集群、持续根系、主干固定核心集群、动态分支执行集群、叶层执行个体和花层验证集群。
3. Agent 集群不是固定角色表，也不是多 agent 聊天室，而是按目标、能力、风险、权限、历史收获、Path Bias 和 Workflow IR 动态组建，并受 Core Control Cluster 与状态机约束。
4. 每个 agent 和每个集群都必须产生结构化交付物，否则不应被调度。
5. 每次运行都必须产生 Run Memory。可复用内容先成为 Experience Candidate，不自动等同于长期资产。
6. 后续相似任务应形成 Path Bias，优先参考已验证的路径、能力证据、失败模式和验证规则，但不能被历史路径强制锁死。
7. 长期资产、固定 agent、果实 agent 和可脱离子 agent 仍必须经过治理门。

## 架构影响

系统需要保留以下核心能力：

- `Core Control Cluster`、`Router` 或同类控制与调度组件。
- 集群生命周期：组建、输入、执行、验证、收获、解散或晋升。
- `RunMemory`、`ExperienceCandidate` 或同类运行沉淀。
- Workflow IR 中的收获节点、Root Callback、Path Bias 和复用条件。
- Agent / Cluster 输出的结构化交付物约束。
- 收获候选到长期资产的治理门。

## 第一阶段边界

第一阶段不实现完整多集群自治网络，不追求复杂 agent 数量。

第一阶段必须证明：

- 至少两个内部 agent 通过 MessageBus 协作。
- Router 可以按能力或任务类型分配执行者。
- EventLog 可以回放过程。
- ArtifactStore 可以记录产物。
- Verification 可以判断结果。
- RunMemory 可以记录本次运行的经验摘要。
- ExperienceCandidate 可以记录可复用经验候选。
- 下一次任务可以读取上一轮收获中的 Path Bias。

## 后果

此决策让 AgentArbor 的产品形态更清楚：

- 内核是骨架。
- Agent 集群是运行血肉。
- EventLog、Artifact 和 Verification 是证据。
- RunMemory 是每次任务的运行记忆。
- ExperienceCandidate 是进入治理前的经验候选。
- Path Bias 是后续相似任务对已验证路径的自然倾向。
- Governance 决定哪些收获可以成长为长期资产或果实。

这避免了两个错误方向：一是只造很多 agent 文件，二是只做一个没有生长能力的工作流执行器。
