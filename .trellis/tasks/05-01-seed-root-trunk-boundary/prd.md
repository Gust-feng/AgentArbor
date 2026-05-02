# AgentArbor 原生概念树架构文档调整

## Goal

将 AgentArbor 的正式产品架构和活跃开发文档统一到原生概念树：

```text
Soil -> Underground Center -> .agentarbor -> Aboveground Center -> Fruits -> Governance -> Soil
```

本任务的目标是完成文档层迁移和治理规则沉淀，不进入 TypeScript 运行时代码实现，也不提前填充 `.agentarbor/` 运行材料。

## Architecture Facts

- `Soil` 是固定资产和长期治理层，保存经过验证的 Capability Asset、Path Bias、约束、证据、谱系和退役策略。
- `Underground Center` 是地下中枢，负责用户需求成形、生根探索、反驳、证据收集、资产适配和必要用户补充。
- `.agentarbor` 是地下中枢交给地上中枢的方向交接包，保存任务授权、方向依据、约束引用、资产引用、证据引用、风险和 Growth Entry；它不是最终资产仓库，也不复制 Soil 资产本体。
- `Aboveground Center` 是地上中枢，负责 Growth Plan、Workflow IR、上下文拓扑、调度、执行控制、验证门和修订机制。
- `Fruits` 是交付物、AgentApp、能力包、Run Memory 或 Experience Candidate 等候选果实；候选果实不能直接成为 Soil。
- `Governance` 负责验证、归因、版本、权限、退役策略和沉淀决策，只有通过治理的果实才能回流 Soil。

## Requirements

- 正式入口必须直接呈现原生概念树，不写成版本迁移说明、讨论记录或候选路线。
- `docs/架构设计/产品架构/ADR-0018-AgentArbor原生概念树架构.md` 必须成为当前产品架构事实源。
- `AGENTS.md`、根 `README.md`、`docs/README.md`、开发指南入口和架构设计索引必须指向当前事实源。
- 开发指南中的系统架构、模型契约、运行组织、植物学语义映射和工程模块划分必须承接同一条主线。
- `.agentarbor` 必须被定义为方向交接包，不作为最终资产仓库、长期资产库或 Soil 副本。
- 地下中枢只在任务确认、授权边界变化、目标冲突、权限/成本/安全越界或关键事实不足时打断用户。
- 地上组织在既定方向内生长；缺少方向证据、资产适配、外部事实、约束细节、上下文养料、能力线索或关键假设验证时，必须通过 Nutrient Request 向地下中枢请求养料，不能自建方向探索集群。
- 运行产物必须先进入 `fruits/` 或等价果实层，再经 Governance 才能沉淀到 Soil。
- `src/` 的未来建议结构应表达“概念树领域包 + 横切内核”，不把平台适配层写成核心事实源。
- `.trellis/spec/` 中的治理指南必须同步当前架构，避免未来任务上下文重新注入过期边界。

## Acceptance Criteria

- [x] 顶层入口和开发指南入口统一引用原生概念树。
- [x] 新增正式架构 ADR，并将其作为当前产品架构事实源。
- [x] `.agentarbor` 定位为方向交接包，且正式文档没有把它写成最终资产仓库。
- [x] 地下中枢、地上中枢、果实、治理和 Soil 回流边界在开发指南中可执行地表达。
- [x] 资产流转规则明确为 `Fruits -> Governance -> Soil`，不允许候选果实直接入土。
- [x] 未来 `src/` 建议结构表达 `domain/`、`kernel/`、`adapters/`、`app/` 的边界。
- [x] Trellis 治理指南同步当前架构事实。
- [x] Markdown 链接、索引、空白和 stale wording 搜索通过。
- [x] 确认没有将 `.agentarbor/` 实际运行资产纳入当前 git 基线。

## Validation Plan

- 运行 Markdown 链接和索引检查。
- 运行 `git diff --check -- README.md AGENTS.md docs .trellis/spec/guides`。
- 搜索活跃文档和治理指南中的冲突表达。
- 检查 `.agentarbor/` 没有被提交为实际运行资产。
- 复核任务看板，确保它只投影 Trellis 状态，不成为第二套计划源。

## Out Of Scope

- 不实现 TypeScript runtime。
- 不创建 `.agentarbor/` 原生运行包、agent、workflow、memory 或 schema。
- 不创建根目录 `Plan/`、`Plans/` 或第二套计划入口。
- 不把 Codex、OpenCode、Claude Code 等平台适配文件写成 AgentArbor 原生产品事实源。

## Technical Notes

- 当前仓库仍处于文档和架构契约阶段，未进入运行时代码实现阶段。
- `.agentarbor/` 只有在契约稳定且有真实任务出生依据时才增量创建。
- 活跃文档采用简体中文，`README.md` 作为索引文件例外。
- 历史研究资料可以保留在研究资料或长期 ADR 中，但活跃入口和开发指南必须只表达当前架构事实。
