# ADR-0023：Local Runtime Lite Profile 与未来 Full Profile 演进边界

状态：Historical / Superseded by [ADR-0028-AgentArbor统一Workbench与功能模块化单体架构](ADR-0028-AgentArbor统一Workbench与功能模块化单体架构.md)

日期：2026-05-10

> 本文保留为 Lite / Full Profile 的历史演进方案，不再作为当前产品分层或共享运行时设计依据。当前采用一个 Workbench 下的功能模块化单体，不以 Profile 或统一 runtime 规划功能边界。

## 背景

[ADR-0022](ADR-0022-AgentArbor桌面通用Agent与双运行时架构.md) 定义 AgentArbor 的长期产品主线：`Desktop Shell -> Task Soil -> Underground Cognitive Runtime -> Plan -> Aboveground Execution Runtime -> Fruits -> Governance Pipeline -> Global Soil`。当前产品仍处于桌面 Agent 工作流成形阶段，需要让用户先能顺畅选择文件夹、交代任务、看到 Agent 工作并拿到结果。

当前实现需要保持轻量、干净和可用，同时让未来 Full Profile 从同一套运行时契约自然长出。最佳实践是演进式架构：先稳定一个垂直闭环，再逐步加深多 agent、治理、长期土壤和语义召回能力。

## 决策

AgentArbor 当前实现形态采用 `Lite Profile`：轻量桌面 Agent 工作流。它优先承载用户选择工作目录、输入任务、Agent 读取/搜索/执行/必要写入、生成结果、展示安全摘要和记录运行过程。

AgentArbor 未来完整形态采用 `Full Profile`：承接 ADR-0022 的双运行时和治理回流架构。Full Profile 在 Lite Profile 的运行时契约上扩展 Underground / Aboveground 双运行时、多 agent 编排、Plan Package、Run Memory、Global Soil、Capability Asset、pgvector 语义召回和治理回流。

Lite Profile 与 Full Profile 共用一套运行时契约，避免形成两套产品架构。UI 保持小清新和低心智负担，运行时保持专业边界、审计数据和可恢复结构。

## Lite Profile

Lite Profile 定义当前产品体验：

```text
选择文件夹
-> 输入任务
-> Agent 读取、搜索、执行、必要写入
-> 生成结果和产物
-> 面板展示安全摘要
-> 运行记录落库
```

Lite Profile 当前核心能力：

```text
Desktop Shell
Local Runtime Foundation
AgentTurnRuntime
ToolCenter
本地策略沙盒
PGlite RuntimeDatabase
Artifact / Event / Run 记录
Observation 安全投影
```

Lite Profile 的产品重点是让桌面 Agent 工作流先变得可信：用户知道当前工作目录是什么、Agent 使用了什么能力、哪些结果已经形成、哪些运行证据可以恢复和审计。

## Full Profile

Full Profile 定义未来完整形态：

```text
Desktop Shell
-> Task Soil
-> Underground Cognitive Runtime
-> Plan
-> Aboveground Execution Runtime
-> Fruits
-> Governance Pipeline
-> Global Soil
```

Full Profile 在 Lite Profile 的运行时契约上扩展：

- 多 agent 派生、父层 synthesis、convergence 和监督投影。
- Plan Package 的版本、谱系、validation 和跨进程消费。
- Run Memory、Experience Candidate、Capability Asset 和 Path Bias。
- Global Soil 的长期事实、偏好、能力资产和失败模式。
- PostgreSQL + pgvector 或兼容后端的语义召回。
- Governance Pipeline 的验证、去重、归因、晋升和退役机制。

## 共享运行时契约

Lite 和 Full 共用这些运行时契约：

```text
Workspace
Run
Event
ToolCall
ModelCall
Artifact
SandboxPolicy
RuntimeDatabase
AgentTurnRuntime
ToolCenter
```

业务层依赖 repository / port，不直接绑定 PGlite 私有实现。PGlite 是当前本地默认数据库方向；外部 PostgreSQL + pgvector 是未来可切换后端。当前实现可以先用本地文件型 RuntimeDatabase 验证契约、路径和安全投影，后续再把存储后端替换为 PGlite 或 PostgreSQL，而不改变业务层语义。

`.agentarbor/` 仍作为未来 Plan Package 形态，具体边界继续遵守 [ADR-0004](../工作区结构/ADR-0004-AgentArbor原生工作区.md)。当前运行数据进入 appHome / runHome，由 RuntimeDatabase 保存 Run、Event、ToolCall、ModelCall 和 Artifact 的安全记录；项目根目录 `.agentarbor/` 保持为 Plan Package 形态的出生位置。

## 演进规则

新功能先判断属于 Lite 当前闭环，还是 Full 后续扩展。当前开发优先补强 Agent 工作流闭环：工作目录、任务输入、模型与工具回合、本地策略沙盒、安全投影、运行记录和可恢复结果。

面板可以简洁，但运行时必须留下可恢复、可审计、可解释的数据。向量检索、治理回流、多 agent 编排都基于共享契约扩展。

数据库后端演进遵循端口优先：当前本地默认方向是 PGlite RuntimeDatabase，未来 PostgreSQL + pgvector 作为可切换后端承接语义检索和更强治理分析。业务层只依赖 RuntimeDatabase 契约，避免把本地文件、PGlite 或 PostgreSQL 的私有形态泄漏到 AgentTurnRuntime、ToolCenter、Observation Panel 或 Desktop Shell。

## 后果

当前产品可以保持轻量体验：用户只需要选择文件夹、输入任务、查看结果和安全摘要。实现者也有明确承接路径：Lite Profile 先稳定垂直闭环，Full Profile 在同一套运行时契约上扩展能力，让“小软件”的当前体验和“大架构”的后续演进保持统一。

历史结论曾要求后续代码围绕 Lite Profile 收敛并演进到 Full Profile；当前不再使用 Profile 规划模块。后续代码以 ADR-0028 的 Workbench、feature ownership、中性能力和唯一 Composition Root 为准。
