# 开发指南

本目录是 AgentArbor 开发前的正式指南。它采用分册结构，吸收 `docs/研究资料/深度研究v0.1/` 和早期项目计划书中有价值的结构化表达，但以当前已经校正的产品方向为准。

开发指南不是历史归档、版本路线图或会议纪要。它只写稳定结论、工程边界和可执行契约。

## 阅读顺序

1. [总览](00-总览.md)
2. [基础](01-基础/README.md)
3. [核心闭环](02-核心闭环/README.md)
4. [系统架构](03-系统架构/README.md)
5. [模型与契约](04-模型与契约/README.md)
6. [智能体生命周期](05-智能体生命周期/README.md)
7. [工程实现](06-工程实现/README.md)

## 一句话定位

AgentArbor 是目标驱动的智能体 / 智能体应用（AgentApp）孕育与演化平台。它把用户提示词视为想象，由 Seed Cluster 前置成像为 Seed Packet；用户确认后种入 Soil，Root System 初始生根并在运行期持续生长，Core Control Cluster 制定和修订 Growth Plan 与 Workflow IR，Branch / Leaf / Flower 组织执行与验证，并通过 Run Memory、Path Bias、Experience Candidate、Capability Asset 和 Ring Memory 反哺土壤。

## 方向校正

早期计划书中“用自然语言生成垂直 Agent 应用”的方向保留，但需要校正：

- AgentArbor 不是一次性脚手架，也不是比赛式 demo 生成器。
- AgentArbor 不是简单的本地文件治理工具。
- AgentArbor 的主线不是“生成更多 agent 文件”，而是“让想象成种、种子生根、根系持续吸收、主干调控、地上执行、验证成熟、沉淀反哺形成闭环”。
- Seed Cluster 是启动门，Root System 是持续地下生命系统，Core Control Cluster 是主干固定核心，Branch / Leaf / Flower 是地上动态组织；它们都不能退化成固定模板或多 agent 聊天。
- 子 agent 可以是果实，但必须由真实任务、评估、权限收敛和谱系记录共同证明，不能从角色命名直接出生。
- Codex、OpenCode、Agent Skills 等平台格式是适配层，不是 AgentArbor 产品语义的事实源。

## 使用规则

进入实现、重构、agent 设计、skill 设计、平台适配或运行时资产设计前，必须能在本指南中找到清楚的定位、边界、契约和验收依据。

本目录不保存：

- 旧版本说明。
- 会议或会话记录。
- 历史经验库。
- 研究资料原文。
- 演示视频和外部资料包。
- 机器可读运行时资产。
- 阶段推进计划、会话任务状态和工作流记录。

研究资料和架构设计中的有价值内容可以被吸收进本指南，但原始资料只保存在 `docs/研究资料/` 或 `docs/架构设计/`。开发指南保持清爽，资料库保持可追溯，两者不能互相替代。

阶段推进、任务续接、检查点和工作流状态由 `.trellis/` 管理，不在根目录新增 `Plan/` 或 `Plans/` 形成第二套计划入口。
