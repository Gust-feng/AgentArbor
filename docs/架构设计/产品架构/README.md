# 产品架构

本目录保存 AgentArbor 产品形态、系统架构、智能体体系和通信机制的长期结构性决策。

## 职责

此目录保存 AgentArbor 未来产品的核心架构决策，包括：
- 智能体体系设计（骨架智能体、动态智能体、智能体发育）
- 系统架构设计（分层、集群、通信）
- 核心机制设计（状态机、演化系统、验收矩阵）

## 与其他目录的关系

- 与 `协议边界/` 分离：协议边界关注"用什么格式"，架构关注"怎么设计"
- 与 `工作区结构/` 分离：工作区结构关注"文件放哪里"，架构关注"系统怎么运作"

## 当前决策

- [ADR-0011-AgentArbor未来架构.md](ADR-0011-AgentArbor未来架构.md)：前置融合方向，确立固定骨架、动态发育和分层通信。
- [ADR-0012-植物学融合架构候选基线.md](ADR-0012-植物学融合架构候选基线.md)：历史候选基线，保留植物学融合架构的七层框架，但 Root 语义已被 ADR-0015 修正，并由 ADR-0016 扩展为持续根系架构。
- [ADR-0013-内核自研与协议适配边界.md](ADR-0013-内核自研与协议适配边界.md)：规定 AgentArbor 内部运行时使用自研消息、状态、路由和治理骨架，外部协议只通过 adapter 接入。
- [ADR-0014-Agent集群与运行即沉淀.md](ADR-0014-Agent集群与运行即沉淀.md)：规定 Agent 集群是运行血肉，每次运行都必须形成运行沉淀，并让后续相似任务形成 Path Bias（路径倾向）；其集群结构由 ADR-0016 继续细化。
- [ADR-0015-树形语义基线与Root重定义.md](ADR-0015-树形语义基线与Root重定义.md)：树形语义修正基线，规定 Soil、Root Cluster、Root Brief、Trunk Synthesis、Growth Plan、Run Memory、Path Bias、Capability Asset、Fruit 和 Ring Memory 的关系；当前运行主线已由 ADR-0016 扩展。
- [ADR-0016-种子层与持续根系架构.md](ADR-0016-种子层与持续根系架构.md)：当前正式树形运行架构，规定 Imagination、Seed Cluster、Seed Packet、User Approval Gate、Root Continuity、Root Callback 和 Growth Plan Revision。
- [植物学融合架构/](植物学融合架构/)：当前详细架构资料，描述根、干、枝、叶、花、果、土壤七层和运行沉淀、演化、资产系统。
