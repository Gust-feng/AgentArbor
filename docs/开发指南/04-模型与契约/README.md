# 模型与契约

本章定义 AgentArbor 当前实现必须先稳定的数据模型。代码可以晚出生，但契约不能含混。

本章中的 Task Soil、Plan、Workflow IR、Nutrient Request、Nutrient Patch、Constraint、Capability Asset 和 Path Bias 定义长期能力边界。路径依赖（程序性记忆）已作为 `PathDependencyFeature` 落地：它按稳定 owner 保存模型主动提炼的方法论，通过有界目录、`MemorySearch`、`MemoryRead`、`MemoryReference` 与 `PathDependencySave` 渐进使用；完整正文不在 Run birth 全量注入。历史 PathMemory / Experience Candidate 实验仅保留为孤儿参考，不能作为路径依赖的来源或迁移输入。Dream、向量检索、Path Bias 与 Governance 不属于当前实现。

## 文档列表

- [核心数据模型](01-核心数据模型.md)
- [工作流中间表示](02-工作流中间表示.md)
- [智能体应用标准目录](03-智能体应用标准目录.md)
- [最小运行契约](04-最小运行契约.md)
- [Plan Package 与执行计划](05-PlanPackage与执行计划.md)
- [养料请求与补充契约](06-养料请求与补充契约.md)
- [约束工程](07-约束工程.md)
- [智能通道契约](08-智能通道契约.md)
- [普通 Agent 自主运行契约](09-普通Agent自主运行契约.md)
