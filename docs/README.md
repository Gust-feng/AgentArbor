# AgentArbor 文档

`docs/` 是 AgentArbor 的人类可读文档入口。

这里保存四类人类可读材料：

- 当前开发入口：稳定、可执行、面向实现的开发指南。
- 研究资料：深度研究报告、工程研究、外部参考研究和有长期参考价值的材料。
- 架构设计：长期架构决策、协议边界、工作区结构和产品架构资料。
- 历史看板：早期 Trellis 任务状态的人类态势快照，仅作背景，不再作为当前任务源或约束入口。

当前长期产品架构事实源是 [ADR-0028-AgentArbor统一Workbench与功能模块化单体架构](架构设计/产品架构/ADR-0028-AgentArbor统一Workbench与功能模块化单体架构.md)，当前工程边界以 [功能模块边界与组合根](开发指南/06-工程实现/11-功能模块边界与组合根.md) 为准。[ADR-0024](架构设计/产品架构/ADR-0024-桌面基础Agent与基础设施优先路线.md) 保留 Ordinary Agent 默认和基础能力优先，[ADR-0025](架构设计/产品架构/ADR-0025-deep一期Manager自由决策循环与一层child最小闭环.md) 保留 Multi-Agent 内部闭环，[ADR-0026](架构设计/产品架构/ADR-0026-子Agent工具能力架构.md) 与 [ADR-0027](架构设计/产品架构/ADR-0027-工具执行事实与单向消费架构.md) 继续有效。ADR-0022 被部分取代，ADR-0023 退为历史 Profile 方案。Space/Workspace 资源语义以 [ADR-0034](架构设计/产品架构/ADR-0034-Space工作区引用与对话资源生命周期.md) 与 [ADR-0035](架构设计/产品架构/ADR-0035-Conversation双资源owner与统一运行作用域.md) 为准（Conversation owner 与统一 Run 作用域以 ADR-0035 为准）。

历史经验、推进记录、阶段计划、会话沉淀、草案包和准备包不再保留在 `docs/` 活跃知识面中。对未来开发没有直接架构或研究价值的材料应删除，避免干扰。

当前文档目标是让新开发者在进入实现前能快速回答这些问题：

1. AgentArbor 为什么是桌面通用 Agent，而不是聊天框、IDE 替代品或一次性脚手架。
2. Workbench 如何作为统一产品壳组合 Ordinary 与 Multi-Agent，而不共享业务状态。
3. 当前默认 Ordinary Agent 如何完成直接回答、模型工具循环、确认、事件重放、会话持久化和 Skills 最小闭环。
4. Multi-Agent 如何作为显式功能保留 manager、TaskBoard、scheduler、child 和 parent synthesis 闭环。
5. Sub-Agent 为什么是 Ordinary 的工具能力，而不是第三种产品模式。
6. 模型、工具、确认、上下文机械算法和系统适配如何成为中性能力。
7. 唯一 Composition Root 和依赖测试如何阻止 route、Panel 与 feature 互相穿透。
8. Observation Panel 如何展示运行投影，同时保证普通回答、工具结果、错误信息、stdout/stderr、文件正文和开发上下文不被摘要链路吞掉。
9. Task Soil、Plan、Aboveground、Governance 和 Global Soil 如何按真实需求出生，而不是成为每次请求必经链路。
10. 开发时必须遵守哪些工程规则，以及哪些历史架构仅作为参考。

## 阅读顺序

1. [开发指南](开发指南/README.md)
2. [开发指南总览](开发指南/00-总览.md)
3. [基础](开发指南/01-基础/README.md)
4. [Agent 口径与命名](开发指南/01-基础/05-Agent口径与命名.md)
5. [核心闭环](开发指南/02-核心闭环/README.md)
6. [系统架构](开发指南/03-系统架构/README.md)
7. [模型与契约](开发指南/04-模型与契约/README.md)
8. [智能体生命周期](开发指南/05-智能体生命周期/README.md)
9. [工程实现](开发指南/06-工程实现/README.md)
10. [研究资料](研究资料/README.md)
11. [架构设计](架构设计/README.md)
12. [历史看板](任务看板/README.md)

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
    产品架构/
    协议边界/
    工作区结构/
    界面原型/
```

## 文档原则

- 开发指南只写稳定结论，不保留过程材料。
- 研究资料只保留对未来产品定位、架构、能力体系、工程实现有参考价值的研究报告和基础资料。
- 架构设计只保留长期结构性决策和架构资料。
- 任务看板只保留历史态势说明，不能再从 `.trellis/tasks/` 派生当前任务，也不能成为第二套计划源。
- 路线残留、命名残留、实验残留、经验流水、推进记录和准备资料包不进入活跃文档树。
- 所有目录名、文档名和正文默认使用简体中文。`README.md` 是目录索引文件的唯一保留例外。
- 平台适配文件、任务工作流、运行时草案和机器可读资产不放在 `docs/`。
- 文档内容必须能直接指导实现，不能只堆概念或口号。

## 与其他目录的边界

- `.trellis/` 保存历史 Trellis 工作流与规范材料；`.trellis/tasks/` 不再作为当前开发任务、约束或上下文入口。
- `.agents/` 保存官方 Agent Skills 兼容文件。
- `.codex/` 保存 Codex 开发适配文件。
- `.opencode/` 保存 OpenCode 开发适配文件。
- `.claude/` 保存 Claude Code 开发适配文件。
- `.agentarbor/` 是未来 Plan Package 的默认存储目录名，只在 Plan 契约、读写规则、权限边界和真实出生依据稳定后增量创建；它不是产品概念树节点，不保存最终资产，也不替代 Global Soil。
- `src/` 保存 AgentArbor TypeScript 实现代码；当前按 Workbench、Ordinary、Multi-Agent、Sub-Agent、中性能力和 Host Composition Root 收口。Agent 集群产品入口当前暂时隐藏，`/api/deep/*`、内部 surface 与分库存储仍是过渡实现；迁移期间必须保持行为与数据格式诚实。

`docs/开发指南/` 负责当前开发规则。

`docs/研究资料/` 和 `docs/架构设计/` 负责保存思想来源、研究材料和架构判断。后续实现可以吸收这些材料，但不能把其中任何单篇资料直接当作当前执行计划。

阶段推进、任务计划、续接状态和工作流记录不再由 `.trellis/tasks/` 管理；根目录不新增 `Plan/` 或 `Plans/` 作为并行计划入口。稳定的实现边界和验收门写入 `docs/开发指南/06-工程实现/`，长期架构决策写入 `docs/架构设计/`。

`.trellis/tasks/` 是历史任务材料；`.trellis/spec/` 中仍有价值的工程规则只能作为参考，不能覆盖 `AGENTS.md`、`docs/开发指南/` 和当前用户指令。`.agents/`、`.codex/`、`.opencode/`、`.claude/` 和 `.agentarbor/` 默认仍是本地开发态点目录，不进入当前提交基线。未来需要共享平台适配模板或运行时资产时，应先在架构设计或开发指南中明确边界，再调整提交策略。
