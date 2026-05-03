# 组件规范

当前阶段的真实 UI 只有本地 Underground panel 原型。它不是正式组件系统，但必须形成可继承的最小交互规则，避免未来工作台从临时 console 包装起步。

## 生效规则

- 首屏必须是运行界面：目标输入、AI mode、配置状态、运行按钮、运行总览、工作流阶段时间线、Rootlet 工作区、模型调用追踪、收束解释和方向包结果；EventLog 与 Observation Snapshot 只能作为辅助 / 调试视图，不能再作为主内容大块压在页面上。
- 面板默认语言为简体中文。标题、表单标签、按钮、错误信息和状态标签必须用中文表达；`none`、`fake`、`openai-compatible`、EventLog type、phase / stage id 等稳定技术 id 可以保留，但必须配中文标签或摘要。
- UI 视觉应偏工作台：信息密度清晰、状态可扫读、宽屏下不重叠，移动窄屏下改为单列。
- 目标输入使用 textarea；AI mode 和默认 AI mode 使用 select；API key 使用 password input 且提交后清空。
- API key 不得以任何形式读回页面；只允许显示“密钥已配置 / 密钥未配置”这类脱敏状态。
- 运行状态固定映射为 `pending / running / completed / failed`，页面显示必须是中文标签加技术 id；错误摘要必须能展示 provider config failure 的中文说明。
- 运行跟踪必须来自 panel HTTP 的 summary / Observation Snapshot / sanitized config 派生投影，展示当前 phase / stage / status、工作流阶段状态、rootlet kind 集群状态、按 kind 的模型 requested / completed / failed 计数、按 kind 的候选计数、AI candidate / fallback 计数、模型事件序列、收束结果、方向包校验和配置 / provider 状态；不得让前端维护第二套运行事实。
- EventLog 展示使用 summary / event type / observation event view，并放在辅助位置；不得把纯 EventLog 或 JSON dump 当成用户理解工作流的主要信息架构，不得展示 raw EventLog payload 或完整模型 prompt。
- 点击启动后即使没有 SSE / WebSocket，也必须先渲染运行中骨架：目标、AI mode、provider 脱敏状态、工作流阶段和“正在等待地下运行返回；当前版本为单请求模式，完成后刷新完整事件”提示，避免真实 provider 等待期间页面空白。
- 组件化目录未出生前，不编造 props、hook、store 或组件库规则；`panel-assets.ts` 内的 DOM 更新逻辑保持简单、可替换。
- 不把产品架构中的 agent 组织模型误写成 UI 组件规范。

进入实现前，优先遵守 `AGENTS.md`、`docs/开发指南/` 和 `.trellis/spec/guides/agentarbor-governance-guide.md`。
