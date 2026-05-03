# 地下证据账本与裁决归因硬化

## Goal

把刚完成的地下多候选裁决从“能生成结论”推进到“结论可追溯、可审计、可解释”。用户目标进入地下组织后，每个 rootlet 输出、候选、交叉比较、裁决和方向交接包都必须能引用明确证据来源；Direction Handoff 不只是结论包，而是带证据账本、裁决依据和来源归因的方向交接包。

## What I Already Know

- 当前地下组织已经具备消息驱动、动态 rootlet、单 rootlet 多候选、CandidatePool 按 kind 分组、Convergence Judge 交叉裁决和 Direction Handoff Package 输出。
- 现有 `CandidateComparison` 已开始记录 candidate summary、推荐方向、合并、淘汰、用户确认和地上参考项，但证据仍偏散落在候选/比较字段中。
- `.trellis/spec/backend/underground-radial-growth.md` 已定义 `UndergroundEvidenceLedger` 作为地下证据账本，但代码层还需要把它升级为正式运行产物和 package/observation 可追踪内容。
- 下一步暂不接真实 LLM；AI 输出后续仍只能进入候选/草案/解释层，本任务先把确定性证据与裁决边界打牢。

## Requirements

- 新增或完善地下证据账本模型，覆盖 goal intent、Soil constraint refs、rootlet output、candidate comparison、convergence decision 和 user clarification / stop reason 相关证据。
- Rootlet output、ExplorationCandidateRef、CandidateComparison、CandidateConvergenceDecision、UndergroundConvergenceReport 必须通过 evidence refs 串联，不再只保留散落字符串。
- CandidateComparison 必须清晰表达：
  - 目标匹配依据。
  - 证据支持或证据不足。
  - 约束影响和硬约束冲突。
  - 风险覆盖情况。
  - 未知项与 why-not。
  - 最终比较结论及其 evidence refs。
- Convergence Judge 的 retained / merged / rejected / unknown / userDecisionRequired / abovegroundReference 结果必须能追溯到 comparison 和 evidence entries。
- Direction Handoff Package 的 evidence-index 视图必须展示与最终方向相关的证据条目、候选来源、比较依据和裁决引用。
- Observation underground view 必须暴露证据账本摘要：证据总数、按类型计数、与推荐方向相关的 evidence refs、存在冲突或不足证据时的状态。
- 保持现有地下消息驱动和动态 agent 集群结构，不改变公开 EventLog 顺序。

## Acceptance Criteria

- [ ] `pnpm build` 通过。
- [ ] `pnpm test` 通过。
- [ ] happy path 地下-only demo 仍保持 7 步 EventLog，不进入 Aboveground。
- [ ] full demo 仍保持现有完整闭环事件顺序。
- [ ] 每个 rootlet output 至少引用一条 evidence entry。
- [ ] 每个 candidate comparison 至少引用相关 evidence refs，并能说明支持/冲突/不足。
- [ ] ConvergenceReport 暴露 evidence ledger 或 evidence ledger ref，且裁决结果能追溯 comparison/evidence。
- [ ] Direction Handoff Package 的 evidence-index 内容不为空，且不包含 Soil asset 正文或运行时密钥。
- [ ] Observation Snapshot 可 JSON round-trip，并展示地下 evidence ledger 摘要。
- [ ] repo-root `.agentarbor/` 没有新增或修改运行资产。

## Definition of Done

- 测试覆盖证据账本创建、证据引用完整性、比较归因、方向包 evidence-index、Observation 投影和回归链路。
- 规范同步到 `.trellis/spec/backend/underground-radial-growth.md`、`direction-handoff-package.md` 和必要的 observation spec。
- 更新 `docs/任务看板/看板.md` 指向本任务。
- 不新增外部依赖、不接 LLM、不写 repo-root `.agentarbor/`、不新增 `Plan/` 或第二套计划入口。

## Technical Approach

- 在 `src/domain/underground` 下集中定义 evidence ledger 的类型与构造规则，避免 app 层散落拼装。
- 在 rootlet/candidate/comparison/convergence 流程中逐步传递 evidence refs，使 evidence ledger 成为运行结果的一部分，而不是额外报告。
- 在 Direction Handoff 派生层把 evidence ledger 渲染到 package files 的 evidence-index，并保持 canonical payload 单一事实源。
- 在 Observation layer view 中派生只读 evidence ledger summary，不让 snapshot 变成新的事实源。

## Decision (ADR-lite)

**Context**：地下组织已能形成多个候选并完成裁决，但后续接 AI 前必须先解决“候选和裁决为何可信”的问题。

**Decision**：本任务优先硬化 evidence ledger 与裁决归因；AI rootlet 接入延后到证据和裁决边界稳定后。

**Consequences**：短期不会提升模型能力，但会提升方向包质量、可审计性和未来 AI 接入后的守门能力。

## Out of Scope

- 不接真实 LLM、OpenAI-compatible provider 或其他模型协议。
- 不实现 UI、HTTP、SSE、WebSocket、数据库、MCP、A2A 或 AG-UI adapter。
- 不改变消息驱动架构、Runner 生命周期或公开 EventLog 阶段顺序。
- 不实现地上组织、Verification/Governance 全链路证据审计。
- 不把 evidence ledger 沉淀为 Soil、RunMemory、Capability Asset 或长期资产库。

## Technical Notes

- 相关规范：
  - `.trellis/spec/backend/underground-radial-growth.md`
  - `.trellis/spec/backend/direction-handoff-package.md`
  - `.trellis/spec/backend/observation-read-model.md`
  - `.trellis/spec/backend/quality-guidelines.md`
- 本任务承接提交：
  - `6fd5fee feat: 完善地下多候选裁决`
  - `5d9cb82 docs: 更新地下多候选裁决规范`
