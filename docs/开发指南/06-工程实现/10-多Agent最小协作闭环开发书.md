# 多 Agent 最小协作闭环开发书

## 目的

本文用于交给后续开发 agent 执行。它不是新的长期架构宣言，也不是替代 ADR-0025 的事实源，而是在当前显式 `deep` 能力已经重启的基础上，把多 Agent 优化收敛到一个可实现、可测试、可回滚的最小协作闭环。

本轮目标是：

- 保持默认普通 `agent` 主线不变。
- 保持多 Agent 只由显式入口触发，不自动升级普通会话。
- 把当前“串行 child 探索 + 前端流程投影”升级为“真实并发子任务 + 父层实时观察 + 父层综合”。
- 用低心智负担的实时流程展示，让用户看到系统正在做什么，而不是阅读一堆解释文字。
- 先完成最小闭环，不提前引入完整 agent team、递归多层、Plan / Aboveground / Governance。

完成后可以宣布：显式多 Agent 模式具备主流深度研究产品的最小形态：目标确认、任务拆分、并行探索、实时进度、父层综合、可复盘结论。它仍不是默认普通 agent，也不是完整长期 Agent 集群。

## 外部主流模式抽象

本计划吸收公开主流产品的工程形态，但不照搬其产品命名。

### ChatGPT Deep Research 启发

OpenAI 官方 Deep Research 公开说明给出的核心模式是：

- 用户先描述目标。
- 用户可选择来源范围，例如网页、上传文件和连接应用。
- 系统提出研究计划，用户可在开始前审阅和修改。
- 运行中用户可以实时跟随进度，并可中断后调整重点或来源。
- 最终产出带引用或来源链接的结构化报告。

OpenAI API cookbook 进一步说明 Deep Research 适合复杂研究工作流，模型会拆解子问题、使用工具、综合结果，并暴露中间步骤、搜索调用、代码执行和引用元数据。

对 AgentArbor 的工程抽象：

- 多 Agent 不是“聊天回答变长”，而是一个运行中可跟随的研究循环。
- 默认视图应是流程和状态，不是长说明。
- 系统需要让用户知道现在处于“计划 / 探索 / 综合 / 结论”的哪一步。
- 最终结论必须可追溯到 child 材料和证据引用。

### Claude Code Subagents 启发

Claude Code 的 subagents / agents 文档给出的核心模式是：

- 子 agent 有隔离上下文，父层只传递任务所需信息。
- 子 agent 可以并行运行，适合少量独立任务。
- 子 agent 可有专门说明、模型、工具限制和背景运行模式。
- 父层收到子 agent 最终结果后再综合。
- 更大规模任务应升级为动态 workflow，而不是无限堆 subagent。

对 AgentArbor 的工程抽象：

- child 必须是真实独立任务，不是 UI 列表项。
- child 之间先不共享完整对话历史，避免上下文互相污染。
- 并行调度是最小协作闭环的必要条件。
- child 权限必须来自 `AgentSpec`、父层授权、当前 run 权限和 `ToolCenter` 的交集。
- 一期只做少量并发 child，不做大规模 workflow。

### Claude Code Agent Teams 启发

Claude Code agent teams 文档给出的更重模式是：

- team lead 负责生成 teammates 并协调工作。
- teammates 各自独立运行，可以直接互相通信。
- 团队通过共享任务列表协调。
- 用户可以查看队友状态，也可以直接和某个 teammate 交互。
- 3 到 5 个 teammates 更适合常见任务，更多任务需要更强调度。

对 AgentArbor 的工程抽象：

- 共享任务板和 direct messaging 是后续方向，不是本轮最小闭环必须项。
- 本轮可以先实现 manager 拥有的 task board；child 不直接互聊。
- 完整 Mailbox / teammate 直连属于第二阶段，否则会把当前问题扩大成团队运行时重构。

## 当前项目判断

当前代码已经有显式 deep / 多 Agent 基础：

- `/api/deep/*` 作为显式入口。
- `DeepConversation` 与普通会话隔离。
- `DeepRunExecutor` 负责 manager 动作循环。
- `child-delegation.ts` 能根据 manager 决策派生一层 child。
- `parent-synthesis.ts` 能综合 child 材料。
- `DeepLiveProjection` 已能给前端提供实时流程投影。
- Panel 已有一个低文字流程视图雏形。

本轮实现后，当前协作语义已收敛为最小可用闭环：

- `spawn_children` 已经通过 `DeepChildScheduler` enqueue + 并发启动，不再逐个串行 `await`。
- `wait_children` 会等待真实在途 child 进展，并把新完成或失败材料交还父层。
- `continue_child` 允许父层审查已有 child 材料、阻塞或失败后，给同一个 child run 追加指令继续标准 Agent loop。
- `synthesize` 前会分批启动并等待 pending / running child 清场；无 child 材料时拒绝伪造结论。
- `AgentRunTree.delegationDecisions[].childRunIds` 使用真实 child run id，不再使用 derived 占位。
- `liveProjection.children`、事件序列和最终 run tree 均从 task board / scheduler 生命周期事实派生；父层追加 child 指令时，只把 instructionId / messageRef / 排队数量 / 状态这类安全短事实叠加为 `liveProjection.children[].parentOperation`，用于默认流程节点的短标签；前端只消费 `/view` 权威快照，不自行推导 child 事实。
- Panel route 在存在 `runtimeHome` 时必须使用文件系统 deep stores：conversation 写入 `deep-conversations/`，run record 写入 `deep-runs/<runId>/record.json`；manager `continue_child` 与控制 API 追加给 child 的 raw 父子消息写入 `deep-runs/<runId>/child-messages/<messageRef>.json`，由 `messageRef` 与 `ChildAgentRun.parentInstructions` 关联，但不进入默认 `/view` 流程投影或事件流；`DeepRun.aiMode` 和冻结能力快照属于 run 级恢复事实，重启后继续 child 时必须优先使用持久化 `aiMode` 重建模型运行环境，而不是回退到当前全局默认模型配置。
- child 不是一次 API 调用：`DeepChildAgentRunner` 复用 `AgentTurnRuntime.executeAutonomous`，通过真实 ToolCenter / Confirmation Gate 执行标准模型-工具-模型 loop。父 Agent 可在 manager 决策中通过 `continue_child` 继续同一个 child run，也可通过控制 API 对已有 child 追加继续指令；运行中的 `pending / running` child 不被抢占，追加指令先进入 scheduler FIFO 队列，等当前 child loop 到达材料边界后以同一 `childRunId` 续跑。追加被接收时发布 `deep.child.instruction_queued` 安全事件，只包含 childRunId、instructionId、队列数量等元数据，不包含 raw 指令正文。已完成/失败/blocked/interrupted child 只有在进入可审查材料或持久化投影后，才由 scheduler 即时恢复同一个 child loop；若 scheduler 对排队或即时恢复返回 `child_not_found / not_accepting`，路由必须返回明确 404/409，不能绕过 scheduler 另起恢复路径。两条路径都必须在 `AgentRunTree.delegationDecisions` 记录 `resume_child` 和真实 `childRunId`。控制 API 继续 child 只更新该 child 材料、事件和投影，不自动改写已完成的父层综合结论；需要纳入最终结论时必须显式走 `POST /api/deep/runs/:runId/resynthesize`，由父层重新综合当前 child 材料并追加新的 synthesis / conclusion，重新综合事件必须引用参与审查的 child run。`approval_required` 的 runtime-only continuation 在进程内可通过确认决策恢复同一个 child loop，丢失时必须明确返回不可恢复，不伪造完成。child 自身中断或异常停止必须进入 `interrupted` child run 与 `deep.child.interrupted` 事件，而不是被任务板投影成 completed；父层可审查后继续同一个 `childRunId`。stop / interrupt 后必须清空尚未执行的父层追加指令，不能因已排队指令触发继续探索。
- 同一个 child 被父层多次继续或确认恢复时，`ChildAgentRun.execution` 只表示最近一段标准 loop；完整复盘必须读取 `ChildAgentRun.executionHistory`，该历史按段保存安全执行事实（轮次、模型请求/响应引用、工具调用状态、outcome、recordedAt），不保存 raw prompt、raw response 或工具原始输出。父层追加或续跑同一个 child 的操作进入 `ChildAgentRun.parentInstructions`，记录 instructionId、安全 messageRef、来源、排队/执行/取消状态、短摘要和时间戳；manager 自主 `continue_child` 应在该操作上附带安全 `review`（审查决策、理由、证据引用和置信度），作为父层为什么要求同一个 child 继续工作的结构化证据；控制 API 用户补充消息可以没有 `review`。`parentInstructions` 是父层操作历史，不替代 child loop 执行历史，也不保存 raw 指令正文。manager 自主 `continue_child` 与控制 API 追加消息的 raw 父子消息都属于内部 `DeepChildMessageStore`，只通过 `messageRef` 供恢复、审计和后续模型上下文读取，默认事件、`liveProjection` 和安全 run tree 摘要不得直接暴露。运行中的 raw 指令记录必须先进入本 run 内部缓冲，child 续跑读取时合并缓冲与持久层，并在 run 收口前按顺序落盘，避免依赖异步投影回调。child 续跑 prompt 只读取已执行过的父子消息历史；本轮当前追加内容仍作为当前 `Parent instruction` 单独传入，并按当前 `messageRef` 从历史操作列表中排除，queued 但尚未执行的消息不能被当作历史事实；若本轮有当前父层 `review`，它必须作为当前审查上下文单独进入 child continuation prompt。manager 决策消息和父层 synthesis 消息必须把 `executionHistory` 计数、最近 loop 事实、最近执行段 outcome / 工具状态摘要、`parentInstructions` 短摘要和安全 `review` 作为 child run fact 投影给模型，让父层审查真实 child run 生命周期，而不是只看最终 summary；child 续跑消息也必须包含同类安全 run fact，使 child 自己知道同一条 run 已执行过哪些段、父层曾追加过哪些要求和为什么继续。

## 最小闭环定义

本轮最小闭环是：

```text
显式多 Agent 入口
  -> 目标与来源/上下文确认
  -> manager 形成简短研究 brief
  -> manager 派生 child tasks
  -> child scheduler 并发执行
  -> task board 实时更新
  -> manager 通过 wait_children 观察在途 / 已完成 / 失败任务
  -> manager 可通过 continue_child 让同一个 child run 补齐缺失材料
  -> parent synthesis 消费 child materials
  -> SynthesizedConclusion + DeepExplorationReport
  -> Panel 低文字实时流程展示
```

最小闭环必须同时满足：

- 至少两个 child 可以在同一 run 中并发启动。
- `wait_children` 能等待真实在途任务，并把新完成材料交还 manager。
- `continue_child` 能让父层审查或操作同一个 child run 继续工作；对运行中的 child 先排队追加指令，对已终态 child 直接恢复同一 child loop，而不是重复派生新 child。
- 同一个 child 多次执行后，最终 `AgentRunTree.childRuns[].executionHistory` 能保留每段执行事实，不能只剩最后一次 loop。
- 单个 child 失败不能击穿整个 run。
- 用户 stop / interrupt 时能保留已完成材料，并取消或标记在途任务。
- `liveProjection.children` 来自真实 task board，不由前端猜测。
- 结论仍由父层 synthesis 产出，child output 不直通结论。

## 用户体验目标

用户可见口径：

- 用户可见名称统一为“多 Agent”。
- 用户可见文案不出现 “Deep”。
- “Deep” 只保留为内部 API、代码和历史契约命名。
- 普通 agent 仍是默认主线，多 Agent 只保留显式入口。

默认视图：

```text
目标 -> 计划 -> 探索 -> 综合 -> 结论
```

展示原则：

- 默认只显示阶段、状态、当前高亮、极短标签。
- 子任务以紧凑任务节点展示：名称、状态、一行目标、一行结果。
- 子任务节点本身可以提供折叠的低噪声补充入口，让用户直接追加要求给同一个子 Agent run；run 运行中也不能用全局 busy 禁掉该入口，后端负责将 running child 的追加要求排队到材料边界后续跑，并在 queued 响应中返回 `messageRef / queuedCount / queuedAt / childStatus` 安全元数据，供前端即时标记“已追加”，再由 SSE 与 `/view` 校准；完整父层操作历史仍放在运行细节。
- 长 objective、置信度、不确定性、事件时间线、完整 run tree、引用、技术 id 放到折叠的“运行细节”。
- 运行中要让用户产生“系统在实时推进”的感觉，而不是“等首轮投影到达后解释发生了什么”。
- 面板必须可滚动，底部输入区不能遮挡流程末尾。

## 本轮范围

本轮只做：

- 研究 brief 最小契约。
- `DeepTaskBoard` 任务板。
- `DeepChildScheduler` 并发调度。
- `spawn_children` 改为 enqueue + start 并发任务。
- `wait_children` 改为真实等待在途任务。
- `liveProjection` 从 task board 推导实时 child 状态。
- partial failure、interrupt、stop 的最小一致语义。
- Panel 默认流程图消费真实实时投影。
- 测试证明多 Agent 不是串行伪流程。

本轮不做：

- 普通会话自动升级多 Agent。
- 多层递归 child。
- child 之间直接通信。
- 用户直接接管某个 child 的完整对话面。
- 完整 team mailbox。
- 大规模 workflow / LangGraph 引入。
- Plan / Plan Package / Aboveground Execution Runtime。
- Governance / Global Soil 回流。
- RAG ingest / embedding / vector store。
- UI 大改版或浏览器视觉验收，除非静态检查无法确认滚动和遮挡问题。

## 推荐架构

### 1. DeepTaskBoard

新增后端内部任务板，作为多 Agent run 的运行中权威状态。

建议位置：

- `src/app/deep/deep-task-board.ts`

建议类型：

```ts
type DeepTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked";

type DeepChildTask = {
  readonly taskId: string;
  readonly childRunId: string;
  readonly spec: DeepChildSpec;
  readonly status: DeepTaskStatus;
  readonly startedAt?: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
  readonly summary?: DeepChildSummary;
  readonly failure?: string;
};

type DeepTaskBoardSnapshot = {
  readonly runId: string;
  readonly phase:
    | "planning"
    | "deciding"
    | "exploring"
    | "waiting"
    | "synthesizing"
    | "completed"
    | "needs_input"
    | "stopped"
    | "failed";
  readonly tasks: readonly DeepChildTask[];
  readonly updatedAt: string;
};
```

要求：

- task board 只记录安全结构化字段，不保存 raw prompt、raw response、工具原始输出。
- child 完整材料仍由现有 `DeepChildSummary`、`ChildAgentRun`、event refs 和 report 承载。
- task board 是 liveProjection 和 eventSequence 的运行中事实源。
- task board 不能替 manager 判断语义，只提供状态事实。

### 2. DeepChildScheduler

新增轻量调度器，负责并发启动 child 探索。

建议位置：

- `src/app/deep/deep-child-scheduler.ts`

建议能力：

- `enqueue(children, specs)`：把 derived child runs 放入 board。
- `startQueued()`：按 `maxConcurrency` 启动 pending child。
- `waitForProgress()`：等待任一 in-flight child 完成、失败或取消。
- `harvestReady()`：非阻塞回收已完成但尚未进入父层材料列表的 child 终态材料。
- `waitForAll()`：等待全部 in-flight child 终态。
- `continueChild(...)`：父层显式要求同一个 child run 继续工作，追加父层指令并复用标准 child Agent loop。
- `cancelPendingAndRunning(reason)`：用户 stop / interrupt 时取消 pending，标记 running 为 cancelled 或等待安全点失败。
- `snapshot()`：返回 board snapshot。

默认并发：

- `maxConcurrency = 3`。
- `maxChildren` 仍沿用现有 `DEEP_MAX_CHILDREN`。

实现约束：

- 调度器只做状态和并发，不调用模型做语义判断。
- child 通过 `DeepChildAgentRunner` 作为显式 child Agent run 运行；`exploreDeepChild` 仅保留为兼容包装。父 Agent 派生 `DeepChildSpec` 作为 child prompt / role / tool 授权 / 可选轮次预算来源，child 复用 `AgentTurnRuntime.executeAutonomous`、`ToolCenter`、Confirmation Gate 的标准模型-工具-模型循环。
- child 派生时必须把父 Agent 生成的 objective 冻结到 child `AgentSpec.instructions`，作为 run 出生事实；恢复、失败降级或仅持有 `ChildAgentRun` 的兼容入口不得用 role 重新生成 objective。
- child 有保守工程轮次边界：`DeepChildSpec.maxModelRounds / maxToolRounds` 省略时默认各 200，父 Agent 可显式给出更小值；超过 200 的值会被钳制到 200。轮次耗尽进入 blocked/out_of_fuel 语义，父层可基于已保留上下文继续同一 child 或综合已有材料。
- child 标准 Agent loop 返回 `approval_required / out_of_fuel / context_overflow` 时进入 `blocked` child run；该状态进入 `DeepTaskBoard`、`liveProjection.children`、`AgentRunTree.childRuns` 和 `deep.child.blocked` 事件，供父 Agent 审查，不按 failed 降级。child 自身中断或异常停止进入 `interrupted` child run、`DeepTaskBoard` interrupted 状态和 `deep.child.interrupted` 事件，仍是父层可审查、可继续的同一 child run，不允许误投影为 completed。`approval_required` 还必须把确认门的安全结构化投影写入 `ChildAgentRun.pendingApproval`，只保存 confirmationId、tool call、工具名、动作摘要、影响资源、风险等级、恢复可用性和 source refs，不保存 raw prompt、raw response、工具原始输出或完整 tool loop；后续做 child resume 时以该字段作为用户可见和父层审查事实，真正恢复执行仍必须复用 `AgentTurnRuntime.resumeAutonomous`。
- 父 Agent 对 child 审查或操作后，可通过 `continue_child` 对同一个 childRunId 追加指令继续；若 child 仍是 `pending / running`，调度器只把指令排入 FIFO 队列，等当前 child loop 到达材料边界后以同一 childRunId 续跑；若 child 已 `completed / failed / blocked / interrupted`，任务板允许这些可审查终态通过父层显式继续迁移回 `running`，`cancelled` 仍不可逆。运行后或受阻恢复时，控制 API 也可对已有 child 追加继续指令，并以 `resume_child` 写入 run tree 审计链；但只要 live scheduler 仍在掌握该 run，控制 API 必须先尝试 scheduler 队列，终态不可排队时再走 scheduler 即时继续能力，只有 scheduler 返回 `child_not_found / not_accepting` 才能 404/409，不能绕过调度器另起 child 执行路径。
- 单个 child 抛错时用现有 `buildFailedChildExploration` 降级为 failed task，不让整个 run failed。
- 不需要在第一版真正 abort 正在进行中的模型调用；但 stop / interrupt 后不能再启动 pending child，并且 running child 完成后不能被当作继续探索的理由自动推进。
- stop / interrupt 后必须清空尚未执行的父层追加指令；running child 当前 loop 自然返回的材料可以保留，但不得再执行停止前排队的后续探索。

### 3. DeepRunExecutor 改造

重点文件：

- `src/app/deep/deep-run-executor.ts`

改造方向：

- `completedChildRuns` 与 `childSummaries` 继续作为父层 synthesis 输入。
- 新增 `taskBoard` / `scheduler` 作为运行中状态源。
- manager 决策消息需要包含 task board 摘要：pending / running / completed / failed 数量、最近完成摘要、失败摘要。
- `spawn_children` 分支不再逐个 await 完成，而是：
  1. derive children。
  2. enqueue tasks。
  3. 并发启动最多 `maxConcurrency` 个 child。
  4. 记录 step：新增任务数、已启动数、overflowCount。
  5. 立即进入下一 manager step。
- `wait_children` 分支改为：
  1. 如果有 running child，等待至少一个 child 进入终态。
  2. 把新完成 / 失败 child material 合并进 `childSummaries` 与 `completedChildRuns`。
  3. 如果还有 pending 且并发槽空闲，继续启动 pending。
  4. 记录等待事实，而不是 no-op。
- `continue_child` 分支：
  1. 根据模型给出的 `childOperations[].childRunId` 找到已有 child run。
  2. 若目标 child 是 `pending / running`，调用 `DeepChildScheduler.queueChildInstruction(...)` 排队追加父层 instruction，等待当前 child loop 到材料边界后续跑。
  3. 若目标 child 是 `completed / failed / blocked`，调用 `DeepChildScheduler.continueChild(...)`，追加父层 instruction，复用标准 child Agent loop。
  4. 若目标 child 是 `cancelled`，拒绝继续。
  5. 新材料按 childRunId 替换旧 `childSummaries` / `completedChildRuns`，避免同一个子任务在父层综合中重复出现。
- `synthesize` 分支：
  - 若没有任何 completed / failed child 材料，拒绝综合并进入 `ask_user` 或 failed guard，不能伪造结论。
  - 若仍有 pending / running child，本轮最小闭环先通过 `waitForAllQueued` 分批启动并等待全部 child 终态后综合；以后再允许 manager 基于“材料足够”提前综合。
- `direct_answer` 分支保持不变，仍服务简单目标。
- `ask_user` 仍置 interrupted / needs_input，不伪装完成。
- stepLimit 仍保留，防失控。

### 4. DeepRuntime 持久化与事件

重点文件：

- `src/app/deep/deep-runtime.ts`
- `src/app/deep/deep-events.ts`

改造方向：

- `DeepRunRecord.liveProjection` 从 task board snapshot 推导。
- 运行中 store upsert 应保存当前 board snapshot 或等价安全投影。
- child started / completed / failed 事件应在 child 状态变化时发布，而不是 run 结束后重建。
- 最终 `AgentRunTree` 仍可以在 run 结束时完整构建，但其 child 状态必须与 task board 事实一致。
- `eventSequence` 应能反映真实顺序：多个 child started 可以先于任何 child completed 出现。

最小可接受：

- 第一版可以继续在最终阶段构建完整 `AgentRunTree`。
- 但 liveProjection 和 eventSequence 的 child 状态更新必须来自运行中 task board，而不是最终结果倒推。

### 5. Research Brief 最小契约

为降低心智负担，建议新增一层简短计划投影，不要直接把 manager 的长 rationale 暴露给用户。

建议类型：

```ts
type DeepResearchBrief = {
  readonly briefId: string;
  readonly goal: string;
  readonly scopeSummary: string;
  readonly sourcePolicySummary: string;
  readonly plannedAngles: readonly string[];
  readonly needsUserApproval: boolean;
  readonly updatedAt: string;
};
```

第一版策略：

- 若 manager 认为目标明确，brief 自动进入探索。
- 若目标、来源或约束不足，manager 走 `ask_user`，Panel 显示“需要补充信息”。
- 不先做强制“用户批准计划”流程，避免扩大交互面。
- 后续可增加“开始前审阅计划”的显式开关。

### 6. 前端流程图

重点文件：

- `src/app/panel-ui/src/components/deep-view.tsx`
- `src/app/panel-ui/src/components/deep-run-tree.tsx`
- `src/app/panel-ui/src/contracts/deep.ts`
- `src/app/panel-ui/src/styles/deep-view.css`

改造方向：

- 默认流程：

```text
目标 -> 计划 -> 探索 -> 综合 -> 结论
```

- 探索阶段显示 task board：
  - pending：空心或灰色点。
  - running：高亮脉冲或进度状态。
  - completed：短摘要。
  - failed：失败标记，短原因。
  - cancelled：停止标记。
- 不显示 runId、API path、技术事件名。
- “运行细节”折叠区保留完整 tree、事件、引用、长摘要。
- 所有 objective 和 summary 默认截断，完整内容放 tooltip 或详情区。
- 面板容器必须设置稳定滚动区域，避免底部输入区遮挡。

## 数据流

目标数据流：

```text
Panel explicit 多 Agent入口
  -> POST /api/deep/conversations/:id/runs
  -> DeepRuntime.executeDeepRun
  -> DeepRunExecutor.startDeepRun
  -> manager decision
  -> DeepTaskBoard enqueue
  -> DeepChildScheduler start children concurrently
  -> child progress event
  -> DeepRunRecord.liveProjection upsert
  -> Panel SSE /events receives trigger
  -> Panel GET /view refreshes authoritative snapshot
  -> parent synthesis
  -> final report
```

关键边界：

- 前端不推导 child 状态。
- Runtime 不从当前配置扩张已创建 run 的工具和 skill 能力。
- child 输出不能直接进入结论。
- 失败 child 只能作为失败材料进入父层，由父层降权或忽略。

## 测试计划

### 后端语义测试

文件：

- `src/app/deep/deep-run-executor.test.ts`
- `src/app/deep/deep-runtime.test.ts`
- 新增 `src/app/deep/deep-child-scheduler.test.ts`
- 新增 `src/app/deep/deep-task-board.test.ts`

必须覆盖：

- `spawn_children` 后多个 child 在全部完成前都已进入 running 或 started 状态。
- 事件顺序证明并发：`child.started`, `child.started`, `child.completed`，不能是 started/completed 成对串行。
- `wait_children` 在有 running child 时真实等待进度。
- `wait_children` 后 completed child material 被合并进 parent synthesis 输入。
- `continue_child` 后同一个 childRunId 的 summary / childRun 被新材料替换，`AgentRunTree.delegationDecisions[].action` 映射为 `resume_child`，`childRunIds` 写真实 childRunId。
- 单个 child 失败被标记为 failed summary，不让整个 run failed。
- `stop` 后 pending child 不再启动，running child 被标记 cancelled 或等待安全终态，已完成材料保留。
- `interrupt` 后 run 置 interrupted，task board 和 child materials 可持久化。
- `synthesize` 不允许在没有任何 child material 时伪造结论。
- `liveProjection.children` 在 run 进行中更新。
- final report 与 task board child 状态一致。
- `approval_required` child run 在 report / run tree 中暴露 `pendingApproval` 安全投影，并且不会因等待确认被标记 failed。
- blocked child 的 runtime-only pending continuation 会进入 `DeepChildPendingContinuationStore`；确认决策可恢复同一个 child loop，continuation 丢失时返回明确 409。
- 父层追加 child message 时复用同一个 `ChildAgentRun` 与 `DeepChildSpec`，追加指令进入模型消息，并继续使用标准 ToolCenter loop。
- manager 自主 `continue_child` 时同样复用同一个 `ChildAgentRun` 与标准 ToolCenter loop，不创建新 child。
- `continue_child`、控制 API 追加消息和确认恢复都会在同一 `ChildAgentRun` 上追加 `executionHistory` 段；测试应断言历史段数、outcome 顺序和最新 `execution` 一致。
- `continue_child`、运行中排队追加和控制 API 追加消息都会在同一 `ChildAgentRun.parentInstructions` 上记录父层操作历史；测试应断言来源、状态迁移、安全 messageRef 和短摘要存在，且不把 raw 指令写入默认事件流。manager 自主 `continue_child` 必须额外断言 `parentInstructions[].review` 保存安全审查决策、理由和 evidenceRefs；控制 API 追加消息不要求该字段。manager 自主 `continue_child` 与控制 API 追加消息都必须断言 raw 内容可通过内部 `DeepChildMessageStore.getByRef(runId, messageRef)` 找回，并且默认 `eventSequence` / `liveProjection` 不暴露该 raw 内容。
- `continueDeepChildAgent` 的 continuation prompt 必须包含当前 `ChildAgentRun` 的执行段计数、最近工具调用状态、父层操作摘要、当前父层 review 和已执行父子消息历史；测试应断言这些事实进入 child 模型请求，避免同 child 续跑退化为只看上一轮 summary 的新任务；连续两次父层续跑时，第二次 prompt 必须能读取第一次已执行 raw 父子消息历史，但不能把当前第二条追加指令重复放入历史。

### 前端结构测试

文件：

- `src/app/panel-structure-tests/panel-ui-app-structure.test.ts`
- `src/app/panel-structure-tests/panel-ui-app-deep-structure.test.ts`
- `src/app/panel-structure-tests/panel-ui-app-layout-structure.test.ts`
- `src/app/panel-structure-tests/panel-ui-app-settings-structure.test.ts`
- `src/app/panel-structure-tests/panel-ui-runtime-structure.test.ts`

必须覆盖：

- 用户可见文案使用“多 Agent”，不出现 “Deep”。
- 默认入口仍是普通 agent，多 Agent 只在显式入口出现。
- 多 Agent 默认视图不显示 run id / API path / raw event type。
- “运行细节”折叠区仍能访问 run tree / events / refs。
- deep panel 主体有滚动容器，输入区不遮挡主体末尾。

### 集成验证命令

建议最小命令：

```powershell
pnpm typecheck:panel
pnpm build:node
node --test dist/app/deep/deep-run-executor.test.js dist/app/deep/deep-runtime.test.js
node --test dist/app/panel-structure-tests/panel-ui-app-structure.test.js dist/app/panel-structure-tests/panel-ui-app-deep-structure.test.js dist/app/panel-structure-tests/panel-ui-app-layout-structure.test.js dist/app/panel-structure-tests/panel-ui-app-settings-structure.test.js dist/app/panel-structure-tests/panel-ui-runtime-structure.test.js
pnpm build:panel
git diff --check
```

按用户偏好，默认不做浏览器 UI 测试。只有静态结构无法确认滚动、遮挡或实时状态时，才补 Playwright 截图验证。

## 开发分期

### Phase 0：事实与边界确认

交付：

- 本开发书。
- 不改运行代码。
- 复查 `CURRENT_RUNTIME_MODE.md`、Agent 口径与命名、ADR-0025。

验收：

- 文档清楚说明普通 agent 默认路径不变。
- 文档清楚说明多 Agent 最小闭环和不做事项。

### Phase 1：后端真实并发任务闭环

交付：

- `DeepTaskBoard`。
- `DeepChildScheduler`。
- `spawn_children` enqueue + 并发 start。
- `wait_children` 真实等待。
- child failure 隔离。
- stop / interrupt 最小任务状态处理。

验收：

- 测试证明 child 并发启动。
- 测试证明 `wait_children` 不再是 no-op。
- 测试证明单 child 失败不击穿 run。

### Phase 2：实时投影权威化

交付：

- `liveProjection` 从 task board 推导。
- 运行中 upsert run record。
- child started / completed / failed 事件按真实运行顺序进入 eventSequence。

验收：

- 运行中 record 可看到 child 状态变化。
- final report 与 liveProjection / task board 一致。

### Phase 3：低心智负担 UI 收口

交付：

- 默认流程图调整为“目标 -> 计划 -> 探索 -> 综合 -> 结论”。
- 子任务节点消费真实 `liveProjection.children`。
- 技术信息进入“运行细节”。
- 面板滚动修复。

验收：

- 结构测试证明用户可见命名和默认入口正确。
- 静态 CSS / DOM 检查证明可滚动。
- 必要时补浏览器截图。

### Phase 4：边界复查与文档同步

交付：

- 若默认运行方式或 deep 显式入口事实发生变化，更新 `CURRENT_RUNTIME_MODE.md`。
- 若实现改变 ADR-0025 的 accepted 决策，新增 ADR 或修订 ADR-0025。
- 运行 `agentarbor-boundary-review` 口径复查。

验收：

- 普通 agent 路径未被多 Agent 代码污染。
- 用户可见命名没有 “Deep”。
- 没有把 Plan / Handoff / Governance 提前引入本轮闭环。

## 风险与取舍

### 风险 1：并发 child 共享同一个 AgentTurnRuntime 是否安全

风险：

- 当前 `AgentTurnRuntime`、FakeModelProvider 或事件 bus 可能未完全按并发调用设计。

处理：

- 第一版 scheduler 允许注入 `maxConcurrency`，测试默认 2。
- 如发现底层通道不支持并发，先通过 scheduler 创建隔离 turn runtime factory，而不是回退到串行语义。

### 风险 2：stop 无法中断正在进行的模型调用

风险：

- 现有模型调用可能没有强 abort 支持。

处理：

- 第一版只保证不启动 pending child。
- running child 完成后的结果若 stop 已发生，只进入保留材料，不触发继续探索。
- 后续在模型运行时补 abort signal，再接入 scheduler。

### 风险 3：task board 与 AgentRunTree 双事实源

风险：

- liveProjection 从 task board 来，最终 report 从 AgentRunTree 来，二者可能不一致。

处理：

- task board 是运行中状态源。
- AgentRunTree 最终由 task board + executor result 构建。
- 测试断言 final tree child 状态与 task board terminal snapshot 一致。

### 风险 4：UI 再次变成解释型文本

风险：

- 为了“说明清楚”加入大量文案，导致心智负担变重。

处理：

- 默认视图只展示流程节点和短标签。
- 长说明只进折叠详情。
- 结构测试禁止默认视图出现技术 id 和 raw event type。

## 不建议的方案

### 继续只打磨前端

不建议。当前核心问题是协作语义不真实，UI 再好也只是投影。

### 直接做完整 Agent Team

不建议。共享任务列表、mailbox、teammate 直聊和用户直接介入单个 teammate 都有价值，但会把本轮扩大成新的团队运行时。当前最小闭环先做 manager-owned task board。

### 引入 LangGraph 重写 deep

本轮不建议。当前已有 DeepRunExecutor、AgentTurnRuntime、ToolCenter、RunEvent、RuntimeDatabase 和 Panel read-model。问题是调度语义缺失，不是缺图编排框架。

### 让普通 agent 自动升级多 Agent

禁止。用户必须显式进入多 Agent；普通 agent 可以说明“这个任务适合多 Agent”，但工程层不能用关键词、长度或文件数量自动升级。

## 外部参考

- [Deep research in ChatGPT - OpenAI Help Center](https://help.openai.com/en/articles/10500283-deep-research-in-chatgpt)
- [Introduction to deep research in the OpenAI API](https://developers.openai.com/cookbook/examples/deep_research_api/introduction_to_deep_research_api)
- [Run agents in parallel - Claude Code Docs](https://code.claude.com/docs/en/agents)
- [Subagents in the SDK - Claude Code Docs](https://code.claude.com/docs/en/agent-sdk/subagents)
- [Orchestrate teams of Claude Code sessions - Claude Code Docs](https://code.claude.com/docs/en/agent-teams)

## 开发 agent 开工顺序

1. 读 `CURRENT_RUNTIME_MODE.md`、`docs/开发指南/01-基础/05-Agent口径与命名.md`、ADR-0025 和本文。
2. 先写 `DeepTaskBoard` / `DeepChildScheduler` 类型和测试。
3. 再改 `DeepRunExecutor`，让 `spawn_children` 与 `wait_children` 具备真实并发和等待语义。
4. 再改 `DeepRuntime`，让 liveProjection 和 eventSequence 消费 task board。
5. 最后收敛 Panel 默认流程视图。

不要从 `.trellis/tasks`、历史 `work_session`、旧 `underground/orchestrator*` 或前端投影倒推本轮实现。
