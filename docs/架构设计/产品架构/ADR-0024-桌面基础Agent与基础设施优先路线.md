# ADR-0024: 桌面基础 Agent 与基础设施优先路线

日期：2026-05-11

状态：Accepted

承接关系：Refines [ADR-0022-AgentArbor桌面通用Agent与双运行时架构](ADR-0022-AgentArbor桌面通用Agent与双运行时架构.md) 与 [ADR-0023-LocalRuntimeLiteProfile与未来FullProfile演进边界](ADR-0023-LocalRuntimeLiteProfile与未来FullProfile演进边界.md)。ADR-0022 保留长期产品愿景；本 ADR 定义当前活跃实现路线。

## 决策

当前实现默认收敛为 **Desktop Basic Agent Runtime + 基础设施优先**。

用户默认面对的是一个桌面基础 Agent：接收消息、理解上下文、直接回答或调用授权工具、在写入/执行/外部提交前请求确认、持续展示安全进度、持久化会话和运行记录，并在完成后给出可用结果。

Underground Cognitive Runtime、Aboveground Execution Runtime、Agent Fabric、Plan Package、Governance Pipeline 和 Global Soil 仍是长期架构，但当前默认桌面会话不以“地下/地上组织”作为用户文案或首屏概念。deep / advanced 是未来项目边界：当前不新增可见 deep 入口，不主动改动 deep 后端路径，也不能污染普通桌面 Agent 会话、确认卡、面板首屏或基础 API。

## 当前活跃主线

```text
Desktop Shell
  -> Basic Agent Run
  -> AgentTurnRuntime
  -> ToolCenter / Confirmation Gate / Skill Context
  -> Safe Run Events
  -> RuntimeDatabase
  -> Workbench Panel
```

当前工程目标是把这条主线做稳，而不是提前扩张地下组织、地上组织、Routines、完整 MCP 管理器、多 agent 团队模式或治理回流。

## 普通优先边界

桌面端当前只打磨默认普通 Agent。历史实现中已经存在的 deep / advanced / compatibility 路径作为未来能力边界保留，但本路线不要求展示入口、不扩展后端编排，也不把复杂输入自动升级到 deep。

- 普通模式（`agent`）：默认入口。它是单 Agent 的 conversational / tool-assisted turn，复用 Task Soil、Skill Context、AgentTurnRuntime、ToolCenter、Confirmation Gate、RunEvent、RuntimeDatabase 和 Workbench Panel；它不自动升级到 Underground、不派生 child agent、不暴露地下内部工具。
- 未来深入模式（`deep`）：只能在用户重新明确启动 deep 项目后，按 ADR-0022 / ADR-0021 / Underground radial growth spec 演进目标成形、rootlet 探索、候选池、收束、Plan / Handoff 等复杂组织；这些策略只能在 deep adapter 内部出现。

因此，普通模式和未来深入模式共享执行平台，不共享思考/编排策略。任何未来 deep 能力都必须先证明不会改变普通模式的工具可见性、事件投影、确认语义和首屏文案。

## 基础设施边界

当前阶段必须优先稳定这些能力：

- `AgentTurnRuntime`：模型到工具再到模型的基础循环，支持工具轮预算、最终轮综合、abort/cancel、工具失败后的整体综合和安全失败归一化。
- `ToolCenter`：工具定义必须包含用途、参数说明、风险等级、operation type、确认策略和用户可见结果策略。
- `Confirmation Gate`：Windows 上写入、执行和外部提交类操作默认需要确认；确认请求持久化到 RuntimeDatabase，前端断开后仍可恢复。
- `RunEvent`：普通事件只保存安全投影，包括 id、runId、sequence、type、title、summary、status、timestamp、refs 和 visibility；raw prompt、raw provider response、raw tool output、stdout/stderr、文件正文、secret、token 和未经验证模型输出不能进入普通 HTTP/SSE/面板/会话投影。
- `RuntimeDatabase`：保存会话、运行、事件、模型调用、工具调用、产物和确认请求的安全 read-model，不保存完整 prompt、provider 原始响应或工具原文。
- `SkillDefinition`：先支持 `SKILL.md` 元数据发现、启用状态、触发说明和按需正文注入；资源文件不默认进入上下文。
- `Workbench Panel`：默认信息架构是左侧新任务、最近会话、待确认提醒和设置，中间基础 Agent 会话和任务运行，详情或抽屉按需显示文件、证据、产物、待确认和安全诊断。Skills / Tools 不作为主导航入口，也不做成能力后台；工作方法和工具选择由普通 Agent 在运行时按任务判断。设置页可以承接已有真实后端支撑的模型服务、工作目录、网页查证、运行时工具启用状态、工作方法启用状态和确认边界说明，但这些配置只表达可用服务和安全边界，不能替代模型的任务理解、工具选择或工作方法取舍。Routines 必须等真实调度器出生后再作为可见功能。

## 默认不做

本路线不在当前阶段实现：

- 完整 MCP 管理器。
- 自动化调度器与 Routines UI。
- 子 agent 团队模式。
- 可见 deep 入口和 deep 后端扩展。
- 完整 Aboveground 执行组织。
- Governance 回流。
- `.agentarbor/` Plan Package 的占位资产。

这些能力只保留契约边界，必须等真实需求、读写规则、验证方式和用户授权稳定后再出生。

## 后果

- 活跃开发指南和面板普通文案必须以基础桌面 Agent 为默认路线。
- ADR-0022 的地下/地上语义继续作为长期架构事实源，但当前实现默认不展示内部组织术语。
- 基础设施契约优先于宏大概念扩张；任何新功能必须先落到安全投影、确认、事件、持久化和测试边界。
- 未来 deep mode 若重启，可以复用同一套 AgentTurnRuntime、ToolCenter、RunEvent、RuntimeDatabase 和 Confirmation Gate，不能另起一套平行运行时。

## 相关文档

- [开发指南总览](../../开发指南/00-总览.md)
- [工程实现](../../开发指南/06-工程实现/README.md)
- [技术主线](../../开发指南/06-工程实现/01-技术主线.md)
- [ADR-0022-AgentArbor桌面通用Agent与双运行时架构](ADR-0022-AgentArbor桌面通用Agent与双运行时架构.md)
- [ADR-0023-LocalRuntimeLiteProfile与未来FullProfile演进边界](ADR-0023-LocalRuntimeLiteProfile与未来FullProfile演进边界.md)
