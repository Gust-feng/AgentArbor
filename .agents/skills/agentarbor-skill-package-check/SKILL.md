---
name: agentarbor-skill-package-check
description: "创建或验收 AgentArbor 项目级 Agent Skills 样例包，检查目录名与 name 对齐、SKILL.md frontmatter、metadata/body/references/scripts/assets 渐进加载、以及当前不做 RAG/deep 自动触发/脚本自动执行/RuntimeDatabase 保存正文的边界。用于新增或审查 .agents/skills 下的 skill 包和 Skills 加载文档。"
metadata:
  agentarbor_sample: "true"
  capability: "skill-package-acceptance"
allowed-tools:
  - shell_command
---

# AgentArbor Skill Package Check

## Workflow

1. 检查每个包是否位于 `.agents/skills/<skill-name>/SKILL.md`，目录名必须和 frontmatter `name` 完全一致。
2. 检查 frontmatter 至少包含 `name` 和 `description`；可选字段只能作为兼容元数据，不得变成 AgentArbor 产品事实。
3. 检查 `SKILL.md` body 是否简洁、可执行，并只描述该 skill 的能力使用方法。
4. 检查 `references/`、`scripts/`、`assets/` 是否按需存在；正文应说明何时读取参考资料、何时运行脚本、何时使用资产。
5. 可运行 `scripts/validate-agentarbor-skills.ps1` 做本地结构检查。该脚本只是人工验收工具，不代表 AgentArbor runtime 会自动执行 skill 脚本。
6. 如需整理交付说明，可使用 `assets/acceptance-note-template.md` 作为输出模板。

## Loading Contract

需要解释加载口径时，读取 `references/loading-contract.md`。核心结论保持不变：metadata 常驻，body 选中后加载，references/scripts/assets 按需加载。

## Hard Boundaries

- 不把 skill 当业务编排层。
- 不承诺 RAG、deep 自动触发、skill 脚本自动执行或 Governance 回流。
- 不把完整 skill body 存入 RuntimeDatabase。
- 不把 `.agents/skills` 提升为 AgentArbor 产品语义事实源。
