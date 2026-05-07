# ADR-0003: AgentArbor 原生 Agent 不存放在 `.codex`

## Status

Accepted, amended by [ADR-0004](../工作区结构/ADR-0004-AgentArbor原生工作区.md), [ADR-0010](ADR-0010-产品层与开发工具层.md), [ADR-0018](../产品架构/ADR-0018-AgentArbor原生概念树架构.md), and [ADR-0022](../产品架构/ADR-0022-AgentArbor桌面通用Agent与双运行时架构.md)

## Context

`.codex/agents/*.toml` 是 Codex 的 project-scoped custom subagent 配置。它适合描述 Codex 这个开发工具可以调用的辅助角色，但不应成为 AgentArbor 产品自身 agent 的来源。

AgentArbor 的目标是生成、治理、验证和演化自己的 agent。若把 AgentArbor 原生 agent 放进 `.codex/agents/`，会把“产品 runtime 协议”和“Codex 工具适配格式”混成一个来源，后续会限制 AgentArbor 面向其他工具或自有 runtime 的演进。

## Decision

AgentArbor 原生 agent 不存放在 `.codex/agents/`。成熟可脱离 agent 属于 Fruit 到 Soil 的治理对象：运行中先作为候选果实接受验证、归因、版本、权限和退役策略审查，通过治理后才能以 Capability Asset 或适配输出形式沉淀。早期 `.agent/` 名称已废弃，避免和生态中泛用的 `.agent` 自定义目录混淆。

`.codex/agents/` 只允许作为开发工具层或适配层：

- 开发 AgentArbor 仓库时使用的 Codex custom subagent 标准。
- 从 AgentArbor 原生 agent 导出的 Codex TOML。

`.codex/agents/*.toml` 即使被当前仓库维护，也不能成为 AgentArbor 产品 agent 的 source-of-truth。`.agentarbor/` 只承载 Plan Package 材料，不能被当作最终 agent 资产仓库。

## Consequences

- AgentArbor 原生协议和 Codex 工具适配格式分离。
- `.agentarbor/` 是 AgentArbor 原生 Plan Package 存储目录，不是当前开发工作区、最终资产仓库、Soil 副本或 Codex 官方发现路径，必须在 README 中明确。
- AgentArbor 未来可以导出 Codex、Copilot、Claude、Gemini 等适配格式，而不牺牲自己的原生 agent 模型。
- 参见 [ADR-0010](ADR-0010-产品层与开发工具层.md)：开发工具层可以预演产品能力，但不能压缩产品层。
