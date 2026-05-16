# AgentArbor

AgentArbor 是面向桌面通用 Agent 的本地工作台与运行时项目。当前活跃实现路线是 [ADR-0024-桌面基础Agent与基础设施优先路线](docs/架构设计/产品架构/ADR-0024-桌面基础Agent与基础设施优先路线.md)：默认先做稳定的普通桌面 Agent，会话、工具、确认、事件、安全投影和持久化先闭环；[ADR-0022-AgentArbor桌面通用Agent与双运行时架构](docs/架构设计/产品架构/ADR-0022-AgentArbor桌面通用Agent与双运行时架构.md) 保留长期产品架构事实源；[ADR-0018-AgentArbor原生概念树架构](docs/架构设计/产品架构/ADR-0018-AgentArbor原生概念树架构.md) 仅作为历史概念树和术语来源。

当前仓库已进入桌面基础 Agent 与本地工作台实现阶段。开发前请先阅读 [docs/README.md](docs/README.md) 和 [开发指南](docs/开发指南/README.md)；[任务看板](docs/任务看板/README.md) 只保留历史背景，不再作为当前任务或约束入口。

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

- `docs/`：人类可读的正式开发指南、历史看板、研究资料和架构设计。
- `.trellis/`：历史 Trellis 工作流与规范材料；`.trellis/tasks/` 不再作为当前开发任务、约束或上下文入口。
- `.agents/`：官方 Agent Skills 兼容层。
- `.codex/`：Codex 开发适配层。
- `.opencode/`：OpenCode 开发适配层。
- `.claude/`：Claude Code 开发适配层。
- `.agentarbor/`：未来 AgentArbor 原生方向交接包目录，用于地下中枢向地上中枢传递方向、约束、证据和 Growth Entry；不保存最终资产，不替代 Soil，只有在契约稳定后才增量创建。
- `src/`：AgentArbor TypeScript 实现代码。当前优先打磨本地 Desktop Shell / Panel、默认普通桌面 Agent 运行链、模型/工具/确认/事件/持久化基础设施；deep / advanced 仅作为未来能力边界保留，不新增可见入口，也不主动改动后端路径。

`.trellis/tasks/` 是历史任务材料，不再参与当前开发流程；`.trellis/spec/` 中仍有价值的工程规则只能作为参考，不能覆盖 `AGENTS.md`、`docs/开发指南/` 和当前用户指令。其他点目录默认仍属于本地开发态工具层；若未来需要把平台适配模板或 AgentArbor 原生运行时资产纳入团队共享基线，必须先明确职责、验证方式和提交范围，再单独调整忽略规则。

## 快速阅读

1. [文档入口](docs/README.md)
2. [开发指南](docs/开发指南/README.md)
3. [开发指南总览](docs/开发指南/00-总览.md)
4. [基础](docs/开发指南/01-基础/README.md)
5. [核心闭环](docs/开发指南/02-核心闭环/README.md)
6. [系统架构](docs/开发指南/03-系统架构/README.md)
7. [工程实现](docs/开发指南/06-工程实现/README.md)
8. [研究资料](docs/研究资料/README.md)
9. [架构设计](docs/架构设计/README.md)

## 当前原则

- 不把未治理草案、路线残留、经验流水或演示资产混入当前开发入口。
- 只在 `docs/` 保留开发指南、架构设计和对未来开发有用的研究报告。
- 历史经验、推进记录、阶段计划、会话沉淀、草案包和准备包不保留在活跃文档树。
- 当前默认产品主线是普通桌面 Agent：任务输入、模型/工具循环、确认、安全事件、会话持久化和工作台结果展示。
- deep / advanced 是未来项目：当前不做可见 deep 入口，不主动改动 deep 后端；后续若重启，应继续复用 AgentTurnRuntime、ToolCenter、RunEvent、RuntimeDatabase、Confirmation Gate 等基础设施，不能另起平行运行时。
- `.agentarbor` 只作为未来 Plan Package 的实现/存储形态，不是最终资产仓库，也不是 Soil 的副本。
- Fruits、Capability Asset、Experience Candidate 和 Governance 回流是长期架构能力，必须等真实需求、权限边界和验证方式稳定后再出生。
- 约束工程贯穿 Soil、Underground Center、`.agentarbor`、Aboveground Center、Fruits、Governance 和回流后的 Soil；Path Bias 不能覆盖 hard constraint。
- 不让 Codex、OpenCode 或其他平台格式反向定义 AgentArbor 产品语义。
- 不提前填充 `.agentarbor/` 作为假完整结构。
- 不创建没有职责、契约、权限和验证依据的 agent、skill 或 runtime 资产。
