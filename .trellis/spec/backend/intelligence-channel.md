# 智能通道运行时规范

本规范记录后续真实模型接入的可执行边界。实现阶段必须先实现 AgentArbor 原生智能通道，再接具体 provider protocol adapter。

当前运行时不引入 Vercel AI SDK、OpenAI SDK、LangChain、Anthropic SDK、Gemini SDK 或其他外部 LLM SDK。真实 provider 接入以自研 `IntelligenceChannel` 为内核，通过 Node global `fetch` 直接兼容主流 HTTP 协议。首个真实协议实现是 `openai_compatible_chat_completions`；`openai_responses`、`anthropic_messages`、`gemini_generate_content` 只保留枚举和边界，不在本轮实现网络协议。

## Scope / Trigger

- Trigger：新增或修改 `src/domain/intelligence/**`、`src/kernel/intelligence/**`、`src/adapters/intelligence/**`、模型调用 demo、模型调用事件或模型供应商配置。
- Scope：统一模型调用入口、provider adapter 隔离、模型调用事件、输出契约校验、配置中心、密钥与隐私边界。
- Out of Scope：UI、HTTP、SSE、WebSocket、数据库、MCP、A2A、AG-UI、repo-root `.agentarbor/` 资产出生策略。

## Signatures

- `ModelRequest`：内部模型调用请求，必须包含 `requestId`、`traceId`、`callerRef`、`purpose`、`inputRefs`、`sanitizedMessages`、`outputContract`、`constraintRefs`、`budget`、`sensitivity`、`requestedAt`；可选 `tools` 和 `toolChoice` 只声明当前 agent 被允许使用的工具。
- `ModelMessage`：支持 `system/user/assistant/tool`；assistant message 可以携带 `toolCalls`，tool message 必须引用 `toolCallId` 和 `toolName`。
- `ModelResponse`：归一化模型响应，必须包含 `responseId`、`requestId`、`providerId`、`model`、`status`、`outputKind`、`validation`、`completedAt`；可选 `toolCalls` 表示模型要求进入工具回合。
- `ModelUsage`：归一化 token、成本和延迟字段；provider 未返回时保持空值，不伪造。deterministic fake provider 也不得返回 fabricated zero token usage。
- `ModelCallRef`：正式材料引用模型调用的唯一方式。
- `ModelProvider.complete(request)`：provider adapter 最小接口。
- `IntelligenceChannel.request(request)`：业务层唯一模型调用入口。
- `PanelRunStreamEvent.model.output.delta`：panel 专用安全输出增量，只能从模型可见输出安全投影或 provider adapter 的脱敏流式 chunk 派生；它不是 raw provider stream，也不是正式事实源。
- `AgentTurnRuntime.execute(...)`：所有 agent 多轮模型 + 工具回合的统一运行入口；它在 IntelligenceChannel 外层统一承载 tool call loop、tool result 回填、权限、预算、轮次和 fallback。kernel 只依赖 `ToolExecutionBroker` 接口，不依赖 app `ToolCenter` concrete class。
- `executeToolUseLoop(...)`：低层兼容 helper，可被 AgentTurnRuntime 复用；rootlet 等业务 agent 不应继续把它当私有入口。
- `ModelPurpose` 覆盖地下 AI 主线 purpose：`intent_profile`、`growth_governance`、`rootlet_candidate`、`autonomy_decision`、`convergence_judgment`、`handoff_narrative`。这些 purpose 均必须经 `AgentTurnRuntime.execute(...)` 进入模型回合；模型输出只能形成对应 agent 的 `reason()` 决策材料，不能直接写 Plan Package。
- Desktop 首选入口默认进入 `desktop_chat`。普通问题、随意提问和连续追问都先按桌面助手 Root Agent 处理；模型可以在授权范围内通过 AgentTurnRuntime 调用 `search` / `read` 工具。复杂方向成形保留为未来 deep 项目边界；当前不做可见 `runMode = "deep"` 入口，不主动改动 deep 后端。
- `desktop.intent_gate.v1` 是历史兼容契约，不再是 Desktop 产品主线前置门。若保留测试或兼容路径，它只能返回 `chat_direct`、`chat_plus_tools` 或 `task_work_session` 的安全 JSON 决策，且不得写 Plan、Fruits、Run Memory 或长期 Soil。
- `desktop_chat` 是默认对话 purpose。它必须像普通桌面助手一样返回自然语言 text；若模型需要当前信息或授权上下文，应通过 AgentTurnRuntime 的工具循环调用 `search` / `read`，而不是用自然语言假装已经读取。`start_work_session` 仅保留为历史兼容 tool call，Desktop 默认对话不得据此自动执行深度模式。
- `desktop.chat_response.v1`：Desktop Chat Session 输出契约，必须允许自然语言 text 和模型 tool calls。text 回答只生成用户可见回复，不写 Plan、Fruits、Run Memory 或长期 Soil；工具输出只能作为本轮安全摘要 / refs 回填给模型，不直接成为事实源。
- Desktop Work Session purpose 覆盖 `work_session_decision`、`work_session_child_material`、`work_session_synthesis` 和 `work_session_direct_answer`。它们是历史兼容 / 实验路径，不是当前 Desktop 产品主线。未来 deep 项目若重启，应走 Underground Cognitive Runtime 的 intent / growth / rootlet / convergence / handoff_narrative contracts，并先停在 Plan 边界。
- `work_session.direct_answer.v1`：历史 Work Session 直接回答输出契约，必须返回自然语言 text。它只生成用户可见回答，不要求 JSON object，不写 Plan、Fruits、Run Memory 或长期 Soil。
- `underground.convergence_judgment.v1`：Convergence Judge 主裁决输出契约，必须返回 JSON object，字段至少包含 `candidateDecisions`、`nextAction`、`overallDirectionSummary`、`decisionSummary`、`uncertainty` 和 `confidence`；`candidateDecisions[*].status` 只能是 `accepted`、`merged`、`rejected` 或 `unknown`，`nextAction` 只能是 `approve_handoff`、`continue_exploration`、`request_user_clarification` 或 `stop`。
- `underground.handoff_narrative.v1`：Handoff Steward 主交接叙事输出契约，必须返回 JSON object，字段至少包含 `status`、`clarifiedGoal`、`optionNarratives`、`nonGoals`、`assumptions`、`missingInformation`、`risks`、`evidenceBoundary`、`growthEntry`、`decisionSummary`、`uncertainty` 和 `confidence`；`status` 只能是 `approved`、`awaiting_user` 或 `stopped`。`approved` 必须至少给出一个与 Convergence `handoffCandidateRefs` 对齐的 `optionNarratives[*].candidateId`，不得凭模型输出新增 source candidate。
- `UndergroundReasoningTraceEntry`：地下 agent 可展示 reasoning trace 投影，字段只能包含 `agentId`、`decisionSummary`、`inputRefs`、`modelCallRefs`、`toolCallRefs`、`fallbackRefs`、`uncertainty`、`confidence` 和 `createdAt`；不得包含 raw prompt、raw provider response、hidden reasoning、chain-of-thought、secret 或 token。

## Contracts

- `src/domain/intelligence/` 保存模型调用领域契约、purpose taxonomy、输出类型、protocol / provider kind、tool call 字段和 `ModelCallRef`。它不能依赖 provider SDK、provider adapter 或 provider-specific response shape。
- `src/domain/tools/` 保存工具定义、工具调用请求/结果、执行上下文和 tool runner 接口；它是工具能力的领域契约层。
- `src/kernel/intelligence/` 保存智能通道实现、请求校验、输出校验、事件发布、降级策略、provider registry、AgentTurnRuntime 和工具循环；AgentTurnRuntime / 工具循环不能导入 app 层 ToolCenter 或地下模块。
- `src/adapters/intelligence/` 保存 OpenAI-compatible Chat Completions、后续 OpenAI Responses、Anthropic Messages、Gemini generateContent 或其他 provider protocol adapter。只有这一层可以读取 provider 凭证或执行 provider HTTP 协议映射；本阶段不得引入外部 LLM SDK。
- `src/app/**` 的运行流程只能通过注入的 `IntelligenceChannel` 使用模型能力；应用组合根可以装配智能通道和 provider adapter，但不能直接调用 provider SDK、读取 provider-specific response 字段或导入 adapter 实现参与业务流程。
- `src/app/intelligence-channel-factory.ts` 是当前 CLI / demo 组合根装配 provider adapter 的唯一 app 层例外；地下 session、runner、rootlet、summary 和其他业务编排只能接收 `IntelligenceChannel` 或清洗后的 AI 观测输入，不得直接导入 provider adapter。
- `src/app/config-center.ts` 负责把本地配置中心中的脱敏 settings 与 local-dev secret store 转成组合根可消费的 provider 环境；它不能把 raw secret 返回给 panel HTTP、summary、Snapshot 或 EventLog。
- `src/domain/config/` 保存 provider profile、默认 AI mode、secret ref 和脱敏视图；`src/adapters/config/` 只负责普通 settings 文件与 local-dev secret 文件读写。普通 settings store 不得保存 raw secret。
- 地下 rootlet AI 建议的 app 层契约拆分为 `src/app/underground/intelligence-contracts.ts`、`intelligence-prompts.ts` 和 `intelligence-output.ts`；6 种 rootlet kind 都必须使用 kind 专属 prompt 和 output contract，请求仍经 `IntelligenceChannel`，响应采用顶层 `candidates` 数组。数组项的 kind 专属字段由 app parser 校验、归一化、丢弃非法项并按 rootlet budget 截断；不要把完整数组 schema 推入当前 `ModelOutputContract` 内核。`ModelOutputContract.visibleOutput.fieldTypes` 只服务安全展示投影，必须与 app parser 的字段类型保持一致；parser 会丢弃的候选不得生成 approved visible output。
- 地下自治 AI 建议的 app 层契约位于 `src/app/underground/autonomy-intelligence.ts`；`underground.autonomy_decision.v1` 必须返回 JSON object，字段至少包含 `action`、`completionAssessment`、`informationGaps`、`spawnRequests`、`rationale` 和可选 `sourceRefs`。app parser 必须校验 action 枚举、spawn rootlet kind、candidate refs、长度和 secret/token 脱敏。
- 地下 Intent Core、Growth Governor、Rootlet Explorer、Convergence Judge 和 Handoff Steward 的 AI 主线契约位于 `src/app/underground/agents/` 相邻代码中，复用地下专属 reasoning helper 调用 `AgentTurnRuntime`、解析结构化 JSON、生成安全 `reasoningTrace`。这些契约不得上移到 `kernel`，也不得直接导入 provider adapter。
- 地下 agent 调用 `AgentTurnRuntime` 时必须传递当前 run 的真实 `traceId`；投影视图若会发起模型请求，必须显式携带 `traceId`。不得用 `goalId`、candidate id、package id 或 agent id 顶替 trace id，否则 `model.*` 事件会脱离运行链路。
- Convergence Judge 的 `underground.convergence_judgment.v1` parser 必须证明模型覆盖每个 candidate id；`request_user_clarification` 必须至少有一个 `unknown` candidate；`approve_handoff` 必须至少有一个 `accepted` 或 `merged` candidate；`stop` / `continue_exploration` 不得同时携带 `accepted` / `merged` handoff candidate。
- `src/domain/underground/**`、`src/domain/aboveground/**`、`src/domain/governance/**` 和 `src/kernel/**` 不得直接导入 provider adapter。

## 生效规则

- 任何直接在领域层、kernel 业务边界、app demo 运行流程或测试 fixture 中调用 provider SDK、外部 LLM SDK 或 provider adapter 的实现都违规。
- 单次模型输出、单个 rootlet/subagent 输出、工具结果和搜索结果默认是未收束材料；不能直接写入 Plan material、Aboveground 执行计划、Verification Result、Run Memory、Experience Candidate、Capability Asset 或 Soil。上层 agent 收束后的判断可以成为正式材料输入，但必须经过协议、权限、预算、hard constraint、谱系、脱敏和 package validation。
- 模型返回 `toolCalls` 时只能由 AgentTurnRuntime 触发受权限裁剪的工具循环；工具结果也是未收束材料，必须作为 tool message 回到模型或作为 source/evidence refs 进入候选层，不能直接变成事实源。
- Desktop 入口不得把所有输入强行升级为复杂任务，也不得用工程关键词替模型判断。`runMode = "agent"` 是默认路径，经 AgentTurnRuntime 调用 `desktop_chat`，允许模型在授权范围内使用 `search` / `read` 后返回自然语言回答、请求确认或提示用户补充上下文；`runMode = "deep"` 是未来项目边界，当前不做可见入口也不主动扩展后端。
- `model.requested`、`model.completed`、`model.failed` 事件必须由智能通道统一发布；调用方不得手写伪造模型调用事件。
- 面板的 `model.output.delta` / `model.output.completed` 只能作为 `PanelRunStreamEvent` 安全读模型出现；它们不得携带 provider hidden reasoning、完整 prompt、raw response、未校验输出或 secret，也不能替代 `model.completed` 的 validation 结果。
- `tool.requested`、`tool.completed`、`tool.failed` 事件必须由工具循环 / ToolCenter 集成统一发布；payload 只允许 safe input/output summary、refs、duration 和错误摘要。
- EventLog 和 Observation Snapshot 只能记录清洗后的请求摘要、引用、usage、状态和错误引用。
- Observation refs 必须按事件类型解析：`model.*` payload 中的 `requestId` / `responseId` 只能生成 `model_call` ref；`user_approval.*` 和 direction-handoff revision payload 中的 clarification ids 才能生成 `user_clarification` ref。
- API key、token、完整敏感 prompt、未授权 Soil 内容和 provider 原始敏感错误不得进入 EventLog、Snapshot、Plan Package 或测试快照。
- Provider 输出不符合 `outputContract` 时必须形成 validation failed，不得被调用方当作成功响应继续收束。
- rootlet AI 调用成功但 app parser 得不到合法候选、provider 失败或输出契约 validation failed 时，rootlet invocation 必须不中断，回退 deterministic output；fallback 必须能从 `model.failed` / `model.completed` 事件、demo summary 和 deterministic output 的 `ai-fallback:*` source refs 观测。
- 自治主线与 rootlet fallback 不同：启用 autonomy 时，缺少 `AgentTurnRuntime`、模型失败、输出 validation failed 或 app parser 拒绝时，不能回退为 deterministic 成功；必须产生 failed/stopped autonomy decision，并经 Convergence Judge 形成 `ai_required_for_autonomy`、`autonomy_decision_failed`、`autonomy_cycle_guard_exceeded` 或 `autonomy_stopped` 等可审计终态。
- Convergence Judge 与自治主线同属 AI-required 上层语义判断：缺少 `AgentTurnRuntime`、模型失败、输出 validation failed 或 app parser 拒绝时，不能回退为 approved deterministic convergence；必须形成 `deterministic_fallback` 低置信 stopped / awaiting boundary，并保留 `fallbackRefs`。
- Handoff Steward 与 Convergence Judge 同属 AI-required 上层语义判断：缺少 `AgentTurnRuntime`、模型失败、输出 validation failed 或 app parser 拒绝时，不能回退为 approved handoff；只能形成低置信 `deterministic_fallback` handoff material，并落到 `stopped` / `awaiting_user` 非 approved package 边界。`act()` 只能消费 `reason()` 形成的 handoff material 调用 direction material / package builder / store，不得重新组织方向叙事、候选取舍或发起模型调用。
- hard constraint、Plan Package validation、状态机守卫和 Governance gate 不得因为模型建议而被跳过。
- 工程边界不得替 agent 思考：`ModelOutputContract`、parser、visible output projection、validation、budget、permission 和 fallback 只负责裁剪、校验、脱敏、失败归一和引用边界；不得把这些机制写成目标理解、候选排序、工具选择、继续探索或收束裁决的主逻辑。
- `pnpm demo:underground` 默认使用 fake AI 作为最小 happy path，经 `IntelligenceChannel` / `AgentTurnRuntime` 发布 `model.requested -> model.completed`；不得触发真实网络。只有显式 `--ai openai-compatible` 且配置完整时才允许真实 provider 路径。`aiMode=none` 只作为禁用边界，必须 stopped/failed 且不得 approved。
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
| provider 返回 tool calls | response validation 通过，调用方进入工具循环；最终候选输出仍需通过 output contract |
| `visibleOutput.fieldTypes` 与 rootlet parser 字段类型不一致，导致 parser 丢弃的候选仍可见 | 测试失败；visible output 必须被抑制或只展示 parser 可接受字段 |
| 模型建议违反 hard constraint | 保留为 rejected candidate 或失败说明，不得放行 |
| 自治模型输出非法 action / rootlet kind / candidate ref | 返回 failed autonomy decision，Convergence Judge 生成 stopped terminal report，不进入 approved handoff |
| Convergence Judgment 缺少 candidate 覆盖、非法 nextAction、澄清但无 unknown、批准但无 handoff candidate、或停止/继续仍带 handoff candidate | app parser 拒绝，Convergence Judge 进入低置信 fallback / stopped，不进入 approved handoff |
| 自治模型请求 `search` / `read` | AgentTurnRuntime 执行工具回合并回填 tool message；工具结果只作为 safe refs/摘要影响自治 decision |
| 自治主线无 AgentTurnRuntime | 返回 disabled/stopped，不发布伪造 `model.completed` |
| Convergence Judge 无 AgentTurnRuntime | 返回 `deterministic_fallback` 低置信 convergence report，terminal status 不得是 `approved_package_created` |
| 地下 agent 的模型请求 `traceId` 不是当前 orchestrator / session trace | 测试失败；必须修正投影视图和 percept，不得用 goal id 顶替 |
| `reasoningTrace` 出现 raw prompt、role message marker、raw provider response、hidden reasoning、chain-of-thought、API key 或 token | 测试失败；trace 必须脱敏或替换为安全占位 |
| EventLog 出现 API key 或 token 字段 | 安全边界失败 |
| 普通 settings store、panel HTTP JSON、Observation Snapshot 或 demo summary 出现 API key / token | 安全边界失败 |
| global fetch 缺失且未注入 fetch | 返回 provider config failed response，不添加 polyfill |
| fake provider 返回 fabricated token usage | 测试失败；usage 必须保持 unknown |
| `model.*` event 的 `requestId` 被投影成 `user_clarification` ref | Observation 回归测试失败 |
| 未传 `--ai` 的 underground demo 发布 `model.*` 事件 | demo / 测试失败 |
| `--ai openai-compatible` 缺少 API key 或模型名仍发起 fetch | 配置边界测试失败 |

## Good / Base / Bad Cases

- Good：Underground Intent Core 请求智能通道生成目标画像候选，上层 agent / 守卫把它收束为 `GoalIntentProfile`，而不是由 provider response 直接写入 handoff。
- Good：rootlet 请求候选方向，输出先进入 candidate pool，再由 AI 驱动的 Convergence Judge 主线裁决，并受 hard constraint / package validation 守卫。
- Good：Autonomy Core 在 candidate pool 更新后经 AgentTurnRuntime 使用 `search` / `read` 补充判断依据，只发布 autonomy decision 和后续收束请求，不直接写 handoff。
- Good：provider adapter 只负责请求/响应映射、鉴权、usage 归一化和错误映射。
- Good：fake provider 只返回 deterministic 内容和 validation 状态；usage 字段保持空值，避免测试误导成本/用量逻辑。
- Base：没有 provider 配置时使用 deterministic fallback 或明确 failed/stopped，不伪造模型成功。
- Bad：在 `src/domain/underground/intent-core.ts` 中直接导入 OpenAI SDK。
- Bad：把模型 JSON 直接保存为 approved Plan。
- Bad：把自治模型的 `request_convergence` 当作批准信号，跳过 Convergence Judge 或 Handoff validation。
- Bad：为了演示成功把 provider 错误吞掉并返回空 approved candidate。

## Tests Required

- `IntelligenceChannel` 请求校验：缺少 purpose、output contract、budget 时失败。
- Desktop 默认 Agent：fake/stub AI 对 `你是什么模型？` 这类普通问题只发起一次 `desktop_chat` 调用并返回 text；复杂普通模式请求可以由模型调用授权工具后回答。断言没有 intent gate、Underground child run、parent synthesis、artifact produced，canvas 只展示回答和安全工具 refs。
- Desktop deep 边界：项目分析、文件阅读或报告任务不得由工程关键词自动升级到 Underground；当前不新增可见 deep 入口。
- fake provider completed / failed 路径事件顺序：`model.requested -> model.completed` 或 `model.requested -> model.failed`。
- 6 种 underground rootlet kind 的候选数组 output contract、kind prompt 和 app parser 必须有 focused 测试；fake AI 复杂目标必须证明每种被选中的 rootlet kind 都经过 `IntelligenceChannel` 发布 `model.requested -> model.completed`。
- visible output field type policy 必须覆盖 rootlet candidate 字段，并证明 app parser 会拒绝的字段类型不会生成 approved visible output。
- OpenAI-compatible Chat Completions adapter 使用 stubbed fetch 验证 `/v1/chat/completions` 请求与归一化响应映射，不发真实网络。
- OpenAI-compatible Chat Completions adapter 使用 stubbed fetch 验证 `tools`、`tool_choice`、assistant `tool_calls`、tool result message 和 provider `tool_calls` 归一化映射。
- fake provider 支持 deterministic tool call fixture，以便测试工具循环而不引入真实网络。
- AgentTurnRuntime 覆盖模型禁用、未授权工具、工具回填继续模型、模型/工具轮次上限和边界导入规则。
- Intent Core / Growth Governor / Rootlet Explorer / Convergence Judge / Handoff Steward focused tests 必须用 fake `AgentTurnRuntime` 证明 `reason()` 触发模型路径，并在无 runtime 时进入低置信 fallback / stopped 边界，不产生 approved package。
- 会从 workspace projection 发起模型请求的地下 agent focused tests 必须断言 `ModelRequest.traceId` 使用当前 run trace，而不是 `goalId` 或其他业务 id。
- Convergence Judgment parser 测试必须覆盖完整 candidate 覆盖、非法 nextAction、澄清无 unknown、批准无 accepted/merged、停止/继续仍带 accepted/merged、澄清 reason 传递和 `reasoningTrace` 脱敏。
- 自治 decision 覆盖 `request_convergence`、`continue_exploration`、`aiMode=none` / 无 `AgentTurnRuntime` disabled、provider failure、非法输出、工具 `search` / `read` 回合和 secret/token 脱敏；断言模型/工具输出只影响候选与收束边界，不直接进入 Plan。
- provider adapter 失败映射：鉴权失败、超时、rate limit、输出不合约、fetch 缺失。
- 事件顺序：`model.requested -> model.completed` 或 `model.requested -> model.failed`。
- 导入边界：不引入外部 LLM SDK；`domain/**`、`kernel/**`、app 运行流程不直接导入 provider SDK 或 provider adapter；组合根只允许装配 adapter factory。
- 密钥边界：EventLog、Snapshot 和测试快照不包含 API key / token。
- 配置中心：raw secret 只进入 local-dev secret store 和 provider adapter 构造参数；settings store、panel HTTP JSON、summary、Snapshot 和测试快照不包含 raw secret。
- Observation ref 边界：`model.completed` 的 `requestId` / `responseId` 生成 `model_call` ref，不能生成 `user_clarification` ref。
- Underground 接入：下层模型/rootlet/tool 输出只能进入候选池或收束输入，不能绕过上层 agent 收束和 handoff validation 直接进入 package。
- Underground demo CLI：默认 fake AI、`--ai openai-compatible` 配置失败、AI 禁用边界和密钥不泄漏都必须有测试或边界检查；禁用边界不得成为 approved happy path。

## Wrong vs Correct

### Wrong

Intent Core 直接调用 OpenAI SDK 或 OpenAI-compatible HTTP endpoint，拿到 JSON 后写入 approved Plan。

### Correct

Intent Core 构造 `ModelRequest`，通过注入的 `IntelligenceChannel` 获取 `ModelResponse`；响应被校验后作为目标画像候选进入 Underground 上层 agent 收束流程，再由 Convergence Judge 和 Handoff Steward 形成正式 Plan Package，并通过 package validation。
