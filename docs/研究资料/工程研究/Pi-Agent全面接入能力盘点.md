# Pi Agent 全面接入能力盘点

## 1. 研究范围与版本基线

本文只记录本机当前可验证的已安装版本，不把上游其他版本、旧版 `pi-coding-agent` 行为或印象当作事实。

- `@earendil-works/pi-agent-core`：`0.80.10`
- `@earendil-works/pi-ai`：`0.80.10`
- 包来源：两个包的 `package.json.repository` 都指向 `earendil-works/pi`，分别位于 `packages/agent` 与 `packages/ai`。
- 本次证据根：
  - `<PI_AGENT>` = `<WORKTREE>\node_modules\@earendil-works\pi-agent-core`
  - `<PI_AI>` = `<WORKTREE>\node_modules\@earendil-works\pi-ai`
- 公开面以 `<PI_AGENT>/package.json`、`<PI_AGENT>/dist/index.d.ts`、`<PI_AGENT>/dist/node.d.ts`、`<PI_AI>/package.json`、`<PI_AI>/dist/index.d.ts` 为准；`.js` 只用于核对声明无法证明的执行顺序和失败语义。

包导出边界有一个重要约束：`@earendil-works/pi-agent-core` 只公开根入口、`./node` 和 `./package.json`。虽然 `dist/harness/**` 文件可读，但生产代码必须从根入口导入公开 symbol，不能依赖未导出的内部子路径。`@earendil-works/pi-ai` 除根入口外公开 `providers/*`、`api/*`、`oauth`、`compat` 等子路径。

## 2. 总结论

### 2.1 建议采用方式

Ordinary 第一阶段应以 `AgentHarness` 为主要 Pi runtime 入口，同时直接采用它公开导出的 `Session`、`SessionRepo`、compaction、branch summarization、`Models` 和 auth 契约。这里的“整体采用”不是把 `AgentHarness` 变成 AgentArbor 业务 feature，而是让它完整承担通用机械能力：模型循环、Pi 消息、工具批次、流式事件、Session 树、队列、模型调用、压缩和分支摘要。

AgentArbor 继续拥有 Ordinary 的 conversation/run 业务状态、ToolCenter、确认、证据、MCP、工作区、能力冻结、事件/read-model 和产品资源生命周期。Pi 类型只停留在中性 runtime adapter 内，不进入 HTTP/Panel 公开契约或 Ordinary 持久化业务状态。

### 2.2 两个关键判断

1. **Pi Session 足以承担回退、分支、分支重试与当前分支上下文构建。** `Session.moveTo()` 改变 active leaf 而不删除旧 entry；随后追加消息自然形成新分支；`Session.getBranch()`/`buildContext()` 只沿当前 leaf 到 root；`SessionRepo.fork()` 可复制为独立 session。内存实验已验证旧分支仍在 `getEntries()` 中、当前 `getBranch()` 只含新分支。
2. **`AgentHarness` 比直接使用 `Agent`/`agentLoop` 更适合作为 Ordinary 的主要机械 runtime，但必须组合公开模块和 AgentArbor adapter。** Harness 已把 `Models`、Session、工具、事件、queue、branch、compaction API 与资源装在一起；同时它没有接管业务 run、MCP、证据、权限或 read-model。自动压缩、附件持久化政策、快速取消收口仍需 adapter 接线。

### 2.3 已报告并获得产品决策的取消边界

当前版本已复现一个协议完整性限制：顺序工具批次中途触发 Pi abort 时，assistant 的多个 tool call 可能只生成前缀 tool result，留下悬空 tool call。用户已经明确决定不修改 Pi，并采用 Claude Code 风格的确认语义：拒绝确认只拒绝当前 tool call，结果交回模型继续，不触发 Pi abort。真正的全局 run cancellation 继续作为独立 adapter conformance，不能与 confirmation denial 混用。

## 3. 可直接复用

### 3.1 Agent 与模型—工具循环

| 能力 | 包与公开 symbol | 可验证事实 | 声明/实现证据 |
| --- | --- | --- | --- |
| 有状态 Agent | `@earendil-works/pi-agent-core`: `Agent` | 维护 transcript、模型、thinking、工具、流状态、steer/follow-up queue；支持 `prompt()`、`continue()`、`abort()`、`waitForIdle()` | `<PI_AGENT>/dist/agent.d.ts`; `<PI_AGENT>/dist/agent.js` |
| 低层循环 | 同包：`agentLoop`、`agentLoopContinue`、`runAgentLoop`、`runAgentLoopContinue` | 明确执行 provider turn、工具、结果回传、steer/follow-up 和终止；`run*` 版本允许 awaited event sink | `<PI_AGENT>/dist/agent-loop.d.ts`; `<PI_AGENT>/dist/agent-loop.js` |
| 完整 Harness | 同包：`AgentHarness` | 组合 `Models`、Session、工具、资源、hook/event、queue、tree navigation 与 compaction API | `<PI_AGENT>/dist/harness/agent-harness.d.ts`; `<PI_AGENT>/dist/harness/agent-harness.js`; 根 `dist/index.d.ts` |
| 错误终态 | `AssistantMessage.stopReason` | 标准终态为 `stop | length | toolUse | error | aborted`；Harness 的 `prompt()` 即使 provider 失败也可能返回 `stopReason: error/aborted` 的 assistant message，调用方必须检查而不能只看 Promise resolve | `<PI_AI>/dist/types.d.ts`; `<PI_AGENT>/dist/harness/agent-harness.js` 的 `emitRunFailure()`/`executeTurn()` |
| 动态下一轮状态 | `AgentLoopTurnUpdate`、`prepareNextTurn` | 低层 loop 可在 turn 后替换 context/model/thinking；Harness 内部用它刷新 Session context、model、thinking 和 active tools | `<PI_AGENT>/dist/types.d.ts`; `<PI_AGENT>/dist/harness/agent-harness.js` 的 `createLoopConfig()` |

优先选择 Harness 而不是直接把 `Agent` 当成 Ordinary facade，原因是 `Agent` 只有内存 transcript；Session、branch、compaction、Models auth 和资源接线需要调用方另行拼装。Harness 已经提供这些公开组合点。

### 3.2 工具校验、执行与事件

| 能力 | 包与公开 symbol | 可验证事实 | 声明/实现证据 |
| --- | --- | --- | --- |
| 工具契约 | `@earendil-works/pi-agent-core`: `AgentTool`、`AgentToolResult` | 工具使用 TypeBox schema、`execute(toolCallId, params, signal, onUpdate)`，结果支持 text/image、details、动态 `addedToolNames`、`terminate` | `<PI_AGENT>/dist/types.d.ts` |
| 参数校验 | `@earendil-works/pi-ai`: `validateToolArguments`；AgentTool 的 `prepareArguments` | 先做可选参数兼容转换，再对 TypeBox schema 校验；未知工具/校验失败成为 error tool result | `<PI_AI>/dist/utils/validation.d.ts`; `<PI_AGENT>/dist/agent-loop.js` 的 `prepareToolCall()` |
| 执行模式 | `ToolExecutionMode`、`AgentTool.executionMode` | 默认并行；parallel 先顺序 preflight，再并发执行；任一调用对应工具标记 `sequential` 时，整个 assistant batch 顺序执行；tool result message 最终按 assistant source order 写入 | `<PI_AGENT>/README.md`; `<PI_AGENT>/dist/types.d.ts`; `<PI_AGENT>/dist/agent-loop.js` |
| 调用前后 hook | `beforeToolCall`/`afterToolCall`；Harness `tool_call`/`tool_result` hook | preflight 在已验证参数后可 block；postprocess 可替换 content/details/isError/terminate | `<PI_AGENT>/dist/types.d.ts`; `<PI_AGENT>/dist/harness/types.d.ts`; `<PI_AGENT>/dist/harness/agent-harness.js` |
| 流式事件 | `AgentEvent`、`AgentHarnessEvent` | 覆盖 agent/turn/message/tool start-update-end，以及 context、provider request/response、save point、settled、tree、queue、配置更新事件 | `<PI_AGENT>/dist/types.d.ts`; `<PI_AGENT>/dist/harness/types.d.ts` |
| 持久化屏障 | `AgentHarness.subscribe()` 与 Session | Harness 在 `message_end` 先写 Session 再通知 subscriber；`turn_end` subscriber 完成后 flush pending session writes；下一次 provider call 前重建 Session context | `<PI_AGENT>/dist/harness/agent-harness.js` 的 `handleAgentEvent()`/`createLoopConfig()` |
| 截断工具调用保护 | 低层 loop 实现 | assistant `stopReason: length` 时不会执行可能被截断的 tool args，而是为调用返回 error tool result | `<PI_AGENT>/dist/agent-loop.js` 的 `failToolCallsFromTruncatedMessage()` |

### 3.3 Queue、steer、follow-up、nextTurn

| 能力 | 包与公开 symbol | 当前精确语义 | 声明/实现证据 |
| --- | --- | --- | --- |
| steer | `Agent.steer()` / `AgentHarness.steer()` | 只允许 active run；当前 assistant 的工具批次全部完成后，下一轮注入 steer 消息。不能抢占正在执行的工具 | `<PI_AGENT>/README.md`; `<PI_AGENT>/dist/agent-loop.js`; `<PI_AGENT>/dist/harness/agent-harness.js` |
| follow-up | `Agent.followUp()` / `AgentHarness.followUp()` | 只允许 active run；当 agent 原本要停止且没有 steer 时注入，并在同一次 loop 中继续 | 同上 |
| queue mode | `QueueMode`、`setSteeringMode()`、`setFollowUpMode()` | `one-at-a-time` 或 `all` | `<PI_AGENT>/dist/types.d.ts`; `<PI_AGENT>/dist/harness/agent-harness.d.ts` |
| nextTurn | `AgentHarness.nextTurn()` | idle/busy 都可入队；不会自行启动 run；下次显式 `prompt()` 时把全部 nextTurn 消息放在新 prompt 前；`abort()` 不清除 nextTurn queue | `<PI_AGENT>/dist/harness/agent-harness.js` 的 `nextTurn()`、`executeTurn()`、`abort()` |

`nextTurn` 不是 AgentArbor 用户输入队列的完整替代。Ordinary 每条用户提交是否形成新 run 是产品业务语义，仍应由 Ordinary feature 决定；Pi queue 只在语义匹配时使用。

### 3.4 Session、回退、分支、fork 与上下文

| 能力 | 包与公开 symbol | 可验证事实 | 声明/实现证据 |
| --- | --- | --- | --- |
| 树条目 | `SessionTreeEntry` 系列 | entry 以 `id/parentId/timestamp` 构成 append-only 树，支持 message、model、thinking、active tools、compaction、branch summary、custom、label、session info 与 leaf marker | `<PI_AGENT>/dist/harness/types.d.ts` |
| 当前叶 | `SessionStorage.getLeafId/setLeafId`、`Session.moveTo()` | active leaf 与历史 entry 分开；`setLeafId` 写 leaf marker，旧 branch entry 不删除 | `<PI_AGENT>/dist/harness/types.d.ts`; `<PI_AGENT>/dist/harness/session/session.js`; `<PI_AGENT>/dist/harness/session/jsonl-storage.js` |
| 回退/重试交互 | `AgentHarness.navigateTree()` | 目标是 user/custom message 时，leaf 回到该消息的 parent，并返回 `editorText`；调用方可编辑后再次 `prompt()`，自然产生新分支 | `<PI_AGENT>/dist/harness/agent-harness.d.ts`; `<PI_AGENT>/dist/harness/agent-harness.js` |
| 当前分支 | `Session.getBranch()` | 只返回指定 entry 或 active leaf 到 root 的路径 | `<PI_AGENT>/dist/harness/session/session.d.ts`; `<PI_AGENT>/dist/harness/session/session.js` |
| 独立 fork | `SessionRepo.fork()`、`JsonlSessionRepo`、`InMemorySessionRepo` | 支持 `position: before | at`；`before` 仅接受 user message 并复制到其 parent；新 session 保留 parent session metadata | `<PI_AGENT>/dist/harness/types.d.ts`; `<PI_AGENT>/dist/harness/session/repo-utils.js`; `<PI_AGENT>/dist/harness/session/jsonl-repo.js` |
| 上下文构建 | `buildSessionContext()`、`Session.buildContext()`、`SessionContextBuildOptions` | 从当前 branch 构建 messages，并恢复 branch 上最后的 model/thinking/active tools；支持额外 entry transform 与 custom-entry projector | `<PI_AGENT>/dist/harness/session/session.d.ts`; `<PI_AGENT>/dist/harness/session/session.js` |
| 持久化实现 | `JsonlSessionStorage`/`JsonlSessionRepo` | JSONL header version 为 3；append entry 与 leaf marker；按 cwd 目录列举；提供 open/list/delete/fork | `<PI_AGENT>/dist/harness/session/jsonl-storage.d.ts`; `<PI_AGENT>/dist/harness/session/jsonl-storage.js`; `<PI_AGENT>/dist/harness/session/jsonl-repo.js` |
| 测试实现 | `InMemorySessionStorage`/`InMemorySessionRepo` | 可做无文件 conformance test | `<PI_AGENT>/dist/harness/session/memory-storage.d.ts`; `<PI_AGENT>/dist/harness/session/memory-repo.d.ts` |

本次内存实验的可验证结果：在 `u1 -> a1 -> u2 -> old-a2` 后移动到 `u2.parentId`，再追加 `u2-retry -> new-a2`，`getBranch()` 只返回 `u1/a1/u2-retry/new-a2`，而 `getEntries()` 同时保留旧 `u2/old-a2`。因此 Session 树满足 Ordinary 的回退、分支重试和旧分支审计基础要求。

### 3.5 Compaction 与 branch summary

| 能力 | 包与公开 symbol | 可验证事实 | 声明/实现证据 |
| --- | --- | --- | --- |
| 阈值与估算 | `estimateContextTokens()`、`shouldCompact()`、`DEFAULT_COMPACTION_SETTINGS` | 优先使用最近 assistant usage，再估算尾部；默认 reserve 16384、keep recent 20000；超过 `contextWindow - reserveTokens` 时应压缩 | `<PI_AGENT>/dist/harness/compaction/compaction.d.ts`; `<PI_AGENT>/dist/harness/compaction/compaction.js` |
| 压缩准备/执行 | `prepareCompaction()`、`compact()`、`generateSummary()` | 选择 retained suffix，支持迭代更新 previous summary、split-turn prefix summary、文件操作详情和 abort | 同上 |
| 上下文替换 | `defaultContextEntryTransform()` | 当前 branch 只使用最后一个 compaction entry、它声明的 retained suffix 及之后条目；旧原文仍保存在 Session tree 中 | `<PI_AGENT>/dist/harness/session/session.js` |
| 工具组切点 | `findCutPoint()` | valid cut point 不选择 toolResult；可以从 assistant 开始保留，因此正常 transcript 中 assistant tool call 与其后 tool results 会一起留在 suffix | `<PI_AGENT>/dist/harness/compaction/compaction.js` 的 `findValidCutPoints()`/`findCutPoint()` |
| 分支摘要 | `collectEntriesForBranchSummary()`、`generateBranchSummary()`、`AgentHarness.navigateTree({summarize:true})` | 可总结离开的 branch，并把 branch summary 作为新路径 entry | `<PI_AGENT>/dist/harness/compaction/branch-summarization.d.ts`; `<PI_AGENT>/dist/harness/agent-harness.js` |

`AgentHarness.compact()` 只允许 idle，并不会自动在每次 provider request 前调用 `shouldCompact()`。但这不是必须重写 Harness 的证据：Harness 的 awaited `turn_end` subscriber、公开的 `prepareCompaction/compact/Session.appendCompaction` 和下一轮前的 `Session.buildContext()` 已形成可组合的自动压缩接点。Ordinary adapter 应只负责触发时机与产品错误映射，不重写 Pi 的切点、摘要或 Session 替换算法。

### 3.6 Provider、模型目录、流式与 reasoning

| 能力 | 包与公开 symbol | 可验证事实 | 声明/实现证据 |
| --- | --- | --- | --- |
| Provider 集合 | `@earendil-works/pi-ai`: `createModels()`、`Models`、`MutableModels` | provider 注册、模型查询、可用模型、refresh、auth、stream/complete 都由 collection 提供 | `<PI_AI>/dist/models.d.ts` |
| 自定义 provider | `createProvider()`、`Provider` | provider 可拥有静态模型、动态 `fetchModels`、auth、model filter 和一个或多个 API stream implementation | `<PI_AI>/dist/models.d.ts` |
| 内置目录 | `@earendil-works/pi-ai/providers/all`: `builtinModels()`、`builtinProviders()`、`getBuiltinModel(s)` | 内置 catalog 是显式子入口，不在 root 隐式加载 | `<PI_AI>/dist/providers/all.d.ts`; `<PI_AI>/README.md` |
| 动态目录存储 | `ModelsStore`、`InMemoryModelsStore` | provider-scoped read/write/delete；AgentArbor 可注入持久实现 | `<PI_AI>/dist/models-store.d.ts` |
| 协议 | `KnownApi`、`Model.api` | 当前公开已知 API 包含 `openai-completions`、`openai-responses`、Azure Responses、Codex Responses、Anthropic、Gemini、Bedrock 等；自定义 string API 也可表示 | `<PI_AI>/dist/types.d.ts` |
| OpenAI-compatible | `createProvider()` + `openAICompletionsApi()`/`openAIResponsesApi()`，或直接 API `stream` | Chat Completions 与 Responses 都有公开 `api/*` 子入口；compat flags 属于 `Model.compat`，未知模型可按协议能力配置，不需要模型名白名单 | `<PI_AI>/dist/api/openai-completions.d.ts`; `<PI_AI>/dist/api/openai-responses.d.ts`; `<PI_AI>/dist/types.d.ts` |
| 流式 | `AssistantMessageEventStream`、`AssistantMessageEvent` | 标准化 text/thinking/toolcall start-delta-end，最终 `done` 或 `error` | `<PI_AI>/dist/types.d.ts`; `<PI_AI>/dist/utils/event-stream.d.ts` |
| reasoning 续接 | `ThinkingContent.thinkingSignature`、`ToolCall.thoughtSignature`、`AssistantMessage.responseId` | OpenAI Responses 会请求 `reasoning.encrypted_content`，把完整 reasoning item 序列化到 signature，并在历史转换时回放；Azure terminal output 可补回 encrypted content | `<PI_AI>/dist/types.d.ts`; `<PI_AI>/dist/api/openai-responses.js`; `<PI_AI>/dist/api/openai-responses-shared.js` |
| 工具搜索/延迟加载 | `ToolResultMessage.addedToolNames`、Responses `supportsToolSearch`、Anthropic tool references | 工具结果可以声明从该 transcript 点开始新增工具；支持的 provider 以原生 tool search/reference 表示 | `<PI_AI>/dist/types.d.ts`; `<PI_AI>/dist/api/openai-responses-shared.js`; `<PI_AI>/dist/api/anthropic-messages.js` |
| usage/cost | `Usage`、`calculateCost()` | 标准化 input/output/cacheRead/cacheWrite/reasoning/total/cost | `<PI_AI>/dist/types.d.ts`; `<PI_AI>/dist/models.d.ts` |

### 3.7 Auth、Credential 与 OAuth

| 能力 | 包与公开 symbol | 可验证事实 | 声明/实现证据 |
| --- | --- | --- | --- |
| 应用持久化端口 | `CredentialStore` | app-owned、按 provider id；唯一写入口是 serialized `modify()`，支持跨进程锁的实现 | `<PI_AI>/dist/auth/types.d.ts`，由 root `dist/index.d.ts` re-export |
| 默认测试实现 | `InMemoryCredentialStore` | provider 内顺序写，非持久化 | `<PI_AI>/dist/auth/credential-store.d.ts` |
| API key | `ApiKeyAuth`、`envApiKeyAuth()` | 可从持久 credential 或环境解析；provider 可自定义 ambient auth | `<PI_AI>/dist/auth/types.d.ts`; `<PI_AI>/dist/auth/helpers.d.ts` |
| OAuth | `OAuthAuth`、`Models.login/logout/getAuth` | provider 自有 login/refresh/toAuth；`Models.getAuth()` 在 credential-store lock 内刷新过期 token | `<PI_AI>/dist/auth/types.d.ts`; `<PI_AI>/dist/models.d.ts`; `<PI_AI>/README.md` 的 OAuth Providers |
| 动态 key | 低层 `AgentOptions.getApiKey` / `AgentLoopConfig.getApiKey` | 每次 LLM call 解析，适合短期 token；使用 Harness 时 `Models.streamSimple()` 已负责 provider auth，不应再建第二个 token owner | `<PI_AGENT>/dist/agent.d.ts`; `<PI_AGENT>/dist/types.d.ts`; `<PI_AGENT>/dist/harness/agent-harness.js` |

`@earendil-works/pi-ai/oauth` 当前只是 coding-agent extension OAuth 的 type-only compatibility 入口，不是新应用的主登录实现；新实现应走 provider-owned `OAuthAuth` + `Models.login()`。

### 3.8 Skills 与 session resources

| 能力 | 包与公开 symbol | 可验证事实 | 声明/实现证据 |
| --- | --- | --- | --- |
| Skill 数据与调用 | `Skill`、`formatSkillInvocation()`、`formatSkillsForSystemPrompt()` | Skill 包含 name/description/content/filePath，可禁止 model invocation；支持显式调用格式 | `<PI_AGENT>/dist/harness/types.d.ts`; `<PI_AGENT>/dist/harness/skills.d.ts`; `<PI_AGENT>/dist/harness/system-prompt.d.ts` |
| Skill loader | `loadSkills()`、`loadSourcedSkills()` | 递归发现 `SKILL.md`，处理 ignore，返回 warning diagnostics；sourced 版本原样保留 app 定义的来源 | `<PI_AGENT>/dist/harness/skills.d.ts` |
| Harness resources | `AgentHarnessResources`、`setResources()` | 当前只包含 prompt templates 与 skills；应用拥有加载/刷新 | `<PI_AGENT>/dist/harness/types.d.ts`; `<PI_AGENT>/dist/harness/agent-harness.d.ts` |
| provider session resource cleanup | `@earendil-works/pi-ai`: `registerSessionResourceCleanup()`、`cleanupSessionResources()` | 清理与 provider session id 绑定的进程内资源；它与 Harness `resources` 不是同一概念 | `<PI_AI>/dist/session-resources.d.ts` |

### 3.9 ExecutionEnv

`@earendil-works/pi-agent-core` 根入口公开 `ExecutionEnv`/`FileSystem`/`Shell` 契约，`@earendil-works/pi-agent-core/node` 公开 `NodeExecutionEnv`。声明分别位于 `<PI_AGENT>/dist/harness/types.d.ts` 与 `<PI_AGENT>/dist/harness/env/nodejs.d.ts`，导出证据是 `<PI_AGENT>/dist/index.d.ts` 和 `<PI_AGENT>/dist/node.d.ts`。

Harness 要求注入 `ExecutionEnv`，但不会自动把 env 的 shell/filesystem 暴露成模型工具。AgentArbor 可提供工作区/Host 适配的 env；不得因为 `NodeExecutionEnv` 现成就额外注册绕过 ToolCenter 的 shell/file tool。

## 4. 需要薄适配

以下适配只做边界接线和事实映射，不得重新实现 Pi loop、Session tree、branch、compaction 或 provider protocol。

### 4.1 `PiModelsAdapter`

- 用 `createModels()` 构建唯一进程级 provider collection。
- 将 AgentArbor 用户配置映射到 `Provider`/`Model`；OpenAI-compatible Chat/Responses 按协议与 compat flags 创建，不按模型名白名单限制工具能力。
- 注入 AgentArbor 持久化 `CredentialStore` 与 `ModelsStore`；不使用第二份 `auth.json` 或第二个模型目录事实源。
- active model、默认 thinking、用户 override 和 run-born capability snapshot 仍由 AgentArbor 冻结，再解析为本轮 Pi `Model`。
- Host 释放会话时调用公开 `cleanupSessionResources(sessionId)`；资源 creator 负责 cleanup。

### 4.2 `PiSessionAdapter`

- 可以实现 `SessionStorage`/`SessionRepo` 接到 AgentArbor `runtimeHome` 和 conversation 生命周期，或在验证后采用 `JsonlSessionRepo`。这是存储接线，不是重写 tree。
- conversation title、pin、delete、当前产品 conversation id 与 run refs 仍是 Ordinary control facts；Pi Session 保存消息树、active leaf、compaction、model/thinking/active-tools entry。
- 旧 AgentArbor 会话按用户决定直接废弃，不做旧 `ordinary-run/v3`/lineage 双读迁移。
- 默认 JSONL 会原样序列化 message；AgentArbor 要求附件字节不持久化，因此 storage adapter 必须在写入边界执行可验证的 ephemeral attachment policy，不能把 base64 image 写进长期 Session。
- Session JSONL 是 append-only，但 parser 只校验 header 和 entry 基础字段；AgentArbor 仍需 runtimeHome 单写者锁、容量/损坏处理和删除时 evidence cleanup。

### 4.3 `PiToolCenterBridge`

- 每个 frozen ToolCenter definition 转成一个 `AgentTool`；名称、description、TypeBox schema、side-effect/执行模式由冻结 catalog 映射。
- `execute()` 只调用一次 ToolCenter，并传递同一个 `AbortSignal`；不得把 Pi 工具 executor 变成绕过 ToolCenter 的第二执行入口。
- ToolCenter 的 `ToolCallResult` 先持久化为 Ordinary canonical 工具事实，再转成 Pi `AgentToolResult`/`tool_result` patch。失败、取消、拒绝、delivery failure、`sourceExecutionStatus`、`doNotBlindlyRetry` 和 evidence ref 必须保留。
- Pi `AgentTool.execute()` 的 thrown error 会被转成 text error 且 details 变为空对象。桥接层不应通过 throw 丢掉已知 ToolCenter 事实；应返回带稳定判别信息的 details，再由 Harness `tool_result` hook 设置 `isError`。
- Pi 支持 per-tool sequential，但 AgentArbor 的 Ordinary 统一把所有 AgentTool 标记为 `executionMode: "parallel"`。同一 assistant batch 并发执行，依赖通过后续模型 turn 表达；AgentArbor 的重复调度器已经删除，只保留不参与排队的执行观察层。

### 4.4 确认与 continuation

- Pi 没有公开的 durable `suspend/resume` token，但 `AgentTool.execute()` 可以在 Promise 内等待 AgentArbor confirmation continuation；Harness run 在后台保持 active，用户决定后同一工具调用继续。
- confirmation 不应通过 `tool_call` hook 抛异常表达暂停。Harness 的 hook 会进入低层 `beforeToolCall`，而 `prepareToolCall()` 会捕获该异常并把它归一为普通 error tool result；这既不是 suspended，也没有可恢复 token。即使 hook 自身可以异步等待，ToolCenter 的执行、确认与 exactly-once owner 仍应统一放在 `AgentTool.execute()` bridge 内。
- `AgentTool.execute()` 等待确认时必须监听同一个 Pi abort signal，取消后释放 waiter，不能留下永不 settle 的 tool Promise。确认被拒绝、取消或决定本轮不再自动请求模型时，可由 `tool_result` hook 返回 `terminate: true`；但 Pi 的精确语义是“该批次所有 finalized result 都为 terminate 时才跳过后续 LLM call”，它不会取消并发 sibling，adapter 不能把它误当成抢占或 durable pause。
- Ordinary feature 仍发布 `approval_required` 业务状态、保存 confirmation fact、校验 matching id 和 exactly-once，并把 approve/deny/guidance 交给 ToolCenter continuation。
- 进程退出后 live Promise 不可恢复时，AgentArbor 按当前契约收口为不可续接/blocked，不能伪造 Pi resume。
- 这一路径必须用真实 approve、deny、cancel、多次决定、重启丢失 continuation 做 conformance；验证失败才算 Pi 必要能力缺失，必须先报告用户，不得擅自改 Pi。

### 4.5 Event projector 与取消

- Harness/Agent events 映射为 Ordinary 自己的 live activity 和 run outcome；不能把 `agent_end` 直接等同业务 completed，必须检查最后 assistant `stopReason`、待确认、工具未知结果和 feature 状态。
- `message_update` 只更新 durable `visibleAssistantText` checkpoint；只有明确 `stop` 且无待处理工具调用才形成正式回答。
- `tool_execution_*` 是 Pi 机械事件；canonical 工具事实仍来自 ToolCenter bridge，不从 UI 文案重建。
- `AgentHarness.abort()` 会先同步触发内部 `AbortController.abort()`，但其 Promise 会等待 `waitForIdle()`。Ordinary cancel command 应先提交自己的取消终态，再异步跟踪 Harness cleanup，不能等待不响应 abort 的 provider/tool Promise。

### 4.6 自动 compaction 接线

- 已核实 Harness 0.80.10 **没有内建 automatic mid-run compaction**：`AgentHarness.compact()` 首先要求 `phase === "idle"`；`createLoopConfig()` 只在 `prepareNextTurn` flush Session 并重建 context，没有调用 `shouldCompact()`、`prepareCompaction()` 或 `compact()`。实现证据是 `<PI_AGENT>/dist/harness/agent-harness.js` 的 `createLoopConfig()` 与 `compact()`。
- 订阅 awaited `turn_end`/save point；基于当前 Session branch 的 `estimateContextTokens()` 与本轮 `model.contextWindow` 调用 `shouldCompact()`。
- 需要压缩时直接组合公开 `prepareCompaction()`、`compact()` 与 `Session.appendCompaction()`；不要在 busy Harness 上调用只允许 idle 的 `AgentHarness.compact()`。
- 下一 provider turn 前 Harness 会执行 `prepareNextTurn -> Session.buildContext()`，因此新 compaction entry 会成为下一请求上下文。
- 保留 AgentArbor 特有的 output reserve、安全余量与 exact tool-call/result set 验证，直到 Pi conformance 证明其默认设置满足现有契约；不要同时保留第二套摘要算法。

### 4.7 附件适配

- Pi 公开 `UserMessage`、`ToolResultMessage` 与 `AgentToolResult` 内容只支持 text/image；`ImageContent` 为 base64 + MIME。
- AgentArbor 原有 file/audio、file-id/file-url、MCP embedded resource 等事实继续由附件 adapter/ToolCenter 拥有。可提取为文本的文件先通过 AgentArbor 读取工具或附件预处理进入文本；image 映射为 Pi `ImageContent`；无法无损表示的 audio/file 不能静默丢弃。
- 是否要让 Pi provider 直接承载 file/audio 是当前版本的能力差异，必须用现有附件矩阵验证；若业务必须保持而 adapter 无法表达，应先报告用户。

### 4.8 Skills 接线

- 可以复用 `Skill` 格式、`loadSourcedSkills()`、显式 `skill()` invocation 和 system-prompt 格式。
- AgentArbor 仍负责 source precedence、启停、stateKey、正文 hash、frozen catalog、allowed-tools 声明、resource index、eval/doctor 和 `skill_read` 权限。
- 用 `setResources()` 把本轮冻结 Skill 投影给 Harness；不能让 Pi loader 在 run 中重新扫描磁盘并扩张已冻结能力。

## 5. 仍归 AgentArbor

| 事实/能力 | owner 理由 | Pi 的角色 |
| --- | --- | --- |
| Ordinary conversation/run lifecycle、completed/blocked/failed/cancelled、confirmation 状态 | 产品业务事实和公开契约 | 提供机械 assistant/tool/abort 结果，Ordinary 映射一次 |
| ToolCenter、权限、命令确认、exactly-once、工具 canonical name | AgentArbor 的可执行世界和治理边界 | `AgentTool` 只做桥接，不注册旁路 executor |
| 完整工具证据、`ToolOutputStore`、`tool-output://` continuation | 审计、容量、完整性与生命周期属于 Host/feature | Pi 只消费有界 preview/ref 文本和 image |
| MCP config/catalog/transport/progress/timeout/task 边界 | 两个 Pi 包没有公开 MCP runtime | MCP 工具经 ToolCenter bridge 暴露为普通 `AgentTool` |
| workspace、进程注册、附件授权、Host cleanup | 桌面产品与 OS 资源所有权 | 可传入自定义 `ExecutionEnv`，但不暴露 Pi shell 旁路工具 |
| capability snapshot、AgentDefinition、run-born model/tools/skills/workspace | 新 run 行为必须冻结，不能被当前全局配置覆盖 | 从 snapshot 构造 Harness turn state |
| Ordinary event、repository、read-model、HTTP/SSE、Panel projection | feature-owned 单向产品投影 | 订阅 Pi events，不让 Pi event 成为公开业务 schema |
| conversation title/pin/delete 与 evidence owner cleanup | 产品控制面与资源生命周期 | Pi Session id/entry id 作为引用 |
| Skill governance 与资源工具 | Pi loader 不包含 AgentArbor 的冻结、hash、状态和资源授权契约 | 复用格式/加载器的机械部分 |
| Multi-Agent 业务方案 | 本轮明确不动，且必须保持独立 feature owner | 未来只复用同一 Pi 底层端口，不设计 manager/child 业务 |

## 6. 未确认/疑似缺口

### 6.1 已复现：Pi abort 可能留下悬空 tool call

**证据。** `<PI_AGENT>/dist/agent-loop.js` 的 `executeToolCallsSequential()` 在每个结果后检查 `signal.aborted` 并 `break`；未为同一 assistant message 中尚未执行的剩余 tool call 合成 cancelled tool result。parallel preflight 也会在 abort 后停止继续准备。

本次用公开 `runAgentLoop()`、`fauxProvider()`、两个 `executionMode: "sequential"` 工具做内存实验：第一个工具内触发 abort。结果为：

```text
assistantCalls = [call-first, call-second]
executedCalls  = [first]
toolResults    = [call-first]
```

这与 AgentArbor “assistant tool call 与全部 tool result 不得拆散、取消后仍要收口工具事实”的现有契约冲突，也可能使下一 provider 请求拒绝孤立 tool call。

**最小复现实验建议。** 固化为 Pi conformance：一个 assistant 同时发出 3 个 sequential tool calls，在第 1/2 个期间分别取消；断言每个 call id 恰好有一个 completed/failed/cancelled result，Session `buildContext()` 不含悬空调用；parallel preflight/执行期间也做同样断言。

**产品决策。** 已向用户报告。用户决定不修改 Pi：confirmation denial 不再触发 abort，而是只为当前 call 形成拒绝结果并让模型继续。真正的 run cancellation 仍必须由 Ordinary adapter 单独验证和收口；不得把不完整 Pi transcript 直接作为下一轮可用上下文，也不得静默重建第二套工具批次状态机。

### 6.2 未确认：外部 confirmation 的完整暂停/恢复契约

公开 API 没有 `suspended`/`resume(token)` 结果；可行路径是 `AgentTool.execute()` 等待 AgentArbor live confirmation Promise。当前代码证明 signal 和 Promise 会贯穿工具执行，但没有证明：approve/deny/cancel、并行批次中多个确认、重复 decision、feature persistence failure、进程重启后 continuation 丢失都满足 AgentArbor exactly-once。

**最小复现实验建议。** ToolCenter fake 在 execute 中返回 `approval_required` continuation；Harness 后台 prompt；分别 approve、deny、guidance、cancel、重复 decision、重启丢 continuation，核对 Session messages、ToolCenter fact、Ordinary status 和执行计数。

若实验失败且不能由薄桥接修正，必须先报告用户；不得直接改 Pi。

### 6.3 已确认的表示限制：file/audio attachment 不在公开 Message 类型中

`<PI_AI>/dist/types.d.ts` 的 user/tool result/agent tool result 内容只有 `TextContent | ImageContent`；没有公开 file/audio block。默认 JSONL Session 还会原样写入 image base64。AgentArbor 当前附件/MCP 能力更宽，不能假定全面接入后自然保留。

**最小复现实验建议。** 按现有 Chat/Responses 矩阵覆盖 user/tool-origin image、inline file、file id/url、wav/mp3 audio、MCP image/audio/file；逐项断言 provider payload、失败域、Session 不落字节和下一轮可继续性。

如确有现有必要场景无法由附件 adapter 表达，应先报告用户，不得扩展 Pi 类型或 provider 实现。

### 6.4 未确认：compaction 对损坏/取消 transcript 的 exact call-id 完整性

正常 loop 生成的 transcript 下，compaction cut point 不从 toolResult 开始，能保留 assistant + results suffix；但 `prepareCompaction()` 没有验证 assistant tool call id 集合与 tool result id 集合一一对应，Session JSONL parser 也只做基础 entry shape 校验。6.1 的取消场景已经能产生不完整 transcript。

**最小复现实验建议。** 构造重复 result、缺失 result、跨 batch 乱序 result、取消半批次、带正文+tool calls 的 assistant，分别运行 `buildContext()` 和 `prepareCompaction()`；必须 fail closed 或输出协议完整上下文。

### 6.5 未确认：Harness branch navigation 是否需要恢复历史 model/tools

`Session.buildContext()` 会派生 branch 上的 model、thinking 和 active tools，但 `AgentHarness.createTurnState()` 当前只取 `context.messages`，Harness 自身继续使用当前字段；`model_update/tools_update` 的 `source` 类型包含 `restore`，当前实现未发现对应恢复路径。

AgentArbor 每个新 run 本来就从当前 capability snapshot 冻结 model/tools，因此这不必成为缺口；但若产品要求“回到旧 branch 同时恢复当时模型/工具集”，需要先做行为决策和 conformance，不能假定 Harness 自动完成。

## 7. Ordinary 第一阶段采用顺序

### 阶段 0：先立 conformance 门

1. 固定 Pi `0.80.10` 精确版本与公开 import smoke test。
2. 建立 Session branch/retry/fork/restart、provider Chat/Responses、tool call/result、confirmation、cancel、attachment、compaction、auth refresh 的 adapter-level conformance。
3. 6.1 风险已经报告并获得决定：Pi 保持不动，confirmation denial 走单 call error result；全局 cancel 单独验证。

### 阶段 1：先接 Pi Models/Auth，不改产品业务状态

1. 用 `createModels()`、provider factories/custom `createProvider()` 替换 Ordinary 的 provider transport。
2. 注入 AgentArbor `CredentialStore`/`ModelsStore` adapter。
3. 验证 OpenAI Responses、OpenAI-compatible Chat、reasoning、streaming、usage、未知模型协议能力和 OAuth refresh。

删除候选（全部消费者迁移且测试通过后）：

- `src/adapters/intelligence/openai-agents-provider-profile.ts` 中与 Pi model/compat 重复的 provider 规则。
- `src/app/model-runtime/model-capability-registry.ts` 中由 Pi model catalog 直接拥有的重复目录事实；AgentArbor capability snapshot/override 仍保留。
- 现有重复 OAuth/token refresh/provider client 构造代码。不得整目录删除 `src/app/model-runtime`，因为 Multi-Agent、Skills 或结构化模型调用仍可能是消费者。

### 阶段 2：采用 Pi Session

1. 一个 Ordinary conversation 绑定一个 Pi Session。
2. conversation control 只保存产品元数据和 Pi session/entry refs。
3. 用 `navigateTree()`/`moveTo()` 替换 lineage rollback，用 `SessionRepo.fork()` 支持独立 fork。
4. 旧会话直接废弃，不双读、不迁移。

删除候选：

- `src/app/ordinary-agent/conversation-control-repository.ts` 中 lineage tree/active lineage/fork 机械数据与算法；产品 title/pin/delete control 保留。
- `src/app/ordinary-agent/state.ts` 中逐 run 重复保存的 `canonicalMessages` 与 lineage 派生字段；run status、工具事实、confirmation、usage、timeline 保留。
- `src/app/ordinary-agent/conversation-projection.ts` 中从 run 重建分支树的逻辑；改为消费 Pi Session refs 的单向产品投影。

### 阶段 3：采用 AgentHarness + ToolCenter bridge

1. 每个 active conversation/runtime 创建受 Ordinary feature 管理的 Harness。
2. 工具 catalog 冻结后映射为 `AgentTool[]`；Sub-Agent 继续作为父 Ordinary 的 ToolCenter/AgentTool 贡献，不创建平行业务 feature。
3. Pi event projector 驱动 Ordinary live activity；ToolCenter 事实仍是唯一执行事实。
4. confirmation/cancel/unknown outcome conformance 全绿后切换生产入口。

删除候选：

- `src/adapters/intelligence/openai-agents-loop.ts`
- `src/adapters/intelligence/openai-agents-input.ts`
- `src/adapters/intelligence/openai-agents-tools.ts`
- `src/adapters/intelligence/openai-agents-confirmation.ts`
- `src/adapters/intelligence/openai-agents-terminal.ts`
- `src/adapters/intelligence/openai-agents-usage.ts`
- 对应只服务旧 SDK 的测试文件。
- `src/app/ordinary-agent/ordered-tool-execution-gateway.ts`，但仅在 Pi scheduling + ToolCenter conformance 已证明现有副作用顺序可接受后删除。

### 阶段 4：采用 Pi compaction/branch summary/resources

1. 通过 awaited turn event 接入自动 compaction。
2. 使用 `navigateTree({ summarize })` 或 branch summarization 模块；摘要是可选模型上下文，不取代审计原文。
3. 将冻结 Skills 投影为 Harness resources，保留 AgentArbor resource reader 和治理。

删除候选：

- `src/app/context-maintenance/loop-context-compaction.ts` 及重复摘要/切点算法；AgentArbor 的触发政策、output reserve、安全余量、call-id conformance 留在薄 adapter 或测试。
- `src/app/panel-server/ordinary-agent-run-resources.ts` 中只为旧 loop 构造 canonical history/provider adapter 的部分；ToolCenter、evidence、workspace、MCP/Skills 装配保留。

### 阶段 5：收口事实源

1. 更新 `CURRENT_RUNTIME_MODE.md`、ADR 和工程指南，使 Pi Session 成为会话树/上下文 owner，Ordinary 只拥有产品 run 事实。
2. 删除长期双轨、旧 import facade 和仅保护旧结构的测试。
3. 运行长会话、多轮工具、重启、分支、确认与附件真实场景后，再宣告重构完成。

## 8. Multi-Agent 的未来底层适配点（本轮不设计业务）

本轮不改变 Multi-Agent 的 manager、TaskBoard、child、synthesis、状态、事件、仓储或 read-model。只记录未来可共用的底层端口：

- 同一 `Models`/CredentialStore/ModelsStore provider 能力。
- 同一 Pi `AgentHarness`/low-level loop 机械执行契约。
- 每个 agent 自有 Pi Session；不能与 Ordinary 共享业务 Session 或 run store。
- 同一 ToolCenter bridge、确认原语、evidence 和 workspace adapter，但权限/预算由各自 feature 冻结。
- 同一 compaction 与 message integrity conformance。

Pi 提供“一个 Agent 如何运行”，未来 Multi-Agent feature 仍决定“创建哪些 Agent、如何协作、何时停止和谁综合”。

## 9. 精炼 conformance checklist

### Session 与上下文

- [ ] 新建、关闭、重启打开同一 Session，当前 leaf 与 branch 不变。
- [ ] 回退到任意 user message，编辑重试生成新 branch；旧 branch 可审计且不进入当前 context。
- [ ] `fork(before/at)` 的边界和 parent metadata 正确。
- [ ] title/pin/delete 与 Pi Session 分离；删除 conversation 同步清理 session 和 evidence owner。
- [ ] image/file/audio 原始字节不进入长期 Session。
- [ ] malformed entry、缺 parent、重复/缺失 tool result 明确失败。

### Loop、工具与确认

- [ ] 无工具 `stop` 才 completed；`length/error/aborted` 不 completed。
- [ ] assistant 文本 + tool calls 保持一条真实消息，工具后继续模型。
- [ ] 每个 tool call id 恰好一个 result；sequential/parallel 取消都不悬空。
- [ ] 同一 assistant batch 的 read、write、MCP visibility control 与 AgentTool 均并行，结果按 source order 回灌。
- [ ] ToolCenter 每个调用恰好执行一次，事实先持久化再回模型。
- [ ] approve/deny/guidance/cancel/重复 decision/continuation lost 都有真实 outcome。
- [ ] oversized success/failure 保留 evidence ref 与可读 continuation。

### Provider/Auth/附件

- [ ] Responses 与 Chat streaming、reasoning、tool ids、usage、cache usage 往返。
- [ ] 同协议恢复保留必要 continuation；跨协议只迁移可移植消息事实。
- [ ] 未知 OpenAI-compatible 模型由协议/compat 驱动，不被名称白名单降级。
- [ ] 未来接入任一 OAuth provider 时，并发 refresh 只有一个 owner；失败保留 credential，登录、取消与退出通过中性认证端口暴露。
- [ ] user/tool-origin image、file、audio 按现有支持矩阵成功或明确失败，不能静默丢失。

### Compaction、队列与生命周期

- [ ] 15–20+ 轮真实任务中 context 不线性无界增长，并为 output 留 reserve。
- [ ] compaction 不拆 tool group，旧原文仍可审计，当前 context 不重新混入已压缩历史。
- [ ] steer/follow-up 的注入点符合产品语义；Ordinary run queue 不误用 nextTurn。
- [ ] cancel 先形成 Ordinary 终态，Pi cleanup 可后台完成；无监听器/stream/provider session 泄漏。
- [ ] `cleanupSessionResources(sessionId)`、Harness run、ExecutionEnv、ToolCenter 和 store 的 creator/closer 明确。

## 10. pi-ai 0.80.10 provider parity 补齐状态

Ordinary 的 AgentHarness/Session provider binding 已可生产使用。普通 Agent 的 `skill_routing` 已通过职责化的无工具模型集合 adapter 接入 Pi，并保留 `IntelligenceChannel` 的事件、校验和 fallback；Multi-Agent 与其他模型式 Skills consumer 仍依赖完整的 `IntelligenceChannel -> ModelProvider` 契约，不能直接无损改接 pi-ai。最小正确架构仍应保留中性的 `IntelligenceChannel` 与 `NativeIntelligenceChannel`，不能让 Multi-Agent 直接依赖 Pi 私有类型。

本轮经用户授权修改 Pi 后，已由仓库 pnpm patch 补齐：

| 原缺口 | 当前处理 |
| --- | --- |
| refusal 被合并为普通文本 | Chat/Responses 统一输出 `provider_refusal` diagnostic，Ordinary 映射为 `model_refusal` 正式失败 |
| Responses 未知 output item 被丢弃 | hosted item 保存到 Pi AssistantMessage metadata，只在同 provider/API/model 下一轮回放 |
| `incomplete_details.reason` 丢失 | 保存 provider status/reason；content filter 与长度截断分别形成可观察失败 |
| transport 固定 streaming | Chat/Responses 支持 `stream:false`，JSON 响应仍合成为统一 Pi event stream |
| MiniMax 累计 delta/reasoning details 不完整 | `compat` 显式启用 suffix 归一，文本 reasoning details 保存并回放 |
| AgentHarness 请求设置不完整 | Ordinary 使用公开 payload hook；Pi adapter 在 hook 后按最终 `payload.stream` 选择 SSE/JSON 控制流 |

仍然停线：

| 剩余缺口 | 影响 |
| --- | --- |
| Context 不表达 URL/file-id/普通 file/audio | 仍依赖这些输入的 consumer 不能无损切换；Ordinary 必须明确返回附件交付失败 |
| transport error 没有统一结构化 cause | 当前可归一常见 network/timeout/status，但不能宣称所有 provider 私有错误都已类型化 |
| 没有 Host 自定义 fetch 注入口 | 依赖 Host fetch 代理或确定性注入的 consumer 不能直接切换 |

推荐选项按架构质量排序：

1. Ordinary 保持当前 Pi owner；已补齐的能力不得在 AgentArbor 再维护第二套状态机。
2. 暂留 Multi-Agent/其他依赖剩余附件或 Host fetch 能力的 consumer 旧 transport，等 Pi 公开契约补齐后再用 characterization tests 一次替换。
3. 新缺口先报告并决定是否继续修改 Pi；不得在 AgentArbor adapter 中复制 provider 状态机。

本结论不要求修改 Multi-Agent 业务状态、事件、仓储或 read-model；停线只针对共享 provider transport 的生产切换。

## 11. 研究边界

- 本轮实现修改了 AgentArbor Ordinary provider binding，但没有改 Multi-Agent 业务闭环。
- 本轮经用户明确授权修改 Pi fork，并通过 AgentArbor pnpm patch 固化最小构建产物；没有发布新的 Pi 版本。
- 本文没有设计 Multi-Agent 业务方案。
- 任何“疑似缺口”都只记录证据和复现实验；必须先报告用户并获得明确决定后才能行动。
