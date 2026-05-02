# AgentArbor 最小闭环实现

## Goal

建立第一阶段确定性最小运行内核，证明 `Soil -> Underground Center -> .agentarbor -> Aboveground Center -> Fruits -> Governance -> Soil` 可以在内存中跑通，并形成可回放事件、产物、验证报告、Run Memory、Experience Candidate 与 Path Bias。

## Requirements

- 使用 `pnpm + TypeScript + tsc + node:test` 建立根目录工具链，脚本固定包含 `build`、`test`、`demo`。
- 在 `src/` 下按 `domain / kernel / adapters / app` 组织实现；`adapters` 暂不实现真实外部适配。
- 核心类型覆盖并尽量对齐 `docs/开发指南/04-模型与契约/04-最小运行契约.md` 中的最小运行对象：
  - `ArborMessage`
  - `Constraint`
  - `ConstraintRef`
  - `DirectionHandoff`
  - `DirectionOption`
  - `DirectionDecisionRecord`
  - `DirectionRiskRecord`
  - `ExplorationCandidateRef`
  - `ConvergenceReview`
  - `GrowthPlan`
  - `WorkflowIR`
  - `TaskSpec`
  - `NutrientRequest`
  - `NutrientPatch`
  - `ArtifactRef`
  - `RunMemory`
  - `ExperienceCandidate`
  - `PathBias`
  - `VerificationReport`
- 内存内核必须包含：
  - `InMemoryMessageBus`：支持 `publish/subscribe` 或 `publish/getMessages`，并把消息写入 EventLog；内部 agent 不能互相私聊。
  - `InMemoryEventLog`：支持 `append/list/replay`，demo 能打印完整链路。
  - `InMemoryAgentRegistry`：注册 agent manifest/capabilities。
  - `SimpleRouter`：根据 `requiredCapabilities` 分配 worker。
  - `InMemoryArtifactStore`：保存 `ArtifactRef` 和最小 artifact 内容/摘要。
  - 最小状态机：验证 Planning 前必须有 approved `DirectionHandoff`，Assigned 前必须有 `GrowthPlan`，hard constraint 可阻断或要求确认。
- demo fake agents 必须包含：
  - `UndergroundAnalyzer`：接收用户目标，生成 `ExplorationCandidateRef` 候选、`ConvergenceReview`、approved `DirectionHandoff`；单个探索 agent 输出只能作为候选，`DirectionHandoff` 只保存 `sourceCandidateRefs + convergenceReviewRef` 指向已收束结果。
  - `AbovegroundPlanner`：读取 `DirectionHandoff`，生成 `GrowthPlan`、`WorkflowIR`、`TaskSpec`。
  - `WorkerAgent`：根据任务产出 Artifact。
  - `Verifier`：生成 passed `VerificationReport`。
  - `GovernanceReview`：生成 Fruit 候选、`RunMemory`、`ExperienceCandidate`、`PathBias`。
- 固定 demo 事件流必须出现且顺序可断言：
  `goal.received -> direction_handoff.completed -> growth_plan.completed -> workflow.created -> task.created -> task.assigned -> artifact.produced -> verification.completed -> fruit.proposed -> governance.review.completed -> run_memory.captured -> experience_candidate.proposed -> path_bias.suggested`

## Acceptance Criteria

- [ ] `pnpm build` 通过。
- [ ] `pnpm test` 通过。
- [ ] 测试覆盖事件顺序。
- [ ] 测试覆盖状态守卫。
- [ ] 测试覆盖 artifact 产出。
- [ ] 测试覆盖 verification passed。
- [ ] 测试覆盖 `RunMemory`、`ExperienceCandidate`、`PathBias` 生成。
- [ ] 测试覆盖未批准 `DirectionHandoff` 不得进入 Planning。
- [ ] 测试覆盖未收束候选不得进入 `DirectionHandoff`。
- [ ] 测试覆盖 hard constraint 阻断任务。
- [ ] 测试覆盖地上组织不能自建方向探索。
- [ ] `pnpm demo` 输出完整可读 EventLog 和最终 Fruit / RunMemory / ExperienceCandidate / PathBias 摘要。

## Definition of Done

- 实现只覆盖第一阶段内存版确定性最小内核。
- 不接真实 LLM。
- 不写真实 `.agentarbor/` 运行资产。
- 不做 UI。
- 不做数据库。
- 不做 MCP / A2A / AG-UI adapter。
- 不新增 `Plan/`、`Plans/` 或过程记录型 docs。
- 如需补充文档，仅小幅更新 `docs/开发指南/06-工程实现/` 中实际命令。

## Technical Approach

采用一个确定性应用服务编排最小闭环：domain 层承载契约类型和概念树领域对象，kernel 层承载消息、事件、状态机、路由、注册表、产物存储和约束执行，app 层承载 fake agents 与 demo orchestration。核心交互通过 `InMemoryMessageBus` 进入 EventLog，应用服务负责串联 Soil、Underground Center、方向交接、Aboveground Center、执行、验证、Fruits 与 Governance。

`.agentarbor` 在本任务中只作为 `DirectionHandoff` 的领域语义和边界命名存在，不创建或写入真实 `.agentarbor/` 运行资产。

## Decision (ADR-lite)

**Context**: 仓库此前处于文档阶段，本任务是首个运行时代码落地，需要证明闭环而不是引入真实外部系统。

**Decision**: 使用根目录 `pnpm + TypeScript + tsc + node:test`，实现内存版领域/内核/app 分层和确定性 fake agents，以测试和 demo 证明闭环。

**Consequences**: 第一阶段不会证明真实模型调用、持久化、外部 adapter 或 UI，但会冻结最小运行契约、事件链、状态守卫和治理回流路径，为后续实现保留扩展口。

## Out of Scope

- 真实 LLM 调用。
- 真实 `.agentarbor/` 运行资产写入。
- UI。
- 数据库和持久化。
- MCP / A2A / AG-UI adapter。
- 平台 agent、skill 或插件实现。
- 长期 Capability Asset 入土。

## Technical Notes

- User confirmed this is the "AgentArbor 最小闭环实现计划" and requested direct implementation.
- Required source documents read before implementation:
  - `AGENTS.md`
  - `docs/开发指南/06-工程实现/06-最小实现边界.md`
  - `docs/开发指南/04-模型与契约/04-最小运行契约.md`
  - `docs/开发指南/06-工程实现/02-模块划分.md`
  - `.trellis/spec/guides/agentarbor-governance-guide.md`
- Additional implementation-relevant documents read:
  - `docs/README.md`
  - `docs/开发指南/README.md`
  - `docs/开发指南/00-总览.md`
  - `docs/开发指南/01-基础/README.md`
  - `docs/开发指南/02-核心闭环/README.md`
  - `docs/开发指南/03-系统架构/README.md`
  - `docs/开发指南/04-模型与契约/README.md`
  - `docs/开发指南/04-模型与契约/02-工作流中间表示.md`
  - `docs/开发指南/04-模型与契约/07-约束工程.md`
  - `docs/开发指南/06-工程实现/01-技术主线.md`
  - `docs/开发指南/06-工程实现/03-人工智能与确定性边界.md`
  - `docs/开发指南/06-工程实现/04-测试与验收.md`
  - `docs/开发指南/06-工程实现/07-阶段验收边界.md`
  - `docs/任务看板/README.md`
  - `docs/任务看板/看板.md`
