# 工具运行时

本规范记录 ToolCenter、ResearchRuntime、工具契约、AgentTurnRuntime、IntelligenceChannel 多轮工具循环和地下 agent 工具接入的可执行边界。工具能力是运行期能力，不是长期 Capability Asset；工具输出和模型输出一样是不可信候选材料，必须经过既有候选池、收束和方向交接校验。

## Scenario: AgentTurnRuntime + ToolCenter 多轮工具循环

### 1. Scope / Trigger

- Trigger：新增或修改 `src/domain/tools/**`、`src/domain/research/**`、`src/app/research/**`、`src/app/tool-center/**`、`src/kernel/intelligence/agent-turn-runtime.ts`、`src/kernel/intelligence/tool-use-loop.ts`、`ModelRequest.tools` / `ModelResponse.toolCalls`、`tool.*` 事件、agent turn policy、rootlet 工具权限或 panel / summary 工具投影。
- Scope：内存版 ToolCenter、ResearchRuntime-backed `search` / `read` 工具、低层 Tavily web adapter、OpenAI-compatible tool call 映射、统一 AgentTurnRuntime、地下 agent 作为首批消费者、EventLog 和 Observation 安全投影。
- Out of Scope：完整 MCP client/server、工具市场 UI、任意工具适配器 UI、浏览器工具、数据库持久化、多进程 worker 和长期 Capability Asset 入土；本轮只允许 panel 暴露脱敏的信息源配置。

### 2. Signatures

- `ToolDefinition`：`{ name, description, inputSchema }`，input schema 采用 JSON object schema 子集。
- `ToolCallRequest`：`{ callId, toolName, input }`。
- `ToolCallResult`：`{ callId, toolName, input, output, status, error?, durationMs }`。
- `ToolExecutionContext`：`{ callerAgentId, traceId, goalId }`。
- `ToolExecutionBroker`：`list() / has(name) / execute(request, context, permission) / resetCallCount() / getCallCount()`。
- `ToolCenter({ maxCallsPerRun? })`：app 层 concrete registry / executor，默认单次运行最多 20 次工具调用。
- `InformationAccess` / `ResearchRuntime`：领域契约位于 `src/domain/research/**`，app 实现位于 `src/app/research/**`；统一表达 `InformationQuery`、`InformationSource`、`SearchResultRef`、`ReadResultRef` 和 `ResearchTrace`。
- `search` tool：模型可见信息搜索入口，输入 query、可选 source filters 和 limit；返回 research refs、source、status、短 snippet 和 trace 摘要。
- `read` tool：模型可见信息读取入口，输入 research ref、URL 或 repo path；返回 `ReadResultRef`、短 summary、截断 preview 和 trace 摘要。
- `createWebSearchTool({ apiKey?, maxResults?, fetch? })`：保留为低层 Tavily adapter；它不再是地下 prompt / rootlet manifest 的主工具名。
- source adapters：当前覆盖 `web`、`page`、`codebase`、`soil`、`run_memory`、`docs`、`packages`、`github`；`docs` / `packages` / `github` 当前必须显式返回 stub/no-provider。
- `ConfigCenter.getWebSearchConfig()`：返回 `SanitizedWebSearchConfig`，只包含 `provider`、`maxResults`、`secretRef`、`secretConfigured`、`secretUpdatedAt`、`status` 和 `updatedAt`。
- `ConfigCenter.updateWebSearchConfig({ provider?, apiKey?, tavilyApiKey?, maxResults?, tavilyMaxResults? })`：更新 web search provider / Tavily max results，并把 raw key 只写入 local-dev secret store。
- `createConfiguredToolCenter(configCenter, options?)` / `createConfiguredToolCenterFactory(configCenter, options?)`：app 组合根从 ConfigCenter 读取 Tavily secret 环境，创建 ResearchRuntime，并注册模型可见 `search` / `read` 工具。
- Panel 配置路由：`GET /api/config/tools` 返回 `{ tools: { webSearch }, informationAccess }` 脱敏视图；`POST /api/config/tools/web-search` 接收 web search 更新输入并返回同样的脱敏视图。
- `ModelRequest.tools?: ToolDefinition[]`，`ModelRequest.toolChoice?: "auto" | "none" | { type: "function"; function: { name } }`。
- `ModelMessage.role` 覆盖 `system | user | assistant | tool`；assistant message 可携带 `toolCalls`，tool message 必须携带 `toolCallId` / `toolName`。
- `ModelResponse.toolCalls?: ToolCallRequest[]`；带 tool calls 的 response 允许 `finishReason = "tool_call"`，不要求最终 output contract 已满足。
- `AgentTurnPolicy`：`{ allowModel, allowedTools, maxModelRounds, maxToolRounds, fallback, callerAgentId, traceId, goalId, purpose, outputContract, sensitivity, budget }`。
- `AgentTurnRuntime.execute(input)`：统一执行单次 agent turn，返回模型禁用、模型失败、轮次上限、工具回合和最终模型输出状态。
- `executeToolUseLoop(options, initialRequest)` 是低层兼容 helper，返回 `{ finalOutput, toolCalls, modelRounds, rounds, stoppedReason }`；rootlet 不应再直接把它当私有入口。
- EventLog 新增 `tool.requested`、`tool.completed`、`tool.failed`。

### 3. Contracts

- `domain/tools` 只保存产品级工具契约；不能依赖 app、adapter、fetch 或 provider-specific shape。
- `domain/research` 只保存信息获取领域契约；不能依赖 fetch、ToolCenter、provider adapter、filesystem 或地下业务模块。
- `app/research` 负责 ResearchRuntime、source adapter、source preference、search/read trace 和 safe preview；它可以依赖 Node filesystem / fetch-like 注入和只读 Soil Store，但不能写 Soil、RunMemory、Direction Handoff、Fruit 或 Capability Asset。
- `kernel/intelligence/agent-turn-runtime.ts` 是模型 + 工具多轮 agent turn 的统一入口；它只能依赖 `IntelligenceChannel`、`ToolExecutionBroker`、领域契约和事件发布接口，不能导入 app `ToolCenter` concrete class 或地下模块。
- `kernel/intelligence/tool-use-loop.ts` 只能依赖 `IntelligenceChannel` 和 `ToolExecutionBroker` 接口，不能导入 `src/app/tool-center` concrete class；它可以作为 `AgentTurnRuntime` 的低层 helper，但不能成为 rootlet 私有能力。
- `ToolCenter` 负责注册、查询、执行、权限检查、预算检查和失败归一化；工具不存在、未授权、预算耗尽或 executor 抛错都返回 `status: "failed"`，不把 provider 原始异常向上抛。
- `allowedTools` 必须来自 agent manifest / runtime policy；rootlet agent 当前通过 `turnPolicy.allowedTools` / `permissions.execute` 获得工具，固定地下核心 agent 默认 `allowModel = false` 且无工具执行权限。`underground-autonomy-core` 是明确例外：它允许模型并只允许 `search` / `read`，用于判断继续探索或请求收束；工具结果不得直接进入 Direction Handoff。
- `allowModel = false` 的 agent turn 必须由 `AgentTurnRuntime` 返回明确 disabled / skipped 状态，不能偷偷调用 `IntelligenceChannel`。
- 默认 ToolCenter 只能把 `search` / `read` 暴露给地下 rootlet prompt；`web_search` / `page_reader` 不得作为地下 prompt 主入口或 rootlet manifest 默认工具名。
- `web` source 默认不联网；没有 Tavily key 或 fetch 时返回 deterministic `no-provider` / `no_search_provider` 降级，不得为了演示成功访问未知公共搜索 API。
- `page` source 只读取 `http/https` 页面，清洗 HTML 并截断 preview；不做浏览器渲染、登录态、Cookie、表单交互或 SPA。
- `codebase` source 只在 repo 根内做文本搜索 / read，必须防路径逃逸，忽略 `node_modules`、`dist`、`.git` 等生成或外部目录。
- `soil` / `run_memory` source 当前只读已有 Soil refs / historical run refs 或返回 stub；不得内联 Soil asset body，也不得把 Run Memory stub 当长期资产事实。
- Tavily key 可来自配置中心 information source secret、环境变量 `AGENTARBOR_TAVILY_API_KEY` / `TAVILY_API_KEY` 或显式注入；Tavily max results 和 source preference 可由配置中心环境投影或显式组合根参数传入；普通 settings store、EventLog、Snapshot、summary 和 panel HTTP JSON 不得保存 raw key。
- `informationAccess.webSearch.provider = "none"` 必须禁用 Tavily secret 环境投影并让 web source 降级为 disabled / no-provider；不能因为 secret store 仍有历史 key 就继续联网。
- 面板 `工具配置` 只管理本地信息源 provider / secret 状态，不注册任意工具、不展示工具市场、不允许地下 agent 管理 ToolCenter 生命周期。
- 面板运行入口启用 AI 时必须通过 `createConfiguredToolCenterFactory(configCenter, { fetch })` 装配 ToolCenter；不得复用只来自模型 provider config 的默认工具中心，也不得让 rootlet 自己读取 ConfigCenter 或 secret store。
- OpenAI-compatible adapter 必须把 `tools`、`tool_choice`、assistant `tool_calls`、tool result messages 和 provider `tool_calls` 互相映射；外部 LLM SDK 仍禁止。
- tool result 作为 `role: "tool"` message 追加回模型上下文；工具输出必须先清洗、截断和 JSON-safe 化。
- `tool.*` EventLog payload 只记录 call id、tool name、caller agent、duration、safe input/output summary 或 error；不得记录 raw provider response、API key、token、完整 prompt、完整页面正文或 live对象。
- `ResearchTrace` 只能记录 query、source、ref、status、短摘要和调用链；不得保存 raw provider response、完整页面正文、完整 prompt、API key 或 token。
- rootlet 工具结果只能以 `tool-call:*` 和 `research:*` refs 进入 rootlet output `sourceRefs` / `evidenceRefs`，再进入 CandidatePool 和 Convergence Judge；不得把 tool raw output、Tavily raw response、完整 page preview 或搜索 snippet 直接写入候选、Direction Handoff、Growth Plan、Fruit、Run Memory、Experience Candidate、Capability Asset 或 Soil。
- `maxModelRounds` 和 `maxToolRounds` 是单次 agent turn 的工程级 runaway guard；达到上限时调用方走声明的 fallback / failed advice 路径，不能无限继续请求模型或工具，也不能把 guard reached 当作任务完成。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 工具未注册 | `ToolCallResult.status === "failed"`，EventLog 发布 `tool.failed` |
| `allowedTools` 不包含请求工具 | 工具被拒绝，`ToolCenter.getCallCount()` 不增加 |
| 超过 `maxCallsPerRun` | 工具返回 budget exhausted failure，不继续执行 executor |
| `search` 使用 web source 但无 Tavily key / fetch | 返回 `no-provider` trace，流程继续 |
| web search provider 为 `none` | ConfigCenter 不投影 Tavily key，panel 显示 disabled，地下运行继续但 web source 不联网 |
| `GET /api/config/tools` | 返回 `tools.webSearch` 和 `informationAccess` 脱敏视图，不包含 raw key |
| `POST /api/config/tools/web-search` 提交 API key | raw key 只写入 secret store，响应和普通 settings 不回显 |
| `search` 使用 web source 且 provider HTTP 失败 | 返回 `provider-failed` trace，ToolCenter 仍视为 completed 工具输出，由模型/调用方判断 |
| `read` 读取 http/https page | 返回清洗、截断的 `ReadResultRef`，不包含完整页面正文 |
| `read` 读取非 http/https page ref | 返回 `invalid-input`，不触发浏览器或登录态能力 |
| `search` / `read` 使用 docs/packages/github | 返回 stub/no-provider，不能接真实 provider |
| 模型返回 tool calls | IntelligenceChannel response validation 通过，tool loop 执行工具并追加 tool message |
| tool loop 超过 `maxToolRounds` | AgentTurnRuntime 返回 `stoppedReason = "max_tool_rounds"`，调用方使用声明 fallback |
| model loop 超过 `maxModelRounds` | AgentTurnRuntime 返回 `stoppedReason = "max_model_rounds"`，不得继续请求模型 |
| `allowModel = false` | AgentTurnRuntime 返回 disabled / skipped 状态，`model.*` 事件计数保持 0 |
| `underground-autonomy-core` 请求 `search` / `read` | 工具通过统一 ToolCenter 执行，EventLog 只记录 safe tool summary，结果只回填模型或成为 autonomy decision refs |
| `underground-autonomy-core` 请求未授权工具 | ToolCenter 返回 failed，EventLog 发布 `tool.failed`，自治决策失败或停止，不绕过收束 |
| EventLog / Snapshot / summary / panel JSON 出现 API key、token、raw provider response、完整 prompt 或完整页面正文 | 安全边界失败 |
| rootlet 工具结果绕过 CandidatePool / Convergence Judge | 地下边界测试失败 |

### 5. Good / Base / Bad Cases

- Good：rootlet model response 请求 `search`，ToolCenter 发布 `tool.requested -> tool.completed`，tool result 包含 research refs 和 trace 摘要，下一轮模型可用 `read` 展开选中 ref，最终 rootlet output source refs 包含 `tool-call:<id>` 和 `research:*` refs。
- Good：未授权 rootlet 请求 `search` 或 `read` 时得到 failed tool result，模型仍可用失败结果继续，EventLog 有 `tool.failed`。
- Good：`underground-intent-core` 的 turn policy 禁用模型和工具，同步调度不会产生 `model.*` 或 `tool.*` 事件。
- Good：`underground-autonomy-core` 通过同一个 AgentTurnRuntime 调用 `search` / `read` 后再输出 autonomy decision；Convergence Judge 仍是唯一收敛报告 owner。
- Base：fake provider 默认不返回 tool calls；`--ai fake` 和 no-AI 路径保持原有 deterministic / 单轮行为。
- Base：无 Tavily key 时 `search` 的 web source 返回 `no-provider`，不触发真实网络；docs/packages/github 返回 stub。
- Base：面板保留 `/api/config/information-sources` 兼容路由，但新的搜索工具表单走 `/api/config/tools` 和 `/api/config/tools/web-search`。
- Bad：kernel tool loop 直接 import app `ToolCenter`。
- Bad：把工具 raw output、Tavily raw response、完整页面正文或完整 prompt 直接塞进 Direction Handoff options、panel transcript 或 EventLog payload。
- Bad：给自治核心新增私有搜索 helper、直接读 ConfigCenter secret，或让它管理 ToolCenter / provider 生命周期。
- Bad：把 search API key 写入普通 settings 或测试快照。

### 6. Tests Required

- ToolCenter 注册 / 注销 / 查询 / 执行。
- ToolCenter allowedTools 权限拒绝和 maxCallsPerRun。
- ResearchRuntime 覆盖 source 分发、source preference、无 provider 降级、search refs、read refs 和 trace 串联。
- web source Tavily mock 成功路径和无 key `no-provider` 路径。
- page source 覆盖 http/https 清洗截断、无 fetch 降级和 invalid URL。
- codebase source 覆盖 repo 内文本搜索、read 和路径逃逸守卫。
- soil / run_memory / docs / packages / github source 覆盖只读 refs 或 stub/no-provider。
- ToolCenter 默认注册 `search` / `read`，且默认地下 rootlet manifest 不再授权 `web_search`。
- ConfigCenter 覆盖 `getWebSearchConfig()`、`updateWebSearchConfig()`、provider `none` 禁用、raw key 只进 secret store、v1 / 旧 v2 settings 兼容归一化。
- `createConfiguredToolCenter()` / factory 有 key 时注册 `search` / `read` 并把 key 传给 Tavily mock；无 key 或 provider `none` 时仍注册工具并降级。
- Panel 覆盖 `GET /api/config/tools`、`POST /api/config/tools/web-search`、工具配置 HTML、保存后不回显 key，以及 openai-compatible 地下运行使用配置中心 ToolCenter。
- fake provider tool call fixture。
- OpenAI-compatible adapter tools / tool result / tool_calls 映射。
- `executeToolUseLoop` 一轮工具后完成、max rounds、工具失败不中断。
- `AgentTurnRuntime` 覆盖模型禁用、未授权工具、一轮工具后继续模型、`maxToolRounds`、`maxModelRounds` 和 fallback status。
- 地下自治核心覆盖：manifest / turn policy 只授权 `search` / `read`，工具调用发布 `tool.requested` / `tool.completed`，safe refs 进入 autonomy summary，工具 raw output 不进入 handoff / panel transcript。
- Observation metadata 覆盖 `tool.*`，tool refs 不误识别为 model/user clarification refs。
- rootlet AI 调用 `search` / `read` 后候选进入 CandidatePool，source/evidence refs 包含 tool call / research refs，EventLog 不泄漏 key。
- 至少一个非 rootlet 地下核心 agent 通过 turn policy 证明模型 / 工具不可用时不会私自调用。
- 静态边界测试证明 kernel 不导入 app `ToolCenter` concrete class，ToolCenter 不依赖 underground 模块。
- `pnpm test`、`pnpm panel:smoke` 和 `git diff --check`。

### 7. Wrong vs Correct

#### Wrong

```ts
import { ToolCenter } from "../../app/tool-center/tool-center.js";

export async function executeToolUseLoop(...) {
  const result = await new ToolCenter().execute(...);
}
```

这会让 kernel 依赖 app concrete 服务，并绕过组合根的权限和工具注册。

#### Correct

```ts
export async function executeToolUseLoop(input: {
  toolCenter: ToolExecutionBroker;
  allowedTools?: readonly string[];
}) {
  const result = await input.toolCenter.execute(request, context, {
    callerAgentId,
    allowedTools: input.allowedTools,
  });
}
```

kernel 只依赖领域接口；app 组合根负责创建 ToolCenter、注册工具和传入 agent manifest 权限。
