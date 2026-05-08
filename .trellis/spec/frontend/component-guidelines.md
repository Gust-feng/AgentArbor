# 组件规范

当前阶段的真实 UI 是本地 Desktop Shell / Observation Panel 原型。它不是正式组件系统，但必须形成可继承的最小交互规则，避免未来工作台从临时 console、地下-only 面板或模板仪表盘包装起步。

## 生效规则

- 首屏必须是 Desktop Shell 任务入口：左侧任务记录，中央 Main Canvas + transcript，底部任务输入框，右侧运行监督栏和可折叠设置 / 调试详情。默认空态主标题为 `Desktop Shell 工作台`，主画布展示 Plan / Fruit 空态；不得再把 `网页研究`、`代码理解`、`证据整理`、`方向交接` 作为固定能力卡片模板。
- 首屏导航必须保留 `土壤`、`方向智能`、`执行智能`、`自动化` 的产品层级感，但用户入口是统一 Desktop Shell。当前任务允许展示 Aboveground 最小 consumer 和 Fruits 摘要，但不得把完整 Governance、Capability Asset 或多层递归 Agent Fabric 伪装成已实现功能。
- 右侧 inspector 是产品级 `运行监督工作台`，不是调试信息堆叠区，也不是卡片越多越好的信息墙。它采用轻量标题、分段 tab 和按需详情：默认 `监督` 分区展示闭环路径、运行健康和下一步；`真实 AI` 分区展示 provider / contract / tool 诊断；`Agent 树` 分区展示 Agent Run Tree、选中 agent 和父层 synthesis；`设置` 分区承载模型 / 工具配置和折叠调试区。无 live run 时必须是诚实空态，真实运行中的配置边界、模型失败、合约失败、用户澄清、完成审查必须覆盖默认空态。概念图里的虚拟任务、固定百分比、固定文件数量、仓库授权待办、竞品调研待办、占位版本徽章和假版本号不得写死为产品数据。
- 配置中心必须降级为设置或详情入口，仍保留模型、默认 AI mode、API key 写入、搜索工具配置和脱敏状态，不得作为首屏主画布内容。Desktop Shell 的推荐入口是 `openai-compatible`；配置不完整时必须显示模型名 / API key 待办并停止在配置边界，不能自动降级成 fake AI 成功。fake AI 只作为测试模式明示。
- Desktop Shell 任务输入可以携带 Task Soil context refs、permission refs 和只读短预览；UI 只能收集引用、短摘要和短 preview，不读取或展示未授权文件正文。旧 goal-only 输入必须继续兼容。
- 工作流阶段、rootlet kind、模型调用追踪、EventLog 与 Observation Snapshot 都属于折叠详情 / inspector / debug 信息。中央主画布展示 Task Soil、Plan Package、Aboveground 最小执行结果、Fruits 和一层解释；transcript 展示用户目标、Agent 工作笔记、模型输出增量、工具调用摘要和最终结果。不得把 raw EventLog、Observation JSON、model/tool refs 作为主内容大块压在首屏。
- 面板默认语言为简体中文。标题、表单标签、按钮、错误信息和状态标签必须用中文表达；`none`、`fake`、`openai-compatible`、EventLog type、phase / stage id 等稳定技术 id 可以保留，但必须配中文标签或摘要。
- UI 视觉应偏成熟桌面工作台：安静、克制、可扫读，避免深色大块标题、装饰性 hero 和卡片堆叠。宽屏下不重叠、不产生横向滚动，移动窄屏下改为单列。右侧监督栏首屏应优先呈现运行闭环路径和运行健康；失败时自动聚焦真实 AI 诊断；Agent Run Tree、设置和折叠调试区不得挤占主画布。
- 目标输入使用 textarea；AI mode 和默认 AI mode 使用 select；API key 使用 password input 且提交后清空。
- API key 不得以任何形式读回页面；只允许显示“密钥已配置 / 密钥未配置”这类脱敏状态。
- 运行状态固定映射为 `pending / running / completed / failed`，页面显示必须是中文标签加技术 id；错误摘要必须能展示 provider config failure 的中文说明。
- 运行跟踪必须来自 panel HTTP 的 canvas / trace / summary / Observation Snapshot / sanitized config 派生投影，展示当前 phase / stage / status、等待点、工作流阶段状态、rootlet kind 集群状态、按 kind 的模型 requested / completed / failed 计数、按 kind 的候选计数、AI candidate / fallback 计数、模型事件序列、通过 validation 的 model visible output、收束结果、Plan Package 校验和配置 / provider 状态；不得让前端维护第二套运行事实。
- 右侧运行监督工作台必须展示真实 AI 配置状态、真实 AI 诊断、模型 / 工具流、Agent Run Tree、父层 synthesis、风险 / 不确定性和下一步，但默认只呈现当前用户需要理解的层级。模型调用失败必须显示安全的 purpose、contract id、model、validation status、failure kind 和 call ref；不能只显示 `panel_internal_error`。Agent Run Tree 的安全视图包含 root manager、派生 child/rootlet runs、状态、spec id、agent id、role、rootlet kind、允许工具、预算、输入 refs、输出 refs、confidence、uncertainty 和最新父层 synthesis 摘要。该区域只消费 `tracking.agentRunTree`、canvas 和 transcript 安全投影，不得读取 raw EventLog payload、完整 prompt、provider raw response、hidden reasoning、raw tool output、secret、token、runtime/store 引用或未授权文件正文。
- EventLog 展示使用 trace / summary / event type / observation event view，并放在辅助位置；不得把纯 EventLog 或 JSON dump 当成用户理解工作流的主要信息架构，不得展示 raw EventLog payload 或完整模型 prompt。
- 点击启动后必须先渲染运行中 transcript，然后调用 async run API 创建 job。Desktop Shell 首选 `POST /api/desktop/runs`、`GET /api/desktop/runs/:runId` 和 `GET /api/desktop/runs/:runId/stream`；旧 `/api/underground/*` 只作为兼容路径。SSE 不可用时每 1-2 秒 polling 当前 run。SSE 和 polling 都必须消费同一个 `PanelRunStreamEvent` 安全投影，避免前端维护第二套运行事实。
- Agent Transcript 只能展示可审计工作笔记，例如观察、动作、产出、依据、下一步和引用；模型输出增量只能来自通过 `outputContract` validation 和 `visibleOutput.fieldTypes` 展示策略的 visible output 安全投影或等价安全摘要；派生、等待和父层综合只能展示 `agent.delegation.*`、`agent.child.*` 和 `agent.parent_synthesis.*` 的安全摘要。它不得展示 provider hidden reasoning、完整 prompt、provider raw response、API key、token、未清洗错误、未校验模型输出或 rootlet parser 会拒绝的候选字段。
- 面板目标是 Codex 式 agent 工作流监督台，而不是复制 Codex 的 Git worktree、diff、终端或 PR 功能；本阶段不得在 panel 中加入未出生的工程工作区功能。
- 组件化目录未出生前，不编造 props、hook、store 或组件库规则；`panel-assets.ts` 内的 DOM 更新逻辑保持简单、可替换。
- 不把产品架构中的 agent 组织模型误写成 UI 组件规范。

进入实现前，优先遵守 `AGENTS.md`、`docs/开发指南/` 和 `.trellis/spec/guides/agentarbor-governance-guide.md`。
