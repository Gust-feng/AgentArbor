# 前端质量规范

当前阶段只有本地 Underground panel 原型，没有正式前端测试框架、构建链或 lint 工具链。质量门禁仍由 TypeScript、node:test、panel command smoke 和人工/轻量浏览器检查承担。

## 生效规则

- `pnpm build` 必须通过，保证 `panel-assets.ts`、`panel-server.ts` 和 `panel.ts` 可编译。
- `pnpm test` 必须覆盖 panel config API、no-AI run、fake AI run、openai-compatible 缺 key / 缺 model、async run job、running/completed polling、HTTP JSON 脱敏、provider fetch 未调用、默认中文 UI、IDE / workbench 外壳、左侧产品导航、空态标题 / 副标题 / 能力卡片、右侧待办 / 上下文 / 运行状态、运行中骨架提示、完成态方向判断 / 方向交接摘要、设置 / 调试详情、模型输出、Agent Transcript 和运行追踪投影。
- `pnpm panel:smoke` 必须能启动本地服务、打印 URL 并退出。
- `pnpm panel:desktop:smoke` 必须能启动 Electron 桌面宿主的 smoke 路径、关闭本地服务并退出，不创建真实窗口，不要求 CI 具备可交互桌面会话。
- 本地 panel 默认不得发起真实网络；只有用户显式选择 `openai-compatible` 且配置中心完整时才允许进入真实 provider 路径。
- 本地 panel 必须展示中文状态和错误文本，同时保留稳定技术 id 作为括号内容或旁注；不得把英文技术 id 当成唯一可读标签。
- 本地 panel 默认静态 HTML 必须证明概念图只作为布局参考：不能包含虚拟任务名、虚构用户待办、固定上下文百分比、固定项目文件数量、占位版本徽章或不存在的产品版本号；没有真实运行数据时必须显示诚实空态。
- 本地 panel 的运行追踪必须展示 phase / stage / status、等待点、地下活动流、rootlet kind 状态、按 kind 的模型计数、按 kind 的候选计数、AI candidate / fallback、模型事件序列、model visible output 安全投影、Agent Transcript、收束结果、方向包校验和 provider 配置状态。首屏主画布只展示用户可理解的活动流或方向结果，rootlet / model / EventLog / Observation 细节进入 inspector 或可展开详情。可见输出必须经过 outputContract validation 和 `visibleOutput.fieldTypes` 展示策略，过长字段必须截断并标注 truncated；validation failed 或 rootlet parser 会拒绝的输出不得展示为 approved model output。
- Observation Snapshot 可以保留为折叠调试视图，但不得替代右侧运行状态、地下活动流、完成态方向判断或方向交接摘要。
- 基础 UI 必须在桌面宽度下可读，按钮和文本不能重叠；窄屏布局必须单列化。
- Electron 桌面壳必须保持薄宿主边界和保守 renderer 设置，不新增 raw EventLog、完整 prompt、provider raw response、工具 raw output、API key 或 token 展示入口。
- 不编造前端测试框架、浏览器验证命令、可访问性工具或 CI 门禁。只有真实前端工具链出生后，才能记录对应门禁。

进入实现前，优先遵守 `AGENTS.md`、`docs/开发指南/` 和 `.trellis/spec/guides/agentarbor-governance-guide.md`。
