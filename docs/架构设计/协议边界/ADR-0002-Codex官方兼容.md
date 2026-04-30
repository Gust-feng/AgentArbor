# ADR-0002: 官方 Codex 兼容优先

## Status

Accepted, amended by [ADR-0003](ADR-0003-AgentArbor原生智能体.md), [ADR-0004](../工作区结构/ADR-0004-AgentArbor原生工作区.md), and [ADR-0010](ADR-0010-产品层与开发工具层.md)

## Context

AgentArbor 需要长期生成、治理和演化 agent / skill。早期结构把 registry、agent、workflow、memory 和 schema 都放在 `.agents/` 下，容易被误解为 Codex 官方会自动识别的协议。

调研确认：

- Codex repo skills 使用 `.agents/skills/<skill-name>/SKILL.md`。
- Codex project-scoped custom subagents 使用 `.codex/agents/*.toml`。
- `AGENTS.md` 是 Codex 项目指导文件。
- Codex memories 是用户级生成状态，不是仓库内 `.agents/memories`。

## Decision

AgentArbor 采用官方兼容优先策略：

- `.agents/` 下只保留 `skills/` 和未来可选 `plugins/`。
- `.codex/agents/` 保存开发 AgentArbor 仓库时使用的 Codex custom subagents，也可以保存从产品层导出的 Codex adapter 输出；无论哪种情况，都不保存 AgentArbor 原生 agent source-of-truth。
- AgentArbor 自定义 registry、agent manifest、workflow、memory 和 schema 迁入 `.agentarbor/`。
- 项目内不再定义 `skill-creator` skill，避免和 Codex 系统 `$skill-creator` 混淆。

未来 AgentArbor 生成 skill 时，必须先输出 Agent Skills 兼容格式。未来 AgentArbor 生成自己的 agent 时，必须先输出 AgentArbor 原生格式；如需供 Codex 调用，再导出 `.codex/agents/*.toml` 适配产物。

## Consequences

- 当前 Codex 可执行协议和 AgentArbor 未来产品协议分层清晰。
- `.agentarbor/registry.json` 只是未来 AgentArbor runtime 草案，不是 Codex 官方索引。
- 旧 `.agents` 自定义资料保留在 `.agentarbor/`，不静默删除。
- 后续实现阶段必须避免重新把自定义协议塞回 `.agents/` 根目录。
- 参见 [ADR-0010](ADR-0010-产品层与开发工具层.md)：当前 Codex 开发工具层不能压缩 `.agentarbor/` 产品运行层。
