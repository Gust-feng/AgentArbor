# ADR-0024: 桌面基础 Agent 与基础设施优先路线

日期：2026-05-11

状态：Accepted

承接关系：Refines [ADR-0022-AgentArbor桌面通用Agent与双运行时架构](ADR-0022-AgentArbor桌面通用Agent与双运行时架构.md) 与 [ADR-0023-LocalRuntimeLiteProfile与未来FullProfile演进边界](ADR-0023-LocalRuntimeLiteProfile与未来FullProfile演进边界.md)。ADR-0022 保留长期产品愿景；本 ADR 定义当前活跃实现路线。

## 决策

当前实现默认收敛为 **Desktop Basic Agent Runtime + 基础设施优先**。

用户默认面对的是一个桌面基础 Agent：接收任务、理解上下文、直接回答或调用授权工具、在写入/执行/外部提交前请求确认、持续展示安全进度、持久化会话和运行记录，并在完成后给出可用结果。

Underground Cognitive Runtime、Aboveground Execution Runtime、Agent Fabric、Plan Package、Governance Pipeline 和 Global Soil 仍是长期架构，但当前默认桌面会话不以“地下/地上组织”作为用户文案或首屏概念。相关能力只能作为 deep / advanced / compatibility 路径显式启用，不能污染普通桌面 Agent 会话、任务卡、面板首屏或基础 API。

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

## 基础设施边界

当前阶段必须优先稳定这些能力：

- `AgentTurnRuntime`：模型到工具再到模型的基础循环，支持工具轮预算、最终轮综合、abort/cancel、工具失败后的整体综合和安全失败归一化。
- `ToolCenter`：工具定义必须包含用途、参数说明、风险等级、operation type、确认策略和用户可见结果策略。
- `Confirmation Gate`：Windows 上写入、执行和外部提交类操作默认需要确认；确认请求持久化到 RuntimeDatabase，前端断开后仍可恢复。
- `RunEvent`：普通事件只保存安全投影，包括 id、runId、sequence、type、title、summary、status、timestamp、refs 和 visibility；raw prompt、raw provider response、raw tool output、stdout/stderr、文件正文、secret、token 和未经验证模型输出不能进入普通 HTTP/SSE/面板/会话投影。
- `RuntimeDatabase`：保存会话、运行、事件、模型调用、工具调用、产物和确认请求的安全 read-model，不保存完整 prompt、provider 原始响应或工具原文。
- `SkillDefinition`：先支持 `SKILL.md` 元数据发现、启用状态、触发说明和按需正文注入；资源文件不默认进入上下文。
- `Workbench Panel`：默认信息架构是左侧新会话/最近任务/Skills/Tools/Settings，中间基础 Agent 会话和任务运行，右侧或抽屉显示文件、证据、产物、待确认和安全诊断。Routines 必须等真实调度器出生后再作为可见功能。

## 默认不做

本路线不在当前阶段实现：

- 完整 MCP 管理器。
- 自动化调度器与 Routines UI。
- 子 agent 团队模式。
- 完整 Aboveground 执行组织。
- Governance 回流。
- `.agentarbor/` Plan Package 的占位资产。

这些能力只保留契约边界，必须等真实需求、读写规则、验证方式和用户授权稳定后再出生。

## 后果

- 活跃开发指南和面板普通文案必须以基础桌面 Agent 为默认路线。
- ADR-0022 的地下/地上语义继续作为长期架构事实源，但当前实现默认不展示内部组织术语。
- 基础设施契约优先于宏大概念扩张；任何新功能必须先落到安全投影、确认、事件、持久化和测试边界。
- 未来 deep mode 可以复用同一套 AgentTurnRuntime、ToolCenter、RunEvent、RuntimeDatabase 和 Confirmation Gate，不能另起一套平行运行时。

## 相关文档

- [开发指南总览](../../开发指南/00-总览.md)
- [工程实现](../../开发指南/06-工程实现/README.md)
- [技术主线](../../开发指南/06-工程实现/01-技术主线.md)
- [ADR-0022-AgentArbor桌面通用Agent与双运行时架构](ADR-0022-AgentArbor桌面通用Agent与双运行时架构.md)
- [ADR-0023-LocalRuntimeLiteProfile与未来FullProfile演进边界](ADR-0023-LocalRuntimeLiteProfile与未来FullProfile演进边界.md)
