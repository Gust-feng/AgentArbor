# 运行观察读模型

本文件记录 V0.4 Observation Kernel 契约。当前只有本地 Underground panel 原型会消费观察读模型；没有正式前端框架、SSE、WebSocket、数据库、MCP、A2A 或 AG-UI adapter。观察模型只是从 EventLog 和 runtime result 派生出的 JSON-safe readonly 投影。

## Scope / Trigger

- Trigger：修改 `src/domain/observation/**`、`src/app/minimal-loop.ts` 的 observation snapshot 输出、本地 panel 观察响应，或新增未来前端观察字段。
- Scope：`RunObservationSnapshot`、`RunObservationEventView`、`RunPhase`、`RunStage`、分层 view、本地 panel 读模型和 EventLog 派生规则。

## Signatures

- `RunObservationSnapshot`：跨运行可读的 Observation Kernel 快照；必须包含 `traceId`、`goalId`、`currentPhase`、`currentStage`、`eventCursor`、`events`、`underground`、`handoff`、`aboveground`、`fruits`、`governance` 和 `soilReturnStub`。
- `RunObservationEventView`：EventLog entry 的 JSON-safe 视图；除 sequence、type、traceId、taskId、intent、from、to、createdAt、recordedAt 外，必须提供 `summary`、`scope`、`severity`、`progress` 和 `refs`。
- `RunPhase`：稳定运行相位，不再使用无约束 string。当前相位覆盖 `not_started`、`underground`、`handoff`、`aboveground`、`verification`、`fruits`、`governance`、`soil_return`、`completed`。
- `RunStage`：由最后一个 EventLog event 派生的细粒度阶段，用于未来前端定位当前事件游标。
- `ObservationScope`、`ObservationSeverity`、`ObservationProgress`、`ObservationRef`、`ObservationStatus`：事件视图和层视图共享的前端可读元数据。V0.5 起 `ObservationRef.kind` 包含 `user_clarification`，用于引用 `UserClarificationRequest` 和 `UserClarificationResponse`。智能通道事件起 `ObservationRef.kind` 包含 `model_call`，用于引用 `ModelRequest` 和 `ModelResponse`。

## Contracts

- EventLog 是 source of truth；Observation Kernel 只能派生，不能成为新的事实源。
- EventLog 对外 `list()` / `replay()` 返回值不能暴露内部可变 message 引用；调用方修改返回 entry、message 或 payload 后，不得改变 EventLog 内部事实。
- Snapshot 必须是普通 JSON-safe 数据：不包含 class instance、函数、store 引用、runtime 引用或可调用对象。
- `createRunObservationSnapshot` 是公开入口；内部投影应按职责拆分为事件视图、phase/stage 解析、层视图和 JSON-safe finalizer，避免把所有逻辑堆在单文件中。
- `RunObservationEventView` 的 `summary`、`scope`、`severity`、`progress` 以及 `currentPhase` / `currentStage` 的事件映射必须来自同一个集中 metadata 模块；新增 `ArborMessageType` 时必须同步补全 metadata，并用测试证明 event view 与 phase/stage 没有分叉。
- Event view 只能从 EventLog entry 派生，不能读取 runtime store。
- Event ref 提取必须按事件类型区分同名字段。`model.requested`、`model.completed`、`model.failed` 中的 `requestId` / `responseId` 只能生成 `model_call` refs；`user_approval.requested`、`user_approval.received` 和 `direction_handoff.revision_requested` 中的 clarification id 才能生成 `user_clarification` refs。
- `currentPhase` 和 `currentStage` 必须由 EventLog cursor 派生；没有事件时为 `not_started`。
- Underground view 必须展示预算、rootlet clusters、rootlet outputs、candidate pool counts、`candidatesByKind`、每个 candidate、每个 convergence decision、candidate comparison、推荐 option、淘汰原因、需要用户确认的冲突、地上参考 option、收束摘要、handoff candidate refs、open questions、用户升级状态和 evidence ledger 摘要。
- `underground.evidenceLedger` 必须是 JSON-safe 派生视图，暴露 ledger id、证据总数、按 evidence kind 计数、推荐方向相关 evidence refs、冲突 evidence refs、不足 evidence refs、`hasConflicts`、`hasInsufficientEvidence` 和状态；它不能保存 live ledger/store 引用，也不能成为新的事实源。
- `underground.userEscalation` 必须在 blocking unknown 存在时暴露 request id、reason、blocking level、status、related candidate refs、questions 和 JSON-safe request 数据；non-blocking unknown 只应出现在 `convergence.openQuestions`。
- `underground.clarificationResponses` 必须从 EventLog 中的 `user_approval.received` payload 派生，暴露 request id、answers、answeredAt 和 evidence refs；不得把 response 作为 EventLog 之外的第二事实源。
- Handoff view 必须暴露 package ref、direction id/version/status、validation 状态、source candidate refs、convergence review ref 和 package lineage；不能内联 Growth Plan 或 Soil asset content。
- 地下 demo summary 的 AI 观测摘要必须从 EventLog 与地下运行结果派生，只暴露启用状态、provider / protocol / model、`model.*` 事件计数、completed / failed / configuration_failed 状态、按 rootlet kind 的调用状态、AI candidate count、fallback count / `aiFallbackUsed`，以及与 rootlet output / candidate ref 相关的 `ModelCallRef` 摘要；不得保存完整 prompt、模型正文、API key、token、provider 原始敏感错误或 live provider 对象。
- 本地 panel HTTP 响应只能返回地下 demo summary、Observation Snapshot 的 JSON-safe 子集、脱敏配置状态，以及由这三者派生的 panel tracking read model；不得返回 EventLog 原始 payload、runtime/store 引用、API key、token、完整模型 prompt 或 provider 原始错误。
- Panel tracking read model 只服务本地面板展示，必须从 summary / Observation Snapshot / sanitized config 派生，覆盖 phase / stage / status、rootlet kind 集群状态、按 kind 的模型 requested / completed / failed 计数、按 kind 的候选计数、AI candidate / fallback、收束结果、方向包校验和 provider 配置状态；它不能成为 EventLog、Observation Snapshot 或 demo summary 之外的事实源。
- Panel async run job 只允许是进程内生命周期的本地工作台状态，用于把 `POST /api/underground/runs` 的立即返回和 `GET /api/underground/runs/:runId` 的 polling 连接起来；它可以临时持有 runtime / EventLog 引用以派生 partial trace，但不得持久化、不得暴露 runtime/store 引用、不得替代 EventLog 或地下运行结果。
- `AgentWorkNote` / `PanelRunTranscript` 是 panel 专用派生读模型，必须从 EventLog、demo summary、Observation Snapshot 和 sanitized config 派生；它只能展示观察、动作、产出、依据、下一步和引用，不得展示隐藏思维链、完整 prompt、raw model output、API key、token 或 provider 原始错误。
- Aboveground、Fruits、Governance 和 Soil return 当前可以是 summary/stub，但字段必须稳定、JSON-safe、未来可扩展。
- V0.3 兼容字段如 `directionPackageRef`、`artifactRefs`、`verification` 可以保留给现有调用方；新代码应优先读取 `handoff` 和分层 view。
- Future frontend 应消费 snapshot / event view，不应绕过 EventLog 直接读取内存 store。

## Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| EventLog 为空 | `currentPhase === "not_started"` 且 `currentStage === "not_started"` |
| 外部修改 `EventLog.list()` 或 `EventLog.replay()` 返回的 message payload | 后续读取到的 EventLog 内部事实不变 |
| 最后事件为 `direction_handoff.completed` | `currentPhase === "handoff"` 且 `currentStage === "direction_handoff_completed"` |
| 最后事件为 `path_bias.suggested` | `currentPhase === "completed"` 且 `currentStage === "path_bias_suggested"` |
| Snapshot 包含 runtime store、class instance、函数或可调用对象 | JSON round-trip 测试失败，必须移除引用并改为 plain data |
| Event view 需要读取 artifact store、package store 或 runtime 对象才能补字段 | 设计违规；事件视图必须只接收 EventLog entries |
| Underground view 缺少任一 rootlet、candidate 或 convergence decision | 测试失败；不得只保留汇总 counts |
| Underground evidence ledger 摘要缺少总数、类型计数或推荐方向 evidence refs | 测试失败；不得只展示自然语言摘要 |
| `user_approval.requested` payload 携带 clarification request 但 event refs 缺少 `user_clarification` | 测试失败；事件 ref 必须从 payload 派生 |
| `user_approval.received` payload 携带 clarification response 但 event refs 缺少 `user_clarification` | 测试失败；事件 ref 必须从 payload 派生 |
| `model.completed` payload 携带 model request id / response id 但 event refs 缺少 `model_call` | 测试失败；事件 ref 必须从 payload 派生 |
| `model.*` payload 的 `requestId` 被误识别成 `user_clarification` | 测试失败；同名字段必须按 event type 分流 |
| demo summary AI 观测摘要出现 API key、token、完整 prompt 或模型正文 | 测试失败 |
| recovery 事件 payload 携带 direction package ref 但 event refs 缺少 `direction_package` / `direction_handoff` | 测试失败；事件 ref 必须从 payload 派生 |
| blocking unknown 的 Observation view 未暴露 request details | 测试失败；不得只保留 `userEscalationRequired: true` |
| Direction package view 内联 Growth Plan 或 Soil asset content | 设计违规；只能暴露 refs、status、validation 和 source candidate refs |
| panel HTTP JSON 响应包含 raw EventLog payload、API key、token 或完整 prompt | 测试失败；必须改为 summary / event view / refs |
| async panel run 启动接口阻塞到地下运行完成 | 测试失败；`POST /api/underground/runs` 必须先返回 `runId` 和初始 trace/transcript |
| transcript 包含完整 prompt、raw model output、API key 或 token | 测试失败；只能展示脱敏目的、rootlet kind、状态、模型名、candidate refs 和 event/model call refs |
| 18 步 main EventLog sequence 改变 | 测试失败；除非任务 PRD 明确批准新增/替换事件 |

## Good / Base / Bad Cases

- Good：`snapshot.ts` 只编排事件视图、phase/stage、层视图和 JSON-safe finalizer；`event-view.ts` 只读 EventLog entry；`layer-views.ts` 只把 runtime result 转成 plain view。
- Base：保留 `directionPackageRef`、`artifactRefs` 和 `verification` 给 V0.3 调用方，但新字段以 `handoff`、`fruits` 和其他分层 view 为主。
- Bad：在 snapshot 中保存 `runtime.eventLog`、`directionHandoffPackageStore`、`artifactStore` 或其他 live store 引用。
- Bad：为了前端方便从 observation 层重新推导或修改领域事实，导致 Snapshot 成为 EventLog 之外的第二事实源。

## Tests Required

- Snapshot can round-trip through `JSON.stringify` / `JSON.parse`。
- `currentPhase` 和 `RunStage` 从 EventLog 派生。
- Event views include `summary` / `scope` / `severity` / `progress` / `refs` and are projected from EventLog entries only。
- Underground view lists every rootlet cluster、rootlet output、candidate、candidate kind group、candidate comparison and convergence decision。
- Underground view exposes evidence ledger summary with total entries、counts by kind、recommended evidence refs、conflict / insufficient evidence state and JSON round-trip safety。
- Underground view exposes blocking user clarification request details and non-blocking open questions。
- Event views expose `user_clarification` refs when `user_approval.requested` carries a clarification request payload。
- Event views expose `user_clarification` refs when `user_approval.received` carries a clarification response payload。
- Event views expose `model_call` refs for `model.requested` / `model.completed` / `model.failed` and do not expose false `user_clarification` refs from model `requestId` fields。
- Underground demo summary exposes secret-free AI event counts, per-rootlet-kind model call status, AI candidate / fallback counts and candidate-related model call refs for explicit AI runs, and reports disabled AI with zero model events for the default run。
- 本地 panel response 覆盖 no-AI、fake AI、openai-compatible 配置失败、sync run 兼容、async run job、partial / final event cursor、tracking read model 和 transcript，并证明 HTTP JSON 不包含 raw secret、token、完整模型 prompt 或 raw model output。
- Recovery path event views expose direction package refs for `user_approval.received`、`direction_handoff.revision_requested` 和最终 `direction_handoff.completed`。
- Snapshot exposes clarification responses and handoff lineage while staying JSON-safe。
- Direction Handoff Package、Aboveground store load 和固定 18 步 main EventLog sequence 不回归。
- Snapshot event cursor matches EventLog length and last event。
- Snapshot does not expose mutable store references。
- EventLog `list()` / `replay()` returned messages are cloned or otherwise immutable from callers.

## Wrong vs Correct

### Wrong

```ts
const snapshot = {
  eventLog: runtime.eventLog,
  artifactStore: runtime.artifactStore,
  currentPhase: "completed",
};
```

这会把 live runtime store 泄露给观察层，并让前端有机会绕过 EventLog 读取或解释事实。

### Correct

```ts
const snapshot = createRunObservationSnapshot({
  traceId,
  goalId,
  eventEntries: runtime.eventLog.list(),
  undergroundReport,
  directionHandoffPackage: loadedDirectionHandoffPackage,
  growthPlan,
  workflow,
  task,
  artifactRefs,
  verification,
  fruit,
  runMemory,
  experienceCandidate,
  pathBias,
});
```

这样 Snapshot 只接收可投影输入，输出仍是 JSON-safe plain data；EventLog 和领域结果继续拥有事实来源。
