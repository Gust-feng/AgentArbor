# 子 Agent 工具能力开发书

## 定位

Sub-Agent 是 Ordinary Agent 的工具能力，不是独立运行模式，也不是 Multi-Agent 的 child。模型可以把一个边界清楚的局部任务交给专家，专家完整返回结果，父 Agent 决定如何继续。

当前正式实现直接使用 OpenAI Agents SDK 的 AgentTool 机制，不再维护自研 Sub-Agent runner、事件体系、trace store、独立 read-model 或输出续读协议。

```text
OrdinaryAgentFeature
  -> OpenAI Agents SDK loop
      -> call_sub_agent / spawn_sub_agent
          -> SDK nested Agent
              -> parent ToolExecutionGateway -> ToolCenter
          -> complete result -> parent model
```

## 当前公开能力

只有两个 AgentTool：

| 工具 | 用途 |
| --- | --- |
| `call_sub_agent` | 调用一个已登记且已启用的专家。 |
| `spawn_sub_agent` | 为本次调用创建一个不持久化的一次性专家。 |

旧批量与专用续读工具已退役。批量调用由父模型按需发起多个 AgentTool 调用；长结果直接作为当前 AgentTool 的完整结果返回，不保存额外续读状态。

## 模块所有权

`src/app/sub-agents/` 只拥有以下职责：

- 发现、解析、校验和登记 `SUB_AGENT.md`。
- 向 capability catalog 贡献两个 catalog-only 工具定义，并与冻结 run 的普通工具边界使用同一曝光决策。
- 为每个冻结的 Ordinary run 生成 `call_sub_agent` / `spawn_sub_agent` AgentTool 定义。
- 把工具输入解析为 SDK nested Agent 的 instructions、input、caller identity 和工具权限。
- 对 Sub-Agent 工具权限做确定性收窄并阻止递归。

catalog-only 定义不向 ToolRegistry 注册假 executor；真正执行只发生在 OpenAI Agents SDK adapter 创建的 AgentTool 中。一个 Sub-Agent 工具只有同时进入冻结 capability snapshot、通过 AgentDefinition/tool exposure 决策并能生成本轮 AgentTool 时才向模型可见。

Sub-Agent 模块不拥有 Ordinary run 状态、conversation、持久化、确认 continuation 或 UI projection。OpenAI Agents SDK adapter 负责 nested Agent 的机械循环；Ordinary feature 继续拥有父 run 的业务事实。

## 定义与发现

已登记专家使用目录包：

```text
<sub-agent-root>/
  <package-name>/
    SUB_AGENT.md
```

`SUB_AGENT.md` 使用 YAML frontmatter 和 Markdown 正文。稳定字段包括：

| 字段 | 含义 |
| --- | --- |
| `name` | 专家名称，供 `call_sub_agent` 选择。 |
| `description` | 简短职责说明，进入工具目录描述。 |
| `enabled` | 是否可用于新 run。 |
| `allowed-tools` | 在父 run 工具权限内进一步收窄。 |
| `when-to-use` / `when-not-to-use` | 定义材料，帮助维护者说明职责边界。 |

Markdown 正文作为专家 instructions 的主体。加载时校验文件、frontmatter 和内容 hash；无效定义保留诊断信息但不向新 run 暴露为可调用专家。

发现根支持 `builtin`、`user`、`project` 和显式 custom root。重名时按已冻结的 root precedence 选择一个定义；运行中不因磁盘文件变化偷偷替换本轮专家事实。

## `call_sub_agent`

输入：

```json
{
  "sub_agent_name": "review-expert",
  "task": "审查这次变更的行为风险",
  "context": "仅关注 Ordinary 持久化边界"
}
```

- `sub_agent_name` 必须是当前冻结目录中已启用的专家。
- `task` 必须是非空、边界清楚的局部任务。
- `context` 必须是字符串或 `null`。
- 专家 instructions 由 `SUB_AGENT.md` 正文、名称、描述和固定的局部任务约束组成。
- 实际工具集合是父 run 当前允许且真实可执行的工具，再与定义中的 `allowed-tools` 取交集。

## `spawn_sub_agent`

输入：

```json
{
  "role": "API contract reviewer",
  "instructions": "只检查公开 API 的兼容性和错误语义。",
  "task": "审查本次 API 调整",
  "context": null,
  "allowed_tools": ["read_file", "grep_files"]
}
```

- `role`、`instructions` 和 `task` 必须是非空字符串。
- `context` 必须是字符串或 `null`。
- `allowed_tools: null` 表示继承父 run 的可执行工具上限。
- 数组表示显式收窄；空数组表示不给 nested Agent 工具。
- 请求父 run 未授权或当前不可执行的工具时明确失败，不能静默扩权。
- 动态专家只服务本次 AgentTool 调用，不写回 registry 或磁盘定义。

## 权限、递归与确认

Sub-Agent 权限只允许收窄：

```text
父 run allowedTools
  ∩ 当前 ToolExecutionGateway 可执行工具
  ∩ 专家定义或 spawn 输入的可选声明
  - 所有 Sub-Agent AgentTool
```

`call_sub_agent`、`spawn_sub_agent` 以及已经退役的旧 Sub-Agent 工具名都从 nested Agent 工具集合中排除。nested Agent 因此不能再派生 Sub-Agent，也不能绕过父 run 权限。

专家内部的机械工具调用复用父 Ordinary 的 `ToolExecutionGateway` 与 ToolCenter，不创建第二套 registry、broker 或确认门。命令确认、拒绝、取消和恢复继续使用父 run 的 Ordinary continuation；已完成的工具调用不能因恢复而重复执行。

## 上下文与结果

- 父模型显式提供 `task` 和可选 `context`，工程层不额外构造隐藏任务状态或摘要账本。
- SDK nested Agent 自己完成模型-工具-模型循环。
- AgentTool 返回 nested Agent 的完整最终输出，父模型把它作为局部材料继续推理。
- 不创建专用 trace、独立 read-model、独立事件流或 sidecar。
- AgentTool requested/result 作为 Ordinary 标准 tool facts 持久化和展示，不发布专用 `sub_agent.*` 事件。
- 不提供专用输出续读工具；如果父模型需要补充材料，应再次调用现有工具或再次委派一个明确任务。
- Ordinary 的 canonical history 只保存模型实际消费的 AgentTool 调用与结果，不从 UI 投影回填。

## 与 Multi-Agent 的边界

Sub-Agent 与 Deep child 独立：

- Sub-Agent 是 Ordinary 中的 SDK AgentTool，没有独立 task board 或 run tree。
- Deep child 由 Multi-Agent manager、TaskBoard 和 scheduler 编排，使用 `/api/deep/*` 的业务事实。
- 两者可以共享模型、ToolCenter、确认和上下文机械能力，但不共享状态、事件、仓储或 read-model。
- 不允许在两者之间自动升级、转换状态或复用 continuation。

## 验收

变更 Sub-Agent 能力时至少验证：

- `call_sub_agent` 只暴露冻结目录中已启用的专家。
- 两个 AgentTool 只通过 catalog-only definition 和冻结 run 工具边界曝光，ToolRegistry 中不存在假 executor。
- `spawn_sub_agent` 对 `null`、空数组、合法收窄和越权工具输入的行为明确。
- nested Agent 只能使用父 run 已授权且真实可执行的工具。
- 所有 Sub-Agent AgentTool 均从 nested Agent 工具集合中排除。
- 工具确认能够在父 Ordinary run 中暂停和恢复，且不重复执行已完成工具。
- nested Agent 的完整结果回到父模型，不依赖续读工具、trace store 或 UI read-model。
- AgentTool 只形成 Ordinary 标准 tool facts，不形成专用 Sub-Agent 事件。
- OpenAI Responses 与 OpenAI-compatible Chat 都通过同一 `AgentLoop` / feature 契约使用该能力。

## 非目标

- 多层递归 Sub-Agent。
- Sub-Agent 批量调度协议、team mailbox 或独立生命周期。
- 独立 Sub-Agent 持久化、事件、trace、SSE 或详情面板。
- 用 Sub-Agent 替代 Multi-Agent manager/child/synthesis。
- 为已删除工具或旧本地记录增加兼容分支。
