# Multi-Agent 延期模块边界

## 当前结论

Multi-Agent 不属于当前生产运行时。`src/app/deep/`、`src/app/panel-server/deep-routes.ts`、关联 Panel 模块和旧 Chat/Responses transport 作为未来重构的代码基础保留，但当前 `createPanelRuntime()` 不创建 `MultiAgentFeature`，`/api/deep/*` 固定返回 `410 multi_agent_deferred`。

这不是删除 Multi-Agent，也不是把 Deep 的业务状态转换为 Ordinary 状态。已有 Deep 持久化数据、DTO 和实现不迁移、不双读、不在启动期加载。

## 保留与隔离

- 保留 Deep 内部的 manager、TaskBoard、scheduler、child、synthesis、仓储和测试，方便未来按能力筛选复用。
- 保留 Deep route adapter 的独立 reconstruction contract；它不接受当前 `PanelRuntime`，不能被生产路由直接调用。
- 当前生产组合根只装配 Ordinary 所需的 Pi AgentHarness/Session、ToolCenter、MCP、Skills、Sub-Agent 和 Host 资源。
- Panel 启动、关闭、运行目录和普通会话不再创建、清理或读取任何 Deep feature 状态。
- 旧 OpenAI Chat/Responses transport 仍作为延期代码的编译期依赖保留，不得从 Ordinary 或生产组合根重新进入运行路径。

## 重启条件

恢复 Multi-Agent 前必须先提出独立重构方案，并至少重新确认：产品入口、持久化数据策略、附件与 Host fetch 能力、模型通道边界、工具事实和确认语义、Panel surface，以及完整的行为验收。不得仅恢复 `createMultiAgentFeature()` 或 `/api/deep/*` 来重新启用历史实现。
