# ADR-0004: `.agentarbor/` 作为 AgentArbor 原生方向交接包目录

## Status

Accepted, amended by [ADR-0010](../协议边界/ADR-0010-产品层与开发工具层.md) and [ADR-0018](../产品架构/ADR-0018-AgentArbor原生概念树架构.md)

## Context

`.agents/` 是 Agent Skills 和插件生态目录。`.agent/` 是常见项目自定义目录名，但不是 AgentArbor 专属命名，容易继续引发“这是通用 agent 配置还是 AgentArbor runtime 数据”的混淆。

AgentArbor 需要一个明确属于自身产品协议的目录，用于保存未来地下中枢交给地上中枢的方向交接包。该目录只承载任务授权、方向依据、约束引用、证据引用、资产引用、风险和 Growth Entry，不承载最终资产，也不复制 Soil 资产本体。

## Decision

采用 `.agentarbor/` 作为 AgentArbor 原生方向交接包目录。

- `.agents/` 只用于官方生态：`skills/` 和未来可选 `plugins/`。
- `.agentarbor/` 用于 AgentArbor 原生方向交接包：任务授权、方向依据、约束引用、证据引用、资产引用、风险和 Growth Entry。
- `.codex/agents/` 用于开发 AgentArbor 仓库时的 Codex custom subagents，也可用于未来 Codex 适配输出；不保存 AgentArbor 原生 agent。
- `.agent/` 废弃，不作为当前结构继续使用。

## Consequences

- AgentArbor 原生协议目录具备产品身份，不再依赖泛用 `.agent/` 命名。
- 官方生态目录、开发工具适配层和 AgentArbor 原生方向交接包目录分离更清晰。
- `.agentarbor/` 只有在契约稳定且有真实任务出生依据时才增量创建；不能预填充 agent、workflow、memory 或 schema。
- 参见 [ADR-0010](../协议边界/ADR-0010-产品层与开发工具层.md)：开发工具层不能反向压缩 AgentArbor 产品层。
- 参见 [ADR-0018](../产品架构/ADR-0018-AgentArbor原生概念树架构.md)：`.agentarbor` 位于 Underground Center 和 Aboveground Center 之间。
