# 智能通道运行时规范

本规范记录后续真实模型接入的可执行边界。当前任务只补文档；实现阶段必须先实现智能通道，再接具体 provider adapter。

## Scope / Trigger

- Trigger：新增或修改 `src/domain/intelligence/**`、`src/kernel/intelligence/**`、`src/adapters/intelligence/**`、模型调用 demo、模型调用事件或模型供应商配置。
- Scope：统一模型调用入口、provider adapter 隔离、模型调用事件、输出契约校验、密钥与隐私边界。
- Out of Scope：UI、HTTP、SSE、WebSocket、数据库、MCP、A2A、AG-UI、repo-root `.agentarbor/` 资产出生策略。

## Signatures

- `ModelRequest`：内部模型调用请求，必须包含 `requestId`、`traceId`、`callerRef`、`purpose`、`inputRefs`、`sanitizedMessages`、`outputContract`、`constraintRefs`、`budget`、`sensitivity`、`requestedAt`。
- `ModelResponse`：归一化模型响应，必须包含 `responseId`、`requestId`、`providerId`、`model`、`status`、`outputKind`、`validation`、`completedAt`。
- `ModelUsage`：归一化 token、成本和延迟字段；provider 未返回时保持空值，不伪造。
- `ModelCallRef`：正式材料引用模型调用的唯一方式。
- `ModelProvider.complete(request)`：provider adapter 最小接口。
- `IntelligenceChannel.request(request)`：业务层唯一模型调用入口。

## Contracts

- `src/domain/intelligence/` 保存模型调用领域契约、purpose taxonomy、输出类型和 `ModelCallRef`。它不能依赖 provider SDK。
- `src/kernel/intelligence/` 保存智能通道实现、请求校验、输出校验、事件发布、降级策略和 provider registry。
- `src/adapters/intelligence/` 保存 OpenAI-compatible、Anthropic、Gemini、Qwen、Ollama/vLLM 或其他 provider adapter。只有这一层可以直接依赖 provider SDK 或读取 provider 凭证。
- `src/app/**` 的运行流程只能通过注入的 `IntelligenceChannel` 使用模型能力；应用组合根可以装配智能通道和 provider adapter，但不能直接调用 provider SDK 或读取 provider-specific response 字段。
- `src/domain/underground/**`、`src/domain/aboveground/**`、`src/domain/governance/**` 和 `src/kernel/**` 不得直接导入 provider adapter。

## 生效规则

- 任何直接在领域层、kernel 业务边界、app demo 运行流程或测试 fixture 中调用 provider SDK 的实现都违规。
- 模型输出默认是不可信候选；不能直接写入 Direction Handoff、Growth Plan、Verification Result、Run Memory、Experience Candidate、Capability Asset 或 Soil。
- `model.requested`、`model.completed`、`model.failed` 事件必须由智能通道统一发布；调用方不得手写伪造模型调用事件。
- EventLog 和 Observation Snapshot 只能记录清洗后的请求摘要、引用、usage、状态和错误引用。
- API key、token、完整敏感 prompt、未授权 Soil 内容和 provider 原始敏感错误不得进入 EventLog、Snapshot、方向交接包或测试快照。
- Provider 输出不符合 `outputContract` 时必须形成 validation failed，不得被调用方当作成功响应继续收束。
- hard constraint、Direction Handoff Package validation、状态机守卫和 Governance gate 不得因为模型建议而被跳过。

## Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| provider SDK 被 `domain/`、`kernel/` 或 app 运行流程直接导入 | 测试或静态导入检查失败 |
| 请求缺少 purpose / output contract / budget | `IntelligenceChannel` 拒绝请求并发布失败状态 |
| provider 超时或鉴权失败 | 返回 failed response，发布 `model.failed` |
| provider 输出不符合结构契约 | 返回 validation failed，不进入候选池提升 |
| 模型建议违反 hard constraint | 保留为 rejected candidate 或失败说明，不得放行 |
| EventLog 出现 API key 或 token 字段 | 安全边界失败 |

## Good / Base / Bad Cases

- Good：Underground Intent Core 请求智能通道生成目标画像建议，再由确定性规则转成 `GoalIntentProfile`。
- Good：rootlet 请求候选方向，输出先进入 candidate pool，再由 Convergence Judge 裁决。
- Good：provider adapter 只负责请求/响应映射、鉴权、usage 归一化和错误映射。
- Base：没有 provider 配置时使用 deterministic fallback 或明确 failed/stopped，不伪造模型成功。
- Bad：在 `src/domain/underground/intent-core.ts` 中直接导入 OpenAI SDK。
- Bad：把模型 JSON 直接保存为 approved Direction Handoff。
- Bad：为了演示成功把 provider 错误吞掉并返回空 approved candidate。

## Tests Required

- `IntelligenceChannel` 请求校验：缺少 purpose、output contract、budget 时失败。
- provider adapter 失败映射：鉴权失败、超时、rate limit、输出不合约。
- 事件顺序：`model.requested -> model.completed` 或 `model.requested -> model.failed`。
- 导入边界：`domain/**`、`kernel/**`、app 运行流程不直接导入 provider SDK；组合根只允许装配 adapter factory。
- 密钥边界：EventLog、Snapshot 和测试快照不包含 API key / token。
- Underground 接入：模型输出只能进入候选池，不能绕过收束直接进入 package。

## Wrong vs Correct

### Wrong

Intent Core 直接调用 OpenAI SDK，拿到 JSON 后写入 approved Direction Handoff。

### Correct

Intent Core 构造 `ModelRequest`，通过注入的 `IntelligenceChannel` 获取 `ModelResponse`；响应被校验后作为候选输入进入 Underground candidate pool，再由 Convergence Judge 和 Handoff Steward 形成正式方向包。
