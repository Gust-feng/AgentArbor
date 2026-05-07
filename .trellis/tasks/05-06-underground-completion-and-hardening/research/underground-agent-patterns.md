# Research: Underground Agent AI Patterns

- **Query**: 研究 AgentArbor underground agent 的 AI 化模式
- **Scope**: internal
- **Date**: 2026-05-06

## Files Found

| File Path | Description |
|---|---|
| `src/app/underground/agents/reasoning.ts` | 共享 reasoning envelope：`reasonWithAgentTurn` 函数 |
| `src/app/underground/agents/intent-core.ts` | 已 AI 化 agent 示例（IntentCoreAgent） |
| `src/app/underground/agents/autonomy-reviewer.ts` | AutonomyReviewerAgent，reason() 委托给 `autonomy-intelligence.ts` |
| `src/app/underground/agents/candidate-collector.ts` | CandidateCollectorAgent，确定性 reason() |
| `src/app/underground/orchestrator.ts` | UndergroundAgentOrchestrator（Cognitive Manager） |
| `src/app/underground/autonomy-intelligence.ts` | Autonomy AI 决策逻辑（独立函数，非 envelope） |
| `src/domain/underground/agent-loop.ts` | AgentLoop 接口 + runAgentLoopRound |
| `src/domain/underground/guard.ts` | Guard 三态门类型和工厂函数 |
| `src/domain/underground/mailbox.ts` | AgentMailbox 接口 + InMemoryMailbox |
| `src/domain/underground/evidence-ledger.ts` | Evidence ledger 类型和工厂函数 |
| `src/domain/underground/contracts.ts` | DirectionOption, ConvergenceReview 等 domain 类型 |

---

## 1. AgentLoop 接口 (`agent-loop.ts:87-97`)

```typescript
interface AgentLoop<P, D, A, W, C = unknown> {
  readonly agentId: string;
  readonly protocol: AgentProtocol;
  observe(ctx: AgentRunContext<W, C>): P;
  reason(ctx: AgentRunContext<W, C>, percept: P): D | Promise<D>;
  act(ctx: AgentRunContext<W, C>, decision: D): A | Promise<A>;
  guard(ctx: AgentRunContext<W, C>, output: A): GuardedActionOutput<A>;
  reflect?(ctx: AgentRunContext<W, C>, output: A, guarded: GuardedActionOutput<A>): AgentReflection | Promise<AgentReflection>;
  decideNext?(ctx: AgentRunContext<W, C>, reflection: AgentReflection): AgentNextDecision | Promise<AgentNextDecision>;
}
```

每个 agent 必须实现：`observe` -> `reason` -> `act` -> `guard` 四个方法。
`reflect` 和 `decideNext` 是可选的；如果未实现，`runAgentLoopRound` 提供默认实现。

`AgentRunContext<W, C>` (`agent-loop.ts:75-85`) 包含：
- `workspace: WorkspaceView<W>` — 只读 workspace 视图
- `mailbox: AgentMailbox` — 消息路由
- `capabilities?: C` — agent 特定能力（如 agentTurnRuntime, constraints）

---

## 2. `reasonWithAgentTurn` 函数签名与用法 (`reasoning.ts:61-175`)

### 函数签名

```typescript
async function reasonWithAgentTurn<T>(input: {
  readonly agentId: string;
  readonly agentTurnRuntime?: AgentTurnRuntime;
  readonly traceId: string;
  readonly goalId: string;
  readonly purpose: ModelPurpose;
  readonly outputContract: ModelOutputContract;
  readonly callerRef: ObservationRef;
  readonly inputRefs: readonly ObservationRef[];
  readonly inputRefIds: readonly string[];
  readonly messages: readonly ModelMessage[];
  readonly constraints: readonly Constraint[];
  readonly allowedTools?: readonly string[];
  readonly maxModelRounds?: number;
  readonly maxToolRounds?: number;
  readonly fallback?: AgentTurnFallbackBehavior;
  readonly budget?: { readonly maxOutputTokens?: number; readonly maxLatencyMs?: number };
  readonly parse: (output: unknown, response: ModelResponse) => UndergroundReasoningParseResult<T>;
}): Promise<UndergroundReasoningResult<T>>
```

### 核心流程

1. 检查 `agentTurnRuntime` 是否存在；若不存在，返回 `status: "runtime_unavailable"`, `confidence: 0.12`
2. 调用 `agentTurnRuntime.execute(...)` 构建 policy（`maxModelRounds: 1`, `maxToolRounds: 0`, `maxOutputTokens: 512`, `maxLatencyMs: 15000`）
3. 检查 turn 结果是否 `completed` + `validation.passed`
4. 调用调用方提供的 `parse(output, response)` 函数
5. 解析成功：返回 `status: "completed"`, `source: "ai"`, 附带 reasoningTrace
6. 解析失败：返回 `status: "failed"`, `source: "deterministic_fallback"`, `confidence: 0.18`

### 返回类型 `UndergroundReasoningResult<T>` (`reasoning.ts:48-59`)

```typescript
type UndergroundReasoningResult<T> = {
  readonly status: "completed" | "failed" | "runtime_unavailable";
  readonly source: UndergroundReasoningSource; // "ai" | "deterministic_fallback"
  readonly value?: T;
  readonly confidence: number;
  readonly modelCallRefs: readonly ModelCallRef[];
  readonly toolCallRefs: readonly string[];
  readonly fallbackRefs: readonly string[];
  readonly reasoningTrace: readonly UndergroundReasoningTraceEntry[];
  readonly finalOutput?: ModelResponse;
  readonly failureReason?: string;
};
```

### `fallbackReasoningTrace` (`reasoning.ts:177-199`)

在 reasonWithAgentTurn 失败或 agent 选择不调用 AI 时使用，返回 `confidence: 0.18` 的确定性回退 trace。

---

## 3. IntentCoreAgent — 已 AI 化 agent 的完整模式 (`intent-core.ts`)

### 类型定义

- `IntentCorePercept = AgentPercept & { goalId, rawGoal, constraints }`
- `IntentCoreDecision = AgentDecision & { goalIntentProfile, explorationPlan, source, confidence, reasoningTrace }`
- `IntentCoreActionOutput = AgentActionOutput & { goalIntentProfile, explorationPlan, source, confidence, reasoningTrace }`
- `IntentCoreCapabilities = { constraints: readonly Constraint[]; agentTurnRuntime?: AgentTurnRuntime }`

### observe() (`intent-core.ts:80-101`)

从 mailbox `drainByType("goal.received")` 提取消息，构建 percept。

### reason() (`intent-core.ts:103-158`) — AI 化模式核心

```typescript
async reason(ctx, percept): Promise<IntentCoreDecision> {
  // 1. 构造确定性 fallback profile
  const fallbackProfile = createGoalIntentProfileForMinimalUnderground({...});
  const fallbackPlan = createMinimalUndergroundExplorationPlan(...);

  // 2. 调用 reasonWithAgentTurn
  const ai = await reasonWithAgentTurn({
    agentId: this.agentId,
    agentTurnRuntime: ctx.capabilities?.agentTurnRuntime,
    traceId: ...,
    goalId: percept.goalId,
    purpose: "intent_profile",
    outputContract: INTENT_PROFILE_CONTRACT,   // ModelOutputContract
    callerRef: ...,
    inputRefs: ...,
    inputRefIds: percept.inputRefs,
    messages: buildIntentProfileMessages(percept),  // system + user prompts
    constraints: percept.constraints,
    parse: (output) => parseIntentProfileOutput(output, fallbackProfile),  // 解析函数
  });

  // 3. 合并结果：ai.value ?? fallbackProfile
  const goalIntentProfile = ai.value ?? fallbackProfile;
  // ...
}
```

### System Prompt (`intent-core.ts:266-272`)

```
You are AgentArbor Underground Intent Core.
Shape the user goal into a GoalIntentProfile candidate for parent agents.
Return JSON only. Do not include chain-of-thought. Use decisionSummary for a short displayable decision summary and uncertainty for open concerns.
Engineering guards will validate schema, hard constraints, and package boundaries; do not claim final approval.
```

### User Prompt (`intent-core.ts:273-286`)

包含：`Goal id`, `Raw goal`, `Hard constraints`（格式化列表），`Return fields` 指令。

### ModelOutputContract (`intent-core.ts:233-261`)

```typescript
const INTENT_PROFILE_CONTRACT: ModelOutputContract = {
  contractId: "underground.intent_profile.v1",
  outputKind: "explanation",
  format: "json_object",
  requiredFields: ["goalStatement", "keyConcepts", "domainConcepts", "nonGoals", ...],
  requiredStringFields: ["goalStatement", "decisionSummary", "uncertainty"],
  visibleOutput: {
    fields: ["goalStatement", "decisionSummary", "uncertainty"],
    fieldTypes: { goalStatement: "string", decisionSummary: "string", uncertainty: "string" },
    maxFieldLength: 240,
  },
};
```

### parse 函数 (`intent-core.ts:289-310`)

- 接收 `(output: unknown, fallback: GoalIntentProfile)`
- 从 output record 中提取各字段，缺失字段回退到 fallback
- 返回 `UndergroundReasoningParseResult<GoalIntentProfile>`

### guard() (`intent-core.ts:180-230`)

确定性验证：
- goalStatement 非空
- 硬约束不冲突（conflictPolicy === "block" 的计数 >= 2）
- explorationPlan 预算 > 0

---

## 4. AutonomyReviewerAgent — 当前 AI 化状态 (`autonomy-reviewer.ts`)

### 类型定义

- `AutonomyReviewerWorkspace`: goalId, rawGoal, goalIntentProfile?, candidatePool?, currentCycle?, autonomyCycles[], rootletOutputs[], constraints[], maxAutonomyCycles
- `AutonomyReviewerPercept`: 继承 AgentPercept，workspace 字段 + maxAutonomyCycles
- `AutonomyReviewerDecision`: decision: UndergroundAutonomyDecision
- `AutonomyReviewerCapabilities`: { agentTurnRuntime?: AgentTurnRuntime }

### observe() (`autonomy-reviewer.ts:84-108`)

从 workspace snapshot 读取数据，要求 candidatePool 和 currentCycle 必须存在。

### reason() (`autonomy-reviewer.ts:110-131`) — 委托模式

```typescript
async reason(ctx, percept): Promise<AutonomyReviewerDecision> {
  const decision = await requestUndergroundAutonomyDecision({
    agentTurnRuntime: ctx.capabilities?.agentTurnRuntime,
    traceId: ..., goalId: ..., goal: ...,
    goalIntentProfile, candidatePool, rootletOutputs, constraints,
    cycle: percept.currentCycle,
    cycles: percept.autonomyCycles,
    maxCycles: percept.maxAutonomyCycles,
  });
  return { rationaleRefs: [decision.decisionId, ...decision.sourceRefs], decision };
}
```

注意：**没有**使用 `reasonWithAgentTurn` envelope，而是直接委托给 `requestUndergroundAutonomyDecision()` 函数。

### `requestUndergroundAutonomyDecision` (`autonomy-intelligence.ts:71-149`)

这是独立的 AI 调用函数，不使用 reasoning.ts envelope：
1. 如果 `agentTurnRuntime` 未提供，返回 `failedAutonomyDecision` (reason: "ai_required_for_autonomy")
2. 直接调用 `agentTurnRuntime.execute(...)` 构建 policy
3. `policy.fallback: "disabled"`（不允许确定性回退）
4. `maxModelRounds: 3`, `maxToolRounds: 2`（比 intent-core 更多轮次）
5. 解析输出，验证 action 值和 spawnRequests
6. 如果 cycles >= maxCycles 且 action 是 continue，返回 failed（cycle guard）

### System Prompt (`autonomy-intelligence.ts:166-175`)

```
You are the underground autonomy core for AgentArbor.
Review the current CandidatePool after a rootlet exploration cycle.
Choose exactly one action: continue_exploration, request_convergence, request_user_clarification, or stop.
You cannot approve a Direction Handoff. Convergence Judge and Handoff Steward remain the only promotion path.
If continuing exploration, provide runtime-only spawnRequests mapped to existing rootletKind values.
Return JSON only with action, completionAssessment, informationGaps, spawnRequests, rationale, and optional sourceRefs.
```

### ModelOutputContract (`autonomy-intelligence.ts:51-67`)

```typescript
{
  contractId: "underground.autonomy_decision.v1",
  format: "json_object",
  requiredFields: ["action", "completionAssessment", "informationGaps", "spawnRequests", "rationale"],
  requiredStringFields: ["action", "completionAssessment", "rationale"],
}
```

### guard() (`autonomy-reviewer.ts:143-204`)

确定性验证：
- failed status 必须对应 stop action
- action 必须是合法值：continue_exploration, request_convergence, request_user_clarification, stop
- continue_exploration 必须有 spawnRequests
- spawnRequests.rootletKind 必须是合法值：option, risk, asset_fit, evidence, constraint, counterfactual

---

## 5. CandidateCollectorAgent — 确定性 agent (`candidate-collector.ts`)

### 类型定义

- `CandidateCollectorWorkspace`: goalId, rootletOutputs[], completedRootletInvocations[], centerInvocations[]
- `CandidateCollectorCapabilities`: { agentTurnRuntime?: AgentTurnRuntime }
- `CandidateCollectorPercept`: 继承 AgentPercept + workspace 字段
- `CandidateCollectorDecision`: aggregationRationale, candidateCount
- `CandidateCollectorAction`: candidatePool: CandidatePool

### observe() (`candidate-collector.ts:69-80`)

从 workspace snapshot 读取所有字段。

### reason() (`candidate-collector.ts:82-92`) — 纯确定性

```typescript
reason(ctx, percept): CandidateCollectorDecision {
  const candidateCount = percept.rootletOutputs.length;
  return {
    rationaleRefs: percept.rootletOutputs.map(o => o.outputId),
    aggregationRationale: `Aggregated ${candidateCount} rootlet outputs into candidate pool for goal ${percept.goalId}.`,
    candidateCount,
  };
}
```

不调用任何 AI，是同步函数。接收 `agentTurnRuntime` capability 但不使用。

### act() (`candidate-collector.ts:94-108`)

调用 `createMinimalCandidatePool(...)` 从 rootletOutputs 构建 candidatePool。

### guard() (`candidate-collector.ts:110-165`)

确定性验证：
- CandidatePool.goalId 必须匹配 workspace.goalId
- rootletOutput 的 invocationId 必须在 completedRootletInvocations 中
- candidate.producedByAgentId 必须是已完成的 rootlet agent

---

## 6. Orchestrator 自治循环 (`orchestrator.ts:124-334`)

### 执行流程

1. **receive_goal** — 创建 workspace + mailbox，发送 goal.received 消息到 IntentCoreAgent
2. **shape_goal_intent** — 运行 IntentCoreAgent（AI），断言 guard accepted
3. **while(autonomyLoopActive)** — 自治循环：
   - a. **dispatch_rootlets** — 运行 GrowthGovernorAgent
   - b. 为每种 rootlet cluster kind 运行 RootletExplorerAgent
   - c. 完成 rootlet invocations
   - d. **wait_rootlets_then_collect_candidates** — 运行 CandidateCollectorAgent
   - e. 如果 enableAutonomy:
     - 创建 explorationCycle
     - 运行 AutonomyReviewerAgent
     - 如果 decision.action === "continue_exploration" 且 cycleIndex < maxAutonomyCycles - 1: `continue`（重新循环）
     - 否则退出循环
4. **synthesize_convergence** — 运行 ConvergenceJudgeAgent
5. **package_handoff** — 运行 HandoffStewardAgent
6. 生成 undergroundReport，发布 completion event

### 关键参数

- `maxAutonomyCycles` 默认值: 3
- `enableAutonomy` 默认值: true
- 每个 agent 的 capabilities 中都注入 `agentTurnRuntime`

### Workspace 类型 (`orchestrator.ts:54-75`)

```typescript
type UndergroundWorkspaceData = Readonly<{
  goalId, rawGoal, goalIntentProfile?, explorationPlan?, startedPlan?,
  rootletClusters?, runningRootletInvocations?, completedRootletInvocations?,
  centerInvocations?, rootletOutputs?, candidatePool?,
  autonomyDecision?, autonomyDecisions?, convergenceReport?,
  evidenceLedger?, directionHandoffPackage?,
  currentCycle?, autonomyCycles?, constraints?, maxAutonomyCycles?
}>;
```

---

## 7. Mailbox (`mailbox.ts`)

### AgentMessage (`mailbox.ts:1-10`)

```typescript
type AgentMessage = {
  readonly id: string;
  readonly traceId: string;
  readonly fromAgentId: string;
  readonly toAgentId: string;
  readonly type: string;
  readonly payload: unknown;
  readonly createdAt: string;
  readonly sourceRef?: string;
};
```

### AgentMailbox 接口 (`mailbox.ts:12-18`)

```typescript
interface AgentMailbox {
  route(message: AgentMessage): void;
  pending(agentId: string): number;
  drain(agentId: string): AgentMessage[];
  drainByType(agentId: string, type: string): AgentMessage[];
  peek(agentId: string): AgentMessage[];
}
```

### InMemoryMailbox (`mailbox.ts:20-65`)

- `Map<string, AgentMessage[]>` 结构
- `route()`: structuredClone payload 后入队
- `drain()`: 取出并清空
- `drainByType()`: 按 type 过滤取出，剩余保留
- `peek()`: 只读不消费

---

## 8. Evidence Ledger (`evidence-ledger.ts`)

### 类型

```typescript
type UndergroundEvidenceKind =
  | "goal_intent" | "soil_constraint" | "rootlet_output"
  | "candidate_comparison" | "convergence_decision"
  | "user_clarification" | "stop_reason";

type UndergroundEvidenceEntry = {
  evidenceId: string; goalId: string; kind: UndergroundEvidenceKind;
  summary: string; sourceRefs: string[]; createdAt: string;
};

type UndergroundEvidenceLedger = {
  ledgerId: string; goalId: string;
  entries: UndergroundEvidenceEntry[];
  createdAt: string; updatedAt: string;
};
```

### 工厂函数

- `createUndergroundEvidenceLedger(input)` — 创建 ledger
- `appendUndergroundEvidenceEntries(ledger, entries, updatedAt)` — 追加条目（去重）
- `createUndergroundEvidenceEntry(input)` — 创建单条目
- `evidenceId(goalId, localName)` — 生成证据 ID: `evidence:{goalId}:{localName}`
- `cloneUndergroundEvidenceLedger(ledger)` — 深拷贝

---

## 9. Guard 三态门 (`guard.ts`)

### GuardedActionOutput<T> — 联合类型

```typescript
type GuardedActionOutput<T> =
  | { readonly status: "accepted"; readonly output: T; readonly guard: GuardResult & { passed: true } }
  | { readonly status: "rejected"; readonly output: T; readonly guard: GuardResult & { passed: false }; readonly violations: GuardViolation[] }
  | { readonly status: "fallback"; readonly output: T; readonly guard: GuardResult; readonly fallbackSourceRefs: string[]; readonly fallbackReason: string };
```

### 工厂函数

- `acceptGuardedAction<T>(output)` — status: "accepted"
- `rejectGuardedAction<T>({ output, violations })` — status: "rejected"
- `fallbackGuardedAction<T>({ output, reason, sourceRefs })` — status: "fallback"
- `createGuardViolation({ code, message, severity?, sourceRef? })` — 创建违规记录
- `createGuardResult({ violations })` — 创建 guard 结果（passed = 无 error severity violations）

### Guard 判定逻辑

- `passed`: `!violations.some(v => v.severity !== "warning")` — 只有 warning 不算失败
- `severity` 默认视为 error 级别

---

## AI 化模式总结

### 模式 A：使用 `reasonWithAgentTurn` envelope（IntentCoreAgent）

适用于需要统一的 reasoning trace、fallback 管理、contract 验证的场景。
- 构造 `ModelOutputContract`
- 构造 system + user `ModelMessage[]`
- 提供 `parse(output, response) -> UndergroundReasoningParseResult<T>`
- envelope 自动处理 runtime 缺失回退、contract 验证失败回退、confidence 归一化
- 结果包含 `reasoningTrace`，agent 直接透传到 decision

### 模式 B：独立 AI 函数（AutonomyReviewerAgent）

适用于需要自定义 policy（更多轮次、允许工具调用）或特殊解析逻辑的场景。
- `requestUndergroundAutonomyDecision()` 独立函数
- 直接调用 `agentTurnRuntime.execute()`
- 自定义 `AgentTurnPolicy`（`maxModelRounds: 3`, `maxToolRounds: 2`, `fallback: "disabled"`）
- 自己处理所有解析和验证逻辑
- 不走 envelope，不自动生成 reasoning trace

### 模式 C：确定性 reason（CandidateCollectorAgent）

适用于纯数据聚合/确定性逻辑的场景。
- `reason()` 是同步函数
- 不调用 `reasonWithAgentTurn`
- 不使用 `agentTurnRuntime`
- decision 来自纯规则计算

### 待 AI 化 agent 的当前状态

| Agent | 当前 reason() | AI 化状态 |
|---|---|---|
| IntentCoreAgent | `reasonWithAgentTurn` (模式 A) | 已 AI 化 |
| GrowthGovernorAgent | 未读取，待确认 | 待确认 |
| RootletExplorerAgent | 未读取，待确认 | 待确认 |
| CandidateCollectorAgent | 确定性 (模式 C) | 待 AI 化 |
| AutonomyReviewerAgent | 独立 AI 函数 (模式 B) | 已 AI 化但不用 envelope |
| ConvergenceJudgeAgent | 未读取，待确认 | 待确认 |
| HandoffStewardAgent | 未读取，待确认 | 待确认 |

---

## Caveats / Not Found

- GrowthGovernorAgent、RootletExplorerAgent、ConvergenceJudgeAgent、HandoffStewardAgent 的 reason() 实现未在本次研究中读取，待后续补充。
- `reasonWithAgentTurn` 的 `purpose: ModelPurpose` 和 `AgentTurnRuntime` 接口定义在 `kernel/intelligence/` 下，本次未深入。
- AutonomyReviewerAgent 使用模式 B 而非模式 A，可能是因为需要自定义 policy（更多 model/tool rounds、disabled fallback）。
