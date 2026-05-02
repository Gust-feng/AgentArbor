# 地下消息驱动调度内核

## Goal

上一轮已经把地下组织从 loose helper 串联推进到 agent cluster runtime，但执行路径仍主要由 `runUndergroundAgentClusterExploration` 内部按函数顺序调用：prepare、produce rootlets、candidate pool、convergence、handoff。这个形态能证明 agent cluster 被建模，但还不能证明 AgentArbor 的地下组织由消息调度驱动。

本任务把地下组织推进到最小消息驱动运行：用户目标进入 MessageBus 后，地下中枢 dispatcher 根据消息触发对应 agent handler；每个 agent handler 消费输入消息、发布输出消息，并由 dispatcher 推进下一步。函数仍可以作为 agent handler 内部的纯计算 helper，但跨 agent / 跨阶段推进必须以消息为边界。

## Requirements

- 新增消息驱动运行内核：
  - `MessageDrivenUndergroundDispatcher` 或同等 focused runtime。
  - 基于 `InMemoryMessageBus.subscribe` 注册地下 agent handlers。
  - dispatcher 只响应正式 `ArborMessage`，不能直接调用下一阶段 helper 伪造推进。
  - 每个 handler 必须发布自己的 output event，由后续 handler 监听该 event 再推进。
  - 防止无限递归或重复处理：需要处理过的 message id / phase guard / max dispatch steps。

- 地下 agent handlers 最小覆盖：
  - `IntentCoreHandler`：监听 `goal.received`，生成 intent profile、cluster plan，并发布 `underground.exploration_planned`。
  - `GrowthGovernorHandler`：监听 `underground.exploration_planned`，启动 rootlet clusters 和 rootlet invocations，并发布 `rootlet_cluster.started`。
  - `RootletHandler`：监听 `rootlet_cluster.started`，产出 rootlet outputs，并发布 `exploration_candidate.produced`。
  - `CandidatePoolHandler`：监听 `exploration_candidate.produced`，构建 candidate pool，并发布 `candidate_pool.updated`。
  - `ConvergenceJudgeHandler`：监听 `candidate_pool.updated`，生成 convergence review 和地下报告，并发布 `convergence_review.completed`。
  - `HandoffStewardHandler` 可以继续在 session 层完成 package save 和 `direction_handoff.completed` / `user_approval.requested`，但必须消费 `convergence_review.completed` 的结果；不得从 session 直接跳过前面事件。

- session 接入：
  - `runUndergroundDirectionSession` 默认走消息驱动 dispatcher。
  - `runUndergroundDirectionSessionWithIntelligence` 支持 dispatcher 中的 rootlet handler 使用注入的 `IntelligenceChannel`。
  - 保留三类终态：`approved_package_created`、`awaiting_user`、`stopped`。
  - 保持地下-only demo 不进入 Aboveground、不写 repo-root `.agentarbor/`。

- 数据边界：
  - Message payload 必须包含后续 handler 所需的结构化 refs / minimal data；不能让 dispatcher 依赖隐藏全局临时变量完成核心推进。
  - 运行态可以有 scoped context store，用于保存同一 trace 的 typed intermediate result，但写入和读取必须由消息触发。
  - EventLog 仍是事实源；context store 不能成为平行事实源，最终 Observation Snapshot 仍从 EventLog + runtime result 派生。

- Observation：
  - EventLog 顺序仍展示地下阶段推进。
  - Snapshot 能看见消息驱动的 agent invocations 和当前阶段。
  - 后续前端可以根据 events/snapshot 判断是哪个 handler 在推进，而不是猜测函数调用栈。

## Acceptance Criteria

- [ ] `pnpm build` passes.
- [ ] `pnpm test` passes.
- [ ] `runUndergroundDirectionSession` 的地下阶段由 dispatcher 处理 `goal.received` 后逐步发布事件完成。
- [ ] 测试证明跳过 `MessageBus.publish` 不能产生正式地下结果。
- [ ] 测试证明每个地下阶段事件由对应 handler 发布，且 `from.id` 是对应 agent。
- [ ] 测试证明 dispatcher 有重复消息或最大步数守卫。
- [ ] AI 输出仍只能在 rootlet handler 内通过 `IntelligenceChannel` 进入 rootlet output / candidate pool。
- [ ] awaiting_user / stopped 路径仍能通过消息链路停在地下边界。
- [ ] Observation Snapshot 仍 JSON-safe，能展示 agent cluster plan / invocations。
- [ ] 默认 demo 不接真实 LLM、不写 repo-root `.agentarbor/`。

## Technical Approach

- 新增 `src/app/underground-message-dispatcher.ts`，承载 dispatcher、handler 注册和 trace-scoped runtime context。
- 保留 `src/app/underground-agent-cluster-runtime.ts` 中的纯计算 helper 或逐步下沉；但跨阶段推进不再由一个函数顺序调用完成。
- 必要时把上一轮 runtime 中的 prepare / produce / converge 拆成可复用 helper，不扩大领域层职责。
- 只新增必要事件 payload，不随意改动 `ArborMessageType`；如确需新事件，必须同步 observation metadata 和测试。

## Out of Scope

- 不实现异步队列、持久 broker、重试后台任务或并发执行器。
- 不接真实 provider CLI demo。
- 不实现 Aboveground message-driven runtime。
- 不实现 UI / HTTP / SSE / WebSocket / 数据库。
- 不创建 repo-root `.agentarbor` 运行资产。

## Notes

- 本轮目标不是把所有函数消灭，而是把 agent 间协作边界从“函数调用”变成“消息事件”。
- 函数应该退回 agent handler 的内部实现细节；MessageBus 才是跨 agent 推进的主通道。
