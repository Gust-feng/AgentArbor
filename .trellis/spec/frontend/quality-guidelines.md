# 前端质量规范

当前阶段只有本地 Underground panel 原型，没有正式前端测试框架、构建链或 lint 工具链。质量门禁仍由 TypeScript、node:test、panel command smoke 和人工/轻量浏览器检查承担。

## 生效规则

- `pnpm build` 必须通过，保证 `panel-assets.ts`、`panel-server.ts` 和 `panel.ts` 可编译。
- `pnpm test` 必须覆盖 panel config API、no-AI run、fake AI run、openai-compatible 缺 key / 缺 model、async run job、running/completed polling、HTTP JSON 脱敏、provider fetch 未调用、默认中文 UI、运行中骨架提示、工作流阶段时间线、Rootlet 工作区、模型调用追踪、模型输出、Agent Transcript、收束解释、方向包结果和运行追踪投影。
- `pnpm panel:smoke` 必须能启动本地服务、打印 URL 并退出。
- 本地 panel 默认不得发起真实网络；只有用户显式选择 `openai-compatible` 且配置中心完整时才允许进入真实 provider 路径。
- 本地 panel 必须展示中文状态和错误文本，同时保留稳定技术 id 作为括号内容或旁注；不得把英文技术 id 当成唯一可读标签。
- 本地 panel 的运行追踪必须展示 phase / stage / status、等待点、工作流阶段时间线、rootlet kind 状态、按 kind 的模型计数、按 kind 的候选计数、AI candidate / fallback、模型事件序列、model visible output 安全投影、Agent Transcript、收束结果、方向包校验和 provider 配置状态。可见输出必须经过 outputContract validation 和 `visibleOutput.fieldTypes` 展示策略，过长字段必须截断并标注 truncated；validation failed 或 rootlet parser 会拒绝的输出不得展示为 approved model output。
- Observation Snapshot 可以保留为折叠调试视图，但不得替代运行总览、阶段时间线、Rootlet 工作区、模型追踪、收束解释或方向包结果。
- 基础 UI 必须在桌面宽度下可读，按钮和文本不能重叠；窄屏布局必须单列化。
- 不编造前端测试框架、浏览器验证命令、可访问性工具或 CI 门禁。只有真实前端工具链出生后，才能记录对应门禁。

进入实现前，优先遵守 `AGENTS.md`、`docs/开发指南/` 和 `.trellis/spec/guides/agentarbor-governance-guide.md`。
