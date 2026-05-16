# 前端质量规范

当前阶段只有本地桌面工作会话面板，没有正式前端测试框架、构建链或 lint 工具链。质量门禁仍由 TypeScript、node:test、panel command smoke 和人工/轻量浏览器检查承担。

## 生效规则

- `pnpm build` 必须通过，保证 `panel-assets.ts`、`panel-server.ts` 和 `panel.ts` 可编译。
- `pnpm test` 必须覆盖 panel config API、桌面运行 API、AI 禁用模式拒绝、fake AI run、openai-compatible 缺 key / 缺 model、真实 AI 输出契约失败的安全诊断、async run job、running/completed polling、SSE stream、cursor 续传、stream 断开不影响后台 run、HTTP JSON / SSE 脱敏、provider fetch 未调用、默认中文 UI、左侧会话导航、空活动流、消息输入、主画布报告 / 成果摘要、运行中轻量活动追加、完成态最终结果、诊断 / Agents / 设置详情、模型输出增量、同一 model request 的 live delta 不被完成后派生 delta 重复展示，以及运行追踪投影。
- `pnpm panel:smoke` 必须能启动本地服务、打印 URL 并退出。
- `pnpm panel:desktop:smoke` 必须能启动 Electron 桌面宿主的 smoke 路径、关闭本地服务并退出，不创建真实窗口，不要求 CI 具备可交互桌面会话。
- 本地 panel 默认推荐 `openai-compatible` 作为真实工作流入口，但配置不完整时必须停在配置边界并显示待办；不得发起真实网络，不得自动 fallback 成 fake 成功。默认 `pnpm test` 仍通过显式 fake/stub 路径保持稳定。
- 本地 panel 必须展示中文状态和错误文本；稳定技术 id 只能进入诊断、调试投影或测试契约，不得出现在普通首屏状态标签中。
- 本地 panel 默认静态 HTML 必须证明概念图只作为布局参考：不能包含固定能力卡片模板文案、虚拟任务名、虚构用户待办、固定上下文百分比、固定项目文件数量、占位版本徽章、不存在的产品版本号，首屏也不能出现 `Desktop Shell`、`Task Soil`、`Plan Package`、`Observation Panel`、`Agent Run Tree`、`provider`、`方向智能`、`执行智能` 等内部术语；没有真实运行数据时必须显示诚实的空对话状态。
- 本地 panel 的首屏必须展示桌面助手会话：左侧最近对话和能力入口、中间持续对话 / 按需升级的工作任务、底部常驻输入框。空态不显示右侧上下文栏，不显示报告壳，不显示固定流程，也不显示“本地工作”说明块。发送新消息必须追加在当前会话中，并把最近可见对话作为安全上下文引用进入下一次请求。真实工作任务需要浅层监督时通过详情抽屉或按需展开的上下文呈现待办、材料、证据和近期活动。完成或失败时主滚动区域应回到会话中的回答或结果块，而不是停留在底部活动流。`PanelRunStreamEvent` 展示用户目标、工作笔记、模型输出增量、工具调用摘要和最终结果；rootlet / model / EventLog / Observation 细节进入诊断、Agents 或可展开调试详情。可见输出必须经过 outputContract validation 和 `visibleOutput.fieldTypes` 展示策略，过长字段必须截断并标注 truncated；validation failed 或 rootlet parser 会拒绝的输出不得展示为 approved model output。真实 AI 输出契约失败必须在诊断区展示 purpose、contract id、failure kind 和 call ref，仍不得展示 raw output。
- Observation Snapshot 可以保留为折叠调试视图，但不得替代右侧上下文栏、会话结果块或成果摘要。
- 基础 UI 必须在桌面宽度下可读，按钮和文本不能重叠，body/html 不得产生横向滚动；默认首屏不应出现右侧卡片墙；开发者详情抽屉默认关闭；窄屏布局必须单列化。
- Electron 桌面壳必须保持薄宿主边界和保守 renderer 设置，不新增 raw EventLog、完整 prompt、provider raw response、工具 raw output、API key 或 token 展示入口。
- 不编造前端测试框架、浏览器验证命令、可访问性工具或 CI 门禁。只有真实前端工具链出生后，才能记录对应门禁。

进入实现前，优先遵守 `AGENTS.md`、`docs/开发指南/` 和 `.trellis/spec/guides/agentarbor-governance-guide.md`。
