# 当前软件运行方式

本文件是 AgentArbor 当前软件运行方式的唯一根目录说明。后续只要默认运行方式、默认入口、主执行引擎或前后端职责发生稳定变化，都必须同步更新本文件，再更新实现代码与其他开发文档。

## 产品边界与当前实现的区别

当前产品架构已经统一为一个 Workbench：Ordinary Agent 是默认工作方式，Multi-Agent 是用户显式选择的深入协作功能，Sub-Agent 是 Ordinary Agent 的工具能力。它们共享模型、工具、确认、上下文机械算法和系统适配，但分别拥有业务流程、状态、事件、仓储和 read-model。当前事实源是 ADR-0028。

UI 收口尚未完成。当前仍有设置中的 Agent 集群 beta 开关、侧栏 `Agent 集群` 按钮、持久化 Agent mode、独立 `/api/deep/*`、Deep DTO 以及与 Ordinary 物理分离的数据目录。以下章节按真实代码记录这些行为；它们是统一 Workbench 下的过渡实现，不能被解释为两个产品，也不能提前声称已经移除。

后端阶段一至阶段三要求的唯一组合根、资源所有权和中性依赖方向已经完成：`createPanelRuntime()` 是唯一生产组合根，同时创建 `OrdinaryAgentFeature` 与 `MultiAgentFeature`。Ordinary 的 conversation、run 状态、canonical 模型历史、工具事实、确认 continuation、仓储和事件重放由 feature 自己拥有；`ordinary-routes` 只做 HTTP/SSE 适配。Multi-Agent 的 conversation/run/child store、control/continuation registry、instruction queue 与 active run tracking 同样由 feature 内部持有；`/api/deep/*` 不创建 runtime、store 或 ToolCenter。两类 feature 的资源都在 Panel runtime 关闭时由各自 owner 释放。

Ordinary 的生产执行链已经切换为 `request-handler -> ordinary-routes -> OrdinaryAgentFeature -> OpenAI Agents SDK adapter -> ToolCenter`。OpenAI Responses 与 OpenAI-compatible Chat 共用同一 feature 契约；SDK 负责模型-工具循环和 live confirmation continuation，Ordinary feature 负责业务状态、持久化和 read-model 事实。旧 `BasicAgentRunExecutor`、Panel run job、旧 conversation/run route 与 `/api/desktop/runs` 不再进入生产。当前尚未完成的是旧源码整组退役、外部边界 schema 收口，以及 Workbench/UI surface 隔离。

## 当前默认运行方式

当前 AgentArbor 以桌面普通 `agent` 作为唯一默认运行方式。

- 用户入口：`Desktop Shell / Panel`
- 默认运行模式：`agent`
- 默认执行主线：`用户消息 -> Task Soil -> 普通 Agent 主循环 -> 工具调用/命令确认 -> 事实 read-model`
- 默认交互形态：线性会话驱动；用户在同一个 conversation 中一轮接一轮补充上下文、要求和判断
- 当前已暴露显式 Agent 集群 beta 功能：用户先在 `设置 -> 关于` 启用“Agent 集群（beta）”，Panel 侧栏“新任务”下方才显示 `Agent 集群` 按钮；正式后端入口为 `/api/deep/*`；内部仍沿用 `deep` / `DeepRuntime` 命名（当前为 manager 自由决策循环 + 一层 child 的最小协作闭环，见 ADR-0025）
- 默认仍为普通 `agent`，启动后不因历史 Agent 集群运行抢占普通入口，也不自动把普通请求升级为 Agent 集群；`deep` 只能由用户显式触发，不存在自动升级
- `/api/conversations` 是普通 `agent` 的唯一提交入口；旧 `/api/desktop/runs` 已删除
- Panel 普通输入栏可选择“当前工作区”作为本轮普通 `agent` 运行的工作根目录；该选择只作为前端会话内的显式覆盖，不写入设置。未选择当前工作区时，新 run 使用设置页保存的工作区作为默认工作区
- 正式 Agent 集群后端入口为 `/api/deep/*`；旧 `/api/underground/*` 仅作为兼容/废弃候选路径保留，不与 `/api/deep/*` 并列为正式入口

## 当前真实工作方式

### 1. 一个默认 Agent 主循环

当前软件默认只有一个对用户可见的普通 Agent 主循环。它的核心行为是：

1. 装配会话上下文
2. 调用模型
3. 如果模型请求工具，则走后端工具执行与确认边界
4. 把工具结果回传模型
5. 直到模型不再调用工具，形成最终结果

生产实现由 OpenAI Agents SDK adapter 执行上述机械循环。SDK 不是业务状态 owner：每个工具结果必须先由 `OrdinaryAgentFeature` 持久化为 canonical 工具事实，才能返回给模型；SDK 的 provider call id 与应用事实 id 分开保存，避免父/子 Agent 或并行 child 复用 call id 时串用权限、确认或结果。确认、取消、provider 失败和进程退出都保留已经发生的完整 assistant/tool 事实，不会从 Panel 展示文本反向恢复模型上下文。

这意味着：

- 默认普通 Agent 是线性会话助手，不维护独立任务生命周期、任务拆解状态、完成标准状态机或 Plan 交接对象
- 默认普通路径中的 Task Soil 只是本轮会话输入、上下文引用、权限边界和运行材料的上下文包，不负责驱动任务状态推进
- “模型不再调用工具”才表示本轮普通 Agent 正常完成
- 工具调用、确认等待、工具失败后继续判断，都是普通运行的一部分
- `provider` 失败、网络失败、上下文维护失败、进程失败都不是正常完成
- `out_of_fuel` 与 `context_overflow` 必须投影为 `blocked` / `paused`，不能被包装成 `completed`
- 默认普通 Agent 当前不设置固定模型/工具轮次上限；若未来某个普通 Agent 需要轮次边界，必须由 `AgentDefinition.turnPolicy` 显式冻结并进入 run ref，而不是由前端、route helper 或临时执行参数私自决定
- 普通主循环消费的 `AgentDefinition.turnPolicy.purpose` 必须是 `desktop_agent`；Ordinary 不再读取或回放历史 `desktop_chat` purpose，`work_session_*` 只属于显式 Legacy Underground / deep 运行语义，不能成为普通 AgentDefinition 或普通主循环的执行定义

### 2. 一个显式 Agent 集群最小协作闭环

当前软件除了默认普通 Agent 外，还提供一个显式 Agent 集群 beta 运行路径。它属于同一 Workbench 下的 Multi-Agent 功能，但当前仍需用户在设置中启用 beta 后，从侧栏 `Agent 集群` 按钮主动进入，并使用独立 Deep conversation / run 业务事实。

- 编排边界：`DeepRunExecutor` 维持 manager 动作循环（`direct_answer / spawn_children / wait_children / continue_child / synthesize / ask_user / stop`），其中 `spawn_children` 会把 child 放入 `DeepTaskBoard` 后经 `DeepChildScheduler` 真实并发启动；`wait_children` 会真实等待在途 child；`continue_child` 表示父层审查或操作已有 child，并给同一个 child run 追加指令继续标准 Agent loop；若目标 child 仍是 `pending / running`，追加指令先进入 scheduler FIFO 队列，等当前 child loop 到达材料边界后以同一 `childRunId` 续跑，不抢占当前模型/工具调用；`synthesize` 前会先启动并等待 pending / running child 清场，且只在已有 child 材料时由父层综合产出 `SynthesizedConclusion`。
- 当前协作边界：只允许 manager + 一层 child（`depth = 1`）；child 由 `DeepChildAgentRunner` 作为显式 child Agent run 执行，父 Agent 派生 `DeepChildSpec`（目标、角色、工具授权、可选轮次预算），派生时把父层生成的 objective 冻结到 child `AgentSpec.instructions` 作为 run 出生事实。child 调用中性的 `AgentTurnRuntime.execute(input, semantics)`，由 Multi-Agent 自己选择 final-output-only 投影，再经 ToolCenter 与 Confirmation Gate 完成标准模型-工具-模型循环。模型、基础工具、Research 与 MCP 由唯一后端 Composition Root 通过中性工厂和 contribution 装配；Multi-Agent 不复用 Ordinary 实现，`/api/deep/*` 也不创建 provider、ToolCenter、store 或 runtime。未由父 Agent 显式设置 `maxModelRounds / maxToolRounds` 时，child 不设固定轮次上限；child 模型请求也不写入固定输出/延迟预算，避免工程默认预算替代父 Agent 判断。child 若遇到 `approval_required`、`out_of_fuel` 或 `context_overflow`，会进入 `blocked` child run，而不是误报 failed；child 自身中断或异常停止会进入 `interrupted` child run，不再被任务板误投影为 completed。
- 子 Agent 可续跑边界：`approval_required` 会在 `ChildAgentRun.pendingApproval` 中保留安全确认投影（confirmationId、tool call、工具名、动作摘要、影响资源、风险等级、恢复可用性和 source refs），不保存 raw prompt、raw response、工具原始输出或完整 tool loop；运行进程内同时保留 runtime-only continuation，确认决策可通过 `POST /api/deep/runs/:runId/children/:childRunId/confirmations/:confirmationId/decision` 恢复同一个 child 标准 loop。父层既可以在 manager 决策中通过 `continue_child` 操作同一个 child run，也可以通过 `POST /api/deep/runs/:runId/children/:childRunId/messages` 给已有 child 追加继续指令，使异常停止、受阻或材料不足后的同一个 child 继续工作；运行中 child 的追加会先排队；已完成/失败/blocked/interrupted child 只有在进入可审查材料/持久化投影后，才由 live scheduler 的即时继续能力恢复同一个 child loop。只有 scheduler 对排队或即时继续都明确拒绝时，路由才返回明确 409/404，不能绕过 scheduler 另起恢复路径。这两类继续都会在 `AgentRunTree.delegationDecisions` 中记录 `resume_child` 和真实 `childRunId`，并更新 child 投影。manager 选择终态动作后，由 `DeepRunExecutor` 统一关闭新的 child control 准入并吸收已经获准的 continuation：`synthesize` 会启动并等待全部 pending/running child，`direct_answer / ask_user / stop` 会取消未启动 child 和尚未执行的父层追加指令、等待 running child 自然收尾，再冻结终态材料；step-limit 和异常出口也不会遗留 pending child。`DeepRuntime` 只持久化和投影 executor 的最终事实，不再二次加工 child 状态。终态后由控制 API 新产生的 child 材料只刷新该 child 材料和审计链，不自动重写已完成的父层综合结论；如果已存在结论，后端会把 `liveProjection.synthesis.status` 标为 `pending` 并高亮综合节点，表示当前结论落后于最新 child 材料。后续若需要把新材料纳入最终结论，必须通过 `POST /api/deep/runs/:runId/resynthesize` 显式触发父层重新综合，由父层基于当前 child 材料再产出新的 synthesis 与 conclusion，重新综合事件会安全引用参与审查的 `child_run`。同一 conversation 的重叠确认由 command FIFO 串行，工具不会重复执行；内部 continuation 被预留或已知结果仍待补写时，守卫会返回 `confirmation_in_progress`。只有模型/工具执行结果本身确实无法确定时才返回 `confirmation_outcome_unknown` 并禁止自动重放。已知执行结果若仅 context 或 run projection 持久化失败，后续只补写该事实，不重新执行模型或工具；无法持久化的协议 continuation 会形成保留执行事实的 failed child，不伪装 completed。若进程重启导致 confirmation continuation 丢失，后端返回明确 409，不伪造恢复。外部 stop / interrupt 仍可收口。当前已具备真实并发 child、真实 `wait_children`、父层审查后继续同一个 child、单 child 失败隔离、parent synthesize；外部 `stop / interrupt` 与模型主动 `stop` 复用同一停止收口语义：取消 pending、清空尚未执行的父层追加指令、保留已完成/受阻/中断材料、等待或保留 running child 当前 loop 自然收尾后的材料，并尝试部分综合，但不再触发继续探索。
- Multi-Agent runtime-only child continuation 由 feature 统一保留，默认 TTL 为 24 小时、全局最多 256 项、单 run 最多 16 项；run 终态只保留最终 run tree 仍标记 `pendingApproval` 的 child，其余立即清理。过期、容量淘汰、会话删除或进程重启导致确认上下文丢失时，接口返回明确 409，不伪造恢复。
- child 父层续跑只有在上下文准备完成后、真正进入模型/工具 loop 前，才尝试写入带稳定 `instructionId / messageRef` 的 durable queued marker；任一步失败都不启动模型。已经进入 live scheduler 的 queued 指令若准入失败会收口为 `cancelled`；post-terminal 直接续跑若在 marker 成功前失败，则不创建指令记录。marker 成功后，只有 child loop 已返回确定结果才记为 `executed`，无法判断执行结果的异常继续保留 `queued`。模型/工具结果已经确定但 child 主投影写失败时，feature 在当前进程保留该结果，后续 child 命令、follow-up、parent run 启动或重新综合只补写投影，不重新执行 child。若进程在结果投影前退出，只剩 queued marker 或持久化 `pendingApproval` 而 live continuation 已丢失，后端返回 `child_instruction_outcome_unknown` 或 `confirmation_continuation_lost`；同一 child 的新指令、重新综合，以及显式依赖该旧 run 的 intake、parent run 启动和 follow-up 都不能绕过未对账事实，独立新任务不受影响。这是明确的 fail-closed 恢复边界，不宣称跨进程 exactly-once 或伪造可恢复 continuation。
- `DeepRunExecutor` 是终态 child 材料的唯一收口 owner；完整 final tree、report、conclusion 与 liveProjection 已形成后，最后一次 run record 写入失败会携带整份 final record 进入同进程机械重试，不再用较早的空 report/live snapshot 覆盖为失败。child-message sidecar 和资源 cleanup 失败只进入后台诊断，不覆盖已知 executor/model/tool 结果；主失败与 cleanup 同时发生时分别报告，cleanup 不能替换主失败。
- 运行中单一事实源：每个 Agent 集群 run 都创建 manager-owned `DeepTaskBoard`；运行中的 child 状态、任务板相位与研究 brief 先进入 board / record，再由 `liveProjectionFromBoard(...)` 派生 `liveProjection.children` 与展示相位；父层追加 child 指令时，scheduler 只把 instructionId / messageRef / 排队数量 / 状态这类安全短事实叠加到对应 `liveProjection.children[].parentOperation`，不把 raw 指令正文放进默认流程投影；`deep.child.started / instruction_queued / completed / blocked / interrupted / failed` 事件也在 scheduler 生命周期回调处实时发布。最终 `AgentRunTree` 只记录真实启动并形成 `ChildAgentRun` 的 child，其状态与 board 中对应任务对齐；从未启动就取消的计划任务只保留在 TaskBoard 与 `liveProjection` 的取消工作流事实中，不伪造 child run，spawn delegation 的 `childRunIds` 也不得留下无法在 tree 解析的引用。有 `runtimeHome` 时，deep conversation 写入 `deep-conversations/`，deep run record 写入 `deep-runs/<runId>/record.json`，父子 raw 消息写入 `deep-runs/<runId>/child-messages/<messageRef>.json`，与普通 conversation / run 物理隔离；run record 持久化本次 `aiMode` 与冻结能力快照，使进程重启后仍能读取同一 run tree，并在用户追加消息时基于持久化 childRun 继续同一个 child loop。
- 当前 UI / 投影路径：executor 首次 `spawn_children` 后装配 `DeepResearchBrief`；Panel 主界面不提供“桌面 Agent / 多 Agent”顶部切换，默认始终进入普通桌面 Agent。Agent 集群入口只在 `设置 -> 关于 -> 启用 Agent 集群（beta）` 开启后显示在侧栏“新任务”下方；点击 `Agent 集群` 才进入或恢复当前/最近的 Agent 集群任务；点击侧栏“新任务”固定回到普通桌面 Agent，关闭 beta 入口也会回到普通 Agent。Agent 集群默认界面采用接近普通 Agent 的聊天态：用户看到助手回复、动态协作进展、探索结果、综合结论，不默认暴露“父 Agent / 子 Agent”、runId、API path、raw event type 或固定阶段编排；完整 eventSequence、run tree、确认恢复和长材料只按需折叠在“协作记录”中，默认主视觉不展示运行 ID 引用和五阶段复盘。默认输入语义按状态分流：无 active run 或 active run 已终态时，提交先进入 `POST /api/deep/intake`，由模型判断 `ask_user / direct_answer / start_collaboration`；`ask_user` 与 `direct_answer` 只写入 `DeepConversation.intakeTurns` 并展示自然助手消息，不创建协作 run、不显示协作进展；只有 `start_collaboration` 才启动后台 deep run，首轮写入 `currentObjective`，终态后则在同一 `rootRunId` 任务链上创建 follow-up run。active run 运行中时提交 `POST /api/deep/runs/:runId/correct` 作为补充要求；follow-up run 会写入 `parentRunId / rootRunId / turnOrdinal`，manager 输入包含 intake 的标准化目标、短计划和上一轮安全结构化上下文（用户补充、上一轮目标、结论、child 摘要、综合摘要），不暴露 raw prompt、raw response 或 raw tool output。后端 read-model 经 `DeepRunRecordStore` 持久化，由 `/api/deep/runs/:id/events` 作为 SSE 即时触发信号，再拉取 `/api/deep/runs/:id/view` 获取权威 run 快照与 conversation 投影；前端不从 SSE 自行重建 child 事实，并用 view 中的 conversation 保持终态续聊的同一主题身份。`GET /api/deep/runs?limit=50` 提供跨会话最近 run 摘要，并按 `rootRunId` 聚合为任务链最新一轮，Panel 启动时加载该列表；启动后不自动进入 Agent 集群工作区，避免抢占普通 Agent 默认体验。
- 当前仍未做：普通 agent 自动升级 Agent 集群、多层递归 child、child 互聊 / team mailbox、用户直接接管单个 child 的完整对话面、跨进程持久恢复 child runtime continuation、Plan / Aboveground / Governance / Global Soil 回流、完整 Agent Team 协作面。当前交付只是显式 Agent 集群的最小协作闭环，不是完整团队运行时。

### 3. 前后端分离

当前软件采用前后端分离：

- 前端负责：发起请求、订阅流式事件、展示后端 read-model、提交确认决定
- 后端负责：上下文装配、模型调用、工具可见性裁剪、工具执行、确认门控、运行状态、事件投影、持久化与恢复
- 当前 `GET /api/conversations/:id` 会直接返回当前会话正在查看的 `currentRun` 投影，包含当前 run 的基础状态、工作视图、结果详情和 replay
- 当前 `GET /api/basic-agent/runs/:runId/view?cursor=...` 会返回同一套后端拥有的 run view，供前端在 live refresh、结算刷新和历史运行读取时复用
- 当前后端 run view 的语义字段是 `workView`；`GET /api/basic-agent/runs/:runId/view` 和 `GET /api/conversations/:id` 的 `currentRun` 不再返回顶层 `workSession` alias
- 当前后端 run view 对普通 `agent` 暴露的顶层 `agentDefinitionRef` 与内层 `run.agentDefinitionRef` 必须来自同一个 run 出生事实，不能让前端面对两套 Agent 定义身份
- 前端在打开会话，以及提交消息、确认决策、取消运行、运行结算、历史 transcript 读取后的刷新路径中，都应优先消费这些后端 read-model，而不是自行拼装运行状态、工作视图、结果详情和事件
- 当前 Panel 前端通过 `/api/conversations` 提交普通运行，通过 `/api/basic-agent/runs/:id/view` 与 `/stream` 读取同一 Ordinary read-model；`/api/desktop/runs`、无生产客户端的 work-session route 及 `workSession` 响应别名均已删除
- 历史运行和恢复只读取 `OrdinaryRunState`：run 出生事实、status、`canonicalMessages`、工具事实、usage 与 timeline 在同一 snapshot 中提交；conversation control 只保存分支、标题、置顶和删除事实。WorkView、Panel conversation 和 SSE 都是单向展示投影，不能反向拼装模型历史
- Ordinary 使用 `ordinary-run/v2` snapshot：每个 run 原子写入 `runtime/ordinary/runs/<runId>/snapshot.json`，列表 manifest 只是可重建索引；conversation control 使用独立的 `ordinary-conversation/v1` 文档。旧 RuntimeDatabase、raw `run.json`、sidecar event/tool-call 和旧 schema 均不读取、不迁移、不双写
- Ordinary live 状态只由 `OrdinaryAgentFeature` 拥有的 run status 决定；正式回答、当前确认和 canonical 消息都在同一 feature 事实中。Panel 只消费 read-model，额外 title/summary/preview 可以有界压缩，但不能覆盖正式回答或模型可继续使用的工具事实
- 普通 `agent` run 的 live model stream 只接受 `desktop_agent` 的用户可见模型增量；`desktop_chat` purpose、`desktop.chat.*` 输出契约和 read-model alias 已清除，不读取旧本地记录；`work_session_*` 增量只服务显式 Legacy Underground / deep 路径，不能混入默认普通流式输出

前端不是 Agent 引擎，也不负责推导任务状态、补全工具语义或重建运行事实。

### 4. 工具属于后端设施能力

当前工具能力属于后端设施，不属于前端，也不属于 prompt 自由扩展范围。

- 工程决定本轮 Agent 能看见哪些工具
- 当前默认普通 `agent` 的工具可见性由后端结构化能力快照与 `AgentDefinition.toolVisibilityProfile` 共同裁剪，不再依赖工具名前缀约定
- 普通 `agent` 只有在后端已经冻结 `capabilitySnapshot` 后，才会把工具暴露给模型；裸 `ToolCenter` 只负责执行，不再单独决定模型可见工具
- 模型可见工具准入只要求真实 executor identity、客观 description、有效 input schema 和执行/副作用元数据；`modelContract` 的用法、输入/输出说明、runtime hints 和 examples 是可选增强。工具执行域不再携带用户预览策略，Panel/read-model 自行从事实派生展示。provider 描述使用 section-aware 显式字符预算：客观 description 有独立上限，result/continuation、runtime 和限制/副作用事实优先，不再用关键词挑选说明
- `ToolCenter` 只执行工具、权限/策略校验与命令确认，并返回 `ToolCallResult` 执行事实；不保存逐 run 调用计数或预算，不生成模型消息、UI display、envelope 或持久化投影。轮次/预算由 Agent loop 决策，模型、事件和 Panel 分别从同一事实单向派生自己的消费视图
- 新写入的工具 lifecycle event payload 是唯一可重放工具事实：requested 保存一次 input，终态保存有界 output/error/duration 并保留 continuation；`RuntimeToolCallRecord` 只保留 callId、终态、错误、引用和时间索引，不复制 input/output。live 与 replay 从同一 reducer 消费该 payload。旧 `projection / envelope / display` 记录不再读取或迁移，旧 snapshot 不满足新契约时属于开发期失效数据
- 工具 input/output 只接受 JSON-safe `ToolFactValue`；模型 `ToolResult` 正文在 `none / text / json` 中三选一，同一完整 output 不再同时写入文本和结构化字段。工具消息协议已有的 call id/name 不在正文重复，附件字节只走带外模型输入
- 通用 ToolCenter/kernel 只读取工具输出顶层 `continuation / continuations`。MCP 规范没有通用工具结果 continuation，因此 MCP adapter 不再按 `structuredContent.continuation / continuations` 的字段形状猜测分页或提升可执行 `nextInput`；`structuredContent` 原样作为服务端事实保留。只有拥有明确分页或稳定引用契约的 producer/adapter 才返回 canonical continuation。`read_file / list_dir / grep_files` 自身返回有界事实和 `nextStartChar / nextStartLine / nextOffset`；模型需要更多内容时，把下一位置值映射回 `startChar / startLine / offset` 再次调用原工具，不构造额外的通用续读工具。真实 offset ceiling 或副作用请求无法安全重放时，必须返回明确失败事实，不得返回 `completed + truncated` 的死引用，也不得生成会重放 POST/PUT/DELETE 的 synthetic continuation
- 序列化结果超过当前 180,000 字符内联边界时，ToolCenter 使用每个 PanelRuntime 唯一、Host-owned 的进程内 `ToolOutputStore` 保存当前完整文本或序列化 JSON。结果返回 4,000 字符预览、opaque `tool-output://` 引用和 `read_tool_output` 的下一段输入，并保留带外附件；显式 failed/cancelled 的超大 output、error 与 errorFacts 作为一份完整失败证据保存。父 run 必须冻结并授权 reader，Deep child / Sub-Agent 在真实 broker 也具备 reader 时把它作为 transport companion 自动继承，不扩张其他业务工具。读取不会重新执行原工具；`read_tool_output` 以 UTF-16 code-unit offset 每次最多请求 29,000 字符，并按实际序列化包络动态缩小当前页，避免长 provider call id 或高转义正文造成二次截断与偏移跳跃；窗口不得拆分 surrogate pair，最后一段读完即释放该 ref。默认 store TTL 最长 24 小时、最多 128 项、单项最多 4,000,000 字符、总计最多 32,000,000 字符；Ordinary 未消费引用保留到完整读取、TTL 或 Panel 关闭，容量不足时拒绝新的 retain 而不驱逐仍可读取的 live fact；Deep run 为 post-terminal child continuation 保留稳定 owner，在删除所属 Multi-Agent conversation 时回收；Panel 关闭全量清理。模型附件字节只服务当前 provider 请求，不进入 Deep child 持久化上下文；为保证 OpenAI Responses 的跨轮 reasoning/function-call 恢复，Deep 只对白名单 `openai_responses_output_items` 做 JSON-safe 验证并原样保留有效 output items。已知该 key 但内容无效或为空时，Deep child context persistence 以稳定错误 `model_protocol_continuation_not_persistable` 明确失败，不能静默丢弃后声称可恢复；其他未知 protocol extension key 仍忽略。`tool-output://` 引用元数据可以随工具事实持久化，但必须携带 `continuationAvailability: "live_only"`；引用对应的完整内容不进入 RuntimeDatabase，过期或进程重启后读取会明确返回 not found。超过单项/总量/条目容量时不创建引用并返回明确 delivery failure；原 failed/cancelled/approval 状态、错误域、错误码和确认请求必须保留，只有原 completed 结果因无法完整交付而转为 failed
- MCP adapter 只保留服务端 `content[]` 与可选 JSON 对象 `structuredContent` 的单份语义事实，不生成 `summary / mcpResult / result` 多份包装；外部 `structuredContent` 不是 JSON 对象或不满足 JSON-safe 边界时明确失败。只对“text 可解析 JSON 且与 structuredContent 深度完全相等”的精确镜像做无损去重，其他内容完整保留；`isError=true` 成为正式工具失败。图片、音频和非图片 embedded resource blob 分别转成带外 `image / audio / file` 类型的 `ModelInputAttachment`，JSON 只保留 MIME、文件名/URI、byteLength 和附件索引；单个 MCP 结果当前最多 16 个模型附件、单附件最多 20 MiB、合计最多 32 MiB。附件预算或结果归一化在远端调用返回后失败时，必须作为 post-execution delivery failure 保留真实 `sourceExecutionStatus` 与 `doNotBlindlyRetry`，不能声称远端未执行或诱导盲目重试。OpenAI-compatible Chat Completions 只映射原始 user 消息中的 image、inline/file-id file 与内联 wav/mp3 `input_audio`；tool-origin 二进制附件必须明确 `request_validation`，不得改变来源角色；OpenAI Responses 支持 user/tool-origin image 与 file，内联 file 使用官方 `data:<mime>;base64,<data>`，但当前拒绝 user/tool-origin audio；对 inline file_data 和携带 byteLength 的 file_id/file_url，发送前执行单文件小于 50 MB、整份请求文件合计不超过 50 MB 的校验，未知远端文件大小仍由 provider 最终校验；其他无法由 provider 协议消费的媒体同样必须形成可观察失败，不能伪装成普通 file 或静默丢弃
- Agent loop 对 read-only 并行结果中的动态 `approval_required` 仍会暂停；等待确认、deny/guidance、多阶段再次确认或取消时，确认前正文、附件、错误和可执行 continuation 都保留给模型。用户 guidance 不做固定 1,000 字截断；pending call/confirmation 身份不一致时 fail closed，不能执行工具
- Ordinary 在每次状态提交时保存模型实际消费的 `canonicalMessages`：原始 `user / assistant / tool` 顺序、工具调用参数、工具结果和最终 assistant 输出保持一致；OpenAI Responses 只额外保留可作为下一轮输入的白名单 output items。下一轮只读取上一条可见 lineage 的 canonical 消息并追加当前 Skill、任务引用和用户消息，不从 Panel 可见对话、活动事件或摘要重建第二份历史。附件字节只服务当前请求，不进入持久化上下文；旧 snapshot 直接拒绝
- Ordinary 模型上下文不按固定字符数或消息数静默裁剪；容量只由冻结的模型 token budget 与 loop-level context compaction 管理。只有模型调用前的 compaction 可以改写上下文，且不得拆开 assistant tool call 与对应 tool result；压缩失败明确中断，不能带着超限或半截上下文继续。失败、blocked 或取消 run 已经形成的 canonical 消息仍可被下一轮看到，Panel 错误文案和可见回答不能冒充模型历史
- 官方 OpenAI Chat Completions 与 Responses 请求保持稳定前缀：系统指令、工具定义与既有消息顺序不因展示投影或跨轮恢复而改写；仅官方 `api.openai.com` 请求携带由协议、模型、根指令、输出契约和工具定义生成的稳定 `prompt_cache_key`。Responses 同时请求 `reasoning.encrypted_content` 并把上一轮 output items 原样回传，兼容端点不发送这些官方专有字段。运行计量保留 provider 报告的 cached input、cache write 与 uncached input tokens，不能用估算值冒充缓存命中
- `canonicalMessages` 是 Ordinary 内部恢复事实，不属于公开 read-model；普通运行 API、conversation 投影和 SSE 不返回系统提示或 provider continuation。Panel 只展示单向投影，但不得用摘要替换正式回答和工具结果
- 工具生命周期固定为 `tool.requested / tool.completed / tool.failed / tool.cancelled`，确认等待使用 `user_approval.requested`；live、replay、conversation history 和持久化视图从同一 append-only 事件归约语义消费调用事实
- Panel 关闭会在首个异步清理前同步停止 Ordinary 与 Multi-Agent 新工作准入并请求停止现有 run；等待在途 HTTP 请求最多 1 秒后使用 Node `closeAllConnections()` 终止卡住的连接，整个运行资源清理另有 30 秒 Host hard deadline。若 provider 或其他在途 operation 不响应取消，关闭返回明确 `panel_shutdown_timeout`，桌面宿主可继续退出而不会永久挂起；关闭期间新 Ordinary 请求返回 `panel_runtime_quiescing`，已越过 Panel gate 的 Deep command 返回 `deep_feature_quiescing`
- 普通 `agent` 的本轮模型配置事实来自 run 创建时冻结的 `capabilitySnapshot.activeModel`；执行、持久化、恢复和用户可见 read-model 不能再用当前全局模型配置覆盖它
- 普通 `agent` 的本轮模型能力事实来自 run 创建时冻结的 `capabilitySnapshot.modelCapabilities`；直接调用参数里的临时 `modelCapabilities` 只能服务没有冻结快照的测试或兼容调用，不能覆盖已创建 run 的上下文窗口、输出预算、工具调用能力或流式能力
- 普通 `agent` 的附件读图工具只在本轮模型能力支持视觉输入时进入可用工具集合；工具读取的图片字节只作为临时 `ModelMessage.attachments` 进入下一轮模型请求，不进入事件、run record 或 Panel read-model，工具 JSON 结果只保留图片元数据和本轮模型输入状态
- 普通 `agent` 的本轮工作区事实来自 run 创建时冻结的 `capabilitySnapshot.workspace`；请求显式传入的当前工作区只影响该 run 的工作根目录，不能回写或覆盖设置页保存的默认工作区
- 普通 `agent` 在请求未显式指定 `aiMode` 时，默认 `aiMode` 也从本轮 `capabilitySnapshot.activeModel.defaultAiMode` 派生；入口层不得为了默认值提前读取当前全局模型配置
- 普通 `agent` 执行阶段只能消费 run 创建时冻结的 `capabilitySnapshot`；执行资源不得在运行中重新向 `CapabilityCenter` 获取当前快照来替代本轮事实
- 普通 `agent` 的本轮 ToolCenter 执行器全集也必须从 `capabilitySnapshot.toolCatalog.tools` 派生；当前代码新增、删除或启停工具只能影响新 run，不能扩张已创建 run 的可执行工具集合
- 普通 `agent` 的技能可见与触发集合也来自 run 创建时冻结的 `capabilitySnapshot.skillCatalog`；执行期间的当前 skill 启停状态只影响新 run，不改写已创建 run
- 普通 `agent` 默认发现用户级 `$HOME/.agents/skills` 和项目级 `$WORKSPACE/.agents/skills`；设置页使用当前配置工作区，本轮普通 run 使用 run 创建时冻结的工作区，未显式提供工作区时才落到默认配置工作区。项目级 skill 具有更高 precedence。宿主可通过显式 `additionalSkillRoots` 接入 admin/plugin 等受管来源，但这只是显式来源挂载，不是 marketplace、installer、自动更新或回滚机制；默认不自动扫描 managed marketplace。来源层级、root id 和 precedence 会进入冻结 skill catalog 与 run capability 投影；默认显式/关键词选择只使用安全 metadata，不暴露绝对路径；显式 opt-in 的模型路由同样只能看到安全来源 metadata
- 普通 `agent` 的 skill 启停和 `markUsed` 状态使用 source-qualified `stateKey` 记录；旧 `skillId` 状态只在没有多来源同 id 歧义时作为兼容回退
- 普通 `agent` 的默认 skill 选择采用 progressive disclosure：基于本轮 frozen skill catalog 做确定性显式/关键词选择，显式 `$skill` 直接选择，关键词或触发器命中才加载正文；默认不发起 `skill_routing` 前置模型请求，也不把全量 skill 候选发给模型。设置页“基础能力 -> Skills 触发方式”可显式切换为“语义路由”；只有该设置冻结到新 run 的 `capabilitySnapshot.skillTrigger.mode = "model"` 时，普通 Agent 才会在主请求前额外发起 `purpose: "skill_routing"` 的模型路由请求
- 普通 `agent` 只在 skill 被本轮选中后读取 `SKILL.md` 正文，并校验 run 创建时冻结的正文 hash；hash 不一致时 fail closed，不注入正文
- 普通 `agent` 只允许本轮已选中且成功加载的 skill 通过 `read_skill_resource` 按需读取 indexed `references`、`assets` 和 `scripts`；reference 内容作为工具结果回到模型，assets/scripts 不返回 raw body，scripts 不自动执行
- skill `evals/` 只作为 loader/doctor 的本地质量评估 artifact 被发现、索引和统计；它不是运行时资源，不进入 frozen runtime resource index，也不能通过 `read_skill_resource` 读取或注入模型输入。当前 doctor 默认做确定性 JSON 结构、case 数、routing 断言、quality/regression 的 `qualityBaseline` with/without skill 记录和字面量质量检查；显式传入模型通道时可通过 `skill_routing` 跑 routing eval，但仍不自动生成 with/without 输出、不调用 LLM judge、不评估运行时真实回答质量
- skill `allowed-tools` 当前只作为冻结和审计声明处理：不能扩张工具，不能隐藏普通 `agent` 原本可见的工具，也不是 Claude Code 风格免确认授权；未来若做 skill 级免确认授权，必须新增 per-tool grant 契约
- MCP 当前进入配置目录、能力快照的 `mcpCatalog`、能力草案投影和普通 `agent` 默认工具边界；只有已启用、已连接、已进入本轮冻结快照且通过 `AgentDefinition.toolVisibilityProfile` 的 MCP 工具，才会作为模型可见工具和可执行工具进入本轮运行
- 子 Agent 工具（`call_sub_agent` / `call_sub_agents` / `spawn_sub_agent`）注册到 `desktop-basic` scope，进入能力快照的 `subAgentCatalog` 和普通 `agent` 默认工具边界；模型在普通会话中可自主调用内置专家（code-expert / doc-expert / research-expert / review-expert / test-expert）或通过 `spawn_sub_agent` 动态派生自定义子 Agent；子 Agent 工具在 capability snapshot 阶段注册 stub 定义（让模型可见），在 `prepareDesktopAgentLoop` 阶段动态注册真实 executor（注入 IntelligenceChannel、ToolExecutionBroker 和 eventLog）；子 Agent 不能递归派生，只有顶层 Agent 拥有 `spawn_sub_agent`；子 Agent 输出是局部材料，由父层模型决定如何使用（见 ADR-0026）
- 工程决定哪些工具可以执行、哪些需要命令确认、哪些被隐藏
- `AgentTurnRuntime / tool-use-loop` 在调用工具执行器前必须强制校验本轮 `allowedTools`；`ToolCenter` 和具体 adapter 仍可重复校验，但不能成为唯一防线
- 模型只能在本轮可见工具集合内自主选择
- 模型不能绕过 ToolCenter、权限、命令确认和本地策略沙箱；但普通回答、工具结果和错误信息不得被脱敏或安全投影链路吞掉

### 5. 桌面自动更新边界

当前只有 Windows 打包桌面版支持自动更新。打包桌面版通过 `electron-builder` 产出 NSIS 安装包，并由 `electron-updater` 消费 GitHub Releases 中的 `latest.yml` 与安装包产物；启动后可自动检查并后台下载更新，下载完成后只提示用户“重启安装”，不会静默中断正在进行的任务或自动重启。

- 支持范围：Windows x64 打包桌面版。
- 不支持范围：浏览器 Panel、`panel:dev`、`panel:desktop:dev`、`--smoke`、`--window-smoke` 和未打包 Electron 运行。
- `/api/app/update`、`/api/app/update/check` 和 `/api/app/update/install` 是 Panel 对更新状态的后端契约；普通浏览器面板默认返回 `unsupported`，显式传入旧 manifest URL 时只能作为发布信息检查 fallback，不能自动安装。
- 自动更新发布源固定为 GitHub Releases；真正可自动更新的版本必须由 tag 发布流程产出 installer、blockmap 和 `latest.yml`，并在任何 GitHub 发布动作前校验 tag 与 `package.json` 版本、唯一 x64 installer、blockmap 以及 `latest.yml` 中的版本、路径、大小和 SHA-512 一致；手动上传任意 release asset 不构成可更新版本。

### 6. 当前默认产品边界

当前默认入口仍是普通桌面 Agent；`deep` 是统一 Workbench 内的显式 Multi-Agent 功能，但入口实现尚未完成收口，不能混入默认 Ordinary 路径。

- 产品只有一个 Workbench；Ordinary、Multi-Agent 和 Sub-Agent 的业务状态、事件、仓储与 read-model 分别归各自 owner
- 默认入口仍为普通 `agent`；当前 Agent 集群功能通过 `设置 -> 关于` 的 beta 开关暴露为侧栏按钮（正式后端路径 `/api/deep/*`，内部 `runMode: "deep"`），但不自动触发、不自动升级，不把普通请求自动转为 deep
- 当前显式 Agent 集群已落地 manager 自由决策循环、一层 child、`DeepTaskBoard` 单一事实源、`DeepChildScheduler` 实时并发、`DeepResearchBrief`、聊天态动态协作投影、专属工作区壳层、跨会话历史恢复与 parent synthesize，但仍不是完整 Agent Team
- Multi-Agent 内部闭环按 ADR-0025 推进，模块所有权与 Composition Root 按 ADR-0028 收口；任何变更必须证明不改变 Ordinary 的工具可见性、事件投影、确认语义和首屏文案
- 当前不包含多层递归、child 互聊、team mailbox、Plan 交接、Aboveground Execution Runtime、Governance Pipeline 或 Global Soil 回流
- 普通文件编辑、读写、命令、搜索等动作必须使用朴素命名，不能包装成过重概念

## 当前应如何理解代码

如果你只想知道当前软件“怎么运行”，优先以本文件为准，再看这些正式文档：

1. `docs/开发指南/README.md`
2. `docs/开发指南/00-总览.md`
3. `docs/开发指南/04-模型与契约/09-普通Agent自主运行契约.md`
4. `docs/开发指南/06-工程实现/README.md`
5. `docs/开发指南/06-工程实现/09-普通Agent主干开发指南/README.md`
6. `docs/开发指南/06-工程实现/09-普通Agent主干开发指南/07-兼容路径隔离.md`
7. `docs/开发指南/06-工程实现/11-功能模块边界与组合根.md`

只有在这些文档不足以解释细节时，才需要进入代码。

## 更新规则

出现以下任一变化时，必须先更新本文件：

- 默认用户入口变化
- 默认运行模式变化
- 主执行引擎变化
- 普通 Agent 完成语义变化
- 前后端职责边界变化
- 工具暴露与执行边界变化
- 默认或显式 Agent 集群暴露策略变化

如果代码实现已经变化，但本文件未更新，应视为文档失效，需要先补齐文档再继续演进。
