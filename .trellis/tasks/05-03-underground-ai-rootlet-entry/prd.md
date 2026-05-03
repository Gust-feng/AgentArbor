# 地下 AI 根须运行入口

## Goal

在已有 `IntelligenceChannel`、fake provider、OpenAI-compatible Chat Completions adapter 和地下 rootlet 候选接入的基础上，补齐一个可显式验收的地下-only AI 运行入口。默认 `pnpm demo:underground` 继续保持确定性、零网络；只有调用方显式传入 AI 参数时，地下 rootlet 才通过智能通道请求候选建议，并且模型输出只能进入候选池，不能绕过 Convergence Judge、Handoff Steward 或 Direction Handoff Package validation。

## What I Already Know

- `20ea2f5 feat: 实现智能通道原生协议内核` 已落地 `domain/intelligence`、`kernel/intelligence`、`adapters/intelligence`、fake provider、OpenAI-compatible provider 和模型事件。
- 地下运行入口已有 `runUndergroundDirectionSessionWithIntelligence(goal, { createIntelligenceChannel })`。
- 当前 `pnpm demo:underground` 只支持 deterministic、`--auto-answer` 和 `--out`，尚不能显式启用 fake / OpenAI-compatible provider。
- 现有规范要求：不引入外部 LLM SDK；默认 demo 不触发真实网络；API key / token 不得进入 EventLog / Snapshot / package / 测试快照。

## Requirements

- 扩展地下-only demo CLI：
  - 默认无 AI，行为保持不变。
  - `--ai fake`：使用 deterministic fake provider，触发 `model.requested -> model.completed`，并展示模型事件与候选层接入结果。
  - `--ai openai-compatible`：显式使用 OpenAI-compatible Chat Completions provider；必须从环境变量读取配置，不得硬编码密钥。
  - 未传 `--ai` 时不得创建 provider、不得触发真实网络、不得发布 model events。
- OpenAI-compatible CLI 配置：
  - `AGENTARBOR_MODEL_BASE_URL`：可选，默认由 provider 自身处理或使用 adapter 默认。
  - `AGENTARBOR_MODEL_API_KEY` 或 `OPENAI_API_KEY`：必需，缺失时返回明确配置错误，不得尝试网络调用。
  - `AGENTARBOR_MODEL_NAME`：必需或有安全默认；若采用默认，必须在 summary 中展示模型名但不展示密钥。
- 新增 app 层组合根 helper：
  - 负责从 CLI/env 创建 `IntelligenceChannel`。
  - provider adapter 只在组合根或 adapter 测试中导入；domain/kernel/地下业务模块不得直接导入 provider adapter。
- demo summary 增加 AI 观测摘要：
  - 是否启用 AI。
  - provider / protocol / model。
  - model event counts。
  - completed / failed 状态。
  - 与候选池相关的 model call refs。
  - 不包含 API key、token、完整 prompt 或 provider 原始敏感错误。
- 保持边界：
  - 模型输出只能通过 rootlet invocation 包装为 `RootletOutput` 后进入 CandidatePool。
  - failed / contract-violating 模型输出不能进入 approved Direction Handoff。
  - 默认 demo、测试和没有显式 provider 的运行不得访问真实网络。

## Acceptance Criteria

- [ ] `pnpm build` 通过。
- [ ] `pnpm test` 通过。
- [ ] `pnpm demo:underground` 默认不发布 `model.*` 事件。
- [ ] `pnpm demo:underground -- --ai fake "<goal>"` 发布 `model.requested -> model.completed`，且地下 EventLog 仍停在 handoff boundary。
- [ ] fake AI 输出只进入 candidate/rootlet 层，不能直接进入 Direction Handoff source candidates。
- [ ] `--ai openai-compatible` 在缺少 API key 时给出明确配置失败，不访问网络，不泄漏密钥。
- [ ] OpenAI-compatible provider 的真实网络路径只在显式 `--ai openai-compatible` 且配置完整时可能触发。
- [ ] EventLog、Observation Snapshot、demo summary 和测试快照不包含 API key / token。
- [ ] repo-root `.agentarbor/` 不新增或修改运行资产。

## Definition of Done

- 地下-only demo 有明确 AI 开关和安全失败形态。
- AI 配置、provider 装配、summary 投影分层清楚，不把 adapter 逻辑塞进地下领域或 runner。
- 测试覆盖默认无 AI、fake AI、openai-compatible 配置失败、密钥不泄漏和候选边界。
- 更新 `.trellis/spec/backend/intelligence-channel.md`、必要的 observation / underground spec 和 `docs/任务看板/看板.md`。

## Technical Approach

- 在 app 层新增或扩展 demo 参数解析，保留 `--auto-answer` 与 `--out`。
- 新增 focused factory，例如 `src/app/intelligence-channel-factory.ts`，只服务 CLI / composition root。
- `--ai fake` 使用 `FakeModelProvider + NativeIntelligenceChannel`。
- `--ai openai-compatible` 使用 `OpenAICompatibleChatCompletionsProvider + NativeIntelligenceChannel`，只从环境变量读取配置。
- 扩展 `createUndergroundDemoSummary` 或增加辅助投影，把 `model.*` EventLog 派生为 JSON-safe AI summary。

## Decision (ADR-lite)

**Context**：智能通道内核已存在，但用户无法从 CLI 明确验证地下 rootlet 经智能通道接入 AI 的运行路径。

**Decision**：先补地下-only 显式 AI 入口，默认无 AI；fake provider 用于稳定验收，OpenAI-compatible provider 仅在显式配置时启用。

**Consequences**：本轮不追求模型效果质量，但能验证 provider 装配、模型事件、候选边界和密钥边界，为后续真实 AI rootlet 优化提供可运行基础。

## Out of Scope

- 不实现 UI、HTTP、SSE、WebSocket、数据库、MCP、A2A、AG-UI。
- 不引入任何外部 LLM SDK。
- 不实现 OpenAI Responses、Anthropic Messages、Gemini generateContent 网络调用。
- 不把模型输出提升为 Direction Handoff、RunMemory、Capability Asset、Path Bias 或 Soil。
- 不改变地下公开 7 步 EventLog 或 full demo 18 步主链路。

## Technical Notes

- 相关规范：
  - `.trellis/spec/backend/intelligence-channel.md`
  - `.trellis/spec/backend/underground-radial-growth.md`
  - `.trellis/spec/backend/observation-read-model.md`
  - `.trellis/spec/backend/directory-structure.md`
  - `.trellis/spec/backend/quality-guidelines.md`
