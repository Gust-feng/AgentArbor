# P1: 统一 AgentTurn Runtime 与工具调用运行时

## Goal

修复当前 AgentArbor runtime 的 P1 能力缺口：已有 ToolCenter、`web_search` adapter、模型 tool calls、OpenAI-compatible tool call 映射、`tool.*` EventLog 和 rootlet 内部 `executeToolUseLoop()`，但这些仍是 rootlet invocation 的局部能力。本轮把它升级为地下所有 agent 可复用的统一 `AgentTurnRuntime`，让模型回合、工具回合、tool result 回填、权限检查、预算/轮次限制、fallback 和 EventLog / Observation 记录都通过同一 kernel 入口承载。

地下组织是第一批消费者，但 `AgentTurnRuntime` 不能写成地下私有模块；它必须位于 `kernel/intelligence` 或同级通用运行层，未来地上组织也能复用。

## User Proposed Direction

用户确认的主方向是 `AgentTurnRuntime + ToolCenter 独立边界`：

- 将现有 `executeToolUseLoop()` 演进或包裹为统一 `AgentTurnRuntime`。
- 新增 `AgentTurnPolicy` 或等价契约，表达 `allowModel`、`allowedTools`、`maxModelRounds`、`maxToolRounds`、fallback 行为、`callerAgentId`、`traceId`、`goalId`、`purpose`、`outputContract`、`sensitivity` 和 `budget`。
- 地下固定核心 agent 与动态 rootlet agent 都应能声明自己的 turn policy。
- rootlet 现有 AI + tool 行为必须迁移到统一 runtime，不再保留 rootlet 私有工具循环。
- 暂时不使用 AI 的地下核心 agent，也要通过 policy / manifest 明确模型和工具不可用，避免未来各 agent 私接模型。
- ToolCenter / 工具市场 / 集成中心保持独立模块边界；地下 agent 只能消费 `ToolExecutionBroker` / tool registry / policy 视图。
- MCP、sandbox、浏览器工具、工具市场 UI 暂不实现；不引入 MCP SDK、新 LLM SDK、新包管理器或新测试框架。

## Requirements

- `src/domain/tools/` 保持工具领域契约；`src/app/tool-center/` 保持独立工具中心 / 集成中心雏形。
- 新增或演进 `src/kernel/intelligence/agent-turn-runtime.ts` 统一多轮 agent turn 入口。
- `src/kernel/intelligence/tool-use-loop.ts` 可被 `AgentTurnRuntime` 复用、重命名或收敛，但不能再成为 rootlet 私有能力。
- `AgentTurnRuntime` 只依赖 `IntelligenceChannel`、`ToolExecutionBroker`、领域契约和事件发布接口；不得导入 app `ToolCenter` concrete class 或地下模块。
- `AgentTurnPolicy` 必须能表达模型启用、工具权限、模型轮次上限、工具轮次上限、fallback 策略、调用方身份、trace / goal、输出契约、purpose、sensitivity 和 budget。
- 无模型权限时，runtime 必须返回明确 `skipped` / `disabled` / failed 状态，不能偷偷走 `IntelligenceChannel`。
- 模型返回 tool calls 时，runtime 必须执行受 `allowedTools` 裁剪的工具调用，把 tool result 作为 `role: "tool"` message 回填给模型，再继续模型回合。
- 未授权工具、未注册工具、工具失败或工具预算耗尽都必须形成安全失败结果，并发布 `tool.failed` 或等价安全观测；provider 原始错误、API key、token、完整 prompt 和 raw tool output 不得进入 EventLog / Observation / panel JSON。
- rootlet AI 调用迁移到统一 runtime；工具结果只能进入 rootlet output 的 `sourceRefs` / `evidenceRefs`，再进入 CandidatePool 和 Convergence Judge。
- Direction Handoff、Growth Plan、Fruit、Run Memory、Experience Candidate、Capability Asset 和 Soil 不得直接接收工具 raw output 或模型 raw output。
- `src/app/agents/manifests.ts` 补齐固定地下核心 agent 与动态 rootlet agent 的模型 / 工具权限声明；至少一个非 rootlet 地下核心 agent 必须通过统一 policy 证明模型 / 工具不可用时不会私自调用。
- Observation / demo summary / panel read model 只能展示工具调用计数、状态和 refs；不得展示 raw tool output、search provider raw response、secret、完整 prompt 或 hidden reasoning。
- `.trellis/spec/backend/tool-runtime.md`、`.trellis/spec/backend/intelligence-channel.md`、`.trellis/spec/backend/underground-radial-growth.md` 和 `docs/任务看板/看板.md` 必须同步当前边界。

## Acceptance Criteria

- [ ] `AgentTurnRuntime` 覆盖无模型权限、无工具权限、一轮工具后继续模型、`maxToolRounds`、`maxModelRounds` 和 fallback 行为。
- [ ] Rootlet AI 使用统一 `AgentTurnRuntime`；`web_search` 后候选仍进入 CandidatePool，`tool-call:*` refs 只进入 source/evidence refs。
- [ ] Direction Handoff 不直接接收工具 raw output。
- [ ] 至少一个非 rootlet 地下核心 agent 通过统一 policy 证明模型/工具不可用时不会私自调用。
- [ ] ToolCenter 能注册、注销、查询和执行工具，并覆盖 allowedTools 权限拒绝、调用次数限制和失败归一化。
- [ ] `web_search` 有 key / injected fetch 时可通过 mock 返回结果；无 key / 无 provider 时返回 `no_search_provider` 占位结果。
- [ ] IntelligenceChannel 契约与 fake provider 支持 tool calls / tool result loop 测试。
- [ ] OpenAI-compatible adapter 覆盖 tools、tool result messages 和 provider tool_calls 映射。
- [ ] `tool.requested` / `tool.completed` / `tool.failed` EventLog 与 Observation refs 不分叉。
- [ ] 边界测试证明 kernel 不导入 app `ToolCenter` concrete class，ToolCenter 不依赖 underground 模块。
- [ ] 未配置工具或 `--ai fake` 不返回 tool calls 时，现有 AI / no-AI / deterministic fallback 路径不回归。
- [ ] `pnpm build`、`pnpm test`、`pnpm panel:smoke`、`git diff --check` 通过。

## Definition of Done

- 代码实现、测试、spec、任务看板同步完成。
- `implement.jsonl` / `check.jsonl` 保持相关 spec context。
- 不引入新包管理器、测试框架、外部 LLM SDK、MCP SDK 或浏览器自动化依赖。
- 不把工具能力写成平台适配文件事实源，也不提前创建 `.agentarbor/` 原生运行资产。

## Out of Scope

- 不实现真实 MCP client/server。
- 不实现工具市场 UI。
- 不实现 sandbox 远程执行池。
- 不实现浏览器工具。
- 不改造地上组织。
- 不实现正式长期 Capability Asset 入土；工具是运行时能力，后续再经 Governance 沉淀。
- 不新增 panel 工具配置 UI；本轮可先使用环境变量或组合根显式注入。
- 不让工具调用直接写入 Direction Handoff、Growth Plan、Fruit、Run Memory、Experience Candidate、Capability Asset 或 Soil。

## Technical Approach

- `src/kernel/intelligence/agent-turn-runtime.ts` 保存统一 agent turn runtime、policy、result 与 request 构造入口。
- `src/kernel/intelligence/tool-use-loop.ts` 收敛为 runtime 内部可复用的工具回合 helper，或保留兼容导出但不再由 rootlet 直接调用。
- `src/domain/intelligence/contracts.ts` 继续承载 tools / tool calls / tool messages；provider adapter 只在 `src/adapters/intelligence/` 做协议映射。
- `src/domain/tools/` 保存 `ToolExecutionBroker` 等工具领域接口；`src/app/tool-center/` 保存 concrete registry / executor 和 `web_search` adapter。
- `src/app/underground/cluster/rootlet-agent.ts` 与 `requestUndergroundRootletCandidateAdvice()` 接收 `AgentTurnRuntime` / turn policy，用统一 runtime 完成模型工具回合后再解析最终候选输出。
- `src/app/underground/cluster/agent-context.ts` 注入可选 `agentTurnRuntime` 与 tool broker；地下 agent 只消费 policy / broker，不管理工具生命周期。
- `src/app/agents/manifests.ts` 声明每类地下 agent 的模型 / 工具权限，rootlet 可按 kind 裁剪工具，固定核心 agent 默认模型/工具禁用。
- `src/app/intelligence-channel-factory.ts` 或地下 session 组合根负责创建 ToolCenter 与 AgentTurnRuntime；没有配置时提供空中心或 deterministic no-provider search tool，不触发真实网络。

## Technical Notes

- 当前已有基础 WIP：
  - `src/domain/tools/`
  - `src/app/tool-center/`
  - `src/kernel/intelligence/tool-use-loop.ts`
  - `src/kernel/intelligence/tool-events.ts`
  - `src/domain/intelligence/contracts.ts`
  - `src/adapters/intelligence/*`
  - `src/app/underground-intelligence.ts`
  - `src/app/underground/cluster/*`
  - `src/app/agents/manifests.ts`
- 相关规范：
  - `.trellis/spec/backend/directory-structure.md`
  - `.trellis/spec/backend/intelligence-channel.md`
  - `.trellis/spec/backend/tool-runtime.md`
  - `.trellis/spec/backend/underground-radial-growth.md`
  - `.trellis/spec/backend/observation-read-model.md`
  - `.trellis/spec/backend/quality-guidelines.md`

## Decision (ADR-lite)

**Context**：rootlet 局部 `executeToolUseLoop()` 已能证明模型工具回合，但如果继续让各 agent 自己接 IntelligenceChannel / ToolCenter，会形成多套模型权限、工具权限、fallback 和观测规则。

**Decision**：本轮把模型与工具的多轮执行上升到 `AgentTurnRuntime`，并让地下组织成为第一批消费者。ToolCenter 保持 app 层集成中心边界，kernel 只依赖 `ToolExecutionBroker`。

**Consequences**：本轮不会重写完整地下 Runner 或地上组织，但会引入统一 turn policy，减少后续 agent 私接模型和工具的空间。未来跨地下/地上的完整 AgentTurn scheduler 应在本轮验收后另起任务判断。
