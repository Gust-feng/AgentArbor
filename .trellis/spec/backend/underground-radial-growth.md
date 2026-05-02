# 地下辐射生长

本文件记录 V0.3 已出生的 Underground Center 最小辐射生长运行时契约，并补充 V0.5 用户澄清升级与澄清回答后恢复契约。它只覆盖确定性内存 runtime，不引入真实 LLM、数据库、UI、HTTP、SSE、WebSocket、MCP、A2A 或 AG-UI adapter。

## Scope / Trigger

- Trigger：修改 `src/domain/underground/**`、`src/app/minimal-underground.ts`、`src/app/agents/underground-analyzer.ts` 或 DirectionHandoff source candidate 选择逻辑。
- Scope：最小 Underground Center radial growth、rootlet cluster、RootletOutput、CandidatePool、ConvergenceReport、用户澄清升级/恢复和 DirectionHandoffPackage 输入守卫。

## Development Priority / Phase Boundary

- 当前下一阶段优先把 Underground Center 做成独立闭环：用户输入需求 -> 地下探索 / 反驳 / 收束 -> 必要用户澄清与恢复 -> 产出 approved `.agentarbor` Direction Handoff Package。
- 地下单环的终态只允许 `approved_package_created`、`awaiting_user`、`stopped`：前者表示 approved package 已创建并可被后续地上环接管；`awaiting_user` 表示存在阻塞澄清请求；`stopped` 表示没有足够候选或权限继续。
- Nutrient Request、Nutrient Patch 和 Growth Plan Revision 属于后续地下-地上跨环节协同，不是当前地下单环的主线；在地下单环和地上单环稳定前，不以地上回调地下作为优先实现路径。

## Scenario: 地下独立闭环 2A-2D

### 1. Scope / Trigger

- Trigger：修改 `GoalIntentProfile`、Intent Core、rootlet 动态选择、CandidateComparison、Evidence Ledger、地下-only session 或 Direction Handoff 字段派生。
- Scope：只覆盖用户需求进入 Underground Center 后产出三类终态之一；不实现地上回调、Nutrient Request、Verification/Governance 执行链路、UI、HTTP、SSE、WebSocket、数据库、真实 LLM、MCP、A2A 或 AG-UI adapter。

### 2. Signatures

- `GoalIntentProfile`：包含 `goalId`、`rawGoal`、`goalStatement`、`keyConcepts`、`nonGoals`、`acceptanceCriteria`、`assumptions`、`riskHints`、`constraintHints`、`unknowns`、`createdAt`。
- `createGoalIntentProfile({ goalId, rawGoal, constraints, createdAt? })`：确定性 Intent Core 解析器。
- `selectRootletClusterKindsForGoalIntent(profile)`：根据目标画像选择 `option/risk/asset_fit/evidence/constraint/counterfactual`，简单目标不得全量启动 rootlet。
- `CandidateComparison`：记录 candidate 的 `goalMatch`、`evidenceSupport`、`constraintImpact`、`riskLevel`、`unknowns`、`whyNot`、`conclusion` 和 `evidenceRefs`。
- `compareCandidatesForGoal(...)`：基于目标画像、候选和 rootlet output 生成比较、收束决策和 evidence entries；不得按 `clusterId` 硬编码 accepted / merged / rejected。
- `UndergroundEvidenceLedger`：地下证据账本，收纳 goal intent、Soil constraint、rootlet output、candidate comparison 和 convergence decision evidence。
- `runUndergroundDirectionSession(goal, options?)`：地下-only 入口，返回 `approved_package_created`、`awaiting_user` 或 `stopped`，并生成 JSON-safe observation snapshot。`options` 可包含 `constraints`、显式 `packageStore` 或显式 `outputDirectory`；不传 store / output directory 时只能使用 in-memory package store。
- `recoverUndergroundDirectionSession(awaitingSession, clarificationResponse?)`：地下-only 恢复入口，接收 awaiting-user session 与可选澄清回答；未传回答时创建 deterministic demo/test response，保存同一 direction 的 approved v2 package。
- `createUndergroundDemoSummary(result, recovery?)`：地下-only demo 的纯投影函数，输入 `UndergroundDirectionSessionResult` 和可选恢复结果，输出 JSON-safe summary；不得读取 CLI、写文件或访问 store。
- `pnpm demo:underground -- "<goal>"`：地下-only CLI 命令，只运行 Underground Center 到 Direction Handoff Package 边界，不进入 Aboveground。
- `pnpm demo:underground -- --auto-answer "<goal>"`：仅当地下 session 停在 `awaiting_user` 时自动发布 deterministic 澄清回答并恢复为 approved v2；`approved` / `stopped` 不得伪造恢复。
- `pnpm demo:underground -- --out <dir> "<goal>"`：只在调用方显式提供 `<dir>` 时写出 Direction Handoff Package；不得默认选择 repo-root `.agentarbor/`。

### 3. Contracts

- Intent Core 先用确定性规则解析目标，不接真实 LLM；解析结果必须进入后续 rootlet 选择、候选比较和 handoff 字段派生。
- Rootlet 选择由 `GoalIntentProfile` 驱动；简单目标默认只启动 `option`，风险/资产/证据/约束/反驳明显时才启动对应 cluster。
- 单个 `RootletOutput` 只能进入 `CandidatePool`，不能直接进入 Direction Handoff Package。
- Convergence Judge 必须基于 `CandidateComparison.conclusion` 生成 `accepted/merged/rejected/unknown`，并记录 source candidate refs 和 evidence refs。
- `approved_package_created` 只允许在有 accepted / merged handoff candidates 且无 blocking unknown 时出现。
- `awaiting_user` 只允许在存在 blocking unknown 和 `UserClarificationRequest` 时出现；non-blocking unknown 不得单独制造等待用户状态。
- `stopped` 必须带可审计停止理由，例如 `budget_exhausted_without_converged_candidates`；停止状态不得伪造 approved package。
- `runUndergroundDirectionSession` 的 `packageStore` 与 `outputDirectory` 是互斥存储入口；二者同时传入必须报错，避免一个 session 出现两个 package 事实源。
- `outputDirectory` 只代表调用方显式授权的 filesystem package store 根目录；默认地下 session / demo 不得写入 repo-root `.agentarbor/`。
- `recoverUndergroundDirectionSession` 必须复用 awaiting session 的 runtime 和 package store，保存 v1 awaiting_user 与 v2 approved，并让 `listVersions(directionId)` 返回 `[1, 2]`。
- deterministic auto-answer 只属于地下-only demo/test 边界，不代表真实用户交互设计，也不得进入 Soil、RunMemory、Experience Candidate 或 Capability Asset。
- 恢复成功后的 demo summary 以 approved v2 作为当前 `directionPackage`，并暴露 `recoveredPackage`、`lineage`、`versions` 和可选 `writtenPackagePath`；无恢复时 `recoveredPackage` 必须为空。
- Direction Handoff 的 `clarifiedGoal`、`nonGoals`、`assumptions`、`risks`、`options` 和 `missingInformation` 必须由 `GoalIntentProfile + CandidatePool + ConvergenceReport` 派生，不得回退到固定 minimal 文案。
- 地下约束交接链当前只在 `direction_handoff` 阶段执行阻断校验；其他 6 个 gate 作为 `candidateConstraintRefs` 可追踪交接，不实现后续层执行。
- Evidence Ledger 是运行期证据索引，不是 Soil、RunMemory 或长期资产库；它必须由 EventLog / 地下运行结果派生并随 report 暴露。
- 地下-only demo summary 是可读投影，不是 EventLog、RunMemory、Soil 或长期资产；它不得成为新的事实源。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 简单目标无风险/资产/证据/约束/反驳关键词 | 只启动 `option` rootlet |
| 目标包含风险、资产、证据、约束和反驳信号 | 启动对应 rootlet cluster |
| blocking unknown 存在 | 收束为 `awaiting_user`，必须带 `UserClarificationRequest` |
| awaiting-user session 收到澄清回答 | 发布 `user_approval.received -> direction_handoff.revision_requested -> convergence_review.completed -> direction_handoff.completed`，保存 approved v2 |
| non-blocking unknown 且无 handoff candidates | 收束为 `stopped`，不得生成无问题的 awaiting_user |
| accepted / merged candidate 存在且无 blocking unknown | 收束为 `approved`，地下-only 终态为 `approved_package_created` |
| Direction Handoff source candidates 包含 unknown / rejected / candidate | package validation 失败 |
| package 中 hard constraint 被 nonGoal / assumption / option / Path Bias 文案弱化 | package validation 失败，错误码 `HARD_CONSTRAINT_WEAKENED_IN_HANDOFF_TEXT` |
| 地下-only demo 被调用 | EventLog 正常路径停在 `direction_handoff.completed`，不得包含 `growth_plan.completed` |
| 地下-only demo 带 `--auto-answer` 且 v1 为 `awaiting_user` | 终态映射回 `approved_package_created`，package version 为 2，Aboveground 仍为 `not_started` |
| 地下-only demo 未传 `--out` | repo-root `.agentarbor/` 不得新增或修改 |
| 地下-only demo 传入 `--out <dir>` | package 可从 `<dir>` round-trip load，summary 暴露 canonical `handoff.meta.json` 路径 |

### 5. Good / Base / Bad Cases

- Good：`runUndergroundDirectionSession("Build a small deterministic helper.")` 只启动 `option` rootlet，保存 approved in-memory package，不进入 Aboveground。
- Good：`pnpm demo:underground -- "构建任务管理平台，包含测试和监控，不接数据库"` 输出动态 rootlet kinds、package validation 和 observation layer statuses。
- Base：默认 full-loop demo 仍可在 approved package 后显式进入地上、验证和治理，保持 18 步 EventLog。
- Bad：rootlet 全量启动、按 `clusterId` 直接决定收束、或把固定 `real_llm/ui/database` 文案写死进所有 handoff。
- Bad：CLI 入口直接组装 package、绕过 `runUndergroundDirectionSession`，或把 console 输出对象当成 Soil / RunMemory。

### 6. Tests Required

- Intent Core 能从不同目标派生 key concepts、nonGoals、acceptance criteria、assumptions、risk hints、constraint hints 和 unknowns。
- 动态 rootlet selection：简单目标不全量启动，复杂目标按信号启动对应 cluster。
- CandidateComparison 对同一 rootlet kind 在不同目标下能产生不同 convergence decision。
- Direction Handoff 字段从 goal profile、候选和收束报告派生，且不回退固定 minimal 文案。
- blocking unknown / stopped / approved 三类地下-only 终态均有测试。
- awaiting_user 通过 `recoverUndergroundDirectionSession` 或 `--auto-answer` 恢复为 approved v2，保持同一 direction id，store versions 为 `[1, 2]`。
- 恢复 EventLog 包含 `user_approval.received`、`direction_handoff.revision_requested`、第二次 `convergence_review.completed` 和最终 `direction_handoff.completed`。
- `createUndergroundDemoSummary` 对 approved / awaiting_user / stopped / recovered approved v2 终态均有测试，且 awaiting_user / recovered 都不包含 `growth_plan.completed`。
- `runUndergroundDirectionSession` 覆盖 injected package store、显式 `outputDirectory` round-trip 和未传 `--out` 不写 repo-root `.agentarbor/`。
- 默认 demo 和地下-only session 都不写 repo-root `.agentarbor/`。
- `pnpm demo:underground` 可运行默认目标和自定义目标，并保持 7 步地下-only EventLog。

### 7. Wrong vs Correct

#### Wrong

```ts
const selectedKinds = ROOTLET_CLUSTER_KINDS;
const status = clusterId.includes("option") ? "accepted" : "rejected";
```

#### Correct

```ts
const selectedKinds = selectRootletClusterKindsForGoalIntent(goalIntentProfile);
const comparison = compareCandidateForGoal({ goalProfile, candidate, rootletOutput, createdAt });
```

Rootlet 是否启动和候选如何收束都必须从目标画像和比较结果出发，而不是从固定 fixture 或 cluster 名称出发。

## Scenario: 地下 Agent 集群调度内核

### 1. Scope / Trigger

- Trigger：修改 `src/domain/underground/agent-cluster.ts`、`src/app/underground-agent-cluster-runtime.ts`、地下 session、rootlet output、candidate pool、智能通道地下接入或 Observation underground view。
- Scope：只覆盖确定性内存地下 agent 集群调度；不引入 UI、HTTP、SSE、WebSocket、数据库、真实 LLM demo、MCP、A2A、AG-UI、外部 LLM SDK 或 repo-root `.agentarbor/` 运行资产。

### 2. Signatures

- `UndergroundAgentRole` 固定覆盖 `intent_core`、`growth_governor`、`rootlet_agent`、`convergence_judge`、`handoff_steward`。
- `UndergroundAgentClusterPlan` 记录 `goalId`、raw goal、budget、将启动的 agents、rootlet kinds 和 scheduling reasons。
- `UndergroundAgentInvocation` 必须包含 `invocationId`、`agentId`、`role`、`inputRefs`、`outputRefs`、`status`、`startedAt`、可选 `completedAt` / `failureReason`。
- `UndergroundAgentClusterRun` 记录 plan、invocations、terminal status、candidate refs、可选 package ref、started/completed timestamps 和 stop reason。
- `RootletOutput` 必须包含 `invocationId`；`createCandidatePool(...)` 必须接收同一运行的 `agentInvocations` 并验证 rootlet output 来自 completed `rootlet_agent` invocation。

### 3. Contracts

- 地下 session 默认必须走 agent cluster runtime；不能回退到 app helper 直接把 rootlet output 塞进 candidate pool。
- 调度器必须先注册地下 agent manifests，再按 `GoalIntentProfile` 和动态 rootlet 选择结果启动 rootlet agent invocations。
- rootlet output 进入正式 candidate pool 前，必须能追溯到 completed `rootlet_agent` invocation，且 `output.producedByAgentId === invocation.agentId`、`invocation.outputRefs` 包含 `output.outputId`。
- `IntelligenceChannel` 只能作为 rootlet agent 的能力来源；AI output 只有被 rootlet invocation 包装成 `RootletOutput` 后，才能进入 candidate pool。
- Convergence Judge 与 Handoff Steward 仍是确定性守门；模型输出不能绕过 candidate pool、convergence report、Direction Handoff Package validation。
- 不新增事件类型时，复用的地下事件 payload 必须包含 `agentCluster` / `invocation` 信息，证明 plan、run 和 invocations 被调度；Observation Snapshot 必须投影 `underground.agentCluster`。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| RootletOutput 缺少 invocationId | `UndergroundConvergenceError`，不得进入 candidate pool |
| invocation 不存在、不是 `rootlet_agent`、未 completed、producer 不匹配或 outputRefs 不包含 outputId | `UndergroundConvergenceError` |
| AI output 不符合输出契约 | 智能通道发布 failed，rootlet invocation 不产生 AI rootlet output |
| 动态 rootlet 选择为 N 个 rootlet kind | Observation 中必须存在 N 个 completed `rootlet_agent` invocations |
| awaiting_user / stopped | 仍必须生成 agent cluster run 观测结果，且 Aboveground 保持 `not_started` |
| EventLog / Snapshot 出现 API key、token 或 provider secret | 测试失败 |

### 5. Good / Base / Bad Cases

- Good：简单目标只启动 `option` rootlet，并在 Observation 中显示 intent、growth、option rootlet、convergence 和 handoff invocations。
- Good：智能通道候选建议被包装为 option rootlet invocation 的 output，再进入 candidate pool 和 convergence。
- Base：完整 demo 继续保持固定地下事件顺序，只在 payload 和 Observation view 中增加 agent cluster 信息。
- Bad：`runUndergroundDirectionSessionWithIntelligence` 先拿模型输出再把它作为 loose `extraRootletOutputs` 直接并入候选池。
- Bad：为了展示 agent cluster 新增长期 Capability Asset、repo-root `.agentarbor/` 占位资产或外部 provider SDK。

### 6. Tests Required

- 地下-only happy path 通过 agent cluster runtime 产出 approved package，且 EventLog payload 包含 `agentCluster`。
- Rootlet output 没有关联 completed rootlet invocation 时不能进入 candidate pool。
- AI output 必须通过 rootlet invocation 才能进入 candidate pool。
- 动态 rootlet selection 形成对应数量的 rootlet agent invocations。
- awaiting_user / stopped 仍暴露 agent cluster run，且不进入 Aboveground。
- Observation Snapshot 展示 cluster plan、invocations、candidate refs 和 package refs。
- EventLog / Snapshot 不包含 API key / token。

### 7. Wrong vs Correct

#### Wrong

```ts
const extraRootletOutputs = await requestUndergroundRootletCandidateAdvice(...);
createMinimalCandidatePool({ goalId, rootletOutputs: extraRootletOutputs });
```

#### Correct

```ts
const invocation = startRootletAgentInvocation(...);
const rootletOutput = createRootletOutputForInvocation({ invocation, ... });
createMinimalCandidatePool({ goalId, rootletOutputs: [rootletOutput], agentInvocations: [completedInvocation] });
```

正式候选池只接受能回溯到 agent invocation 的 rootlet output；这保证地下组织是调度出来的，而不是 session helper 拼出来的。

## Scenario: 地下消息驱动调度内核

### 1. Scope / Trigger

- Trigger：修改 `src/app/underground-message-dispatcher.ts`、`src/app/underground-direction-session.ts`、地下阶段事件发布 helper、地下消息驱动测试或 handler 级 `from.id` 约定。
- Scope：只覆盖内存版 MessageBus 驱动地下单环；不引入持久 broker、后台重试、并发执行器、UI、HTTP、数据库、MCP、A2A、AG-UI、真实 LLM CLI demo、外部 SDK 或 repo-root `.agentarbor/` 运行资产。

### 2. Signatures

- `MessageDrivenUndergroundDispatcher({ runtime, intelligenceChannel?, maxDispatchSteps? })`：订阅地下阶段消息并按队列推进 handler。
- `dispatchUntilIdle()`：同步推进确定性地下 handler；若遇到需要异步智能通道的 handler，必须失败并要求调用异步入口。
- `dispatchUntilIdleAsync()`：推进可能调用 `IntelligenceChannel` 的 rootlet handler。
- `UndergroundMessageDrivenDispatchResult`：返回终态、地下报告、方向交接包、loaded package ref、processed message ids 和 dispatch step count。

### 3. Contracts

- `runUndergroundDirectionSession` 默认只能创建并发布 `goal.received`，地下阶段推进必须由 dispatcher 订阅 MessageBus 后触发；session 不得重新串行调用 prepare / rootlet / candidate pool / convergence / handoff helper。
- handler 之间的跨阶段推进必须通过正式 `ArborMessage`：`goal.received -> underground.exploration_planned -> rootlet_cluster.started -> exploration_candidate.produced -> candidate_pool.updated -> convergence_review.completed -> direction_handoff.completed | user_approval.requested`。
- 每个 handler 输出事件必须带对应 agent `from.id`：Intent Core、Growth Governor、Rootlet Agent、Convergence Judge、Handoff Steward；EventLog 必须能直接读出推进者。
- dispatcher 可以维护 trace-scoped typed context store，但写入和读取必须由消息触发；context store 不能替代 EventLog、DirectionHandoffPackageStore 或 Observation Snapshot 的事实源。
- dispatcher 必须记录 processed message id、phase guard 和 max dispatch steps；重复消息不能重复产出地下结果。
- 直接发布后续阶段事件、但没有同 trace 的 `goal.received` context 时，dispatcher 必须失败，不得跳阶段产出 convergence、handoff package 或用户澄清请求。
- 智能通道只允许在 rootlet handler 内把模型输出包装为 `RootletOutput`；模型输出仍必须经过 candidate pool、convergence 和 handoff validation。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| `goal.received` 经 MessageBus 发布 | dispatcher 逐步发布地下阶段事件并返回终态结果 |
| 未发布任何消息即调用 dispatch | 返回 `undefined`，EventLog 不新增地下结果 |
| 重复发布同一 message id 或同 trace 同阶段消息 | 只处理首个阶段推进，地下结果只产出一次 |
| dispatch step 超过 `maxDispatchSteps` | 抛 `UndergroundMessageDispatcherError`，不得继续推进后续阶段 |
| 直接发布 `candidate_pool.updated` 等后续阶段且缺少 context | 抛 `UndergroundMessageDispatcherError`，不得产出 `convergence_review.completed` 或 handoff 事件 |
| session 重新直接调用旧 cluster 串行 runtime | 设计违规，测试应通过消息驱动断言暴露回归 |
| rootlet handler 绕过智能通道或 candidate pool 直接写 approved handoff | 智能通道和 handoff validation 测试失败 |

### 5. Good / Base / Bad Cases

- Good：地下-only session 发布一个 `goal.received` 后，由 dispatcher 队列逐步推进，并在 EventLog 中看到每个 handler 的 `from.id`。
- Good：重复 goal message 不会生成第二个 `underground.exploration_planned` 或第二个 handoff package。
- Base：旧的 agent cluster runtime helper 可以继续作为 handler 内部纯计算/兼容入口存在，但 session 默认路径不再直接调用它。
- Bad：session 在发布 `goal.received` 后继续手动调用 rootlet、candidate pool、convergence 和 handoff helper。
- Bad：测试直接构造 context store 或 package 结果来证明成功，而不是通过 MessageBus 发布消息驱动 dispatcher。

### 6. Tests Required

- handler `from.id` 覆盖正常地下阶段事件。
- 重复 message id / 同 trace 同阶段消息不会重复推进。
- `maxDispatchSteps` 能阻断递归或失控 dispatch。
- 没有 `goal.received` context 的后续阶段消息不能跳阶段产出地下结果。
- `runUndergroundDirectionSessionWithIntelligence` 仍只让模型输出进入 rootlet output / candidate pool，不绕过 convergence 和 handoff validation。
- Observation Snapshot 仍从 EventLog + runtime result 派生，并保持 JSON-safe。

### 7. Wrong vs Correct

#### Wrong

```ts
runtime.bus.publish(goalMessage);
const exploration = runUndergroundAgentClusterExploration({ runtime, traceId, goalId, rawGoal });
```

#### Correct

```ts
const dispatcher = new MessageDrivenUndergroundDispatcher({ runtime });
runtime.bus.publish(goalMessage);
const result = dispatcher.dispatchUntilIdle();
```

跨 agent / 跨阶段推进只能由 dispatcher 消费 MessageBus 事件完成；纯函数 helper 只能保留为 handler 内部实现细节。

## Signatures

- 固定 center roles：`intent_core`、`growth_governor`、`constraint_sentinel`、`evidence_ledger`、`convergence_judge`、`handoff_steward`。
- 固定 rootlet cluster kinds：`option`、`risk`、`asset_fit`、`evidence`、`constraint`、`counterfactual`。
- `UndergroundExplorationPlan`：记录 goal、预算、center roles 和 rootlet cluster plans。
- `RootletOutput`：rootlet 产物，只能作为 CandidatePool 来源。
- `CandidatePool`：候选池，是 rootlet output 进入 handoff 之前的唯一候选容器。
- `CandidateConvergenceDecision`：每个候选的 accepted / merged / rejected / unknown 收束决策，必须记录 `sourceCandidateRefs`。
- `UndergroundConvergenceReport`：收束结果，给出 handoff 可用候选、用户升级、预算耗尽和停止原因。
- `UserClarificationRequest`：阻塞未知项需要用户澄清时产生的地下升级请求，必须包含 goal id、related candidate refs、questions、blocking level、createdAt 和 status。
- `UserClarificationResponse`：用户对澄清请求的回答，必须包含 request id、goal id、answers、answeredAt、status=`answered` 和 evidence refs。
- `OpenQuestionDisposition`：unknown 候选的处置结果，区分 `request_user_clarification` 与 `remain_open`；blocking unknown 必须进入 `UserClarificationRequest`，non-blocking unknown 只能作为 open question 保留。
- `UndergroundIndependentLoopTerminalStatus`：文档层终态口径，固定为 `approved_package_created`、`awaiting_user`、`stopped`；它不要求立即新增 runtime 类型，但后续状态命名必须能映射到这三种单环终态。

## Contracts

- RootletOutput 不得直接进入 DirectionHandoffPackage 输入。
- DirectionHandoffPackage 输入只能来自 CandidatePool 中被 convergence 标记为 `accepted` 或 `merged` 的 `ExplorationCandidateRef`。
- rejected / unknown / candidate 状态的候选可以保留为收束证据，但不得进入 `DirectionHandoff.sourceCandidateRefs`。
- budget exhausted 后必须给出 deterministic outcome：无阻塞澄清且已有 accepted/merged 候选时为 `approved`；存在 blocking unknown 时为 `awaiting_user` 并带 `UserClarificationRequest`；没有可用候选时为 `stopped` 并记录 stop reason。
- 地下独立闭环的完成条件不是进入 Aboveground planning，而是 approved DirectionHandoffPackage 已创建 / 保存，并能被 package validation 证明可接管；该状态在计划和看板中记为 `approved_package_created`。
- `awaiting_user` 必须保留为地下单环内的阻塞状态，等待用户澄清回答后重新收束；恢复流程完成前不得把等待用户的 package 视为可接管。
- `stopped` 必须带有可审计停止理由，例如预算耗尽、无收束候选、权限边界不允许继续或用户明确停止。
- non-blocking unknown 可以保留为 open question，但不得进入 `DirectionHandoff.sourceCandidateRefs`，也不得阻断已有 accepted/merged 候选的 approved 收束。
- non-blocking unknown 不能单独制造 `awaiting_user`；没有 accepted/merged handoff candidates 且预算耗尽时，必须以 `stopped` / `budget_exhausted_without_converged_candidates` 收束，而不是生成没有 `UserClarificationRequest` 的等待用户状态。
- blocking unknown 不能被 accepted/merged 候选掩盖；它必须让收束结果保持 `awaiting_user`，等待用户澄清后才能批准 handoff。
- 用户澄清回答后，Underground 必须把 `UserClarificationResponse` 与原请求匹配后重新收束；恢复流程不得跳过 convergence review，也不得直接把 v1 awaiting-user package 改成 approved。
- Handoff Steward 只负责把已收束候选组装为方向交接包输入，不能把 rootlet output、Growth Plan、Soil 副本或最终资产写入 `.agentarbor`。
- Handoff Steward 在当前阶段不负责响应 Nutrient Request，也不负责产出 Growth Plan Revision；这些职责必须等地下单环和地上单环稳定后再作为跨环节协同扩展。

## Scenario: V0.5 用户澄清升级

### 1. Scope / Trigger

- Trigger：修改 `src/domain/underground/clarification.ts`、`createUndergroundConvergenceReport`、awaiting-user direction material、`runClarificationRequiredUndergroundFlow` 或 Observation Kernel 的地下升级视图。
- Scope：只覆盖确定性内存地下-only 澄清场景；不实现 UI、HTTP、SSE、WebSocket、数据库、真实 LLM、MCP、A2A、AG-UI adapter 或 repo-root `.agentarbor` 写入。

### 2. Signatures

- `UserClarificationReason` 固定覆盖 `goal_conflict`、`permission_boundary_unclear`、`critical_fact_missing`、`value_tradeoff_required`、`hard_constraint_unclear`。
- `createOpenQuestionDisposition(...)` 用于声明 unknown 候选是 blocking clarification 还是 non-blocking open question。
- `createUndergroundConvergenceReport(...)` 接收 `openQuestionDispositions`、`userClarificationRequestId` 和 `createdAt`，并输出 `openQuestions` 与可选 `userClarificationRequest`。
- `createAwaitingUserDirectionMaterial(...)` 只能创建 `status = "awaiting_user"` 的 Direction Handoff Package；不得复用或改变 `createMinimalDirectionMaterial(...)` 的 approved happy path。
- `runClarificationRequiredUndergroundFlow(...)` 是地下-only 场景 helper，输出 awaiting-user report、clarification request、awaiting-user package、Observation Snapshot 和包含 `user_approval.requested` 的 EventLog。
- `createClarificationRecoveryDirectionMaterial(...)` 接收 awaiting-user package、`UserClarificationRequest` 和 `UserClarificationResponse`，输出 approved convergence report、同一 direction 的下一版本 approved DirectionHandoffPackage。
- `runClarificationRecoveryFlow(...)` 是确定性内存恢复场景 helper，必须在 `user_approval.requested` 后继续发布 `user_approval.received`、`direction_handoff.revision_requested`、第二次 `convergence_review.completed` 和最终 `direction_handoff.completed`。

### 3. Contracts

- `UserClarificationRequest` 必须包含 `goalId`、`relatedCandidateRefs`、`questions`、`blockingLevel`、`createdAt` 和 `status`。
- blocking unknown 必须生成 `UserClarificationRequest`，并令 convergence outcome 为 `awaiting_user`。
- non-blocking unknown 只能进入 `openQuestions`，不得进入 handoff candidates，不得强制用户升级。
- Direction Handoff Package 可以被保存为 `awaiting_user`，但 validation 必须失败于 `DIRECTION_HANDOFF_NOT_APPROVED`，Aboveground planning 必须拒绝。
- Observation Kernel 的 `underground.userEscalation` 必须暴露 request id、reason、blocking level、status、related candidate refs、questions 和 request plain data。
- Event view 遇到 payload 中的 `clarificationRequest.requestId` 时，应输出 `ObservationRef.kind = "user_clarification"`。
- Event view 遇到 payload 中的 `clarificationResponse.requestId` 或 `requestId` 时，也应输出 `ObservationRef.kind = "user_clarification"`。
- 恢复后的 approved convergence report 必须清除 blocking open question、`requires_user_clarification` stop reason 和未解决的 `userClarificationRequest`；否则 approved package validation 必须失败。
- 恢复后的 approved DirectionHandoffPackage 必须保持同一 `directionId`，版本号递增，且 store 中 v1 awaiting_user 与 v2 approved 可同时存在。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| blocking unknown 存在 | `UndergroundConvergenceReport.outcome === "awaiting_user"` 且存在 `userClarificationRequest` |
| non-blocking unknown 与 accepted/merged 候选并存 | outcome 可为 `approved`，unknown 只保留在 `openQuestions` |
| non-blocking unknown 没有 accepted/merged 候选且预算耗尽 | `outcome === "stopped"`，无 `userClarificationRequest` |
| awaiting-user package 进入 Aboveground planning | `DirectionHandoffPackageValidationError` |
| awaiting-user package validation | `passed === false`，包含 `DIRECTION_HANDOFF_NOT_APPROVED` |
| Event payload 携带 clarification request | Observation event refs 包含 `user_clarification` |
| Event payload 携带 clarification response | Observation event refs 包含 `user_clarification` |
| 用户回答澄清请求 | 发布 `user_approval.received`，随后请求 handoff revision，重新发布 approved convergence review，并完成 v2 approved handoff |
| v1 awaiting_user package 进入 Aboveground planning | `DirectionHandoffPackageValidationError` |
| v2 approved package 进入 Aboveground planning | planning 成功 |

### 5. Good / Base / Bad Cases

- Good：阻塞权限边界未知时，地下中枢生成 `UserClarificationRequest` 和 `user_approval.requested`，并阻止 Aboveground planning。
- Base：happy path 无 unknown，仍走 `createMinimalDirectionMaterial` approved package 和 18 步 EventLog。
- Bad：把 `awaiting_user` package 当作 approved handoff 继续规划，或让 Aboveground 自己补齐地下澄清问题。

### 6. Tests Required

- blocking unknown creates `UserClarificationRequest`。
- non-blocking unknown remains open question and is excluded from handoff candidates。
- non-blocking unknown without handoff candidates stops on budget exhaustion and never creates awaiting-user without clarification。
- awaiting-user package cannot enter Aboveground planning。
- clarification recovery creates `user_approval.received`、approved v2 package、lineage 和同 direction `[1, 2]` versions。
- Observation Snapshot exposes `underground.userEscalation` request details。
- Observation Snapshot exposes clarification responses from `user_approval.received` events。
- main minimal happy path remains the fixed 18-event sequence。

## EventLog Contract

Underground 正常路径事件顺序固定为：

```text
goal.received
-> underground.exploration_planned
-> rootlet_cluster.started
-> exploration_candidate.produced
-> candidate_pool.updated
-> convergence_review.completed
-> direction_handoff.completed
```

后续地上、验证和治理事件继续接在该序列之后。测试必须固定完整 demo EventLog 顺序。

地下-only 用户澄清场景在 `convergence_review.completed` 后发布 `user_approval.requested`，不得继续进入 `growth_plan.completed` 或任何 Aboveground planning 事件。

地下-only approved demo 的正常 EventLog 固定停在：

```text
goal.received
-> underground.exploration_planned
-> rootlet_cluster.started
-> exploration_candidate.produced
-> candidate_pool.updated
-> convergence_review.completed
-> direction_handoff.completed
```

`pnpm demo:underground` 只能展示该地下单环边界；完整闭环仍由 `pnpm demo` 负责。

用户澄清恢复场景在 `user_approval.requested` 后继续追加：

```text
user_approval.received
-> direction_handoff.revision_requested
-> convergence_review.completed
-> direction_handoff.completed
```

恢复场景默认仍不得进入 Aboveground planning；只有调用方显式用 approved v2 package 调用 Aboveground planner 时才进入地上路径。

## Tests Required

- rootlet output cannot directly enter handoff。
- unconverged candidates fail DirectionHandoffPackage validation。
- accepted / merged / rejected / unknown decisions preserve source candidate refs。
- budget exhaustion resolves to approved / awaiting_user / stopped with reason。
- blocking unknown creates a `UserClarificationRequest`。
- non-blocking unknown remains as open question and does not enter handoff candidates。
- non-blocking unknown without handoff candidates stops on budget exhaustion and never creates awaiting-user without clarification。
- awaiting_user package is saved and rejected by Aboveground planning。
- clarification response recovery saves v1 awaiting_user and v2 approved for the same direction, and `listVersions(directionId)` returns `[1, 2]`。
- Observation Kernel exposes `underground.userEscalation` details and `user_clarification` refs。
- Observation Kernel exposes clarification response details and recovery event refs。
- Handoff Steward packages only accepted / merged converged candidates。
