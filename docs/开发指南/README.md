# 开发指南

本目录是 AgentArbor 开发前的正式指南。它采用分册结构，长期产品方向是桌面通用 Agent：用户通过统一 Desktop Shell 提交任务和工作区上下文，系统形成 Task Soil，经地下认知运行时成形 Plan，再由地上执行运行时交付 Fruits，并把可复用经验经过治理回流 Global Soil。当前活跃实现路线优先打磨默认普通桌面 Agent，把会话、模型工具循环、确认、安全投影、持久化和工作台结果展示先做稳。

开发指南不是过程归档、版本路线图或会议纪要。它只写稳定结论、工程边界和可执行契约。

长期产品架构事实源是 [ADR-0022-AgentArbor桌面通用Agent与双运行时架构](../架构设计/产品架构/ADR-0022-AgentArbor桌面通用Agent与双运行时架构.md)，当前活跃实现路线是 [ADR-0024-桌面基础Agent与基础设施优先路线](../架构设计/产品架构/ADR-0024-桌面基础Agent与基础设施优先路线.md)。[ADR-0018-AgentArbor原生概念树架构](../架构设计/产品架构/ADR-0018-AgentArbor原生概念树架构.md) 保留历史脉络和术语背景；被产品架构索引标记为当前决策的 ADR 可作为 ADR-0022 的下位细化，研究资料只作为背景输入。

## 阅读顺序

1. [总览](00-总览.md)
2. [基础](01-基础/README.md)
3. [核心闭环](02-核心闭环/README.md)
4. [系统架构](03-系统架构/README.md)
5. [模型与契约](04-模型与契约/README.md)
6. [智能体生命周期](05-智能体生命周期/README.md)
7. [工程实现](06-工程实现/README.md)

## 一句话定位

AgentArbor 是一个桌面通用 Agent。当前默认产品体验先像成熟桌面助手一样可用：用户可以连续提问、绑定工作区上下文、授权工具、等待确认并获得可审阅结果；Underground、Plan、Aboveground 和 Governance 是长期架构边界，等待未来 deep 项目显式重启后再继续扩展。

## 架构原则

- 用户只面对 Desktop Shell 一个产品入口；当前不展示 deep 入口，也不让用户直接面对 Underground 或 Aboveground 两个入口。
- Desktop Shell 包含 Task Inbox、Workspace Context、Main Canvas、Artifact Area 和 Observation Panel。
- Task Soil 保存当前任务目标、文件引用、项目上下文、网页材料、临时约束、权限边界和本轮运行材料。
- Global Soil 保存长期偏好、Capability Asset、Path Bias、历史约束、失败模式和治理后的长期事实。
- 当前默认普通 Agent 负责直接回答、模型工具循环、确认、安全事件和结果展示。
- Underground Cognitive Runtime 负责方向智能：目标成形、多路探索、动态派生 child agent、父层综合、裁决、追问或停止；当前冻结为未来 deep 项目，不主动扩展。
- Aboveground Execution Runtime 负责执行智能：消费已成形 Plan，进行文件修改、文档生成、原型制作、工具调用和验证；当前冻结为长期架构边界。
- 二者共享 Shared Agent Kernel，但业务语义不同；地下允许不确定、分叉、追问和停止，地上默认方向已经由 Plan 收束。
- Plan 是地下到地上的产品级交接对象；`.agentarbor` 只是 Plan Package 的实现/存储形态或目录名，不再作为独立产品节点。
- Agent Fabric 是动态派生 child agent 的执行机制，不是独立产品入口；MVP 只允许一层 child agent。
- child/rootlet 输出默认是局部材料，必须经过父层 synthesis / convergence 才能进入 Plan。
- 智能通道是所有模型能力的统一接入边界；agent 的 `reason()` 承担语义推理，`guard()` 只守 schema、预算、权限、hard constraint、脱敏和包结构。
- 无 `AgentTurnRuntime` 不允许产出 approved Plan；默认稳定测试应使用 fake/stub AI runtime 验证 AI 路径。
- reasoningTrace 只能保存安全投影：决策摘要、输入引用、模型/工具引用、不确定性和证据 refs，不保存 raw chain-of-thought。
- Fruits 不是 Global Soil；Run Memory、Experience Candidate 和候选能力必须经过 Governance Pipeline 才能入土。
- Path Bias 只能影响偏好和方案排序，不能覆盖 hard constraint。
- Codex、OpenCode、Agent Skills 等平台格式是适配层，不是 AgentArbor 产品语义的事实源。

## 使用规则

进入实现、重构、agent 设计、skill 设计、平台适配或运行时资产设计前，必须能在本指南中找到清楚的定位、边界、契约和验收依据。

本目录不保存：

- 版本路线说明。
- 会议或会话记录。
- 历史经验库。
- 研究资料原文。
- 演示视频和外部资料包。
- 机器可读运行时资产。
- 阶段推进计划、会话任务状态和工作流记录。

研究资料和架构设计中的有价值内容可以被吸收进本指南，但原始资料只保存在 `docs/研究资料/` 或 `docs/架构设计/`。开发指南保持清爽，资料库保持可追溯，两者不能互相替代。

阶段推进、任务续接、检查点和工作流状态不再由 `.trellis/tasks/` 管理，不在根目录新增 `Plan/` 或 `Plans/` 形成第二套计划入口。新的开发计划应进入正式开发指南、ADR、任务契约文档或代码实现边界。
