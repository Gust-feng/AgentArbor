# 地下 Agent 运行单元化

## Goal

当前地下运行已经从函数串行推进为 MessageBus 驱动，但 `MessageDrivenUndergroundDispatcher` 仍然承担了过多职责：订阅、队列、trace context、阶段守卫、Intent Core、Growth Governor、Rootlet、Candidate Pool、Convergence Judge 和 Handoff Steward 的业务逻辑都集中在一个类里。

本任务把地下组织继续推进为真正的运行期 Agent 集群：固定核心 agent 通过共享上下文协作，临时根须 agent 由 Runner 按 rootlet plan 动态创建。Runner 只负责生命周期、消息泵、动态创建、等待终态和失败边界；业务阶段逻辑必须落在独立 agent runtime unit 中。

## Requirements

- 新增地下 cluster 目录：

```text
src/app/underground/cluster/
  shared-context.ts
  agent-context.ts
  intent-core-agent.ts
  growth-governor-agent.ts
  rootlet-agent.ts
  candidate-pool-agent.ts
  convergence-judge-agent.ts
  handoff-steward-agent.ts
  agent-runner.ts
  index.ts
```

- 新增 Agent 运行单元接口：
  - `UndergroundAgent`：`agentId`、`start(ctx)`、`stop()`。
  - 每个 agent 的 `start()` 只注册 MessageBus subscription；`stop()` 必须取消订阅。
  - 每个 agent 只监听自己负责的事件，不在内部做大范围 switch-case。

- 新增共享上下文：
  - `UndergroundSharedContext` 是 run-scoped 可变上下文，核心 agent 可以读写。
  - SharedContext 不能替代 EventLog、DirectionHandoffPackageStore 或 Observation Snapshot。
  - 消息必须携带最小 refs / 校验字段：至少包含 `goalId`、`planId`、`clusterId`、`outputId`、`candidatePoolId`、`reviewId` 中当前阶段需要的字段。
  - 为关键字段建立写入 owner 约定：
    - Intent Core 写 `goalIntentProfile`、`explorationPlan`、`agentClusterPlan`、初始 center invocation。
    - Growth Governor 写 `startedPlan`、`runningRootletInvocations`、`expectedRootletKinds`、growth invocation。
    - Rootlet Agent 写自己的 rootlet output，并完成对应 rootlet invocation。
    - Candidate Pool Agent 写 `candidatePool`。
    - Convergence Judge 写 `convergenceReport`、`undergroundReport`、`agentClusterRun`。
    - Handoff Steward 写 `directionHandoff`、package、terminal status 和 finalized `agentClusterRun`。

- 固定核心 agent：
  - `IntentCoreAgent`：监听 `goal.received`，生成 intent profile、exploration plan、agent cluster plan，发布 `underground.exploration_planned`。
  - `GrowthGovernorAgent`：监听 `underground.exploration_planned`，启动 rootlet clusters，创建 rootlet invocations，发布 `rootlet_cluster.started`。
  - `CandidatePoolAgent`：监听 rootlet output 到齐后的候选通知，构建 candidate pool，发布 `candidate_pool.updated`。
  - `ConvergenceJudgeAgent`：监听 `candidate_pool.updated`，收束候选，发布 `convergence_review.completed`。
  - `HandoffStewardAgent`：监听 `convergence_review.completed`，保存 Direction Handoff Package，并发布 `direction_handoff.completed` 或 `user_approval.requested`。

- 动态根须 agent：
  - `GrowthGovernorAgent` 发布 `rootlet_cluster.started` 后，`UndergroundAgentRunner` 根据 `startedPlan.rootletClusters` 动态创建 `RootletAgent(kind)`。
  - 动态 rootlet 创建后必须有明确触发消息，不能依赖新 agent 监听已经错过的 `rootlet_cluster.started`。
  - 推荐新增或内部使用明确请求消息：`rootlet.invocation_requested` 如需新增事件，必须同步 `ARBOR_MESSAGE_TYPES`、observation metadata 和测试；若不新增事件，则 Runner 必须补发一个现有可处理消息且带目标 `clusterId`。
  - `RootletAgent(kind)` 只产出自己 kind 对应的 rootlet output。
  - 若注入 `IntelligenceChannel`，仅 `option` rootlet 可请求模型建议，输出仍必须作为 rootlet output 进入候选池。

- Runner：
  - `UndergroundAgentRunner` 管理固定核心 agent 生命周期、动态 rootlet 创建、终态等待、dispatch guard。
  - Runner 不得包含 Intent / Growth / Rootlet / Candidate / Convergence / Handoff 的业务阶段实现。
  - Runner 可以保留 max step guard、processed message id / phase guard、handler failure boundary。
  - `runUndergroundDirectionSession` 默认使用 `UndergroundAgentRunner`。
  - `MessageDrivenUndergroundDispatcher` 可以保留为兼容 wrapper，但不得继续作为地下默认业务实现。

- 兼容和边界：
  - 不删除现有 helper；可把 helper 降级为 agent 内部纯计算函数。
  - 保持现有 underground demo 输出和 7 步地下 EventLog。
  - 不接真实 LLM CLI demo。
  - 不实现 UI / HTTP / SSE / WebSocket / 数据库 / MCP / A2A / AG-UI。
  - 不创建 repo-root `.agentarbor` 运行资产。
  - 不引入外部 SDK。

## Acceptance Criteria

- [ ] `pnpm build` passes。
- [ ] `pnpm test` passes。
- [ ] `pnpm demo:underground -- "构建任务管理平台，包含测试和监控，不接数据库"` passes。
- [ ] `runUndergroundDirectionSession` 默认经 `UndergroundAgentRunner` 运行。
- [ ] `MessageDrivenUndergroundDispatcher` 不再包含地下业务阶段大方法，或仅作为兼容 wrapper。
- [ ] 每个固定核心 agent 都有独立模块和针对性测试。
- [ ] RootletAgent 是动态创建的，测试能证明不同 goal 会创建不同 rootlet kinds / 数量。
- [ ] RootletAgent 创建后通过明确消息触发执行，不依赖错过的 `rootlet_cluster.started`。
- [ ] SharedContext 写入 owner 约定有测试或守卫覆盖关键字段。
- [ ] EventLog 每一行 `from.id` 都是真实 agent。
- [ ] AI 输出仍只能在 RootletAgent 内进入 rootlet output / candidate pool。
- [ ] Direction Handoff Package validation 和 existing hard constraint / clarification / recovery 测试不回归。

## Technical Approach

- 先抽 `shared-context.ts` 和 `agent-context.ts`。
- 再把 `MessageDrivenUndergroundDispatcher` 中的 handler 逻辑迁移到独立 agent 文件。
- `UndergroundAgentRunner` 订阅 rootlet cluster 启动事件，动态创建 rootlet agent，并发布 rootlet invocation trigger。
- Session 改用 Runner；保留旧 dispatcher 测试时可改为验证 wrapper 行为或迁移到 runner 测试。
- 优先保持小步重构，不扩大业务能力。

## Out of Scope

- 不实现并发 rootlet 执行器。
- 不实现持久 message broker。
- 不实现地下 agent 长期资产化。
- 不实现地上组织 message-driven runtime。
- 不实现跨环节 Nutrient Request。

## Notes

- 本任务的重点是把 agent 从 dispatcher 方法里解耦出来，不是增加 rootlet 智能程度。
- SharedContext 是固定核心 team 的协作介质；消息是跨 agent 推进和审计边界。二者必须同时存在，不能互相替代。
