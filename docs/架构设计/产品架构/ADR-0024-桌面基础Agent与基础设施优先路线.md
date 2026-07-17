# ADR-0024: 桌面基础 Agent 与基础设施优先路线

日期：2026-05-11

状态：Accepted

承接关系：[ADR-0028](ADR-0028-AgentArbor统一Workbench与功能模块化单体架构.md) 取代了“双运行时并列产品”口径，但保留本 ADR 的两个核心决策：Ordinary Agent 是默认工作方式，基础 Agent 能力优先于产品功能扩张。本文按当前实现更新 Ordinary 主线；Multi-Agent 内部闭环见 [ADR-0025](ADR-0025-deep一期Manager自由决策循环与一层child最小闭环.md)。

## 决策

AgentArbor 当前只把一条路径作为默认主线：用户在 Workbench 中提交消息，由 Ordinary Agent 理解上下文、调用授权工具、处理命令确认，并返回完整结果。Multi-Agent 只能由用户显式进入；Sub-Agent 是 Ordinary 的 SDK AgentTool，不是第三套运行时。

```text
Desktop Shell / Panel
  -> ordinary routes
  -> OrdinaryAgentFeature
  -> neutral AgentLoop
  -> OpenAI Agents SDK adapter
  -> ToolCenter / Confirmation
  -> ordinary-run/v3 canonical facts
  -> one-way read-model
```

Ordinary 的正式模型-工具循环由 OpenAI Agents SDK 承担。`AgentTurnRuntime` 继续服务 Deep child 和其他单轮模型消费者，但不再是 Ordinary 生产主链。`model-runtime` 负责从冻结的模型配置创建中性 `AgentLoop`；feature、Panel 和工具模块不得直接创建外部 SDK 对象。

## 功能所有权

- `OrdinaryAgentFeature` 自己拥有 conversation、run、状态、事件、确认 continuation、canonical 模型消息、工具事实、usage、文件仓储和 read-model。
- `ordinary routes` 只解析 HTTP/SSE 请求并调用 feature command/query，不推导完成语义，不重建模型历史。
- `AgentLoop` 只负责机械性的模型-工具-模型执行、流式文本、取消和 live confirmation continuation；业务完成、持久化与恢复由 Ordinary 决定。
- `ToolCenter` 负责工具执行、权限和命令确认，返回中性 `ToolCallResult`；它不拥有 Ordinary 状态或跨 feature 事件。
- Ordinary 使用 `ordinary-run/v3` 原子文件快照和独立的 `ordinary-conversation/v1` 控制文档。它不与 Multi-Agent 共享业务仓储。

## 基础能力优先

当前优先稳定以下能力，而不是扩张产品形态：

- 两种 OpenAI 协议的模型接入、流式输出、用量、取消和明确失败。
- canonical 上下文、工具调用与结果完整性、模型上下文压缩和恢复。
- 工具 schema、执行事实、命令确认、MCP、Skills、Sub-Agent 和本地工作区能力。
- 附件读取、网页读取、文件编辑、命令执行和清晰错误。
- feature-owned 持久化、单向 read-model、SSE 重放和资源释放。
- 行为测试、依赖方向守卫与真实 Panel 交互测试。

这些能力可以被 Ordinary 和 Multi-Agent 通过中性端口复用，但完成语义、状态、事件、仓储和 read-model 必须留在各自 feature。没有两个真实、稳定消费者时，不抽象通用数据库、统一 Run runtime、全局事件总线或 repository 基类。

## 默认边界

- Ordinary 是默认入口，不因任务复杂、历史状态或模型判断自动升级为 Multi-Agent。
- Multi-Agent 只通过显式 `/api/deep/*` 功能入口运行，内部状态与 Ordinary 隔离。
- Sub-Agent 只贡献 `call_sub_agent` 和 `spawn_sub_agent` 两个 SDK AgentTool；调用与结果进入父 Ordinary run，不能递归，也不建立独立 trace store 或 read-model。
- Task Soil、Plan、Aboveground、Fruits、Governance 和 Global Soil 是按真实需求出生的长期能力，不是普通请求的必经阶段。
- 普通回答、工具结果、错误、文件正文和 stdout/stderr 不得被“安全摘要”或展示投影替换。UI 摘要只能是额外展示字段。

## 数据与兼容

项目仍处于开发期。旧 BasicAgent、Desktop session、`MinimalRuntime`、应用层 Underground、旧 RuntimeDatabase 记录、旧 Ordinary snapshot 和旧 provider/settings schema 已清洁断代；不迁移、不双读、不为无价值本地数据保留兼容 facade。

## 后果

- 新的 Ordinary 能力必须优先进入 Ordinary feature 或明确的中性能力端口，不能恢复旧运行链。
- 引入成熟库必须能删除自研机械代码，并且不能形成第二份业务状态。
- Multi-Agent 可以复用模型、工具、确认和上下文机械能力，但不能读取 Ordinary store 或把 Deep 状态转换为 Ordinary 状态。
- 后续产品功能开发必须建立在这条简单主线上；不能用宏大概念包装普通文件操作、状态更新或一次模型调用。

## 相关文档

- [ADR-0020-智能通道与模型接入边界](ADR-0020-智能通道与模型接入边界.md)
- [ADR-0025-deep一期Manager自由决策循环与一层child最小闭环](ADR-0025-deep一期Manager自由决策循环与一层child最小闭环.md)
- [ADR-0027-工具执行事实与单向消费架构](ADR-0027-工具执行事实与单向消费架构.md)
- [ADR-0028-AgentArbor统一Workbench与功能模块化单体架构](ADR-0028-AgentArbor统一Workbench与功能模块化单体架构.md)
- [普通 Agent 主干开发指南](../../开发指南/06-工程实现/09-普通Agent主干开发指南/README.md)
