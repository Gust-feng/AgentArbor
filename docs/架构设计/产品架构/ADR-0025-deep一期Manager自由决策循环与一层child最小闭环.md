# ADR-0025: deep 一期 Manager 自由决策循环与一层 child 最小闭环

日期：2026-05

状态：Accepted

承接关系：Refines [ADR-0022-AgentArbor桌面通用Agent与双运行时架构](ADR-0022-AgentArbor桌面通用Agent与双运行时架构.md)（长期架构）、阶段演进了 [ADR-0024-桌面基础Agent与基础设施优先路线](ADR-0024-桌面基础Agent与基础设施优先路线.md)（基础 Agent 路线稳定后重启 deep 为显式入口）、Supersedes [ADR-0021-地下Agent集群AI优先架构重构](ADR-0021-地下Agent集群AI优先架构重构.md) 的本期 deep 实现决策（保留 ADR-0021 的 AI 优先诊断价值，详见 ADR-0021）。本 ADR 是 Underground Cognitive Runtime 一期（一层 child 最小闭环）的权威决策，是 DeepRuntime 代码实现的契约依据；不含 Plan / Aboveground / Fruits / Governance / Global Soil 回流。

> 命名口径：遵循 [05-Agent口径与命名](../../开发指南/01-基础/05-Agent口径与命名.md)。`deep / Underground` 只在真正做多 child 探索并由父层综合时使用，本期成立。`runMode: "deep"` 仅表示编排策略选择。

## 决策

在普通桌面 Agent 默认路线稳定（ADR-0024）后，重启 `deep` 作为**显式并行入口**，交付 Underground Cognitive Runtime **一层 child 最小闭环**。本期 deep 不另起平行运行时，而是**新建一个 DeepRuntime 编排策略边界**（DeepConversation / DeepRuntime / DeepRunExecutor + Child Delegation + Parent Synthesis），复用普通 Agent 已成熟的共享设施。

本 ADR 记录四项核心决策：

1. **manager 自由决策循环**：deep 一期采用 manager AI 优先自由决策循环，决策由模型语义推理产出，非确定性模板；吸收 `cognitive-work-session-*` 的 action loop 语义为**设计输入**，但**新建 DeepRuntime 边界，不转正任何旧文件**。
2. **强制一层 child**：`depth = 1`，child 不可递归派生子 child。
3. **非 Plan 交接**：一期产物统一为 `SynthesizedConclusion`（结论级）与 `DeepExplorationReport`（运行级），不走 Plan / directionHandoffPackage / artifact / Fruits。
4. **②' 固定拓扑与 Plan/Handoff 耦合作为已评估未采纳方案**：不作为本期骨架；其沉淀在 `domain/underground/` 的领域抽象（AgentLoop / Guard / run tree / 事件契约 / Workspace / Mailbox）保留并复用。

## 动机

ADR-0024 阶段把"可见 deep 入口和 deep 后端扩展"列在"默认不做"，使普通 Agent 路线稳定。基础 Agent 路线稳定后，项目正式重启 deep。重启必须回答三个问题：

- deep 一期用什么编排模型？历史有两类候选：③ `cognitive-work-session-*` 的 manager 自由决策 action loop（自标注 legacy、产物走 artifact），②' `underground/orchestrator*` 的固定拓扑 DAG（强耦合 Plan/Handoff）。两者均不能直接原地转正。
- child 探索到什么层级？ADR-0022 的 Agent Fabric MVP 阶段硬约束是一层 child（`depth = 1`），一期沿用。
- 一期交接产物用什么语义？Plan / directionHandoffPackage 属于 Aboveground / 长期范围，一期 Out of Scope；artifact / Fruits 也超出本期。需要一个克制、准确的产物命名。

经设计评估（详见 `.cospec/multi-agent/design.md` v2.0），本期采用 manager 自由决策循环 + 一层 child + 非 Plan 交接 + 新建 DeepRuntime 边界的组合，既落地 ADR-0022 的"manager 语义决策 + 一层 child + descendant output 经父层 synthesis"语义，又避免把任何 legacy 文件原地转正或固化一个未采用的固定拓扑决策。

## 关键决策

### 决策一：manager 自由决策循环（AI 优先）

- deep 一期以 **manager 自由决策循环**为编排主线。manager 逐 step 通过 `AgentTurnRuntime` 调用模型产出 `DelegationDecision`，决策由模型语义推理产出，**非确定性模板**。
- manager 决策动作集为六动作：`direct_answer / spawn_children / wait_children / synthesize / ask_user / stop`。该动作集吸收 `cognitive-work-session-*`（③）已实现的 action loop 语义作为**设计输入**，但 ③ 文件本身自标注 legacy、产物走 `artifactStore`（Fruits 语义），与本期"综合结论"语义不一致，因此**不转正 ③**。
- **AI-first 边界**：manager 在证据不足时选择继续派生 child 或 `ask_user`，不伪装成已完成判断；无可用模型时 deep 拒绝运行，不用确定性 fallback 伪装成已完成判断。
- 确定性逻辑只守边界：schema、预算、权限、一层 child 硬约束、child output 不直通结论、`capabilitySnapshot` 冻结；不替代 manager 的目标理解、候选取舍、是否继续探索、风险权衡与方向综合。

### 决策二：强制一层 child（depth = 1）

- 本期 child 探索强制 `depth = 1`：child 由 manager 按 `DelegationDecision.childSpecs` 动态派生，**child 不可递归派生子 child**。
- 一层 child 硬约束由确定性 Guard 强制校验：递归派生子 child 在 AgentRunTree 写入前被拒绝。
- child 工具调用经共享 `ToolCenter` 与 `Confirmation Gate`，沿用普通 Agent 的工具边界与确认语义；child 数量有上限，超出时 manager 必须收束或 `ask_user`。
- child 产出为**局部材料**，保留来源、证据引用、置信度、适用条件与失败条件；不能直接成为结论。
- 一层 child 是本期闭环假设；多层递归 Agent Fabric（`depth ≥ 2`）属长期范围，不在本期。

### 决策三：非 Plan 交接（一期产物命名）

一期产物**统一命名**，不混用 Plan / directionHandoffPackage / artifact / Fruits：

| 产物 | 层次 | 内容 | 明确不走 |
|------|------|------|----------|
| `SynthesizedConclusion` | 结论级（单次 synthesis 产出） | 结论 + 一句话理由 + 关键证据引用 + 候选取舍（为什么选 A / 为什么不选 B）+ 主要不确定性 | 不叫 Plan；不走 `directionHandoffPackage`（②' orchestrator 强耦合）；不走 `artifactStore` / Fruits（③ 终端产出语义） |
| `DeepExplorationReport` | 运行级（一次 deep run 产出） | AgentRunTree + 各 child 探索摘要 + 父层 synthesis 记录 + SynthesizedConclusion | 不叫 Plan Package / DirectionHandoff |

child output **不直通结论**：综合结论的 outputRefs 与 child outputRefs 做断言校验（吸收 ③ `assertNoDirectChildOutputHandoff` 语义），直通交接被拒绝。父层综合由模型完成，可对冲突材料做对比、反驳、合并、降权、追问或停止。

### 决策四：②' 固定拓扑未采纳但领域抽象保留复用

- ②' `underground/orchestrator*` 的**固定拓扑 DAG**（IntentCore→GrowthGovernor→RootletExplorer→CandidateCollector→AutonomyReviewer→ConvergenceJudge→HandoffSteward 硬编码推进）与 **`directionHandoffPackage` 强耦合**，经评估**不作为本期骨架**：固定拓扑把 manager 决策替换为固定阶段，超出最小闭环范围；Plan/Handoff 在本期 Out of Scope。
- 该评估**不否定** ②' 的全部价值。②' 沉淀在 `domain/underground/` 下的领域抽象有长期积累价值，**保留并复用**：

  | 保留复用的领域抽象 | 积累价值 |
  |--------------------|----------|
  | `domain/underground/agent-loop.ts` | AgentLoop 抽象（agent 运行循环边界） |
  | `domain/underground/guard.ts` | Guard 确定性守卫（权限/预算/硬约束/证据校验边界） |
  | `domain/underground/contracts.ts` | AgentRunTree / ChildAgentRun / ParentSynthesisResult 等 run tree 契约 |
  | `domain/underground/workspace.ts` / `mailbox.ts` | WorkspaceView / Mailbox（agent 工作区与消息边界） |
  | `domain/underground/evidence-ledger.ts` 等 | 证据/候选/报告领域逻辑 |

- DeepRuntime 通过**契约 import 复用**上述领域抽象，不复制其实现，也不重定义。

## 新建 DeepRuntime 边界（不转正旧文件）

- DeepRuntime 是**新建的正式边界**，不是任何旧文件（`cognitive-work-session-*` / `underground/orchestrator*` / `underground-direction-session*`）改名为正式主线。旧文件本期定位为 DeepRuntime 的**设计参考来源**与**迁移前兼容路径**；其去留按渐进迁移与退役策略处理，不激进删除。
- DeepRuntime 的"新"只体现在**编排策略边界**（DeepConversation 会话隔离 / DeepRunExecutor manager 决策循环 / Child Delegation / Parent Synthesis）；其依赖的全部运行能力**复用**现有共享设施，不另起平行运行时。

## 复用边界（复用而非另起）

DeepRuntime 通过契约使用以下共享设施，不复制其实现：

- `AgentTurnRuntime`：manager / child / synthesis 各自经它调用模型（模型→工具→模型循环）。
- `ToolCenter` + `Confirmation Gate`：child 工具调用经同一套执行与确认门。
- `RuntimeDatabase`：deep 会话 / run tree / synthesis / 打断点持久化进同一存储（独立 deep 分区）。
- `Context Ledger` / `Context Pack` / `capabilitySnapshot` 冻结机制 / `Skill Context`：与普通 Agent 共享，复用而非另起。
- `RunEvent` 安全投影与 `underground-events.ts` 事件投影口径：deep 投影沿用同一安全口径，不另建投影实现。
- 模型运行时 / IntelligenceChannel：deep 经此接入 provider，不直接绑定外部 LLM SDK（遵循 `AGENTS.md` 模型接入层独立模块演进边界）。

## 默认入口与隔离

- 默认入口仍为普通 `agent`；deep 只能由用户显式触发，**不存在自动升级**。
- 产品对外 API 统一使用 `/api/deep/*` 端点族（唯一正式 deep 入口），内部映射 `runKind: "underground"` / `runMode: "deep"`，复用 `run-mode-policy` 门控。
- 旧 `/api/underground/*` 仅作为兼容/废弃候选路径保留，不与 `/api/deep/*` 并列为正式入口；DeepRuntime 替代完成后逐步退役。
- deep 会话与普通会话数据隔离：DeepConversation 独立 store，不读取、不污染普通会话历史、确认记录与 run 投影。

## 安全摘要与能力优先

- UI / read-model（Panel）可做安全摘要投影：只展示结论、理由、证据引用、agent 摘要、状态；不暴露 raw prompt / response / output、密钥或 token。
- **能力优先边界**：模型继续工作所需的工具结果、文件片段、错误信息、证据材料**不被摘要替代**。摘要只是对外展示字段，不覆盖、不截断 DeepRuntime 内部模型可继续使用的正式材料。不以"安全投影""脱敏""鲁棒性"为名削弱模型能力。

## 范围与排除项

本期明确**不包含**（对应需求 Out of Scope）：

- Plan / Plan Package / DirectionHandoffPackage（②' orchestrator 强耦合）。
- Aboveground Execution Runtime / Fruits（artifact 语义）。
- Governance Pipeline / Global Soil 经验回流。
- 多层递归 Agent Fabric（`depth ≥ 2`）。
- 普通会话自动升级为 deep。

## 后果

- DeepRuntime 一期以 manager 自由决策循环 + 一层 child + 非 Plan 交接为权威实现口径，闭环 2 全部编码任务以本 ADR 为契约依据。
- ADR-0021 的 AI 优先诊断价值（"确定性主线 + AI 旁路"方向错误判定、"AI 优先 + 父层收束 + 确定性守卫"目标架构）保留为历史价值；其固定拓扑 Orchestrator 未被采纳为本期骨架，故 ADR-0021 不转 Accepted，标记为 Superseded-by ADR-0025。
- ADR-0024 不废弃：基础 Agent 路线继续作为默认主线；deep 作为显式入口并行存在，不自动升级、不混入默认路径。
- 旧文件（③ / ②' 固定拓扑主体 / ② 编排主线）按渐进退役顺序处置：先替代 → 后迁移 smoke/tests → 验证通过 → 最后分批删除；`domain/underground/*` 与共享投影层不在删除范围。
- `CURRENT_RUNTIME_MODE.md` 已同步更新为"deep 入口已暴露，默认仍普通 agent"（见该文件"当前默认运行方式"与"当前默认产品边界"两节）。

## 相关文档

- [CURRENT_RUNTIME_MODE](../../../CURRENT_RUNTIME_MODE.md)
- [ADR-0022-AgentArbor桌面通用Agent与双运行时架构](ADR-0022-AgentArbor桌面通用Agent与双运行时架构.md)
- [ADR-0024-桌面基础Agent与基础设施优先路线](ADR-0024-桌面基础Agent与基础设施优先路线.md)
- [ADR-0021-地下Agent集群AI优先架构重构](ADR-0021-地下Agent集群AI优先架构重构.md)
- [Agent 口径与命名](../../开发指南/01-基础/05-Agent口径与命名.md)
