# 产品架构

本目录保存 AgentArbor 产品形态、原生概念树架构、智能体体系、通信机制和治理回流的长期结构性决策。

## 职责

此目录保存 AgentArbor 产品的核心架构决策，包括：

- 原生概念树：Soil、Underground Center、`.agentarbor`、Aboveground Center、Fruits、Governance。
- 智能体体系：地下中枢、地上中枢、地上生长组织、果实治理和可脱离能力。
- 系统机制：方向交接包、Growth Plan、Workflow IR、状态机、演化系统和验收矩阵。

## 与其他目录的关系

- 与 `协议边界/` 分离：协议边界关注“用什么格式”，架构关注“怎么设计”。
- 与 `工作区结构/` 分离：工作区结构关注“文件放哪里”，架构关注“系统怎么运作”。

## 当前决策

- [ADR-0018-AgentArbor原生概念树架构.md](ADR-0018-AgentArbor原生概念树架构.md)：当前产品架构事实源，定义 `Soil -> Underground Center -> .agentarbor -> Aboveground Center -> Fruits -> Governance -> Soil`。
- [ADR-0013-内核自研与协议适配边界.md](ADR-0013-内核自研与协议适配边界.md)：规定 AgentArbor 内部运行时使用自研消息、状态、路由和治理骨架，外部协议只通过 adapter 接入。
- [ADR-0014-Agent集群与运行即沉淀.md](ADR-0014-Agent集群与运行即沉淀.md)：规定 Agent 集群是运行血肉，每次运行都必须形成运行沉淀，并让后续相似任务形成 Path Bias。
- [ADR-0015-树形语义基线与Root重定义.md](ADR-0015-树形语义基线与Root重定义.md)：定义植物学语义基础，可作为地下中枢、地上中枢和果实治理的背景材料。
- ADR-0016 保存需求成形与养料供给的背景材料，当前正式语义以 ADR-0018 为准。
- [ADR-0017-约束工程与可执行约束模型.md](ADR-0017-约束工程与可执行约束模型.md)：规定约束工程、Constraint / ConstraintRef、约束生命周期和 Path Bias 不能覆盖硬约束的边界。
- [ADR-0019-地下辐射生长模型.md](ADR-0019-地下辐射生长模型.md)：作为 ADR-0018 的下位细化，规定 Underground Center 采用中枢固定、根须动态、探索发散、方向收束的地下辐射生长模型。
- [ADR-0020-智能通道与模型接入边界.md](ADR-0020-智能通道与模型接入边界.md)：规定所有模型调用必须通过智能通道，provider adapter 不能污染核心领域模型，模型与工具输出必须经过安全投影、契约校验和运行边界守卫。
- [ADR-0021-地下Agent集群AI优先架构重构.md](ADR-0021-地下Agent集群AI优先架构重构.md)：修正地下集群信任层级，明确 rootlet/subagent/tool/search 输出是未收束材料，上层中枢 agent / ConvergenceJudge / HandoffSteward 是语义判断主路径，确定性逻辑只守 schema、权限、预算、hard constraint、谱系和文件边界。
- [植物学融合架构/](植物学融合架构/)：当前详细架构资料，围绕原生概念树解释地下成形、方向交接、地上生长、果实治理和土壤回流。
