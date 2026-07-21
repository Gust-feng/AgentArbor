# MCP 与 Skills 能力底座

本文记录 Ordinary 当前稳定的 MCP、Skills 与 Sub-Agent 契约。它不是阶段任务书；实现事实以源码、ADR-0026/0027 和 `CURRENT_RUNTIME_MODE.md` 为准。

## 总体边界

```text
Capability snapshot
  -> frozen tool / skill / MCP / Sub-Agent catalog
  -> Ordinary run resources
  -> AgentLoop
  -> ToolCenter gateway + Pi AgentTool
  -> ordinary-run/v4 facts + Pi Session tool messages
```

- 能力在 run 创建时冻结；运行中配置变化只影响新 run。
- ToolCenter 只执行普通工具。Skills 贡献上下文和受控资源读取；Sub-Agent 贡献 Pi AgentTool；MCP 贡献外部工具 executor。
- capability catalog 可以保存 catalog-only definition，但不能向 ToolRegistry 注册没有真实 executor 的假工具。
- 所有调用、确认、结果、取消和 usage 归父 Ordinary run，不建设平行 runner、trace store 或 read-model。

## MCP

MCP 配置、连接和工具发现属于 adapter/capability 边界。只有同时满足以下条件的工具进入本轮 Ordinary：

- 服务已启用并成功连接。
- 工具进入本轮冻结 `mcpCatalog`。
- 通过 `AgentDefinition.toolVisibilityProfile`。
- 当前 run 的 executable boundary 包含真实 executor identity。

MCP adapter 保留服务端 `content[]` 与可选 JSON 对象 `structuredContent` 的单份事实；`isError=true` 映射为 failed。MCP 没有通用 continuation 规范，因此不得从任意 continuation-shaped 字段猜测可执行续读。媒体使用带外附件并遵守协议能力、来源角色和预算；不支持的媒体明确失败。

MCP 连接、listener 和子进程由 Host/Panel runtime 释放。MCP 不拥有 Ordinary run 状态，也不能把 provider 或 transport 错误解释成业务完成。

## Skills

默认发现：

- 用户级 `$HOME/.agents/skills`。
- 项目级 `$WORKSPACE/.agents/skills`，优先级更高。
- Host 显式传入的 additional roots。

Skill loader 使用标准 YAML parser 读取 `SKILL.md` frontmatter，发现 metadata、正文 hash、resources 和 eval artifacts。默认采用 progressive disclosure：

- 显式 `$skill` 或确定性关键词/trigger 选择后才加载正文。
- 只有用户显式选择语义路由时，才发起 `skill_routing` 模型请求。
- 未选中的 Skill 正文和资源不进入模型上下文。
- 正文加载时必须与 frozen catalog hash 一致，否则 fail closed。
- `read_skill_resource` 只读取本轮 selected + loaded Skill 的 indexed resource；reference 可以返回文本，asset/script 只返回 metadata，script 不自动执行。
- `evals/` 只服务本地 doctor/eval，不进入运行时资源索引。

Skill 启停和 `markUsed` 只使用 source-qualified `stateKey` 的 v2 状态文件。旧 `skillId`、旧版本和损坏状态视为空状态，不迁移、不修复、不回退。

`allowed-tools` 当前只是冻结和审计声明：只能收窄，不能扩张工具、替代命令确认或变成全局免确认授权。

## Sub-Agent

Sub-Agent 只向 Ordinary Agent Session loop 贡献两个 AgentTool：

- `call_sub_agent`：调用已登记专家。
- `spawn_sub_agent`：创建一次性专家。

AgentTool definition 进入冻结 capability catalog，但不向普通 ToolRegistry 注册 stub executor。运行时由 Agent Session adapter 执行 nested agent；权限以父 run 冻结工具为上限，Sub-Agent 声明只能进一步收窄。nested tool set 强制排除全部 Sub-Agent 工具，因此不能递归。

完整输出直接回到父模型并形成 Ordinary 标准 tool facts。旧 `call_sub_agents`、专用续读工具、自研 runner、事件/trace store 和独立 Panel read-model 已删除。

## Session 上下文

- Skill 正文只在被选中并成功加载后进入当前 Pi Session 请求，并由 Session transcript 持久化；Ordinary snapshot 只保存稳定 ref，不复制消息正文。
- MCP 与 Sub-Agent 工具调用/结果按普通工具协议进入 Pi Session；Ordinary 只持有业务工具事实，不得另建 canonical messages、摘要历史或从 UI 事件回填模型上下文。
- 工具附件字节只服务当前请求，不进入持久化消息；引用和元数据按工具事实契约处理。
- 模型需要更多文件或网页材料时再次调用相应工具，不建设替模型决定下一步的通用续读工作流。

## 变更检查

修改 MCP、Skills 或 Sub-Agent 时必须确认：

- 冻结 catalog 与真实 executable boundary 一致。
- disabled、断连、hash 改变和权限收窄都 fail closed。
- 取消、确认、失败和完整工具输出仍进入父 Ordinary 事实。
- 不产生新的 fake executor、专用状态、第二模型历史或跨 feature store。
- 新外部对象在 adapter 边界完成验证和脱离。

## 验证

```powershell
pnpm build:node
node --test dist/adapters/mcp/mcp-client.test.js
node --test dist/app/skills/skill-loader.test.js dist/app/skills/skill-state-store.test.js dist/app/skills/skill-router.test.js dist/app/skills/skill-resource-resolver.test.js
node --test dist/app/sub-agents/sub-agent-agent-tools.test.js
```

跨模块变更还必须运行 `pnpm typecheck:panel` 和相关 Panel contract 测试；发布门运行完整 `pnpm test`。

## 相关文档

- [工具分层与执行边界](03-工具分层与执行边界.md)
- [兼容路径隔离](07-兼容路径隔离.md)
- [ADR-0026-子Agent工具能力架构](../../../架构设计/产品架构/ADR-0026-子Agent工具能力架构.md)
- [ADR-0027-工具执行事实与单向消费架构](../../../架构设计/产品架构/ADR-0027-工具执行事实与单向消费架构.md)
