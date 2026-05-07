# Plan Package 与执行计划

## 关系

Plan 是 Underground Cognitive Runtime 到 Aboveground Execution Runtime 的产品级交接对象。

```text
Task Soil -> Underground Cognitive Runtime -> Plan -> Aboveground Execution Runtime -> Workflow IR / tool actions / Verification
```

Plan 表达方向、证据、约束、风险、不确定性、执行入口和验证要求。Aboveground 才负责把 Plan 转成具体执行步骤、工具调用、文件修改、文档生成、原型制作和验证。

`.agentarbor` 是 Plan Package 的实现/存储形态或目录名，不再作为产品概念树的独立节点。对用户和产品文档应优先讲 Plan；“方向交接”只作为 Underground 到 Aboveground 的内部边界说法。

## Plan 必填内容

- `planId`：Plan 标识。
- `version`：Plan 版本。
- `status`：`draft`、`awaiting_user`、`approved`、`stopped`、`superseded`。
- `sourceTaskRef`：来源任务。
- `taskSoilRefs`：当前任务材料引用。
- `globalSoilRefs`：可复用 Global Soil 资产、规则、失败模式和 Path Bias 引用。
- `goalSummary`：对目标的结构化理解。
- `nonGoals`：明确不做什么。
- `constraints`：目标、权限、时间、技术和治理约束引用；自然语言说明只能解释背景，不能替代可执行约束源。
- `evidenceRefs`：证据来源。
- `options`：可选方向。
- `decisionRecord`：方向保留、合并、淘汰、用户确认和备选方向的裁决记录。
- `riskRegister`：风险、反驳、失败模式和阻断项。
- `missingInformation`：仍未确认的信息。
- `recommendedDirection`：父层 convergence 后的推荐方向。
- `executionEntry`：Aboveground 可接管的入口、运行形态建议和升级条件。
- `verificationRequirements`：执行后必须证明什么。
- `reasoningTraceRefs`：安全 reasoningTrace 投影引用。

## Plan Package 契约

Plan Package 是 Plan 的可校验、可序列化、可读写形式。它可以保存在内存、显式输出目录或未来 `.agentarbor/` 目录下。

Plan Package 至少包含：

- Plan 主体。
- 父层 synthesis / convergence 记录引用。
- child/rootlet 输出引用索引。
- evidence / constraint / risk 引用索引。
- package manifest。
- validation result。

不再扩张旧 10 文件方向交接包契约。文件形态应服务可读性和审计，不应把每个概念强拆成固定文件。当前实现可先采用少量稳定文件，例如：

```text
plan.md
plan.json
refs.json
validation.json
manifest.json
```

如果为了兼容历史实现继续存在 `direction.md`、`options.json`、`decision-record.md`、`risk-register.md` 等文件，它们只能作为 Plan Package 的内部文件，不能重新变成产品概念节点。

验证规则至少包含：

- `status` 必须是 `approved` 才能进入 Aboveground 执行。
- 无 `AgentTurnRuntime` 不允许产出 `approved` Plan。
- 必须存在父层 synthesis / convergence 引用。
- child/rootlet 输出只能以引用形式进入 Plan，且必须经过父层收束。
- package 只能保存 Global Soil 引用，不能内联 Global Soil 资产正文或内容副本。
- package 不能内联执行成果；执行成果属于 Fruits。

默认运行路径使用内存 store。文件系统 store 只能在调用方显式传入根目录时使用；当前 demo 和默认测试不得创建 repo-root `.agentarbor/` 运行资产。

## Aboveground Execution Plan

Aboveground Execution Runtime 从 approved Plan 生成执行计划。执行计划不是地下 Plan 的替代物，而是执行层内部工作对象。

执行计划至少包含：

- `sourcePlanVersion`：引用的 Plan 版本。
- `selectedDirection`：采用的方向。
- `pathBiasDecision`：采用、调整、拒绝或无可用 Path Bias。
- `workflowIr`：工作流中间表示。
- `runtimeShape`：执行组织形态。
- `tasks`：任务列表。
- `reuseStrategy`：资产复用策略。
- `sedimentationStrategy`：Run Memory、Experience Candidate 和 Capability Asset 的沉淀策略。
- `constraintRefs`：本次执行采用的约束集合。
- `constraintDistribution`：约束如何分发到任务、工具执行门和验证门。
- `verificationGates`：验证和验收门。
- `nutrientRequestTriggers`：允许向地下运行时请求养料的触发点。

## Plan Revision

Plan 必须支持修订。修订必须记录：

- 来源 Plan 版本。
- Nutrient Patch、Plan Supplement 或 Plan vNext。
- 修订原因。
- 影响范围。
- 继续、回退、分叉或停止决策。
- Workflow IR 变化。

## 决策规则

Aboveground 制定或修订执行计划时必须显式回答：

- 为什么采用这个 Plan。
- 哪些 Plan 证据被采用。
- 哪些 Path Bias 被采用、调整或拒绝。
- 哪些 hard constraint 会阻断行动，哪些 soft constraint 允许偏离但必须解释，哪些 preference 只用于方案排序。
- 本次任务采用哪种执行组织形态。
- 哪些结果有沉淀价值。
- 哪些节点需要人工确认。
- 哪些情况会触发 Nutrient Request。

如果 Plan 缺少关键证据或养料，Aboveground 应发起 Nutrient Request，而不是用猜测补齐，也不是自建方向探索集群。
