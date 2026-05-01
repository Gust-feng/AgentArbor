# 协议边界

本目录保存官方协议、AgentArbor 自定义协议、工具适配层和事实源边界相关 ADR。

## 决策记录

- [ADR-0002: Codex 官方兼容](ADR-0002-Codex官方兼容.md)：说明当前仓库为什么必须优先遵守 Codex / Agent Skills 官方兼容层，并把 `.agents/skills/` 与 AgentArbor 自定义协议分开。
- [ADR-0003: AgentArbor 原生智能体](ADR-0003-AgentArbor原生智能体.md)：说明 AgentArbor 原生智能体为什么不放入 `.codex/agents/`，并明确成熟 agent 必须作为 Fruit 经治理后才能沉淀。
- [ADR-0010: 产品层与开发工具层](ADR-0010-产品层与开发工具层.md)：说明 `AGENTS.md`、`.agents/skills/`、`.codex/agents/` 属于开发工具层，而 `.agentarbor/**` 属于方向交接包目录；当前开发工具不能压缩产品规格。
