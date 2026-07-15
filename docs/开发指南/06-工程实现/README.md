# 工程实现

本章定义代码实现阶段的工程约束。当前仓库按同仓功能模块化单体收口：Workbench 是统一产品壳，Ordinary Agent 是默认工作方式，Multi-Agent 是显式功能，Sub-Agent 是 Ordinary 的 SDK AgentTool。Ordinary 与 Multi-Agent 分别拥有业务状态、事件、仓储和 read-model，只通过中性模型、工具、确认、上下文算法和系统 adapter 协作；Sub-Agent 定义与 AgentTool 由自身模块贡献，执行事实归父 Ordinary run。生产后端由唯一 Composition Root 装配。当前 `/api/deep/*`、beta 侧栏入口与独立 Deep 数据分区仍保留为迁移事实。普通回答、工具结果和错误信息不得被“脱敏”“安全投影”或摘要化链路吞掉。

## 文档列表

- [技术主线](01-技术主线.md)
- [模块划分](02-模块划分.md)
- [人工智能与确定性边界](03-人工智能与确定性边界.md)
- [测试与验收](04-测试与验收.md)
- [文档治理](05-文档治理.md)
- [最小实现边界](06-最小实现边界.md)
- [阶段验收边界](07-阶段验收边界.md)
- [默认 Agent 后续开发流程](08-默认Agent后续开发流程.md)
- [普通 Agent 主干开发指南](09-普通Agent主干开发指南/README.md)
- [多 Agent 最小协作闭环开发书](10-多Agent最小协作闭环开发书.md)
- [功能模块边界与组合根](11-功能模块边界与组合根.md)

## 当前最小运行命令

根目录工具链使用 `pnpm + TypeScript + tsc + node:test + Vitest/React Testing Library`：

- `pnpm build`：编译 Node TypeScript、检查 Panel 类型并构建 Panel。
- `pnpm test:panel`：运行 Panel 的 Vitest/RTL 真实交互测试。
- `pnpm test`：完整构建后运行 Node 行为/架构测试、Panel 交互测试与发布门。
- `pnpm smoke:real-ai`：通过正式 Panel Ordinary 入口执行可选的真实 OpenAI 冒烟验证；成功要求正常完成、至少一个持久化工具事实和有效 provider usage，`approval_needed` 立即诊断失败；需要显式配置凭据。
