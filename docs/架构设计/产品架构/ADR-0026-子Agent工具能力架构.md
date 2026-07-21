# ADR-0026: 子 Agent 工具能力架构

日期：2026-06

状态：Accepted（2026-07 更新为 Pi AgentTool 原生适配实现）

承接关系：演进 [ADR-0024](ADR-0024-桌面基础Agent与基础设施优先路线.md) 的 Ordinary 工具体系，与 [ADR-0025](ADR-0025-deep一期Manager自由决策循环与一层child最小闭环.md) 的 Multi-Agent 闭环互补。[ADR-0028](ADR-0028-AgentArbor统一Workbench与功能模块化单体架构.md) 继续确认 Sub-Agent 是 Ordinary Agent 的工具能力，而不是产品模式。

## 背景

Ordinary Agent 经常需要把一个边界清楚的局部任务交给专家，但这不需要启动 Multi-Agent 的 manager、TaskBoard、scheduler、run tree 和 parent synthesis。

早期实现为此自建了 Sub-Agent runner、批量工具、输出续读、事件、trace 和 read-model。随着 Ordinary 正式切换到 Pi AgentHarness，这些机制与 Pi AgentTool 能力重复，并在父 run 之外制造了第二套执行与观察事实。

## 决策

Sub-Agent 继续作为 Ordinary Agent 的工具能力，但正式实现采用 Pi AgentHarness 原生 AgentTool 适配：

- `call_sub_agent` 调用一个已登记且启用的专家。
- `spawn_sub_agent` 创建一个只服务本次调用、不会持久化的一次性专家。
- 两个工具只向 capability catalog 提供 catalog-only definition，并与冻结 Ordinary run 的普通工具边界使用同一曝光决策；不向 ToolRegistry 注册假 executor。
- 旧批量与专用续读工具退役。
- 旧自研 runner、Sub-Agent 事件、trace store、独立 read-model 和独立持久化退役。
- nested Agent 的完整最终输出直接作为 AgentTool 结果返回父模型。

Sub-Agent 不拥有独立 conversation、task board、run tree、业务状态、仓储或 UI surface。Ordinary feature 仍是父 run 的状态、确认 continuation、持久化和 read-model owner；Pi AgentTool adapter 只负责 nested Agent 的机械模型-工具循环。AgentTool 调用与结果作为 Ordinary 标准 tool facts 持久化和展示，不发布专用 Sub-Agent 事件。

## 定义与发现

已登记专家采用目录包：

```text
<sub-agent-root>/<package-name>/SUB_AGENT.md
```

`SUB_AGENT.md` 使用 YAML frontmatter 与 Markdown 正文。名称、描述、enabled、使用边界和 `allowed-tools` 由 loader 校验；正文作为专家 instructions 主体。

发现支持 `builtin`、`user`、`project` 与显式 custom root，并用稳定 precedence 解决重名。无效定义保留诊断信息但不暴露给新 run。每个 Ordinary run 使用冻结后的目录事实，运行中不因磁盘变化替换专家身份或权限。

## 权限与递归

Sub-Agent 实际工具集合只能收窄：

```text
parent allowedTools
  ∩ current executable tools
  ∩ optional SUB_AGENT.md / spawn declaration
  - all Sub-Agent tools
```

- `call_sub_agent` 使用专家定义的 `allowed-tools` 做可选收窄。
- `spawn_sub_agent.allowed_tools: null` 表示继承父 run 可执行工具上限；数组表示显式收窄；空数组表示不给工具。
- 请求父 run 未授权或当前不可执行的工具时明确失败。
- `call_sub_agent`、`spawn_sub_agent` 和已退役的旧 Sub-Agent 工具名都不得进入 nested Agent 工具集合。

因此 Sub-Agent 不能递归派生，也不能借定义文件或动态输入扩张父 run 权限。

## 共享能力边界

Sub-Agent 通过精确端口复用 Ordinary 已装配的能力：

- Pi AgentHarness 创建并运行 nested Agent。
- 父 `ToolExecutionGateway` / ToolCenter 执行 nested Agent 的机械工具调用。
- 父 run 的命令确认、拒绝、取消与 continuation 处理确认边界。
- Pi Session 保存模型实际消费的 AgentTool 调用与结果，Ordinary 只保存稳定 Session refs 和工具事实。

不创建第二套 model runtime、ToolCenter、registry、confirmation gate、repository 或 read-model。工具调用已经产生确定结果后，确认恢复不得重放该调用。

## 与 Multi-Agent 的关系

Sub-Agent 与 Deep child 不是同一业务对象：

- Sub-Agent 是 Ordinary 模型自主调用的 AgentTool，结果是父模型使用的局部材料。
- Deep child 是 `MultiAgentFeature` 的编排事实，由 manager、TaskBoard 和 scheduler 管理，并进入 run tree 与 parent synthesis。
- 两者可以共享模型、工具、确认和上下文机械能力，但不能共享状态、事件、仓储、continuation 或 read-model。
- 两者之间不做自动升级、状态转换或兼容映射。

## 后果

收益：

- 删除与 Pi AgentHarness 重复的自研执行循环和观察链。
- Sub-Agent 权限、工具调用与确认自然复用 Ordinary 的正式主链。
- 父模型直接获得完整结果，不需要输出引用或专用续读协议。
- Sub-Agent 保持轻量，不演变成第二套 Multi-Agent。

代价：

- 不再提供批量 Sub-Agent 协议；父模型需要时自行发起多个 AgentTool 调用。
- 不再提供 Sub-Agent 专用 trace、独立 UI 详情或跨进程生命周期恢复。
- Agent Session adapter 的行为测试必须覆盖 AgentTool 权限、确认、取消和结果回传。

## 验收约束

- 正式目录只暴露 `call_sub_agent` 与 `spawn_sub_agent`。
- capability catalog 只保存两个工具的定义；曝光必须经过冻结 run 的普通工具边界，ToolRegistry 不注册假 executor。
- nested Agent 只能使用父 run 已授权且当前可执行的工具。
- Sub-Agent 工具不会出现在 nested Agent 工具集合中。
- 内部工具确认进入父 Ordinary continuation，恢复时不重复执行已完成工具。
- 完整 AgentTool 结果返回父模型，不依赖专用续读、trace 或 UI 投影。
- AgentTool 只形成 Ordinary 标准 tool facts，不发布专用 Sub-Agent 事件。
- Pi provider/model binding 通过同一 Ordinary `AgentLoop` 契约使用该能力。
- Sub-Agent 不读取或写入 Deep store、TaskBoard、run tree 或 read-model。

## 非目标

- 多层递归 Sub-Agent。
- 批量调度协议、team mailbox 或独立任务生命周期。
- 独立 Sub-Agent conversation、run、SSE、trace、持久化或详情面板。
- 用 Sub-Agent 替代 Multi-Agent manager/child/synthesis。
- 为已删除工具、runner 或开发期旧数据保留兼容分支。

## 相关文档

- [CURRENT_RUNTIME_MODE](../../../CURRENT_RUNTIME_MODE.md)
- [子 Agent 工具能力开发书](../../开发指南/06-工程实现/09-普通Agent主干开发指南/11-子Agent工具能力开发书.md)
- [ADR-0024-桌面基础Agent与基础设施优先路线](ADR-0024-桌面基础Agent与基础设施优先路线.md)
- [ADR-0025-deep一期Manager自由决策循环与一层child最小闭环](ADR-0025-deep一期Manager自由决策循环与一层child最小闭环.md)
- [ADR-0028-AgentArbor统一Workbench与功能模块化单体架构](ADR-0028-AgentArbor统一Workbench与功能模块化单体架构.md)
