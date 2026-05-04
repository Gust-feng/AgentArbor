# Convergence AI advisory mainline integration

## Goal

把刚出生的 Convergence AI Advisory 从旁路 helper 接入真实地下 session 主线，让 `UndergroundAgentRunner` 中的 `ConvergenceJudgeAgent` 在存在 `AgentTurnRuntime` 时获取 advisory，并在不绕过 CandidatePool / Convergence / Handoff validation 的前提下丰富收束报告和方向交接信息。

## Requirements

- 修改 `src/app/underground/cluster/convergence-judge-agent.ts`，当 `ctx.agentTurnRuntime` 存在时调用 `requestConvergenceAiAdvisory()`，并把成功 advisory 传给 `convergeDefaultUndergroundCandidatePool()`。
- 无 `agentTurnRuntime`、advisory 请求失败、advisory 无法通过现有候选边界时，保持 deterministic fallback。
- AI advisory 只能 enrich comparison / report / handoff 已有字段，不能绕过 CandidatePool、Convergence 或 Direction Handoff validation。
- AI advisory 不得推荐不存在 candidate 或未进入 handoff candidates 的 candidate 成为 handoff option。
- advisory 失败不能无痕：至少通过现有 fallback refs、report status 或 model events 中的一种模式留下可审计状态。
- EventLog、Snapshot、summary 中不得写入 raw prompt、raw provider response、API key 或 token。
- 评估旧 `runUndergroundAgentClusterExplorationWithIntelligence()` helper 的重复 advisory 调用；如继续保留兼容 helper，需要抽出共享 helper，避免主线和旧 helper 各自重复拼装 candidatePool / turnPolicy。
- 不引入新依赖，不修改 ToolCenter、ResearchRuntime 或 IntelligenceChannel 核心。
- 不创建或修改未经授权的 `.agentarbor/` 真实运行资产。

## Acceptance Criteria

- [x] `runUndergroundDirectionSessionWithIntelligence` / `UndergroundAgentRunner` 路径能产生 completed `convergenceReport.aiAdvisory`。
- [x] advisory 推荐不存在 candidateId 时，handoff 不会选择非法 option。
- [x] advisory 推荐非 handoff candidate 时，handoff 不会选择非法 option。
- [x] advisory 失败时流程继续，且不会呈现为静默 approved 的虚假 AI 成功。
- [x] 默认 no-AI path 不产生 advisory 或 model events。
- [x] focused tests 通过。
- [x] `pnpm build` 通过。

## Definition of Done

- 代码改动只落在地下 convergence advisory 接入、去重和相关测试范围内。
- 现有确定性地下主线行为保持兼容。
- AI 输出仍通过既有 candidate pool、convergence 和 handoff validation 约束。
- 失败路径有审计信号，但不泄漏 raw prompt、raw provider response、API key 或 token。

## Technical Approach

优先把 advisory 获取逻辑放在 `ConvergenceJudgeAgent` 的主线收束边界内，复用 `requestConvergenceAiAdvisory()` 和 `convergeDefaultUndergroundCandidatePool()` 的既有参数形态。旧 intelligence helper 若继续保留，应改为调用共享收束 helper 或主线能力，避免重复生成 candidatePool / turnPolicy。

## Out of Scope

- 不改 ToolCenter、ResearchRuntime、IntelligenceChannel 核心抽象。
- 不引入新 provider、包管理器、测试框架或运行时依赖。
- 不提交、不归档任务。
- 不触碰未授权 `.agentarbor/` 真实运行资产。

## Technical Notes

- 用户指出最近提交 `59c5eaf` 已新增 `src/app/underground/convergence-intelligence.ts` 和 AI convergence advisory。
- 当前真实地下 session 入口走 `src/app/underground-direction-session.ts` 的 `UndergroundAgentRunner`。
- 当前 `src/app/underground/cluster/convergence-judge-agent.ts` 仍直接 deterministic converge。
- 旧 `runUndergroundAgentClusterExplorationWithIntelligence()` helper 上的 advisory 是旁路。
