# 实现智能通道最小运行内核

## Goal

把真实 AI 接入从“直接调用模型”收敛为 AgentArbor 内部的智能通道。第一轮只实现最小运行内核和一个 provider adapter 边界，让 Underground Center 后续可以通过通道获取目标理解与 rootlet 候选建议，同时保持收束、方向包校验、状态机和治理边界仍由确定性系统掌握。

## Requirements

- 新增智能通道领域契约：
  - `ModelRequest`
  - `ModelResponse`
  - `ModelUsage`
  - `ModelCallRef`
  - `ModelProvider`
  - `IntelligenceChannel`
  - `ModelOutputContract`
  - `ModelOutputValidationResult`
- 新增运行内核：
  - 请求校验：purpose、budget、output contract、trace、caller ref 必须存在。
  - 输出校验：provider 返回必须符合 output contract；失败不能伪造成成功。
  - 事件发布：`model.requested -> model.completed` 或 `model.requested -> model.failed`。
  - 敏感信息边界：EventLog / Snapshot / 测试快照不得包含 API key、token、完整敏感 prompt 或 provider 原始敏感错误。
- 新增 provider adapter 边界：
  - 先实现一个 deterministic fake provider，保证测试和 demo 不依赖真实网络。
  - 预留 OpenAI-compatible provider adapter 入口，但真实 SDK / fetch 调用需在用户确认后进入。
  - provider adapter 只能位于 `src/adapters/intelligence/`。
- 首个业务接入只做最薄路径：
  - Underground Intent Core 或 rootlet 候选生成可以通过注入的 `IntelligenceChannel` 获取建议。
  - 模型输出只能进入 candidate/draft/advice 层。
  - Convergence Judge、Handoff Steward 和 Direction Handoff Package validation 不被模型绕过。
- Demo 策略：
  - 默认 `pnpm demo:underground` 仍走 deterministic 路径。
  - 可以新增显式 AI/fake-AI demo 参数或单独 demo，用于展示 model events 和 candidate 输入。
  - 不传 provider 配置时不得调用真实网络。

## Acceptance Criteria

- [ ] `pnpm build` passes.
- [ ] `pnpm test` passes.
- [ ] `IntelligenceChannel` 请求缺少 purpose / output contract / budget 时失败。
- [ ] fake provider completed 路径发布 `model.requested -> model.completed`。
- [ ] fake provider failed 路径发布 `model.requested -> model.failed`。
- [ ] 输出不符合契约时 validation failed，不能进入已收束方向包。
- [ ] `domain/**`、`kernel/**` 和 app 运行流程不直接导入 provider SDK。
- [ ] EventLog / Snapshot / 测试快照不包含 API key / token。
- [ ] 地下接入测试证明模型输出只进入候选池，不能绕过 Convergence Judge 直接进入 package。
- [ ] 默认 demo 不接真实 LLM、不写 repo-root `.agentarbor/`。

## Definition of Done

- 智能通道类型、内核、fake provider、事件和测试模块化落地。
- 后续真实 OpenAI-compatible adapter 可以在不改领域模型的情况下接入。
- 没有把模型输出写成事实源，没有削弱 existing package validation / hard constraint / EventLog 边界。
- 看板更新到当前任务状态。

## Out of Scope

- 不实现 UI、HTTP、SSE、WebSocket、数据库、MCP、A2A、AG-UI。
- 不默认调用真实 OpenAI 或其他 provider。
- 不把 provider 配置写进代码常量。
- 不实现完整 Aboveground / Verification / Governance 模型调用。
- 不创建 repo-root `.agentarbor/` 运行资产。

## Technical Approach

- 先落 `src/domain/intelligence/` 纯类型与 focused exports。
- 再落 `src/kernel/intelligence/`：request validator、response validator、channel implementation、model event factory。
- 再落 `src/adapters/intelligence/` deterministic fake provider 和 OpenAI-compatible adapter 形状。
- 最后以应用层注入方式接入地下目标理解或 rootlet 候选生成，不让领域层直接导入 adapter。

## Notes

- 当前目标不是“让模型回答更聪明”，而是让模型能力有正确入口、正确失败形态和正确观测链路。
- 真实模型 provider 的网络调用可以作为下一小步进入，但必须建立在本任务的通道内核之上。
