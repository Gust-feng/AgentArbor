# 工程实现

本章定义代码实现阶段的工程约束。当前仓库按同仓功能模块化单体收口：Workbench 是统一产品壳，Ordinary Agent 是唯一生产功能，Sub-Agent 是 Ordinary 的 Pi AgentTool。Multi-Agent 源码保留为延期重构参考，但不由生产 Composition Root 装配，`/api/deep/*` 固定返回 `410 multi_agent_deferred`。普通回答、工具结果和错误信息不得被“脱敏”“安全投影”或摘要化链路吞掉。

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
- [Pi 原生底层迁移契约](12-Pi原生底层迁移契约.md)
- [Multi-Agent 延期模块边界](13-Multi-Agent延期模块边界.md)
- [路径记忆第一阶段开发方案](15-路径记忆第一阶段开发方案.md)
- [共享工具层收敛与重复实现治理](16-共享工具层收敛与重复实现治理.md)
- [Multi-Agent 源码归档边界](17-Multi-Agent源码归档边界.md)
- [Space、Workspace、Conversation 与资源权限开发指南](18-Space工作区对话与资源权限开发指南.md)
- [Conversation 双资源 owner 与统一运行作用域（Accepted）](../../架构设计/产品架构/ADR-0035-Conversation双资源owner与统一运行作用域.md)

## 当前最小运行命令

根目录工具链使用 `pnpm + TypeScript + tsc + node:test + Vitest/React Testing Library`：

- `pnpm build`：编译 Node TypeScript、检查 Panel 类型并构建 Panel。
- `pnpm test:panel`：运行 Panel 的 Vitest/RTL 真实交互测试。
- `pnpm test`：完整构建后运行 Node 行为/架构测试、Panel 交互测试与发布门。
- `pnpm smoke:real-ai`：通过正式 Panel Ordinary 入口执行可选的真实 OpenAI 冒烟验证；成功要求正常完成、至少一个持久化工具事实和有效 provider usage，`approval_needed` 立即诊断失败；需要显式配置凭据。
