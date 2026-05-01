# 方向交接包与 GrowthPlan

## 关系

Direction Handoff 和 GrowthPlan 是地下成形与地上计划的边界。

```text
Soil -> Underground Center -> .agentarbor Direction Handoff -> Aboveground Center -> GrowthPlan -> Workflow IR
```

Direction Handoff 只表达方向、证据、约束和升级条件，不直接决定执行。GrowthPlan 才是执行前计划入口。

## Direction Handoff 必填内容

- `sourceGoalId`：来源目标。
- `version`：方向交接包版本。
- `clarifiedGoal`：对目标的结构化理解。
- `nonGoals`：明确不做什么。
- `soilRefs`：可复用 Soil 资产、规则、失败模式和历史证据引用。
- `evidenceRefs`：证据来源。
- `missingInformation`：仍未确认的信息。
- `constraintRefs`：目标、权限、时间、技术和治理约束的引用。自然语言说明只能解释背景，不能替代可执行约束源。
- `risks`：执行和交付风险。
- `options`：可选方向。
- `decisionRecord`：方向保留、合并、淘汰、用户确认和备选方向的裁决记录。
- `riskRegister`：风险、反驳、失败模式和阻断项。
- `recommendedOptionId`：地下中枢推荐方向。
- `growthEntry`：地上中枢可接管的入口、运行形态建议和升级条件。

## Direction Handoff Package V0.2 契约

第一阶段 V0.2 将内存中的 `DirectionHandoff` 边界扩展为可校验、可序列化、可读写的 Direction Handoff Package。包裹内容包括：

- `DirectionHandoff`：方向、约束引用、Soil 引用、证据索引、风险和 Growth Entry。
- `ConvergenceReview`：候选材料交叉校验、去重、归因和裁决记录。
- candidate reference index：只保存候选引用、来源和收束状态。
- package manifest / file list：声明包版本、方向 ID、状态和文件契约。
- validation result：以 `passed`、`errors`、`warnings` 记录包是否可被地上中枢接管。

文件契约固定为：

```text
handoff.meta.json
direction.md
options.json
decision-record.md
constraints.json
soil-refs.json
evidence-index.md
risk-register.md
open-questions.md
escalation-rules.md
growth-entry.json
```

`options.json`、`decision-record.md` 和 `risk-register.md` 仍然只是方向证据，不能变成 GrowthPlan。地上中枢必须从已保存的 package 按 `directionId + version` 加载并校验，不能从临时拼出来的 handoff 材料直接规划。

验证规则至少包含：

- `status` 必须是 `approved` 才能进入地上规划。
- 必须存在 `convergenceReviewRef`。
- 必须存在 `sourceCandidateRefs`，且候选只能是已收束的 `accepted` 或 `merged` 引用。
- package 只能保存 Soil 引用，不能内联 Soil 资产正文、内容副本或 body。
- package 不能内联 GrowthPlan；GrowthPlan 只能由 Aboveground Center 在校验通过后生成。

默认运行路径使用内存 store。文件系统 store 只能在调用方显式传入根目录时使用；当前 demo 和默认测试不得创建 repo-root `.agentarbor/` 运行资产。

## GrowthPlan 必填内容

- `goal`：目标摘要。
- `directionHandoffVersion`：引用的 Direction Handoff 版本。
- `planVersion`：计划版本。
- `selectedDirection`：地上中枢选定方向。
- `pathBiasDecision`：采用、调整、拒绝或无可用 Path Bias。
- `workflowIr`：工作流中间表示。
- `runtimeShape`：运行组织形态。
- `tasks`：任务列表。
- `reuseStrategy`：资产复用策略。
- `sedimentationStrategy`：Run Memory、Experience Candidate 和 Capability Asset 的沉淀策略。
- `constraintRefs`：本计划采用的约束集合。
- `constraintDistribution`：约束如何分发到任务、工具执行门和验证门。
- `verificationGates`：验证和验收门。
- `nutrientRequestTriggers`：允许向地下中枢请求养料的触发点。

## GrowthPlan Revision

GrowthPlan 必须支持修订。修订必须记录：

- 来源 GrowthPlan 版本。
- 新 Direction Handoff 版本、Nutrient Patch 或无需补充证据。
- 修订原因。
- 影响范围。
- 继续、回退、分叉或停止决策。
- Workflow IR 变化。

## 决策规则

Aboveground Center 制定或修订 GrowthPlan 时必须显式回答：

- 为什么选择这个方向。
- 哪些 Direction Handoff 证据被采用。
- 哪些 Path Bias 被采用或拒绝。
- 哪些 hard constraint 会阻断行动，哪些 soft constraint 允许偏离但必须解释，哪些 preference 只用于方案排序。
- 本次任务采用哪种运行组织形态。
- 哪些结果有沉淀价值。
- 哪些节点需要人工确认。
- 哪些情况会触发 Nutrient Request。

如果 Direction Handoff 缺少关键证据或养料，Aboveground Center 应向 Underground Center 发起 Nutrient Request，而不是用猜测补齐计划，也不是自建方向探索集群。

如果约束之间存在冲突，Aboveground Center 必须根据约束的 `conflictPolicy` 请求用户确认、治理复核、Nutrient Request 或 GrowthPlan Revision，不能把冲突留给地上执行组织自行判断。
