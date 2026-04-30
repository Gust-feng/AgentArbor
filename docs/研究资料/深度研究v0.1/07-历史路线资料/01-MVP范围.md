# MVP 范围

## 目标

MVP 不证明 AgentArbor 无所不能。

MVP 只证明一件事：

> AgentArbor 能让一个用户目标沿着计划、执行、验证、Git commit 和反思，自动长成一个可运行 AgentApp 原型。

## MVP 必须包含

1. 用户输入目标。
2. 生成基础文档计划。
3. 生成动态任务图。
4. 调度少量 Agent 执行。
5. 修改项目文件。
6. 运行测试或至少运行 typecheck/build。
7. 根据失败进入 Repair。
8. 通过后 Git commit。
9. 生成事件日志。
10. Workbench 展示运行状态。

## MVP 可以暂缓

- 完整插件系统；
- 完整 MCP 市场；
- 复杂 Lineage View；
- 真正完整 Rebirth；
- 企业级权限；
- 多语言 AgentApp；
- 桌面端；
- 大规模多 Agent 并发。

## MVP 推荐 Agent

- RootOrchestrator；
- PlannerAgent；
- BuilderAgent；
- TestAgent；
- ReviewAgent；
- RepairAgent；
- GitAgent。

## MVP 推荐产物

生成一个简单但完整的 AgentApp，例如：

- 日报 AgentApp；
- 代码审查 AgentApp；
- 资料整理 AgentApp；
- 简单工作流 AgentApp。

## MVP 成功标准

- 从目标开始，不手写主要代码；
- 至少完成两轮自主迭代；
- 至少产生两次 Git commit；
- 有测试失败与修复演示；
- UI 可以展示 Agent、日志、Git、测试；
- 最终 AgentApp 可运行。
