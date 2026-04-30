# ADR-0004: `.agentarbor/` 作为 AgentArbor 原生启动资产区

## Status

Accepted, amended by [ADR-0010](../协议边界/ADR-0010-产品层与开发工具层.md)

## Context

`.agents/` 是 Agent Skills 和插件生态目录。`.agent/` 是常见项目自定义目录名，但不是 AgentArbor 专属命名，容易继续引发“这是通用 agent 配置还是 AgentArbor runtime 数据”的混淆。

AgentArbor 需要一个明确属于自身产品协议的目录，用于保存未来 runtime 可识别、可生成、可管理的 agent、registry、workflow、memory、schema 和内置能力草案。

## Decision

采用 `.agentarbor/` 作为 AgentArbor 原生启动资产区。

- `.agents/` 只用于官方生态：`skills/` 和未来可选 `plugins/`。
- `.agentarbor/` 用于 AgentArbor 原生数据：`registry.json`、`agents/`、`workflows/`、`memories/`、`schemas/`、`future-builtins/`。
- `.codex/agents/` 用于开发 AgentArbor 仓库时的 Codex custom subagents，也可用于未来 Codex 适配输出；不保存 AgentArbor 原生 agent。
- `.agent/` 废弃，不作为当前结构继续使用。

## Consequences

- AgentArbor 原生协议目录具备产品身份，不再依赖泛用 `.agent/` 命名。
- 官方生态目录和 AgentArbor 原生 runtime 目录分离更清晰。
- 后续迁移、生成和验证应以 `.agentarbor/registry.json` 为 AgentArbor runtime 草案入口。
- 参见 [ADR-0010](../协议边界/ADR-0010-产品层与开发工具层.md)：`.agentarbor/` 产品运行层不能被当前 Codex 开发工具层压缩。
- 2026-04-29 术语修正：当前开发工作区在 `docs/`；`.agentarbor/` 不再称为工作区，而称为未来启动资产区或产品层种子。
