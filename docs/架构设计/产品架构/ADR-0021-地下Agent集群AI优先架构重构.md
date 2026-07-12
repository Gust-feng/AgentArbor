# ADR-0021: 地下 Agent 集群分层智能协作架构重构

日期：2026-05-05

状态：Superseded-by ADR-0025

补充说明：本 ADR 的 AI-first 诊断价值继续有效，曾由 [ADR-0022-AgentArbor桌面通用Agent与双运行时架构](ADR-0022-AgentArbor桌面通用Agent与双运行时架构.md) 重新框定；当前以 [ADR-0028-AgentArbor统一Workbench与功能模块化单体架构](ADR-0028-AgentArbor统一Workbench与功能模块化单体架构.md) 为准，相关实现属于 Workbench 内的显式 Multi-Agent 功能。文中“`.agentarbor` 方向交接包”只在真实 Plan 出生时解释为 Plan Package 的存储形态，不是每次 Multi-Agent 运行的必备产物。

承接说明：本 ADR 的 AI 优先诊断价值（“确定性主线 + AI 旁路”方向错误判定、“AI 优先 + 父层收束 + 确定性守卫”目标架构）保留为历史价值，诊断正文不删除；deep 一期实现决策由 [ADR-0025-deep一期Manager自由决策循环与一层child最小闭环](ADR-0025-deep一期Manager自由决策循环与一层child最小闭环.md) 承接，本 ADR 状态标记为 Superseded-by ADR-0025，不提升为已接受状态。

## 决策

地下 Agent 集群从"确定性中心流程 + AI 旁路增强"架构，重构为"分层 Agent 智能协作 + 确定性边界守卫"架构。

本 ADR 修正一个关键误读：不可信边界不等于"模型输出一律不可信"。真正默认不可信的是外部搜索/工具事实、单个最小 agent 输出、单个根须输出和未经上层收束的局部材料。中枢 agent / cluster lead 的职责正是管理这些下层材料，完成综合、反驳、裁决、澄清和方向交接。确定性系统只拥有不可越界的工程守卫权，不替代语义判断。

核心翻转：

```text
当前：deterministic_center(state) -> optional_ai_leaf_enhancement -> output
目标：rootlet/subagent_observe_reason_act -> center_agent_synthesis/convergence -> deterministic_boundary_guard -> .agentarbor
```

## 动机

### 诊断

当前地下 Agent 集群存在六个结构性问题：

1. **Agent 是伪 Agent**。6 个固定 agent（IntentCore、GrowthGovernor、CandidatePool、AutonomyCore、ConvergenceJudge、HandoffSteward）每个只订阅一条消息、做确定性计算、写回 SharedContext、发布下一条消息。这是消息驱动的有限状态机，不是智能体。没有感知-推理-行动循环，没有基于环境反馈的适应能力。

2. **AI 是旁路补丁**。`AgentTurnRuntime` 是可选的，无 AI 时回退确定性模板。下层 AI 输出被严格限制在"候选数组"格式里，不能进入上层综合、反驳和裁决链路，不能改变流程走向，不能做确定性路径做不到的事。AI 的价值被压缩到"比确定性模板稍好的文本生成"。

3. **SharedContext 是全局可变状态**。30+ 字段的 flat state，agent 间通过 `snapshot()` + `requireValue()` 隐式耦合。新增 agent 需要理解全部字段语义和时序。这不是 agent 协作，是共享内存并发编程。

4. **Rootlet 是模板工厂**。`createRootletOutputsForInvocation` 是确定性模板函数，6 种 rootlet kind 不探索、不搜索、不学习。ResearchRuntime 加了 Tavily 搜索，但搜索结果被塞进 rootlet prompt，最终产出仍是"候选数组"格式，搜索能力被模板框架限制。

5. **两套运行时并存**。`underground-agent-cluster-runtime.ts`（线性函数式）和 `cluster/agent-runner.ts`（消息驱动）做同样的事，维护负担加倍，行为不一致。

6. **信任边界放错层级**。当前实现把"下层材料不可信"误实现成"语义判断都不可信"，结果由确定性流程直接决定目标、探索、收敛和交接。正确结构应当是：rootlet/subagent/工具结果作为未收束材料进入父层；父层 agent 汇总、质疑、交叉验证并产出运行级判断；确定性守卫只验证协议、权限、预算、硬约束、谱系和包结构。

### 与 ADR-0018 的冲突

ADR-0018 要求地下中枢"负责需求成形、用户确认、约束提取、证据探索、方向综合"，但当前实现把智能通道设计成旁路，确定性逻辑是主线。产品需要"分层 Agent 智能协作 + 确定性边界守卫"，但代码是"确定性驱动 + AI 增强"。这两个方向在代码结构上不兼容。

## 新架构

### 分层信任模型

地下集群的信任边界按层级建立：

1. **外部搜索/工具输出不可信**。搜索结果、网页片段、工具返回、历史资料命中只能作为 fact candidate，必须保留来源、时间、查询、失败条件和适用范围。
2. **最小 agent 输出不可信**。单个 rootlet/subagent 只代表一个探索视角，产出是局部材料，不能直接成为 `.agentarbor` 的事实、目标或方向结论。
3. **父层 agent 负责收束**。GrowthGovernor、AutonomyReviewer、ConvergenceJudge、HandoffSteward 等上层 agent 必须读取多个下层材料，进行对比、反驳、合并、降权、追问或停止，并产出运行级判断。
4. **中枢 agent 是语义主路径**。地下中枢的最终目标成形、约束解释、探索方向、收敛判断和交接叙事由上层 agent 完成，而不是由确定性规则代替。
5. **确定性系统只守硬边界**。确定性逻辑验证 schema、协议、预算、工具权限、权限边界、hard constraint、状态迁移、谱系、脱敏、文件边界和包结构；它不选择语义上"最好"的方向。

### Agent Loop 模型

每个 agent 的执行模型从"消息→计算→写回"变为"感知→推理→行动→守卫"：

```typescript
interface AgentLoop {
  readonly agentId: string;
  readonly protocol: AgentProtocol;
  observe(ctx: AgentRunContext): AgentPercept;
  reason(ctx: AgentRunContext, percept: AgentPercept): Promise<AgentDecision>;
  act(ctx: AgentRunContext, decision: AgentDecision): AgentActionOutput;
  guard(ctx: AgentRunContext, output: AgentActionOutput): GuardedActionOutput;
}
```

- **observe**：从 WorkspaceView（只读）和 Mailbox（消息队列）收集感知信息，明确区分下层材料、上层判断和硬约束
- **reason**：通过 AgentTurnRuntime 调用模型，产出结构化决策；父层 agent 必须能综合、反驳和裁决下层输出
- **act**：执行决策——调用工具、发布事件、产出候选
- **guard**：确定性边界守卫——schema、协议、权限门、预算门、hard constraint、谱系、脱敏和包结构校验

### Agent Protocol

每个 agent 声明显式输入输出协议，替代 SharedContext 隐式耦合：

```typescript
interface AgentProtocol {
  inputs: {
    source: "workspace" | "mailbox" | "event_log";
    key: string;
    required: boolean;
  }[];
  outputs: {
    type: string;
    payloadSchema: string;
  }[];
}
```

### 动态派生 Agent Fabric

地下中枢的下一阶段主线不是继续堆固定 agent class，而是在同一套 `AgentLoop + AgentTurnRuntime + ToolCenter + WorkspaceView + Mailbox + Guard + Trace` 能力内核上，按任务动态派生临时 child agent。

Agent Fabric 的运行级契约包括：

- `AgentSpec`：声明派生 agent 的身份、角色、rootlet kind、输入输出协议、prompt ref、output contract、模型/工具权限和预算。
- `DelegationDecision`：父层 agent 的派生决策，记录 spawn / wait / interrupt / resume / stop / request convergence / request user clarification 等动作、输入 refs、置信度和可展示 reasoning refs。
- `ChildAgentRun`：单个 child/rootlet 的运行记录，只保存局部输入、输出 refs、证据 refs、状态、失败原因、不确定性和 confidence。
- `AgentRunTree`：一次地下运行的父子 agent 运行树，记录 root manager、child runs、delegation decisions 和 parent syntheses。
- `ParentSynthesisResult`：父层对 child 材料的综合结果；它是进入 Convergence Judge / Handoff Steward 前的父层收束材料。

子 agent 输出仍默认不可信。`ChildAgentRun.outputRefs` 只能作为局部材料进入父层 synthesis；`.agentarbor` 交接包不能直接消费单个 child/rootlet output。正式交接只能消费父层 synthesis 后的 `CandidatePool`、`ConvergenceReport` 和 Handoff Steward 组织出的方向材料。

Agent Fabric 的可观测事件为：

```text
agent.delegation.planned
agent.child.started
agent.child.waiting
agent.child.interrupted
agent.child.resumed
agent.child.completed
agent.parent_synthesis.completed
```

这些事件只展示安全摘要、spec refs、agent run refs、model/tool refs、不确定性和输出引用，不展示 raw prompt、raw provider response、hidden reasoning、API key、token 或 raw tool output。

本阶段只实现 AgentArbor 自己的动态派生运行时，不调用 Codex、Claude Code 或其他外部子代理能力。Codex / Claude 的价值只作为工作流形态参考：主 agent 保持上下文清晰，父层动态分派同能力子 agent，随后回收、质疑、综合和裁决。

### WorkspaceView + Mailbox

替代 SharedContext：

- **WorkspaceView**：当前运行工作空间的只读快照，包含 goal、constraints、budget、已有候选等。Agent 只能读，不能写。
- **Mailbox**：每个 agent 的消息队列，Orchestrator 按协议路由。Agent 通过 Mailbox 接收上游产出。

### UndergroundAgentOrchestrator

统一运行时，替代两套并存运行时：

```typescript
class UndergroundAgentOrchestrator {
  private readonly agents: Map<string, AgentLoop>;
  private readonly workspace: WritableWorkspace;
  private readonly eventLog: EventLog;

  async run(input: UndergroundRunInput): Promise<UndergroundRunResult> {
    for (const step of this.dag) {
      const agent = this.agents.get(step.agentId)!;
      const ctx = this.buildContext(step);
      const percept = agent.observe(ctx);
      const decision = await agent.reason(ctx, percept);
      const output = agent.act(ctx, decision);
      const guarded = agent.guard(ctx, output);
      this.apply(guarded);
    }
  }
}
```

Orchestrator 按地下组织协议推进固定拓扑和受控循环（ADR-0018 明确地下中枢结构）。它不是用消息泵替代语义判断；EventLog、Mailbox 和事件发布保留为可观测性、路由和面板投影边界。

### 上层 Agent 收束 / 确定性边界守卫

```text
AgentTurnRuntime.execute(policy, messages, tools)
  ↓ 成功
  ParentAgent.synthesize(output, lower_materials)
  Guard.validate(boundary) → 通过 → act
                         → 不通过 → 修正、降权、追问或停止
  ↓ 失败
  DeterministicFallback.produce() → 标记 low_confidence + source: "deterministic_fallback" → 进入父层收束或停止
```

关键变化：
- `AgentTurnPolicy.allowModel` 默认为 `true`
- fallback 不能静默等价通过；确定性 fallback 产出的材料标记 `source: "deterministic_fallback"` 和低置信度
- 单个 rootlet/subagent 的模型输出不能直接进入交接包，必须经过父层 agent 收束
- 守卫逻辑从"AI 输出后置过滤"变为"act 前置边界门"，只阻断越界行为，不替代语义选择
- 当模型失败、证据不足或 hard constraint 冲突时，上层 agent 可以选择降级、继续探索、询问用户或停止，而不是让确定性模板伪装成已完成判断

### Rootlet 重设计

Rootlet 从模板工厂变为真正的探索 agent，但它仍是最小单元 agent：它的输出是局部探索材料，不是最终事实或方向判断。

```text
RootletAgent
  observe: 读取目标、约束、预算、kind 指引
  reason:  AgentTurnRuntime + 工具（search、read、soil_query）
  act:     产出 ExplorationCandidate[]
  guard:   格式验证、预算检查、约束守卫、脱敏
```

Rootlet 必须保留来源、证据、置信度、反例、适用条件和失败条件。任何单个 rootlet 输出都不能直接写入 `.agentarbor` 的 goal、constraint、direction 或 growth entry；它必须先进入 CandidateCollector / AutonomyReviewer / ConvergenceJudge 的父层收束链路。

6 种 rootlet kind 变为 6 个工具配置 + prompt 策略：

| Kind | 可用工具 | Prompt 策略 |
|---|---|---|
| option | search, read | 生成候选方向，含取舍和适用条件 |
| risk | search, read | 识别风险，含失败模式和阻断项 |
| evidence | search, read | 收集证据，含来源和可信度 |
| constraint | soil_query | 提取约束，含硬/软区分和适用范围 |
| asset_fit | soil_query | 评估资产适配，含适用/不适用条件 |
| counterfactual | search, read | 反驳方向，含 why-not 和替代方向 |

确定性 fallback 保留，但只能作为低置信度材料进入父层收束，不能静默替代真实探索完成。

### Convergence Judge 重设计

从规则引擎变为父层判断者 / cluster lead：

```text
ConvergenceJudgeAgent
  observe: 读取候选池、证据账本、约束、预算
  reason:  AgentTurnRuntime + 工具（candidate_compare、evidence_query）
  act:     产出 ConvergenceDecision（保留/合并/淘汰/升级/追问/停止）
  guard:   hard constraint 不可违反、状态迁移合法、格式验证、脱敏
```

ConvergenceJudge 可以基于模型判断直接选择保留、合并、淘汰、继续探索、询问用户或停止；这不是 advisory overlay。确定性守卫只强制 hard constraint、状态机、预算、权限、谱系和输出格式。候选违反 hard constraint 时必须淘汰或要求修正，模型判断不能覆盖硬边界。

### Handoff Steward 重设计

HandoffSteward 不再只是把已有字段拼成包。它是地下中枢交接叙事的最后父层 agent：

```text
HandoffStewardAgent
  observe: 读取 ConvergenceReport、约束、证据账本、澄清记录、用户确认
  reason:  综合方向叙事、非目标、约束解释、证据边界、growth entry 和地上接手条件
  act:     产出 DirectionHandoffPackage / .agentarbor draft
  guard:   验证收敛结果合法、约束不弱化、证据有引用、包结构和文件边界合法
```

序列化可以保持确定性；交接包内容的语义组织不能只是确定性字段搬运。

## 变更清单

### 新增文件

| 文件 | 职责 |
|---|---|
| `src/domain/underground/agent-loop.ts` | AgentLoop 接口、AgentProtocol 类型、AgentPercept/Decision/ActionOutput/GuardedActionOutput 类型 |
| `src/domain/underground/workspace.ts` | WorkspaceView 只读接口、WritableWorkspace 可写接口、WorkspaceSnapshot 类型 |
| `src/domain/underground/mailbox.ts` | Mailbox 消息路由接口、AgentMessage 类型 |
| `src/domain/underground/guard.ts` | GuardResult 类型、GuardViolation 类型、通用守卫函数（约束检查、格式验证、脱敏） |
| `src/app/underground/orchestrator.ts` | UndergroundAgentOrchestrator 实现、DAG 定义、固定拓扑和受控循环推进逻辑 |
| `src/app/underground/agents/intent-core.ts` | IntentCoreAgent 的 AgentLoop 实现 |
| `src/app/underground/agents/growth-governor.ts` | GrowthGovernorAgent 的 AgentLoop 实现 |
| `src/app/underground/agents/rootlet-explorer.ts` | RootletAgent 的 AgentLoop 实现（替代模板工厂） |
| `src/app/underground/agents/candidate-collector.ts` | CandidatePoolAgent 的 AgentLoop 实现 |
| `src/app/underground/agents/autonomy-reviewer.ts` | AutonomyCoreAgent 的 AgentLoop 实现 |
| `src/app/underground/agents/convergence-judge.ts` | ConvergenceJudgeAgent 的 AgentLoop 实现 |
| `src/app/underground/agents/handoff-steward.ts` | HandoffStewardAgent 的 AgentLoop 实现 |
| `src/app/underground/agents/rootlet-strategies.ts` | 6 种 rootlet kind 的工具配置和 prompt 策略 |
| `src/app/underground/fallback.ts` | 确定性 fallback 逻辑（从 rootlets.ts 和 minimal-underground.ts 提取） |

### 重写文件

| 文件 | 变更 |
|---|---|
| `src/app/underground/compat/underground-intelligence.ts` | 移除 rootlet 专用 intelligence 函数，改为通用 AgentTurnRuntime 策略构建 |
| `src/app/underground/events.ts` | 保留事件发布函数，调整 payload 以适配新 agent 产出格式 |
| `src/app/underground/compat/underground-demo.ts` | 改用 Orchestrator 入口 |
| `src/app/underground/compat/underground-direction-session.ts` | 改用 Orchestrator 入口 |
| `src/app/underground/compat/underground-runner.ts` | 改用 Orchestrator 入口 |
| `src/app/underground/compat/underground-message-dispatcher.ts` | 删除，Orchestrator 按 DAG 推进 |
| `src/app/underground/compat/underground-direction-recovery.ts` | 适配新 WorkspaceView 接口 |
| `src/app/underground-convergence.ts` | 保留收敛逻辑函数，但作为 ConvergenceJudgeAgent 的 guard 层和 fallback 使用 |
| `src/app/underground-candidates.ts` | 保留候选池创建逻辑，但作为 CandidateCollector 的 act 层使用 |
| `src/app/underground-evidence.ts` | 保留证据账本逻辑，适配新接口 |
| `src/app/underground-report.ts` | 保留报告创建逻辑，适配新接口 |
| `src/app/underground-goal-profile.ts` | 保留，作为 IntentCoreAgent 的 observe 层使用 |
| `src/app/underground/compat/underground-demo-summary.ts` | 适配新接口 |
| `src/app/agents/manifests.ts` | 更新 agent manifest 以适配 AgentLoop 接口 |
| `src/domain/underground/agent-cluster.ts` | 扩展 UndergroundAgentClusterPlan 以包含 DAG 和协议信息 |
| `src/domain/underground/radial-growth.ts` | RootletOutput 增加 `source: "ai" | "deterministic_fallback"` 字段 |
| `src/domain/underground/index.ts` | 增加新类型导出 |

### 删除文件

| 文件 | 原因 |
|---|---|
| `src/app/underground/cluster/agent-runner.ts` | 被 Orchestrator 替代 |
| `src/app/underground/cluster/agent-context.ts` | 被 AgentRunContext 替代 |
| `src/app/underground/cluster/shared-context.ts` | 被 WorkspaceView + Mailbox 替代 |
| `src/app/underground/cluster/autonomy-core-agent.ts` | 被 agents/autonomy-reviewer.ts 替代 |
| `src/app/underground/cluster/convergence-judge-agent.ts` | 被 agents/convergence-judge.ts 替代 |
| `src/app/underground/cluster/intent-core-agent.ts` | 被 agents/intent-core.ts 替代 |
| `src/app/underground/cluster/growth-governor-agent.ts` | 被 agents/growth-governor.ts 替代 |
| `src/app/underground/cluster/candidate-pool-agent.ts` | 被 agents/candidate-collector.ts 替代 |
| `src/app/underground/cluster/handoff-steward-agent.ts` | 被 agents/handoff-steward.ts 替代 |
| `src/app/underground/cluster/rootlet-agent.ts` | 被 agents/rootlet-explorer.ts 替代 |
| `src/app/underground/cluster/index.ts` | 目录整体删除 |
| `src/app/underground/compat/underground-agent-cluster-runtime.ts` | 被 Orchestrator 替代 |
| `src/app/underground-rootlets.ts` | 模板工厂逻辑移入 fallback.ts，探索逻辑移入 rootlet-explorer.ts |
| `src/app/minimal-underground.ts` | 功能分散到各 agent 的 fallback 层 |
| `src/app/underground/convergence-intelligence.ts` | 移入 agents/convergence-judge.ts 的 reason 层 |
| `src/app/underground/autonomy-intelligence.ts` | 移入 agents/autonomy-reviewer.ts 的 reason 层 |
| `src/app/underground/intelligence-contracts.ts` | 移入 agents/rootlet-strategies.ts |
| `src/app/underground/intelligence-prompts.ts` | 移入 agents/rootlet-strategies.ts |
| `src/app/underground/intelligence-output.ts` | 移入 agents/rootlet-strategies.ts |

### 不变文件

| 文件 | 原因 |
|---|---|
| `src/kernel/intelligence/agent-turn-runtime.ts` | 已经是 AI 优先执行引擎，只改调用方式 |
| `src/kernel/intelligence/tool-use-loop.ts` | 工具循环逻辑正确 |
| `src/domain/intelligence/*` | 智能通道领域模型稳定 |
| `src/domain/tools/*` | 工具执行边界正确 |
| `src/domain/underground/contracts.ts` | DirectionHandoff、NutrientRequest 等核心契约稳定 |
| `src/domain/underground/clarification.ts` | 用户澄清逻辑正确 |
| `src/domain/underground/candidate-comparison.ts` | 候选比较逻辑正确 |
| `src/domain/underground/evidence-ledger.ts` | 证据账本逻辑正确 |
| `src/domain/underground/intent-core.ts` | GoalIntentProfile 类型稳定 |
| `src/domain/agentarbor/*` | 方向交接包验证逻辑正确 |
| `src/domain/constraints.ts` | 约束模型稳定 |
| `src/domain/common.ts` | ArborMessage 等基础类型稳定 |
| `src/domain/observation/*` | 观察模型稳定 |
| `src/app/runtime.ts` | MinimalRuntime 接口稳定，可能需小扩展 |

## 实施步骤

### Step 1：新增领域类型

在 `src/domain/underground/` 下新增 `agent-loop.ts`、`workspace.ts`、`mailbox.ts`、`guard.ts`。

定义所有新接口和类型，不改现有代码，确保编译通过。

### Step 2：实现 WorkspaceView + WritableWorkspace

从 SharedContext 的字段结构提取 WorkspaceView 只读接口和 WritableWorkspace 可写接口。

WritableWorkspace 的写入权限由 agentId + protocol 约束，替代 SharedContext 的 ownership 断言。

### Step 3：实现 AgentLoop 基础设施

实现 `AgentRunContext`（包含 WorkspaceView、Mailbox、AgentTurnRuntime、EventLog 等依赖）。

实现通用 `observe`、`reason`、`act`、`guard` 辅助函数。

### Step 4：实现 Orchestrator

实现 `UndergroundAgentOrchestrator`，包含：
- 地下中枢 DAG 定义
- 固定拓扑和受控循环推进逻辑
- 全局守卫（预算、max steps）
- 事件发布

### Step 5：重写 IntentCoreAgent

```text
observe: 从 Mailbox 读取 goal.received
reason:  通过 AgentTurnRuntime 分析用户目标，提取意图、非目标、验收条件
act:     产出 GoalIntentProfile、ExplorationPlan、AgentClusterPlan
guard:   验证目标非空、约束不冲突、预算合理
```

### Step 6：重写 GrowthGovernorAgent

```text
observe: 从 WorkspaceView 读取 ExplorationPlan
reason:  通过 AgentTurnRuntime 决定探索方向和深度
act:     产出 StartedPlan、RunningRootletInvocations
guard:   验证预算不超限、rootlet kind 合法
```

### Step 7：重写 RootletAgent

```text
observe: 从 Mailbox 读取 rootlet.invocation_requested
reason:  通过 AgentTurnRuntime + kind 专属工具配置执行探索
act:     产出 RootletOutput[]（标记 source: "ai" 或 "deterministic_fallback"）
guard:   格式验证、预算检查、约束守卫、脱敏
```

6 种 rootlet kind 的策略定义在 `rootlet-strategies.ts`。

### Step 8：重写 CandidateCollectorAgent

```text
observe: 从 WorkspaceView 读取已完成 RootletOutput
reason:  聚合候选（此 agent 推理简单，可确定性）
act:     产出 CandidatePool
guard:   验证 rootlet output 来源合法、invocation 已完成
```

### Step 9：重写 AutonomyReviewerAgent

```text
observe: 从 WorkspaceView 读取 CandidatePool 和当前 Cycle
reason:  通过 AgentTurnRuntime 评估是否继续探索
act:     产出 AutonomyDecision（continue_exploration / request_convergence / stop）
guard:   验证 cycle 不超限、spawn requests 合法
```

### Step 10：重写 ConvergenceJudgeAgent

```text
observe: 从 WorkspaceView 读取 CandidatePool、EvidenceLedger、Constraints
reason:  通过 AgentTurnRuntime 做父层综合、反驳、候选比较和裁决
act:     产出 ConvergenceReport（保留/合并/淘汰/升级/追问/停止）
guard:   hard constraint 不可违反、状态迁移合法、格式验证、脱敏
```

### Step 11：重写 HandoffStewardAgent

```text
observe: 从 WorkspaceView 读取 ConvergenceReport
reason:  通过 AgentTurnRuntime 综合交接叙事、证据边界、约束解释和地上接手条件
act:     产出 DirectionHandoffPackage
guard:   验证收敛结果合法、约束不弱化、证据有引用、包结构合法
```

### Step 12：迁移入口

- `underground-demo.ts` 改用 Orchestrator
- `underground-direction-session.ts` 改用 Orchestrator
- `underground-runner.ts` 改用 Orchestrator
- 删除旧运行时入口

### Step 13：删除旧代码

删除 `cluster/` 目录、`underground-agent-cluster-runtime.ts`、`underground-rootlets.ts`、`minimal-underground.ts`、`underground-message-dispatcher.ts` 和 `underground/` 下的旧 intelligence 文件。

### Step 14：迁移测试

每个 Step 完成后同步迁移对应测试。测试策略见下节。

## 测试策略

### 测试迁移原则

1. 每个 AgentLoop 实现都有独立的单元测试，测试 observe/reason/act/guard 四个阶段
2. Orchestrator 有集成测试，测试完整 DAG 推进
3. 确定性 fallback 有独立测试
4. 守卫层有独立测试
5. 旧测试在旧代码删除前必须全部被新测试覆盖

### 测试文件映射

| 旧测试 | 新测试 | 覆盖范围 |
|---|---|---|
| `cluster/agent-runner.test.ts` | `orchestrator.test.ts` | Orchestrator DAG 推进、全局守卫 |
| `underground-autonomy-loop.test.ts` | `agents/autonomy-reviewer.test.ts` | AutonomyReviewer 四阶段 |
| `intelligence-contracts.test.ts` | `agents/rootlet-strategies.test.ts` | Rootlet 策略契约 |
| `intelligence-prompts.test.ts` | `agents/rootlet-strategies.test.ts` | Rootlet prompt 构建 |
| `intelligence-output.test.ts` | `agents/rootlet-explorer.test.ts` | Rootlet 输出解析和守卫 |
| `underground-intelligence.test.ts` | `agents/rootlet-explorer.test.ts` + `agents/convergence-judge.test.ts` | AI 接入逻辑 |
| `underground-demo-cli.test.ts` | `underground-demo.test.ts` | Demo CLI |
| `underground-demo-summary.test.ts` | `underground-demo-summary.test.ts` | Demo 摘要 |
| `underground-direction-session.test.ts` | `underground-direction-session.test.ts` | 方向会话 |
| `underground-message-dispatcher.test.ts` | 删除（被 Orchestrator 测试覆盖） | — |
| `domain/underground/radial-growth.test.ts` | 保留 + 扩展 | RootletOutput source 字段 |
| `domain/underground/intent-core.test.ts` | 保留 | GoalIntentProfile |

### 新增测试

| 文件 | 覆盖范围 |
|---|---|
| `domain/underground/agent-loop.test.ts` | AgentLoop 接口约束 |
| `domain/underground/workspace.test.ts` | WorkspaceView 读取、WritableWorkspace 写入权限 |
| `domain/underground/mailbox.test.ts` | Mailbox 路由 |
| `domain/underground/guard.test.ts` | 通用守卫函数 |
| `agents/intent-core.test.ts` | IntentCoreAgent 四阶段 |
| `agents/growth-governor.test.ts` | GrowthGovernorAgent 四阶段 |
| `agents/rootlet-explorer.test.ts` | RootletAgent 四阶段 + 6 种 kind |
| `agents/candidate-collector.test.ts` | CandidateCollectorAgent 四阶段 |
| `agents/autonomy-reviewer.test.ts` | AutonomyReviewerAgent 四阶段 |
| `agents/convergence-judge.test.ts` | ConvergenceJudgeAgent 四阶段 |
| `agents/handoff-steward.test.ts` | HandoffStewardAgent 四阶段 |
| `fallback.test.ts` | 确定性 fallback 逻辑 |

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| AI 调用成本和延迟增加 | 每个 agent 有预算门；AI 失败时 fallback 只能产出低置信度材料、触发父层收束或停止；Orchestrator 全局预算守卫 |
| 重构期间项目不可用 | 一次性重构，旧代码在新代码验证通过前不删除 |
| 大量测试需要重写 | 先写新测试再改实现；旧测试在 Step 13 前保持通过 |
| Agent loop 模型可能不适合固定拓扑 | 地下中枢拓扑是 ADR-0018 确定的固定结构，DAG + 受控循环负责组织协议，Mailbox/EventLog 负责可观测路由 |
| 面板流式任务冲突 | Orchestrator 保留事件发布能力，SSE 路由可消费相同事件 |
| Rootlet AI 探索质量不稳定 | Rootlet 输出默认只是下层材料；fallback 标记低置信度；父层 agent 必须识别、降权、反驳或继续探索 |
| Convergence Judge 裁决可能违反 hard constraint | 守卫层强制修正；hard constraint 冲突的候选必须被淘汰或要求修正，模型判断不能覆盖硬边界 |

## 不变的部分

以下部分不重构，因为它们已经是正确的：

- `AgentTurnRuntime`——已经是 AI 优先执行引擎
- `IntelligenceChannel`——已经是模型能力横切接入层
- `ToolExecutionBroker` / `ToolCenter`——工具执行边界正确
- domain 核心类型（`UndergroundAgentInvocation`、`CandidatePool`、`ConvergenceReport`、`DirectionHandoff`、`NutrientRequest`、`ConstraintRef` 等）——数据模型稳定
- 方向交接包验证逻辑——正确
- 证据账本——归因逻辑正确
- EventLog——事件记录正确
- 脱敏逻辑——安全边界正确
- 用户澄清和恢复逻辑——正确

## 后果

- 活跃代码入口必须使用 Orchestrator，不再有线性函数式和消息驱动两套路径
- 中枢 agent 是地下语义判断主路径，确定性逻辑是边界守卫和可审计 fallback
- Agent 间通过显式协议通信，不再共享可变状态
- Rootlet 是真正的探索者，不是模板工厂，但 rootlet 输出仍是未收束材料
- Convergence Judge 是父层判断者，不是规则引擎或 advisory overlay
- HandoffSteward 负责把收敛判断组织成可交给地上中枢的 `.agentarbor` 方向交接包
- 新增 agent 只需实现 AgentLoop 接口并注册到 Orchestrator DAG
- 确定性 fallback 产出的候选必须标记 `source: "deterministic_fallback"` 和低置信度，不能静默等同正常完成

## 后续文档同步

若本 ADR 被接受，`ADR-0020-智能通道与模型接入边界.md` 和 `docs/开发指南/06-工程实现/03-人工智能与确定性边界.md` 需要同步修正过宽的"模型输出默认不可信"表述：下层模型/工具输出是候选材料；上层中枢 agent 的综合、裁决和交接判断是地下集群的主执行路径；确定性逻辑守边界，不替代语义判断。

## 相关文档

- [ADR-0018: AgentArbor 原生概念树架构](ADR-0018-AgentArbor原生概念树架构.md)
- [地下中枢与方向成形](../../开发指南/03-系统架构/07-地下中枢与方向成形.md)
- [Agent 集群运行结构](../../开发指南/03-系统架构/04-Agent集群运行结构.md)
