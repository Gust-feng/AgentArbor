# 地下根须 AI 全覆盖与提示词增强

## Goal

把地下 AI 接入从“只有 option rootlet 可以请求一个简单 summary”推进到“所有 rootlet kind 都具备 AI 候选建议能力”。每个 rootlet 通过 kind 专属 prompt 和 output contract 生成候选数组；AI 失败或未启用时保留确定性 fallback；所有模型输出仍只能作为候选材料进入 CandidatePool，由 Convergence Judge、Handoff Steward 和 Direction Handoff Package validation 确定性守门。

## What I Already Know

- 当前地下 agent 集群、消息驱动、动态 rootlet、CandidatePool、Convergence Judge、Evidence Ledger 和 Direction Handoff Package 已跑通。
- `IntelligenceChannel`、fake provider、OpenAI-compatible provider、地下-only `--ai fake` / `--ai openai-compatible` 入口已存在。
- 当前 `RootletAgent` 只有 `option` kind 在 `ctx.intelligenceChannel` 存在时走 AI；其他 kind 总是 deterministic。
- 当前 `UNDERGROUND_ROOTLET_CANDIDATE_ADVICE_CONTRACT` 只要求顶层 `summary`，不能表达多候选和不同 rootlet kind 的结构差异。

## Requirements

- 为 6 种 `RootletClusterKind` 定义专属 output contract：
  - `option`：候选数组项包含 `summary`、`tradeoffs`、`applicability`。
  - `risk`：候选数组项包含 `summary`、`impactScope`、`severity`、`mitigation`。
  - `asset_fit`：候选数组项包含 `summary`、`assetRefs`、`fitConditions`、`doNotApplyWhen`。
  - `evidence`：候选数组项包含 `summary`、`evidenceType`、`confidence`。
  - `constraint`：候选数组项包含 `summary`、`constraintLevel`、`enforcementGate`。
  - `counterfactual`：候选数组项包含 `summary`、`alternativeDirection`、`whyNotChosen`。
- 输出契约必须支持“一个 rootlet invocation 一次模型调用，返回多个候选”。模型返回应采用顶层 `candidates` 数组，再由 app 层解析和预算截断。
- 新增 focused 模块：
  - `src/app/underground/intelligence-contracts.ts`：kind 专属 output contract 和候选字段定义。
  - `src/app/underground/intelligence-prompts.ts`：kind 专属 system prompt 和 user prompt 构造。
  - `src/app/underground/intelligence-output.ts`：模型输出解析、候选归一化、预算截断和非法项丢弃。
  - 保持 `src/app/underground-intelligence.ts` 作为调用通道并转换为 `RootletOutput` 的边界。
- prompt 必须包含足够上下文：
  - 用户原始目标。
  - `GoalIntentProfile` 的 goal statement、key concepts、nonGoals、acceptance criteria、assumptions、unknowns。
  - constraints 摘要和 ConstraintRef，不内联 Soil asset 正文。
  - rootlet kind、cluster budget、退出条件和“AI 只提供候选、不做最终裁决”的约束。
- `RootletAgent` 支持所有 kind 调用 AI：
  - `ctx.intelligenceChannel` 不存在时保持确定性路径。
  - `ctx.intelligenceChannel` 存在时尝试 kind 专属 AI 候选建议。
  - AI 成功但候选为空、AI 失败或 output validation failed 时不中断流程，回退到确定性输出。
  - fallback 必须可观测：保留 `model.failed` 或 failed validation 事件，并让输出 source/evidence refs 能体现 deterministic fallback。
- 保持架构边界：
  - 不改变消息驱动架构。
  - 不改变 SharedContext 写入所有权。
  - 不改变 Convergence Judge 裁决逻辑和 Direction Handoff 打包主线。
  - 不改变公开地下 7 步 EventLog 或 full demo 主链路。
  - 不删除确定性 fallback。
- demo summary 增强 AI 差异展示：
  - 按 rootlet kind 展示 model call 状态。
  - 展示 AI candidate count、fallback count 或 `aiFallbackUsed`。
  - 不包含 API key、token、完整 prompt 或 provider 原始敏感错误。

## Acceptance Criteria

- [ ] `pnpm build` 通过。
- [ ] `pnpm test` 通过。
- [ ] 6 种 rootlet kind 都有独立 output contract 测试。
- [ ] 每种 kind 的 prompt 构造测试证明包含 goalIntentProfile、constraints、cluster budget 和 kind 专属指令。
- [ ] `--ai fake` 在复杂目标触发多种 rootlet kind 时，每种 kind 都能发布 `model.requested -> model.completed` 或清晰 failed event。
- [ ] AI 成功时产出的 `RootletOutput` 带 model call source/evidence refs，并进入 CandidatePool。
- [ ] AI 失败或 output validation failed 时流程不中断，回退到 deterministic output，且 fallback 可从 summary / refs 观测。
- [ ] 未启用 AI 时仍走确定性路径，无 `model.*` 事件。
- [ ] 模型输出不能绕过 CandidatePool、Convergence Judge 或 Direction Handoff Package validation。
- [ ] 默认 demo 和地下-only demo 不写 repo-root `.agentarbor/`。

## Definition of Done

- 模块拆分清晰，`RootletAgent` 只保留调度和完成 invocation 职责。
- AI prompt、contract、output parsing、RootletOutput 转换各有 focused 测试。
- 保持 no external LLM SDK、secret-free EventLog/Snapshot/summary、默认无网络。
- 更新 `.trellis/spec/backend/intelligence-channel.md`、`underground-radial-growth.md`、必要 observation / quality spec 和 `docs/任务看板/看板.md`。

## Technical Approach

- 扩展 `ModelOutputContract` 的现有验证能力时要谨慎：若需要数组字段校验，优先在 app 层解析器中做，不让领域模型立刻承担完整 JSON schema。
- `requestUndergroundRootletCandidateAdvice` 改为接收 `goalIntentProfile`，根据 `cluster.kind` 选择 contract / prompt / parser。
- 每次 rootlet invocation 最多一次模型调用；返回多个候选后按 `cluster.budget.maxCandidateOutputs` 截断。
- `RootletAgent` 的 async guard 从 `option + channel` 调整为 `channel exists` 或 focused AI policy。
- 对 fake provider 可用确定性输出，但测试必须覆盖所有 kind 的结构化候选形状。

## Decision (ADR-lite)

**Context**：地下 AI 通道已接入，但只覆盖 option rootlet，且 prompt/contract 太薄，无法体现 agent 集群的专业分工。

**Decision**：所有 rootlet kind 都接入 AI 候选建议；每个 kind 使用专属 prompt 与候选数组 contract；失败时可观测回退到 deterministic fallback。

**Consequences**：系统开始真正利用 AI 丰富地下候选，但确定性收束和方向包校验仍保持最终事实边界。后续可以继续优化 prompt 质量、真实 provider 评估和候选评分，而不用重改架构。

## Out of Scope

- 不实现新的 provider protocol。
- 不引入外部 LLM SDK。
- 不做真实 UI、HTTP、SSE、WebSocket、数据库、MCP、A2A、AG-UI。
- 不改变 Convergence Judge 裁决算法。
- 不把模型输出沉淀为 Soil、RunMemory、Capability Asset、Path Bias 或长期资产。

## Technical Notes

- 相关规范：
  - `.trellis/spec/backend/intelligence-channel.md`
  - `.trellis/spec/backend/underground-radial-growth.md`
  - `.trellis/spec/backend/observation-read-model.md`
  - `.trellis/spec/backend/directory-structure.md`
  - `.trellis/spec/backend/quality-guidelines.md`
