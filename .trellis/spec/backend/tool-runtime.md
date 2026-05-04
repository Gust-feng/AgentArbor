# 工具运行时

本规范记录 ToolCenter、工具契约、AgentTurnRuntime、IntelligenceChannel 多轮工具循环和地下 agent 工具接入的可执行边界。工具能力是运行期能力，不是长期 Capability Asset；工具输出和模型输出一样是不可信候选材料，必须经过既有候选池、收束和方向交接校验。

## Scenario: AgentTurnRuntime + ToolCenter 多轮工具循环

### 1. Scope / Trigger

- Trigger：新增或修改 `src/domain/tools/**`、`src/app/tool-center/**`、`src/kernel/intelligence/agent-turn-runtime.ts`、`src/kernel/intelligence/tool-use-loop.ts`、`ModelRequest.tools` / `ModelResponse.toolCalls`、`tool.*` 事件、agent turn policy、rootlet 工具权限或 panel / summary 工具投影。
- Scope：内存版 ToolCenter、mockable web_search 工具、OpenAI-compatible tool call 映射、统一 AgentTurnRuntime、地下 agent 作为首批消费者、EventLog 和 Observation 安全投影。
- Out of Scope：完整 MCP client/server、工具市场、浏览器工具、数据库持久化、多进程 worker、长期 Capability Asset 入土和 panel 工具配置 UI。

### 2. Signatures

- `ToolDefinition`：`{ name, description, inputSchema }`，input schema 采用 JSON object schema 子集。
- `ToolCallRequest`：`{ callId, toolName, input }`。
- `ToolCallResult`：`{ callId, toolName, input, output, status, error?, durationMs }`。
- `ToolExecutionContext`：`{ callerAgentId, traceId, goalId }`。
- `ToolExecutionBroker`：`list() / has(name) / execute(request, context, permission) / resetCallCount() / getCallCount()`。
- `ToolCenter({ maxCallsPerRun? })`：app 层 concrete registry / executor，默认单次运行最多 20 次工具调用。
- `createWebSearchTool({ apiKey?, maxResults?, fetch? })`：返回 `web_search` executor；可用 Tavily key 和 fetch 时访问 Tavily，否则返回 `no_search_provider`。
- `ModelRequest.tools?: ToolDefinition[]`，`ModelRequest.toolChoice?: "auto" | "none" | { type: "function"; function: { name } }`。
- `ModelMessage.role` 覆盖 `system | user | assistant | tool`；assistant message 可携带 `toolCalls`，tool message 必须携带 `toolCallId` / `toolName`。
- `ModelResponse.toolCalls?: ToolCallRequest[]`；带 tool calls 的 response 允许 `finishReason = "tool_call"`，不要求最终 output contract 已满足。
- `AgentTurnPolicy`：`{ allowModel, allowedTools, maxModelRounds, maxToolRounds, fallback, callerAgentId, traceId, goalId, purpose, outputContract, sensitivity, budget }`。
- `AgentTurnRuntime.execute(input)`：统一执行单次 agent turn，返回模型禁用、模型失败、轮次上限、工具回合和最终模型输出状态。
- `executeToolUseLoop(options, initialRequest)` 是低层兼容 helper，返回 `{ finalOutput, toolCalls, modelRounds, rounds, stoppedReason }`；rootlet 不应再直接把它当私有入口。
- EventLog 新增 `tool.requested`、`tool.completed`、`tool.failed`。

### 3. Contracts

- `domain/tools` 只保存产品级工具契约；不能依赖 app、adapter、fetch 或 provider-specific shape。
- `kernel/intelligence/agent-turn-runtime.ts` 是模型 + 工具多轮 agent turn 的统一入口；它只能依赖 `IntelligenceChannel`、`ToolExecutionBroker`、领域契约和事件发布接口，不能导入 app `ToolCenter` concrete class 或地下模块。
- `kernel/intelligence/tool-use-loop.ts` 只能依赖 `IntelligenceChannel` 和 `ToolExecutionBroker` 接口，不能导入 `src/app/tool-center` concrete class；它可以作为 `AgentTurnRuntime` 的低层 helper，但不能成为 rootlet 私有能力。
- `ToolCenter` 负责注册、查询、执行、权限检查、预算检查和失败归一化；工具不存在、未授权、预算耗尽或 executor 抛错都返回 `status: "failed"`，不把 provider 原始异常向上抛。
- `allowedTools` 必须来自 agent manifest / runtime policy；rootlet agent 当前通过 `turnPolicy.allowedTools` / `permissions.execute` 获得工具，固定地下核心 agent 默认 `allowModel = false` 且无工具执行权限。
- `allowModel = false` 的 agent turn 必须由 `AgentTurnRuntime` 返回明确 disabled / skipped 状态，不能偷偷调用 `IntelligenceChannel`。
- `web_search` 默认不联网；没有 Tavily key 或 fetch 时返回 deterministic `no_search_provider`，不得为了演示成功访问未知公共搜索 API。
- Tavily key 可来自环境变量 `AGENTARBOR_TAVILY_API_KEY` / `TAVILY_API_KEY` 或显式注入；普通 settings store、EventLog、Snapshot、summary 和 panel HTTP JSON 不得保存 raw key。
- OpenAI-compatible adapter 必须把 `tools`、`tool_choice`、assistant `tool_calls`、tool result messages 和 provider `tool_calls` 互相映射；外部 LLM SDK 仍禁止。
- tool result 作为 `role: "tool"` message 追加回模型上下文；工具输出必须先清洗、截断和 JSON-safe 化。
- `tool.*` EventLog payload 只记录 call id、tool name、caller agent、duration、safe input/output summary 或 error；不得记录 raw provider response、API key、token、完整 prompt 或 live对象。
- rootlet 工具结果只能进入 rootlet output `sourceRefs` / `evidenceRefs`，再进入 CandidatePool 和 Convergence Judge；不得直接写入 Direction Handoff、Growth Plan、Fruit、Run Memory、Experience Candidate、Capability Asset 或 Soil。
- `maxModelRounds` 和 `maxToolRounds` 必须限制循环轮数；达到上限时调用方走声明的 fallback / failed advice 路径，不能无限继续请求模型或工具。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 工具未注册 | `ToolCallResult.status === "failed"`，EventLog 发布 `tool.failed` |
| `allowedTools` 不包含请求工具 | 工具被拒绝，`ToolCenter.getCallCount()` 不增加 |
| 超过 `maxCallsPerRun` | 工具返回 budget exhausted failure，不继续执行 executor |
| web_search 无 key / 无 fetch | 返回 `no_search_provider`，流程继续 |
| web_search provider HTTP 失败 | 返回 `provider_failed` 输出，ToolCenter 仍视为 completed 工具输出，由模型/调用方判断 |
| 模型返回 tool calls | IntelligenceChannel response validation 通过，tool loop 执行工具并追加 tool message |
| tool loop 超过 `maxToolRounds` | AgentTurnRuntime 返回 `stoppedReason = "max_tool_rounds"`，调用方使用声明 fallback |
| model loop 超过 `maxModelRounds` | AgentTurnRuntime 返回 `stoppedReason = "max_model_rounds"`，不得继续请求模型 |
| `allowModel = false` | AgentTurnRuntime 返回 disabled / skipped 状态，`model.*` 事件计数保持 0 |
| EventLog / Snapshot / summary / panel JSON 出现 API key 或 token | 安全边界失败 |
| rootlet 工具结果绕过 CandidatePool / Convergence Judge | 地下边界测试失败 |

### 5. Good / Base / Bad Cases

- Good：rootlet model response 请求 `web_search`，ToolCenter 发布 `tool.requested -> tool.completed`，tool result 追加为 tool message，下一轮模型输出候选数组，rootlet output source refs 包含 `tool-call:<id>`。
- Good：未授权 rootlet 请求 `web_search` 时得到 failed tool result，模型仍可用失败结果继续，EventLog 有 `tool.failed`。
- Good：`underground-intent-core` 的 turn policy 禁用模型和工具，同步调度不会产生 `model.*` 或 `tool.*` 事件。
- Base：fake provider 默认不返回 tool calls；`--ai fake` 和 no-AI 路径保持原有 deterministic / 单轮行为。
- Base：无 Tavily key 时 `web_search` 返回 `no_search_provider`，不触发真实网络。
- Bad：kernel tool loop 直接 import app `ToolCenter`。
- Bad：把工具 raw output 直接塞进 Direction Handoff options、panel transcript 或 EventLog payload。
- Bad：把 search API key 写入普通 settings 或测试快照。

### 6. Tests Required

- ToolCenter 注册 / 注销 / 查询 / 执行。
- ToolCenter allowedTools 权限拒绝和 maxCallsPerRun。
- web_search Tavily mock 成功路径和无 key `no_search_provider` 路径。
- fake provider tool call fixture。
- OpenAI-compatible adapter tools / tool result / tool_calls 映射。
- `executeToolUseLoop` 一轮工具后完成、max rounds、工具失败不中断。
- `AgentTurnRuntime` 覆盖模型禁用、未授权工具、一轮工具后继续模型、`maxToolRounds`、`maxModelRounds` 和 fallback status。
- Observation metadata 覆盖 `tool.*`，tool refs 不误识别为 model/user clarification refs。
- rootlet AI 调用 web_search 后候选进入 CandidatePool，source/evidence refs 包含 tool call，EventLog 不泄漏 key。
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
