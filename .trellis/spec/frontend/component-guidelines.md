# 组件规范

当前阶段的真实 UI 是本地桌面工作会话面板。它不是正式组件系统，但必须形成可继承的最小交互规则，避免未来工作台从临时 console、地下-only 面板、模型调用监控器或架构展示页包装起步。

## 生效规则

- 首屏必须是成熟桌面助手式会话：左侧会话导航，中间是持续对话与按需进入深度模式的工作流，底部是常驻输入框。右侧工作上下文默认不常驻，`待办 / 上下文 / 证据 / 近期活动` 进入详情抽屉或在真实工作任务中按需展开。默认空态主标题为 `在忙什么呢？`，首屏优先表达“可以随便问，也可以交给它任务”。
- 工作台必须支持随意问题。普通问答、闲聊、模型身份问题、小解释、小翻译或不需要工作区探索的请求，默认进入普通工具型 Root Agent 对话并由 LLM 直接回答；模型需要材料时可以调用授权 `search` / `read` 工具。不得用关键词、长度或固定工程规则自动升级模式，也不得强行派生 child agent、生成报告、显示空 artifact 或把问题包装成项目分析任务。
- 深度模式必须是显式入口。用户切换到 `深度模式` / `runMode = "deep"` 后，系统才进入 Underground Cognitive Runtime，做目标成形、多路探索、派生 child/rootlet agent、父层综合和收束；当前阶段停在地下组织 / Plan 边界，不进入 Aboveground 执行，也不伪装成通用 Work Session。
- 同一会话必须支持连续对话。发送新消息只能追加用户回合和助手回合，不能清空已有 transcript；后续请求应把最近可见对话摘要作为安全上下文引用传给后端，避免每轮都变成孤立任务。
- 首屏不得出现内部架构术语或工程监控口径，包括 `Desktop Shell`、`Task Soil`、`Plan Package`、`Observation Panel`、`Agent Run Tree`、`provider`、`方向智能`、`执行智能`。这些术语只能出现在设置、诊断、Agents 或折叠调试详情中。
- 左侧导航只表达用户工作空间：`新对话`、技能、例行任务、工具、设置、最近对话、正在运行或需要确认的任务。不得把 `土壤`、`方向智能`、`执行智能`、rootlet、运行时层级或“本地工作”说明块当作产品导航。
- 中央主工作区服务用户完成任务。空态展示任务输入方向；运行中展示用户输入、可读活动笔记、已执行动作、已读材料和结果草稿；完成态把报告 / 成果、关键发现、证据、风险、不确定性和下一步作为会话中的结果块展示。不得把 raw EventLog、Observation JSON、model/tool refs 或内部阶段图当成主内容。
- 完成态必须把报告、文件、表格、补丁预览或其他产物作为主会话里的可审阅对象，而不是把结果拆成一组等权摘要卡。没有真实产物时，也要诚实显示“尚未形成结果”，不能用假预览补位。
- 直接回答完成态不是 artifact。主会话展示回答正文、必要的不确定性、少量可继续追问建议和可选证据 refs；右侧只保留轻量活动和上下文，不展示固定流程图或报告壳。
- 右侧上下文栏不是首屏默认结构。普通问答和空态不显示右侧栏；真实工作会话需要浅层监督时，可以通过详情抽屉或按需展开的工作上下文展示 `待办`、`上下文 / 材料`、`证据` 和 `近期活动`。它不是卡片墙，不展示成果大预览，不展示架构监控。诊断、Agents、设置进入默认隐藏的开发者详情抽屉，默认不抢占首屏。
- 首屏品牌、导航和操作控件必须使用有语义的中文文案或可理解图标，不使用 `A/S/T/F/I/M/D` 这类单字母占位按钮；诊断入口也应表达为“详情 / 诊断”，不能像工程调试热键。
- 配置中心必须降级到设置或详情入口，仍保留模型、默认 AI mode、API key 写入、搜索工具配置和脱敏状态。配置不完整时必须显示可操作待办并停止在配置边界，不能自动降级成 fake 成功。fake AI 只作为测试模式明示。
- 任务输入可以携带文件、网页、上下文引用、权限引用和只读短预览，但这些高级输入默认收进 `附件` 或等价入口；UI 只能收集引用、短摘要和短 preview，不读取或展示未授权文件正文。旧 goal-only 输入必须继续兼容。
- 工作流阶段、rootlet kind、模型调用追踪、EventLog 与 Observation Snapshot 都属于诊断 / Agents / 调试详情。普通 transcript 展示人类可理解活动，例如“正在阅读上下文”“正在整理证据”“正在生成报告”，不得直接显示 event type 或架构阶段。
- 面板默认语言为简体中文。标题、表单标签、按钮、错误信息和状态标签必须用中文表达；`none`、`fake`、`openai-compatible`、EventLog type、phase / stage id 等稳定技术 id 可以保留，但必须配中文标签或摘要。
- UI 视觉应偏成熟桌面助手：安静、克制、留白充分、输入框明确，避免深色大块标题、装饰性 hero、固定流程墙和卡片堆叠。宽屏下不重叠、不产生横向滚动，移动窄屏下改为单列。详情抽屉默认关闭，失败时可以提示打开诊断，但 Agents、设置和折叠调试区不得挤占主画布。
- 目标输入使用 textarea；AI mode 和默认 AI mode 使用 select；模型配置 API key 使用普通文本输入，加载和保存后保留当前真实值，便于用户检查本地配置。
- 模型配置入口可以读回并展示真实模型 API key，便于用户检查和迁移本地配置；运行响应、会话、日志、工具输出、诊断、持久化记录和非配置入口仍只能展示“密钥已配置 / 密钥未配置”等安全状态。
- 运行状态固定映射为 `pending / running / completed / failed`，普通首屏显示中文标签；技术 id 只在诊断、调试投影或测试契约中出现。错误摘要必须能展示配置失败、合约失败或模型调用失败的中文说明。
- 运行跟踪必须来自 panel HTTP 的 canvas / trace / summary / Observation Snapshot / sanitized config 派生投影；前端不得维护第二套运行事实。首屏只消费这些投影中的用户级字段，诊断 / Agents / 调试详情才展示 phase / stage、等待点、模型事件计数、工具事件计数、可见输出、配置状态和安全 refs。
- 诊断区必须展示模型配置状态、输出契约、模型 / 工具流、失败诊断和安全 refs。模型调用失败必须显示安全的 purpose、contract id、model、validation status、failure kind 和 call ref；不能只显示 `panel_internal_error`。
- Agents 区可以展示主 agent、child/rootlet runs、状态、spec id、agent id、role、允许工具、预算、输入 refs、输出 refs、confidence、uncertainty 和父层综合摘要。该区域只消费 `tracking.agentRunTree`、canvas 和 transcript 安全投影，不得读取 raw EventLog payload、完整 prompt、provider raw response、hidden reasoning、raw tool output、secret、token、runtime/store 引用或未授权文件正文。
- EventLog 展示使用 trace / summary / event type / observation event view，并放在辅助位置；不得把纯 EventLog 或 JSON dump 当成用户理解工作流的主要信息架构，不得展示 raw EventLog payload 或完整模型 prompt。
- 点击启动后必须先渲染运行中活动流，然后调用 async run API 创建 job。首选 `POST /api/desktop/runs`、`GET /api/desktop/runs/:runId` 和 `GET /api/desktop/runs/:runId/stream`；旧 `/api/underground/*` 只作为兼容路径。SSE 不可用时每 1-2 秒 polling 当前 run。SSE 和 polling 都必须消费同一个 `PanelRunStreamEvent` 安全投影。
- Desktop run canvas 若包含 `chat.answer`，主 transcript 的助手回合应直接显示该回答；若包含历史 `workSession.directAnswer`，也只能作为兼容回答展示。`workSession.report` / `workSession.artifact` 缺失时不得补假结果块。普通问题默认进入 `desktop_chat`，不得为了显示流程而进入深度模式；复杂方向成形只有用户显式选择深度模式后才进入 Underground canvas。
- 活动流只能展示可审计工作笔记，例如观察、动作、产出、依据、下一步和引用；模型输出增量只能来自通过 `outputContract` validation 和 `visibleOutput.fieldTypes` 展示策略的 visible output 安全投影或等价安全摘要。它不得展示 provider hidden reasoning、完整 prompt、provider raw response、API key、token、未清洗错误、未校验模型输出或 rootlet parser 会拒绝的候选字段。
- 面板目标是 Trae/Cursor 式桌面 AI 工作会话，而不是复制 Codex 的 Git worktree、diff、终端或 PR 功能；本阶段不得在 panel 中加入未出生的工程工作区功能。
- 组件化目录未出生前，不编造 props、hook、store 或组件库规则；`panel-assets.ts` 内的 DOM 更新逻辑保持简单、可替换。
- 不把产品架构中的 agent 组织模型误写成 UI 组件规范。

进入实现前，优先遵守 `AGENTS.md`、`docs/开发指南/` 和 `.trellis/spec/guides/agentarbor-governance-guide.md`。
