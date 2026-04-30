# AgentArbor

AgentArbor 是目标驱动的 Agent / AgentApp 孕育与演化平台。它把用户提示词视为想象，由 Seed Cluster 前置成像为可审阅的 Seed Packet；用户确认后把种子种入受治理的 Soil，Root System 初始生根并在运行期持续生长，Core Control Cluster 制定和修订 Growth Plan 与 Workflow IR，Branch / Leaf / Flower 组织执行与验证，最后通过 Run Memory、Experience Candidate、Path Bias、Capability Asset、Fruit 和 Ring Memory 反哺土壤。

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
- `.agentarbor/`：未来 AgentArbor 原生机器可读启动资产，只有在契约稳定后才增量创建。
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

- 不把旧讨论稿、路线残留、经验流水或演示资产混入当前开发入口。
- 只在 `docs/` 保留开发指南、架构设计和对未来开发有用的研究报告。
- 历史经验、推进记录、阶段计划、会话沉淀、草案包和准备包不保留在活跃文档树。
- 早期计划书中“自然语言生成 AgentApp”的价值应被吸收，但方向要校正为目标驱动的孕育、验证、谱系和演化闭环。
- 当前正式产品主线是 `Imagination -> Seed Cluster -> Seed Packet -> User Approval Gate -> Soil -> Initial Rooting -> Root Brief -> Core Control Cluster -> Growth Plan -> Workflow IR -> Branch / Leaf / Flower / Fruit -> Root Callback -> Run Memory / Ring Memory / Soil`。
- Seed Cluster 是启动门，不属于地下 Root System，也不属于地上执行组织。
- Root System 是持续地下生命系统，生成第一版 Root Brief 后仍可通过 Root Callback 继续侧根扩展或深根重探。
- Core Control Cluster 是主干固定核心，负责制定和修订 Growth Plan 与 Workflow IR。
- 不让 Codex、OpenCode 或其他平台格式反向定义 AgentArbor 产品语义。
- 不提前填充 `.agentarbor/` 作为假完整结构。
- 不创建没有职责、契约、权限和验证依据的 agent、skill 或 runtime 资产。
