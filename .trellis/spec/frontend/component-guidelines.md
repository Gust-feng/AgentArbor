# 组件规范

当前阶段的真实 UI 只有本地 Underground panel 原型。它不是正式组件系统，但必须形成可继承的最小交互规则，避免未来工作台从临时 console 或模板仪表盘包装起步。

## 生效规则

- 首屏必须是实时 Agent 工作流入口：左侧浅灰导航、中央白色 transcript 主画布、底部目标输入框、右侧运行状态和可折叠设置 / 调试详情。默认空态主标题为 `把想法交给地下组织`，主画布展示空 Agent transcript；不得再把 `网页研究`、`代码理解`、`证据整理`、`方向交接` 作为固定能力卡片模板。
- 首屏导航必须保留 `土壤`、`地下组织`、`地上组织`、`自动化` 的产品层级感，当前任务只允许地下组织可运行，不得把地上组织、果实或治理伪装成已实现功能。
- 右侧 inspector 默认展示用户可理解的待办、上下文和运行状态：无 live run 时待办必须是诚实空态，例如 `暂无待办` 和 `需要你确认的事项会显示在这里`，运行状态显示 `准备扎根`；真实运行中的用户澄清、失败、完成审查必须覆盖默认空态。概念图里的虚拟任务、固定百分比、固定文件数量、仓库授权待办、竞品调研待办、占位版本徽章和假版本号不得写死为产品数据。
- 配置中心必须降级为设置或详情入口，仍保留模型、默认 AI mode、API key 写入、搜索工具配置和脱敏状态，不得作为首屏主画布内容。
- 工作流阶段、rootlet kind、模型调用追踪、EventLog 与 Observation Snapshot 都属于折叠详情 / inspector / debug 信息；中央主画布只展示安全 transcript：用户目标、Agent 工作笔记、模型输出增量、工具调用摘要和最终结果。完成态可以展示方向判断和方向交接摘要，但不得把 raw EventLog、Observation JSON、model/tool refs 作为主内容大块压在首屏。
- 面板默认语言为简体中文。标题、表单标签、按钮、错误信息和状态标签必须用中文表达；`none`、`fake`、`openai-compatible`、EventLog type、phase / stage id 等稳定技术 id 可以保留，但必须配中文标签或摘要。
- UI 视觉应偏工作台：信息密度清晰、状态可扫读、宽屏下不重叠，移动窄屏下改为单列。
- 目标输入使用 textarea；AI mode 和默认 AI mode 使用 select；API key 使用 password input 且提交后清空。
- API key 不得以任何形式读回页面；只允许显示“密钥已配置 / 密钥未配置”这类脱敏状态。
- 运行状态固定映射为 `pending / running / completed / failed`，页面显示必须是中文标签加技术 id；错误摘要必须能展示 provider config failure 的中文说明。
- 运行跟踪必须来自 panel HTTP 的 trace / summary / Observation Snapshot / sanitized config 派生投影，展示当前 phase / stage / status、等待点、工作流阶段状态、rootlet kind 集群状态、按 kind 的模型 requested / completed / failed 计数、按 kind 的候选计数、AI candidate / fallback 计数、模型事件序列、通过 validation 的 model visible output、收束结果、方向包校验和配置 / provider 状态；不得让前端维护第二套运行事实。
- EventLog 展示使用 trace / summary / event type / observation event view，并放在辅助位置；不得把纯 EventLog 或 JSON dump 当成用户理解工作流的主要信息架构，不得展示 raw EventLog payload 或完整模型 prompt。
- 点击启动后必须先渲染运行中 transcript，然后调用 async run API 创建 job，并优先连接 `GET /api/underground/runs/:runId/stream` SSE；SSE 不可用时每 1-2 秒 polling 当前 run。SSE 和 polling 都必须消费同一个 `PanelRunStreamEvent` 安全投影，避免前端维护第二套运行事实。
- Agent Transcript 只能展示可审计工作笔记，例如观察、动作、产出、依据、下一步和引用；模型输出增量只能来自通过 `outputContract` validation 和 `visibleOutput.fieldTypes` 展示策略的 visible output 安全投影或等价安全摘要。它不得展示 provider hidden reasoning、完整 prompt、provider raw response、API key、token、未清洗错误、未校验模型输出或 rootlet parser 会拒绝的候选字段。
- 组件化目录未出生前，不编造 props、hook、store 或组件库规则；`panel-assets.ts` 内的 DOM 更新逻辑保持简单、可替换。
- 不把产品架构中的 agent 组织模型误写成 UI 组件规范。

进入实现前，优先遵守 `AGENTS.md`、`docs/开发指南/` 和 `.trellis/spec/guides/agentarbor-governance-guide.md`。
