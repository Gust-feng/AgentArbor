# AgentArbor 文档

`docs/` 是 AgentArbor 的人类可读文档入口。

这里保存四类当前需要的人类可读材料：

- 当前开发入口：稳定、可执行、面向实现的开发指南。
- 研究资料：深度研究报告、工程研究、外部参考研究和有长期参考价值的材料。
- 架构设计：长期架构决策、协议边界、工作区结构和产品架构资料。
- 任务看板：从 Trellis 任务状态生成的人类态势看板资产，不是计划源数据。

当前产品架构事实源是 [ADR-0022-AgentArbor桌面通用Agent与双运行时架构](架构设计/产品架构/ADR-0022-AgentArbor桌面通用Agent与双运行时架构.md)。[ADR-0018-AgentArbor原生概念树架构](架构设计/产品架构/ADR-0018-AgentArbor原生概念树架构.md) 保留为历史架构基线和术语来源，但不再单独决定当前产品主线。

历史经验、推进记录、阶段计划、会话沉淀、草案包和准备包不再保留在 `docs/` 活跃知识面中。对未来开发没有直接架构或研究价值的材料应删除，避免干扰。

当前文档目标是让新开发者在进入实现前能快速回答这些问题：

1. AgentArbor 为什么是桌面通用 Agent，而不是聊天框、IDE 替代品或一次性脚手架。
2. Desktop Shell 如何接收任务、文件、项目和网页上下文，并形成 Task Soil。
3. Underground Cognitive Runtime 如何用 AI-first agent 协作完成目标成形、动态派生、父层综合、裁决、追问或停止。
4. Plan / Plan Package 如何承接地下收束结果，并作为 Aboveground Execution Runtime 的可持久化输入。
5. Aboveground Execution Runtime 如何按 Plan 进行文件修改、文档生成、原型制作、工具调用和验证。
6. Observation Panel 如何展示安全投影，而不泄漏 raw prompt、raw provider response、raw tool output 或 hidden reasoning。
7. Run Memory、Experience Candidate、Capability Asset 和 Path Bias 如何经过 Governance Pipeline 才能回流 Global Soil。
8. Shared Agent Kernel、权限模型、工具边界和模型运行时如何共同防止工程边界替 agent 思考。
9. 开发时必须遵守哪些工程规则。
10. 哪些架构设计和研究资料可以作为后续设计输入。

## 阅读顺序

1. [开发指南](开发指南/README.md)
2. [开发指南总览](开发指南/00-总览.md)
3. [基础](开发指南/01-基础/README.md)
4. [核心闭环](开发指南/02-核心闭环/README.md)
5. [系统架构](开发指南/03-系统架构/README.md)
6. [模型与契约](开发指南/04-模型与契约/README.md)
7. [智能体生命周期](开发指南/05-智能体生命周期/README.md)
8. [工程实现](开发指南/06-工程实现/README.md)
9. [任务看板](任务看板/README.md)
10. [研究资料](研究资料/README.md)
11. [架构设计](架构设计/README.md)

## 当前结构

```text
docs/
  README.md
  开发指南/
    README.md
    00-总览.md
    01-基础/
    02-核心闭环/
    03-系统架构/
    04-模型与契约/
    05-智能体生命周期/
    06-工程实现/
  任务看板/
    README.md
    看板.md
    规则.md
  研究资料/
  架构设计/
```

## 文档原则

- 开发指南只写稳定结论，不保留过程材料。
- 研究资料只保留对未来产品定位、架构、能力体系、工程实现有参考价值的研究报告和基础资料。
- 架构设计只保留长期结构性决策和架构资料。
- 任务看板只做 `.trellis/tasks/` 的人类可读投影视图，展示前置任务、当前任务和未来方向，不能成为第二套计划源。
- 路线残留、命名残留、实验残留、经验流水、推进记录和准备资料包不进入活跃文档树。
- 所有目录名、文档名和正文默认使用简体中文。`README.md` 是目录索引文件的唯一保留例外。
- 平台适配文件、任务工作流、运行时草案和机器可读资产不放在 `docs/`。
- 文档内容必须能直接指导实现，不能只堆概念或口号。

## 与其他目录的边界

- `.trellis/` 保存当前 AI 开发工作流、任务上下文和项目规范。
- `.agents/` 保存官方 Agent Skills 兼容文件。
- `.codex/` 保存 Codex 开发适配文件。
- `.opencode/` 保存 OpenCode 开发适配文件。
- `.claude/` 保存 Claude Code 开发适配文件。
- `.agentarbor/` 是未来 Plan Package 的默认存储目录名，只在 Plan 契约、读写规则、权限边界和真实出生依据稳定后增量创建；它不是产品概念树节点，不保存最终资产，也不替代 Global Soil。
- `src/` 保存 AgentArbor TypeScript 实现代码；当前已有地下 AI-first cognitive runtime、Agent Fabric 和监督面板基础，下一阶段应围绕 Desktop Shell、Task Soil 和轻量 Aboveground 执行闭环推进。

`docs/开发指南/` 负责当前开发规则。

`docs/研究资料/` 和 `docs/架构设计/` 负责保存思想来源、研究材料和架构判断。后续实现可以吸收这些材料，但不能把其中任何单篇资料直接当作当前执行计划。

阶段推进、任务计划、续接状态和工作流记录由 `.trellis/` 管理；根目录不新增 `Plan/` 或 `Plans/` 作为并行计划入口。稳定的实现边界和验收门写入 `docs/开发指南/06-工程实现/`。

当前 `.trellis/spec/`、`.trellis/tasks/`、`.trellis/scripts/`、`.trellis/workflow.md`、`.trellis/config.yaml`、`.trellis/.version` 和 `.trellis/.gitignore` 已作为共享 Trellis 事实源进入提交计划；`.trellis/.runtime/`、`.trellis/workspace/`、`.trellis/.developer` 和 `.trellis/.current-task` 继续保持本地运行态。`.agents/`、`.codex/`、`.opencode/`、`.claude/` 和 `.agentarbor/` 默认仍是本地开发态点目录，不进入当前提交基线。未来需要共享平台适配模板或运行时资产时，应先在架构设计或开发指南中明确边界，再调整提交策略。
