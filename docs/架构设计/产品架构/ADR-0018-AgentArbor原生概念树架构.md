# ADR-0018: AgentArbor 原生概念树架构

日期：2026-05-01

状态：Superseded by [ADR-0022-AgentArbor桌面通用Agent与双运行时架构](ADR-0022-AgentArbor桌面通用Agent与双运行时架构.md)

## 现状说明

本 ADR 保留 AgentArbor 早期原生概念树、植物学职责边界和历史术语来源，但不再作为当前产品架构事实源。当前事实源是 ADR-0022：

```text
Desktop Shell
  -> Task Soil
  -> Underground Cognitive Runtime
  -> Plan
  -> Aboveground Execution Runtime
  -> Fruits
  -> Governance Pipeline
  -> Global Soil
```

后续文档和实现应优先使用 Task Soil、Global Soil、Plan、Shared Agent Kernel、Underground Cognitive Runtime、Aboveground Execution Runtime 和 Governance Pipeline。`.agentarbor` 只作为 Plan Package 的实现/存储形态或目录名保留。

## 原始决策

AgentArbor 当时采用原生概念树作为产品架构事实源：

```text
Soil
  -> Underground Center
  -> .agentarbor
  -> Aboveground Center
  -> Fruits
  -> Governance
  -> Soil
```

这条链路表达一次 Agent / AgentApp 孕育与演化的完整闭环：

- `Soil` 保存长期事实、治理规则、能力资产、历史证据、失败模式、权限边界和可复用约束。
- `Underground Center` 负责需求成形、用户确认、约束提取、土壤检索、证据探索、方向综合和运行期养料供给。
- `.agentarbor` 是地下中枢交给地上中枢的方向交接包，不是最终资产仓库，也不是 Soil 的副本。
- `Aboveground Center` 负责把方向交接包转成 Growth Plan、Workflow IR、上下文拓扑、执行组织、验证门和修订机制。
- `Fruits` 保存交付物、AgentApp、能力包、可脱离子 agent、运行报告和可复用经验候选。
- `Governance` 负责成熟度评估、权限审查、谱系归因、版本管理、导出、退役和是否入土的最终裁决。
- 回到 `Soil` 的只允许是通过治理的 Capability Asset、长期约束、Path Bias、验证证据、失败模式和可复用资料。

## 概念树分工

| 概念树节点 | 职责 | 主要交付物 | 禁止误用 |
| --- | --- | --- | --- |
| Soil | 固定资产与治理土壤 | Capability Asset、治理规则、历史证据、失败模式、长期约束、Path Bias | 不能接收未治理果实或临时运行材料 |
| Underground Center | 地下中枢，负责需求成形、方向探索和养料供给 | 用户确认记录、约束候选、证据索引、方向判断、Nutrient Patch | 不能制定地上执行计划，不能直接产出最终果实 |
| `.agentarbor` | 方向交接包 | Direction Brief、ConstraintRef、Soil 引用、证据索引、升级条件、Growth Entry | 不能成为最终资产库，不能复制 Soil 形成第二事实源 |
| Aboveground Center | 地上中枢，负责计划化和生长控制 | Growth Plan、Workflow IR、Context Topology、TaskSpec、Verification Plan | 不能绕过方向交接包直接执行 |
| Fruits | 果实与候选沉淀 | 交付物、AgentApp、能力包、Run Memory、Experience Candidate、可脱离子 agent 候选 | 不能自动等同于 Soil |
| Governance | 治理回流 | 晋升、拒绝、退役、版本、权限、谱系、验证结论 | 不能省略证据和权限边界 |

## 地下中枢

地下中枢吸收 Seed 与 Root 的职责，但不再把它们暴露为相互竞争的主架构层。

地下中枢必须完成：

- 把用户想象整理成可判断目标、非目标、约束、风险和验收条件。
- 在授权边界不清、目标冲突、关键事实缺失、成本风险不明或不可逆动作前询问用户。
- 读取 Soil 中的能力资产、约束、历史证据、失败模式和 Path Bias。
- 做必要的外部事实核验和内部证据对齐。
- 形成方向判断，并把证据、约束、假设和升级条件写入 `.agentarbor` 方向交接包。
- 在地上生长暴露养料缺口时响应 Nutrient Request，补充证据、Soil 引用、约束细节、外部事实或能力线索，并输出 Nutrient Patch 或新的方向交接包版本。

地下中枢不生成 Growth Plan，不调度地上执行，不把候选经验写入 Soil。

## `.agentarbor` 方向交接包

`.agentarbor` 是从地下到地上的方向交接层。它在未来运行时中以机器可读和人类可读混合形式存在，用来让地上中枢接管方向，而不是保存最终资产。

最低内容应包括：

```text
.agentarbor/
  direction.md
  constraints.json
  soil-refs.json
  evidence-index.md
  open-questions.md
  escalation-rules.md
  growth-entry.json
  handoff.meta.json
```

最低字段应覆盖：

- `directionId`、`version`、`sourceGoalRef`、`createdAt`。
- 用户确认过的目标、非目标、权限、成本和验收门。
- `ConstraintRef` 与候选约束的状态区分。
- Soil 引用，而不是 Soil 内容复制。
- 证据来源、未决问题、适用条件和不适用条件。
- 地上中枢可选择的 Growth Plan 入口。
- 触发 Nutrient Request、用户升级确认或治理复核的条件。

当前仓库不创建 `.agentarbor/` 运行时资产。只有在契约、读写规则、验证方式和真实出生依据稳定后，才允许增量创建。

## 地上中枢与地上生长

地上中枢吸收 Core、Branch、Leaf 和 Flower 的职责，并把它们组织为计划、调度、执行、验证和修订机制。

地上中枢必须完成：

- 读取 `.agentarbor` 方向交接包。
- 制定 Growth Plan，并明确采用、调整或拒绝哪些 Path Bias。
- 生成 Workflow IR，并把约束分发到任务、工具执行门和验证门。
- 根据任务规模选择 single agent、sub-agent tree、shared team cluster 或 competitive team cluster。
- 组织地上生长节点执行、提交证据和接受验证。
- 在缺少证据、Soil 资产适配、约束细节、外部事实、上下文养料或能力线索时发起 Nutrient Request。地上中枢不自建方向探索集群替代地下组织。
- 形成果实，并把候选沉淀交给 Governance，而不是直接写回 Soil。

## 果实与治理

Fruit 不是 Soil。Fruit 可以是用户交付物、AgentApp、能力包、可脱离子 agent、运行报告或可复用经验候选。它只有通过 Governance 后，才可能以明确类型回流到 Soil。

治理门必须检查：

- 用户目标和验收条件是否满足。
- hard constraint 是否全部满足。
- soft constraint 的偏离是否有记录和证据。
- preference 与 Path Bias 是否只影响排序，没有覆盖硬约束。
- 来源谱系是否完整。
- 权限、密钥、资产范围和导出边界是否收敛。
- 版本、适用条件、不适用条件、评估记录和退役路径是否存在。

未通过治理的果实只能作为临时交付物、归档证据或候选经验，不能进入 Soil。

## 用户升级确认

用户不需要在每个内部阶段重复确认。系统只在以下情况升级给用户：

- 目标、非目标、权限、成本、安全边界或验收门不清。
- 地下中枢发现用户目标互相冲突。
- 地上中枢需要执行高风险、不可逆或越权动作。
- Governance 需要决定果实是否脱离母体、导出或进入长期土壤。
- Soil 中的长期规则与本次用户目标冲突。

## 后果

- 历史文档入口曾直接讲原生概念树，不再把 Seed、Root、Core、Branch、Leaf、Flower 写成并列主层。
- Seed 语义归入地下中枢的需求成形职责。
- Root 语义归入地下中枢的证据探索、方向综合和养料供给职责。
- Core、Branch、Leaf、Flower 语义归入地上中枢和地上生长职责。
- `.agentarbor` 只承担方向交接，不能承担最终资产沉淀。
- Fruits 与 Soil 之间必须经过 Governance，不能直接入土。

## 相关文档

- [产品架构索引](README.md)
- [植物学融合架构](植物学融合架构/README.md)
- [开发指南总览](../../开发指南/00-总览.md)
- [系统架构](../../开发指南/03-系统架构/README.md)
- [模型与契约](../../开发指南/04-模型与契约/README.md)
