# MCP 与 Skills 能力底座开发书

## 目的

本文用于交给后续开发 agent 执行。它不是新架构宣言，也不是 MCP / Skills 的泛研究报告，而是在当前 AgentArbor 代码现状上，按 SDK 方法论补齐普通 Agent 的外部能力底座闭环。

本轮目标是：

- 保持默认普通 `agent` 主线不变。
- 复用已有 `AgentTurnRuntime`、`ToolCenter`、Confirmation Gate、RunEvent、RuntimeDatabase、Capability Snapshot、Context Ledger。
- 使用官方 SDK / 已有 SDK adapter 处理外部协议细节。
- 让 MCP 和 Skills 成为共享能力底座，而不是新的业务编排层。

完成后可以宣布：默认普通 Agent 第一阶段具备稳定会话、模型工具循环、命令确认、运行投影、持久化、MCP 外部工具接入边界和 Skills 上下文注入边界。但这不等于 deep / 多 Agent / RAG / Governance 已完成。

## 当前项目判断

当前默认运行链已经收敛：

```text
Panel UI
  -> /api/conversations
  -> BasicAgentRunExecutor.start
  -> executeBasicPanelRun
  -> runForPanel
  -> runOrdinaryDesktopForPanel
  -> runDesktopAgentSession
  -> AgentTurnRuntime.executeAutonomous
  -> executeToolUseLoop
```

关键文件：

- `src/app/panel-server/conversation-routes.ts`
- `src/app/basic-agent-runtime/run-executor.ts`
- `src/app/panel-server/run-execution.ts`
- `src/app/panel-server/desktop-agent-execution.ts`
- `src/app/desktop-agent-session.ts`
- `src/kernel/intelligence/agent-turn-runtime.ts`
- `src/kernel/intelligence/tool-use-loop.ts`

普通 Agent 的完成语义已经明确：模型不再请求工具，才正常形成最终回答。工程层只能守权限、预算、命令确认、上下文和失败归一化，不能替模型判断任务是否完成，也不能用安全投影替代模型输出。

当前最近提交集中在普通 Agent 可见语义、工具边界、确认事实、运行恢复和前端状态规则，说明项目已经进入“收敛主干”和“补能力底座”阶段，不适合再引入新的编排框架来重写主链。

## SDK 方法论

AgentArbor 的原则是“内核自研，协议兼容”。

SDK 应承担：

- 协议生命周期。
- 连接、鉴权、transport、session。
- 官方对象与外部服务交互。
- 协议错误和结果的第一层归一化。

AgentArbor 应承担：

- run 出生事实冻结。
- AgentDefinition 与 tool visibility。
- Task Soil 权限裁剪。
- ToolCenter 执行边界。
- Confirmation Gate。
- Run Projection / ToolResultEnvelope。
- RuntimeDatabase 运行持久化。
- Panel read-model。

禁止事项：

- `domain/`、`kernel/` 和普通业务编排层直接导入 MCP SDK、OpenAI SDK、LangChain、LangGraph 或 provider raw 类型。
- 把 SDK 的 raw response、raw content block、transport、client、JSON-RPC payload、provider response 作为领域契约。
- 用 SDK 框架的 agent / workflow / graph 概念替换 AgentArbor 已有 run facts、ToolCenter、Confirmation Gate 和 RuntimeDatabase。

推荐边界：

```text
external protocol / SDK
  -> adapters/*
  -> internal ToolExecutor / ModelResponse / config projection
  -> app capability / policy
  -> AgentTurnRuntime / ToolCenter
  -> run event / runtime database / panel read-model
```

## 不引入 LangChain / LangGraph

当前阶段不建议引入 LangChain 或 LangGraph。

原因：

- 默认普通 Agent 主链已经存在，不需要用新框架重写模型工具循环。
- 项目已有结构测试禁止引入 LangChain 依赖，见 `src/app/runtime-boundaries.test.ts`。
- LangGraph 更适合显式多节点状态图和 deep / 多 Agent 编排，不适合在普通 Agent 第一阶段补 MCP / Skills 底座时介入。
- MCP 与 Skills 现在的问题是能力冻结、暴露、执行、投影、持久化没有完全闭环，不是缺一个编排 DSL。

后续 deep / 多 Agent 项目重启时，可以重新评估 LangGraph。但即使引入，也应放在显式 deep 编排 adapter 或运行策略层，不能反向改写普通 Agent 默认路径。

## MCP 现状

已有基础：

- `package.json` 已有 `@modelcontextprotocol/sdk`。
- `src/adapters/mcp/mcp-client.ts` 已封装 MCP SDK client，支持 stdio / http、`listTools()`、`callTool()`。
- `src/adapters/mcp/mcp-manager.ts` 已能基于 `McpServerSettings` 管理 enabled server、connect、list tools、server status。
- `src/adapters/mcp/mcp-tool-adapter.ts` 已能把 MCP tool 转为内部 `ToolExecutor`。
- `src/app/basic-agent-runtime/builtin-tool-runtime.ts` 已预留 `mcpManager` 输入，并把 MCP executor 注册到 `scope: ["mcp"]`。

已收敛的主干口径：

- `CapabilityCenter` 必须连接已启用且配置完整的 MCP server，并把 discovered tools 安全冻结到 `capabilitySnapshot.toolCatalog.tools` 和 `mcpCatalog[].tools`。
- `RunCapabilityResolution` 中，MCP server 状态仍保留在 `mcpDrafts` 作为能力目录投影；具体 MCP tool 必须像普通工具一样进入 `toolExposures`，再由 `AgentDefinition.toolVisibilityProfile` 裁剪。
- 默认普通 Agent 的 visibility profile 允许 `mcp` scope；这表示默认 Agent 可以使用 MCP，但不表示所有配置过的 MCP server 都会暴露给模型。
- 执行资源重建 `ToolCenter` 时必须基于冻结 snapshot 重建 MCP executor；如果不能从本轮 snapshot 找到工具事实或执行器，就不能把该 MCP tool 视为可执行。

开发结论：

MCP 不需要从零实现协议层。要做的是把已有 SDK adapter 接入 run capability 事实链，同时让默认普通 Agent 可以使用已经启用、连接、发现、冻结并通过后端工具边界的 MCP 工具。

## Skills 现状

已有基础：

- `src/app/skills/skill-loader.ts` 已有 `discoverSkills`、`loadSkillBody`、关键词触发。
- `src/app/skills/skill-state-store.ts` 已有启停状态和 `markUsed`。
- `src/app/panel-server/skill-service.ts` 已能基于冻结 skill catalog 解析触发技能并加载正文。
- `src/app/basic-agent-runtime/context-ledger-items.ts` 已把 skill body 注入 Context Ledger / Context Pack。
- `src/app/desktop-agent-session-events.ts` 已有 `skill.triggered` 运行事件。

未完全闭环：

- `CapabilityCenter` 当前只把 enabled skills 放入 `skillCatalog`，导致 run snapshot 不能表达 disabled skills 的全量管理视图。
- run 创建时冻结的是 skill metadata 和启停状态，不冻结 `SKILL.md` 正文；排队 run 或延迟执行 run 可能按同一 `sourcePath` 读到后来的正文。
- `resolveTriggeredSkillContexts` 对 `markUsed` 使用 fire-and-forget，测试中能观察到调用，但失败不明确。
- Context Ledger / Context Pack 当前主要作为 live run 上下文和 canvas/read-model 投影，不是独立持久化事实表；历史恢复可能保留不了完整 used / omitted / truncated 细节。
- run view 目前能通过 Context Ledger 看到“技能”项，但缺少结构化的本轮 triggered skills 字段。
- `selectTriggeredSkillsWithStrategy("llm")` 当前只是返回所有 enabled skills，不能作为正式 LLM router 能力。

开发结论：

Skills 不需要重写。要做的是把 snapshot 改成全量 skill catalog，并把“本轮触发、注入、使用记录、安全展示”收口成稳定字段和测试。

## RAG 现状与延期

当前代码中有 `research`、`run_memory`、`soil`、`docs`、`packages`、`github` 等信息源口径，但没有完整 RAG 闭环。

本轮不做 RAG，原因：

- RAG 需要独立确定文档 ingest、chunk、embedding、vector store、retrieval policy、引用投影、缓存和权限边界。
- 当前更紧急的是把外部工具和技能上下文接入普通 Agent 的 run facts。
- 过早做 RAG 会扩大存储、索引、权限和 UI 面，压低 MCP / Skills 收敛速度。

后续如做 RAG，应优先使用成熟 SDK / 数据库能力，例如嵌入模型 SDK、PGlite / PostgreSQL + pgvector 或明确的向量库 adapter。不要手写向量数据库或检索协议。

## 本轮开发范围

本轮只做：

- MCP server 状态发现和安全快照。
- MCP discovered tools 进入 run capability catalog；默认普通 Agent 的工具可见 profile 允许 `mcp` scope。
- MCP tools 作为普通 `toolExposures` 进入模型可见集合，再由 snapshot allowedTools、Task Soil 权限、模型工具能力、ToolCenter executable restriction 和确认门继续裁剪。
- MCP tool 执行继续经过 `allowedTools`、ToolCenter 和运行投影；MCP 默认不额外确认，命令工具仍走命令确认。
- Skills snapshot 表达 enabled / disabled 全量技能。
- run 创建后冻结本轮可触发 skill 集合。
- 执行时关键词触发最多 4 个 skill，加载正文注入 Context Ledger。
- 成功注入后记录 `markUsed`。
- run view 展示本轮使用过的 skill 名称、触发原因、运行摘要。

本轮不做：

- RAG。
- Deep / LangGraph / 多 Agent 编排。
- Governance 回流。
- Routines。
- 可见 deep 入口。
- 大规模 UI 重设计。
- 删除 `work_session` / `underground` 兼容代码。

## 实现任务

### 1. 类型与契约

文件：

- `src/domain/config/contracts.ts`
- `src/domain/basic-agent/contracts.ts`
- `src/app/panel-ui/src/contracts/run.ts`

要求：

- `CapabilityMcpCatalogItem` 增加 server runtime status、安全 `errorSummary`、discovered tool projections。
- discovered tool projection 只能包含内部安全字段：name、displayName、description、riskLevel、operationType、requiresConfirmation、visibleResultPolicy、scopes、availability。
- `BasicAgentCapabilitySnapshot.skillCatalog` 改为表达 enabled / disabled 全量 skills。
- `RunCapabilityResolution` 保留 `enabledSkills` 作为本轮可触发技能冻结摘要。
- 增加 `triggeredSkills` 或等价 run view 字段，用于表达实际注入过的技能。
- 不把 skill body、SDK raw result、MCP raw content 放进这些契约。

### 2. MCP snapshot 闭环

文件：

- `src/app/capability-center.ts`
- `src/adapters/mcp/mcp-manager.ts`
- `src/adapters/mcp/mcp-tool-adapter.ts`
- `src/app/basic-agent-runtime/builtin-tool-runtime.ts`

要求：

- enabled 且配置完整的 MCP server 才允许尝试连接。
- 配置缺 `command` / `url` 的 server 标为 `unavailable`，不连接。
- 连接失败只记录安全 `errorSummary`，不能泄漏 env、secret、token、完整 args。
- 成功连接后执行 `listTools`，把 discovered tools 转成内部 tool catalog projection。
- MCP tools 注册 scope 保持 `mcp`，不要挂到 `desktop-basic`。
- 当前默认普通 Agent 允许 MCP，但只暴露已启用、已连接、已发现、已冻结且通过工具边界裁剪的 MCP tools。

建议小重构：

- 把 `createDesktopBasicToolRegistry` 对 concrete `McpManager` 的依赖收窄为内部接口，例如只需要 `getToolsForRegistry(): readonly ToolExecutor[]`。这样 `basic-agent-runtime` 不直接绑定 MCP adapter class。

### 3. MCP run capability 与执行闭环

文件：

- `src/app/capability-policy.ts`
- `src/app/run-tool-boundary.ts`
- `src/app/panel-server/desktop-run-resources.ts`
- `src/app/panel-server/desktop-agent-execution.ts`
- `src/app/tool-center/tool-center.ts`

要求：

- MCP tools 以普通 `toolExposures` 表达，不再只出现在 `mcpDrafts`。
- 默认 AgentDefinition 允许 `mcp` scope；默认 allowedTools 可以包含通过 snapshot 和执行器裁剪的 MCP tools。
- 测试用 AgentDefinition 若显式隐藏 `mcp` scope，MCP read-only tool 也不能进入 allowedTools。
- 执行阶段 ToolCenter 必须只重建 run 创建时冻结的 MCP tools，不能读取当前 MCP 配置扩张已创建 run。
- destructive / external-submit / open-world MCP tool 必须触发 confirmation。
- tool-use-loop 的 `allowedTools` 校验仍是第一执行边界。

重要约束：

如果不能可靠地从冻结 snapshot 重建 MCP executor，不要把 MCP tool 标成 executable。宁可让 policy 暴露后再由 executable restriction 隐藏，也不能执行当前配置里后加的 MCP tool。

### 4. MCP run projection

文件：

- `src/adapters/mcp/mcp-tool-adapter.ts`
- `src/app/safe-projection.ts`
- `src/kernel/tools/tool-result-envelope.ts`

要求：

- MCP output 进入现有 `ToolResultEnvelope`。
- 文本内容按 `visibleResultPolicy.maxPreviewChars` 截断。
- 图片、音频、base64、多模态 payload 默认不进入 UI raw channel；只保留类型、mime、运行摘要或 diagnostic ref。
- MCP error 归一成安全错误，不展示 raw stack、secret、env、完整 command args。

### 5. Skills snapshot 与触发闭环

文件：

- `src/app/capability-center.ts`
- `src/app/capability-policy.ts`
- `src/app/panel-server/skill-service.ts`
- `src/app/desktop-agent-session-events.ts`
- `src/app/basic-agent-runtime/context-ledger-items.ts`
- `src/app/basic-agent-runtime/context-ledger-read-model.ts`

要求：

- `CapabilityCenter` 不再过滤 disabled skills；snapshot 保存全量技能安全元数据。
- `resolveRunCapabilities.enabledSkills` 仍只包含 enabled skills，并且不携带 `sourcePath`。
- `resolveTriggeredSkillContexts` 必须只消费 run snapshot 的 skill catalog，不读取当前 skill state。
- 触发策略固定为 keyword，最多 4 个。
- `selectTriggeredSkillsWithStrategy("llm")` 不进入正式运行能力。
- 触发后加载正文，注入 Context Ledger / Context Pack。
- 正文只进入模型上下文，不进入默认 UI raw 展示。
- 若本轮要宣称“run 事实严格冻结”，需要在 triggered skill 投影中至少记录 `sourcePath`、正文运行摘要或 content hash、loadedAt、truncated 标记；否则只能宣称 metadata 冻结、正文按需读取。
- 成功注入后等待或可靠记录 `markUsed`；失败时不应阻塞模型主循环，但应有安全诊断事件或 warning。
- run view 展示 skill 名称、触发原因和运行摘要，不展示完整 body。

### 6. Context Ledger 运行投影持久化

文件：

- `src/domain/runtime-database/contracts.ts`
- `src/app/panel-server/runtime-records.ts`
- `src/app/panel-server/run-persistence.ts`
- `src/app/basic-agent-runtime/context-ledger-read-model.ts`
- `src/app/panel-server/basic-agent-read-models.ts`

要求：

- 可以新增安全 Context Ledger 投影持久化，但不得保存 raw prompt、完整 skill body、raw tool output、stdout/stderr 或文件正文。
- 最小投影只需要保存 used / omitted / truncated、sourceKind、title、安全 summary、refs、budget、truncation。
- 若本轮开发时间不足，至少在开发书和测试中明确：live run 能展示 Context Ledger，历史恢复只保证安全结果、工具证据和事件，不承诺还原完整技能正文。
- 不得为了恢复方便把 Context Pack 的完整模型消息数组落库。

### 7. 兼容路径隔离

文件：

- `src/app/panel-server/underground-compat-execution.ts`
- `src/app/cognitive-work-session*.ts`
- `src/app/underground/**`
- `src/domain/underground/**`
- `src/app/basic-agent-runtime/work-session.ts`
- `src/app/panel-server/basic-agent-read-models.ts`

要求：

- 不删除这些代码。
- 不让普通 Agent 新增依赖这些文件。
- 补测试证明 `/api/conversations` 默认仍是 `agent`。
- 补测试证明 `work_session_*`、`underground_deep_canvas` 不进入普通执行路径。

## 并行工作树拆分建议

可以并行开 4 个工作树，但写集必须隔离：

1. MCP adapter worker
   - 负责 `src/adapters/mcp/*` 和 adapter 测试。
   - 不改 panel / run executor。

2. Capability worker
   - 负责 `src/domain/config/contracts.ts`、`src/app/capability-center.ts`、`src/app/capability-policy.ts`、对应测试。
   - 不改 UI。

3. Runtime worker
   - 负责 `desktop-run-resources`、ToolRegistry/ToolCenter 重建、run boundary、MCP executable restriction。
   - 不改 adapter SDK 细节。

4. Skills/read-model worker
   - 负责 Skills snapshot、triggered skills 投影、Context Ledger read-model、Panel contract。
   - 不改 MCP。

最后由一个 integration agent 合并并跑全量测试。

## 测试计划

MCP tests：

- disabled server 不进入可执行工具。
- 配置缺 command/url 时 snapshot 标为 unavailable。
- 连接失败只记录安全错误摘要，不泄漏 env、token、完整 args。
- enabled server `listTools` 成功后，snapshot 包含 discovered tool projections。
- 默认普通 Agent 暴露通过冻结事实和执行边界的 `mcp` scope 工具。
- 显式隐藏 `mcp` scope 的测试 Agent 看不到 read-only MCP tool。
- destructive MCP tool 必须触发 confirmation。
- run 创建后，后续 MCP 配置变化不影响已创建 run。
- MCP raw multimodal/base64 payload 不进入默认 UI 投影。

Skills tests：

- disabled skill 不触发，但 snapshot / 管理视图可见。
- enabled skill 被关键词触发后正文进入 Context Pack。
- 触发 skill 后更新 lastUsedAt。
- run view 显示本轮使用 skill 的名称、触发原因和运行摘要。
- run 创建后，后续 skill 启停不影响已创建 run。
- `llm` strategy 不进入正式运行路径。

Regression tests：

- `/api/conversations` 默认路径仍是 `agent`。
- 默认普通 Agent 不会仅因 MCP server 存在于配置中就暴露工具；只有已冻结、可执行并通过默认 `mcp` scope 边界的 MCP tool 才能进入模型可见集合。
- `work_session_*`、`underground_deep_canvas` 不进入普通执行路径。
- `ToolCenter` 仍要求 explicit `allowedTools`。
- `RuntimeDatabase` 不保存 raw prompt、raw provider response、raw tool output、stdout/stderr、secret、skill body。

建议命令：

```powershell
pnpm build
pnpm test
pnpm panel:smoke
git diff --check
```

开发中可先跑：

```powershell
pnpm build:node
node --test dist/adapters/mcp/mcp-client.test.js dist/app/capability-center.test.js dist/app/capability-policy.test.js dist/app/basic-agent-runtime/tool-registry.test.js dist/app/panel-server-skill-service.test.js
```

## 验收标准

必须满足：

- 默认普通 Agent 主循环语义未变化。
- 默认普通 Agent 可以使用符合冻结快照、工具可见性和执行器边界的 MCP。
- MCP 和 Skills 都从 run 创建时冻结事实出发。
- MCP 执行不绕过 `allowedTools`、ToolCenter 和运行投影。
- Skills 正文只按需进入模型上下文，不泄漏到默认 read-model。
- 禁用技能、禁用工具、不可用 MCP server 都能被安全展示或解释。
- 所有新增外部协议对象都停留在 adapter 层。
- 不引入 LangChain、LangGraph 或新的 agent 编排框架。

## 开发 agent 开工顺序

1. 先读 `CURRENT_RUNTIME_MODE.md`、本目录 `02-主循环与AgentDefinition.md`、`03-工具分层与执行边界.md`、`07-兼容路径隔离.md` 和本文。
2. 先补类型与测试草案，不先写运行逻辑。
3. 先让 snapshot 能安全表达全量 MCP/Skills 状态。
4. 再让 policy 能把 MCP tools 当普通 exposure 裁剪。
5. 再让执行资源按 frozen snapshot 重建 executable tools。
6. 最后补 read-model 和 UI contract。

不要从 `.trellis/tasks`、历史 work session 或 underground prototype 推导本轮任务。
