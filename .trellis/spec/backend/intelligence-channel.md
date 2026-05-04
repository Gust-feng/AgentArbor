# 智能通道运行时规范

本规范记录后续真实模型接入的可执行边界。实现阶段必须先实现 AgentArbor 原生智能通道，再接具体 provider protocol adapter。

当前运行时不引入 Vercel AI SDK、OpenAI SDK、LangChain、Anthropic SDK、Gemini SDK 或其他外部 LLM SDK。真实 provider 接入以自研 `IntelligenceChannel` 为内核，通过 Node global `fetch` 直接兼容主流 HTTP 协议。首个真实协议实现是 `openai_compatible_chat_completions`；`openai_responses`、`anthropic_messages`、`gemini_generate_content` 只保留枚举和边界，不在本轮实现网络协议。

## Scope / Trigger

- Trigger：新增或修改 `src/domain/intelligence/**`、`src/kernel/intelligence/**`、`src/adapters/intelligence/**`、模型调用 demo、模型调用事件或模型供应商配置。
- Scope：统一模型调用入口、provider adapter 隔离、模型调用事件、输出契约校验、配置中心、密钥与隐私边界。
- Out of Scope：UI、HTTP、SSE、WebSocket、数据库、MCP、A2A、AG-UI、repo-root `.agentarbor/` 资产出生策略。

## Signatures

- `ModelRequest`：内部模型调用请求，必须包含 `requestId`、`traceId`、`callerRef`、`purpose`、`inputRefs`、`sanitizedMessages`、`outputContract`、`constraintRefs`、`budget`、`sensitivity`、`requestedAt`。
- `ModelResponse`：归一化模型响应，必须包含 `responseId`、`requestId`、`providerId`、`model`、`status`、`outputKind`、`validation`、`completedAt`。
- `ModelUsage`：归一化 token、成本和延迟字段；provider 未返回时保持空值，不伪造。deterministic fake provider 也不得返回 fabricated zero token usage。
- `ModelCallRef`：正式材料引用模型调用的唯一方式。
- `ModelProvider.complete(request)`：provider adapter 最小接口。
- `IntelligenceChannel.request(request)`：业务层唯一模型调用入口。

## Contracts

- `src/domain/intelligence/` 保存模型调用领域契约、purpose taxonomy、输出类型、protocol / provider kind 和 `ModelCallRef`。它不能依赖 provider SDK、provider adapter 或 provider-specific response shape。
- `src/kernel/intelligence/` 保存智能通道实现、请求校验、输出校验、事件发布、降级策略和 provider registry。
- `src/adapters/intelligence/` 保存 OpenAI-compatible Chat Completions、后续 OpenAI Responses、Anthropic Messages、Gemini generateContent 或其他 provider protocol adapter。只有这一层可以读取 provider 凭证或执行 provider HTTP 协议映射；本阶段不得引入外部 LLM SDK。
- `src/app/**` 的运行流程只能通过注入的 `IntelligenceChannel` 使用模型能力；应用组合根可以装配智能通道和 provider adapter，但不能直接调用 provider SDK、读取 provider-specific response 字段或导入 adapter 实现参与业务流程。
- `src/app/intelligence-channel-factory.ts` 是当前 CLI / demo 组合根装配 provider adapter 的唯一 app 层例外；地下 session、runner、rootlet、summary 和其他业务编排只能接收 `IntelligenceChannel` 或清洗后的 AI 观测输入，不得直接导入 provider adapter。
- `src/app/config-center.ts` 负责把本地配置中心中的脱敏 settings 与 local-dev secret store 转成组合根可消费的 provider 环境；它不能把 raw secret 返回给 panel HTTP、summary、Snapshot 或 EventLog。
- `src/domain/config/` 保存 provider profile、默认 AI mode、secret ref 和脱敏视图；`src/adapters/config/` 只负责普通 settings 文件与 local-dev secret 文件读写。普通 settings store 不得保存 raw secret。
- 地下 rootlet AI 建议的 app 层契约拆分为 `src/app/underground/intelligence-contracts.ts`、`intelligence-prompts.ts` 和 `intelligence-output.ts`；6 种 rootlet kind 都必须使用 kind 专属 prompt 和 output contract，请求仍经 `IntelligenceChannel`，响应采用顶层 `candidates` 数组。数组项的 kind 专属字段由 app parser 校验、归一化、丢弃非法项并按 rootlet budget 截断；不要把完整数组 schema 推入当前 `ModelOutputContract` 内核。`ModelOutputContract.visibleOutput.fieldTypes` 只服务安全展示投影，必须与 app parser 的字段类型保持一致；parser 会丢弃的候选不得生成 approved visible output。
- `src/domain/underground/**`、`src/domain/aboveground/**`、`src/domain/governance/**` 和 `src/kernel/**` 不得直接导入 provider adapter。

## 生效规则

- 任何直接在领域层、kernel 业务边界、app demo 运行流程或测试 fixture 中调用 provider SDK、外部 LLM SDK 或 provider adapter 的实现都违规。
- 模型输出默认是不可信候选；不能直接写入 Direction Handoff、Growth Plan、Verification Result、Run Memory、Experience Candidate、Capability Asset 或 Soil。
- `model.requested`、`model.completed`、`model.failed` 事件必须由智能通道统一发布；调用方不得手写伪造模型调用事件。
- EventLog 和 Observation Snapshot 只能记录清洗后的请求摘要、引用、usage、状态和错误引用。
- Observation refs 必须按事件类型解析：`model.*` payload 中的 `requestId` / `responseId` 只能生成 `model_call` ref；`user_approval.*` 和 direction-handoff revision payload 中的 clarification ids 才能生成 `user_clarification` ref。
- API key、token、完整敏感 prompt、未授权 Soil 内容和 provider 原始敏感错误不得进入 EventLog、Snapshot、方向交接包或测试快照。
- Provider 输出不符合 `outputContract` 时必须形成 validation failed，不得被调用方当作成功响应继续收束。
- rootlet AI 调用成功但 app parser 得不到合法候选、provider 失败或输出契约 validation failed 时，rootlet invocation 必须不中断，回退 deterministic output；fallback 必须能从 `model.failed` / `model.completed` 事件、demo summary 和 deterministic output 的 `ai-fallback:*` source refs 观测。
- hard constraint、Direction Handoff Package validation、状态机守卫和 Governance gate 不得因为模型建议而被跳过。
- `pnpm demo:underground` 默认不得创建 provider、不得触发真实网络、不得发布 `model.*` 事件；只有显式 `--ai fake` 或 `--ai openai-compatible` 才能启用地下 rootlet 智能通道。
- `--ai openai-compatible` 必须先完成环境配置校验：`AGENTARBOR_MODEL_API_KEY` 或 `OPENAI_API_KEY` 必须存在，`AGENTARBOR_MODEL_NAME` 必须存在；缺失时必须返回配置失败并确认未尝试网络调用。`AGENTARBOR_MODEL_BASE_URL` 可选，配置和 summary 不得泄漏 API key / token。
- `pnpm panel` 的 OpenAI-compatible 配置来源是本地配置中心，不直接读取用户 shell 环境；panel 只返回 base URL、model、默认 AI mode、secret ref、`secretConfigured` 和由脱敏状态派生的 provider readiness，永不返回 secret value。

## Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 外部 LLM SDK 依赖进入 `package.json` | 测试或静态导入检查失败 |
| provider SDK 或 provider adapter 被 `domain/`、`kernel/` 或 app 运行流程直接导入 | 测试或静态导入检查失败 |
| 请求缺少 purpose / output contract / budget | `IntelligenceChannel` 拒绝请求并发布失败状态 |
| provider 超时或鉴权失败 | 返回 failed response，发布 `model.failed` |
| provider 输出不符合结构契约 | 返回 validation failed，不进入候选池提升 |
| `visibleOutput.fieldTypes` 与 rootlet parser 字段类型不一致，导致 parser 丢弃的候选仍可见 | 测试失败；visible output 必须被抑制或只展示 parser 可接受字段 |
| 模型建议违反 hard constraint | 保留为 rejected candidate 或失败说明，不得放行 |
| EventLog 出现 API key 或 token 字段 | 安全边界失败 |
| 普通 settings store、panel HTTP JSON、Observation Snapshot 或 demo summary 出现 API key / token | 安全边界失败 |
| global fetch 缺失且未注入 fetch | 返回 provider config failed response，不添加 polyfill |
| fake provider 返回 fabricated token usage | 测试失败；usage 必须保持 unknown |
| `model.*` event 的 `requestId` 被投影成 `user_clarification` ref | Observation 回归测试失败 |
| 未传 `--ai` 的 underground demo 发布 `model.*` 事件 | demo / 测试失败 |
| `--ai openai-compatible` 缺少 API key 或模型名仍发起 fetch | 配置边界测试失败 |

## Good / Base / Bad Cases

- Good：Underground Intent Core 请求智能通道生成目标画像建议，再由确定性规则转成 `GoalIntentProfile`。
- Good：rootlet 请求候选方向，输出先进入 candidate pool，再由 Convergence Judge 裁决。
- Good：provider adapter 只负责请求/响应映射、鉴权、usage 归一化和错误映射。
- Good：fake provider 只返回 deterministic 内容和 validation 状态；usage 字段保持空值，避免测试误导成本/用量逻辑。
- Base：没有 provider 配置时使用 deterministic fallback 或明确 failed/stopped，不伪造模型成功。
- Bad：在 `src/domain/underground/intent-core.ts` 中直接导入 OpenAI SDK。
- Bad：把模型 JSON 直接保存为 approved Direction Handoff。
- Bad：为了演示成功把 provider 错误吞掉并返回空 approved candidate。

## Tests Required

- `IntelligenceChannel` 请求校验：缺少 purpose、output contract、budget 时失败。
- fake provider completed / failed 路径事件顺序：`model.requested -> model.completed` 或 `model.requested -> model.failed`。
- 6 种 underground rootlet kind 的候选数组 output contract、kind prompt 和 app parser 必须有 focused 测试；fake AI 复杂目标必须证明每种被选中的 rootlet kind 都经过 `IntelligenceChannel` 发布 `model.requested -> model.completed`。
- visible output field type policy 必须覆盖 rootlet candidate 字段，并证明 app parser 会拒绝的字段类型不会生成 approved visible output。
- OpenAI-compatible Chat Completions adapter 使用 stubbed fetch 验证 `/v1/chat/completions` 请求与归一化响应映射，不发真实网络。
- provider adapter 失败映射：鉴权失败、超时、rate limit、输出不合约、fetch 缺失。
- 事件顺序：`model.requested -> model.completed` 或 `model.requested -> model.failed`。
- 导入边界：不引入外部 LLM SDK；`domain/**`、`kernel/**`、app 运行流程不直接导入 provider SDK 或 provider adapter；组合根只允许装配 adapter factory。
- 密钥边界：EventLog、Snapshot 和测试快照不包含 API key / token。
- 配置中心：raw secret 只进入 local-dev secret store 和 provider adapter 构造参数；settings store、panel HTTP JSON、summary、Snapshot 和测试快照不包含 raw secret。
- Observation ref 边界：`model.completed` 的 `requestId` / `responseId` 生成 `model_call` ref，不能生成 `user_clarification` ref。
- Underground 接入：模型输出只能进入候选池，不能绕过收束直接进入 package。
- Underground demo CLI：默认 no-AI、`--ai fake`、`--ai openai-compatible` 配置失败和密钥不泄漏都必须有测试或边界检查。

## Wrong vs Correct

### Wrong

Intent Core 直接调用 OpenAI SDK 或 OpenAI-compatible HTTP endpoint，拿到 JSON 后写入 approved Direction Handoff。

### Correct

Intent Core 构造 `ModelRequest`，通过注入的 `IntelligenceChannel` 获取 `ModelResponse`；响应被校验后作为候选输入进入 Underground candidate pool，再由 Convergence Judge 和 Handoff Steward 形成正式方向包。
