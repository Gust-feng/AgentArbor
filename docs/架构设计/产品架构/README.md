# AgentArbor 产品架构

这里放 AgentArbor 的产品架构说明。它主要回答三件事：项目是什么、当前怎么运行、相关架构文档看哪里。

## 项目简介

AgentArbor 是一个面向本地工作区的桌面通用 Agent。用户在 Desktop Shell 里提交任务，附加文件、文件夹或网页上下文，系统负责把这些材料组织成一次完整的桌面任务运行，包括上下文处理、模型调用、工具执行、命令确认和结果展示。

## 当前状态

- 默认入口是普通 `agent`
- 默认主线是 `用户消息 -> Task Soil -> 普通 Agent 主循环 -> 工具调用/命令确认 -> 结果投影`
- 显式 `deep` / Agent 集群是独立入口，设置启用后从侧栏进入
- 内部实现仍可使用 `deep`、`DeepRuntime` 和 `/api/deep/*`
- 默认请求不会自动升级为 deep

## 核心能力

- 处理连续会话
- 处理模型工具循环
- 处理需要确认的命令
- 记录运行事件和可见结果
- 支持工作区、文件和网页上下文
- 保留长期的 `Plan`、`Fruits`、`Governance Pipeline` 和 `Global Soil` 体系

## 产品闭环

```text
Desktop Shell -> Task Soil -> Underground Cognitive Runtime -> Plan -> Aboveground Execution Runtime -> Fruits -> Governance Pipeline -> Global Soil
```

- `Desktop Shell`：用户唯一入口
- `Task Soil`：本轮任务的临时上下文
- `Underground Cognitive Runtime`：方向理解和探索
- `Plan`：地下到地上的交接对象
- `Aboveground Execution Runtime`：按 Plan 执行和验证
- `Fruits`：交付物和运行产物
- `Governance Pipeline`：筛选可回流的经验
- `Global Soil`：长期偏好、能力资产和约束

## 目录内容

- [ADR-0022-AgentArbor桌面通用Agent与双运行时架构.md](ADR-0022-AgentArbor桌面通用Agent与双运行时架构.md)
- [ADR-0023-LocalRuntimeLiteProfile与未来FullProfile演进边界.md](ADR-0023-LocalRuntimeLiteProfile与未来FullProfile演进边界.md)
- [ADR-0024-桌面基础Agent与基础设施优先路线.md](ADR-0024-桌面基础Agent与基础设施优先路线.md)
- [ADR-0025-deep一期Manager自由决策循环与一层child最小闭环.md](ADR-0025-deep一期Manager自由决策循环与一层child最小闭环.md)
- [ADR-0026-子Agent工具能力架构.md](ADR-0026-子Agent工具能力架构.md)
- [ADR-0018-AgentArbor原生概念树架构.md](ADR-0018-AgentArbor原生概念树架构.md)

## 相关文档

- [CURRENT_RUNTIME_MODE.md](../../../CURRENT_RUNTIME_MODE.md)
- [docs/README.md](../../README.md)
- [开发指南](../../开发指南/README.md)
- [开发指南总览](../../开发指南/00-总览.md)
- [Agent 口径与命名](../../开发指南/01-基础/05-Agent口径与命名.md)
- [普通 Agent 自主运行契约](../../开发指南/04-模型与契约/09-普通Agent自主运行契约.md)

如果你只想先看当前软件怎么跑，先读 [CURRENT_RUNTIME_MODE.md](../../../CURRENT_RUNTIME_MODE.md)。
