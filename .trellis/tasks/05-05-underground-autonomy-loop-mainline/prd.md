# P1: 地下自治元循环主线

## Goal

把地下运行从“一轮 rootlet -> candidate pool -> convergence -> handoff”的固定流水线升级为 AI-required autonomy loop。地下中枢必须能在每轮候选池之后判断继续探索、派生临时 rootlet、请求收敛、询问用户或停止；正式方向交接仍只能通过 CandidatePool、Convergence Judge 和 Handoff validation。

## Requirements

- 新增固定地下中枢 agent：`underground-autonomy-core` / `UndergroundAutonomyAgent`，位于 `candidate_pool.updated` 与 Convergence Judge 之间。
- 新增 `UndergroundAutonomyDecision`，至少包含：
  - `decisionId`
  - `cycleId`
  - `action: "continue_exploration" | "request_convergence" | "request_user_clarification" | "stop"`
  - `completionAssessment`
  - `informationGaps`
  - `spawnRequests`
  - `rationale`
  - `sourceRefs`
  - `modelCallRefs`
  - `status: "completed" | "failed"`
- 新自治主线必须 AI-required：存在 `AgentTurnRuntime` 时由地下自治 agent 经统一 runtime 请求模型决策；无 AI、模型失败或输出不合法时，自治主线收束为 stopped/disabled，并留下可审计 stop reason，例如 `ai_required_for_autonomy` 或 `autonomy_decision_failed`。
- 当前 no-AI deterministic 地下路径只保留为兼容/测试基线，不再代表全智能自治体验；不得伪造 autonomy decision 成功。
- 调整消息流：
  - `candidate_pool.updated -> autonomy_review.completed`
  - `autonomy_review.completed(action=request_convergence) -> convergence_review.requested -> convergence_review.completed`
  - `autonomy_review.completed(action=continue_exploration) -> rootlet_cluster.started` 下一轮探索
  - `autonomy_review.completed(action=request_user_clarification|stop)` 必须形成可审计终态材料，不得绕过 Handoff Steward 事实边界。
- 支持多轮探索 cycle：
  - 引入 `explorationCycleId` 和 `cycleIndex`。
  - 同一 trace 下不同 cycle 的 `rootlet_cluster.started`、`exploration_candidate.produced`、`candidate_pool.updated` 必须可重复处理。
  - 同一 cycle 的重复 public event 仍必须去重。
- 动态 agent 集群第一版只出生运行期临时 rootlet invocation：
  - AI 可生成 rootlet objective、information needs、source hints、expected evidence、specialist label。
  - 底层仍映射到现有 rootlet kind，不出生长期 Capability Asset，不写 `.agentarbor` 运行资产。
  - 动态 rootlet 输出仍必须进入 CandidatePool，再由 Convergence / Handoff validation 提升。
- `ConvergenceJudgeAgent` 不再直接订阅 `candidate_pool.updated` 完成最终收束；它只能响应自治 agent 的收敛请求。
- 安全护栏只作为故障容错：
  - 保留 dispatch runaway guard、单次 agent turn 的网络/API失败处理和工程级 timeout。
  - 不能把 `maxModelRounds` / `maxToolRounds` 当任务完成条件；达到 guard 必须形成可审计失败或停止原因。
- EventLog、Observation、demo summary、panel tracking 必须展示 autonomy cycles、decision action、spawned rootlet count、stop reason 和相关 model/tool refs 的安全摘要。
- 不得泄漏 raw prompt、raw provider response、raw tool output、完整页面正文、API key 或 token。
- 不改 ToolCenter / ResearchRuntime 核心，不引入新依赖、新包管理器、新测试框架或外部 LLM SDK。

## Acceptance Criteria

- [ ] `runUndergroundDirectionSessionWithIntelligence` 经 AI autonomy decision 为 `request_convergence` 时，先产生 `autonomy_review.completed` / `convergence_review.requested`，再产生 `convergence_review.completed` 和 handoff 终态。
- [ ] AI autonomy decision 为 `continue_exploration` 时，产生第二个 `explorationCycleId`，再次启动 rootlet、产生 rootlet output、更新 candidate pool。
- [ ] 无 AI 的自治主线明确 stopped/disabled，不产生成功 autonomy decision，也不伪造 AI 完成。
- [ ] 同一 cycle 重复 public event 被去重；不同 cycle 的同类 event 不被误删。
- [ ] 动态 rootlet output 不能直接进入 DirectionHandoff，必须通过 CandidatePool、Convergence 和 Handoff validation。
- [ ] 非法 action、非法 rootlet kind、非法 candidate id、超长文本或敏感内容被拒绝/脱敏，并留下可审计 stop/failure。
- [ ] 固定核心 agent 仍默认禁用模型/工具；新增 `underground-autonomy-core` 是明确授权的例外。
- [ ] summary / Observation / panel tracking 展示 autonomy cycles 和安全 refs，不泄漏密钥、完整 prompt、raw provider response 或 raw tool output。
- [ ] 当前 convergence advisory 回归仍通过：advisory 不绕过 CandidatePool / Convergence / Handoff validation。

## Definition of Done

- 代码、测试、spec 和任务看板同步完成。
- `pnpm build`、`pnpm test`、`pnpm panel:smoke`、`git diff --check` 通过。
- 任务变更不创建或修改未经授权的 `.agentarbor/` 真实运行资产。
- 若本任务范围过大，优先保证自治消息流、AI-required decision、cycle guard 和安全投影落地；真实 docs/packages/github/RunMemory 深接不纳入本任务。

## Out of Scope

- 不实现完整 MCP、工具市场 UI、远程 sandbox、数据库持久化或正式前端框架。
- 不让动态 rootlet 变成长期 Capability Asset。
- 不改造地上组织或 Nutrient Request 主线。
- 不让 AI decision 直接写 Direction Handoff、Growth Plan、Fruit、Run Memory、Experience Candidate、Capability Asset 或 Soil。
