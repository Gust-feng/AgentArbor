# 当前软件运行方式

本文件是 AgentArbor 当前软件运行方式的唯一根目录说明。后续只要默认运行方式、默认入口、主执行引擎或前后端职责发生稳定变化，都必须同步更新本文件，再更新实现代码与其他开发文档。

## 当前默认运行方式

当前 AgentArbor 以桌面普通 `agent` 作为唯一默认运行方式。

- 用户入口：`Desktop Shell / Panel`
- 默认运行模式：`agent`
- 默认执行主线：`用户消息 -> Task Soil -> 普通 Agent 主循环 -> 工具调用/命令确认 -> 事实 read-model`
- 默认交互形态：线性会话驱动；用户在同一个 conversation 中一轮接一轮补充上下文、要求和判断
- 当前已暴露显式 Agent 集群 beta 模块：用户先在 `设置 -> 关于` 启用“Agent 集群（beta）”，Panel 侧栏“新任务”下方才显示 `Agent 集群` 入口；正式后端入口为 `/api/deep/*`；内部仍沿用 `deep` / `DeepRuntime` 命名（当前为 manager 自由决策循环 + 一层 child 的最小协作闭环，见 ADR-0025）
- 默认仍为普通 `agent`，启动后不因历史 Agent 集群运行抢占普通入口，也不自动把普通请求升级为 Agent 集群；`deep` 只能由用户显式触发，不存在自动升级
- `/api/conversations` 与 `/api/desktop/runs` 当前都只接受普通 `agent` 运行
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

这意味着：

- 默认普通 Agent 是线性会话助手，不维护独立任务生命周期、任务拆解状态、完成标准状态机或 Plan 交接对象
- 默认普通路径中的 Task Soil 只是本轮会话输入、上下文引用、权限边界和运行材料的上下文包，不负责驱动任务状态推进
- “模型不再调用工具”才表示本轮普通 Agent 正常完成
- 工具调用、确认等待、工具失败后继续判断，都是普通运行的一部分
- `provider` 失败、网络失败、上下文维护失败、进程失败都不是正常完成
- `out_of_fuel` 与 `context_overflow` 必须投影为 `blocked` / `paused`，不能被包装成 `completed`
- 默认普通 Agent 当前不设置固定模型/工具轮次上限；若未来某个普通 Agent 需要轮次边界，必须由 `AgentDefinition.turnPolicy` 显式冻结并进入 run ref，而不是由前端、route helper 或临时执行参数私自决定
- 普通主循环消费的 `AgentDefinition.turnPolicy.purpose` 必须是 `desktop_agent`；历史 `desktop_chat` 与 `work_session_*` 只能作为兼容 purpose 读取，不能成为默认普通 AgentDefinition 或普通主循环的执行定义

### 2. 一个显式 Agent 集群最小协作闭环

当前软件除了默认普通 Agent 外，还提供一个显式 Agent 集群 beta 运行路径；它不是默认入口，而是用户在设置中启用 beta 入口后，再从侧栏 `Agent 集群` 按钮主动进入的独立 deep conversation / run。

- 编排边界：`DeepRunExecutor` 维持 manager 动作循环（`direct_answer / spawn_children / wait_children / continue_child / synthesize / ask_user / stop`），其中 `spawn_children` 会把 child 放入 `DeepTaskBoard` 后经 `DeepChildScheduler` 真实并发启动；`wait_children` 会真实等待在途 child；`continue_child` 表示父层审查或操作已有 child，并给同一个 child run 追加指令继续标准 Agent loop；若目标 child 仍是 `pending / running`，追加指令先进入 scheduler FIFO 队列，等当前 child loop 到达材料边界后以同一 `childRunId` 续跑，不抢占当前模型/工具调用；`synthesize` 前会先启动并等待 pending / running child 清场，且只在已有 child 材料时由父层综合产出 `SynthesizedConclusion`。
- 当前协作边界：只允许 manager + 一层 child（`depth = 1`）；child 由 `DeepChildAgentRunner` 作为显式 child Agent run 执行，父 Agent 派生 `DeepChildSpec`（目标、角色、工具授权、可选轮次预算），派生时把父层生成的 objective 冻结到 child `AgentSpec.instructions` 作为 run 出生事实，child 复用 `AgentTurnRuntime.executeAutonomous -> ToolCenter -> Confirmation Gate` 的标准模型-工具-模型循环，并在 `/api/deep/*` 路由中复用普通桌面 Agent 的模型环境、ToolCenter、MCP 与命令 shell 能力。未由父 Agent 显式设置 `maxModelRounds / maxToolRounds` 时，child 不设固定轮次上限；child 模型请求也不写入固定输出/延迟预算，避免工程默认预算替代父 Agent 判断。child 若遇到 `approval_required`、`out_of_fuel` 或 `context_overflow`，会进入 `blocked` child run，而不是误报 failed；child 自身中断或异常停止会进入 `interrupted` child run，不再被任务板误投影为 completed。
- 子 Agent 可续跑边界：`approval_required` 会在 `ChildAgentRun.pendingApproval` 中保留安全确认投影（confirmationId、tool call、工具名、动作摘要、影响资源、风险等级、恢复可用性和 source refs），不保存 raw prompt、raw response、工具原始输出或完整 tool loop；运行进程内同时保留 runtime-only continuation，确认决策可通过 `POST /api/deep/runs/:runId/children/:childRunId/confirmations/:confirmationId/decision` 恢复同一个 child 标准 loop。父层既可以在 manager 决策中通过 `continue_child` 操作同一个 child run，也可以通过 `POST /api/deep/runs/:runId/children/:childRunId/messages` 给已有 child 追加继续指令，使异常停止、受阻或材料不足后的同一个 child 继续工作；运行中 child 的追加会先排队；已完成/失败/blocked/interrupted child 只有在进入可审查材料/持久化投影后，才由 live scheduler 的即时继续能力恢复同一个 child loop。只有 scheduler 对排队或即时继续都明确拒绝时，路由才返回明确 409/404，不能绕过 scheduler 另起恢复路径。这两类继续都会在 `AgentRunTree.delegationDecisions` 中记录 `resume_child` 和真实 `childRunId`，并更新 child 投影。控制 API 只刷新该 child 材料和审计链，不自动重写已完成的父层综合结论；如果已存在结论，后端会把 `liveProjection.synthesis.status` 标为 `pending` 并高亮综合节点，表示当前结论落后于最新 child 材料。后续若需要把新材料纳入最终结论，必须通过 `POST /api/deep/runs/:runId/resynthesize` 显式触发父层重新综合，由父层基于当前 child 材料再产出新的 synthesis 与 conclusion，重新综合事件会安全引用参与审查的 `child_run`。若进程重启导致 confirmation continuation 丢失，后端返回明确 409，不伪造恢复。外部 stop / interrupt 仍可收口。当前已具备真实并发 child、真实 `wait_children`、父层审查后继续同一 child、单 child 失败隔离、parent synthesize；外部 `stop / interrupt` 与模型主动 `stop` 复用同一停止收口语义：取消 pending、清空尚未执行的父层追加指令、保留已完成/受阻/中断材料、等待或保留 running child 当前 loop 自然收尾后的材料，并尝试部分综合，但不再触发继续探索。
- 子 Agent 执行与父层操作事实：`ChildAgentRun.execution` 继续表示最近一次标准模型-工具 loop；同一个 child 被父层 `continue_child`、控制 API 追加消息或确认恢复后，`ChildAgentRun.executionHistory` 会追加每段安全执行事实（轮次、模型请求/响应引用、工具调用状态、结果与记录时间），用于父层审查和运行树复盘；该历史不保存 raw prompt、raw response 或工具原始输出。父层对同一个 child 的追加/续跑操作单独记录在 `ChildAgentRun.parentInstructions`，只保存 instructionId、安全 `messageRef`、来源、排队/执行/取消状态、短摘要和时间戳，不保存 raw 指令正文；manager 自主 `continue_child` 还可以在该操作上记录安全 `review`（审查决策、理由、证据引用和置信度），作为“为什么继续这个 child”的父层判断证据，控制 API 的用户补充消息不要求该字段。manager `continue_child` 与控制 API 追加给 child 的 raw 父子消息都会进入内部 `DeepChildMessageStore`，通过同一个 `messageRef` 与 `parentInstructions` 关联，用于后续恢复、审计和模型上下文，不进入默认事件、实时流程投影或安全 run tree 摘要。运行中的 manager 指令会先进入本 run 内部缓冲，child 续跑读取时合并缓冲与持久层，run 收口前再按顺序落盘，避免把续跑上下文依赖异步投影回调。child 续跑时，已执行过的父子消息历史会以内部上下文进入 continuation prompt；本轮新追加内容仍作为当前 `Parent instruction` 单独传入，并从历史操作列表中排除当前 `messageRef`，避免把当前指令重复放入历史；queued 但尚未执行的消息不能被当作历史事实；若本轮有当前父层 `review`，它会作为当前审查上下文单独进入 continuation prompt。`parentInstructions` 与 `executionHistory` 正交，避免把“父层要求了什么”和“子 Agent loop 如何执行”混成一条流水。manager 后续决策与父层 synthesis 的模型上下文会消费这些 child run fact 安全投影，包括执行段数、最近执行段 outcome、工具状态摘要、父层操作摘要和父层审查摘要，使父层能基于“同一个 child 已经被如何续接、执行了哪些段、是否仍有父层操作残留”继续判断，而不是只看最终 child summary；同一个 child 被继续执行时，child 自己的 continuation prompt 也会包含执行段历史、最近 loop 工具状态、父层操作摘要、当前审查摘要和已执行父子消息历史，避免把续跑退化成只看上一轮 summary 的新任务。
- 运行中单一事实源：每个 Agent 集群 run 都创建 manager-owned `DeepTaskBoard`；运行中的 child 状态、任务板相位与研究 brief 先进入 board / record，再由 `liveProjectionFromBoard(...)` 派生 `liveProjection.children` 与展示相位；父层追加 child 指令时，scheduler 只把 instructionId / messageRef / 排队数量 / 状态这类安全短事实叠加到对应 `liveProjection.children[].parentOperation`，不把 raw 指令正文放进默认流程投影；`deep.child.started / instruction_queued / completed / blocked / interrupted / failed` 事件也在 scheduler 生命周期回调处实时发布；最终 `AgentRunTree` 的 child 状态与 `board.terminalSnapshot()` 对齐。有 `runtimeHome` 时，deep conversation 写入 `deep-conversations/`，deep run record 写入 `deep-runs/<runId>/record.json`，父子 raw 消息写入 `deep-runs/<runId>/child-messages/<messageRef>.json`，与普通 conversation / run 物理隔离；run record 持久化本次 `aiMode` 与冻结能力快照，使进程重启后仍能读取同一 run tree，并在用户追加消息时基于持久化 childRun 继续同一个 child loop。
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
- `GET /api/basic-agent/runs/:runId/work-session` 仍作为历史兼容端点保留，会同时返回 `workView` 与 `workSession`；后续新增普通 UI 和普通后端路径不能继续依赖该端点
- 前端在打开会话，以及提交消息、确认决策、取消运行、运行结算、历史 transcript 读取后的刷新路径中，都应优先消费这些后端 read-model，而不是自行拼装运行状态、工作视图、结果详情和事件
- 当前 Panel 前端普通运行主线不再直接依赖 `/api/desktop/runs/:id` 或 `/api/basic-agent/runs/:id/work-session` 来拼装运行视图；这些接口即使保留，也不应继续作为默认普通 Agent 观察主线
- 历史运行和恢复运行的 read-model 必须优先使用 run 创建时冻结的 `capabilitySnapshot` 和 `informationAccess` 作为模型、工具、工作区和信息访问事实；当前配置只能作为旧记录缺失快照时的兼容回退
- 普通 `agent` run 的 live model stream 只接受 `desktop_agent` 和历史 `desktop_chat` 的用户可见模型增量；`work_session_*` 增量只服务显式 `deep` 或历史兼容路径，不能混入默认普通流式输出

前端不是 Agent 引擎，也不负责推导任务状态、补全工具语义或重建运行事实。

### 4. 工具属于后端设施能力

当前工具能力属于后端设施，不属于前端，也不属于 prompt 自由扩展范围。

- 工程决定本轮 Agent 能看见哪些工具
- 当前默认普通 `agent` 的工具可见性由后端结构化能力快照与 `AgentDefinition.toolVisibilityProfile` 共同裁剪，不再依赖工具名前缀约定
- 普通 `agent` 只有在后端已经冻结 `capabilitySnapshot` 后，才会把工具暴露给模型；裸 `ToolCenter` 只负责执行，不再单独决定模型可见工具
- `ToolCenter` 只执行工具、权限/策略校验与命令确认，并返回 `ToolCallResult` 执行事实；不保存逐 run 调用计数或预算，不生成模型消息、UI display、envelope 或持久化投影。轮次/预算由 Agent loop 决策，模型、事件和 Panel 分别从同一事实单向派生自己的消费视图
- 新写入的工具事件与 run record 只保留稳定事实、引用和错误域；工具原始大内容由工具结果的 continuation/reference 机制按需提供。旧 `projection / envelope / display` 记录不再读取或迁移，旧 snapshot 不满足新契约时属于开发期失效数据
- 工具生命周期固定为 `tool.requested / tool.completed / tool.failed / tool.cancelled`，确认等待使用 `user_approval.requested`；live、replay、conversation history 和持久化视图从同一 append-only 事件归约语义消费调用事实
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
- skill `evals/` 只作为 loader/doctor 的本地质量评估 artifact 被发现、索引和统计；它不是运行时资源，不进入 frozen runtime resource index，不进入 Context Ledger / Context Pack，也不能通过 `read_skill_resource` 读取。当前 doctor 默认做确定性 JSON 结构、case 数、routing 断言、quality/regression 的 `qualityBaseline` with/without skill 记录和字面量质量检查；显式传入模型通道时可通过 `skill_routing` 跑 routing eval，但仍不自动生成 with/without 输出、不调用 LLM judge、不评估运行时真实回答质量
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
- 自动更新发布源固定为 GitHub Releases；真正可自动更新的版本必须由 tag 发布流程产出 installer、blockmap 和 `latest.yml`，手动上传任意 release asset 不构成可更新版本。

### 6. 当前默认产品边界

当前默认产品的默认入口仍是普通桌面 Agent；在基础 Agent 路线稳定后，已重启 `deep` 作为显式并行入口，但 deep 不混入默认路径。

- 保留长期 `deep / Agent cluster` 架构方向
- 默认入口仍为普通 `agent`；Agent 集群入口通过 `设置 -> 关于` 的 beta 开关暴露为侧栏按钮（正式后端路径 `/api/deep/*`，内部 `runMode: "deep"`），但不自动触发、不自动升级，不把普通请求自动转为 deep
- 当前显式 Agent 集群已落地 manager 自由决策循环、一层 child、`DeepTaskBoard` 单一事实源、`DeepChildScheduler` 实时并发、`DeepResearchBrief`、聊天态动态协作投影、专属工作区壳层、跨会话历史恢复与 parent synthesize，但仍不是完整 Agent Team
- deep 后端扩展按显式 deep 项目推进（一期决策由 ADR-0025 承接），且必须先证明不改变普通模式的工具可见性、事件投影、确认语义和首屏文案
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
