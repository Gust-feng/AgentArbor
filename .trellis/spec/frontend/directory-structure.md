# 前端目录结构

当前阶段只有本地 Desktop Shell / Observation Panel 原型，UI 代码不单独出生 `src/frontend/`。面板使用 Node 内置 HTTP server 发送静态 HTML/CSS/JS，用于验证桌面工作台的最小读写面。

## 当前目录

- `src/app/panel.ts`：panel CLI 入口，由 `pnpm panel` 调用，只负责启动本地服务并打印 URL。
- `src/app/panel-args.ts`：panel 启动参数解析，由浏览器调试入口和桌面入口共享。
- `src/app/panel-server.ts`：本地 HTTP API 和运行编排，提供 Desktop Shell 首选入口和地下-only 兼容入口；只能调用配置中心、运行时 API、demo summary、Observation Snapshot 和 Main Canvas 安全投影，不能保存第二套运行事实。
- `src/app/panel-assets.ts`：静态 HTML/CSS/JS 字符串；不引入前端构建链；默认文案使用简体中文，并用中文标签包裹必要技术 id。
- `src/app/panel-desktop-launcher.ts`：桌面宿主生命周期薄壳，负责本地 panel server 和窗口依赖的启停编排，不承载新的 UI 状态或运行事实。
- `src/app/panel-desktop.ts`：Electron 桌面入口，由 `pnpm panel:desktop` 调用，只创建保守安全默认的窗口并加载本地 panel URL。
- `src/app/panel-server.test.ts`：panel HTTP API、安全响应和运行路径测试。

## 生效规则

- 不创建 `src/frontend/`、`pages/`、`components/`、`hooks/`、`stores/` 或 `assets/` 目录来伪装正式前端。
- 不引入 React、Vite、Next、Tailwind、组件库或状态管理框架。
- Electron 桌面宿主不等于正式前端框架出生；不得因此新增组件目录、状态管理目录或第二套 UI 资产入口。
- panel 只能作为 Desktop Shell 工作台原型，不能绕过 EventLog、Observation Snapshot、配置中心、IntelligenceChannel、CandidatePool、Convergence 或 Plan validation。
- Desktop Shell 首选入口可以展示 Task Soil、Plan、Aboveground 最小执行结果和 Fruits 的安全摘要；地下-only 兼容入口仍只展示地下运行和 Plan Package 摘要。
- API key 输入只允许写入 secret store，页面和 HTTP 响应只能展示 configured 状态。

进入实现前，优先遵守 `AGENTS.md`、`docs/开发指南/` 和 `.trellis/spec/guides/agentarbor-governance-guide.md`。
