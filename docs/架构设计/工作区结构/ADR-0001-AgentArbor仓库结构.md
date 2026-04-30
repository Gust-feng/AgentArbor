# ADR-0001: AgentArbor 仓库结构

## Status

Superseded by the current repository structure and amended by [ADR-0002](../协议边界/ADR-0002-Codex官方兼容.md), [ADR-0004](ADR-0004-AgentArbor原生工作区.md), and [ADR-0010](../协议边界/ADR-0010-产品层与开发工具层.md).

## Context

AgentArbor 后续开发任务复杂且长期，不能依赖一次性对话和临时提示词推进。项目需要固定的文档、工具适配、未来运行时资产和实现代码边界。

旧版工作区结构曾把计划、进展、经验和多类资料都放进 `docs/`，后续证明这会让开发前入口过重。当前结构已收缩为清晰的开发指南、任务看板、研究资料和架构设计四类。任务看板只是从 Trellis 任务源派生的人类可读视图，不是第二套计划源。

## Decision

当前仓库采用以下结构：

```text
/
├── AGENTS.md
├── README.md
├── docs/
│   ├── README.md
│   ├── 开发指南/
│   ├── 任务看板/
│   ├── 研究资料/
│   └── 架构设计/
├── .agents/
│   └── skills/
├── .codex/
├── .opencode/
├── .agentarbor/
└── src/
```

`docs/` 只保留人类可读的开发指南、任务看板、研究资料和架构设计。

`.agents/` 只作为官方 Agent Skills 兼容层。

`.codex/` 和 `.opencode/` 是开发工具适配层。

`.agentarbor/` 是未来 AgentArbor 产品运行时的原生启动资产区，不是当前文档工作区。

## Consequences

- 历史经验、推进记录、阶段计划、会话交接、准备包和草案包不保留在 `docs/` 活跃知识面中。
- 新增文档必须进入 `开发指南`、`任务看板`、`研究资料` 或 `架构设计` 四类之一；否则不应新增。`任务看板` 只能保存从 Trellis 派生的人类可读视图，不能保存计划源数据。
- 新 AgentArbor 原生智能体必须进入 `.agentarbor/agents/`，并且只能在契约、权限和出生理由明确后创建。
- Codex 或 OpenCode 开发态智能体不能作为 AgentArbor 产品原生智能体事实源。
