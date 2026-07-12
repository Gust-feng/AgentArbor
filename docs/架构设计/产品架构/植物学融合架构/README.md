# 植物学融合架构

本目录保存 AgentArbor 早期植物学融合架构的详细资料。它仍有术语和职责边界参考价值，但不再是当前产品事实源。

当前产品架构事实源是 [ADR-0028-AgentArbor统一Workbench与功能模块化单体架构](../ADR-0028-AgentArbor统一Workbench与功能模块化单体架构.md)。[ADR-0022-AgentArbor桌面通用Agent与双运行时架构](../ADR-0022-AgentArbor桌面通用Agent与双运行时架构.md) 的并列产品口径已被部分取代，[ADR-0018-AgentArbor原生概念树架构](../ADR-0018-AgentArbor原生概念树架构.md) 继续作为历史来源。

当前正式主线是：

```text
Workbench -> Ordinary Agent（默认）/ Multi-Agent（显式功能） -> 结果与活动
                         Ordinary Agent -> Sub-Agent（按需工具）
```

本目录中的 `.agentarbor`、Direction Handoff、Growth Plan 和完整植物层级描述应作为历史背景阅读。后续实现和开发指南应优先使用 Plan、Task Soil、Global Soil、Shared Agent Kernel、Underground Cognitive Runtime 和 Aboveground Execution Runtime。

## 文件列表

| 文件 | 说明 |
| --- | --- |
| [01-根层.md](01-根层.md) | 地下中枢：需求成形、证据探索、方向综合和养料供给 |
| [02-干层.md](02-干层.md) | 地上中枢：Growth Plan、Workflow IR、上下文拓扑和计划修订 |
| [03-枝层.md](03-枝层.md) | 地上生长协调：分支任务、团队组织和执行状态 |
| [04-叶层.md](04-叶层.md) | 地上生长执行：具体执行个体、工具调用和产物提交 |
| [05-花层.md](05-花层.md) | 验证与成熟度判断 |
| [06-果层.md](06-果层.md) | 果实与候选沉淀 |
| [07-土壤层.md](07-土壤层.md) | Soil 与 Governance：固定资产、治理规则和入土门 |
| [08-状态机.md](08-状态机.md) | 状态机：Direction、Handoff、Plan、Run、Nutrient、Memory 的合法转换 |
| [09-学习系统.md](09-学习系统.md) | Run Memory、Experience Candidate、Path Bias 和能力资产学习 |
| [10-演化系统.md](10-演化系统.md) | 计划修订、分支、停止和治理演化 |
| [11-通信机制.md](11-通信机制.md) | MessageBus、EventLog 和跨层通信 |
| [12-资产管理.md](12-资产管理.md) | Capability Asset、Path Bias、规则和退役 |
| [13-工作流示例.md](13-工作流示例.md) | 历史工作流示例 |

## 使用规则

- 可以参考其中对地下、地上、果实和治理职责的拆分。
- 不能把旧 `.agentarbor` 概念树节点恢复为当前产品主线。
- 不能把完整 Governance、Capability Asset 或多层递归 agent fabric 写成当前已经完成的能力。
- 与 ADR-0028 或 `docs/开发指南/` 冲突时，以 ADR-0028 和开发指南为准。
