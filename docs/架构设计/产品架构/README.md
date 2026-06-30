# 产品架构

本目录保存 AgentArbor 产品形态、运行时边界、智能体体系、通信机制和治理回流的长期结构性决策。

## 职责

此目录保存 AgentArbor 产品的核心架构决策，包括：

- 桌面基础 Agent：当前默认实现路线是普通模式 `agent`，即 Desktop Basic Agent Runtime、工具系统、安全确认、运行事件、持久化和工作台。
- 桌面通用 Agent 长期愿景：Desktop Shell、Task Soil、Main Canvas、Artifact Area 和 Observation Panel。
- 双运行时：Underground Cognitive Runtime 与 Aboveground Execution Runtime 共享 Shared Agent Kernel，但当前只作为深入模式 `deep` / advanced / compatibility 路径显式启用。
- Plan：地下到地上的产品级交接对象；`.agentarbor` 只作为 Plan Package 的实现/存储形态。
- 智能体体系：Agent Fabric、动态派生 child agent、父层 synthesis / convergence 和权限边界。
- 治理回流：Run Memory、Experience Candidate、Governance Pipeline、Capability Asset、Path Bias 和 Global Soil。

## 与其他目录的关系

- 与 `协议边界/` 分离：协议边界关注“用什么格式”，架构关注“怎么设计”。
- 与 `工作区结构/` 分离：工作区结构关注“文件放哪里”，架构关注“系统怎么运作”。

## 当前决策

- [ADR-0024-桌面基础Agent与基础设施优先路线.md](ADR-0024-桌面基础Agent与基础设施优先路线.md)：当前活跃实现路线，规定默认先建设桌面基础 Agent、工具系统、安全确认、事件重放、RuntimeDatabase、Skills 最小闭环和工作台信息架构；ADR-0022 保留长期愿景。基础 Agent 路线稳定后已阶段演进重启 deep（不废弃本 ADR，普通 Agent 默认主线地位不变）。
- [ADR-0026-子Agent工具能力架构.md](ADR-0026-子Agent工具能力架构.md)：子 Agent 工具能力架构决策（Accepted）。将子 Agent 实现为普通 Agent 的工具能力而非独立编排流程，三个工具（`call_sub_agent` / `call_sub_agents` / `spawn_sub_agent`）注册到 `desktop-basic` scope；定义格式复用 Skill 模式（Markdown + YAML frontmatter），`builtin / user / project` 三级发现，stub + 动态注册运行时集成，强制一层约束（不可递归派生），复用 `IntelligenceChannel` / `ToolExecutionBroker` / `ToolCenter` / 确认机制；与 ADR-0025 deep 编排互补不冲突。
- [ADR-0025-deep一期Manager自由决策循环与一层child最小闭环.md](ADR-0025-deep一期Manager自由决策循环与一层child最小闭环.md)：deep 一期架构决策（Accepted）。在 ADR-0024 基础上重启 deep 为显式并行入口，采用 manager 自由决策循环、强制一层 child（`depth=1`）、非 Plan 交接（产物为 `SynthesizedConclusion` / `DeepExplorationReport`）；新建 DeepRuntime 边界不转正旧文件，复用共享设施；承接 ADR-0021 的本期 deep 实现决策。
- [ADR-0022-AgentArbor桌面通用Agent与双运行时架构.md](ADR-0022-AgentArbor桌面通用Agent与双运行时架构.md)：当前产品架构事实源，定义 `Desktop Shell -> Task Soil -> Underground Cognitive Runtime -> Plan -> Aboveground Execution Runtime -> Fruits -> Governance Pipeline -> Global Soil`。
- [ADR-0018-AgentArbor原生概念树架构.md](ADR-0018-AgentArbor原生概念树架构.md)：历史概念树架构，已被 ADR-0022 部分取代；保留植物学职责边界和术语来源。
- [ADR-0013-内核自研与协议适配边界.md](ADR-0013-内核自研与协议适配边界.md)：规定 AgentArbor 内部运行时使用自研消息、状态、路由和治理骨架，外部协议只通过 adapter 接入。
- [ADR-0014-Agent集群与运行即沉淀.md](ADR-0014-Agent集群与运行即沉淀.md)：规定 Agent 集群是运行血肉，每次运行都必须形成运行沉淀，并让后续相似任务形成 Path Bias。
- [ADR-0015-树形语义基线与Root重定义.md](ADR-0015-树形语义基线与Root重定义.md)：定义植物学语义基础，当前只作为 Task Soil、Global Soil、Underground、Aboveground、Fruits 和 Governance Pipeline 的背景材料。
- ADR-0016 保存需求成形与养料供给的背景材料，当前正式语义以 ADR-0022 为准。
- [ADR-0017-约束工程与可执行约束模型.md](ADR-0017-约束工程与可执行约束模型.md)：规定约束工程、Constraint / ConstraintRef、约束生命周期和 Path Bias 不能覆盖硬约束的边界。
- [ADR-0019-地下辐射生长模型.md](ADR-0019-地下辐射生长模型.md)：作为 Underground Cognitive Runtime 的背景细化，规定中枢固定、根须动态、探索发散、方向收束。
- [ADR-0020-智能通道与模型接入边界.md](ADR-0020-智能通道与模型接入边界.md)：规定所有模型调用必须通过智能通道，provider adapter 不能污染核心领域模型，模型与工具输出必须经过安全投影、契约校验和运行边界守卫。
- [ADR-0021-地下Agent集群AI优先架构重构.md](ADR-0021-地下Agent集群AI优先架构重构.md)：规定 Underground Cognitive Runtime 的 AI-first 主线，明确 rootlet/subagent/tool/search 输出是未收束材料，上层中枢 agent / ConvergenceJudge / Handoff / Plan Steward 是语义判断主路径。（状态 Superseded-by ADR-0025：AI 优先诊断价值保留为历史价值，deep 一期实现决策由 ADR-0025 承接，不转已接受。）
- [ADR-0023-LocalRuntimeLiteProfile与未来FullProfile演进边界.md](ADR-0023-LocalRuntimeLiteProfile与未来FullProfile演进边界.md)：定义当前 Lite Profile 与未来 Full Profile 的演进关系，说明当前阶段如何以轻量桌面 Agent 工作流承接 ADR-0022，并规定 Lite 和 Full 共用运行时契约，避免形成两套架构。
- [植物学融合架构/](植物学融合架构/)：历史详细架构资料，保留参考价值；与 ADR-0022 冲突时，以 ADR-0022 和当前开发指南为准。
