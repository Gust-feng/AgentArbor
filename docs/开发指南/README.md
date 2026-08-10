# 开发指南

本目录是 AgentArbor 开发前的正式指南。产品只有一个 Workbench，Ordinary Agent 是当前唯一生产主线，Sub-Agent 是 Ordinary Agent 的工具能力；Multi-Agent 源码仅作为延期材料保留，不属于当前首页入口、生产 Composition Root 或当前对话方案。`PathDependencyFeature` 已作为 owner-scoped 程序性记忆 feature 进入生产组合根，Memory Center 通过 facade 管理它与 Agent Notes。Ordinary、Sub-Agent 和中性模型/工具/确认/上下文能力按功能边界协作，执行事实归 owning feature。

开发指南不是过程归档、版本路线图或会议纪要。它只写稳定结论、工程边界和可执行契约。

长期产品架构事实源是 [ADR-0028-AgentArbor统一Workbench与功能模块化单体架构](../架构设计/产品架构/ADR-0028-AgentArbor统一Workbench与功能模块化单体架构.md)，工程实现以 [功能模块边界与组合根](06-工程实现/11-功能模块边界与组合根.md) 为准。ADR-0024、ADR-0026、ADR-0027 分别保留 Ordinary 默认、Sub-Agent 工具和工具事实链契约；ADR-0025 仅保留延期 Multi-Agent 内部闭环的历史边界；Space/Workspace 资源生命周期以 ADR-0034 为准，Conversation owner 与统一 Run 作用域以 ADR-0035 为准。ADR-0022 仅保留未被取代的长期能力边界，ADR-0023 是历史 Profile 方案。

## 阅读顺序

1. [总览](00-总览.md)
2. [基础](01-基础/README.md)
3. [Agent 口径与命名](01-基础/05-Agent口径与命名.md)
4. [函数与模块命名规范](01-基础/06-函数与模块命名规范.md)
5. [核心闭环](02-核心闭环/README.md)
6. [系统架构](03-系统架构/README.md)
7. [模型与契约](04-模型与契约/README.md)
8. [智能体生命周期](05-智能体生命周期/README.md)
9. [工程实现](06-工程实现/README.md)
10. [普通 Agent 主干开发指南](06-工程实现/09-普通Agent主干开发指南/README.md)
11. [子 Agent 工具能力开发书](06-工程实现/09-普通Agent主干开发指南/11-子Agent工具能力开发书.md)
12. [功能模块边界与组合根](06-工程实现/11-功能模块边界与组合根.md)
13. [共享工具层收敛与重复实现治理](06-工程实现/16-共享工具层收敛与重复实现治理.md)
14. [Multi-Agent 源码归档边界](06-工程实现/17-Multi-Agent源码归档边界.md)
15. [Space、Workspace、Conversation 与资源权限开发指南](06-工程实现/18-Space工作区对话与资源权限开发指南.md)
16. [路径依赖（程序性记忆）开发指南](06-工程实现/19-路径依赖方法论记忆开发指南.md)

## 一句话定位

AgentArbor 是一个桌面通用 Agent Workbench。当前用户直接使用 Ordinary Agent；Sub-Agent 只作为 Ordinary 的工具能力。Multi-Agent 仅保留为延期源码和长期研究边界，不属于当前首页入口、对话 owner 或生产运行时。

## 架构原则

- 用户只面对一个 Workbench；当前生产 surface 是 Ordinary。首页是新 Conversation 的唯一入口，Conversation 创建后固定属于一个 Space，不能在对话中切换 Space 或 Workspace。
- Desktop Shell 包含 Task Inbox、Workspace Context、Main Canvas、Artifact Area 和 Observation Panel。
- Task Soil 保存当前任务目标、文件引用、项目上下文、网页材料、临时约束、权限边界和本轮运行材料。
- Agent Notes 与 PathDependencyFeature 分别保存声明性记忆和模型主动提炼的方法论；Global Soil、Capability Asset、Path Bias 与治理后的长期事实仍是未来按需能力，不是当前记忆回流链。
- 当前默认普通 Agent 负责直接回答、模型工具循环、命令确认、工具结果回传和结果展示；当前阶段能力优先，不以脱敏或安全投影限制普通回答。
- 普通 Agent 不自动升级到 Underground，不派生 child/rootlet，不把普通文件编辑、helper、adapter 或一次工具循环包装成 Plan / Handoff / deep flow。
- 子 Agent 是普通 Agent 的工具能力，不是独立编排流程；模型在普通会话中通过 Pi AgentTool 适配的 `agent_call` / `agent_spawn` 自主调用，子 Agent 不能递归派生，完整输出作为工具结果交回父层模型（见 [ADR-0026](../架构设计/产品架构/ADR-0026-子Agent工具能力架构.md)）。
- Underground Cognitive Runtime、Plan、Aboveground、Governance 和 Global Soil 是未来按真实需求出生的长期能力；当前不进入 Ordinary 的默认路径，也不由 Multi-Agent 延期源码自动提供。
- Aboveground Execution Runtime 负责执行智能：消费已成形 Plan，进行文件修改、文档生成、原型制作、工具调用和验证；当前作为长期架构边界保留。
- Ordinary 通过中性模型、工具、确认、上下文算法和系统适配运行；业务状态、事件、仓储和 read-model 归 owning feature。Sub-Agent 不建立平行业务状态，其调用与结果由父 Ordinary run 持有。
- Workbench Shell 只组合导航、输入、历史和展示，不推导 feature 运行事实。
- 项目使用唯一后端 Composition Root 装配 feature；不建设 universal Run runtime、全局业务状态或统一工作流引擎。
- Plan 是地下到地上的产品级交接对象；`.agentarbor` 只是 Plan Package 的实现/存储形态或目录名，不再作为独立产品节点。
- Agent Fabric 和 child/rootlet 仍是长期研究边界，不是当前产品入口或普通文件操作的包装名。
- 智能通道是所有模型能力的统一接入边界；agent 的 `reason()` 承担语义推理，`guard()` 只守 schema、预算、权限、hard constraint 和包结构。
- `agent`、`atomic`、`Plan`、`Handoff` 等命名必须匹配真实职责；`atomic` 只用于真正有全成功/全失败、回滚或一致性边界的场景。
- `AgentTurnRuntime` 仅服务 Deep child，不是 Ordinary 主链；默认稳定测试应使用 fake/stub model loop 验证 AI 路径。
- reasoningTrace 只保存决策摘要、输入引用、模型/工具引用、不确定性和证据 refs，不保存 raw chain-of-thought。
- 历史 PathMemory、Experience Candidate 和候选能力不参与当前运行或迁移；未来若治理链出生，Path Bias 只能影响偏好和方案排序，不能覆盖 hard constraint。
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
