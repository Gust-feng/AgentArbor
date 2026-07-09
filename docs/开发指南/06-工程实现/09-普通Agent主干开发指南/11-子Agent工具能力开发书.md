# 子 Agent 工具能力开发书

## 目的

本文约束 AgentArbor 默认普通 `agent` 的子 Agent（Sub-Agent）工具能力。它不是新编排架构宣言，也不是 deep / Underground 多 Agent 重启，而是在当前普通 Agent 主干上把“可复用专家助手”作为一种工具能力闭环：子 Agent 作为工具被模型自主选择使用，复用普通 Agent 的 ToolCenter、IntelligenceChannel、ToolExecutionBroker 和确认机制，不维护独立任务生命周期，不派生 Plan，不走 `/api/deep/*` 入口。

完成后可以宣布：默认普通 Agent 第一阶段具备稳定的子 Agent 工具底座——内置专家可被发现、可被工具调用、可按确认边界保守调度、可按需动态派生，运行事实通过事件系统记录，输出作为局部材料交回父层模型。但这不等于 deep / Underground / Plan / Governance 已完成，也不替代 Skill 上下文注入。

## 定位与边界

子 Agent 是普通 Agent 的工具能力扩展，不是独立编排流程。

- 子 Agent 是“工具形态的专家助手”：模型在主循环中像调用普通工具一样调用 `call_sub_agent` / `call_sub_agents` / `spawn_sub_agent`，必要时再用 `read_sub_agent_output` 续读长输出；由模型自主判断是否需要专家帮助。
- 子 Agent 不维护独立任务生命周期：它没有独立 Task Soil、不出生独立 run facts、不写 RuntimeDatabase 主 run 表；子 Agent 的执行在父 run 的事件流中留下 `sub_agent.*` 事件和工具结果，并以 `subAgentRuns` read model 提供只读运行复盘。
- 子 Agent 不派生 Plan：它的执行结果作为局部材料回到父层模型，由父层模型决定是否采纳、综合或继续探索。
- 子 Agent 不走 `/api/deep/*` 入口：`/api/deep/*` 仍属于 deep / Underground 兼容路径，与子 Agent 工具无关；普通 `agent` 调用子 Agent 走的是普通工具执行路径。
- 子 Agent 运行视图不是 deep run tree：它只服务默认普通 Agent 的子 Agent 工具，展示模型交换、内部工具事实和诊断字段，不提供重试、续跑或独立控制。

与 deep / Underground 多 Agent 架构的区别：

| 维度 | 子 Agent（本文） | deep / Underground |
| --- | --- | --- |
| 形态 | 普通工具（`desktop-basic` scope） | 独立编排流程 |
| 生命周期 | 无独立任务生命周期，随父 run 结束 | 独立 work session、独立 Plan |
| 入口 | 模型工具调用 | `/api/deep/*`、显式深入模式 |
| 派生 | 仅 `spawn_sub_agent` 动态派生一次性实例 | 动态派生 child/rootlet agent、多路探索 |
| 输出语义 | 局部材料，父层模型决定如何使用 | 父层综合、裁决、形成 Plan |
| 当前状态 | 默认普通 Agent 已具备 | 长期能力边界，当前不做默认入口 |

子 Agent 工具复用普通 Agent 的能力底座：

- `ToolCenter`：子 Agent 的工具执行经过父 run 的 `ToolCenter`，工具注册、`allowedTools` 校验、executable restriction 和运行投影都沿用普通 Agent 主干；子 Agent 默认继承父 run 已解析的 `allowedTools`，若子 Agent 定义声明 `allowed-tools`，则实际工具集合为父 run 工具权限与该声明的交集，并始终强制排除子 Agent 派生工具。
- `IntelligenceChannel`：子 Agent 的模型调用复用父 Agent 的 `IntelligenceChannel`，不另起模型接入层。
- `ToolExecutionBroker`：子 Agent 内部若再调用工具，仍经过父层 `ToolExecutionBroker`（即 `ToolCenter`），命令类工具仍走命令确认。
- 确认机制：子 Agent 调用工具的确认策略继承父 run 的 `toolConfirmationPolicy`；子 Agent 工具本身（`call_sub_agent` 等）默认 `requiresConfirmation: false`，不额外触发确认。若子 Agent 内部工具触发确认，该 pending confirmation 会冒泡为父 run 的 pending confirmation，用户可见、可批准/拒绝/补充指引。
- RuntimeDatabase：子 Agent 的复盘 trace 写入父 run 目录下的 `sub-agent-runs.jsonl`，刷新或重启后继续作为 `workView.subAgentRuns` 展示。

## 子 Agent 定义格式

子 Agent 采用与 Skill 一致的 Markdown + YAML frontmatter 格式，定义文件名为 `SUB_AGENT.md`。

目录结构：

```text
<root>/
  <sub-agent-name>/
    SUB_AGENT.md
```

要求：

- `<sub-agent-name>` 目录名建议与 frontmatter 的 `name` 完全一致，使用小写字母、数字和连字符。
- `SUB_AGENT.md` 是唯一事实源；当前不支持 `references/`、`scripts/`、`assets/`、`evals/` 等子目录（这些属于 Skill 体系，不适用于子 Agent）。
- frontmatter 使用标准 YAML parser 解析，支持多行字符串、flow mapping、锚点/alias 和 merge。非法 YAML 不让发现流程崩溃，而是形成 `loadError` 与 `validationErrors`，并强制 `enabled: false`。
- 正文是子 Agent 的行为指令：runner 会读取 `SUB_AGENT.md` 的 body，叠加任务描述、额外上下文和执行要求，组成子 Agent 的运行指令。

frontmatter 字段：

| 字段 | YAML 别名 | 是否必填 | 说明 |
| --- | --- | --- | --- |
| `name` | — | 是 | 子 Agent 名称，1-64 字符；用于工具调用的 `sub_agent_name` 匹配（大小写不敏感）。 |
| `description` | — | 是 | 子 Agent 角色与用途说明，1-1024 字符；进入 capability snapshot 安全投影。 |
| `enabled` | — | 否（默认 `true`） | 是否启用；校验失败的子 Agent 强制为 `false`。 |
| `category` | — | 否 | 分类标签，例如 `development`、`documentation`、`research`、`review`、`testing`。 |
| `version` | — | 否 | 包版本；进入冻结 catalog。 |
| `whenToUse` | `when-to-use` | 否 | 字符串数组，说明适用场景；进入冻结 catalog 供模型选择参考。 |
| `whenNotToUse` | `when-not-to-use` | 否 | 字符串数组，说明不适用场景。 |
| `allowedTools` | `allowed-tools` | 否 | 字符串数组，作为子 Agent 的额外工具收敛声明。为空或省略时继承父 run 工具权限；非空时实际工具集合为父 run `allowedTools` 与该声明的交集，并强制排除 `call_sub_agent` / `call_sub_agents` / `spawn_sub_agent` / `read_sub_agent_output`。 |
| `model` | — | 否 | 指定模型名称；当前实现复用父 Agent 的 `IntelligenceChannel`，该字段进入冻结 catalog 作为意图声明。 |
| `maxSteps` | `max-steps` | 否 | 正整数，子 Agent 的最大模型/工具轮数上限；省略时使用默认值 30。 |

校验规则（见 `src/app/sub-agents/sub-agent-validation.ts`）：

- `name` 缺失或长度超过 64 → 校验失败。
- `description` 缺失或长度超过 1024 → 校验失败。
- `maxSteps` 存在但非正整数 → 校验失败。
- 校验失败的子 Agent 仍出现在 discovery 列表中，但 `enabled: false` 且带有 `loadError` / `validationErrors`，模型无法调用。

最小示例：

```markdown
---
name: "code-expert"
description: "代码专家。负责代码编写、重构、性能优化和调试。"
enabled: true
category: "development"
version: "1.0.0"
whenToUse:
  - "需要编写或修改大量代码时"
  - "需要进行代码重构或架构调整时"
whenNotToUse:
  - "只是简单的问答或信息查询时"
maxSteps: 50
---

# 代码专家

你是一位资深软件工程师，擅长编写高质量、可维护的代码。

## 工作原则

1. 先理解，后动手。
2. 遵循项目规范。
3. 方案先行，自我检查。
```

## 三级发现机制

子 Agent 采用与 Skill 一致的三级发现，按 precedence 决定同 id/name 冲突时的胜出方。

| 来源 | sourceKind | 默认路径 | precedence | 说明 |
| --- | --- | --- | --- | --- |
| builtin（内置） | `builtin` | `src/app/sub-agents/builtin/` | 1 | 随产品分发，不可被用户直接修改。 |
| user（用户级） | `user` | `~/.agents/sub-agents/` | 10 | 个人跨项目复用。 |
| project（项目级） | `project` | `<workspace>/.agents/sub-agents/` | 100 | 当前仓库/工作目录共享，优先级最高。 |

优先级：`project > user > builtin`。同 id 或同 name 的子 Agent 在发现阶段按 precedence 排序后去重，胜出方进入 catalog，其余被静默丢弃（不 merge）。

宿主可通过 `PanelServerOptions.additionalSubAgentRoots` 显式追加 `admin`、`plugin` 或其他受管来源；追加 root 会保留默认三级发现，并把 `sourceKind/sourceRootId/sourcePrecedence` 写入冻结 catalog。`PanelServerOptions.subAgentRoots` 仍是完整覆盖入口，主要用于测试或自定义宿主。

发现与去重规则（见 `src/app/sub-agents/sub-agent-loader.ts`）：

- 每个发现 root 下的直接子目录被视为一个子 Agent 包，包内必须有 `SUB_AGENT.md`。
- 缺失 `SUB_AGENT.md` 或读取失败的包，会被标记为 invalid 子 Agent（`enabled: false`、带 `loadError`），不会让发现流程崩溃。
- 去重先按 precedence 降序排序，再按 `id` 与 `name`（小写归一化）去重；同 id 或同 name 的低 precedence 实例被丢弃。
- `sourceRootId`、`sourcePrecedence` 进入冻结 catalog 与 run capability 投影，但 `sourcePath` 不进入模型可见字段。

`SubAgentRegistry` 在首次 `list()` 时缓存发现结果，后续 `getById` / `getByName` 走缓存；`invalidate()` 可强制重新发现。普通 run 创建时冻结的子 Agent catalog 来自当前发现结果，run 创建后的子 Agent 文件变更不影响已创建 run。

## 四个工具

子 Agent 通过四个工具暴露给模型，工具定义见 `src/app/sub-agents/sub-agent-tools.ts`。`call_sub_agent` / `call_sub_agents` / `spawn_sub_agent` 注册到 `desktop-basic` scope，`riskLevel: medium`、`operationType: read-write`、`requiresConfirmation: false`、`visibleResultPolicy: summary-only`。`read_sub_agent_output` 是只读续读工具，`riskLevel: low`、`operationType: read-only`、`requiresConfirmation: false`。

### 1. `call_sub_agent`

调用单个子 Agent 执行任务。

输入：

- `sub_agent_name`（必填）：子 Agent 名称，大小写不敏感。
- `task`（必填）：任务描述。
- `context`（可选）：额外上下文。

行为：

- 通过 `SubAgentRegistry.getByName` 解析子 Agent；不存在时抛 `Sub-agent not found`。
- `enabled: false` 时抛 `Sub-agent is disabled`。
- 调用 `runSubAgent` 执行，返回 `status` / `summary` / `full_output` / `full_output_chars` / `full_output_ref` / `continuation` / `tool_calls` / `model_rounds` / `duration_ms` / `run_id` / `error`。
- `full_output_ref` 形如 `sub-agent-output:<run_id>`；`continuation.nextInput` 可直接传给 `read_sub_agent_output`，用于 transport 截断后继续读取。

### 2. `call_sub_agents`

调用多个子 Agent，全部完成或遇到内部工具确认暂停后返回汇总结果。

输入：

- `tasks`（必填）：数组，每个元素包含 `sub_agent_name`、`task` 和可选 `context`。数组不能为空。
- `max_concurrency`（可选）：最大并发数，默认 3，上限 10。

行为：

- 预解析所有任务涉及的子 Agent，任意一个不存在或禁用则整体失败。
- 生成 `batchId`，发布 `sub_agent_batch.started` 事件。
- 当前实现采用确认安全优先的保守调度：逐个执行任务；任一子 Agent 触发确认时停止后续未启动任务，已完成结果保留到事件流，父 run 等待该确认。
- 全部完成或因确认暂停时按原始顺序汇总已完成结果，发布 `sub_agent_batch.completed` 事件。
- 返回 `results` 数组与 `stats`（total / completed / failed / cancelled / approval_required / not_started / total_duration_ms / max_concurrency）。
- 整体 `status`：存在失败、取消、等待确认或未启动任务时为 `partial_failure`，否则 `completed`。

### 3. `spawn_sub_agent`

动态派生一次性定制子 Agent。仅顶层普通 Agent 可用（通过 `includeSpawnTool: true` 注册），子 Agent 不能递归派生子 Agent。

输入：

- `role`（必填）：角色描述，例如“数据库迁移专家”。
- `instructions`（必填）：定制行为指令。
- `task`（必填）：任务描述。
- `allowed_tools`（可选）：临时子 Agent 的额外工具收敛声明。为空或省略时继承父 run 工具权限；非空时实际工具集合为父 run `allowedTools` 与该声明的交集，并强制排除 `call_sub_agent` / `call_sub_agents` / `spawn_sub_agent` / `read_sub_agent_output`。
- `context`（可选）：额外上下文。

行为：

- 构造 `sourceKind: "custom"`、`sourcePrecedence: 999` 的临时 `SubAgentDefinition`，`id` 形如 `spawned-<temp>`，`instructions` 作为临时子 Agent 的行为指令正文。
- 不写入任何 root，不进入下一次发现的 catalog；仅在本次调用内有效。
- 调用 `runSubAgent` 执行，返回与 `call_sub_agent` 一致的结果字段，额外返回 `spawned_role` 与 `spawned_id`。

### 4. `read_sub_agent_output`

按字符范围读取当前父 run 内某个子 Agent 的完整输出。它不是新的子 Agent 调度入口，只是 `call_sub_agent` / `call_sub_agents` / `spawn_sub_agent` 长输出的续读工具。

输入：

- `sub_run_id`（必填）：子 Agent 结果中的 `run_id`，或 `continuation.nextInput.sub_run_id`。
- `start_char`（可选）：从完整输出的第几个字符开始读取，默认 0。
- `max_chars`（可选）：最多读取字符数，默认 100000，运行时上限 120000。

行为：

- 只读取 `parentRunId` 等于当前父 run `goalId` 的 trace；跨 run 的 `sub_run_id` 会失败。
- 输出 `content`、`start_char`、`end_char`、`total_chars`、`has_more_after`。
- `has_more_after: true` 时返回新的 `continuation.nextInput`，父模型可继续调用本工具读取后续片段。
- 该工具不读取普通文件、命令日志、网页内容或 deep child 输出。

## 运行时集成机制

子 Agent 工具的注册分两个阶段：CapabilityCenter 阶段注册 stub 工具定义，运行时阶段在 `prepareDesktopAgentLoop` 中动态注册真实 executor。

### CapabilityCenter 阶段（stub 注册）

文件：`src/app/basic-agent-runtime/builtin-tool-runtime.ts`、`src/app/capability-center.ts`。

- `createDesktopBasicToolRegistry` 收到 `subAgentRegistry` 时，调用 `getSubAgentToolDefinitions({ includeSpawnTool: true })` 获取四个工具定义。
- 为每个工具定义注册一个 stub executor，其 `execute` 直接抛 `"Sub-agent tools not initialized in current runtime context."`。
- stub executor 注册到 `desktop-basic` scope，`enabledByDefault: true`。
- 目的：让 capability snapshot 的 `toolCatalog` 中可见子 Agent 工具，让模型在工具可见集合中看到它们；同时 stub 不会真正执行，避免在 snapshot 阶段引入 channel / toolBroker / eventLog 依赖。
- `CapabilityCenter` 同时调用 `listSubAgents()` 把发现到的子 Agent 安全元数据冻结到 `capabilitySnapshot.subAgentCatalog`（id、name、description、category、sourceKind、sourceRootId、sourcePrecedence、enabled、version、whenToUse、whenNotToUse、allowedTools、model、maxSteps、contentHash、bodyHash）。

### 运行时阶段（真实 executor 注册）

文件：`src/app/desktop-agent-loop-preparation.ts`。

- `prepareDesktopAgentLoop` 在创建 `toolCenter` 后，若 `options.subAgentRoots` 已提供且 `toolCenter.register` 可用：
  1. 构造一个 `SubAgentRegistry`（基于 `subAgentRoots`）。
  2. 调用 `createSubAgentToolExecutors` 注入 `subAgentRegistry`、`channel`（父 Agent 的 `IntelligenceChannel`）、`toolBroker`（即 `toolCenter` 自身）、父 run `allowedTools` 读取闭包、父 run `toolConfirmationPolicy`、父 run `publishToolEvent`、`traceSink` / `traceReader`（`runtime.subAgentRunTraceStore`）、`eventLog`（`runtime.eventLog`）、`includeSpawnTool: true`。
  3. 对每个真实 executor 调用 `toolCenter.register(executor)`。

### stub → 真实 executor 的替换

- `ToolCenter.register()` 对同名工具采用覆盖语义：运行时注册的真实 executor 会覆盖 CapabilityCenter 阶段注册的 stub。
- 替换只发生在 run 创建后的执行资源重建阶段；capability snapshot 中冻结的工具定义本身不变。
- 若某个 run 没有提供 `subAgentRoots`（例如测试用最小 runtime），stub 不会被替换，模型即使看到工具定义也无法真正调用——调用会抛 stub 错误。这是预期行为：测试若要验证子 Agent 调用，必须显式提供 `subAgentRoots` 或注入真实 executor。

## 5 个内置专家

内置子 Agent 随产品分发，位于 `src/app/sub-agents/builtin/`，`sourceKind: "builtin"`、`sourcePrecedence: 1`。用户和项目级同名子 Agent 可覆盖它们。

| name | category | maxSteps | 用途 |
| --- | --- | --- | --- |
| `code-expert` | development | 50 | 代码编写、重构、性能优化、复杂调试。 |
| `doc-expert` | documentation | 30 | 编写技术文档、README、代码注释、API 文档。 |
| `research-expert` | research | 40 | 技术调研、信息收集、方案对比、可行性分析。 |
| `review-expert` | review | 30 | 代码审查、方案评审、安全检查、交付质量把关。 |
| `test-expert` | testing | 40 | 编写单元/集成测试、运行测试、分析测试失败。 |

内置专家的正文是其行为指令，描述角色定位、擅长领域、工作原则和输出风格。修改内置专家属于产品基线变更，应通过正式提交，不能通过 `.agents/sub-agents/` 的覆盖机制静默改写产品行为。

## 事件系统

子 Agent 执行通过 `runtime.eventLog.append()` 发布事件，事件类型与 payload 见 `src/app/sub-agents/sub-agent-events.ts`。

| 事件类型 | intent | 触发时机 | 关键字段 |
| --- | --- | --- | --- |
| `sub_agent.started` | `start_sub_agent` | `runSubAgent` 开始执行 | `runId`、`subRunId`、`subAgentId`、`subAgentName`、`task`、`parentRunId` |
| `sub_agent.completed` | `complete_sub_agent` | `runSubAgent` 执行结束（含等待确认/失败/取消） | `status`、`summary`、`toolCalls`、`modelRounds`、`durationMs` |
| `sub_agent_batch.started` | `start_sub_agent_batch` | `call_sub_agents` 开始批次 | `batchId`、`tasks`、`totalCount`、`maxConcurrency` |
| `sub_agent_batch.completed` | `complete_sub_agent_batch` | `call_sub_agents` 全部结束或因确认暂停 | `batchId`、`results`、`successCount`、`failedCount`、`totalDurationMs` |

事件规则：

- 事件 `from.id` 默认为 `"sub-agent-runner"`，`to.role` 为 `"runtime"`，`traceId` 沿用父 run。
- `sub_agent.started` / `sub_agent.completed` 在 `runSubAgent` 内部发布，因此 `call_sub_agent`、`call_sub_agents` 的每个子任务、`spawn_sub_agent` 都会成对产生。
- `sub_agent_batch.*` 仅在 `call_sub_agents` 工具执行时产生，`call_sub_agent` 与 `spawn_sub_agent` 不产生 batch 事件。
- 事件可见性为 `expanded`，transcript 中默认折叠（`defaultCollapsed: true`），UI 可按需展开。
- `safeSubAgent*Projection` 会对 `task` / `summary` 做长度截断（started 500 字符、completed 1000 字符、batch tasks 200 字符、batch results 500 字符），避免事件流被超长文本撑爆。
- `eventLog` 是可选依赖：若运行时未注入 `eventLog`，子 Agent 仍可执行，只是不发布事件；这是为了支持最小测试 runtime。

## 工程约束

- 子 Agent 工具注册到 `desktop-basic` scope，不挂到 `mcp` 或其他 scope。
- 子 Agent 工具权限策略为父 run 权限上限下的声明式收敛：runner 先使用父 run 最终 `allowedTools`，再与 `SUB_AGENT.md` 的 `allowed-tools` 或 `spawn_sub_agent.allowed_tools` 取交集；声明为空时不额外收敛；无论声明如何，始终强制排除 `call_sub_agent` / `call_sub_agents` / `spawn_sub_agent` / `read_sub_agent_output`，且 `policyOverrides` 不能重新打开这些递归工具。
- 子 Agent 执行使用独立的 `AgentTurnRuntime` 实例（`new AgentTurnRuntime({ intelligenceChannel, toolCenter, publishToolEvent })`），但复用父 Agent 的 `IntelligenceChannel` 与 `ToolExecutionBroker`（即父 `ToolCenter`）；子 Agent 不另起模型接入层，不另起工具注册表。
- 子 Agent 的 turn policy：`allowModel: true`、`fallback: "disabled"`、`purpose: "desktop_agent"`、`sensitivity: "internal"`、`outputContract: sub_agent.free_text.v1`（`explanation` + `text`）；`maxModelRounds` 与 `maxToolRounds` 均取 `maxSteps`（默认 30）。
- 子 Agent 不能递归派生：`spawn_sub_agent` 仅注册到顶层普通 Agent（`includeSpawnTool: true` 在 `prepareDesktopAgentLoop` 与 `builtin-tool-runtime.ts` 中显式传入），子 Agent 的 turn policy 不包含 `call_sub_agent` / `call_sub_agents` / `spawn_sub_agent` / `read_sub_agent_output` 工具，因此子 Agent 内部无法再调用、派生或读取其他子 Agent 输出。
- 子 Agent 输出是局部材料：`SubAgentCallResult.summary` / `fullOutput` 作为工具结果回到父层模型上下文，由父层模型决定如何使用、是否采纳、是否综合；子 Agent 不直接写 RuntimeDatabase 主 run 表，不修改 Task Soil，不触发 Governance 回流。
- 子 Agent 调用工具的 `visibleResultPolicy` 为 `summary-only` 且 `omitRawOutput: true`：默认 UI 投影只展示摘要，不展示完整 `full_output`；`maxPreviewChars` 单调用 1200、批量 1600。这与普通 Agent“不削弱模型能力”原则不冲突——完整输出仍作为 tool result 进入模型上下文供 continuation 使用，只是默认 UI 不展示原文。若 transport 预算截断，`full_output_ref` / `continuation` 指向 `read_sub_agent_output`，父模型可以继续读取。
- 子 Agent 调用的命令类工具仍走父 run 的命令确认策略；子 Agent 工具本身不额外触发确认。内部工具触发确认时，`SubAgentRunner` 返回 `approval_required` 与 `pendingApproval`，子 Agent 工具 executor 将其转成父工具调用的 `approval_required`，父 run 进入既有 `confirmation_needed` 流程；approve 后恢复同一个子 Agent pending turn，deny/guidance 走父 run 现有确认决策路径。
- 子 Agent 的 `model` 字段当前作为意图声明进入冻结 catalog；实际模型调用复用父 Agent 的 `IntelligenceChannel` 与 `activeModel`，子 Agent 不自行选择 provider 或模型实例。

## 子 Agent 运行视图与 trace

子 Agent 运行视图是普通 Agent work view 的只读调试投影，不是新的执行入口。

数据流：

1. `SubAgentRunner` 为每次调用创建 `SubAgentRunTrace`，记录 `parentRunId`、父工具调用 `parentToolCallId`、`subRunId`、`batchId` / `batchIndex`、子 Agent 名称、任务、上下文、状态、时间、模型轮次、工具次数、摘要和错误。
2. runner 包装 `IntelligenceChannel`，按轮记录模型 request messages 与 response 文本、工具请求、失败类型、失败消息、usage、requestId / responseId。
3. runner 观察内部工具事件和 turn tool call 结果，记录工具 name、input、status、duration、confirmation、display、envelope、errorFacts。
4. runtime 内存 trace store 汇总本轮 `subAgentRuns`；run persistence 在保存父 run snapshot 时调用 `replaceSubAgentRuns` 写入 `sub-agent-runs.jsonl`。
5. live read model 从 runtime trace store 读取 `subAgentRuns`；persisted read model 从 RuntimeDatabase snapshot 读取 `subAgentRuns`。
6. transcript 中 `sub_agent.*` 事件形成 `kind: "sub_agent"` 的 activity node；UI 用 `subAgentRunId` / `subAgentBatchId` 关联到 `subAgentRuns`，渲染内联卡片和右侧详情抽屉。

保存边界：

- 保存模型可见 messages、模型输出文本、工具请求、失败信息、usage 和工具事实投影。
- 保存工具结果时复用现有模型可见 / 用户可见投影，不额外保存 raw stdout / stderr 全量。
- 命令长输出仍通过既有 `logRef` / `logPath` 机制查看。
- 不保存 provider 原始 HTTP JSON，不把 trace 当作 provider 级审计日志。

UI 行为：

- `call_sub_agent` / `spawn_sub_agent` 在对话活动流里显示单个子 Agent 内联卡片，展示名称、任务摘要、状态、耗时、模型轮次、工具次数和最终摘要。
- `call_sub_agents` 显示批次卡片，展示总数、成功、失败、等待确认、未启动统计，并允许在详情抽屉中切换同批次子运行。
- 点击卡片打开右侧详情抽屉，包含概览、输入输出、工具、诊断四组只读信息。
- 子 Agent 内部工具确认仍使用父 run 的确认卡；详情抽屉只标注等待父 run 确认，不新增子 Agent 级 approve / deny 控制。
- 老 run 没有 `sub-agent-runs.jsonl` 时，UI 必须回退显示原有普通工具节点，不得因为缺失 `subAgentRuns` 崩溃。

## 当前不做

- 不做子 Agent 级独立任务生命周期、独立 Task Soil、独立 RuntimeDatabase 主 run 表。
- 不做子 Agent 递归派生（`spawn_sub_agent` 不下放给子 Agent）。
- 不做子 Agent 级免确认授权或 `allowed-tools` 全局白名单语义；`allowed-tools` 只能在父 run 已授权工具集合内做额外收敛，不能扩张权限，也不能绕过确认。
- 不做子 Agent 自动触发或自动选择；子 Agent 是否被调用完全由父层模型自主决定。
- 不做子 Agent 长期记忆、RAG、向量检索或经验回流。
- 不做子 Agent 跨 run 持久化状态；每次调用都是无状态的一次性执行。
- 不把子 Agent 输出自动提升为正式回答；子 Agent 输出永远是局部材料，父层模型负责最终回答。
- 不让子 Agent 工具绕过父 run `allowedTools`、`ToolCenter`、命令确认和运行投影。
- 不在运行视图中做重试、续跑、取消或子 Agent 独立生命周期控制；第一版仅只读复盘。

## 实现任务参考

新增或修改子 Agent 能力时，主要涉及文件：

- 类型与契约：`src/domain/sub-agents/contracts.ts`、`src/domain/config/contracts.ts`（`CapabilitySubAgentCatalogItem`）。
- 加载与校验：`src/app/sub-agents/sub-agent-loader.ts`、`src/app/sub-agents/sub-agent-validation.ts`。
- 注册表：`src/app/sub-agents/sub-agent-registry.ts`。
- 工具定义与 executor：`src/app/sub-agents/sub-agent-tools.ts`。
- 运行器：`src/app/sub-agents/sub-agent-runner.ts`。
- 事件：`src/app/sub-agents/sub-agent-events.ts`。
- trace：`src/app/sub-agents/sub-agent-trace-store.ts`、`src/domain/runtime-database/contracts.ts`、`src/adapters/runtime-database/file-system-runtime-database.ts`。
- CapabilityCenter 集成：`src/app/capability-center.ts`、`src/app/basic-agent-runtime/builtin-tool-runtime.ts`。
- 运行时集成：`src/app/desktop-agent-loop-preparation.ts`、`src/app/panel-server/desktop-agent-execution.ts`、`src/app/panel-server/runtime.ts`、`src/app/panel-server/types.ts`。
- 内置专家：`src/app/sub-agents/builtin/<name>/SUB_AGENT.md`。
- read model 与前端运行视图：`src/app/panel-server/basic-agent-read-models.ts`、`src/app/panel-read-model/transcript/panel-transcript-nodes.ts`、`src/app/panel-read-model/transcript/panel-transcript-node-projection.ts`、`src/app/panel-ui/src/components/sub-agent-run-viewer.tsx`、`src/app/panel-ui/src/components/transcript-timeline.tsx`。
- 前端契约与设置：`src/app/panel-ui/src/contracts/sub-agents.ts`、`src/app/panel-ui/src/contracts/run.ts`、`src/app/panel-ui/src/components/sub-agent-settings.tsx`。

## 验收说明

子 Agent 能力变更完成后至少检查：

```powershell
git diff --check
pnpm build:node
node --test `
  dist/app/sub-agents/sub-agent-tool-inheritance.test.js `
  dist/app/sub-agent-stream-projection.test.js `
  dist/app/capability-center.test.js `
  dist/app/desktop-agent-loop-preparation.test.js `
  dist/app/panel-server/runtime.test.js `
  dist/app/panel-server/basic-agent-run-view.test.js `
  dist/adapters/runtime-database/file-system-runtime-database.test.js `
  dist/app/panel-read-model/transcript/panel-transcript-node-projection.test.js `
  dist/app/panel-structure-tests/panel-ui-chat-structure.test.js
```

当前加载、校验、注册表、runner 和 tools 的核心回归集中在 `src/app/sub-agents/sub-agent-tool-inheritance.test.ts`，不要引用不存在的拆分测试文件。若改动触及普通 Agent 全局工具边界、持久化主链路或前端构建，再补跑 `pnpm test` 做全量回归。

验收要点：

- 默认普通 Agent 主循环语义未变化；`/api/conversations` 默认路径仍是 `agent`。
- 四个子 Agent 工具在 capability snapshot 的 `toolCatalog` 中可见，在 run 执行阶段被真实 executor 覆盖。
- `subAgentCatalog` 包含三级发现结果，project 级覆盖 user 级和 builtin 级。
- 校验失败的子 Agent `enabled: false`，模型无法调用，且不阻塞发现流程。
- `call_sub_agent` / `call_sub_agents` / `spawn_sub_agent` 的输入校验、错误归一化、事件发布符合本文描述；`read_sub_agent_output` 只能读取当前父 run 的子 Agent 输出。
- `spawn_sub_agent` 不出现在子 Agent 的工具集合中，递归派生被阻止。
- 子 Agent 工具不绕过父 run `allowedTools`、`ToolCenter` 和命令确认；内部确认会冒泡为父 run pending confirmation。
- 子 Agent 输出默认 UI 只展示摘要，完整输出作为 tool result 回到模型上下文；超长输出必须带可执行 continuation，而不是不可恢复截断。
- `subAgentRuns` 是 UI 的唯一详情数据源；live run 和 persisted run 都能恢复子 Agent 详情。
- `sub-agent-runs.jsonl` 写入与读取保持向后兼容；老 run 缺失该文件时 read model 返回空数组。
- 子 Agent 内联卡片、批次卡片和详情抽屉只读；不引入重试、续跑或子 Agent 生命周期控制。

## 开发 agent 开工顺序

1. 先读 `CURRENT_RUNTIME_MODE.md`、本目录 `02-主循环与AgentDefinition.md`、`03-工具分层与执行边界.md`、`08-MCP与Skills能力底座开发书.md`、`10-Skills官方兼容加载.md` 和本文。
2. 先确认类型与契约（`SubAgentDefinition`、`CapabilitySubAgentCatalogItem`、事件 payload）已稳定。
3. 再确认加载、校验、注册表、工具定义、runner、事件各自闭环且有测试。
4. 再确认 CapabilityCenter stub 注册与 `prepareDesktopAgentLoop` 真实 executor 覆盖的衔接。
5. 最后确认前端契约、设置页、运行视图和 read-model 投影与冻结 catalog 一致。

不要从 `.trellis/tasks`、历史 work session 或 underground prototype 推导子 Agent 任务；子 Agent 是普通 Agent 的工具能力，不是 deep / Underground 的前置实现。
