export function createPanelHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AgentArbor 面板</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #dfe4ec;
      --shell: #f7f8fb;
      --paper: #ffffff;
      --surface: #f7f8fa;
      --line: #e3e8ef;
      --line-strong: #cbd5e1;
      --text: #161a22;
      --muted: #5d6675;
      --muted-2: #8b95a5;
      --accent: #2ec4a6;
      --accent-strong: #11967d;
      --accent-soft: #e6faf4;
      --blue: #3157d5;
      --blue-soft: #eef3ff;
      --nav: #171c25;
      --nav-soft: #222a36;
      --nav-line: #303948;
      --nav-text: #d7deea;
      --nav-muted: #8f9aaa;
      --danger: #b42318;
      --danger-soft: #fff3f1;
      --warn: #9a6700;
      --warn-soft: #fff8e6;
      --ok: #0f766e;
      --ok-soft: #ecfdf5;
      --shadow: 0 18px 45px rgba(15, 23, 42, 0.12);
    }

    * { box-sizing: border-box; }

    html, body { min-height: 100%; }

    body {
      margin: 0;
      overflow: hidden;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.54 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }

    button, input, select, textarea { font: inherit; }

    button {
      min-height: 34px;
      border: 1px solid var(--line-strong);
      border-radius: 8px;
      background: #fff;
      color: var(--text);
      padding: 0 12px;
      cursor: pointer;
      font-weight: 720;
      white-space: nowrap;
    }

    button.primary {
      border-color: #b7f0dd;
      background: #bdf8df;
      color: #0c513e;
    }

    button.ghost {
      border-color: transparent;
      background: transparent;
      color: var(--muted);
    }

    button:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }

    input, select, textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      color: var(--text);
      padding: 9px 10px;
    }

    textarea {
      min-height: 88px;
      resize: vertical;
    }

    label {
      display: grid;
      gap: 5px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
    }

    h1, h2, h3, p { margin-top: 0; }

    h1 {
      margin-bottom: 8px;
      font-size: 20px;
      line-height: 1.2;
      letter-spacing: 0;
    }

    h2 {
      margin-bottom: 8px;
      font-size: 16px;
      letter-spacing: 0;
    }

    h3 {
      margin: 0;
      font-size: 13px;
      letter-spacing: 0;
    }

    .app {
      display: grid;
      grid-template-rows: 42px minmax(0, 1fr);
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      background: var(--bg);
    }

    .titlebar {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
      padding: 6px 14px;
      background: #121722;
      color: #c4ccd8;
    }

    .mode-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 34px;
      border: 1px solid #2a3443;
      border-radius: 7px;
      background: #1b2330;
      color: #eef4ff;
      padding: 0 10px;
      font-weight: 800;
    }

    .menu-link {
      color: #95a1b2;
      font-size: 13px;
    }

    .window-actions {
      margin-left: auto;
      display: flex;
      gap: 16px;
      color: #aab3c2;
      font-weight: 760;
    }

    .shell {
      display: grid;
      grid-template-columns: 286px minmax(0, 1fr);
      min-height: 0;
      overflow: hidden;
    }

    .sidebar {
      min-width: 0;
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr) auto;
      gap: 16px;
      padding: 12px 12px 14px;
      overflow: hidden;
      background: var(--nav);
      color: var(--nav-text);
    }

    .side-nav {
      display: grid;
      gap: 6px;
    }

    .side-action {
      display: grid;
      grid-template-columns: 20px minmax(0, 1fr);
      align-items: center;
      gap: 8px;
      min-height: 36px;
      border-radius: 8px;
      padding: 0 8px;
      color: var(--nav-text);
      text-decoration: none;
      border: 1px solid transparent;
    }

    .side-action:hover,
    .side-action.active {
      border-color: var(--nav-line);
      background: var(--nav-soft);
    }

    .nav-mark {
      display: inline-grid;
      place-items: center;
      width: 16px;
      height: 16px;
      border: 1px solid #435065;
      border-radius: 5px;
      position: relative;
    }

    .nav-mark.plus::before,
    .nav-mark.plus::after {
      content: "";
      position: absolute;
      background: var(--accent);
    }

    .nav-mark.plus::before {
      width: 8px;
      height: 2px;
    }

    .nav-mark.plus::after {
      width: 2px;
      height: 8px;
    }

    .nav-mark.skill::before,
    .nav-mark.auto::before {
      content: "";
      width: 7px;
      height: 7px;
      border-radius: 2px;
      background: #7dd3fc;
    }

    .nav-mark.auto::before {
      border-radius: 999px;
      background: #f7c948;
    }

    .side-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin: 12px 0 8px;
      color: var(--nav-muted);
      font-size: 12px;
      font-weight: 720;
    }

    .task-list {
      min-height: 0;
      overflow: auto;
    }

    .workspace-group {
      margin-bottom: 14px;
    }

    .workspace-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-height: 34px;
      color: var(--nav-text);
      font-weight: 760;
    }

    .mini-plus {
      min-width: 28px;
      min-height: 28px;
      padding: 0;
      border-radius: 8px;
      color: var(--nav-muted);
      font-weight: 850;
    }

    .runs {
      display: grid;
      gap: 4px;
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .run-item {
      min-width: 0;
      border-radius: 8px;
      padding: 8px 10px 8px 36px;
      color: #475467;
      overflow: hidden;
      position: relative;
    }

    .run-item::before {
      content: "";
      position: absolute;
      left: 16px;
      top: 17px;
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: #a7b0c0;
    }

    .run-item.active {
      background: #232c39;
      color: #f7fafc;
      font-weight: 760;
    }

    .run-item.active::before {
      background: var(--accent);
    }

    .run-title,
    .workspace-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: inherit;
      font-weight: 720;
    }

    .run-meta {
      min-width: 0;
      margin-top: 2px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--nav-muted);
      font-size: 12px;
    }

    .profile {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      padding: 10px 4px 0;
      border-top: 1px solid var(--nav-line);
    }

    .avatar {
      display: inline-grid;
      place-items: center;
      width: 28px;
      height: 28px;
      border-radius: 8px;
      background: #202938;
      color: #bdf8df;
      font-weight: 850;
    }

    .avatar::before {
      content: "";
      width: 9px;
      height: 9px;
      border-radius: 999px;
      background: var(--accent);
      box-shadow: 0 0 0 4px rgba(46, 196, 166, 0.12);
    }

    .workspace {
      min-width: 0;
      padding: 8px 8px 10px 0;
      overflow: hidden;
    }

    .session-card {
      display: grid;
      grid-template-columns: minmax(560px, 1fr) 328px;
      grid-template-rows: auto minmax(0, 1fr);
      min-width: 0;
      height: calc(100vh - 54px);
      margin: 8px 8px 10px 0;
      overflow: hidden;
      border: 1px solid #d9e0ea;
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
    }

    .session-header {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 56px;
      padding: 0 18px;
      border-bottom: 1px solid var(--line);
    }

    .session-title {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      font-weight: 820;
    }

    .session-title span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .session-meta {
      color: var(--muted-2);
      font-size: 13px;
      font-weight: 600;
    }

    .header-tools {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .tool-button {
      min-width: 54px;
      min-height: 30px;
      padding: 0 10px;
      color: #475467;
      font-size: 12px;
    }

    .thread {
      min-width: 0;
      min-height: 0;
      display: grid;
      grid-template-rows: minmax(0, 1fr) auto;
      border-right: 1px solid var(--line);
    }

    .thread-scroll {
      min-height: 0;
      overflow: auto;
      padding: 28px clamp(28px, 5vw, 68px) 18px clamp(32px, 6vw, 88px);
    }

    .welcome {
      max-width: 760px;
      margin-bottom: 24px;
    }

    .welcome p {
      margin-bottom: 0;
      color: var(--muted);
    }

    .status-pill,
    .tag {
      display: inline-flex;
      align-items: center;
      min-height: 25px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: #fff;
      color: var(--muted);
      padding: 2px 9px;
      font-size: 12px;
      font-weight: 720;
    }

    .transcript {
      display: grid;
      gap: 16px;
    }

    .empty-transcript {
      color: var(--muted);
    }

    .entry {
      display: grid;
      grid-template-columns: 58px minmax(0, 1fr);
      gap: 14px;
      min-width: 0;
    }

    .entry-label {
      color: var(--muted);
      font-size: 13px;
      font-weight: 720;
      text-align: right;
      padding-top: 7px;
    }

    .bubble {
      min-width: 0;
      color: #273142;
    }

    .bubble-inner {
      display: grid;
      gap: 8px;
      border-radius: 7px;
      padding: 9px 11px;
    }

    .entry.user .bubble-inner {
      border: 1px solid #c8dcff;
      background: #f1f5ff;
    }

    .entry:not(.user) .bubble-inner {
      border: 1px solid transparent;
      background: transparent;
      padding-left: 0;
    }

    .bubble.failed .bubble-inner {
      border-color: #ffc9c2;
      background: var(--danger-soft);
    }

    .entry-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-weight: 760;
    }

    .meta,
    .hint,
    .node-meta,
    .section-note {
      color: var(--muted);
      font-size: 12px;
    }

    .hint.error,
    .error {
      color: var(--danger);
    }

    .entry-body {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      color: #303a4b;
    }

    .result-block {
      display: grid;
      gap: 14px;
      max-width: 820px;
      margin: 22px 0 0;
      padding: 18px 0 0;
      border-top: 1px solid var(--line);
    }

    .result-head {
      display: grid;
      gap: 8px;
    }

    .report-kicker {
      color: var(--blue);
      font-size: 12px;
      font-weight: 820;
    }

    .summary-box {
      border-left: 3px solid var(--blue);
      background: #f8fbff;
      padding: 11px 13px;
      color: #344054;
    }

    .artifact-preview {
      display: grid;
      gap: 14px;
      border: 1px solid #d9e3f2;
      border-radius: 8px;
      background: #fff;
      padding: 18px 20px;
      box-shadow: 0 12px 28px rgba(49, 87, 213, 0.08);
    }

    .artifact-topline {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 720;
    }

    .artifact-title {
      margin: 0;
      font-size: 22px;
      line-height: 1.28;
    }

    .artifact-summary {
      border-left: 3px solid var(--accent);
      padding-left: 12px;
      color: #344054;
    }

    .artifact-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }

    .result-section {
      display: grid;
      gap: 8px;
    }

    .result-section ul {
      display: grid;
      gap: 8px;
      margin: 0;
      padding-left: 20px;
    }

    .composer {
      padding: 14px clamp(28px, 5vw, 68px) 18px clamp(32px, 6vw, 88px);
      background: linear-gradient(180deg, rgba(255, 255, 255, 0), #fff 20%);
    }

    .composer-box {
      display: grid;
      gap: 8px;
      max-width: 880px;
      border: 1px solid #c8d3e3;
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 16px 34px rgba(43, 88, 150, 0.08);
      padding: 12px;
    }

    .composer-box textarea {
      min-height: 82px;
      border: 0;
      border-radius: 0;
      padding: 4px 6px;
      resize: none;
      outline: none;
    }

    .composer-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .composer-actions .spacer {
      flex: 1;
    }

    .icon-button {
      display: inline-grid;
      place-items: center;
      min-width: 44px;
      min-height: 30px;
      padding: 0 8px;
      border-radius: 7px;
      font-size: 12px;
    }

    .send-button {
      min-width: 40px;
      min-height: 40px;
      border-radius: 8px;
      font-size: 18px;
    }

    .composer-extra {
      margin-top: 4px;
      border-top: 1px solid var(--line);
      padding-top: 8px;
    }

    .composer-extra summary {
      cursor: pointer;
      color: var(--muted);
      font-size: 12px;
      font-weight: 760;
    }

    .context-inputs {
      display: grid;
      gap: 8px;
      margin-top: 8px;
    }

    .context-pane {
      min-width: 0;
      min-height: 0;
      overflow: auto;
      background: #fbfcfe;
      padding: 18px 18px;
    }

    .context-section {
      display: grid;
      gap: 8px;
      padding: 0 0 18px;
      margin-bottom: 18px;
      border-bottom: 1px solid var(--line);
    }

    .context-section:last-child {
      border-bottom: 0;
    }

    .context-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 14px;
      font-weight: 780;
    }

    .panel-stack,
    .metrics,
    .run-path,
    .agent-tree,
    .detail-grid,
    .fields,
    .call-list {
      display: grid;
      gap: 8px;
    }

    .status-line,
    .metric,
    .detail-item,
    .call-row,
    .agent-node {
      min-width: 0;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      padding: 9px 10px;
    }

    .rail-list {
      display: grid;
      gap: 6px;
    }

    .rail-row {
      display: grid;
      grid-template-columns: 66px minmax(0, 1fr);
      gap: 8px;
      min-width: 0;
      padding: 6px 0;
      border-bottom: 1px solid #eef2f6;
    }

    .rail-row:last-child {
      border-bottom: 0;
    }

    .rail-key {
      color: var(--muted-2);
      font-size: 12px;
      font-weight: 720;
    }

    .rail-value {
      min-width: 0;
      color: #344054;
      font-size: 13px;
      overflow-wrap: anywhere;
    }

    .rail-row.warn .rail-key,
    .rail-row.warn .rail-value {
      color: var(--warn);
    }

    .rail-row.error .rail-key,
    .rail-row.error .rail-value {
      color: var(--danger);
    }

    .rail-row.good .rail-key {
      color: var(--ok);
    }

    .status-line {
      display: grid;
      gap: 3px;
    }

    .status-line.good {
      border-color: #b7ead9;
      background: var(--ok-soft);
    }

    .status-line.warn {
      border-color: #f5dfa8;
      background: var(--warn-soft);
    }

    .status-line.error {
      border-color: #ffc9c2;
      background: var(--danger-soft);
    }

    .metric,
    .detail-item,
    .call-row,
    .agent-node {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .agent-node {
      width: 100%;
      text-align: left;
    }

    .agent-node.child {
      margin-left: 12px;
      width: calc(100% - 12px);
    }

    .node-head,
    .call-title {
      font-weight: 760;
    }

    .drawer-backdrop {
      position: fixed;
      inset: 0;
      z-index: 40;
      display: none;
      background: rgba(15, 23, 42, 0.2);
    }

    .drawer-backdrop.open {
      display: block;
    }

    .developer-drawer {
      position: fixed;
      top: 0;
      right: 0;
      z-index: 50;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      width: min(430px, 100vw);
      height: 100vh;
      transform: translateX(105%);
      transition: transform 160ms ease;
      border-left: 1px solid var(--line);
      background: #fff;
      box-shadow: var(--shadow);
    }

    .developer-drawer.open {
      transform: translateX(0);
    }

    .drawer-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 58px;
      padding: 14px;
      border-bottom: 1px solid var(--line);
    }

    .drawer-body {
      min-height: 0;
      overflow: auto;
      padding: 14px;
    }

    .inspector-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 12px;
    }

    .inspector-tab {
      min-height: 30px;
      color: var(--muted);
      padding: 0 10px;
    }

    .inspector-tab.active {
      border-color: #bfdbfe;
      background: var(--blue-soft);
      color: var(--blue);
    }

    .inspector-panel {
      display: none;
    }

    .inspector-panel.active {
      display: block;
    }

    pre {
      margin: 0;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #0f172a;
      color: #dbeafe;
      padding: 10px;
      font-size: 12px;
      line-height: 1.5;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    @media (max-width: 1180px) {
      .session-card {
        grid-template-columns: minmax(0, 1fr);
      }

      .context-pane {
        display: none;
      }

      .thread {
        border-right: 0;
      }
    }

    @media (max-width: 820px) {
      body { overflow: auto; }

      .app {
        display: block;
        height: auto;
        overflow: visible;
      }

      .titlebar,
      .sidebar,
      .workspace,
      .session-card {
        height: auto;
      }

      .shell {
        display: block;
      }

      .session-card {
        margin: 0;
        border-radius: 0;
      }

      .thread-scroll,
      .composer {
        padding: 16px;
      }

      .artifact-grid {
        grid-template-columns: 1fr;
      }

      .entry {
        grid-template-columns: 1fr;
      }

      .entry-label {
        text-align: left;
        padding-top: 0;
      }
    }
  </style>
</head>
<body>
  <!-- ordinary-screen-start -->
  <div class="app">
    <header class="titlebar">
      <div class="mode-pill">AgentArbor</div>
      <span class="menu-link">任务</span>
      <span class="menu-link">材料</span>
      <span class="menu-link">帮助</span>
      <div class="window-actions" aria-hidden="true"><span>一</span><span>□</span><span>×</span></div>
    </header>

    <div class="shell">
      <aside class="sidebar">
        <nav class="side-nav" aria-label="工作入口">
          <button class="side-action active" id="newRunButton" type="button"><span class="nav-mark plus"></span><span>新建任务</span></button>
          <a class="side-action" href="#"><span class="nav-mark skill"></span><span>技能</span></a>
          <a class="side-action" href="#"><span class="nav-mark auto"></span><span>自动化</span></a>
        </nav>

        <section class="task-list" aria-label="任务列表">
          <div class="side-title"><span>任务列表</span><span id="runCount">0</span></div>
          <div class="workspace-group">
            <div class="workspace-row">
              <span class="workspace-name">当前工作区</span>
              <button class="mini-plus" type="button">+</button>
            </div>
            <ul class="runs" id="runHistory">
              <li class="run-item active">
                <div class="run-title">暂无最近任务</div>
                <div class="run-meta">开始任务后会显示在这里。</div>
              </li>
            </ul>
          </div>
        </section>

        <div class="profile">
          <span class="avatar" aria-hidden="true"></span>
          <div>
            <div><strong>本地工作</strong></div>
            <div class="run-meta">只使用你授权的材料。</div>
          </div>
        </div>
      </aside>

      <main class="workspace">
        <section class="session-card" aria-label="任务工作会话">
          <header class="session-header">
            <div class="session-title">
              <span id="sessionTitle">新任务</span>
              <span class="session-meta">本地工作区 · 写入前确认</span>
            </div>
            <div class="header-tools">
              <span class="status-pill" id="runStatus">待开始</span>
              <button class="tool-button" id="diagnosticDrawerButton" type="button" aria-label="打开详情">详情</button>
            </div>
          </header>

          <section class="thread">
            <div class="thread-scroll" id="transcriptWrap">
              <div class="welcome" id="introBlock">
                <h1>要完成什么？</h1>
                <p>输入一个真实任务，必要时补充文件、网页或限制条件。我会在会话里展示正在看的材料、形成的判断、结果、证据和下一步。</p>
              </div>
              <section class="transcript" id="transcript" aria-label="工作过程">
                <div class="empty-transcript">暂无活动。开始任务后，这里会显示正在读取、比较、整理和生成的过程。</div>
              </section>
              <section class="result-block" id="mainCanvas" aria-label="结果">
                <div class="result-head">
                  <span class="report-kicker">结果</span>
                  <h2>等待任务开始</h2>
                  <div class="summary-box">任务完成后，结论、依据、风险、不确定性和下一步会显示在这条会话里。</div>
                </div>
              </section>
            </div>

            <section class="composer" aria-label="任务输入">
              <div class="composer-box">
                <textarea id="goalInput" placeholder="例如：分析当前项目的主要问题，并给出下一轮可执行优化建议。"></textarea>
                <details class="composer-extra">
                  <summary>补充材料和权限</summary>
                  <div class="context-inputs">
                    <label>材料引用
                      <textarea id="contextRefsInput" placeholder="可选，每行：file:src/app/panel-assets.ts | file | 只读摘要 | 短预览"></textarea>
                    </label>
                    <label>权限说明
                      <input id="permissionRefsInput" autocomplete="off" placeholder="例如：只读；写入前询问">
                    </label>
                  </div>
                </details>
                <div class="composer-actions">
                  <button class="icon-button" type="button" title="添加文件">文件</button>
                  <button class="icon-button" type="button" title="添加图片">图片</button>
                  <span class="spacer"></span>
                  <span class="hint" id="modelHint">未配置真实模型时会要求先配置。</span>
                  <button class="icon-button" type="button" title="语音">语音</button>
                  <button class="send-button primary" id="runButton" title="开始处理">↑</button>
                </div>
              </div>
            </section>
          </section>

          <aside class="context-pane" aria-label="任务上下文">
            <section class="context-section">
              <div class="context-title"><span>待办</span></div>
              <div class="panel-stack" id="riskPanel"></div>
            </section>
            <section class="context-section">
              <div class="context-title"><span>上下文</span><span class="tag" id="railStatusBadge">待开始</span></div>
              <div class="metrics" id="runMetrics"></div>
            </section>
            <section class="context-section">
              <div class="context-title"><span>证据</span></div>
              <div class="panel-stack" id="supervisionStatus"></div>
            </section>
            <section class="context-section">
              <div class="context-title"><span>近期活动</span></div>
              <div class="run-path" id="runPath"></div>
            </section>
          </aside>
        </section>
      </main>
    </div>
  </div>
  <!-- ordinary-screen-end -->

  <div class="drawer-backdrop" id="drawerBackdrop"></div>

  <aside class="developer-drawer" id="developerDrawer" aria-hidden="true" aria-label="开发者详情">
    <div class="drawer-head">
      <div>
        <div class="context-title">详情与诊断</div>
        <div class="hint">会话细节、设置和安全调试投影。</div>
      </div>
      <button class="ghost drawer-close" type="button" data-close-drawer>关闭</button>
    </div>
    <div class="drawer-body">
      <nav class="inspector-tabs" aria-label="详情分区">
        <button class="inspector-tab active" type="button" data-tab="overview">概览</button>
        <button class="inspector-tab" type="button" data-tab="ai">诊断</button>
        <button class="inspector-tab" type="button" data-tab="agents">Agents</button>
        <button class="inspector-tab" type="button" data-tab="settings">设置</button>
      </nav>

      <div class="inspector-panel active" id="tabOverview" data-panel="overview">
        <div class="panel-stack">
          <div class="status-line">
            <strong>当前会话详情</strong>
            <span class="node-meta">运行树、模型工具引用和调试 JSON 只在这里查看。</span>
          </div>
        </div>
      </div>

      <div class="inspector-panel" id="tabAi" data-panel="ai">
        <section class="panel-stack">
          <h2>真实 AI 诊断</h2>
          <div class="panel-stack" id="failurePanel">
            <div class="status-line"><strong>暂无阻断</strong><span class="node-meta">模型服务失败、输出契约失败或配置边界会显示在这里。</span></div>
          </div>
          <h2>模型 / 工具流</h2>
          <div class="section-note">只显示 purpose、contract、状态、模型 / 工具 refs 和安全摘要。</div>
          <div class="panel-stack" id="flowList"></div>
        </section>
      </div>

      <div class="inspector-panel" id="tabAgents" data-panel="agents">
        <section class="panel-stack">
          <h2>运行树 / 父层综合</h2>
          <div class="agent-tree" id="agentTree"><div class="node-meta">暂无派生 agent。</div></div>
          <h2>选中 Agent</h2>
          <div class="node-meta" id="agentInspector">运行后显示 spec、权限、预算和输出引用。</div>
          <h2>父层 synthesis</h2>
          <div class="status-line" id="parentSynthesis">
            <strong>父层 synthesis</strong>
            <span class="node-meta">等待 child/rootlet 安全摘要。</span>
          </div>
        </section>
      </div>

      <div class="inspector-panel" id="tabSettings" data-panel="settings">
        <div class="fields">
          <label>Base URL <input id="baseUrlInput" autocomplete="off"></label>
          <label>模型名 <input id="modelInput" autocomplete="off"></label>
          <label>默认 AI 模式
            <select id="defaultAiModeInput">
              <option value="none">AI 禁用</option>
              <option value="openai-compatible">OpenAI-compatible 推荐</option>
              <option value="fake">Fake AI 测试模式</option>
            </select>
          </label>
          <label>本次运行模式
            <select id="aiMode">
              <option value="none">AI 禁用</option>
              <option value="openai-compatible">OpenAI-compatible 推荐</option>
              <option value="fake">Fake AI 测试模式</option>
            </select>
          </label>
          <label>API Key <input id="apiKeyInput" type="password" autocomplete="off" placeholder="保存后不会回显"></label>
          <button id="saveConfigButton">保存模型配置</button>
          <div class="hint" id="configStatus">模型配置未加载。</div>
          <label>搜索服务
            <select id="webSearchProviderInput">
              <option value="tavily">Tavily</option>
              <option value="none">无</option>
            </select>
          </label>
          <label>Tavily API Key <input id="tavilyKeyInput" type="password" autocomplete="off" placeholder="保存后不会回显"></label>
          <label>结果数 <input id="tavilyMaxResultsInput" type="number" min="1" max="10" step="1"></label>
          <button id="saveToolConfigButton">保存工具配置</button>
          <div class="hint" id="toolConfigStatus">工具配置未加载。</div>
          <h2>折叠调试区</h2>
          <ul class="debug-list" id="debugList">
            <li>EventLog、Observation、CandidatePool、Convergence 和 rootlet 细节默认折叠。</li>
          </ul>
          <pre id="debugJson">{}</pre>
        </div>
      </div>
    </div>
  </aside>

  <script>
    const STREAM_TYPES = [
      "run.started",
      "agent.note.delta",
      "agent.note.completed",
      "model.output.delta",
      "model.output.completed",
      "tool.requested",
      "tool.completed",
      "tool.failed",
      "agent.delegation.planned",
      "agent.child.started",
      "agent.child.completed",
      "agent.child.waiting",
      "agent.parent_synthesis.completed",
      "final.result",
      "run.failed"
    ];

    const STATUS_LABELS = {
      pending: "待开始",
      running: "正在工作",
      completed: "已完成",
      failed: "未完成",
      sent: "已发送"
    };

    const EVENT_LABELS = {
      "run.started": "开始工作",
      "agent.note.delta": "工作笔记",
      "agent.note.completed": "工作笔记",
      "model.output.delta": "正在生成内容",
      "model.output.completed": "内容已整理",
      "tool.requested": "正在读取材料",
      "tool.completed": "材料已读取",
      "tool.failed": "材料读取失败",
      "agent.delegation.planned": "正在安排检查",
      "agent.child.started": "检查开始",
      "agent.child.completed": "检查完成",
      "agent.child.waiting": "等待材料",
      "agent.parent_synthesis.completed": "正在整理判断",
      "final.result": "最终结果",
      "run.failed": "运行失败"
    };

    const state = {
      config: undefined,
      informationAccess: undefined,
      tools: undefined,
      currentRunId: undefined,
      eventSource: undefined,
      pollingTimer: undefined,
      seenSequences: new Set(),
      lastSequence: 0,
      lastFocusedTerminalRunId: undefined,
      runHistory: [],
      modelOutputEntries: new Map(),
      assistantEntry: undefined,
      inspectorTab: "overview",
      inspectorPinned: false
    };

    const dom = {
      runStatus: document.getElementById("runStatus"),
      transcriptWrap: document.getElementById("transcriptWrap"),
      runMetrics: document.getElementById("runMetrics"),
      mainCanvas: document.getElementById("mainCanvas"),
      transcript: document.getElementById("transcript"),
      introBlock: document.getElementById("introBlock"),
      goalInput: document.getElementById("goalInput"),
      contextRefsInput: document.getElementById("contextRefsInput"),
      permissionRefsInput: document.getElementById("permissionRefsInput"),
      aiMode: document.getElementById("aiMode"),
      providerHint: document.getElementById("modelHint"),
      runButton: document.getElementById("runButton"),
      newRunButton: document.getElementById("newRunButton"),
      runHistory: document.getElementById("runHistory"),
      runCount: document.getElementById("runCount"),
      sessionTitle: document.getElementById("sessionTitle"),
      diagnosticDrawerButton: document.getElementById("diagnosticDrawerButton"),
      drawerBackdrop: document.getElementById("drawerBackdrop"),
      developerDrawer: document.getElementById("developerDrawer"),
      baseUrlInput: document.getElementById("baseUrlInput"),
      modelInput: document.getElementById("modelInput"),
      defaultAiModeInput: document.getElementById("defaultAiModeInput"),
      apiKeyInput: document.getElementById("apiKeyInput"),
      saveConfigButton: document.getElementById("saveConfigButton"),
      configStatus: document.getElementById("configStatus"),
      webSearchProviderInput: document.getElementById("webSearchProviderInput"),
      tavilyKeyInput: document.getElementById("tavilyKeyInput"),
      tavilyMaxResultsInput: document.getElementById("tavilyMaxResultsInput"),
      saveToolConfigButton: document.getElementById("saveToolConfigButton"),
      toolConfigStatus: document.getElementById("toolConfigStatus"),
      inspectorTabs: Array.from(document.querySelectorAll(".inspector-tab")),
      inspectorPanels: Array.from(document.querySelectorAll(".inspector-panel")),
      railStatusBadge: document.getElementById("railStatusBadge"),
      runPath: document.getElementById("runPath"),
      supervisionStatus: document.getElementById("supervisionStatus"),
      failurePanel: document.getElementById("failurePanel"),
      flowList: document.getElementById("flowList"),
      agentTree: document.getElementById("agentTree"),
      agentInspector: document.getElementById("agentInspector"),
      parentSynthesis: document.getElementById("parentSynthesis"),
      riskPanel: document.getElementById("riskPanel"),
      debugList: document.getElementById("debugList"),
      debugJson: document.getElementById("debugJson")
    };

    dom.runButton.addEventListener("click", startRun);
    dom.newRunButton.addEventListener("click", resetComposer);
    dom.saveConfigButton.addEventListener("click", saveModelConfig);
    dom.saveToolConfigButton.addEventListener("click", saveToolConfig);
    dom.diagnosticDrawerButton.addEventListener("click", openDeveloperDrawer);
    dom.drawerBackdrop.addEventListener("click", closeDeveloperDrawer);
    document.querySelectorAll("[data-close-drawer]").forEach((button) => button.addEventListener("click", closeDeveloperDrawer));
    dom.inspectorTabs.forEach((button) => {
      button.addEventListener("click", () => setInspectorTab(button.dataset.tab || "overview", true));
    });
    dom.aiMode.addEventListener("change", () => {
      if (state.config) {
        renderProviderStatus();
      }
    });

    init();

    async function init() {
      setInspectorTab("overview", false);
      renderMetrics("pending", undefined);
      renderRunPath(undefined);
      renderAgentTree(undefined);
      renderRightPanels(undefined);
      renderFailurePanel(undefined);
      renderFlow(undefined);
      await Promise.all([loadConfig(), loadToolsConfig()]);
    }

    function openDeveloperDrawer() {
      dom.drawerBackdrop.classList.add("open");
      dom.developerDrawer.classList.add("open");
      dom.developerDrawer.setAttribute("aria-hidden", "false");
    }

    function closeDeveloperDrawer() {
      dom.drawerBackdrop.classList.remove("open");
      dom.developerDrawer.classList.remove("open");
      dom.developerDrawer.setAttribute("aria-hidden", "true");
    }

    function setInspectorTab(tab, pinned) {
      state.inspectorTab = tab;
      if (pinned) {
        state.inspectorPinned = true;
      }
      dom.inspectorTabs.forEach((button) => {
        const active = button.dataset.tab === tab;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", active ? "true" : "false");
      });
      dom.inspectorPanels.forEach((panel) => {
        panel.classList.toggle("active", panel.dataset.panel === tab);
      });
    }

    function autoInspectorTab(response) {
      if (state.inspectorPinned) {
        return;
      }
      if (response && (response.error || hasFailedModelCall(response))) {
        setInspectorTab("ai", false);
        return;
      }
      setInspectorTab("overview", false);
    }

    async function loadConfig() {
      try {
        const result = await requestJson("/api/config");
        state.config = result.config;
        state.informationAccess = result.informationAccess;
        dom.baseUrlInput.value = result.config.baseUrl || "";
        dom.modelInput.value = result.config.model || "";
        dom.defaultAiModeInput.value = result.config.defaultAiMode || "openai-compatible";
        dom.aiMode.value = preferredRunMode();
        renderProviderStatus();
      } catch (error) {
        dom.configStatus.textContent = "模型配置读取失败。";
        dom.configStatus.className = "hint error";
      }
    }

    async function loadToolsConfig() {
      try {
        const result = await requestJson("/api/config/tools");
        state.tools = result.tools;
        state.informationAccess = result.informationAccess;
        const webSearch = result.tools.webSearch;
        dom.webSearchProviderInput.value = webSearch.provider;
        dom.tavilyMaxResultsInput.value = String(webSearch.maxResults || 3);
        renderToolStatus();
      } catch (error) {
        dom.toolConfigStatus.textContent = "工具配置读取失败。";
        dom.toolConfigStatus.className = "hint error";
      }
    }

    async function saveModelConfig() {
      setButtons(false);
      try {
        const result = await requestJson("/api/config/model-provider", {
          method: "POST",
          body: {
            baseUrl: dom.baseUrlInput.value,
            model: dom.modelInput.value,
            defaultAiMode: dom.defaultAiModeInput.value,
            apiKey: dom.apiKeyInput.value
          }
        });
        dom.apiKeyInput.value = "";
        state.config = result.config;
        state.informationAccess = result.informationAccess;
        dom.aiMode.value = preferredRunMode();
        renderProviderStatus();
      } catch (error) {
        dom.configStatus.textContent = error.message;
        dom.configStatus.className = "hint error";
      } finally {
        setButtons(true);
      }
    }

    async function saveToolConfig() {
      setButtons(false);
      try {
        const maxResults = Number(dom.tavilyMaxResultsInput.value);
        const result = await requestJson("/api/config/tools/web-search", {
          method: "POST",
          body: {
            provider: dom.webSearchProviderInput.value,
            apiKey: dom.tavilyKeyInput.value,
            maxResults: Number.isFinite(maxResults) ? maxResults : undefined
          }
        });
        dom.tavilyKeyInput.value = "";
        state.tools = result.tools;
        state.informationAccess = result.informationAccess;
        renderToolStatus();
      } catch (error) {
        dom.toolConfigStatus.textContent = error.message;
        dom.toolConfigStatus.className = "hint error";
      } finally {
        setButtons(true);
      }
    }

    async function startRun() {
      const goal = dom.goalInput.value.trim();
      if (goal.length === 0) {
        appendLocalEntry("提示", "请先输入任务。", "failed");
        return;
      }

      stopLiveUpdates();
      state.seenSequences = new Set();
      state.lastSequence = 0;
      state.currentRunId = undefined;
      state.lastFocusedTerminalRunId = undefined;
      state.modelOutputEntries = new Map();
      state.assistantEntry = undefined;
      dom.transcript.replaceChildren();
      dom.introBlock.hidden = true;
      dom.sessionTitle.textContent = compact(goal, 42);
      appendLocalEntry("你", compact(goal, 1200), "sent", true);
      updateAssistantTurn("正在处理", "我先整理上下文，然后给出可审阅的回答或结果。", "running");
      setRunStatus("running");
      state.inspectorPinned = false;
      setInspectorTab("overview", false);
      renderCanvas(undefined, "running");
      renderRunPath(undefined);
      renderMetrics("running", undefined);
      renderRightPanels({ status: "running" });
      setButtons(false);

      try {
        const response = await requestJson("/api/desktop/runs", {
          method: "POST",
          body: {
            goal: goal,
            aiMode: dom.aiMode.value,
            taskSoil: collectTaskSoilInput()
          }
        });
        state.currentRunId = response.runId;
        dom.goalInput.value = "";
        rememberRun(goal, response.runId);
        renderPollingResponse(response);
        openRunStream(response.runId, response.streamCursor ? response.streamCursor.lastSequence : 0);
      } catch (error) {
        updateAssistantTurn("这次没有完成", friendlyFailureText(error.message), "failed");
        setRunStatus("failed");
        renderRightPanels({ status: "failed", error: { message: error.message } });
        openDeveloperDrawer();
      } finally {
        setButtons(true);
      }
    }

    function collectTaskSoilInput() {
      const contextRefs = dom.contextRefsInput.value
        .split(/\\n/g)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const parts = line.split("|").map((part) => part.trim());
          const ref = parts[0] || "";
          const kind = parts[1] || inferContextKind(ref);
          const summary = parts[2] || undefined;
          const previewText = parts[3] || undefined;
          return {
            ref: ref,
            kind: kind,
            summary: summary,
            readonlyPreview: previewText ? { title: summary || ref, text: previewText } : undefined
          };
        });
      const permissionBoundaryRefs = dom.permissionRefsInput.value
        .split(/[\\n,]+/g)
        .map((line) => line.trim())
        .filter(Boolean);
      return {
        contextRefs: contextRefs.length > 0 ? contextRefs : undefined,
        permissionBoundaryRefs: permissionBoundaryRefs.length > 0 ? permissionBoundaryRefs : undefined
      };
    }

    function inferContextKind(ref) {
      const lower = String(ref || "").toLowerCase();
      if (lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("web:")) {
        return "web";
      }
      if (lower.startsWith("project:")) {
        return "project";
      }
      if (lower.startsWith("file:")) {
        return "file";
      }
      return "workspace";
    }

    function openRunStream(runId, cursor) {
      if (!("EventSource" in window)) {
        startPolling(runId);
        return;
      }
      const startCursor = Math.max(0, Number(cursor || 0) - 1);
      const source = new EventSource("/api/desktop/runs/" + encodeURIComponent(runId) + "/stream?cursor=" + startCursor);
      state.eventSource = source;
      STREAM_TYPES.forEach((type) => {
        source.addEventListener(type, (message) => {
          const event = JSON.parse(message.data);
          appendStreamEvent(event);
          if (event.type === "final.result" || event.type === "run.failed") {
            finishLiveRun(runId);
          }
        });
      });
      source.onerror = () => {
        source.close();
        if (state.currentRunId === runId) {
          startPolling(runId);
        }
      };
    }

    function startPolling(runId) {
      clearInterval(state.pollingTimer);
      state.pollingTimer = setInterval(async () => {
        try {
          const response = await requestJson("/api/desktop/runs/" + encodeURIComponent(runId));
          renderPollingResponse(response);
          if (response.status === "completed" || response.status === "failed") {
            finishLiveRun(runId);
          }
        } catch (error) {
          clearInterval(state.pollingTimer);
          appendLocalEntry("轮询失败", error.message, "failed");
          setRunStatus("failed");
        }
      }, 1000);
    }

    async function finishLiveRun(runId) {
      stopLiveUpdates();
      try {
        const response = await requestJson("/api/desktop/runs/" + encodeURIComponent(runId));
        renderPollingResponse(response);
      } catch {
      }
    }

    function renderPollingResponse(response) {
      autoInspectorTab(response);
      setRunStatus(response.status || "running");
      renderCanvas(response.canvas, response.status || "running", response);
      renderRightPanels(response);
      renderRunPath(response);
      renderMetrics(response.status || "running", response);
      renderSupervision(response);
      renderAgentTree(response);
      renderFailurePanel(response);
      renderFlow(response);
      if (response.transcript && Array.isArray(response.transcript.events)) {
        response.transcript.events.forEach(appendStreamEvent);
      }
      syncAssistantTurnFromResponse(response);
      renderDebug(response);
      focusCanvasOnTerminal(response);
    }

    function hasFailedModelCall(response) {
      return Boolean(
        response &&
          response.transcript &&
          Array.isArray(response.transcript.modelCalls) &&
          response.transcript.modelCalls.some((call) => call.status === "failed")
      );
    }

    function focusCanvasOnTerminal(response) {
      if (!response || response.status !== "completed" || !response.canvas) {
        return;
      }
      if (state.lastFocusedTerminalRunId === response.runId) {
        return;
      }
      state.lastFocusedTerminalRunId = response.runId;
      dom.mainCanvas.scrollIntoView({ block: "start", behavior: "smooth" });
    }

    function appendStreamEvent(event) {
      if (!event || typeof event.sequence !== "number") {
        return;
      }
      if (state.seenSequences.has(event.sequence)) {
        return;
      }
      state.seenSequences.add(event.sequence);
      state.lastSequence = Math.max(state.lastSequence, event.sequence);

      if (event.type === "model.output.delta" || event.type === "model.output.completed") {
        return;
      }

      const content = activityBody(event);
      const status = event.status || (event.type === "run.failed" ? "failed" : event.type === "final.result" ? "completed" : "running");
      if (event.type === "run.failed") {
        updateAssistantTurn("这次没有完成", friendlyFailureText(content), "failed");
        return;
      }
      if (event.type === "final.result") {
        updateAssistantTurn("结果已生成", "我已经把结果整理在下方，证据和不确定性也保留在右侧。", "completed");
        return;
      }
      updateAssistantTurn(EVENT_LABELS[event.type] || "正在工作", content, status);
    }

    function syncAssistantTurnFromResponse(response) {
      if (!response) {
        return;
      }
      if (response.status === "failed") {
        updateAssistantTurn("这次没有完成", friendlyFailureText(response.error && response.error.message), "failed");
        return;
      }
      if (response.status === "completed") {
        const directAnswer =
          response.canvas && response.canvas.kind === "desktop_chat_canvas" && response.canvas.chat.answer
            ? response.canvas.chat.answer
            : response.canvas && response.canvas.kind === "work_session_canvas" && response.canvas.workSession.directAnswer
              ? response.canvas.workSession.directAnswer
              : undefined;
        if (directAnswer) {
          updateAssistantTurn("已回答", directAnswer.answer, "completed");
          return;
        }
        const reportTitle = response.canvas && response.canvas.kind === "work_session_canvas" && response.canvas.workSession.report
          ? response.canvas.workSession.report.title
          : undefined;
        updateAssistantTurn("结果已生成", reportTitle ? "已生成：" + reportTitle : "结果已经整理完成。", "completed");
        return;
      }
      if (response.status === "running") {
        updateAssistantTurn("正在工作", "我正在处理任务，细节进展会在右侧近期活动里更新。", "running");
      }
    }

    function activityActorLabel(event) {
      if (event.type === "run.started") return "任务";
      if (event.type === "tool.requested" || event.type === "tool.completed" || event.type === "tool.failed") return "材料";
      if (event.type === "agent.delegation.planned" || event.type === "agent.child.started" || event.type === "agent.child.completed" || event.type === "agent.child.waiting") return "检查";
      if (event.type === "agent.parent_synthesis.completed") return "判断";
      if (event.type === "final.result") return "结果";
      if (event.type === "run.failed") return "诊断";
      if (event.type === "model.output.delta" || event.type === "model.output.completed") return "工作中";
      return "活动";
    }

    function activityBody(event) {
      const summary = event.delta || event.summary;
      if (summary) {
        if (event.type === "run.failed") {
          return friendlyFailureText(summary);
        }
        return productActivityText(event.type, summary);
      }
      if (event.type === "tool.requested") return "正在读取你提供的上下文。";
      if (event.type === "tool.completed") return "已取得可引用的材料。";
      if (event.type === "agent.delegation.planned") return "正在安排几路检查。";
      if (event.type === "agent.child.started") return "检查已经开始。";
      if (event.type === "agent.child.completed") return "检查已返回局部材料。";
      if (event.type === "agent.child.waiting") return "正在等待材料回收。";
      if (event.type === "agent.parent_synthesis.completed") return "正在合并材料、处理冲突并形成判断。";
      return EVENT_LABELS[event.type] || "工作状态已更新。";
    }

    function productActivityText(type, value) {
      const text = String(value || "").trim();
      if (text.length === 0) {
        return EVENT_LABELS[type] || "工作状态已更新。";
      }
      const lower = text.toLowerCase();
      if (
        lower.includes("fake ") ||
        lower.includes("work_session") ||
        lower.includes("validation failed") ||
        lower.includes("output_validation") ||
        lower.includes("model-request") ||
        lower.includes("model-response") ||
        lower.includes("contract ") ||
        lower.includes("rootlet") ||
        lower.includes("provider") ||
        lower.includes("parent synthesis") ||
        lower.includes("direction_handoff") ||
        lower.includes("model.requested") ||
        lower.includes("model.completed")
      ) {
        if (type === "model.output.completed") return "已整理一段可展示材料，完整技术引用保留在详情里。";
        if (type === "agent.parent_synthesis.completed") return "已汇总多路检查结果，正在形成最终判断。";
        if (type === "agent.child.completed") return "一路局部检查已完成，返回了可审阅材料。";
        if (type === "agent.delegation.planned") return "已把任务拆成几路局部检查。";
        return EVENT_LABELS[type] || "工作状态已更新。";
      }
      return compact(text, 520);
    }

    function friendlyFailureText(value) {
      const text = String(value || "");
      const lower = text.toLowerCase();
      if (lower.includes("output_validation") || lower.includes("validation failed") || lower.includes("contract")) {
        return "模型返回的内容没有通过本轮工作会话格式检查。这不是你的输入问题；技术引用已放在详情里，可以调整模型或重试。";
      }
      if (lower.includes("api key") || lower.includes("missing_api_key")) {
        return "还没有配置可用的模型密钥。请打开详情里的设置，保存密钥后重试。";
      }
      if (lower.includes("missing_model") || lower.includes("模型名")) {
        return "还没有配置模型名。请打开详情里的设置，填写模型名后重试。";
      }
      if (lower.includes("ai 禁用") || lower.includes("ai_disabled")) {
        return "当前禁用了 AI，所以不能完成工作会话。请在详情里切换到真实模型或测试模式。";
      }
      if (lower.includes("network") || lower.includes("timeout")) {
        return "模型服务暂时不可用或请求超时。请检查网络和模型配置后重试。";
      }
      return compact(text || "运行被配置、权限或模型边界阻断。", 220);
    }

    function appendModelOutputDelta(event) {
      const key = modelOutputKey(event);
      const chunk = event.delta || "";
      if (chunk.length === 0) {
        return;
      }
      const existing = state.modelOutputEntries.get(key);
      if (existing) {
        existing.text += chunk;
        existing.body.textContent = visibleModelOutputText(existing.text);
        updateEntryStatus(existing.row, "running");
        existing.row.scrollIntoView({ block: "nearest" });
        return;
      }
      const entry = appendEntry({
        label: "工作中",
        title: "正在生成内容",
        body: visibleModelOutputText(chunk),
        status: event.status || "running",
        type: event.type,
        returnParts: true
      });
      state.modelOutputEntries.set(key, {
        row: entry.row,
        body: entry.body,
        text: chunk
      });
    }

    function completeModelOutput(event) {
      const key = modelOutputKey(event);
      const existing = state.modelOutputEntries.get(key);
      if (existing) {
        updateEntryStatus(existing.row, event.status || "completed");
        existing.body.textContent = event.summary || "内容已整理，已进入结果或详情。";
        return;
      }
      appendEntry({
        label: "工作中",
        title: "内容已整理",
        body: event.summary || "内容整理完成。",
        status: event.status || "completed",
        type: event.type
      });
    }

    function modelOutputKey(event) {
      if (event.modelCallRefs && event.modelCallRefs.length > 0) {
        return event.modelCallRefs[0];
      }
      return event.eventId || String(event.sequence);
    }

    function visibleModelOutputText(value) {
      const text = String(value || "");
      if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
        return "正在生成结构化内容，完成后会整理进结果或详情。";
      }
      if (text.length <= 680) {
        return text;
      }
      return compact(text, 680) + "\\n\\n（安全投影已截断，完整结构以 refs 和调试投影为准。）";
    }

    function updateEntryStatus(row, statusValue) {
      const bubble = row.querySelector(".bubble");
      const meta = row.querySelector(".entry-title .meta");
      if (bubble) {
        bubble.className = "bubble " + bubbleClass(statusValue === "failed" ? "run.failed" : "assistant", statusValue);
      }
      if (meta) {
        meta.textContent = STATUS_LABELS[statusValue] || statusValue || "";
      }
    }

    function appendLocalEntry(label, body, status, isUser) {
      appendEntry({ label: label, title: isUser ? "你的消息" : label, body: body, status: status, type: isUser ? "user" : "local" });
    }

    function updateAssistantTurn(title, body, status) {
      const safeTitle = title || "正在工作";
      const safeBody = body || "正在处理任务。";
      const safeStatus = status || "running";
      if (!state.assistantEntry) {
        state.assistantEntry = appendEntry({
          label: "助手",
          title: safeTitle,
          body: safeBody,
          status: safeStatus,
          type: safeStatus === "failed" ? "run.failed" : "assistant",
          returnParts: true
        });
        return;
      }
      state.assistantEntry.titleText.textContent = safeTitle;
      state.assistantEntry.body.textContent = safeBody;
      updateEntryStatus(state.assistantEntry.row, safeStatus);
    }

    function appendEntry(input) {
      removeEmptyTranscript();
      const row = document.createElement("div");
      row.className = "entry" + (input.type === "user" ? " user" : "");
      const label = document.createElement("div");
      label.className = "entry-label";
      label.textContent = input.label;
      const bubble = document.createElement("div");
      bubble.className = "bubble " + bubbleClass(input.type, input.status);
      const inner = document.createElement("div");
      inner.className = "bubble-inner";
      const title = document.createElement("div");
      title.className = "entry-title";
      const titleText = document.createElement("span");
      titleText.textContent = input.title;
      const status = document.createElement("span");
      status.className = "meta";
      status.textContent = STATUS_LABELS[input.status] || input.status || "";
      title.append(titleText, status);
      const body = document.createElement("div");
      body.className = "entry-body";
      body.textContent = input.body;
      inner.append(title, body);
      bubble.append(inner);
      row.append(label, bubble);
      dom.transcript.append(row);
      row.scrollIntoView({ block: "nearest" });
      if (input.returnParts) {
        return { row, body, titleText, status };
      }
      return undefined;
    }

    function bubbleClass(type, status) {
      if (status === "failed" || type === "run.failed") {
        return "failed";
      }
      if (type === "final.result") {
        return "final";
      }
      if (type.indexOf("tool.") === 0) {
        return "tool";
      }
      if (type.indexOf("model.") === 0) {
        return "model";
      }
      return "";
    }

    function removeEmptyTranscript() {
      const empty = dom.transcript.querySelector(".empty-transcript");
      if (empty) {
        empty.remove();
      }
    }

    function renderCanvas(canvas, status, response) {
      if (!canvas) {
        if (status === "running" || status === "failed") {
          dom.mainCanvas.hidden = true;
          dom.mainCanvas.replaceChildren();
          return;
        }
        dom.mainCanvas.hidden = false;
        dom.mainCanvas.replaceChildren(emptyResult(status, response));
        return;
      }
      dom.mainCanvas.hidden = false;
      if (canvas.kind === "desktop_chat_canvas") {
        renderDesktopChatCanvas(canvas);
      } else if (canvas.kind === "work_session_canvas") {
        renderWorkSessionCanvas(canvas);
      } else {
        renderLegacyPlanCanvas(canvas);
      }
    }

    function emptyResult(status, response) {
      const wrap = document.createElement("div");
      wrap.className = "result-head";
      const kicker = document.createElement("span");
      kicker.className = "report-kicker";
      kicker.textContent = "结果";
      const title = document.createElement("h2");
      const summary = document.createElement("div");
      summary.className = "summary-box";
      if (status === "running") {
        title.textContent = "正在准备结果";
        summary.textContent = "正在读取材料、比较方案并整理可审阅内容。";
      } else if (status === "failed" && response && response.error) {
        title.textContent = "这次没有完成";
        summary.textContent = friendlyFailureText(response.error.message);
      } else {
        title.textContent = "等待任务开始";
        summary.textContent = "任务完成后，结论、依据、风险、不确定性和下一步会显示在这条会话里。";
      }
      wrap.append(kicker, title, summary);
      return wrap;
    }

    function renderWorkSessionCanvas(canvas) {
      const directAnswer = canvas.workSession.directAnswer;
      const report = canvas.workSession.report;
      const artifact = canvas.workSession.artifact;
      const blocks = [];
      if (directAnswer) {
        blocks.push(directAnswerPreview(directAnswer));
      } else if (report) {
        blocks.push(artifactPreview(report, artifact));
      } else {
        blocks.push(resultHead("工作尚未形成结果", canvas.explanation.resultWhyReasonable));
        blocks.push(resultSection("待补充", canvas.workSession.openQuestions.length > 0 ? canvas.workSession.openQuestions : ["等待更多材料或配置。"]));
      }
      dom.mainCanvas.replaceChildren(...blocks);
    }

    function renderDesktopChatCanvas(canvas) {
      const answer = canvas.chat.answer;
      const blocks = [];
      if (answer) {
        dom.mainCanvas.hidden = true;
        dom.mainCanvas.replaceChildren();
        return;
      } else if (canvas.chat.upgradeRequest) {
        blocks.push(resultHead("正在进入工作会话", canvas.chat.upgradeRequest.reason));
      } else {
        blocks.push(resultHead("这次没有完成", canvas.chat.failureMessage || canvas.explanation.resultWhyReasonable));
      }
      dom.mainCanvas.hidden = false;
      dom.mainCanvas.replaceChildren(...blocks);
    }

    function renderLegacyPlanCanvas(canvas) {
      dom.mainCanvas.replaceChildren(
        resultHead(canvas.plan.recommendedDirection.summary, canvas.plan.recommendedDirection.reason),
        resultSection("依据", canvas.plan.keyEvidenceRefs),
        resultSection("不确定性", canvas.plan.uncertainty),
        resultSection("下一步", [canvas.aboveground.artifact ? canvas.aboveground.artifact.summary : "等待执行结果。"])
      );
    }

    function resultHead(title, summary) {
      const head = document.createElement("div");
      head.className = "result-head";
      const kicker = document.createElement("span");
      kicker.className = "report-kicker";
      kicker.textContent = "结果";
      const h = document.createElement("h2");
      h.textContent = title || "工作结果";
      const body = document.createElement("div");
      body.className = "summary-box";
      body.textContent = summary || "结果已生成。";
      head.append(kicker, h, body);
      return head;
    }

    function artifactPreview(report, artifact) {
      const preview = document.createElement("article");
      preview.className = "artifact-preview";
      const topline = document.createElement("div");
      topline.className = "artifact-topline";
      const type = document.createElement("span");
      type.textContent = artifact ? "报告 · " + artifact.type : "报告";
      const confidence = document.createElement("span");
      confidence.textContent = typeof report.confidence === "number" ? "可信度 " + Math.round(report.confidence * 100) + "%" : "等待审阅";
      topline.append(type, confidence);

      const title = document.createElement("h2");
      title.className = "artifact-title";
      title.textContent = report.title || "工作结果";

      const summary = document.createElement("div");
      summary.className = "artifact-summary";
      summary.textContent = report.decisionSummary || "结果已生成，等待审阅。";

      const grid = document.createElement("div");
      grid.className = "artifact-grid";
      grid.append(
        artifactSection("关键发现", report.keyFindings),
        artifactSection("建议", report.recommendations),
        artifactSection("证据", report.evidenceRefs),
        artifactSection("不确定性", report.uncertainty)
      );

      preview.append(topline, title, summary);
      if (artifact) {
        preview.append(artifactSection("产物", [artifact.summary]));
      }
      preview.append(grid, artifactSection("下一步", report.nextActions));
      return preview;
    }

    function directAnswerPreview(answer) {
      const preview = document.createElement("article");
      preview.className = "artifact-preview";
      const topline = document.createElement("div");
      topline.className = "artifact-topline";
      const type = document.createElement("span");
      type.textContent = "回答";
      const confidence = document.createElement("span");
      confidence.textContent = typeof answer.confidence === "number" ? "可信度 " + Math.round(answer.confidence * 100) + "%" : "已完成";
      topline.append(type, confidence);

      const title = document.createElement("h2");
      title.className = "artifact-title";
      title.textContent = "回答";

      const summary = document.createElement("div");
      summary.className = "artifact-summary";
      summary.textContent = answer.answer || "已回答。";

      preview.append(topline, title, summary);
      const evidence = Array.isArray(answer.evidenceRefs) ? answer.evidenceRefs : [];
      if (evidence.length > 0) {
        preview.append(artifactSection("依据", evidence));
      }
      const uncertainty = Array.isArray(answer.uncertainty) ? answer.uncertainty : [];
      if (uncertainty.length > 0) {
        preview.append(artifactSection("不确定性", uncertainty));
      }
      const followUps = Array.isArray(answer.followUpSuggestions) ? answer.followUpSuggestions : [];
      if (followUps.length > 0) {
        preview.append(artifactSection("可以继续", followUps));
      }
      return preview;
    }

    function artifactSection(title, items) {
      const section = document.createElement("section");
      section.className = "result-section";
      const h = document.createElement("h2");
      h.textContent = title;
      section.append(h);
      const values = Array.isArray(items) ? items.filter(Boolean) : [];
      if (values.length === 0) {
        const p = document.createElement("p");
        p.className = "hint";
        p.textContent = "暂无。";
        section.append(p);
        return section;
      }
      const list = document.createElement("ul");
      values.slice(0, 8).forEach((value) => {
        const item = document.createElement("li");
        item.textContent = compact(String(value), 360);
        list.append(item);
      });
      section.append(list);
      return section;
    }

    function resultSection(title, items) {
      const section = document.createElement("section");
      section.className = "result-section";
      const h = document.createElement("h2");
      h.textContent = title;
      section.append(h);
      const values = Array.isArray(items) ? items.filter(Boolean) : [];
      if (values.length === 0) {
        const p = document.createElement("p");
        p.className = "hint";
        p.textContent = "暂无。";
        section.append(p);
        return section;
      }
      const list = document.createElement("ul");
      values.slice(0, 8).forEach((value) => {
        const item = document.createElement("li");
        item.textContent = String(value);
        list.append(item);
      });
      section.append(list);
      return section;
    }

    function renderRightPanels(response) {
      const status = response && response.status ? response.status : "pending";
      dom.railStatusBadge.textContent = STATUS_LABELS[status] || status;
      if (!response) {
        dom.riskPanel.replaceChildren(railItem("待确认", "任务开始后，需要你授权或补充的信息会出现在这里。", "good"));
        return;
      }
      const canvas = response.canvas;
      const questions = canvas && canvas.kind === "work_session_canvas" ? canvas.workSession.openQuestions : [];
      if (response.error) {
        dom.riskPanel.replaceChildren(railItem("需要处理", friendlyFailureText(response.error.message), "error"));
        return;
      }
      if (questions && questions.length > 0) {
        dom.riskPanel.replaceChildren(...questions.slice(0, 5).map((question) => railItem("需要确认", question, "warn")));
        return;
      }
      dom.riskPanel.replaceChildren(railItem("暂无待办", "当前没有阻塞问题。", "good"));
    }

    function renderRunPath(response) {
      if (!response || !response.transcript || !Array.isArray(response.transcript.events) || response.transcript.events.length === 0) {
        dom.runPath.replaceChildren(railItem("等待", "任务开始后会显示正在读取、比较和整理的过程。"));
        return;
      }
      const canvas = response.canvas;
      if (canvas && canvas.kind === "desktop_chat_canvas") {
        if (canvas.chat.answer) {
          dom.runPath.replaceChildren(railItem("已回复", "这是一条普通对话，没有启动报告或项目分析流程。", "good"));
          return;
        }
        if (canvas.chat.upgradeRequest) {
          dom.runPath.replaceChildren(railItem("正在展开任务", canvas.chat.upgradeRequest.reason, "warn"));
          return;
        }
      }
      const visibleEvents = response.transcript.events
        .filter((event) => event.type !== "model.output.delta" && event.type !== "model.output.completed")
        .slice(-5)
        .reverse();
      const rows = visibleEvents.map((event) =>
        railItem(EVENT_LABELS[event.type] || "工作更新", event.type === "run.failed"
          ? friendlyFailureText(event.summary || event.delta)
          : productActivityText(event.type, event.summary || event.delta || "状态已更新。"))
      );
      dom.runPath.replaceChildren(...rows);
    }

    function renderMetrics(status, response) {
      const canvas = response && response.canvas;
      if (canvas && canvas.kind === "desktop_chat_canvas") {
        const goalRef = canvas.taskSoil.contextRefs.find((ref) => ref.kind === "user_goal");
        dom.runMetrics.replaceChildren(
          railItem("本次消息", goalRef ? humanContextSummary(goalRef) : "普通对话。"),
          railItem("上下文", canvas.chat.answer ? "未请求额外文件或网页。" : "等待判断是否需要更多材料。")
        );
        return;
      }
      const refs = canvas ? canvas.taskSoil.contextRefs : [];
      if (!refs || refs.length === 0) {
        dom.runMetrics.replaceChildren(railItem("材料", "可以在输入框里补充文件、网页或项目引用。"));
        return;
      }
      const rows = refs.slice(0, 8).map((ref) => railItem(contextKindLabel(ref.kind), humanContextSummary(ref)));
      dom.runMetrics.replaceChildren(...rows);
    }

    function renderSupervision(response) {
      const canvas = response && response.canvas;
      if (!canvas) {
        dom.supervisionStatus.replaceChildren(railItem("等待", "任务开始后，相关引用会显示在这里。"));
        return;
      }
      if (canvas.kind === "work_session_canvas") {
        const directAnswer = canvas.workSession.directAnswer;
        const report = canvas.workSession.report;
        const artifact = canvas.workSession.artifact;
        const rows = [];
        if (directAnswer) rows.push(railItem("回答", directAnswer.decisionSummary || "已直接回答。", "good"));
        if (directAnswer && directAnswer.evidenceRefs.length > 0) {
          directAnswer.evidenceRefs.slice(0, 6).forEach((ref) => rows.push(railItem("依据", ref)));
        }
        if (artifact) rows.push(railItem("产物", artifact.summary, "good"));
        if (report && report.evidenceRefs.length > 0) {
          report.evidenceRefs.slice(0, 6).forEach((ref) => rows.push(railItem("依据", ref)));
        }
        if (rows.length === 0) rows.push(railItem("等待", "报告尚未形成引用。"));
        dom.supervisionStatus.replaceChildren(...rows);
        return;
      }
      if (canvas.kind === "desktop_chat_canvas") {
        const rows = [];
        if (canvas.chat.answer) rows.push(railItem("回答", "已直接回复。", "good"));
        if (canvas.chat.upgradeRequest) rows.push(railItem("任务", canvas.chat.upgradeRequest.reason, "warn"));
        if (rows.length === 0) rows.push(railItem("等待", "尚未形成回复。"));
        dom.supervisionStatus.replaceChildren(...rows);
        return;
      }
      dom.supervisionStatus.replaceChildren(
        railItem("产物", canvas.aboveground.artifact ? canvas.aboveground.artifact.summary : "等待执行成果。", canvas.aboveground.artifact ? "good" : ""),
        ...canvas.plan.keyEvidenceRefs.slice(0, 5).map((ref) => railItem("依据", ref))
      );
    }

    function renderFlow(response) {
      const tracking = response && response.tracking;
      if (!tracking) {
        dom.flowList.replaceChildren(statusLine("模型 / 工具流", "等待运行。模型和工具调用只展示安全 refs、状态和摘要。"));
        return;
      }
      const calls = response.transcript && Array.isArray(response.transcript.modelCalls)
        ? response.transcript.modelCalls.slice(-4).reverse()
        : [];
      const list = document.createElement("div");
      list.className = "call-list";
      if (calls.length === 0) {
        list.append(statusLine("模型调用明细", "暂无模型调用。"));
      } else {
        calls.forEach((call) => list.append(modelCallRow(call)));
      }
      dom.flowList.replaceChildren(
        statusLine("模型调用", "请求 / 完成 / 失败 = " + counts(tracking.modelTotals) + "；状态 " + tracking.provider.status, tracking.modelTotals.failed > 0 ? "error" : ""),
        list,
        statusLine("工具调用", "请求 / 完成 / 失败 = " + counts(tracking.toolTotals), tracking.toolTotals.failed > 0 ? "warn" : "")
      );
    }

    function renderFailurePanel(response) {
      const failedCalls = response && response.transcript && Array.isArray(response.transcript.modelCalls)
        ? response.transcript.modelCalls.filter((call) => call.status === "failed")
        : [];
      const latestFailed = failedCalls[failedCalls.length - 1];
      if (!response || (!response.error && failedCalls.length === 0)) {
        dom.failurePanel.replaceChildren(
          statusLine("暂无阻断", "模型服务失败、输出契约失败或配置边界会显示在这里。", "good")
        );
        return;
      }
      const rows = [];
      if (response.error) {
        rows.push(statusLine("阻断原因", response.error.message, "error"));
      }
      if (latestFailed) {
        rows.push(modelCallRow(latestFailed));
        rows.push(statusLine("处理建议", remediationForModelFailure(latestFailed), "warn"));
      } else if (response.error) {
        rows.push(statusLine("处理建议", remediationForError(response.error), "warn"));
      }
      dom.failurePanel.replaceChildren(...rows);
    }

    function modelCallRow(call) {
      const row = document.createElement("div");
      row.className = "call-row " + (call.status === "failed" ? "failed" : call.status === "completed" ? "completed" : "");
      const body = document.createElement("div");
      const title = document.createElement("div");
      title.className = "call-title";
      title.textContent = (call.purpose || "unknown purpose") + (call.rootletKind ? " / " + call.rootletKind : "");
      const meta = document.createElement("div");
      meta.className = "node-meta";
      meta.textContent = [
        call.outputContractId ? "contract " + call.outputContractId : "",
        call.model ? "model " + call.model : "",
        call.failureKind ? "failure " + call.failureKind : "",
        call.validationStatus ? "validation " + call.validationStatus : "",
        call.requestId
      ].filter(Boolean).join("；");
      body.append(title, meta);
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = callStatusLabel(call.status);
      row.append(body, tag);
      return row;
    }

    function callStatusLabel(status) {
      if (status === "requested") return "请求中";
      if (status === "completed") return "完成";
      if (status === "failed") return "失败";
      return String(status || "");
    }

    function renderAgentTree(response) {
      const tree = response && response.tracking && response.tracking.agentRunTree;
      if (!tree) {
        dom.agentTree.replaceChildren(emptyAgentTreeNode());
        dom.agentInspector.textContent = "运行后显示 spec、权限、预算和输出引用。";
        dom.parentSynthesis.replaceChildren(statusLine("父层 synthesis", "等待 child/rootlet 安全摘要。"));
        return;
      }
      const nodes = [];
      nodes.push(agentNode({
        title: tree.rootSpec.displayName || tree.rootAgentId,
        status: tree.status,
        meta: "root " + tree.rootAgentId + "；delegation " + tree.delegationDecisions.length + "；synthesis " + tree.parentSyntheses.length,
        onClick: () => renderRootInspector(tree)
      }));
      tree.childRuns.forEach((run) => {
        nodes.push(agentNode({
          title: run.displayName || run.agentId,
          status: run.status,
          meta: [
            run.rootletKind ? "kind " + run.rootletKind : run.role,
            "outputs " + run.outputRefs.length,
            run.confidence !== undefined ? "confidence " + String(run.confidence) : ""
          ].filter(Boolean).join("；"),
          child: true,
          onClick: () => renderAgentInspector(run)
        }));
      });
      dom.agentTree.replaceChildren(...nodes);
      if (tree.parentSyntheses.length > 0) {
        const latest = tree.parentSyntheses[tree.parentSyntheses.length - 1];
        renderSynthesisInspector(latest);
        dom.parentSynthesis.replaceChildren(
          statusLine("父层 synthesis", compact(latest.decisionSummary, 240) + "；material refs " + latest.retainedMaterialRefs.slice(0, 4).join("，"))
        );
      } else {
        renderRootInspector(tree);
        dom.parentSynthesis.replaceChildren(statusLine("父层 synthesis", "等待 child/rootlet 材料回收。"));
      }
    }

    function agentNode(input) {
      const node = document.createElement("button");
      node.type = "button";
      node.className = "agent-node" + (input.child ? " child" : "");
      node.addEventListener("click", input.onClick || (() => {}));
      const body = document.createElement("div");
      const head = document.createElement("div");
      head.className = "node-head";
      const title = document.createElement("span");
      title.textContent = input.title;
      head.append(title);
      const meta = document.createElement("div");
      meta.className = "node-meta";
      meta.textContent = input.meta || "";
      body.append(head, meta);
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = agentStatusLabel(input.status);
      node.append(body, tag);
      return node;
    }

    function agentStatusLabel(status) {
      if (status === "completed") return "完成";
      if (status === "running") return "运行中";
      if (status === "failed") return "失败";
      if (status === "stopped") return "停止";
      if (status === "planned") return "计划";
      if (status === "interrupted") return "打断";
      if (status === "resumed") return "恢复";
      return String(status || "");
    }

    function renderAgentInspector(run) {
      dom.agentInspector.replaceChildren(detailGrid([
        ["身份", run.displayName + " / " + run.agentId],
        ["spec", run.specId],
        ["角色", [run.role, run.rootletKind ? "kind " + run.rootletKind : ""].filter(Boolean).join("；")],
        ["权限", (run.allowModel ? "model" : "no-model") + (run.allowedTools && run.allowedTools.length ? " + " + run.allowedTools.join("/") : "")],
        ["预算", "model rounds " + run.budget.maxModelRounds + "；tool rounds " + run.budget.maxToolRounds],
        ["输入", compact(run.inputRefs.slice(0, 4).join("，") || "无", 180)],
        ["输出", compact(run.outputRefs.slice(0, 5).join("，") || "等待", 220)],
        ["证据", compact(run.evidenceRefs.slice(0, 4).join("，") || "等待", 180)],
        ["置信", run.confidence === undefined ? "unknown" : String(run.confidence)],
        ["不确定性", compact(run.uncertainty || run.failureReason || "未报告", 180)]
      ]));
    }

    function renderRootInspector(tree) {
      const spec = tree.rootSpec;
      dom.agentInspector.replaceChildren(detailGrid([
        ["身份", spec.displayName + " / " + tree.rootAgentId],
        ["spec", spec.specId],
        ["角色", spec.role],
        ["权限", (spec.allowModel ? "model" : "no-model") + (spec.allowedTools.length ? " + " + spec.allowedTools.join("/") : "")],
        ["预算", "model rounds " + spec.budget.maxModelRounds + "；tool rounds " + spec.budget.maxToolRounds + (spec.budget.maxChildRuns ? "；children " + spec.budget.maxChildRuns : "")],
        ["派生", tree.childRuns.length + " child runs；" + tree.delegationDecisions.length + " delegation decisions"],
        ["综合", tree.parentSyntheses.length + " parent syntheses；child output 不直通结果"]
      ]));
    }

    function renderSynthesisInspector(synthesis) {
      dom.agentInspector.replaceChildren(detailGrid([
        ["synthesis", synthesis.synthesisId],
        ["动作", synthesis.nextAction],
        ["来源", synthesis.source + "；confidence " + synthesis.confidence],
        ["保留", compact(synthesis.retainedMaterialRefs.slice(0, 5).join("，") || "无", 220)],
        ["冲突", compact(synthesis.conflictRefs.slice(0, 4).join("，") || "无", 180)],
        ["摘要", compact(synthesis.decisionSummary, 260)],
        ["不确定性", compact(synthesis.uncertainty || "未报告", 180)]
      ]));
    }

    function detailGrid(rows) {
      const grid = document.createElement("div");
      grid.className = "detail-grid";
      rows.forEach((row) => {
        const item = document.createElement("div");
        item.className = "detail-item";
        const key = document.createElement("span");
        key.textContent = row[0];
        const value = document.createElement("span");
        value.textContent = row[1];
        item.append(key, value);
        grid.append(item);
      });
      return grid;
    }

    function emptyAgentTreeNode() {
      const node = document.createElement("div");
      node.className = "node-meta";
      node.textContent = "暂无派生 agent。";
      return node;
    }

    function renderDebug(response) {
      const items = [];
      if (response && response.tracking) {
        items.push("phase: " + response.tracking.run.phase + " / stage: " + response.tracking.run.stage);
        items.push("model requested/completed/failed: " + counts(response.tracking.modelTotals));
        items.push("tool requested/completed/failed: " + counts(response.tracking.toolTotals));
      }
      if (response && response.error) {
        items.push("error: " + response.error.code);
      }
      dom.debugList.replaceChildren(...items.map((text) => {
        const li = document.createElement("li");
        li.textContent = text;
        return li;
      }));
      dom.debugJson.textContent = JSON.stringify({
        runId: response && response.runId,
        runKind: response && response.runKind,
        status: response && response.status,
        canvas: response && response.canvas,
        tracking: response && response.tracking,
        summary: response && response.summary,
        observation: response && response.observation,
        error: response && response.error
      }, null, 2);
    }

    function counts(value) {
      return (value.requested || 0) + " / " + (value.completed || 0) + " / " + (value.failed || 0);
    }

    function renderProviderStatus() {
      const config = state.config;
      if (!config) {
        return;
      }
      const selectedMode = dom.aiMode.value || preferredRunMode();
      const status = providerStatusFromConfig(config, selectedMode);
      const todos = providerTodos(status, config);
      dom.providerHint.textContent = status === "ready"
        ? "真实模型已就绪"
        : status === "fake_provider"
          ? "测试模式已启用"
          : "待配置：" + todos.join("；");
      dom.configStatus.textContent = "当前入口：" + modeLabel(selectedMode) + "；默认：" + modeLabel(config.defaultAiMode || "openai-compatible") + "；模型：" + (config.model || "未填写") + "；密钥：" + (config.secretConfigured ? "已配置" : "未配置");
      dom.configStatus.className = "hint" + (status === "missing_model" || status === "missing_secret" || status === "missing_model_and_secret" ? " error" : "");
      renderSupervision(undefined);
      renderRightPanels(undefined);
      renderFailurePanel(undefined);
    }

    function preferredRunMode() {
      return "openai-compatible";
    }

    function providerStatusFromConfig(config, requestedMode) {
      if (requestedMode === "none") return "network_disabled";
      if (requestedMode === "fake") return "fake_provider";
      const missingModel = !config.model;
      const missingSecret = !config.secretConfigured;
      if (missingModel && missingSecret) return "missing_model_and_secret";
      if (missingModel) return "missing_model";
      if (missingSecret) return "missing_secret";
      return "ready";
    }

    function providerTodos(status, config) {
      if (status === "ready") return [];
      if (status === "fake_provider") return ["Fake AI 只用于测试和 CI，不代表真实产品验证"];
      if (status === "network_disabled") return ["AI 禁用只用于边界检查，不能形成 completed artifact"];
      const todos = [];
      if (status === "missing_model" || status === "missing_model_and_secret") todos.push("填写模型名");
      if (status === "missing_secret" || status === "missing_model_and_secret") todos.push("保存 API Key");
      if (!config.baseUrl) todos.push("确认 Base URL");
      return todos;
    }

    function modeLabel(mode) {
      if (mode === "openai-compatible") return "OpenAI-compatible 推荐";
      if (mode === "fake") return "Fake AI 测试模式";
      if (mode === "none") return "AI 禁用";
      return String(mode || "");
    }

    function renderToolStatus() {
      const webSearch = state.tools && state.tools.webSearch;
      if (!webSearch) {
        return;
      }
      dom.toolConfigStatus.textContent = "搜索服务：" + webSearch.provider + "；状态：" + webSearch.status + "；密钥：" + (webSearch.secretConfigured ? "已配置" : "未配置");
      dom.toolConfigStatus.className = "hint";
    }

    function rememberRun(goal, runId) {
      state.runHistory.unshift({ goal: goal, runId: runId });
      state.runHistory = state.runHistory.slice(0, 8);
      dom.runCount.textContent = String(state.runHistory.length);
      dom.runHistory.replaceChildren(...state.runHistory.map((item, index) => {
        const li = document.createElement("li");
        li.className = "run-item" + (index === 0 ? " active" : "");
        const title = document.createElement("div");
        title.className = "run-title";
        title.textContent = compact(item.goal, 28);
        const meta = document.createElement("div");
        meta.className = "run-meta";
        meta.textContent = index === 0 ? "刚刚运行" : "历史任务";
        li.append(title, meta);
        return li;
      }));
    }

    function resetComposer() {
      stopLiveUpdates();
      state.seenSequences = new Set();
      state.lastSequence = 0;
      state.currentRunId = undefined;
      state.lastFocusedTerminalRunId = undefined;
      state.modelOutputEntries = new Map();
      state.assistantEntry = undefined;
      state.inspectorPinned = false;
      setInspectorTab("overview", false);
      closeDeveloperDrawer();
      dom.goalInput.value = "";
      dom.contextRefsInput.value = "";
      dom.permissionRefsInput.value = "";
      dom.sessionTitle.textContent = "新任务";
      dom.introBlock.hidden = false;
      dom.transcript.replaceChildren(emptyTranscriptNode());
      renderCanvas(undefined, "pending");
      setRunStatus("pending");
      renderRunPath(undefined);
      renderMetrics("pending", undefined);
      renderAgentTree(undefined);
      renderSupervision(undefined);
      renderRightPanels(undefined);
      renderFailurePanel(undefined);
      renderFlow(undefined);
      dom.debugJson.textContent = "{}";
    }

    function emptyTranscriptNode() {
      const node = document.createElement("div");
      node.className = "empty-transcript";
      node.textContent = "暂无活动。开始任务后，这里会显示正在读取、比较、整理和生成的过程。";
      return node;
    }

    function statusLine(title, body, tone) {
      const item = document.createElement("div");
      item.className = "status-line" + (tone ? " " + tone : "");
      const strong = document.createElement("strong");
      strong.textContent = title;
      const span = document.createElement("span");
      span.className = "node-meta";
      span.textContent = body;
      item.append(strong, span);
      return item;
    }

    function railItem(title, body, tone) {
      const row = document.createElement("div");
      row.className = "rail-row" + (tone ? " " + tone : "");
      const key = document.createElement("div");
      key.className = "rail-key";
      key.textContent = title;
      const value = document.createElement("div");
      value.className = "rail-value";
      value.textContent = compact(body || "暂无。", 220);
      row.append(key, value);
      return row;
    }

    function contextKindLabel(kind) {
      if (kind === "file") return "文件";
      if (kind === "web") return "网页";
      if (kind === "project") return "项目";
      if (kind === "user_goal") return "任务";
      return "工作区";
    }

    function humanContextSummary(ref) {
      if (ref.readonlyPreview && ref.readonlyPreview.text) {
        return (ref.readonlyPreview.title || "材料预览") + "：" + compact(ref.readonlyPreview.text, 120);
      }
      if (ref.summary && ref.summary.indexOf("Desktop Shell provided") < 0) {
        return compact(ref.summary, 140);
      }
      if (ref.kind === "workspace") {
        return "当前工作区以引用方式提供。";
      }
      if (ref.kind === "user_goal") {
        return "用户任务已记录。";
      }
      return compact(ref.ref || ref.kind || "引用", 120);
    }

    function remediationForModelFailure(call) {
      if (call.failureKind === "output_validation") {
        return "模型返回已到达，但没有通过输出契约；下一步应收紧该 agent 的 JSON 协议、增加修复 / 重试回合，不能把失败输出当结果。";
      }
      if (call.failureKind === "provider_auth") return "检查 API Key、账号权限和 Base URL。";
      if (call.failureKind === "provider_rate_limit") return "降低并发或稍后重试；预算边界不能绕过。";
      if (call.failureKind === "provider_network" || call.failureKind === "provider_timeout") return "检查网络、模型服务可用性和超时设置。";
      return "保留失败 refs，先定位模型服务 / contract / agent purpose，再决定是否重试。";
    }

    function remediationForError(error) {
      if (!error) return "检查输入和配置后重试。";
      if (error.code === "missing_api_key") return "打开诊断里的设置，保存 API Key 后重试。";
      if (error.code === "missing_model") return "打开诊断里的设置，填写模型名后重试。";
      if (error.code === "missing_model_and_secret") return "打开诊断里的设置，填写模型名并保存 API Key 后重试。";
      if (error.code === "ai_disabled") return "AI 禁用只能验证边界，不能产出完成结果；请切换到真实模型或测试模式。";
      return "检查诊断详情，处理配置、权限或模型服务问题后重试。";
    }

    function setRunStatus(status) {
      dom.runStatus.textContent = STATUS_LABELS[status] || status || "待开始";
    }

    function setButtons(enabled) {
      dom.runButton.disabled = !enabled;
      dom.saveConfigButton.disabled = !enabled;
      dom.saveToolConfigButton.disabled = !enabled;
    }

    function stopLiveUpdates() {
      if (state.eventSource) {
        state.eventSource.close();
        state.eventSource = undefined;
      }
      clearInterval(state.pollingTimer);
      state.pollingTimer = undefined;
    }

    async function requestJson(url, options) {
      const init = options || {};
      const response = await fetch(url, {
        method: init.method || "GET",
        headers: init.body ? { "content-type": "application/json" } : undefined,
        body: init.body ? JSON.stringify(init.body) : undefined
      });
      const text = await response.text();
      let body;
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = { message: text || "响应解析失败。" };
      }
      if (!response.ok) {
        throw new Error(body.error && body.error.message ? body.error.message : body.message || "请求失败。");
      }
      return body;
    }

    function compact(value, maxLength) {
      const text = String(value || "");
      return text.length <= maxLength ? text : text.slice(0, Math.max(0, maxLength - 1)) + "…";
    }
  </script>
</body>
</html>`;
}
