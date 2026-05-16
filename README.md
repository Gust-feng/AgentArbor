# AgentArbor

AgentArbor 是面向桌面通用 Agent 的本地工作台与运行时项目。当前活跃实现路线是 [ADR-0024-桌面基础Agent与基础设施优先路线](docs/架构设计/产品架构/ADR-0024-桌面基础Agent与基础设施优先路线.md)：默认先做稳定的普通桌面 Agent，会话、工具、确认、事件、安全投影和持久化先闭环；[ADR-0022-AgentArbor桌面通用Agent与双运行时架构](docs/架构设计/产品架构/ADR-0022-AgentArbor桌面通用Agent与双运行时架构.md) 保留长期产品架构事实源；[ADR-0018-AgentArbor原生概念树架构](docs/架构设计/产品架构/ADR-0018-AgentArbor原生概念树架构.md) 仅作为历史概念树和术语来源。

当前仓库已进入第一阶段确定性最小运行内核实现，运行时代码仍限制在内存版闭环、事件、状态、产物、验证和治理回流范围内。开发前请先阅读 [docs/README.md](docs/README.md)、[开发指南](docs/开发指南/README.md) 和 [任务看板](docs/任务看板/README.md)。

## 仓库结构

```text
/
  AGENTS.md
  README.md
  docs/
  .trellis/
  .agents/
  .codex/
  .opencode/
  .claude/
  .agentarbor/
  src/
```

## 目录职责

- `docs/`：人类可读的正式开发指南、任务看板、研究资料和架构设计。
- `.trellis/`：当前 AI 开发工作流、任务上下文和项目规范。
- `.agents/`：官方 Agent Skills 兼容层。
- `.codex/`：Codex 开发适配层。
- `.opencode/`：OpenCode 开发适配层。
- `.claude/`：Claude Code 开发适配层。
- `.agentarbor/`：未来 AgentArbor 原生方向交接包目录，用于地下中枢向地上中枢传递方向、约束、证据和 Growth Entry；不保存最终资产，不替代 Soil，只有在契约稳定后才增量创建。
- `src/`：AgentArbor TypeScript 实现代码。当前包含本地 Desktop Shell / Panel、普通桌面 Agent 运行链、深入模式兼容路径、模型/工具/确认/事件/持久化基础设施；外部协议和高级组织只能通过明确 adapter 或 deep / advanced 路径进入。

`.trellis/spec/`、`.trellis/tasks/`、`.trellis/scripts/`、`.trellis/workflow.md`、`.trellis/config.yaml`、`.trellis/.version` 和 `.trellis/.gitignore` 是当前共享 Trellis 事实源；`.trellis/.runtime/`、`.trellis/workspace/`、`.trellis/.developer` 和 `.trellis/.current-task` 继续作为本地运行态忽略。其他点目录默认仍属于本地开发态工具层；若未来需要把平台适配模板或 AgentArbor 原生运行时资产纳入团队共享基线，必须先明确职责、验证方式和提交范围，再单独调整忽略规则。

## 快速阅读

1. [文档入口](docs/README.md)
2. [开发指南](docs/开发指南/README.md)
3. [开发指南总览](docs/开发指南/00-总览.md)
4. [任务看板](docs/任务看板/README.md)
5. [基础](docs/开发指南/01-基础/README.md)
6. [核心闭环](docs/开发指南/02-核心闭环/README.md)
7. [系统架构](docs/开发指南/03-系统架构/README.md)
8. [研究资料](docs/研究资料/README.md)
9. [架构设计](docs/架构设计/README.md)

## 当前原则

- 不把未治理草案、路线残留、经验流水或演示资产混入当前开发入口。
- 只在 `docs/` 保留开发指南、架构设计和对未来开发有用的研究报告。
- 历史经验、推进记录、阶段计划、会话沉淀、草案包和准备包不保留在活跃文档树。
- 当前默认产品主线是普通桌面 Agent：任务输入、模型/工具循环、确认、安全事件、会话持久化和工作台结果展示。
- 深入模式是显式 deep / advanced 路径：后续可按 ADR-0022 / ADR-0021 的 Underground、Plan、Aboveground 架构演进，但不能污染默认普通会话。
- 普通模式和深入模式共享 AgentTurnRuntime、ToolCenter、RunEvent、RuntimeDatabase、Confirmation Gate 等基础设施，不共享多 agent 策略层。
- `.agentarbor` 只作为未来 Plan Package 的实现/存储形态，不是最终资产仓库，也不是 Soil 的副本。
- Fruits、Capability Asset、Experience Candidate 和 Governance 回流是长期架构能力，必须等真实需求、权限边界和验证方式稳定后再出生。
- 约束工程贯穿 Soil、Underground Center、`.agentarbor`、Aboveground Center、Fruits、Governance 和回流后的 Soil；Path Bias 不能覆盖 hard constraint。
- 不让 Codex、OpenCode 或其他平台格式反向定义 AgentArbor 产品语义。
- 不提前填充 `.agentarbor/` 作为假完整结构。
- 不创建没有职责、契约、权限和验证依据的 agent、skill 或 runtime 资产。
