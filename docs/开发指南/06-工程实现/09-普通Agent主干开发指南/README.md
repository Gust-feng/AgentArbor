# 普通 Agent 主干开发指南

本目录约束 AgentArbor 默认普通 `agent` 的长期开发方向。目标不是继续堆能力，而是先把当前默认普通 Agent 做成一个可长期演进的高质量主干：单一主循环清楚、Agent 定义清楚、工具暴露与执行边界清楚、前后端职责清楚、用户可见语义朴素稳定。

当前生产链固定为 `request-handler -> ordinary-routes -> OrdinaryAgentFeature -> OpenAI Agents SDK adapter -> ToolCenter`。`OrdinaryAgentFeature` 独占 command/query/event、`ordinary-run/v2`、`canonicalMessages` 和单向 read-model；旧 BasicAgent、Desktop session、Panel run job 与 `MinimalRuntime` 不再是实现入口。

后续多 Agent、deep、Plan、Aboveground 和长期能力建设，都必须建立在这条普通 Agent 主干之上，而不是反向污染它。

## 文档列表

- [总原则](01-总原则.md)
- [主循环与 AgentDefinition](02-主循环与AgentDefinition.md)
- [工具分层与执行边界](03-工具分层与执行边界.md)：工具可见性、执行边界、事实结果契约、命令运行时和错误域分层。
- [前后端与用户视图](04-前后端与用户视图.md)
- [命名、边界与开发顺序](05-命名边界与开发顺序.md)
- [主干审查报告](06-主干审查报告.md)
- [兼容路径隔离](07-兼容路径隔离.md)
- [MCP 与 Skills 能力底座开发书](08-MCP与Skills能力底座开发书.md)
- [运行时守护层开发书](09-运行时守护层开发书.md)
- [Skills 官方兼容加载](10-Skills官方兼容加载.md)
- [子 Agent 工具能力开发书](11-子Agent工具能力开发书.md)
