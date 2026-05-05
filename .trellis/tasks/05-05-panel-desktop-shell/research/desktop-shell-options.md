# 桌面宿主选项研究

## 现状

当前面板是 `pnpm panel` 启动的 Node HTTP server + 静态 HTML/CSS/JS 页面。用户现在要的是“独立面板程序”，本质上是把这个网页型工作台变成桌面宿主应用，而不是再让用户手动打开浏览器。

## 研究结论

### Electron

* 官方文档把 `BrowserWindow` 和 `app` 的主进程模型作为桌面窗口入口，窗口可以直接 `loadFile` 或 `loadURL`。
* 分发文档说明它有成熟的桌面打包与分发路径。
* 对当前仓库最友好的一点是：仍然是 TypeScript / Node 语境，现有 panel server 和大部分 app 逻辑更容易复用。
* 代价是包体和运行时更重，但这不等于架构上更脆弱。

### Tauri

* 官方文档显示它支持跨平台，Windows 上使用 WebView2，并且需要 Rust + Node 相关工具链。
* 它的分发和安装器支持是完整的，但引入的是一套新的宿主与构建世界。
* 优点是体积小、宿主更轻；缺点是对当前 TypeScript/Node 主线来说，工具链迁移成本更高。

### WebView2 / Windows 原生宿主

* Microsoft 官方文档说明 WebView2 可以嵌入 Win32 / WPF / WinUI 3 等桌面应用。
* 这条路对 Windows-first 产品很自然，也最接近原生桌面感。
* 代价是需要额外的原生宿主工程（C# / C++ 等），和当前仓库的 TypeScript 主线脱节最明显。

## 推荐

在当前仓库约束下，第一版优先推荐 Electron 桌面壳：

1. 复用现有 Node/TS 面板服务最直接。
2. 不需要先把运行时搬到 Rust 或原生桌面语言。
3. 可以先把“外部浏览器依赖”去掉，再逐步收敛宿主层边界。

如果后续用户明确要求更轻量或强 Windows 原生感，再评估 Tauri 或 WebView2 专线。

## 外部参考

* Electron BrowserWindow: https://www.electronjs.org/docs/api/browser-window
* Electron process model: https://www.electronjs.org/docs/latest/tutorial/process-model
* Electron packaging: https://www.electronjs.org/docs/tutorial/application-distribution/
* Tauri prerequisites: https://v2.tauri.app/start/prerequisites/
* Tauri distribution: https://v2.tauri.app/distribute/
* WebView2 getting started: https://learn.microsoft.com/en-us/microsoft-edge/webview2/get-started/get-started
