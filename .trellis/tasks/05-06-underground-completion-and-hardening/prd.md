# 地下 AI 主线补齐

## 项目背景

AgentArbor 是一个 Agent / AgentApp 孕育与演化平台。当前聚焦 Underground Center（地下中枢），它接收用户自然语言目标，通过 7 个 AI agent 的协作管线（observe → reason → act → guard → reflect → decide_next）产出 `.agentarbor` 方向交接包。

产品架构：`Soil → Underground → .agentarbor → Aboveground → Fruits → Governance → Soil`

## 当前状态

```
上一轮基线：pnpm build / pnpm test 通过
当前工作区：05-06 实现已落地；提交前已重新通过 pnpm build、pnpm test（243/243）、pnpm panel:smoke、pnpm panel:desktop:smoke 和 git diff --check
```

### 已完成的 AI 化

7 个 underground agent 中 5 个的 `reason()` 已迁移到 LLM 推理：

- `IntentCoreAgent` — 目标理解 + 探索计划生成
- `GrowthGovernorAgent` — rootlet cluster 调度决策
- `ConvergenceJudgeAgent` — 多候选交叉裁决
- `RootletExplorerAgent` — 6 种 rootlet kind 的方向探索
- `HandoffStewardAgent` — 综合叙事 + 方向交接包组装

### 关键基础设施

- `src/app/underground/agents/reasoning.ts` — 共享 reasoning envelope，统一调用 AgentTurnRuntime、解析 JSON、记录 source/confidence/modelRefs/toolCallRefs/reasoningTrace
- `src/domain/underground/agent-loop.ts` — AgentLoop 六步管线（observe→reason→act→guard→reflect→decide_next）
- `src/domain/underground/guard.ts` — Guard 三态门（accepted/rejected/fallback），已纯净化，只做结构校验
- `src/domain/underground/mailbox.ts` — 消息路由
- `src/domain/underground/workspace.ts` — 只读工作区视图
- `src/app/underground/orchestrator.ts` — Cognitive Manager，按 DAG 编排 7 个 agent

### 核心原则（必须遵守）

1. **reason() = LLM 推理，guard() = 结构守卫** — guard 不能做语义判断
2. **无 AI = stopped** — 不能产出 approved package，不能伪装通过
3. **Fallback 是低置信度失败材料** — 有 `source: "deterministic_fallback"` 标记
4. **reasoningTrace 是可见决策轨迹** — 不含 raw chain-of-thought / raw prompt / raw response
5. **不引入新依赖** — 只用现有 toolchain（pnpm + TypeScript + node:test）

### 关键文件索引

| 用途 | 路径 |
|---|---|
| Agent reasoning 共享 | `src/app/underground/agents/reasoning.ts` |
| IntentCore（AI 已就绪） | `src/app/underground/agents/intent-core.ts` |
| GrowthGovernor（AI 已就绪） | `src/app/underground/agents/growth-governor.ts` |
| RootletExplorer（AI 已就绪） | `src/app/underground/agents/rootlet-explorer.ts` |
| ConvergenceJudge（AI 已就绪） | `src/app/underground/agents/convergence-judge.ts` |
| HandoffSteward（AI 已就绪） | `src/app/underground/agents/handoff-steward.ts` |
| CandidateCollector（待 AI 化） | `src/app/underground/agents/candidate-collector.ts` |
| AutonomyReviewer（待 AI 化） | `src/app/underground/agents/autonomy-reviewer.ts` |
| Rootlet strategies | `src/app/underground/agents/rootlet-strategies.ts` |
| Orchestrator / Cognitive Manager | `src/app/underground/orchestrator.ts` |
| Fallback rootlet 输出 | `src/app/underground/fallback.ts` |
| Domain 类型（contracts） | `src/domain/underground/contracts.ts` |
| Evidence ledger 类型 | `src/domain/underground/evidence-ledger.ts` |
| Guard 三态门 | `src/domain/underground/guard.ts` |
| AgentLoop 六步管线 | `src/domain/underground/agent-loop.ts` |
| Mailbox | `src/domain/underground/mailbox.ts` |
| Workspace | `src/domain/underground/workspace.ts` |
| Intelligence channel 契约 | `src/domain/intelligence/contracts.ts` |
| AgentTurnRuntime | `src/kernel/intelligence/agent-turn-runtime.ts` |
| Fake model provider（测试用） | `src/adapters/intelligence/fake-model-provider.ts` |
| Panel read-model | `src/app/panel-run-read-model.ts` |
| Underground 入口 | `src/app/underground-direction-session.ts` |
| Direction handoff package | `src/domain/agentarbor/direction-handoff-package.ts` |

---

## 开发目标

### 一、剩余 2 个 Agent 的 AI 化

**AutonomyReviewerAgent** (`agents/autonomy-reviewer.ts`)
- `reason()` 当前是确定性规则判断，改为通过 `reasonWithAgentTurn` 调用 LLM
- LLM 需要评估：当前候选覆盖度、信息缺口、继续探索的收益/成本
- 产出 `continue_exploration | converge | escalate_to_user`
- 新增测试文件 `agents/autonomy-reviewer.test.ts`

**CandidateCollectorAgent** (`agents/candidate-collector.ts`)
- `reason()` 当前是简单去重分组，改为通过 `reasonWithAgentTurn` 调用 LLM
- LLM 做：去重、分类、置信度标注、发现候选间的隐含关联
- 新增测试文件 `agents/candidate-collector.test.ts`

### 二、Autonomy 循环真正 AI 驱动

`orchestrator.ts` 中 `executeCognitiveManager()` 的自治循环当前是 `while + 规则判断`。AutonomyReviewer AI 化后，Orchestrator 只守 `maxAutonomyCycles` 硬边界，循环继续/停止由 AutonomyReviewer 的 LLM 决策驱动。

### 三、Evidence Ledger 校准

确保每条证据可追溯到具体模型调用/工具调用：
- reasoningTrace 中已含 modelCallRefs + toolCallRefs
- RootletExplorer 产出标记 evidenceRefs
- ConvergenceJudge reason() 输出引用具体证据
- HandoffSteward act() 将 evidence 写回 workspace.evidenceLedger
- `.agentarbor` 的 evidence-index.md 引用 evidence ledger entry

### 四、Constraint Sentinel 校准

- hard constraint 在每个 agent 的 reason() system prompt 中告知
- ConvergenceJudge guard 已有 `HARD_CONSTRAINT_VIOLATION_NOT_BLOCKED`
- HandoffSteward guard 已有 `HANDOFF_CONSTRAINT_WEAKENED`
- soft constraint 偏离在 uncertainty 字段中记录

### 五、Agent 间辩论（Critic Pattern）

- Mailbox 升级：agent 可在 `act()` 中向其他 agent 发消息（peer-to-peer）
- Counterfactual rootlet 读取 Option rootlet 的候选后生成反驳
- ConvergenceJudge 读取候选 + 反驳双向材料后裁决
- RootletExplorer reason() 下挂 prompt 中可包含其他已完成 rootlet 的 summary

### 六、Handoff 质量门

- HandoffSteward 的 AI reasoning 必须组织出带收束依据的 `clarifiedGoal`；禁止把关键词重叠率这类工程启发式放进 Guard 替 Agent 做语义判断
- approved 交接包 confidence 下限（低于 0.5 → warning）

### 七、Panel 展示 reasoningTrace

- `panel-run-read-model.ts` 中接入 agent 的 reasoningTrace
- 面板展示：decisionSummary、uncertainty、confidence
- 区分 AI 产出（source: "ai"）和 fallback 产出（source: "deterministic_fallback"）的视觉标记

### 八、清理

- 删除 `src/app/underground/cluster/` 目录
- 清理废弃 import/export

---

## 验收标准

- `pnpm build` 通过
- `pnpm test` 全部通过（当前 243/243）
- 7/7 agent reason() 均通过 `reasonWithAgentTurn` 调用 LLM
- 无 AI → stopped（不变）
- Guard 无新增语义判断
- Panel 可见 reasoningTrace
- working tree clean 可提交
