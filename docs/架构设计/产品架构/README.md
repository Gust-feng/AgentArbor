# AgentArbor 产品架构

这里保存 AgentArbor 的长期产品决策。当前事实源是 [ADR-0028-AgentArbor统一Workbench与功能模块化单体架构](ADR-0028-AgentArbor统一Workbench与功能模块化单体架构.md)。

## 当前产品边界

AgentArbor 是一个面向本地工作区的桌面通用 Agent Workbench。用户在同一个工作台提交任务、绑定上下文、监督动作并查看结果。

```text
Workbench
  ├─ Ordinary Agent（默认）
  │    └─ Sub-Agent（工具能力）
  └─ Multi-Agent（显式深入协作）
```

- Ordinary 与 Multi-Agent 分别拥有业务流程、状态、事件、仓储和 read-model；Sub-Agent 只贡献定义与 Pi AgentTool，调用事实归父 Ordinary run。
- Workbench 只组合入口、导航、历史和展示。
- 模型、工具、确认、上下文机械算法和系统适配作为中性能力被 feature 调用。
- 后端由唯一 Composition Root 装配，不建设 universal Run runtime 或全局业务状态。
- Task Soil、Plan、Aboveground、Fruits、Governance、Global Soil 是按需演进的长期能力，不是每次请求必经链路。

## 当前实现状态

目标产品边界已经统一，入口实现仍处于迁移期：默认入口是普通 Agent；当前 release 暂时隐藏 Multi-Agent 的设置 beta 开关和侧栏 `Agent 集群` 按钮，后端 `/api/deep/*`、内部 surface、Deep DTO 与独立数据分区仍保留。详情以 [CURRENT_RUNTIME_MODE.md](../../../CURRENT_RUNTIME_MODE.md) 为准。

## 当前决策

- [ADR-0028-AgentArbor统一Workbench与功能模块化单体架构](ADR-0028-AgentArbor统一Workbench与功能模块化单体架构.md)：当前产品边界、功能所有权、共享能力与组合根事实源。
- [ADR-0029-工具结果交付与Ordinary有序执行调度](ADR-0029-工具结果交付与Ordinary有序执行调度.md)：固定单结果包络、逐工具输出所有权、无工具数量/批量总预算限制；调度部分已由 ADR-0030 交给 Pi。
- [ADR-0024-桌面基础Agent与基础设施优先路线](ADR-0024-桌面基础Agent与基础设施优先路线.md)：保留 Ordinary Agent 默认和基础能力优先。
- [ADR-0025-deep一期Manager自由决策循环与一层child最小闭环](ADR-0025-deep一期Manager自由决策循环与一层child最小闭环.md)：保留 Multi-Agent 的 manager、TaskBoard、scheduler、child 和 parent synthesis 闭环。
- [ADR-0026-子Agent工具能力架构](ADR-0026-子Agent工具能力架构.md)：Sub-Agent 是 Ordinary Agent 工具能力。
- [ADR-0027-工具执行事实与单向消费架构](ADR-0027-工具执行事实与单向消费架构.md)：工具执行事实链与单向投影。
- [ADR-0031-工具定义保真与渐进曝光边界](ADR-0031-工具定义保真与渐进曝光边界.md)：定义保真、曝光/执行授权/确认分离、MCP 成本门控与 Pi active set 边界。
- [ADR-0032-路径记忆与长期记忆回流架构](ADR-0032-路径记忆与长期记忆回流架构.md)：定义 PathMemory 自动采集、记忆分层、写入触发、治理后召回与第一阶段边界。
- [ADR-0033-模型自主笔记记忆架构](ADR-0033-模型自主笔记记忆架构.md)：修正记忆主线为模型主动撰写、启动时注入的透明 Markdown 笔记；PathMemory 降级为运行档案。
- [ADR-0034-远程协同与选择性同步架构](ADR-0034-远程协同与选择性同步架构.md)：定义同一用户的桌面、零内容持久化 Linux Relay 与 Android APK 协同，账户/配对信任、在线投递和 AgentArbor 自有数据白名单。

## 历史或部分取代决策

- [ADR-0022-AgentArbor桌面通用Agent与双运行时架构](ADR-0022-AgentArbor桌面通用Agent与双运行时架构.md)：被 ADR-0028 部分取代；保留长期能力边界和历史判断。
- [ADR-0023-LocalRuntimeLiteProfile与未来FullProfile演进边界](ADR-0023-LocalRuntimeLiteProfile与未来FullProfile演进边界.md)：历史 Profile 方案。
- [ADR-0018-AgentArbor原生概念树架构](ADR-0018-AgentArbor原生概念树架构.md)：历史概念树与植物语义来源。

目录中的其他 ADR 保留其注明的历史、协议或局部决策价值，不能覆盖 ADR-0028 的当前产品和模块边界。

## 相关文档

- [当前软件运行方式](../../../CURRENT_RUNTIME_MODE.md)
- [文档总入口](../../README.md)
- [开发指南](../../开发指南/README.md)
- [开发指南总览](../../开发指南/00-总览.md)
- [功能模块边界与组合根](../../开发指南/06-工程实现/11-功能模块边界与组合根.md)
- [Agent 口径与命名](../../开发指南/01-基础/05-Agent口径与命名.md)
