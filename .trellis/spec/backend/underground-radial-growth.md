# 地下辐射生长

本文件记录 V0.3 已出生的 Underground Center 最小辐射生长运行时契约，并补充 V0.5 用户澄清升级、澄清回答后恢复和当前 AI 驱动地下集群主线契约。确定性内存 runtime 是状态、验证、审计和 fallback 基础；地下目标成形、探索、自治、收束和交接叙事必须逐步转向经 `AgentTurnRuntime` / `IntelligenceChannel` 驱动的分层 agent 协作。

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
- Scope：覆盖用户需求进入 Underground Center 后产出三类终态之一，以及 AI rootlet / autonomy / convergence 主线与确定性边界守卫的交接；不实现地上回调、Nutrient Request、Verification/Governance 执行链路、UI、HTTP、SSE、WebSocket、数据库、MCP、A2A 或 AG-UI adapter。

### 2. Signatures

- `GoalIntentProfile`：包含 `goalId`、`rawGoal`、`goalStatement`、`keyConcepts`、`domainConcepts`、`nonGoals`、`acceptanceCriteria`、`assumptions`、`riskHints`、`constraintHints`、`unknowns`、`createdAt`。
- `createGoalIntentProfile({ goalId, rawGoal, constraints, createdAt? })`：当前确定性 GoalIntentProfile fallback / baseline 解析器；AI 目标画像候选必须通过统一智能通道进入父层收束，不能由 provider response 直接写正式 handoff。
- `selectRootletClusterKindsForGoalIntent(profile)`：根据目标画像选择 `option/risk/asset_fit/evidence/constraint/counterfactual`，简单目标不得全量启动 rootlet。
- `CandidateComparison`：记录 candidate 的 `goalMatch`、`goalMatchBasis`、`evidenceSupport`、`evidenceSupportBasis`、`evidenceGaps`、`constraintImpact`、`constraintImpactBasis`、`hardConstraintConflictRefs`、`riskLevel`、`riskCoverage`、`unknowns`、`whyNot`、`conclusion` 和 `evidenceRefs`。
- `compareCandidatesForGoal(...)`：基于目标画像、候选和 rootlet output 生成比较、收束决策和 evidence entries；不得按 `clusterId` 硬编码 accepted / merged / rejected。
- `UndergroundEvidenceLedger`：地下证据账本，收纳 goal intent、Soil constraint、rootlet output、candidate comparison、convergence decision、user clarification 和 stop reason evidence。
- `createRootletOutputsForInvocation(...)`：单个 rootlet invocation 可以按 rootlet kind 和预算产出多个 `RootletOutput`；输出仍只是候选材料，必须进入 `CandidatePool`。
- `RootletOutput.source`：标记材料来源，当前覆盖 `ai` 与 `deterministic_fallback`；AI 成功输出必须标记为 `ai`，模型失败、空候选或显式禁用/配置失败边界的 fallback 输出必须标记为 `deterministic_fallback`，并通过 source refs 保留 fallback / model / tool 归因。
- `CandidatePool.candidatesByKind`：按 `RootletClusterKind` 分组的候选视图，必须与扁平 `candidates` 和 `counts` 同步。
- `runUndergroundDirectionSession(goal, options?)`：地下-only 入口，返回 `approved_package_created`、`awaiting_user` 或 `stopped`，并生成 JSON-safe observation snapshot。`options` 可包含 `constraints`、显式 `packageStore` 或显式 `outputDirectory`；不传 store / output directory 时只能使用 in-memory package store。
- `recoverUndergroundDirectionSession(awaitingSession, clarificationResponse?)`：地下-only 恢复入口，接收 awaiting-user session 与可选澄清回答；未传回答时创建 deterministic demo/test response，保存同一 direction 的 approved v2 package。
- `createUndergroundDemoSummary(result, recovery?)`：地下-only demo 的纯投影函数，输入 `UndergroundDirectionSessionResult` 和可选恢复结果，输出 JSON-safe summary；不得读取 CLI、写文件或访问 store。
- `pnpm demo:underground -- "<goal>"`：地下-only CLI 命令，只运行 Underground Center 到 Direction Handoff Package 边界，不进入 Aboveground。
- `pnpm demo:underground -- --auto-answer "<goal>"`：仅当地下 session 停在 `awaiting_user` 时自动发布 deterministic 澄清回答并恢复为 approved v2；`approved` / `stopped` 不得伪造恢复。
- `pnpm demo:underground -- --out <dir> "<goal>"`：只在调用方显式提供 `<dir>` 时写出 Direction Handoff Package；不得默认选择 repo-root `.agentarbor/`。
- `pnpm demo:underground -- --ai fake "<goal>"`：显式启用 deterministic fake provider，经 `IntelligenceChannel` 触发 `model.requested -> model.completed`，模型输出只能被 rootlet invocation 包装为 `RootletOutput` 后进入 CandidatePool。
- `pnpm demo:underground -- --ai openai-compatible "<goal>"`：显式启用 OpenAI-compatible Chat Completions provider；配置缺失时必须在 app 组合根失败，不能发起网络调用，不能泄漏 API key / token。
- `requestUndergroundRootletCandidateAdvice(...)`：app 层地下 AI rootlet 调用边界；接收 `GoalIntentProfile`、rootlet cluster、invocation、constraints 和注入的 `AgentTurnRuntime` / turn policy，按 rootlet kind 构造 prompt / output contract，解析顶层 `candidates` 数组，并把合法候选转换为 `RootletOutput`。
- 地下 agent 是 `AgentTurnRuntime` 的消费者，不拥有工具注册、MCP、sandbox、search provider 或工具市场生命周期；工具中心由 app 组合根注入为 `ToolExecutionBroker`。

### 3. Contracts

- Intent Core 的长期主线是 AI 驱动目标成形：模型输出作为目标画像候选，经父层 agent 收束和确定性守卫后形成 `GoalIntentProfile`。当前 `createGoalIntentProfile` 是 fallback / baseline / 禁用边界路径；不得把它重新提升为地下语义判断的唯一主线。
- Rootlet 选择由 `GoalIntentProfile` 驱动；简单目标默认只启动 `option`，风险/资产/证据/约束/反驳明显时才启动对应 cluster。
- 单个 `RootletOutput` 只能进入 `CandidatePool`，不能直接进入 Direction Handoff Package。
- 单个 rootlet invocation 可以产出多个 `RootletOutput`，但数量必须受该 rootlet cluster 的 `budget.maxCandidateOutputs` 限制；公共 EventLog 仍只记录一次 `exploration_candidate.produced` 阶段事件，payload 可携带多个输出。
- 当地下 session 显式注入 `IntelligenceChannel` 时，所有被动态选中的 rootlet kind 都可以各自最多发起一次 AI 候选建议调用；prompt 必须包含 raw goal、`GoalIntentProfile`、ConstraintRef/约束摘要、rootlet kind、cluster budget、exit criteria 和“rootlet 只提供下层候选、不绕过父层收束”的约束。
- rootlet AI 响应必须采用顶层 `candidates` 数组；`option`、`risk`、`asset_fit`、`evidence`、`constraint` 和 `counterfactual` 的数组项字段各自独立。非法项由 app parser 丢弃，合法项按 budget 截断，再包装为 `RootletOutput` 后进入 CandidatePool。
- AI 失败、输出契约 validation failed 或合法候选为空时，rootlet invocation 必须继续 deterministic fallback；fallback output 的 source refs 必须包含可审计的 `ai-fallback:*` 标记和对应 model request / response refs，不能静默吞掉模型失败。
- rootlet 工具调用必须由 agent manifest / turn policy 裁剪；工具结果只能追加为模型 tool message，并在最终 rootlet output 中以 `tool-call:<id>` source/evidence refs 表达，不得跳过 CandidatePool 或 Convergence Judge。
- 固定地下核心 agent 默认禁止私接模型和工具；需要 AI 的核心角色必须经统一 `AgentTurnRuntime`、agent manifest / turn policy 和任务契约显式启用。不得在各 agent 内私接 `IntelligenceChannel` 或 ToolCenter，也不得用确定性 helper 替代已声明的 AI 主线。
- 工程边界不得替 Agent 思考：`GoalIntentProfile` fallback、rootlet kind selection、CandidateComparison、validation、状态机、budget、permission、fallback 和文件契约只能作为 agent 主线的结构化输入、边界守卫或失败机制；不得把它们写成目标理解、候选优劣、工具选择、继续探索/停止或方向综合的唯一主逻辑。
- CandidatePool 必须同时提供扁平候选列表和按 rootlet kind 分组的 `candidatesByKind`；二者都是同一候选事实的视图，不得成为两套事实源。
- Convergence Judge 必须基于 `CandidateComparison.conclusion` 生成 `accepted/merged/rejected/unknown`，并记录 source candidate refs、evidence refs、推荐主方向、合并项、淘汰原因、需要用户确认的冲突和地上参考方向；每个 `CandidateConvergenceDecision` 必须带可追溯的 `evidenceRefs`，并能回到对应 comparison 和 evidence ledger entry。
- Convergence 的长期主线是 AI 驱动父层收束：`ConvergenceJudgeAgent` 在 `candidate_pool.updated` 后通过注入的 `AgentTurnRuntime` 请求收束判断，模型判断必须作为 `convergeDefaultUndergroundCandidatePool` 输入参与 accepted / merged / rejected / unknown、继续探索、询问用户或停止的决策，不能停留在旁路 advisory 文案。
- Convergence AI 推荐的 `recommendedOptionId` 只有同时存在于 CandidatePool 且进入 `handoffCandidateRefs` 时才能保留；不存在、rejected、unknown、risk、counterfactual 或其他非 handoff candidate 的推荐必须被忽略，且不得进入 Direction Handoff `recommendedOptionId`、`retainedOptionId` 或 `sourceCandidateRefs`。
- Convergence AI 可以 enrich 与已有 candidate 绑定的 comparison / report / handoff 说明字段；`overallDirectionSummary` 不得替代 `DirectionHandoff.clarifiedGoal`，正式 clarified goal 必须继续来自经收束的 GoalIntentProfile 或 raw user goal。
- Convergence AI 内容进入 `candidateComparisons`、`convergenceReport`、EventLog、Observation Snapshot、demo summary 或 Direction Handoff 视图前，所有 AI 可见文本必须做 secret/token 脱敏和长度裁剪；不得暴露 raw prompt、raw provider response、API key、token 或 provider 原始敏感错误。
- 自治主线启用时，`candidate_pool.updated` 不再直接触发最终收束；必须先由固定 `underground-autonomy-core` 经 `AgentTurnRuntime` 产生 `UndergroundAutonomyDecision`，发布 `autonomy_review.completed`，再根据 action 决定继续探索、请求收束、请求用户澄清或停止。
- `UndergroundAutonomyDecision` 只能决定路由：`continue_exploration`、`request_convergence`、`request_user_clarification` 或 `stop`。它不能批准 Direction Handoff，不能直接写 Growth Plan / Fruit / Run Memory / Experience Candidate / Capability Asset / Soil，也不能绕过 CandidatePool、Convergence Judge 和 Handoff Steward validation。
- `underground-autonomy-core` 是固定地下核心 agent 的明确 AI 例外：manifest / turn policy 必须 `allowModel=true`，并只允许统一 `search` / `read` 工具；其他固定核心 agent 默认仍禁用模型和工具。自治核心的工具结果只作为 tool message 回填给模型或作为 safe refs 进入自治决策，不得直接进入 handoff 正式材料。
- 自治主线无 `AgentTurnRuntime`、模型失败、输出 contract 不合法、非法 action、非法 rootlet kind、未知 candidate ref、cycle guard 触发或敏感/超长文本无法安全投影时，必须形成 `status=failed` 或 stopped 的 `UndergroundAutonomyDecision`，再由 Convergence Judge 生成可审计 terminal convergence report；不得伪造成功自治或 approved package。
- `continue_exploration` 只能出生本轮运行期临时 rootlet invocation：AI 可给出 objective、information needs、source hints、expected evidence 和 specialist label，但必须映射到既有 `RootletClusterKind`，并重新发布带新 `explorationCycleId` / `cycleIndex` 的 `rootlet_cluster.started`。动态 rootlet output 仍必须先进入 CandidatePool。
- `request_convergence` 只发布 `convergence_review.requested`；`ConvergenceJudgeAgent` 是唯一允许写 `convergenceReport` 的 agent。`request_user_clarification`、`stop` 和 failed autonomy 也必须经 Convergence Judge 生成 terminal report，Handoff Steward 只消费该 report 打包，不得自己创建收敛报告。
- option 候选之间应产生保留 / 合并 / 淘汰裁决；risk、evidence、constraint、asset_fit 和 counterfactual 候选不能直接成为主方向，必须作为证据、约束、风险或 why-not 材料参与交叉裁决。
- `approved_package_created` 只允许在有 accepted / merged handoff candidates 且无 blocking unknown 时出现。
- `awaiting_user` 只允许在存在 blocking unknown 和 `UserClarificationRequest` 时出现；non-blocking unknown 不得单独制造等待用户状态。
- `stopped` 必须带可审计停止理由，例如 `budget_exhausted_without_converged_candidates`；停止状态不得伪造 approved package。
- `runUndergroundDirectionSession` 的 `packageStore` 与 `outputDirectory` 是互斥存储入口；二者同时传入必须报错，避免一个 session 出现两个 package 事实源。
- `outputDirectory` 只代表调用方显式授权的 filesystem package store 根目录；默认地下 session / demo 不得写入 repo-root `.agentarbor/`。
- `recoverUndergroundDirectionSession` 必须复用 awaiting session 的 runtime 和 package store，保存 v1 awaiting_user 与 v2 approved，并让 `listVersions(directionId)` 返回 `[1, 2]`。
- deterministic auto-answer 只属于地下-only demo/test 边界，不代表真实用户交互设计，也不得进入 Soil、RunMemory、Experience Candidate 或 Capability Asset。
- 恢复成功后的 demo summary 以 approved v2 作为当前 `directionPackage`，并暴露 `recoveredPackage`、`lineage`、`versions` 和可选 `writtenPackagePath`；无恢复时 `recoveredPackage` 必须为空。
- Direction Handoff 的 `clarifiedGoal`、`nonGoals`、`assumptions`、`risks`、`options` 和 `missingInformation` 必须由 `GoalIntentProfile + CandidatePool + ConvergenceReport` 派生，不得回退到固定 minimal 文案。
- `domainConcepts` 必须参与 rootlet 选择、候选相关性判断和 handoff 字段派生；目标相关性不能只靠在 summary 前拼接原始目标文本通过，候选自身必须保留至少一个目标关键概念或领域概念。
- Direction Handoff 的 `options` 必须保留所有 option 候选方向的取舍记录，不得只写推荐方向；`decisionRecord` 必须记录 retained / merged / rejected / userDecisionRequired / abovegroundReference；`riskRegister` 必须保留风险候选与淘汰候选的来源归因。
- 地下约束交接链当前只在 `direction_handoff` 阶段执行阻断校验；其他 6 个 gate 作为 `candidateConstraintRefs` 可追踪交接，不实现后续层执行。
- Evidence Ledger 是运行期证据索引，不是 Soil、RunMemory 或长期资产库；它必须由 EventLog / 地下运行结果派生并随 report 暴露。每个 `RootletOutput` 至少引用一条 ledger entry；`UndergroundConvergenceReport.evidenceLedgerRef` 必须指向同一运行的 ledger；user clarification 和 stopped outcome 必须留下对应 evidence entry。
- 地下-only demo summary 是可读投影，不是 EventLog、RunMemory、Soil 或长期资产；它不得成为新的事实源。
- 地下-only demo summary 可以从 `model.*` EventLog 派生 AI 观测摘要，字段仅限启用状态、provider / protocol / model、事件计数、completed / failed 状态、按 rootlet kind 的 model call 状态、AI candidate count、fallback count / `aiFallbackUsed` 和与候选池相关的 model call refs；不得包含 API key、token、完整 prompt、provider 原始错误或模型正文。
- 地下-only demo summary 可以从 `tool.*` EventLog 派生工具调用摘要，字段仅限 requested / completed / failed 计数、tool call id、tool name、caller agent、duration 和 event refs；不得包含 raw tool output、搜索 provider 原始响应、API key 或 token。

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
| 地下-only demo 未传 `--ai` | 不创建 provider、不发布 `model.*` 事件、不触发真实网络 |
| 地下-only demo 传入 `--ai fake` | 被目标画像选中的每种 rootlet kind 各自发布 `model.requested -> model.completed`，非 model 地下公开事件仍保持 7 步并停在 handoff boundary |
| 模型在 rootlet AI 调用中请求允许的工具 | AgentTurnRuntime 发布 `tool.requested -> tool.completed`，随后模型继续输出候选；工具结果只进入 rootlet source/evidence refs |
| 模型请求未授权工具或工具失败 | 发布 `tool.failed`，rootlet 继续模型回合或 fallback，不静默吞错 |
| 固定地下核心 agent 的 turn policy 禁用模型/工具 | 不产生 `model.*` / `tool.*` 事件，不进入 provider 或 ToolCenter |
| 自治主线无 AgentTurnRuntime | 发布 failed autonomy decision，经 Convergence Judge 收束为 `stopped` / `ai_required_for_autonomy`，不伪造模型完成 |
| 自治 decision 为 `continue_exploration` | 产生新的 `explorationCycleId` / `cycleIndex`，再次启动 rootlet、产出候选并更新 CandidatePool |
| 自治 decision 为 `request_convergence` | 先发布 `convergence_review.requested`，再由 Convergence Judge 生成 `convergence_review.completed` |
| 自治 decision 为 `request_user_clarification`、`stop` 或 failed | Convergence Judge 生成 awaiting-user 或 stopped terminal report；Handoff Steward 不写 convergence report |
| 同一 cycle 的同类 public event 重复投递 | phase guard 拦截；不同 cycle 的 `rootlet_cluster.started` / `exploration_candidate.produced` / `candidate_pool.updated` 不得被误判为重复 |
| 自治输出非法 action / rootlet kind / candidate id 或泄漏 secret | 返回 `autonomy_decision_failed` 或脱敏截断后的 stopped reason，并进入可审计 terminal report |
| `--ai openai-compatible` 缺少 API key 或模型名 | 返回明确配置失败，不进入 provider fetch，不泄漏密钥 |

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
- CandidateComparison 必须暴露目标匹配依据、证据支持/不足、约束影响、硬约束冲突、风险覆盖、unknown / why-not 和最终 conclusion 的 evidence refs。
- 单个 rootlet invocation 产出多个候选并受预算限制。
- CandidatePool 按 `RootletClusterKind` 分组，且分组与扁平候选列表一致。
- Convergence Judge 覆盖 AI 驱动收束、option 合并、option 与 hard boundary 冲突淘汰、风险候选作为 non-selectable open risk 的裁决，并证明确定性守卫只阻断越界而不替代语义选择。
- Evidence Ledger 覆盖 goal intent、rootlet output、candidate comparison、convergence decision、user clarification / stop reason，并保证 rootlet output、comparison、decision、report 和 Direction Handoff 之间的 evidence refs 可串联。
- Direction Handoff 字段从 goal profile、候选和收束报告派生，且不回退固定 minimal 文案。
- blocking unknown / stopped / approved 三类地下-only 终态均有测试。
- awaiting_user 通过 `recoverUndergroundDirectionSession` 或 `--auto-answer` 恢复为 approved v2，保持同一 direction id，store versions 为 `[1, 2]`。
- 恢复 EventLog 包含 `user_approval.received`、`direction_handoff.revision_requested`、第二次 `convergence_review.completed` 和最终 `direction_handoff.completed`。
- `createUndergroundDemoSummary` 对 approved / awaiting_user / stopped / recovered approved v2 终态均有测试，且 awaiting_user / recovered 都不包含 `growth_plan.completed`。
- `runUndergroundDirectionSession` 覆盖 injected package store、显式 `outputDirectory` round-trip 和未传 `--out` 不写 repo-root `.agentarbor/`。
- 默认 demo 和地下-only session 都不写 repo-root `.agentarbor/`。
- `pnpm demo:underground` 可运行默认目标和自定义目标；默认 happy path 必须走 fake AI，经 `AgentTurnRuntime` 发布模型事件，并停在地下-only 边界。
- `pnpm demo:underground -- --ai fake "<goal>"` 覆盖模型事件、按 rootlet kind 的 AI summary、候选层接入和 Direction Handoff 边界；复杂目标必须覆盖 6 种 rootlet kind。
- rootlet AI 工具循环覆盖统一 `search` / `read` 成功、no-provider / stub、未授权和 max rounds，且 rootlet output refs 能回到 tool call / research refs。
- 至少一个非 rootlet 地下核心 agent 通过统一 turn policy 证明模型 / 工具不可用时不会私自调用。
- 自治主线覆盖：`aiMode=none` 或缺少 `AgentTurnRuntime` 时 stopped/disabled 且不得 approved；`continue_exploration` 产生第二个 cycle；`request_convergence` 后才触发 Convergence Judge / Handoff；同 cycle 去重不同 cycle 不误删；非法 action、非法 rootlet kind、未知 candidate ref、超长文本和 secret/token 脱敏/拒绝。
- 自治核心工具权限覆盖：`underground-autonomy-core` 只能通过统一 `AgentTurnRuntime` 使用 `search` / `read`，工具事件进入 safe summary，工具输出不得绕过 CandidatePool / Convergence / Handoff。
- `pnpm demo:underground -- --ai openai-compatible "<goal>"` 覆盖缺配置失败、无网络调用和密钥不泄漏。

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

- Trigger：修改 `src/domain/underground/agent-cluster.ts`、`src/domain/underground/agent-loop.ts`、`src/app/underground-agent-cluster-runtime.ts`、`src/app/underground/orchestrator.ts`、地下 session、rootlet output、candidate pool、智能通道地下接入或 Observation underground view。
- Scope：覆盖内存地下 agent 集群调度、Cognitive Runtime 主入口、AI rootlet / autonomy / convergence 主线和确定性边界守卫；不引入 UI、HTTP、SSE、WebSocket、数据库、MCP、A2A、AG-UI、外部 LLM SDK 或 repo-root `.agentarbor/` 运行资产。

### 2. Signatures

- `UndergroundAgentRole` 固定覆盖 `intent_core`、`growth_governor`、`rootlet_agent`、`candidate_pool`、`convergence_judge`、`handoff_steward`。
- `UndergroundAgentClusterPlan` 记录 `goalId`、raw goal、budget、将启动的 agents、rootlet kinds 和 scheduling reasons。
- `UndergroundAgentInvocation` 必须包含 `invocationId`、`agentId`、`role`、`inputRefs`、`outputRefs`、`status`、`startedAt`、可选 `completedAt` / `failureReason`。
- `UndergroundAgentClusterRun` 记录 plan、invocations、terminal status、candidate refs、可选 package ref、started/completed timestamps 和 stop reason。
- `RootletOutput` 必须包含 `invocationId`；`createCandidatePool(...)` 必须接收同一运行的 `agentInvocations` 并验证 rootlet output 来自 completed `rootlet_agent` invocation。

### 3. Contracts

- 地下 session 默认必须经 `UndergroundAgentOrchestrator` 的 `cognitive_manager` 路由进入地下运行；旧 agent cluster runtime 只能作为显式迁移 / 兼容 helper，不能重新成为 session 主入口，也不能回退到 app helper 直接把 rootlet output 塞进 candidate pool。
- 调度器必须先注册地下 agent manifests，再按 `GoalIntentProfile` 和动态 rootlet 选择结果启动 rootlet agent invocations。
- rootlet output 进入正式 candidate pool 前，必须能追溯到 completed `rootlet_agent` invocation，且 `output.producedByAgentId === invocation.agentId`、`invocation.outputRefs` 包含 `output.outputId`。
- `IntelligenceChannel` 只能作为 rootlet agent 的能力来源；所有 rootlet kind 的 AI output 都只有被 rootlet invocation 包装成 `RootletOutput` 后，才能进入 candidate pool。
- Convergence Judge 与 Handoff Steward 是上层 agent 收束与交接职责 owner，可以使用 AI 进行语义裁决和叙事组织；确定性守门只负责 candidate pool、convergence report、Direction Handoff Package validation、hard constraint、权限和谱系边界，模型输出不能绕过这些边界。
- 不新增事件类型时，地下运行必须暴露安全的 `undergroundOrchestratorRun` / manager trace，证明 plan、rootlet、candidate、autonomy、convergence 和 handoff 均经 orchestrator route 推进；旧 `agentCluster` payload 只能作为迁移兼容投影，不再是唯一验收证据。

### 4. Runtime Unitization Contract

- `src/app/underground/cluster/` 是当前消息驱动地下运行单元实现位置；固定核心 agent 必须按职责拆为 `IntentCoreAgent`、`GrowthGovernorAgent`、`CandidatePoolAgent`、`ConvergenceJudgeAgent` 和 `HandoffStewardAgent`。
- `UndergroundAgentRunner` 只负责固定 agent 生命周期、MessageBus 订阅队列、processed message / phase guard、max step guard、handler failure boundary、动态 `RootletAgent(kind)` 创建、内部 rootlet invocation request 和终态等待。
- Runner 不得承载 Intent Core、Growth Governor、Rootlet、Candidate Pool、Convergence Judge 或 Handoff Steward 的业务阶段逻辑；业务阶段逻辑必须落在对应 runtime unit。
- `MessageDrivenUndergroundDispatcher` 当前只允许作为兼容 wrapper 委托 `UndergroundAgentRunner`；不得重新积累地下业务阶段 handler。
- `UndergroundSharedContext` 是单次 run 内固定核心 agent 的协作介质，不能替代 EventLog、DirectionHandoffPackageStore 或 Observation Snapshot；关键字段必须按 owner 写入规则守卫。
- SharedContext owner 规则：Intent Core 写 goal/profile/plan/cluster plan/初始 center invocation；Growth Governor 写 started plan、running rootlet invocations、expected rootlet kinds 和 growth invocation；Rootlet Agent 写自己的 rootlet outputs 和 completed rootlet invocations；Candidate Pool Agent 写 candidate pool；Convergence Judge 写 convergence report、evidence ledger、pending agent cluster run 和 underground report；Handoff Steward 写 direction handoff、package、terminal status 和 finalized agent cluster run。
- `GrowthGovernorAgent` 发布 `rootlet_cluster.started` 后，Runner 根据 `startedPlan.rootletClusters` 动态创建对应 `RootletAgent(kind)`，并通过 run-internal `rootlet.invocation_requested` 触发该 rootlet；RootletAgent 不得依赖监听已经错过的 `rootlet_cluster.started`。
- `rootlet.invocation_requested` 是 run-internal trigger，不进入 `ARBOR_MESSAGE_TYPES` 或 EventLog；对应 `RootletOutput.sourceRefs` 必须记录内部 request id 和 `rootlet.invocation_requested`，用于证明 rootlet 由明确消息触发。
- `HandoffStewardAgent` 必须拥有自己的 `handoff_steward` invocation 生命周期；其他 agent 不得预创建或完成 Handoff Steward 的 invocation。

### 5. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| RootletOutput 缺少 invocationId | `UndergroundConvergenceError`，不得进入 candidate pool |
| invocation 不存在、不是 `rootlet_agent`、未 completed、producer 不匹配或 outputRefs 不包含 outputId | `UndergroundConvergenceError` |
| AI output 不符合输出契约 | 智能通道发布 failed，rootlet invocation 不产生 AI rootlet output，并以可观测 `ai-fallback:*` refs 回退 deterministic output |
| 动态 rootlet 选择为 N 个 rootlet kind | Observation 中必须存在 N 个 completed `rootlet_agent` invocations |
| awaiting_user / stopped | 仍必须生成 agent cluster run 观测结果，且 Aboveground 保持 `not_started` |
| EventLog / Snapshot 出现 API key、token 或 provider secret | 测试失败 |

### 6. Good / Base / Bad Cases

- Good：简单目标只启动 `option` rootlet，并在 Observation 中显示 intent、growth、option rootlet、convergence 和 handoff invocations。
- Good：智能通道候选建议被包装为 option rootlet invocation 的 output，再进入 candidate pool 和 convergence。
- Base：完整 demo 继续保持固定地下事件顺序，只在 payload 和 Observation view 中增加 agent cluster 信息。
- Bad：`runUndergroundDirectionSessionWithIntelligence` 先拿模型输出再把它作为 loose `extraRootletOutputs` 直接并入候选池。
- Bad：为了展示 agent cluster 新增长期 Capability Asset、repo-root `.agentarbor/` 占位资产或外部 provider SDK。

### 7. Tests Required

- 地下-only fake AI happy path 通过 `cognitive_manager` 产出 approved package，且结果暴露 `undergroundOrchestratorRun.route === "cognitive_manager"`、agent loop ids、manager decisions 和 guarded statuses。
- Rootlet output 没有关联 completed rootlet invocation 时不能进入 candidate pool。
- AI output 必须通过 rootlet invocation 才能进入 candidate pool，且 6 种 rootlet kind 的 fake AI 成功、失败 / validation failed、`aiMode=none` 禁用边界和缺少 `AgentTurnRuntime` stopped 边界都要有测试；禁用边界不得作为 approved happy path。
- 动态 rootlet selection 形成对应数量的 rootlet agent invocations。
- awaiting_user / stopped 仍暴露 orchestrator run trace，且不进入 Aboveground。
- Observation Snapshot 展示 cluster plan、invocations、candidate refs 和 package refs。
- EventLog / Snapshot 不包含 API key / token。

### 8. Wrong vs Correct

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

## Scenario: ADR-0021 Cognitive Runtime / AgentLoop / Workspace / Mailbox / Orchestrator 迁移

### 1. Scope / Trigger

- Trigger：修改 `src/domain/underground/agent-loop.ts`、`workspace.ts`、`mailbox.ts`、`guard.ts`、`src/app/underground/orchestrator.ts`、`src/app/underground-direction-session.ts` 或地下主入口迁移测试。
- Scope：覆盖 ADR-0021 当前 Cognitive Runtime 骨架：`AgentLoop`、`AgentRunContext`、`WorkspaceView`、`Mailbox`、Guard 和 `UndergroundAgentOrchestrator` 的 `cognitive_manager` 主路由；旧 runner 只能作为迁移期兼容实现细节，不得重新成为主入口。

### 2. Signatures

- `AgentLoop`：显式 `observe -> reason -> act -> guard -> reflect -> decide_next` 阶段；`reason` 是统一接入 `AgentTurnRuntime` 的语义阶段，`reflect` / `decide_next` 记录守卫结果后的反思和继续/停止/等待输入判断。
- `AgentRunContext`：强类型上下文，包含 `WorkspaceView`、`Mailbox`、可选 `AgentTurnRuntime`、工具 surface、memory view、trace writer、budget view 和 constraint view；agent 只能通过上下文契约读取能力。
- `WorkspaceView`：agent 侧只读工作空间快照；`WritableWorkspace` 只能由 orchestrator / 受协议约束的迁移层持有。
- `Mailbox`：agent 间消息路由边界；消息必须按 `toAgentId` 入队，读取侧只能看到自己的队列。
- `UndergroundAgentOrchestrator`：地下主入口 owner；当前 route 必须是 `cognitive_manager`，按 Intent Core、Growth Governor、Rootlet Explorer、Candidate Collector、Autonomy Reviewer、Convergence Judge 和 Handoff Steward 推进受控循环。
- `undergroundOrchestratorRun`：地下 session 的安全运行 trace，只暴露 orchestrator run id、route、agent loop ids、manager decisions、guarded statuses 和 output refs，不暴露 raw prompt、provider raw response、tool raw output 或 secret。

### 3. Contracts

- `runUndergroundDirectionSession` 和 `runUndergroundDirectionSessionWithIntelligence` 必须经 `UndergroundAgentOrchestrator` 进入地下运行；不得在 session 层继续直接 publish goal 后调用 `UndergroundAgentRunner`。
- Orchestrator trace、看板和文档必须把当前主路由标记为 `cognitive_manager`；不得残留 `agent_loop_compatibility_adapter` 作为当前主路由，也不得使用 DEBUG console 输出 route 状态。
- fake AI 是最小 happy path；`aiMode=none`、缺少 `AgentTurnRuntime`、配置失败、模型失败或 contract validation failed 均不得伪造模型成功或 approved package。
- `AgentRunContext.workspace` 面向 agent 暴露 `WorkspaceView`，不能让 agent 直接写共享状态；可写 workspace 只能留在 orchestrator 内部。
- `Mailbox` 与 `WorkspaceView` 返回值必须是防御性快照；调用方不能通过嵌套对象 mutation 改写队列或工作空间内部状态。
- 确定性 guard 只能表达 accepted / fallback / rejected、违规和 fallback 来源；不得在 guard 中编码目标理解、候选排序、工具选择、是否继续探索或方向综合。
- rootlet / subagent / tool / model 输出只能作为未收束材料进入 CandidatePool、Convergence Judge 和 Handoff Steward validation；不得绕过父层收束进入 Direction Handoff Package。

### 4. Tests Required

- `AgentLoop` round 测试必须断言 observe、reason、act、guard、reflect、decide_next 的执行顺序和 guarded output。
- `WorkspaceView` 测试必须证明 snapshot / projection snapshot 都是只读防御性副本，且只读 view 不暴露 `patch` / `replace`。
- `Mailbox` 测试必须覆盖按 agent 路由、按 type drain 和 payload 防御性快照。
- `Guard` 测试必须覆盖 hard violation reject 和 explicit fallback source refs。
- `UndergroundAgentOrchestrator` 测试必须覆盖缺少 `AgentTurnRuntime` 不批准、代表性地下方向流经 `cognitive_manager`、session 结果暴露安全运行 trace、复用 orchestrator 时每次 run 有独立 run id。

## Scenario: 地下消息驱动调度内核

### 1. Scope / Trigger

- Trigger：修改 `src/app/underground-message-dispatcher.ts`、`src/app/underground-direction-session.ts`、地下阶段事件发布 helper、地下消息驱动测试或 handler 级 `from.id` 约定。
- Scope：只覆盖内存版 MessageBus 驱动地下单环；不引入持久 broker、后台重试、并发执行器、UI、HTTP、数据库、MCP、A2A、AG-UI、真实 LLM CLI demo、外部 SDK 或 repo-root `.agentarbor/` 运行资产。

### 2. Signatures

- `UndergroundAgentRunner({ runtime, intelligenceChannel?, maxDispatchSteps? })`：管理固定地下 agent 生命周期、MessageBus 队列、动态 rootlet agent 创建和终态等待。
- `MessageDrivenUndergroundDispatcher({ runtime, intelligenceChannel?, maxDispatchSteps? })`：兼容 wrapper，必须委托 `UndergroundAgentRunner`，不得继续保存地下业务阶段大 handler。
- `dispatchUntilIdle()`：同步推进确定性地下 handler；若遇到需要异步智能通道的 handler，必须失败并要求调用异步入口。
- `dispatchUntilIdleAsync()`：推进可能调用 `IntelligenceChannel` 的 rootlet handler。
- `UndergroundMessageDrivenDispatchResult`：返回终态、地下报告、方向交接包、loaded package ref、processed message ids 和 dispatch step count。

### 3. Contracts

- `runUndergroundDirectionSession` 默认只能创建并发布 `goal.received`，地下阶段推进必须由 `UndergroundAgentRunner` 的 MessageBus 队列触发；session 不得重新串行调用 prepare / rootlet / candidate pool / convergence / handoff helper。
- handler 之间的跨阶段推进必须通过正式 `ArborMessage`：`goal.received -> underground.exploration_planned -> rootlet_cluster.started -> exploration_candidate.produced -> candidate_pool.updated -> convergence_review.completed -> direction_handoff.completed | user_approval.requested`。
- 每个 handler 输出事件必须带对应 agent `from.id`：Intent Core、Growth Governor、Rootlet Agent、Candidate Pool、Convergence Judge、Handoff Steward；EventLog 必须能直接读出推进者。
- Runner 可以维护 run-scoped typed shared context，但写入和读取必须由消息触发；SharedContext 不能替代 EventLog、DirectionHandoffPackageStore 或 Observation Snapshot 的事实源。
- Runner 必须记录 processed message id、phase guard 和 max dispatch steps；重复消息不能重复产出地下结果。
- 直接发布后续阶段事件、但没有同 run 的 `goal.received` context 时，Runner / wrapper 必须失败，不得跳阶段产出 convergence、handoff package 或用户澄清请求。
- 智能通道只允许在 rootlet handler 内把模型输出包装为 `RootletOutput`；模型输出仍必须经过 candidate pool、convergence 和 handoff validation。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| `goal.received` 经 MessageBus 发布 | Runner 逐步发布地下阶段事件并返回终态结果 |
| 未发布任何消息即调用 dispatch | 返回 `undefined`，EventLog 不新增地下结果 |
| 重复发布同一 message id 或同 trace 同阶段消息 | 只处理首个阶段推进，地下结果只产出一次 |
| dispatch step 超过 `maxDispatchSteps` | Runner 抛地下调度错误；wrapper 映射为 `UndergroundMessageDispatcherError`，不得继续推进后续阶段 |
| 直接发布 `candidate_pool.updated` 等后续阶段且缺少 context | Runner / wrapper 抛地下调度错误，不得产出 `convergence_review.completed` 或 handoff 事件 |
| session 重新直接调用旧 cluster 串行 runtime | 设计违规，测试应通过消息驱动断言暴露回归 |
| rootlet handler 绕过智能通道或 candidate pool 直接写 approved handoff | 智能通道和 handoff validation 测试失败 |

### 5. Good / Base / Bad Cases

- Good：地下-only session 发布一个 `goal.received` 后，由 Runner 队列逐步推进，并在 EventLog 中看到每个 runtime unit 的 `from.id`。
- Good：重复 goal message 不会生成第二个 `underground.exploration_planned` 或第二个 handoff package。
- Base：旧的 agent cluster runtime helper 可以继续作为 handler 内部纯计算/兼容入口存在，但 session 默认路径不再直接调用它。
- Bad：session 在发布 `goal.received` 后继续手动调用 rootlet、candidate pool、convergence 和 handoff helper。
- Bad：测试直接构造 SharedContext 或 package 结果来证明成功，而不是通过 MessageBus 发布消息驱动 Runner / wrapper。

### 6. Tests Required

- handler `from.id` 覆盖正常地下阶段事件。
- 重复 message id / 同 trace 同阶段消息不会重复推进。
- `maxDispatchSteps` 能阻断递归或失控 dispatch。
- 没有 `goal.received` context 的后续阶段消息不能跳阶段产出地下结果。
- 动态 RootletAgent 创建后由明确内部 request 触发，rootlet output source refs 能证明该触发。
- SharedContext 关键字段 owner 规则有守卫测试，Handoff Steward 的 invocation 由 Handoff Steward 自己完成并引用 package。
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

跨 agent / 跨阶段推进只能由 Runner / wrapper 消费 MessageBus 事件完成；纯函数 helper 只能保留为 runtime unit 内部实现细节。

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

启用自治主线且 AI 决定收束时，地下-only approved demo 的正常 EventLog 固定停在：

```text
goal.received
-> underground.exploration_planned
-> rootlet_cluster.started
-> exploration_candidate.produced
-> candidate_pool.updated
-> autonomy_review.completed
-> convergence_review.requested
-> convergence_review.completed
-> direction_handoff.completed
```

若自治 decision 为 `continue_exploration`，同一 trace 下可以出现新的 `explorationCycleId`，并重复：

```text
rootlet_cluster.started
-> exploration_candidate.produced
-> candidate_pool.updated
-> autonomy_review.completed
```

这些重复只在不同 cycle 下合法；同一 cycle / 同一 payload id 的重复 public event 仍必须被 phase guard 拦截。

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
