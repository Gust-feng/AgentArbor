# 地下 Agent 集群调度内核

## Goal

把地下组织从“应用层 helper 串联”推进为“地下中枢调度 agent 集群运行”。OpenAI-compatible API 和 `IntelligenceChannel` 已经证明模型能力入口成立；本任务要证明地下组织本身成立：用户目标进入后，地下中枢能注册/选择地下 agent、调度 rootlet agents、收集结构化输出、进入候选池、完成收束，并产出 `.agentarbor` Direction Handoff Package。

本轮仍保持确定性内存 runtime，不接 UI、HTTP、SSE、WebSocket、数据库、真实 LLM、MCP、A2A、AG-UI，不写 repo-root `.agentarbor/`。智能通道可以作为注入能力参与 rootlet agent，但 AI 输出只能成为 agent invocation 的候选材料。

## Requirements

- 新增地下 agent 集群领域模型：
  - `UndergroundAgentRole`：至少覆盖 `intent_core`、`growth_governor`、`rootlet_agent`、`convergence_judge`、`handoff_steward`。
  - `UndergroundAgentClusterPlan`：记录目标、预算、要启动的 agent、rootlet kinds、调度原因。
  - `UndergroundAgentInvocation`：记录 `invocationId`、`agentId`、`role`、`inputRefs`、`outputRefs`、`status`、`startedAt`、`completedAt`。
  - `UndergroundAgentClusterRun`：记录 plan、invocations、terminal status、candidate refs 和 package ref。
- 新增最小调度内核：
  - 复用 `InMemoryAgentRegistry`、`InMemoryMessageBus`、`InMemoryEventLog`。
  - 地下中枢必须先注册地下 agent manifests，再按 `GoalIntentProfile` 和 rootlet 选择结果调度。
  - rootlet output 必须来自某个 `UndergroundAgentInvocation`，不能由 session helper 直接塞入正式候选池。
  - 调度失败必须形成 `stopped` 或可观测失败结果，不能伪造 approved package。
- 调整地下 session：
  - `runUndergroundDirectionSession` 默认走 cluster runtime，而不是直接调用 loose helper。
  - `runUndergroundDirectionSessionWithIntelligence` 仍支持注入 `IntelligenceChannel`，但 AI 输出必须进入 rootlet agent invocation 后再进入候选池。
  - 保持三类地下终态：`approved_package_created`、`awaiting_user`、`stopped`。
  - Aboveground 仍不进入地下-only demo。
- 观察契约：
  - Observation Snapshot 的 underground view 能展示 agent cluster plan、invocations、每个 rootlet agent 的状态和输出 refs。
  - EventLog 必须能看出 agent 集群被调度起来，而不是只有 model events 或 rootlet output events。
  - 若复用现有 event type，payload 中必须包含 `agentCluster` / `invocation` 信息；如新增 event type，必须同步 `ARBOR_MESSAGE_TYPES`、event metadata 和测试。
- 边界：
  - `IntelligenceChannel` 是 agent 的能力来源之一，不是调度器。
  - Provider adapter 不能被地下领域或 app 运行流程直接导入参与业务逻辑。
  - 模型输出不能绕过 rootlet agent、candidate pool、Convergence Judge 或 Direction Handoff Package validation。
  - 不引入外部 LLM SDK。

## Acceptance Criteria

- [ ] `pnpm build` passes.
- [ ] `pnpm test` passes.
- [ ] 地下-only happy path 通过 agent cluster runtime 产出 approved package。
- [ ] 测试证明 rootlet output 没有关联 agent invocation 时不能进入正式候选池或 handoff。
- [ ] 测试证明 AI 输出必须通过 rootlet agent invocation 才能进入候选池。
- [ ] 测试证明动态 rootlet 选择会形成对应 rootlet agent invocations。
- [ ] awaiting_user / stopped 路径也能生成 cluster run 观测结果，不进入 Aboveground。
- [ ] Observation Snapshot 能展示地下 agent plan、invocations、candidate refs、package refs。
- [ ] EventLog / Snapshot 不包含 API key / token。
- [ ] 默认 demo 不接真实 LLM、不写 repo-root `.agentarbor/`。

## Technical Approach

- 在 `src/domain/underground/` 增加 focused cluster contracts，不把所有类型塞回 `contracts.ts`。
- 在 `src/app/` 增加地下 cluster runtime / scheduler，把现有 `underground-runner` 的 loose orchestration 收拢为 agent invocation 流。
- 保持现有 rootlet、candidate comparison、convergence 和 handoff builder 规则作为确定性守门。
- 只在 app 组合层注入 `IntelligenceChannel`；domain 和 kernel 不导入 provider adapter。
- 更新 observation layer view，避免 Snapshot 只显示 rootlet 而看不到 agent 调度。

## Out of Scope

- 不实现真实 provider CLI demo。
- 不实现地上组织回调地下组织。
- 不实现 Aboveground agent 集群。
- 不实现 UI / HTTP / SSE / WebSocket / 数据库。
- 不创建 repo-root `.agentarbor` 运行资产。

## Notes

- 本任务的验收重点不是“模型能回答”，而是“地下中枢能把 agent 集群调度起来”。
- 地下 agent 不是长期 Capability Asset；当前是运行期组织模型，只有经过后续治理才可能沉淀为可复用能力。
