# 当前软件运行方式

本文件是 AgentArbor 当前软件运行方式的唯一根目录说明。后续只要默认运行方式、默认入口、主执行引擎或前后端职责发生稳定变化，都必须同步更新本文件，再更新实现代码与其他开发文档。

## 产品边界与当前实现的区别

当前产品架构以一个 Workbench 和 Ordinary Agent 为主线；Sub-Agent 是 Ordinary Agent 的工具能力。Multi-Agent 的现有源码保留为延期重构参考，不属于当前生产功能。当前事实源是 ADR-0028，延期边界见《Multi-Agent 延期模块边界》。

删除普通会话后，Host 只通过 Space 公开命令取消对应的 `conversation_reference`；该动作只删除 Space 元数据链接，不删除该 Space 的本地文件、工作区文件夹、托管文件夹、托管文档或其他引用。

Multi-Agent 的 Panel UI、Deep DTO 和实现源码暂时保留，以便未来重构复用其中可验证的局部机制；当前 Panel 不装配其 feature、不加载 Deep 历史，也不接受 `/api/deep/*` 请求。该路径统一返回 `410 multi_agent_deferred`，不会创建 provider、ToolCenter、store 或后台运行。

后端只有一个生产组合根：`createPanelRuntime()`。它当前创建 `OrdinaryAgentFeature`、`AgentNotesFeature`、`PathMemoryFeature`、`SpaceFeature`、`PersonalKnowledgeFeature`、`ManagedContentFeature`、`WorkbenchAssetsFeature`、后者与 Ordinary 之间的 `OrdinaryPathMemoryConnector`、可选的 `RemoteCollaborationFeature`、`ContentVaultSyncFeature` 以及所需的中性资源；`ordinary-routes` 只做 HTTP/SSE 适配。Remote Collaboration 只通过 Ordinary 的窄 facade 处理在线对话；Content Vault Sync 只通过各内容 feature 的 contributor facade 工作，两者都不读取 feature store，也不建立第二个 Agent runtime。Multi-Agent 的 feature、store、control registry 和资源装配不进入当前生产运行时，也不参与关闭流程。

`SpaceFeature` 是独立的内容组织功能：它持有空间、顶层引用及其排序和标题等产品元数据。`workspace_folder` 是对外部磁盘目录的映射，根项只允许取消链接，不能从 Space 删除整个外部文件夹；`managed_folder` 是 AgentArbor 自己维护的真实目录，删除根项会物理删除目录及其内容；`local_file` 同时支持只取消链接和物理删除源文件，两种意图使用不同命令。用户明确删除 `local_file` 时采用幂等语义：源文件已为 `ENOENT` 仍会清理残留 Space 元数据，权限或其他 I/O 错误仍保留引用并报告失败。物理删除由 `SpaceFeature` 自有的 `space-reference-deletion/v1` journal 协调：源内容先重命名到同目录暂存位置，再提交 SQLite 元数据，最后清理暂存内容；恢复时以 SQLite 中是否仍存在完整且身份一致的引用子树判断回滚或收尾，不以 journal phase 单独猜测提交事实。Panel 在 `SpaceFeature.ready()` 完成前不监听端口；journal 损坏、元数据部分存在、身份变化或 source/staged 状态含混都会拒绝启动并保留现场。元数据已经提交后，journal phase 写入或暂存清理失败只形成诊断，不能把已知成功删除改写为失败；后来在原路径出现的新内容不会被恢复或收尾覆盖。目录下的文件和子目录由真实文件系统扫描、读取和修改，不作为逐项数据库记录。它不复制外部正文，也不拥有普通对话的 run、Session 或历史；普通对话仍是默认 Agent 的线性会话，但一个 `conversation_reference` 现在是该对话唯一的 Space 归属链接，不能同时挂入多个 Space。Host 在每轮提交时从这条链接解析所属 Space，把其中的本地文件、外部目录和软件自建目录冻结为本轮 Task Soil 附件与精确写入授权；后续新增、移动或删除引用只影响后续轮次。模型通过附件读取工具及 `SpaceWrite / SpaceEdit` 操作本轮获权资源，这两个写工具只接受冻结的 Space 引用 ID，不接受任意绝对路径；模型通过 `SpaceAddReference` 持久化本地资源时也只能选择本轮 Task Soil 中可见且具备读取授权的 `attachmentId`，不能提交原始路径，而用户经 Desktop/Panel 显式选择本地路径的入口仍直接使用 Space command。普通 run 进入稳定终态后，Host 只检查本轮冻结的 `local_file` 引用：确认源路径为 `ENOENT` 时调用 Space 公开命令取消链接并发布精确投影变化；文件夹、未参与本轮的引用和权限等其他访问错误均不会被自动移除。Panel 只消费 query projection。

Workbench 的结构化业务数据保存在 `runtime/workbench.sqlite3`。`SpaceFeature` 独立拥有 `spaces / space_references` 表；数据库只保存空间和顶层引用，不保存文件系统子树。`PersonalKnowledgeFeature` 独立拥有个人 Markdown 笔记、知识收藏与链接、主题归属和最近打开事实。两者只共享 Host 持有的 SQLite 连接，不共享业务仓储或状态。首次启动时，Host 会持久化原始 Redesign Demo 数据集的固定学习空间身份和知识条目成员关系；名称、层级、类型、正文与媒体元数据继续由原始内置数据定义提供，不转换成磁盘文件或托管副本。初始化通过 SQLite 标记保持幂等，用户创建和引用的文件仍走真实文件系统模型。Ordinary run、conversation、Pi Session 和 ToolOutputStore 仍使用各自现有文件存储，不进入 Workbench 数据库。当前开发数据允许直接重建，Space 不提供旧虚拟文件夹或旧树结构的兼容读取。Workbench 在线备份只有在 runtimeHome 路径租约内确认 Space 删除 journal 为空时才会读取 SQLite 与软件自管目录；存在损坏或未收口 journal 时明确拒绝快照，不能产出跨时点备份。用户选择的恢复包通过校验后，当前 Panel 会先停止接受新请求、释放 Ordinary，再按 Personal Knowledge、Space 的依赖顺序等待队列和删除恢复收敛，然后制作安全备份和写入 pending restore；当前实例此后只允许关闭并重启。pending 软件自管目录先发布并刷盘，pending SQLite 最后发布并作为完整恢复包的提交点。若升级前遗留了“未应用 pending restore + 非空 Space 删除 journal”，下次服务器启动会在 `runtimeHome` 单写者 lease 内先用旧 SQLite 装配 recovery-only Space 边界，收口 journal 并关闭旧连接，再应用 pending restore；journal 损坏、引用身份变化或已进入 Workbench restore journal/commit 后仍存在的跨世代含混状态继续 fail closed。外部 `local_file` 的删除暂存内容不属于 Workbench 备份资产。

Personal Knowledge 的标题与 Markdown 正文由 SQLite FTS5 索引，并保留中文子串补全查询；Panel 搜索和 Ordinary Agent 的 `KnowledgeSearch` 使用同一 feature query。Ordinary 还通过冻结工具边界使用 `KnowledgeRead / KnowledgeCreateNote / KnowledgeUpdateNote / KnowledgeDeleteNote / KnowledgeCollect`，所有写入仍由 `PersonalKnowledgeFeature` command 与 revision 契约执行，模型和 ToolCenter 不直接访问数据库。知识库托管资产的文本更新同样由 `PersonalKnowledgeFeature` 重新读取并验证页面后执行；Host 只注入带路径租约的机械文件写入端口，成功后发布 `personal_knowledge` 投影变化，不能把知识业务变更冒充为 `mounted_files`。Workbench 数据维护由 Host 提供 `/api/workbench-data/health`、在线一致性备份和恢复暂存；备份同时覆盖 SQLite、知识库托管资产和软件自建空间文件。恢复只在下次启动、任何 feature 打开共享数据库之前应用，并由恢复专用 journal 协调 SQLite、知识资产和软件自建空间文件：commit 前中断会先回滚到原完整集合再重试，commit 后中断只完成收尾；任何无法证明一致的状态都会拒绝打开共享数据库。

Panel 上传附件由 Ordinary 的 managed-attachment 仓储拥有：每个上传文件的幂等身份只由请求的 `Idempotency-Key` 与该文件的 `fileIndex` 决定，并跨后端进程重启保持稳定；响应丢失后的同批重放不会复制草稿。草稿阶段记录当前 Panel 实例，提交时在 Ordinary run 写入前 claim 到 conversation，Task Soil 只冻结 `uploaded-attachment:<attachmentId>` 和对应读取权限；run 快照保存失败会释放本次新 claim；如果释放遇到临时存储失败，Ordinary feature 会在同一 conversation 队列内退避重试，并在后续同 conversation run 成功落盘时接管重叠 claim，防止旧回滚释放新 run 正在使用的附件；启动时按 durable run 引用清理 orphan，并隔离损坏记录。Attachment tools 通过 Host 注入的 ID 解析器读取副本。系统选择的外部文件继续使用独立的 `local-file:` / `local-project:` 引用，属于用户源文件，任何普通 run 或对话删除都不得物理删除它们。上传失败、草稿移除、应用重启和 conversation 删除分别由 managed-attachment owner 负责收口，不能依赖 Panel 进程内媒体 Map。
Ordinary 的生产执行链已经切换为 `request-handler -> ordinary-routes -> OrdinaryAgentFeature -> Agent Session adapter -> Pi AgentHarness/Session -> ToolCenter`。Pi 负责模型-工具循环、Session 分支和压缩；Ordinary feature 负责业务状态、持久化和 read-model 事实。旧 BasicAgent、Desktop session、Panel run job、应用层 Underground、`MinimalRuntime`、旧 conversation/run route、`/api/desktop/runs` 与 `/api/underground/*` 已删除。Panel JSON 输入已在 HTTP 边界使用 Zod 校验；当前尚未完成的是 Workbench/UI surface 隔离。

## 当前默认运行方式

当前 AgentArbor 以桌面普通 `agent` 作为唯一默认运行方式。

- 用户入口：`Desktop Shell / Panel`；Workbench 首页是唯一的空白新对话入口，侧栏“首页”只负责返回这一完整空态，不提前重置已有会话或输入。用户在首页提交内容时才创建新 conversation；对话页只展示正在执行或从历史打开的 conversation，并在提交时继续当前 conversation
- 可选远程入口：Android 9+ Capacitor APK；桌面当前可直接创建协同账户，不要求邀请码，邀请码表和显式关闭开放注册的服务端开关仍保留。手机通过六位码或二维码加入，桌面批准后自动启动本次 Relay 连接；后续应用启动仍由用户显式运行连接。配对批准、设备撤销和每账户一台桌面加一台手机的边界不变。
- 远程实时通道：Conversation 索引、按需正文、AI 增量、命令与确认只经 WSS 在线转发并保存在用户设备，不在服务端落盘；`run.delta` 按 24ms 短窗口合并且不进入可靠 outbox，终态快照负责最终校准。目标电脑离线时 Ordinary 命令只留在手机 IndexedDB。Relay 只拥有进程内实时投递；Identity 长期保存账户、邀请码哈希、设备、配对、撤销和最后在线时间。
- 远程内容通道：独立 Content Vault 通过 HTTPS 持久同步白名单内的 Space、Personal Knowledge、受管文本、Workbench 可编辑文本资产和全局 Agent Note，并保存版本、删除墓碑、change cursor 与配额事实；工作区 Agent Note 保持本地。桌面只要存在有效账户 binding 与设备 token 就保持 Vault 同步，不依赖 Relay WebSocket 是否在线；Vault 写入后的 WebSocket cursor 通知只用于立即唤醒同步，10 秒轮询作为兜底。手机新建会话引用的 Space 尚未投影到桌面时，Host 通过窄同步端口先同步 Vault 并复查，Remote Collaboration 不读取 Vault store。
- 默认运行模式：`agent`
- 默认执行主线：`用户消息 -> OrdinaryAgentFeature -> Pi AgentHarness/Session -> ToolCenter/命令确认 -> ordinary-run/v6 -> 事实 read-model`
- 默认交互形态：线性会话驱动；用户在同一个 conversation 中一轮接一轮补充上下文、要求和判断
- Multi-Agent 的入口、历史加载和生产 API 已全部停用；`/api/deep/*` 返回 `410 multi_agent_deferred`，保留源码不代表可触发 `deep` run
- `/api/conversations` 是普通 `agent` 的唯一提交入口；旧 `/api/desktop/runs` 已删除
- 远程消息不绕过 Ordinary feature：desktop connector 直接调用同一 command facade，并以远程 `commandId` 作为稳定 `submissionId`；手机和 Relay 都不执行模型或工具
- 当前 Ordinary 通过 Pi provider/model binding 使用冻结的模型协议能力；自定义 OpenAI-compatible endpoint 仍由 provider binding 接入，fake provider 仅供测试。Chat binding 把 DeepSeek、Kimi、GLM、MiniMax 的冻结请求方言映射到 Pi `compat` 与公开 payload hook，并按冻结能力声明视觉输入；未知模型默认关闭视觉输入，只有已核验定义或显式 capability override 才能开启。动态 API key 每次请求重新解析，清空后不会回退旧 key。普通 Agent 的语义 Skills 路由使用同一 Pi Models/provider binding 的窄无工具通道，并保留现有 JSON 校验与确定性 fallback。仓库通过 pnpm patch 固化 pi-ai 0.80.10 的必要上游补齐：Chat/Responses `stream:false`、refusal diagnostic、Responses hosted output continuation 与 `incomplete_details.reason`、MiniMax 累计 delta 和文本 `reasoning_details`；Responses provider-native Web Search 由冻结 binding 注入 hosted tool，并只在 provider/API/model 相同的 Session 后续轮次回放 opaque output item。provider error、refusal、content filter、输出截断与 context overflow 都形成 Ordinary 可观察失败。Pi 公共消息契约仍不能无损表达普通 file/audio 与 URL/file-id 附件，provider transport 也没有 Host 自定义 fetch 注入口；相关旧 Chat/Responses transport 只作为延期 Multi-Agent 的源码依赖保留，不进入当前生产组合根
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
- 用户取消由 Ordinary feature 先提交新的或确认已有的持久化终态，再停止该 run 的新输出与新工具调度；provider transport、live continuation 和其他运行资源随后由原 owner 在后台释放，取消接口与下一条消息不能等待不响应取消的底层 Promise。正在等待确认的 run 采用更严格的收口顺序：approval cancellation 必须先完成 live continuation release，之后才依次执行 Session finalization、terminal settlement 和 successor activation；显式 release 失败时由 Ordinary feature 在当前进程退避重试，成功前 controller、后继调度和 stable-terminal facts 屏障保持关闭。若取消时没有已接受但结果未定的工具轮，后续消息可以在旧执行资源仍在清理时启动；已有在途工具事实时仍须先完成结果收口，不能越过副作用未知边界。Ordinary feature 按 conversation 持有 queued run 激活泵：`queued` snapshot 是跨进程持久信号，`queued -> running` 保存或 predecessor Session finalization 暂时失败时在当前进程退避重试，进程重启后由 queued snapshot 恢复接管；工具结果未定、确认决策在途或其他 live barrier 仍只由原 owner 收口，激活泵不会轮询越过
- Ordinary 会定期把已经流式展示的 assistant 正文保存为 `visibleAssistantText`。它只用于取消或进程退出后的视图恢复，不是 completed 回答，也不写入 Pi Session。主动取消后，Panel 保留已有正文和真实工具过程；没有正文或过程时不生成 assistant 占位，也不显示“已取消”卡片或内部原因
- 软件退出或进程异常结束后，live-only continuation 不会伪恢复。重新进入会话时，Panel 恢复退出前已保存的正文、工具事实和 Session 位置，不显示 continuation、runtime 或进程重启错误；用户只能追加新消息，或回退到 Pi Session 的历史 leaf 创建新分支
- `runtimeHome` 是单写者边界。同一运行目录同时只能由一个 Panel/Electron 后端持有；第二个实例必须拒绝启动，不能因端口不同或开发 watch 重启而改写另一个实例的 Ordinary 运行态
- `provider` 失败、网络失败、上下文维护失败、进程失败都不是正常完成
- provider 404、超时、失败或流式断开若不能安全重试，会永久结束当前模型调用。Ordinary 的认证解析、provider transport 和语义 Skills 路由由 Pi provider binding 负责，Ordinary adapter 不复制 provider client 或重试器。一旦出现 provider 事件、用户可见增量或工具调用事实就不得拼接多个 attempt。无法安全重试时，用户只能追加新消息创建新 run，或回退到历史 Session leaf 创建新分支
- `out_of_fuel` 与 `context_overflow` 必须投影为 `blocked` / `paused`，不能被包装成 `completed`
- 默认普通 Agent 当前不设置固定模型/工具轮次上限；若未来某个普通 Agent 需要轮次边界，必须由 `AgentDefinition.turnPolicy` 显式冻结并进入 run ref，而不是由前端、route helper 或临时执行参数私自决定
- 普通主循环消费的 `AgentDefinition.turnPolicy.purpose` 必须是 `desktop_agent`；Ordinary 不再读取或回放历史 `desktop_chat` / `work_session_*` purpose，它们不能成为普通 AgentDefinition 或普通主循环的执行定义

### 2. 延期的 Agent 集群参考实现

`src/deferred/deep/`、`src/deferred/deep-routes.ts` 和关联 Panel 模块保留历史实现与测试，供未来重构筛选可复用机制。当前生产组合根不创建 `MultiAgentFeature`，主路由不调用 Deep route adapter，下面的内容只说明保留源码的原有行为，不能被解释为当前可用功能。

该后端源码已归档：不进入 `pnpm build` 与 `pnpm test`，改由 `pnpm test:deferred` 单独编译与验证。Panel 前端 deep 投影仍留在 `src/app/panel-ui/`，由默认关闭的 `agentClusterEnabled` 本地偏好控制；即使手动开启，所有 `/api/deep/*` 调用仍返回 410。归档边界、验证方式与恢复条件见 `docs/开发指南/06-工程实现/17-Multi-Agent源码归档边界.md`。

- 编排边界：`DeepRunExecutor` 维持 manager 动作循环（`direct_answer / spawn_children / wait_children / continue_child / synthesize / ask_user / stop`），其中 `spawn_children` 会把 child 放入 `DeepTaskBoard` 后经 `DeepChildScheduler` 真实并发启动；`wait_children` 会真实等待在途 child；`continue_child` 表示父层审查或操作已有 child，并给同一个 child run 追加指令继续标准 Agent loop；若目标 child 仍是 `pending / running`，追加指令先进入 scheduler FIFO 队列，等当前 child loop 到达材料边界后以同一 `childRunId` 续跑，不抢占当前模型/工具调用；`synthesize` 前会先启动并等待 pending / running child 清场，且只在已有 child 材料时由父层综合产出 `SynthesizedConclusion`。
- 当前协作边界：只允许 manager + 一层 child（`depth = 1`）；child 由 `DeepChildAgentRunner` 作为显式 child Agent run 执行，父 Agent 派生 `DeepChildSpec`（目标、角色、工具授权、可选轮次预算），派生时把父层生成的 objective 冻结到 child `AgentSp…7369 tokens truncated…n entries 或 continuation。Panel 只展示单向投影，但不得用摘要替换正式回答和工具结果
- Panel 的工具生命周期投影使用 `tool.requested / tool.completed / tool.failed / tool.cancelled`，确认等待使用 `user_approval.requested`。Ordinary 的 `tool.requested` 与 `tool.progress` 都是 live-only 活动；真正持久化并参与重启重放的工具事实仍是终态 `ToolCallResult`。当前命令工具只上报有界 stdout/stderr 尾部与累计字符数；进度不写入 snapshot、不替代终态结果，也不能影响执行结果。Ordinary SSE 使用 heartbeat 保持连接可观察，Panel 同时做低频增量对账，并在流静默后自动降级轮询，不能依赖切换 conversation 才补齐活动
- Ordinary SSE 对相邻文本 delta 做 16ms 短窗口合并，完整帧串行写入；`response.write()` 返回 false 时等待 `drain`，单连接积压超过 256 帧时只关闭观察连接，不取消 Agent。权威状态仍由 run snapshot/view 与 cursor 对账提供
- Panel 关闭会在首个异步清理前同步停止 Ordinary 新工作准入并请求停止现有 run；等待在途 HTTP 请求最多 1 秒后使用 Node `closeAllConnections()` 终止卡住的连接，整个运行资源清理另有 30 秒 Host hard deadline。若 provider 或其他在途 operation 不响应取消，关闭返回明确 `panel_shutdown_timeout`，桌面宿主可继续退出而不会永久挂起；关闭期间新 Ordinary 请求返回 `panel_runtime_quiescing`
- 普通 `agent` 的本轮模型配置事实来自 run 创建时冻结的 `capabilitySnapshot.activeModel`；执行、持久化、恢复和用户可见 read-model 不能再用当前全局模型配置覆盖它
- 普通 `agent` 的本轮模型能力事实来自 run 创建时冻结的 `capabilitySnapshot.modelCapabilities`；直接调用参数里的临时 `modelCapabilities` 只能服务没有冻结快照的测试或兼容调用，不能覆盖已创建 run 的上下文窗口、输出预算、工具调用能力或流式能力
- 普通 `agent` 的附件读图工具只在本轮模型能力支持视觉输入时进入可用工具集合；支持的图片字节会进入 Ordinary durable Pi Session，并在后续轮次重新构建模型上下文，不进入事件、ordinary run snapshot 或 Panel read-model，工具 JSON 结果仍只保留图片元数据和本轮模型输入状态
- 普通 `agent` 的本轮工作区事实来自 run 创建时冻结的 `capabilitySnapshot.workspace`；请求显式传入的当前工作区只影响该 run 的工作根目录，不能回写或覆盖设置页保存的默认工作区
- 普通 `agent` 的 Space 文件权限来自对话唯一 `conversation_reference` 在本轮提交时生成的 Task Soil 快照；不同 Space 的引用不会合并，同一 run 启动后 Space 变更不能扩张或撤销该 run 的文件范围，未归属 Space 的对话保持原工作区权限
- 普通 `agent` 在请求未显式指定 `aiMode` 时，默认 `aiMode` 也从本轮 `capabilitySnapshot.activeModel.defaultAiMode` 派生；入口层不得为了默认值提前读取当前全局模型配置
- 普通 `agent` 执行阶段只能消费 run 创建时冻结的 `capabilitySnapshot`；执行资源不得在运行中重新向 `CapabilityCenter` 获取当前快照来替代本轮事实
- 普通 `agent` 的本轮 ToolCenter 执行器全集也必须从 `capabilitySnapshot.toolCatalog.tools` 派生；当前代码新增、删除或启停工具只能影响新 run，不能扩张已创建 run 的可执行工具集合
- 普通 `agent` 的技能可见与触发集合也来自 run 创建时冻结的 `capabilitySnapshot.skillCatalog`；执行期间的当前 skill 启停状态只影响新 run，不改写已创建 run
- 普通 `agent` 默认发现用户级 `$HOME/.agents/skills` 和项目级 `$WORKSPACE/.agents/skills`；设置页使用当前配置工作区，本轮普通 run 使用 run 创建时冻结的工作区，未显式提供工作区时才落到默认配置工作区。项目级 skill 具有更高 precedence。宿主可通过显式 `additionalSkillRoots` 接入 admin/plugin 等受管来源，但这只是显式来源挂载，不是 marketplace、installer、自动更新或回滚机制；默认不自动扫描 managed marketplace。来源层级、root id 和 precedence 会进入冻结 skill catalog 与 run capability 投影；默认显式/关键词选择只使用安全 metadata，不暴露绝对路径；显式 opt-in 的模型路由同样只能看到安全来源 metadata
- 普通 `agent` 的 skill 启停和 `markUsed` 状态只使用 source-qualified `stateKey` 的 v2 文件；旧 `skillId`、旧版本或损坏状态直接视为空状态，不迁移、不回退
- 普通 `agent` 的默认 skill 选择采用 progressive disclosure：基于本轮 frozen skill catalog 做确定性显式/关键词选择，显式 `$skill` 直接选择，关键词或触发器命中才加载正文；默认不发起 `skill_routing` 前置模型请求，也不把全量 skill 候选发给模型。设置页“基础能力 -> Skills 触发方式”可显式切换为“语义路由”；只有该设置冻结到新 run 的 `capabilitySnapshot.skillTrigger.mode = "model"` 时，普通 Agent 才会在主请求前额外发起 `purpose: "skill_routing"` 的模型路由请求。该请求只使用 Pi 的无工具文本/JSON 通道；不符合窄契约时由现有 Skills fallback 处理，不把共享 Multi-Agent 通道强行切换到 Pi
- 普通 `agent` 只在 skill 被本轮选中后读取 `SKILL.md` 正文，并校验 run 创建时冻结的正文 hash；hash 不一致时 fail closed，不注入正文
- 普通 `agent` 只允许本轮已选中且成功加载的 skill 通过 `SkillRead` 按需读取 indexed `references`、`assets` 和 `scripts`；该 companion 只能在模型 loop 前的客观 boundary resolution 中，从本轮 frozen tool catalog、冻结 Skill resource index 和真实 executor 激活，不能由 Skill 声明、模型可见性或运行中状态从 catalog 外扩张授权。reference 内容作为工具结果回到模型，assets/scripts 不返回 raw body，scripts 不自动执行
- skill `evals/` 只作为 loader/doctor 的本地质量评估 artifact 被发现、索引和统计；它不是运行时资源，不进入 frozen runtime resource index，也不能通过 `SkillRead` 读取或注入模型输入。当前 doctor 默认做确定性 JSON 结构、case 数、routing 断言、quality/regression 的 `qualityBaseline` with/without skill 记录和字面量质量检查；显式传入模型通道时可通过 `skill_routing` 跑 routing eval，但仍不自动生成 with/without 输出、不调用 LLM judge、不评估运行时真实回答质量
- skill `allowed-tools` 当前只作为冻结和审计声明处理：不能扩张工具，不能隐藏普通 `agent` 原本可见的工具，也不是 Claude Code 风格免确认授权；未来若做 skill 级免确认授权，必须新增 per-tool grant 契约
- MCP 当前进入配置目录、能力快照的 `mcpCatalog`、能力草案投影和普通 `agent` 默认工具边界；只有服务已启用且配置完整、缓存定义已进入本轮冻结快照、惰性 executor 已装配并通过 `AgentDefinition.toolVisibilityProfile` 的 MCP 工具，才会进入本轮模型可见和可执行边界。MCP 在真正执行远端工具时才连接，catalog 与渐进曝光不要求预连接
- MCP 工具定义、执行授权和确认是三层独立边界：模型 loop 开始前解析并冻结最终可执行名称与确认策略，模型请求只消费 Pi 当前 active tool set。core 工具常驻；只有冻结 `protocolProfileId === "openai"`、模型 tokenizer 精确匹配、上下文窗口有效，且真实冻结 MCP 定义达到成本门控并在加入控制工具后仍有净节省时，长尾定义才通过 `McpSearch` / `McpLoad` 渐进曝光。加载只改变下一次请求的模型可见定义，不连接服务器、不执行工具、不扩张权限；任何成本不确定性都回退完整定义。本轮 MCP visibility plan 只依据冻结 catalog 与真实协议序列化成本，不按 provider/model 名猜测 native tool search
- Pi run-local active tool set 与 durable Session 分离：active set 由当前 AgentHarness 管理；activation marker 只服务产生它的 live 工具轮。durable Session 可以保留已消费 marker 作为 transcript，但新 root/delegated run 会重新应用冻结 boundary、重置 initial active set，并从本次模型上下文移除历史 `addedToolNames`；文件系统对账不从公开工具输出重建 marker。完整工具结果继续保留并按既有 evidence/read 机制续读；Pi 缺失 canonical 结果的 immediate failure 归一化为标准 ToolCallResult，保留原始文本并按取消、执行失败或 schema/runtime 拒绝标记不可盲目重试
- MCP 的 `enabledTools / autoApprovedTools` 保存远端协议原始方法名；MCP catalog 显式同时携带原始 `protocolName` 和模型可见 canonical `name`。二者只在 catalog 装配时建立映射，Panel、配置和远端 executor 不从 canonical name 反推协议名，Ordinary 工具事实也不保存第二套别名
- MCP 同步工具调用使用官方 SDK 的 `AbortSignal`、progress token 与 `resetTimeoutOnProgress`：当前限制的是无进度空闲时间，不是 Agent 总运行时间；持续进度会延长调用，超时按结果未知的失败事实记录并禁止盲目重试，用户取消保持 `cancelled` 且不把服务器误标为故障。每个服务器默认最多并发 4 个调用，超出后按 FIFO 排队且排队调用可取消；进度只形成 live-only 活动，不能改写终态。进程在同步调用完成前退出时，Ordinary 用已持久化的工具轮把缺失结果收口为 `tool_execution_outcome_unknown` 并进入 `blocked`，不会自动重放副作用。MCP Tasks 当前仍是上游实验 API，尚未作为稳定、可持久化恢复的产品能力暴露
- MCP connect、工具枚举和引用枚举的超时都会中止底层协议请求；连接尝试使用代次校验，迟到结果不能把已超时并断开的 client 重新标为 connected。run 释放时会取消并等待仍在连接的 lazy client，关闭是终止且幂等的，迟到连接不能重新写回 session。prompts/resources/templates 只有在远端明确返回 method-not-found 时才投影为空集合，其他枚举失败必须形成可观察错误。单个服务的工具目录以及一轮 run 聚合后的模型可见 MCP 工具目录默认都不得超过 128 项或 128 KiB 序列化 metadata；prompts/resources/templates 共享单服务 1,024 项、1 MiB 的引用目录预算。任一边界超出时整个对应目录明确失败，不缓存、发布或伪装成成功的半截目录。
- Sub-Agent 当前只向 Ordinary 的 Pi AgentTool 适配层贡献两个工具：`Agent` 调用已登记专家，`AgentSpawn` 创建一次性专家。capability catalog 只保存 catalog-only definition，不向 ToolRegistry 注册假 executor；模型曝光与冻结 run 的普通工具边界使用同一决策。它们使用父 run 冻结的可执行工具上限，声明只能进一步收窄权限；nested Agent 工具集中强制排除所有 Sub-Agent 工具，因此不能递归。nested Agent 使用父 Ordinary run 已冻结的模型与 reasoning 配置，当前不提供定义级模型覆盖或独立 step 限制；为兼容 `v0.3.2`，user/project/custom `SUB_AGENT.md` 中的 `model`、`max-steps` 或 `maxSteps` 只形成设置页可见的非致命诊断，不会进入正式定义、冻结 catalog 或执行输入。仓库内置文件暂时保留旧 metadata 字节且不显示诊断，仅用于维持已冻结 catalog 的 `contentHash` 身份，字段同样不生效。父 Ordinary run 使用 Pi AgentHarness 创建嵌套执行并继承取消信号，但 child stream 不形成独立 SSE/read-model。child 每轮模型产生的 scoped nested tool batch 必须先由父 Ordinary run 在同一 snapshot 中写入 `pendingNestedToolCalls`，成功后才允许 preflight、确认或执行；terminal nested result 与 pending 删除同一次提交，`approval_required` 继续保留 pending。同一父调用不能复用 scoped tool fact；进程中断后未决 nested request 会按原 `factId / parentToolCallFactId / toolName / input` 形成 `tool_execution_outcome_unknown`，父 Agent 调用仍独立形成 root unknown，两者都不重放，也不持久化 child Session。旧批量/专用续读工具、自研 runner、事件/trace store 与独立 read-model 已退役；完整输出作为父 Ordinary 工具事实交回，不做自动摘要。调用与结果只形成 Ordinary 标准 tool facts，不发布专用 `sub_agent.*` 事件（见 ADR-0026）
- 工程决定哪些工具可以执行、哪些需要命令确认、哪些被隐藏
- 静态确认元数据之外，安全策略还有逐调用动态门：带 `url` 且 method 为 POST/PUT/DELETE/PATCH 的工具调用（如 `HttpRequest` 外发提交）即使工具元数据允许免确认读取，也进入确认门；`full_access` 策略仍可显式跳过。文件工具的工作区边界对 symlink/junction 按 realpath 生效，工作区内的链接不能指向边界外的读写目标
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
- 每个进入稳定终态（`completed / failed / blocked / cancelled`）的 Ordinary run 都会由 `OrdinaryPathMemoryConnector` 自动采集为一条只读 `path-memory/v1` 记录，写入 `runtime/path-memory/records/`；实时通知与启动对账共享同一幂等来源键（一 run 一条），进程在终态后、写记忆前退出时下次启动补写。PathMemory 只保存来源身份、用户请求、冻结工作区、工具事实索引、终态和 `not_recorded` verification，不复制 transcript、assistant 正文、工具 input/output 或附件字节。记忆写入失败只形成诊断，不改写 Ordinary 终态
- 路径记忆当前范围是“第一阶段 + 部分第二阶段”（见 ADR-0032）：设置页提供只读 PathMemory 管理视图、显式删除和采集诊断；`/api/path-memory/*` 提供 list、确定性关键词 search（Latin 整词 + CJK bigram）、get、diagnostics 和 DELETE；`/api/experience-candidates/*` 提供用户显式 propose / revise / accept / reject / retire，revision 链 gapless 且治理状态互斥。显式删除写入 `runtime/path-memory/deletions/` tombstone，采集与启动对账遇 tombstone 返回 `suppressed` 并计入 `skippedDeleted` 诊断，重启后不会复活已删除记忆；恢复被删除的记忆没有默认路径，必须由未来的显式 command 清除 tombstone
- Agent 现在拥有模型自主笔记记忆（ADR-0033）：模型可通过 `NoteWrite` 主动全量改写全局笔记或当前工作区笔记，决定什么值得沉淀；新 run 启动时按 capability snapshot 的冻结工作区读取两本 Markdown 笔记，把原文注入系统提示词并随 run birth 保存对应的 SHA-256 内容版本。`AgentNotesFeature` 对同一 scope 的 Agent 写入串行化，文件仓储在每次 rename 尝试前重新比较当前内容版本；其他 run 或用户直接编辑 `NOTES.md` 后，旧 run 的 `NoteWrite` 会返回当前完整正文与版本，不会自动推进写入基线，模型必须合并后把 `currentVersion` 作为 `baseVersion` 显式重试。缺少冻结版本的旧 run 明确拒绝写入。Panel runtime-directory lease 排除第二个 AgentArbor 写者；不遵守 lease 的外部编辑器与单次 rename 系统调用之间仍存在普通 Markdown 文件无法消除的极小竞态窗口，不能把该边界表述为跨任意编辑器的绝对线性化 CAS。笔记位于 `runtime/agent-notes/`，用户可直接查看、编辑或删除；工程不自动抄录对话、不自动总结、不替模型决定何时记忆。笔记大小上限为 20,000 字符，超限时工具明确失败并由模型自行精简
- PathMemory 与 ExperienceCandidate 仍不进入模型上下文。PathMemory 现在是运行档案而非 Agent 记忆主线；向量检索、PathBias、后台 LLM 总结、Governance/Global Soil 仍未实现，只有出现真实需要时再按 ADR 出生
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
