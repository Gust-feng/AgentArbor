# brainstorm: 独立面板程序

## Goal

把当前本地面板从“用户手动打开浏览器访问的网页应用”升级为“可直接启动的独立桌面面板程序”。第一版目标不是重写 UI，而是把现有面板宿主化，让用户启动后直接进入 AgentArbor 面板，不再依赖外部浏览器作为主要入口。

## What I already know

* 当前面板入口是 `src/app/panel.ts`，它启动 `src/app/panel-server.ts` 并打印本地 URL，默认需要用户自行在浏览器中打开。
* 面板 UI 目前仍由 `src/app/panel-assets.ts` 提供静态 HTML/CSS/JS，`package.json` 里只有 `pnpm panel` 和 `pnpm panel:smoke`，没有正式桌面宿主。
* 现有面板已经是 IDE / workbench 风格首屏，承载了模型配置、工具配置、运行态、待办、上下文和调试详情；这次任务的重点是宿主和启动体验，不是重新发明一套 UI。
* 仓库当前约束仍要求保留 TypeScript / pnpm / node:test 主线，不轻易引入新的长期技术债。
* 官方资料显示，Electron、Tauri 和 WebView2 都能承载嵌入式桌面面板，但它们的工具链、宿主模型和平台边界差异很大。

## Research References

* [`.trellis/tasks/05-05-panel-desktop-shell/research/desktop-shell-options.md`](.trellis/tasks/05-05-panel-desktop-shell/research/desktop-shell-options.md) - 初步比较 Electron、Tauri 和 WebView2 的宿主成本与适配边界。

## Assumptions (temporary)

* MVP 先把“外部浏览器依赖”去掉，但仍允许面板用 HTML/CSS/JS 在嵌入式 webview 里渲染。
* 第一版优先保留现有面板 server 和静态资产，尽量不重写运行时与数据流。
* 默认先按 Windows-first 思路推进，除非后续确认必须同步做跨平台宿主。

## Settled Decisions

* MVP 桌面宿主选择 Electron，原因是它能最大化复用当前 TypeScript / Node panel server 与静态面板资产。
* 第一版桌面壳只负责 Electron window 生命周期和 `startLocalPanelServer()` 启停，不新增 IPC 数据面，也不绕过现有 panel HTTP / summary / Observation 投影边界。
* `pnpm panel` 和 `pnpm panel:smoke` 继续作为浏览器调试入口；`pnpm panel:desktop` 和 `pnpm panel:desktop:smoke` 是新增桌面宿主入口。
* 安装器、自动更新、系统托盘、原生菜单和跨平台打包策略不在本任务范围内。

## Requirements (evolving)

* 独立面板程序启动后，用户不需要手动打开浏览器就能进入 AgentArbor 面板。
* 现有面板的 workbench 视觉与信息架构要继续保留，宿主变化不能把产品体验打散。
* 浏览器调试入口 `pnpm panel` 继续默认使用固定 `127.0.0.1:9090`；桌面入口 `pnpm panel:desktop` 默认使用动态端口 `0`，只有显式传入 `--port` 时才使用固定端口。
* 桌面宿主必须复用当前面板的安全边界：配置脱敏、EventLog / Observation 安全投影、工具调用摘要和 secret 不外泄。
* 桌面程序必须有可重复启动、关闭和 smoke 验证的入口。
* 当前 `panel` 的调试 / 配置 / 运行路径要尽量沿用，避免出现两套平行实现。
* Electron `BrowserWindow` 默认必须保持保守 renderer 设置：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`，并禁用 `webviewTag`。

## Acceptance Criteria (evolving)

* [x] 启动后可直接进入独立桌面面板，而不是先拿到一个要手动复制到浏览器里的本地 URL。
* [x] 面板仍能展示当前 workbench 首屏和运行态。
* [x] 桌面宿主不破坏现有配置脱敏、运行追踪和工具调用可见性边界。
* [x] 现有 panel 相关测试继续通过，且新增桌面启动 smoke 可验证可启动、可关闭。
* [x] 不引入 raw secret、raw provider response 或完整 prompt 的新泄漏面。

## Definition of Done

* Tests added/updated for desktop start path and existing panel regressions.
* Build / test / smoke gate remain green.
* Docs and task board updated to reflect the new desktop-hosted panel direction.
* New host choice is documented clearly enough that后续实现不会再反复改入口。

## Technical Approach

推荐先把现有 panel 视为“UI + 本地服务内核”，再加一个桌面宿主层。优先方向是桌面壳只负责窗口、启动和生命周期，核心 panel server / assets / summary 逻辑继续复用。这样可以最小化迁移面，也最符合当前仓库以 TypeScript/Node 为主的现实约束。

## Decision (ADR-lite)

**Context**: 当前面板仍需要用户手动打开浏览器，本质上还是网页调试入口，不是独立产品入口。

**Decision**: 先做 Electron 独立桌面薄壳，并保留本地 URL 作为开发备用入口。桌面宿主最大化复用现有 Node/TS 面板代码，只管理窗口生命周期和本地 panel server 启停。

**Consequences**: 这一版会新增一个宿主层，但不会马上把 UI 重写成原生控件；代价是仍然使用 webview 渲染，不过用户路径会从“浏览器访问”变成“桌面应用启动”。

## Out of Scope

* 彻底重写成原生桌面控件 UI。
* 同时做完整跨平台安装器、自动更新和系统托盘。
* 改造地下 runtime、工具系统或 panel 内容语义本身。
* 让桌面宿主成为新的事实源。

## Technical Notes

* 当前浏览器调试入口：`src/app/panel.ts`
* 当前共享启动参数解析：`src/app/panel-args.ts`
* 当前 Electron 桌面入口：`src/app/panel-desktop.ts`
* 当前桌面生命周期薄壳：`src/app/panel-desktop-launcher.ts`
* 当前服务：`src/app/panel-server.ts`
* 当前 UI 资产：`src/app/panel-assets.ts`
* 当前脚本：`pnpm panel`、`pnpm panel:smoke`、`pnpm panel:desktop`、`pnpm panel:desktop:smoke`
* 相关规范：`.trellis/spec/frontend/index.md`、`.trellis/spec/frontend/component-guidelines.md`、`.trellis/spec/frontend/quality-guidelines.md`、`.trellis/spec/frontend/directory-structure.md`
* 官方参考：
  * Electron BrowserWindow / process model / packaging
  * Tauri prerequisites / distribute
  * Microsoft WebView2 getting started
