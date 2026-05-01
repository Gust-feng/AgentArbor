# AgentArbor

AgentArbor 是目标驱动的 Agent / AgentApp 孕育与演化平台。它以 `Soil -> Underground Center -> .agentarbor -> Aboveground Center -> Fruits -> Governance -> Soil` 为原生概念树：土壤保存长期事实和能力资产，地下中枢把用户想象、约束、证据和方向成形为 `.agentarbor` 方向交接包，地上中枢把交接包转为 Growth Plan、Workflow IR、执行组织和验证门，果实经过治理后才允许回流土壤。当前产品架构事实源是 [ADR-0018-AgentArbor原生概念树架构](docs/架构设计/产品架构/ADR-0018-AgentArbor原生概念树架构.md)。

当前仓库处于正式开发准备阶段，尚未包含运行时代码。开发前请先阅读 [docs/README.md](docs/README.md)、[开发指南](docs/开发指南/README.md) 和 [任务看板](docs/任务看板/README.md)。

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
- `src/`：未来 TypeScript 实现代码。

上述点目录当前默认属于本地开发态工具层，并被 `.gitignore` 忽略。后续如果需要把某些 Trellis 模板、平台适配模板或 AgentArbor 原生运行时资产纳入团队共享基线，必须先明确它们的职责、验证方式和提交范围，再单独调整忽略规则。

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
- 当前正式产品主线是 `Soil -> Underground Center -> .agentarbor -> Aboveground Center -> Fruits -> Governance -> Soil`。
- 地下中枢负责需求成形、用户确认、约束提取、证据探索、方向综合和运行期养料供给。
- `.agentarbor` 是方向交接包，不是最终资产仓库，也不是 Soil 的副本。
- 地上中枢负责 Growth Plan、Workflow IR、上下文拓扑、执行组织、验证门和计划修订。
- Fruits 不是 Soil；交付物、AgentApp、能力包、可脱离子 agent 和经验候选必须经过 Governance 才能入土。
- 约束工程贯穿 Soil、Underground Center、`.agentarbor`、Aboveground Center、Fruits、Governance 和回流后的 Soil；Path Bias 不能覆盖 hard constraint。
- 不让 Codex、OpenCode 或其他平台格式反向定义 AgentArbor 产品语义。
- 不提前填充 `.agentarbor/` 作为假完整结构。
- 不创建没有职责、契约、权限和验证依据的 agent、skill 或 runtime 资产。
