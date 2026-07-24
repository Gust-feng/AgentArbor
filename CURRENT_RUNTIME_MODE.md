# 当前软件运行方式

本文件是 AgentArbor 当前软件运行方式的唯一根目录说明。后续只要默认运行方式、默认入口、主执行引擎或前后端职责发生稳定变化，都必须同步更新本文件，再更新实现代码与其他开发文档。

## 产品边界与当前实现的区别

当前产品架构以一个 Workbench 和 Ordinary Agent 为主线；Sub-Agent 是 Ordinary Agent 的工具能力。Multi-Agent 的现有源码保留为延期重构参考，不属于当前生产功能。当前事实源是 ADR-0028，延期边界见《Multi-Agent 延期模块边界》。

Multi-Agent 的 Panel UI、Deep DTO 和实现源码暂时保留，以便未来重构复用其中可验证的局部机制；当前 Panel 不装配其 feature、不加载 Deep 历史，也不接受 `/api/deep/*` 请求。该路径统一返回 `410 multi_agent_deferred`，不会创建 provider、ToolCenter、store 或后台运行。

后端只有一个生产组合根：`createPanelRuntime()`。它当前只创建 `OrdinaryAgentFeature` 及其所需的中性资源；`ordinary-routes` 只做 HTTP/SSE 适配。Multi-Agent 的 feature、store、control registry 和资源装配不进入当前生产运行时，也不参与关闭流程。

Ordinary 的生产执行链已经切换为 `request-handler -> ordinary-routes -> OrdinaryAgentFeature -> Agent Session adapter -> Pi AgentHarness/Session -> ToolCenter`。Pi 负责模型-工具循环、Session 分支和压缩；Ordinary feature 负责业务状态、持久化和 read-model 事实。旧 BasicAgent、Desktop session、Panel run job、应用层 Underground、`MinimalRuntime`、旧 conversation/run route、`/api/desktop/runs` 与 `/api/underground/*` 已删除。Panel JSON 输入已在 HTTP 边界使用 Zod 校验；当前尚未完成的是 Workbench/UI surface 隔离。

## 当前默认运行方式

当前 AgentArbor 以桌面普通 `agent` 作为唯一默认运行方式。

- 用户入口：`Desktop Shell / Panel`
- 默认运行模式：`agent`
- 默认执行主线：`用户消息 -> OrdinaryAgentFeature -> Pi AgentHarness/Session -> ToolCenter/命令确认 -> ordinary-run/v5 -> 事实 read-model`
- 默认交互形态：线性会话驱动；用户在同一个 conversation 中一轮接一轮补充上下文、要求和判断
- Multi-Agent 的入口、历史加载和生产 API 已全部停用；`/api/deep/*` 返回 `410 multi_agent_deferred`，保留源码不代表可触发 `deep` run
- `/api/conversations` 是普通 `agent` 的唯一提交入口；旧 `/api/desktop/runs` 已删除
- 当前 Ordinary 通过 Pi provider/model binding 使用冻结的模型协议能力；自定义 OpenAI-compatible endpoint 仍由 provider binding 接入，fake provider 仅供测试。Chat binding 把 DeepSeek、Kimi、GLM、MiniMax 的冻结请求方言映射到 Pi `compat` 与公开 payload hook，并按冻结能力声明视觉输入；动态 API key 每次请求重新解析，清空后不会回退旧 key。普通 Agent 的语义 Skills 路由使用同一 Pi Models/provider binding 的窄无工具通道，并保留现有 JSON 校验与确定性 fallback。仓库通过 pnpm patch 固化 pi-ai 0.80.10 的必要上游补齐：Chat/Responses `stream:false`、refusal diagnostic、Responses hosted output continuation 与 `incomplete_details.reason`、MiniMax 累计 delta 和文本 `reasoning_details`；Responses provider-native Web Search 由冻结 binding 注入 hosted tool，并只在 provider/API/model 相同的 Session 后续轮次回放 opaque output item。provider error、refusal、content filter、输出截断与 context overflow 都形成 Ordinary 可观察失败。Pi 公共消息契约仍不能无损表达普通 file/audio 与 URL/file-id 附件，provider transport 也没有 Host 自定义 fetch 注入口；相关旧 Chat/Responses transport 只作为延期 Multi-Agent 的源码依赖保留，不进入当前生产组合根
- Panel 普通输入栏可选择“当前工作区”作为本轮普通 `agent` 运行的工作根目录；该选择只作为前端会话内的显式覆盖，不写入设置。未选择当前工作区时，新 run 使用设置页保存的工作区作为默认工作区
- `/api/deep/*` 已停用；旧 `/api/underground/*` 已删除。Deep 及其 run-tree 契约仅作为未来重构的代码基础保留

## 当前真实工作方式

### 1. 一个默认 Agent 主循环

当前软件默认只有一个对用户可见的普通 Agent 主循环。它的核心行为是：

1. 装配会话上下文
2. 调用模型
3. 如果模型请求工具，则走后端工具执行与确认边界
4. 把工具结果回传模型
5. 模型不再调用工具且 provider 返回明确完成终态时，形成最终结果

生产实现由 Agent Session adapter 执行上述机械循环。Pi AgentHarness/Session 是 Ordinary 模型上下文、分支、压缩和 provider transport 的事实源；Ordinary feature 只保存 `sessionRef`、entry refs、工具事实、usage、终态和展示 checkpoint。每个工具结果仍必须先由 `OrdinaryAgentFeature` 持久化为 AgentArbor 工具事实，才能作为有界消息回到 Pi Session。确认、取消、provider 失败和进程退出都保留已经发生的完整工具事实，不会从 Panel 展示文本反向恢复模型上下文。Pi 的事件只通过 adapter 映射为 Ordinary live activity，不能直接写业务终态；Ordinary 的模型协议、动态 API key 和窄语义 Skills 路由由同一 Pi provider binding 负责。延期 Multi-Agent 源码不参与当前 provider 或业务 owner 决策。

这意味着：

- 默认普通 Agent 是线性会话助手，不维护独立任务生命周期、任务拆解状态、完成标准状态机或 Plan 交接对象
- 默认普通路径中的 Task Soil 只是本轮会话输入、上下文引用、权限边界和运行材料的上下文包，不负责驱动任务状态推进
- “模型不再调用工具”且 provider 返回明确完成终态，才表示本轮普通 Agent 正常完成
- 工具调用、确认等待、工具失败后继续判断，都是普通运行的一部分
- 一次性命令使用 `Shell` 并绑定当前 run；后台命令使用 `Shell(background=true)`，默认以 `workspace_session` 生命周期登记到 Host-owned `ProcessRegistry`，返回稳定 `processId`、运行状态、端口事实和 `command-log://` 引用。后续由 `ProcessRead` 查询、`ProcessStop` 按稳定身份停止；run release 只清理 `lifetime: "run"`，Panel runtime 关闭时先停止进程注册，再清理所有仍未结束的 owned 前台/后台进程，因此 `workspace_session` 只跨 run 存活、不跨应用存活。
- 用户取消由 Ordinary feature 先提交为持久化终态，并立即停止该 run 的新输出与新工具调度；provider transport、live continuation 和其他运行资源随后由原 owner 在后台释放，取消接口与下一条消息不能等待不响应取消的底层 Promise。若取消时没有已接受但结果未定的工具轮，后续消息可以在旧执行资源仍在清理时启动；已有在途工具事实时仍须先完成结果收口，不能越过副作用未知边界
- Ordinary 会定期把已经流式展示的 assistant 正文保存为 `visibleAssistantText`。它只用于取消或进程退出后的视图恢复，不是 completed 回答，也不写入 Pi Session。主动取消后，Panel 保留已有正文和真实工具过程；没有正文或过程时不生成 assistant 占位，也不显示“已取消”卡片或内部原因
- 软件退出或进程异常结束后，live-only continuation 不会伪恢复。重新进入会话时，Panel 恢复退出前已保存的正文、工具事实和 Session 位置，不显示 continuation、runtime 或进程重启错误；用户只能追加新消息，或回退到 Pi Session 的历史 leaf 创建新分支
- `runtimeHome` 是单写者边界。同一运行目录同时只能由一个 Panel/Electron 后端持有；第二个实例必须拒绝启动，不能因端口不同或开发 watch 重启而改写另一个实例的 Ordinary 运行态
- `provider` 失败、网络失败、上下文维护失败、进程失败都不是正常完成
- provider 404、超时、失败或流式断开若不能安全重试，会永久结束当前模型调用。Ordinary 的认证解析、provider transport 和语义 Skills 路由由 Pi provider binding 负责，Ordinary adapter 不复制 provider client 或重试器。一旦出现 provider 事件、用户可见增量或工具调用事实就不得拼接多个 attempt。无法安全重试时，用户只能追加新消息创建新 run，或回退到历史 Session leaf 创建新分支
- `out_of_fuel` 与 `context_overflow` 必须投影为 `blocked` / `paused`，不能被包装成 `completed`
- 默认普通 Agent 当前不设置固定模型/工具轮次上限；若未来某个普通 Agent 需要轮次边界，必须由 `AgentDefinition.turnPolicy` 显式冻结并进入 run ref，而不是由前端、route helper 或临时执行参数私自决定
- 普通主循环消费的 `AgentDefinition.turnPolicy.purpose` 必须是 `desktop_agent`；Ordinary 不再读取或回放历史 `desktop_chat` / `work_session_*` purpose，它们不能成为普通 AgentDefinition 或普通主循环的执行定义

### 2. 延期的 Agent 集群参考实现

`src/app/deep/`、`deep-routes.ts` 和关联 Panel 模块保留历史实现与测试，供未来重构筛选可复用机制。当前生产组合根不创建 `MultiAgentFeature`，主路由不调用 Deep route adapter，下面的内容只说明保留源码的原有行为，不能被解释为当前可用功能。

- 编排边界：`DeepRunExecutor` 维持 manager 动作循环（`direct_answer / spawn_children / wait_children / continue_child / synthesize / ask_user / stop`），其中 `spawn_children` 会把 child 放入 `DeepTaskBoard` 后经 `DeepChildScheduler` 真实并发启动；`wait_children` 会真实等待在途 child；`continue_child` 表示父层审查或操作已有 child，并给同一个 child run 追加指令继续标准 Agent loop；若目标 child 仍是 `pending / running`，追加指令先进入 scheduler FIFO 队列，等当前 child loop 到达材料边界后以同一 `childRunId` 续跑，不抢占当前模型/工具调用；`synthesize` 前会先启动并等待 pending / running child 清场，且只在已有 child 材料时由父层综合产出 `SynthesizedConclusion`。
- 当前协作边界：只允许 manager + 一层 child（`depth = 1`）；child 由 `DeepChildAgentRunner` 作为显式 child Agent run 执行，父 Agent 派生 `DeepChildSpec`（目标、角色、工具授权、可选轮次预算），派生时把父层生成的 objective 冻结到 child `AgentSpec.instructions` 作为 run 出生事实。child 调用中性的 `AgentTurnRuntime.execute(input, semantics)`，由 Multi-Agent 自己选择 final-output-only 投影，再经 ToolCenter 与 Confirmation Gate 完成标准模型-工具-模型循环。模型、基础工具、Research 与 MCP 由唯一后端 Composition Root 通过中性工厂和 contribution 装配；Multi-Agent 不复用 Ordinary 实现，`/api/deep/*` 也不创建 provider、ToolCenter、store 或 runtime。child 未显式设置 `maxModelRounds / maxToolRounds` 时默认各 200 轮，显式更小值保留，超过 200 时钳制到 200；轮次边界只作失控保护，耗尽后进入未完成状态，不能替父 Agent 判断任务已经完成。child 模型请求不写入固定输出/延迟预算。child 若遇到 `approval_required`、`out_of_fuel` 或 `context_overflow`，会进入 `blocked` child run，而不是误报 failed；child 自身中断或异常停止会进入 `interrupted` child run，不再被任务板误投影为 completed。
- 子 Agent 可续跑边界：`approval_required` 会在 `ChildAgentRun.pendingApproval` 中保留安全确认投影（confirmationId、tool call、工具名、动作摘要、影响资源、风险等级、恢复可用性和 source refs），不保存 raw prompt、raw response、工具原始输出或完整 tool loop；运行进程内同时保留 runtime-only continuation，确认决策可通过 `POST /api/deep/runs/:runId/children/:childRunId/confirmations/:confirmationId/decision` 恢复同一个 child 标准 loop。父层既可以在 manager 决策中通过 `continue_child` 操作同一个 child run，也可以通过 `POST /api/deep/runs/:runId/children/:childRunId/messages` 给已有 child 追加继续指令，使异常停止、受阻或材料不足后的同一个 child 继续工作；运行中 child 的追加会先排队；已完成/失败/blocked/interrupted child 只有在进入可审查材料/持久化投影后，才由 live scheduler 的即时继续能力恢复同一个 child loop。只有 scheduler 对排队或即时继续都明确拒绝时，路由才返回明确 409/404，不能绕过 scheduler 另起恢复路径。这两类继续都会在 `AgentRunTree.delegationDecisions` 中记录 `resume_child` 和真实 `childRunId`，并更新 child 投影。manager 选择终态动作后，由 `DeepRunExecutor` 统一关闭新的 child control 准入并吸收已经获准的 continuation：`synthesize` 会启动并等待全部 pending/running child，`direct_answer / ask_user / stop` 会取消未启动 child 和尚未执行的父层追加指令、等待 running child 自然收尾，再冻结终态材料；step-limit 和异常出口也不会遗留 pending child。`DeepRuntime` 只持久化和投影 executor 的最终事实，不再二次加工 child 状态。终态后由控制 API 新产生的 child 材料只刷新该 child 材料和审计链，不自动重写已完成的父层综合结论；如果已存在结论，后端会把 `liveProjection.synthesis.status` 标为 `pending` 并高亮综合节点，表示当前结论落后于最新 child 材料。后续若需要把新材料纳入最终结论，必须通过 `POST /api/deep/runs/:runId/resynthesize` 显式触发父层重新综合，由父层基于当前 child 材料再产出新的 synthesis 与 conclusion，重新综合事件会安全引用参与审查的 `child_run`。同一 conversation 的重叠确认由 command FIFO 串行，工具不会重复执行；内部 continuation 被预留或已知结果仍待补写时，守卫会返回 `confirmation_in_progress`。只有模型/工具执行结果本身确实无法确定时才返回 `confirmation_outcome_unknown` 并禁止自动重放。已知执行结果若仅 context 或 run projection 持久化失败，后续只补写该事实，不重新执行模型或工具；无法持久化的协议 continuation 会形成保留执行事实的 failed child，不伪装 completed。若进程重启导致 confirmation continuation 丢失，后端返回明确 409，不伪造恢复。外部 stop / interrupt 仍可收口。当前已具备真实并发 child、真实 `wait_children`、父层审查后继续同一个 child、单 child 失败隔离、parent synthesize；外部 `stop / interrupt` 与模型主动 `stop` 复用同一停止收口语义：取消 pending、清空尚未执行的父层追加指令、保留已完成/受阻/中断材料、等待或保留 running child 当前 loop 自然收尾后的材料，并尝试部分综合，但不再触发继续探索。
- Multi-Agent runtime-only child continuation 由 feature 统一保留，默认 TTL 为 24 小时、全局最多 256 项、单 run 最多 16 项；run 终态只保留最终 run tree 仍标记 `pendingApproval` 的 child，其余立即清理。过期、容量淘汰、会话删除或进程重启导致确认上下文丢失时，接口返回明确 409，不伪造恢复。
- child 父层续跑只有在上下文准备完成后、真正进入模型/工具 loop 前，才尝试写入带稳定 `instructionId / messageRef` 的 durable queued marker；任一步失败都不启动模型。已经进入 live scheduler 的 queued 指令若准入失败会收口为 `cancelled`；post-terminal 直接续跑若在 marker 成功前失败，则不创建指令记录。marker 成功后，只有 child loop 已返回确定结果才记为 `executed`，无法判断执行结果的异常继续保留 `queued`。模型/工具结果已经确定但 child 主投影写失败时，feature 在当前进程保留该结果，后续 child 命令、follow-up、parent run 启动或重新综合只补写投影，不重新执行 child。若进程在结果投影前退出，只剩 queued marker 或持久化 `pendingApproval` 而 live continuation 已丢失，后端返回 `child_instruction_outcome_unknown` 或 `confirmation_continuation_lost`；同一 child 的新指令、重新综合，以及显式依赖该旧 run 的 intake、parent run 启动和 follow-up 都不能绕过未对账事实，独立新任务不受影响。这是明确的 fail-closed 恢复边界，不宣称跨进程 exactly-once 或伪造可恢复 continuation。
- `DeepRunExecutor` 是终态 child 材料的唯一收口 owner；完整 final tree、report、conclusion 与 liveProjection 已形成后，最后一次 run record 写入失败会携带整份 final record 进入同进程机械重试，不再用较早的空 report/live snapshot 覆盖为失败。child-message sidecar 和资源 cleanup 失败只进入后台诊断，不覆盖已知 executor/model/tool 结果；主失败与 cleanup 同时发生时分别报告，cleanup 不能替换主失败。
- 运行中单一事实源：每个 Agent 集群 run 都创建 manager-owned `DeepTaskBoard`；运行中的 child 状态、任务板相位与研究 brief 先进入 board / record，再由 `liveProjectionFromBoard(...)` 派生 `liveProjection.children` 与展示相位；父层追加 child 指令时，scheduler 只把 instructionId / messageRef / 排队数量 / 状态这类安全短事实叠加到对应 `liveProjection.children[].parentOperation`，不把 raw 指令正文放进默认流程投影；`deep.child.started / instruction_queued / completed / blocked / interrupted / failed` 事件也在 scheduler 生命周期回调处实时发布。最终 `AgentRunTree` 只记录真实启动并形成 `ChildAgentRun` 的 child，其状态与 board 中对应任务对齐；从未启动就取消的计划任务只保留在 TaskBoard 与 `liveProjection` 的取消工作流事实中，不伪造 child run，spawn delegation 的 `childRunIds` 也不得留下无法在 tree 解析的引用。有 `runtimeHome` 时，deep conversation 写入 `deep-conversations/`，deep run record 写入 `deep-runs/<runId>/record.json`，父子 raw 消息写入 `deep-runs/<runId>/child-messages/<messageRef>.json`，与普通 conversation / run 物理隔离；run record 持久化本次 `aiMode` 与冻结能力快照，使进程重启后仍能读取同一 run tree，并在用户追加消息时基于持久化 childRun 继续同一个 child loop。
- 当前 UI / 投影路径：executor 首次 `spawn_children` 后装配 `DeepResearchBrief`；Panel 主界面不提供“桌面 Agent / 多 Agent”顶部切换，默认始终进入普通桌面 Agent。当前 release availability 关闭 Agent 集群产品入口，设置开关与侧栏按钮均不渲染，启动期也不加载 Deep conversation / run 历史；内部 Multi-Agent surface、controller 与 `/api/deep/*` 路径继续保留，重新开放前需完成统一 Workbench 的单次“深入协作”入口和 surface 隔离验收。Agent 集群界面已有接近普通 Agent 的聊天态投影：用户看到助手回复、动态协作进展、探索结果、综合结论，不默认暴露“父 Agent / 子 Agent”、runId、API path、raw event type 或固定阶段编排；完整 eventSequence、run tree、确认恢复和长材料只按需折叠在“协作记录”中。内部输入语义按状态分流：无 active run 或 active run 已终态时，提交先进入 `POST /api/deep/intake`，由模型判断 `ask_user / direct_answer / start_collaboration`；`ask_user` 与 `direct_answer` 只写入 `DeepConversation.intakeTurns` 并展示自然助手消息，不创建协作 run、不显示协作进展；只有 `start_collaboration` 才启动后台 deep run。后端 read-model 经 `DeepRunRecordStore` 持久化，由 `/api/deep/runs/:id/events` 作为 SSE 即时触发信号，再拉取 `/api/deep/runs/:id/view` 获取权威 run 快照与 conversation 投影；前端不从 SSE 自行重建 child 事实。
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
- 前端点击普通 run 取消后，只在本地立即收起运行控件并停止当前观察连接，不展示“正在取消”、runtime 重建、transport 关闭或资源清理等内部提示；取消前已经显示的模型正文继续保留，但不冒充 completed 正式回答。后端取消响应到达后直接消费其持久化 run 终态，再在后台读取完整 conversation 投影。运行中已经追加到输入队列的用户消息不得因取消而清空，并在取消终态不需要用户处理时自动成为下一轮输入
- 当前 Panel 前端通过 `/api/conversations` 提交普通运行，通过 `/api/basic-agent/runs/:id/view` 与 `/stream` 读取同一 Ordinary read-model；`/api/desktop/runs`、无生产客户端的 work-session route 及 `workSession` 响应别名均已删除
- 历史运行和恢复只读取 `OrdinaryRunState`：run 出生事实、status、Session phase、工具事实、usage 与 timeline 在同一 snapshot 中提交；conversation control 只保存 Session ref、标题、置顶和删除事实。WorkView、Panel conversation 和 SSE 都是单向展示投影，不能反向拼装模型历史
- Ordinary 使用 `ordinary-run/v5` snapshot：每个 run 原子写入 `runtime/ordinary-agent/runs/<runId>/snapshot.json`，列表 manifest 只是可重建索引；conversation control 使用独立的 `ordinary-conversation/v2` 文档。旧 RuntimeDatabase、raw `run.json`、sidecar event/tool-call 和旧 schema 均不读取、不迁移、不双写
- Ordinary live 状态只由 `OrdinaryAgentFeature` 拥有的 run status 决定；正式回答、当前确认和工具业务事实属于 Ordinary，模型 transcript 与 active leaf 属于 Pi Session，Ordinary snapshot 只保存稳定 Session/entry ref。Panel 只消费 read-model，额外 title/summary/preview 可以有界压缩，但不能覆盖正式回答或模型可继续使用的工具事实
- 普通 `agent` run 的 live model stream 只接受 `desktop_agent` 的用户可见模型增量；`desktop_chat`、`work_session_*` purpose、`desktop.chat.*` 输出契约和旧 read-model alias 已清除，不读取旧本地记录

前端不是 Agent 引擎，也不负责推导任务状态、补全工具语义或重建运行事实。

### 4. 工具属于后端设施能力

当前工具能力属于后端设施，不属于前端，也不属于 prompt 自由扩展范围。

- Panel HTTP JSON 输入统一在 adapter 边界用 Zod 从 `unknown` 解析；feature 不读取未校验请求对象，也不保留 v1/v2 兼容 parser
- `edit` 使用 `diff` 生成唯一 canonical unified diff；执行结果、模型事实和展示投影不能各自重建不同补丁
- XLSX 附件由 `read-excel-file` 解析，PDF 文本由 `unpdf` 内置的 PDF.js 逐页提取；两者保留文件大小、取消和有界返回规则，不维护手写 Office/PDF 解析器，不引入 canvas 或原生渲染依赖
- Panel 的普通服务端数据可以使用 TanStack Query，但当前仅用于使用统计；`retry: false` 且请求接收 `AbortSignal`。Ordinary/Deep 的 active run、SSE、cursor、busy 和 confirmation 仍由各自 feature/controller 拥有，不进入 Query cache 或全局 `AppState`
- 工程决定本轮 Agent 能看见哪些工具
- 当前默认普通 `agent` 的工具可见性由后端结构化能力快照与 `AgentDefinition.toolVisibilityProfile` 共同裁剪，不再依赖工具名前缀约定
- 普通 `agent` 只有在后端已经冻结 `capabilitySnapshot` 后，才会把工具暴露给模型；裸 `ToolCenter` 只负责执行，不再单独决定模型可见工具
- 工具只有一份模型契约：canonical name、客观 description 和完整 input schema；适用边界写进 description，参数约束写进 schema，不再维护平行 `modelContract`。运行创建时冻结完整 definitions，provider 始终消费这份冻结定义，live ToolCenter/gateway 只提供执行；definition hash 覆盖 description、输入/输出 schema 和执行元数据，缺 schema、缺 hash 或与当前 executor 不一致的旧快照直接失效。结果与 continuation 只通过实际 `ToolCallResult` 表达，Panel/read-model 自行从事实派生展示
- 内置工具 canonical name 使用 lowercase snake_case；默认工作区高频工具为 `read / write / create / edit / delete / list / grep / shell`。`shell` 表示当前配置 shell，不能因参考 Claude Code 而误命名为 `bash`。专用工具使用 `research_* / web_* / attachment_* / process_* / agent_* / mcp_*` 前缀避免全局冲突；不读取旧名称 alias
- `ToolCenter` 只执行工具、权限/策略校验与命令确认，并返回 `ToolCallResult` 执行事实；不保存逐 run 调用计数或预算，不生成模型消息、UI display、envelope 或持久化投影。轮次/预算由 Agent loop 决策，模型、事件和 Panel 分别从同一事实单向派生自己的消费视图
- 新写入的工具 lifecycle event payload 是唯一可重放工具事实：requested 保存一次 input，终态保存有界 output/error/duration 并保留 continuation；`RuntimeToolCallRecord` 只保留 callId、终态、错误、引用和时间索引，不复制 input/output。live 与 replay 从同一 reducer 消费该 payload。旧 `projection / envelope / display` 记录不再读取或迁移，旧 snapshot 不满足新契约时属于开发期失效数据
- 工具 input/output 只接受 JSON-safe `ToolFactValue`；模型 `ToolResult` 正文在 `none / text / json` 中三选一，同一完整 output 不再同时写入文本和结构化字段。工具消息协议已有的 call id/name 不在正文重复，附件字节只走带外模型输入
- 通用 ToolCenter/kernel 只读取工具输出顶层 `continuation / continuations`。MCP 规范没有通用工具结果 continuation，因此 MCP adapter 不再按 `structuredContent.continuation / continuations` 的字段形状猜测分页或提升可执行 `nextInput`；`structuredContent` 原样作为服务端事实保留。只有拥有明确分页或稳定引用契约的 producer/adapter 才返回 canonical continuation。`read / list / grep` 自身返回有界事实和 `nextStartChar / nextStartLine / nextOffset`；模型需要更多内容时，把下一位置值映射回 `startChar / startLine / offset` 再次调用原工具，不构造额外的通用续读工具。真实 offset ceiling 或副作用请求无法安全重放时，必须返回明确失败事实，不得返回 `completed + truncated` 的死引用，也不得生成会重放 POST/PUT/DELETE 的 synthetic continuation
- ToolCenter 对每个模型可见工具结果使用不随模型上下文窗口变化的固定 token 边界：正文预览目标为 4,000 tokens，完整工具结果包络硬上限为 6,000 tokens；18 万字符边界只作为未注入 tokenizer 的兼容兜底，不设置单轮工具数量或并行结果总量上限。超过边界时，ToolCenter 使用每个 PanelRuntime 唯一、Host-owned 的文件系统持久化 `ToolOutputStore` 保存当前完整文本或序列化 JSON。结果返回有界预览、opaque `tool-output://` 引用和 `read_output` 的下一段输入，并保留带外附件；显式 failed/cancelled 的超大 output、error 与 errorFacts 作为一份完整失败证据保存。父 run 必须冻结并授权 reader，Deep child / Sub-Agent 在真实 broker 也具备 reader 时把它作为 transport companion 自动继承，不扩张其他业务工具。读取不会重新执行原工具；`read_output` 使用同一 4,000/6,000 token 边界，以 UTF-16 code-unit offset 按实际包络动态缩小当前页，避免长 provider call id 或高转义正文造成二次截断与偏移跳跃；窗口不得拆分 surrogate pair，最后一段读完只释放 live-only 测试存储的 ref，持久化证据继续保留用于审计。持久化 evidence 不设置 TTL，也不静默淘汰旧证据；Host 默认允许单项最多 256 MiB、总计最多 4 GiB、最多 10,000 项，达到边界时以 `tool_output_item_too_large` / `tool_output_capacity_exceeded` 明确失败。Ordinary 引用在所属 conversation 删除前保留；Deep run 为 post-terminal child continuation 保留稳定 owner，在删除所属 Multi-Agent conversation 时回收；Panel 关闭只等待在途写入完成，不删除持久化证据。首次读取仍校验完整 SHA-256，进程内对未发生文件变化的已验证正文使用 64 MiB LRU 读取缓存，避免分页时重复整文件读取和哈希。模型附件字节只服务当前 provider 请求，不进入 Deep child 持久化上下文；为保证 OpenAI Responses 的跨轮 reasoning/function-call 恢复，Deep 只对白名单 `openai_responses_output_items` 做 JSON-safe 验证并原样保留有效 output items。已知该 key 但内容无效或为空时，Deep child context persistence 以稳定错误 `model_protocol_continuation_not_persistable` 明确失败，不能静默丢弃后声称可恢复；其他未知 protocol extension key 仍忽略。`tool-output://` 引用元数据随工具事实持久化并携带 `continuationAvailability: "durable"`；完整内容、UTF-8 byte length 与 SHA-256 写入 `runtime/tool-evidence/`，不复制进 run snapshot，进程重启后同一 ref 仍可读取。磁盘写入、容量拒绝或完整性校验失败时返回明确 delivery failure；原 failed/cancelled/approval 状态、错误域、错误码和确认请求必须保留，只有原 completed 结果因无法完整交付而转为 failed
- Ordinary 不限制模型在同一轮选择多少工具，也不设置同批结果总预算；同一 assistant turn 返回的 AgentTool 调用统一声明为 `parallel` 并由 Pi 并发执行。调用之间若有数据依赖，模型必须在下一 turn 根据前一批结果再发出后续调用；AgentArbor 不按工具名、读写分类或命令内容替模型推断依赖，也不维护 Agent 级 FIFO/写屏障调度器。文件 adapter 自己守住机械一致性：Host 对同一规范路径的 `Write` / `Edit` 使用短 FIFO，不同路径继续并行；同一 run 的连续精确 `Edit` 基于前次成功写入后的最新内容组合，重叠替换明确失败，其他 run 或外部修改通过实际内容 hash 拒绝。每个调用仍独立经过 schema、冻结授权、确认、取消和结果交付；完成事件可以按真实完成顺序出现，交给下一次模型请求的 tool result message 保持 assistant source order。Deep 保留自己的批执行规则，MCP 每 server 4 并发和 Research 内部 4 并发仍只是 producer 资源边界。
- `read / list / grep` 使用当前模型 tokenizer 在 producer 端缩小正文或集合页，正常页优先保持在 6,000-token 完整包络内，不借 ToolOutputStore 保存分页状态。HTTP GET 与 `web_fetch` 在 Host store 可用时保留一次响应/页面快照，后续 continuation 从同一 opaque snapshot ref 读取，不重新请求或导航；副作用 HTTP 请求仍禁止透明重放。
- Ordinary run 在线聚合工具定义、执行结果、retained、continuation 和调度指标，只保存 token/字符/字节计数、固定 histogram、状态、原因、耗时和 definition hash，不保存路径、URL、命令、headers 或正文。终态聚合进入可选 `ordinary-run/v5.toolMetrics`；旧 snapshot 不读取。`/api/runtime/usage-statistics` 与设置统计页从 run snapshot 合并分位数，指标采集失败不得改变工具事实。
- `research_read` 的数组输入是单个工具内部的 producer 扇出，不是普通 Agent 工具轮次或并行工具总量：单批最多 16 个 ref、同时最多读取 4 个；普通 per-ref 失败继续形成 partial facts，取消会停止调度新读取并作为整次工具取消向外传播。Search ref 映射只存在于当前 Research runtime，支持模型在本轮内回读较早结果，并在本轮结束后随 runtime 一起释放。
- `skill_read` 对 reference、asset 和 script 使用流式文件读取；完整 SHA-256 与 byte/char facts 仍按全文件计算，但内存只保留请求的 reference 字符窗口，取消会终止文件流。
- 命令日志继续为 stdout/stderr continuation 提供真实文件；活跃进程日志不会被维护任务删除，非活跃日志超过 7 天会清理，非活跃集合超过 512 MiB 时按最旧优先回收。仍在运行且持续产生输出的单个后台进程不做静默截断；其磁盘增长受宿主可用空间约束。
- MCP adapter 只保留服务端 `content[]` 与可选 JSON 对象 `structuredContent` 的单份语义事实，不生成 `summary / mcpResult / result` 多份包装；外部 `structuredContent` 不是 JSON 对象或不满足 JSON-safe 边界时明确失败。只对“text 可解析 JSON 且与 structuredContent 深度完全相等”的精确镜像做无损去重，其他内容完整保留；`isError=true` 成为正式工具失败。图片、音频和非图片 embedded resource blob 分别转成带外 `image / audio / file` 类型的 `ModelInputAttachment`，JSON 只保留 MIME、文件名/URI、byteLength 和附件索引；单个 MCP 结果当前最多 16 个模型附件、单附件最多 20 MiB、合计最多 32 MiB。附件预算或结果归一化在远端调用返回后失败时，必须作为 post-execution delivery failure 保留真实 `sourceExecutionStatus` 与 `doNotBlindlyRetry`，不能声称远端未执行或诱导盲目重试。Ordinary 的 Pi AgentTool transport 当前只无损承载 inline image：图片字节可进入紧接的 provider 请求，但 Pi Session 只保存占位文本；tool-origin file/audio 或 URL/file-id image 会形成 `tool_result_attachment_not_supported`，保留来源执行状态并禁止盲目重试，不会静默丢弃。共享旧 transport 仍保持原有协议边界：OpenAI-compatible Chat Completions 只映射原始 user 消息中的 image、inline/file-id file 与内联 wav/mp3 `input_audio`；tool-origin 二进制附件必须明确 `request_validation`，不得改变来源角色；OpenAI Responses 支持 user/tool-origin image 与 file，内联 file 使用官方 `data:<mime>;base64,<data>`，但当前拒绝 user/tool-origin audio；对 inline file_data 和携带 byteLength 的 file_id/file_url，发送前执行单文件小于 50 MB、整份请求文件合计不超过 50 MB 的校验，未知远端文件大小仍由 provider 最终校验；其他无法由 provider 协议消费的媒体同样必须形成可观察失败，不能伪装成普通 file 或静默丢弃
- Agent loop 对并行批次中的动态 `approval_required` 仍会暂停对应调用；同批其他独立调用不因一个调用等待确认而被工程层改成串行。等待确认、deny/guidance、多阶段再次确认或取消时，确认前正文、附件、错误和可执行 continuation 都保留给模型。用户 guidance 不做固定 1,000 字截断；pending call/confirmation 身份不一致时 fail closed，不能执行工具
- Pi Session 保存模型实际消费的消息、工具协议组、活动 leaf 与 compaction entries；Ordinary snapshot 只保存 Session ref/entry ref，不复制 transcript。每次请求前的上下文窗口保护、压缩和 provider continuation 由 Pi AgentHarness/Session 负责，压缩不得拆开未完成的工具协议组；失败、blocked 或取消的业务状态仍由 Ordinary feature 记录
- Pi provider/model binding 负责稳定前缀、协议 continuation、prompt cache、动态 API key 解析和 provider 方言；配置只保存自定义 OpenAI-compatible provider 及用户选择的模型能力覆盖，不维护第二套 provider credential 或认证操作状态。普通运行 API、conversation 投影和 SSE 不返回 Pi 私有 Session entries 或 continuation。Panel 只展示单向投影，但不得用摘要替换正式回答和工具结果
- Panel 的工具生命周期投影使用 `tool.requested / tool.completed / tool.failed / tool.cancelled`，确认等待使用 `user_approval.requested`。Ordinary 的 `tool.requested` 与 `tool.progress` 都是 live-only 活动；真正持久化并参与重启重放的工具事实仍是终态 `ToolCallResult`。当前命令工具只上报有界 stdout/stderr 尾部与累计字符数；进度不写入 snapshot、不替代终态结果，也不能影响执行结果。Ordinary SSE 使用 heartbeat 保持连接可观察，Panel 同时做低频增量对账，并在流静默后自动降级轮询，不能依赖切换 conversation 才补齐活动
- Ordinary SSE 对相邻文本 delta 做 16ms 短窗口合并，完整帧串行写入；`response.write()` 返回 false 时等待 `drain`，单连接积压超过 256 帧时只关闭观察连接，不取消 Agent。权威状态仍由 run snapshot/view 与 cursor 对账提供
- Panel 关闭会在首个异步清理前同步停止 Ordinary 新工作准入并请求停止现有 run；等待在途 HTTP 请求最多 1 秒后使用 Node `closeAllConnections()` 终止卡住的连接，整个运行资源清理另有 30 秒 Host hard deadline。若 provider 或其他在途 operation 不响应取消，关闭返回明确 `panel_shutdown_timeout`，桌面宿主可继续退出而不会永久挂起；关闭期间新 Ordinary 请求返回 `panel_runtime_quiescing`
- 普通 `agent` 的本轮模型配置事实来自 run 创建时冻结的 `capabilitySnapshot.activeModel`；执行、持久化、恢复和用户可见 read-model 不能再用当前全局模型配置覆盖它
- 普通 `agent` 的本轮模型能力事实来自 run 创建时冻结的 `capabilitySnapshot.modelCapabilities`；直接调用参数里的临时 `modelCapabilities` 只能服务没有冻结快照的测试或兼容调用，不能覆盖已创建 run 的上下文窗口、输出预算、工具调用能力或流式能力
- 普通 `agent` 的附件读图工具只在本轮模型能力支持视觉输入时进入可用工具集合；工具读取的图片字节只作为临时 `ModelMessage.attachments` 进入下一轮模型请求，不进入事件、run record 或 Panel read-model，工具 JSON 结果只保留图片元数据和本轮模型输入状态
- 普通 `agent` 的本轮工作区事实来自 run 创建时冻结的 `capabilitySnapshot.workspace`；请求显式传入的当前工作区只影响该 run 的工作根目录，不能回写或覆盖设置页保存的默认工作区
- 普通 `agent` 在请求未显式指定 `aiMode` 时，默认 `aiMode` 也从本轮 `capabilitySnapshot.activeModel.defaultAiMode` 派生；入口层不得为了默认值提前读取当前全局模型配置
- 普通 `agent` 执行阶段只能消费 run 创建时冻结的 `capabilitySnapshot`；执行资源不得在运行中重新向 `CapabilityCenter` 获取当前快照来替代本轮事实
- 普通 `agent` 的本轮 ToolCenter 执行器全集也必须从 `capabilitySnapshot.toolCatalog.tools` 派生；当前代码新增、删除或启停工具只能影响新 run，不能扩张已创建 run 的可执行工具集合
- 普通 `agent` 的技能可见与触发集合也来自 run 创建时冻结的 `capabilitySnapshot.skillCatalog`；执行期间的当前 skill 启停状态只影响新 run，不改写已创建 run
- 普通 `agent` 默认发现用户级 `$HOME/.agents/skills` 和项目级 `$WORKSPACE/.agents/skills`；设置页使用当前配置工作区，本轮普通 run 使用 run 创建时冻结的工作区，未显式提供工作区时才落到默认配置工作区。项目级 skill 具有更高 precedence。宿主可通过显式 `additionalSkillRoots` 接入 admin/plugin 等受管来源，但这只是显式来源挂载，不是 marketplace、installer、自动更新或回滚机制；默认不自动扫描 managed marketplace。来源层级、root id 和 precedence 会进入冻结 skill catalog 与 run capability 投影；默认显式/关键词选择只使用安全 metadata，不暴露绝对路径；显式 opt-in 的模型路由同样只能看到安全来源 metadata
- 普通 `agent` 的 skill 启停和 `markUsed` 状态只使用 source-qualified `stateKey` 的 v2 文件；旧 `skillId`、旧版本或损坏状态直接视为空状态，不迁移、不回退
- 普通 `agent` 的默认 skill 选择采用 progressive disclosure：基于本轮 frozen skill catalog 做确定性显式/关键词选择，显式 `$skill` 直接选择，关键词或触发器命中才加载正文；默认不发起 `skill_routing` 前置模型请求，也不把全量 skill 候选发给模型。设置页“基础能力 -> Skills 触发方式”可显式切换为“语义路由”；只有该设置冻结到新 run 的 `capabilitySnapshot.skillTrigger.mode = "model"` 时，普通 Agent 才会在主请求前额外发起 `purpose: "skill_routing"` 的模型路由请求。该请求只使用 Pi 的无工具文本/JSON 通道；不符合窄契约时由现有 Skills fallback 处理，不把共享 Multi-Agent 通道强行切换到 Pi
- 普通 `agent` 只在 skill 被本轮选中后读取 `SKILL.md` 正文，并校验 run 创建时冻结的正文 hash；hash 不一致时 fail closed，不注入正文
- 普通 `agent` 只允许本轮已选中且成功加载的 skill 通过 `skill_read` 按需读取 indexed `references`、`assets` 和 `scripts`；该 companion 只能在模型 loop 前的客观 boundary resolution 中，从本轮 frozen tool catalog、冻结 Skill resource index 和真实 executor 激活，不能由 Skill 声明、模型可见性或运行中状态从 catalog 外扩张授权。reference 内容作为工具结果回到模型，assets/scripts 不返回 raw body，scripts 不自动执行
- skill `evals/` 只作为 loader/doctor 的本地质量评估 artifact 被发现、索引和统计；它不是运行时资源，不进入 frozen runtime resource index，也不能通过 `skill_read` 读取或注入模型输入。当前 doctor 默认做确定性 JSON 结构、case 数、routing 断言、quality/regression 的 `qualityBaseline` with/without skill 记录和字面量质量检查；显式传入模型通道时可通过 `skill_routing` 跑 routing eval，但仍不自动生成 with/without 输出、不调用 LLM judge、不评估运行时真实回答质量
- skill `allowed-tools` 当前只作为冻结和审计声明处理：不能扩张工具，不能隐藏普通 `agent` 原本可见的工具，也不是 Claude Code 风格免确认授权；未来若做 skill 级免确认授权，必须新增 per-tool grant 契约
- MCP 当前进入配置目录、能力快照的 `mcpCatalog`、能力草案投影和普通 `agent` 默认工具边界；只有服务已启用且配置完整、缓存定义已进入本轮冻结快照、惰性 executor 已装配并通过 `AgentDefinition.toolVisibilityProfile` 的 MCP 工具，才会进入本轮模型可见和可执行边界。MCP 在真正执行远端工具时才连接，catalog 与渐进曝光不要求预连接
- MCP 工具定义、执行授权和确认是三层独立边界：模型 loop 开始前解析并冻结最终可执行名称与确认策略，模型请求只消费 Pi 当前 active tool set。core 工具常驻；只有冻结 `protocolProfileId === "openai"`、模型 tokenizer 精确匹配、上下文窗口有效，且真实冻结 MCP 定义达到成本门控并在加入控制工具后仍有净节省时，长尾定义才通过 `mcp_search` / `mcp_load` 渐进曝光。加载只改变下一次请求的模型可见定义，不连接服务器、不执行工具、不扩张权限；任何成本不确定性都回退完整定义。本轮 MCP visibility plan 只依据冻结 catalog 与真实协议序列化成本，不按 provider/model 名猜测 native tool search
- Pi run-local active tool set 与 durable Session 分离：active set 由当前 AgentHarness 管理；activation marker 只服务产生它的 live 工具轮。durable Session 可以保留已消费 marker 作为 transcript，但新 root/delegated run 会重新应用冻结 boundary、重置 initial active set，并从本次模型上下文移除历史 `addedToolNames`；文件系统对账不从公开工具输出重建 marker。完整工具结果继续保留并按既有 evidence/read 机制续读；Pi 缺失 canonical 结果的 immediate failure 归一化为标准 ToolCallResult，保留原始文本并按取消、执行失败或 schema/runtime 拒绝标记不可盲目重试
- MCP 的 `enabledTools / autoApprovedTools` 保存远端协议原始方法名；MCP catalog 显式同时携带原始 `protocolName` 和模型可见 canonical `name`。二者只在 catalog 装配时建立映射，Panel、配置和远端 executor 不从 canonical name 反推协议名，Ordinary 工具事实也不保存第二套别名
- MCP 同步工具调用使用官方 SDK 的 `AbortSignal`、progress token 与 `resetTimeoutOnProgress`：当前限制的是无进度空闲时间，不是 Agent 总运行时间；持续进度会延长调用，超时按结果未知的失败事实记录并禁止盲目重试，用户取消保持 `cancelled` 且不把服务器误标为故障。每个服务器默认最多并发 4 个调用，超出后按 FIFO 排队且排队调用可取消；进度只形成 live-only 活动，不能改写终态。进程在同步调用完成前退出时，Ordinary 用已持久化的工具轮把缺失结果收口为 `tool_execution_outcome_unknown` 并进入 `blocked`，不会自动重放副作用。MCP Tasks 当前仍是上游实验 API，尚未作为稳定、可持久化恢复的产品能力暴露
- MCP connect、工具枚举和引用枚举的超时都会中止底层协议请求；连接尝试使用代次校验，迟到结果不能把已超时并断开的 client 重新标为 connected。run 释放时会取消并等待仍在连接的 lazy client，关闭是终止且幂等的，迟到连接不能重新写回 session。prompts/resources/templates 只有在远端明确返回 method-not-found 时才投影为空集合，其他枚举失败必须形成可观察错误。单个服务的工具目录以及一轮 run 聚合后的模型可见 MCP 工具目录默认都不得超过 128 项或 128 KiB 序列化 metadata；prompts/resources/templates 共享单服务 1,024 项、1 MiB 的引用目录预算。任一边界超出时整个对应目录明确失败，不缓存、发布或伪装成成功的半截目录。
- Sub-Agent 当前只向 Ordinary 的 Pi AgentTool 适配层贡献两个工具：`agent_call` 调用已登记专家，`agent_spawn` 创建一次性专家。capability catalog 只保存 catalog-only definition，不向 ToolRegistry 注册假 executor；模型曝光与冻结 run 的普通工具边界使用同一决策。它们使用父 run 冻结的可执行工具上限，声明只能进一步收窄权限；nested Agent 工具集中强制排除所有 Sub-Agent 工具，因此不能递归。父 Ordinary run 使用 Pi AgentHarness 创建嵌套执行并继承取消信号，但 child stream 不形成独立 SSE/read-model。旧批量/专用续读工具、自研 runner、事件/trace store 与独立 read-model 已退役；完整输出作为父 Ordinary 工具事实交回，不做自动摘要。调用与结果只形成 Ordinary 标准 tool facts，不发布专用 `sub_agent.*` 事件（见 ADR-0026）
- 工程决定哪些工具可以执行、哪些需要命令确认、哪些被隐藏
- Ordinary 的 Pi AgentTool 适配层在调用 ToolCenter 前必须强制校验本轮 `allowedTools`；ToolCenter 仍可重复校验，但不能成为唯一防线。`AgentTurnRuntime` 仅服务 Deep child，不是 Ordinary 生产主链
- 模型只能在本轮可见工具集合内自主选择
- 模型不能绕过 ToolCenter、权限、命令确认和本地策略沙箱；但普通回答、工具结果和错误信息不得被脱敏或安全投影链路吞掉

### 5. 桌面自动更新边界

当前只有 Windows 打包桌面版支持自动更新。打包桌面版通过 `electron-builder` 产出 NSIS 安装包，并由 `electron-updater` 消费 GitHub Releases 中的 `latest.yml` 与安装包产物；启动后可自动检查并后台下载更新，下载完成后只提示用户“重启安装”，不会静默中断正在进行的任务或自动重启。

- 支持范围：Windows x64 打包桌面版。
- 不支持范围：浏览器 Panel、`panel:dev`、`panel:desktop:dev`、`--smoke`、`--window-smoke` 和未打包 Electron 运行。
- `/api/app/update`、`/api/app/update/check` 和 `/api/app/update/install` 是 Panel 对更新状态的后端契约；普通浏览器面板默认返回 `unsupported`，显式传入旧 manifest URL 时只能作为发布信息检查 fallback，不能自动安装。
- 自动更新发布源固定为 GitHub Releases；真正可自动更新的版本必须由 tag 发布流程产出 installer、blockmap 和 `latest.yml`，并在任何 GitHub 发布动作前校验 tag 与 `package.json` 版本、唯一 x64 installer、blockmap 以及 `latest.yml` 中的版本、路径、大小和 SHA-512 一致；手动上传任意 release asset 不构成可更新版本。

### 6. 当前默认产品边界

当前唯一可运行的产品入口是普通桌面 Agent。Multi-Agent 的代码和测试被延期保留，不能混入默认 Ordinary 路径。

- 产品当前只装配 Ordinary 的业务状态、事件、仓储与 read-model；Sub-Agent 的调用与结果归父 Ordinary run
- 默认入口为普通 `agent`；Agent 集群设置开关、侧栏按钮、Deep 历史加载与 `/api/deep/*` 均已停用，普通请求不会自动或显式转为 deep
- 已有的 manager、child、TaskBoard、scheduler 与 synthesis 源码只作为未来重构参考，不构成当前 Agent Team 或可恢复的历史运行
- 恢复 Multi-Agent 前必须重新确认其模型通道、附件、确认、持久化、入口和 Panel surface，不能直接重新接通历史 API
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
