export function createPanelHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AgentArbor 地下运行面板</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f6f7;
      --sidebar: #eef1f0;
      --sidebar-strong: #e7ecea;
      --canvas: #ffffff;
      --panel: #fafbfb;
      --line: #d9dfdc;
      --line-soft: #edf0ee;
      --text: #202622;
      --muted: #68736d;
      --accent: #167554;
      --accent-strong: #0d5d41;
      --accent-soft: #e7f3ed;
      --warn: #a16207;
      --danger: #b42318;
      --ok: #15803d;
      --info: #2563eb;
      --code: #202938;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }

    button, input, select, textarea { font: inherit; }

    button {
      min-height: 36px;
      border: 1px solid var(--accent-strong);
      border-radius: 6px;
      background: var(--accent);
      color: #fff;
      padding: 0 14px;
      cursor: pointer;
      white-space: nowrap;
    }

    button:disabled {
      cursor: not-allowed;
      opacity: 0.56;
    }

    input, select, textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      color: var(--text);
      padding: 9px 10px;
    }

    textarea {
      min-height: 84px;
      resize: vertical;
    }

    label {
      display: grid;
      gap: 5px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
    }

    h1, h2, h3, p {
      margin-top: 0;
    }

    h1 {
      margin-bottom: 10px;
      font-size: 40px;
      line-height: 1.12;
    }

    h2 {
      margin-bottom: 12px;
      font-size: 15px;
    }

    h3 {
      margin: 0;
      font-size: 13px;
    }

    .app-shell {
      display: grid;
      grid-template-columns: 264px minmax(0, 1fr) 320px;
      height: 100vh;
      overflow: hidden;
    }

    .sidebar {
      display: grid;
      grid-template-rows: auto auto auto auto minmax(0, 1fr) auto;
      gap: 18px;
      height: 100vh;
      overflow: auto;
      padding: 18px;
      border-right: 1px solid var(--line);
      background: var(--sidebar);
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 18px;
      font-weight: 800;
      color: var(--accent-strong);
    }

    .arbor-mark,
    .profile-mark {
      position: relative;
      display: inline-grid;
      place-items: center;
      width: 34px;
      height: 34px;
      border: 1px solid #a9c9bb;
      border-radius: 50%;
      background: #fff;
      color: var(--accent);
      font-weight: 800;
    }

    .arbor-mark::before {
      content: "A";
      font-size: 18px;
      line-height: 1;
      transform: translateY(1px);
    }

    .arbor-mark::after {
      content: "";
      position: absolute;
      width: 13px;
      height: 11px;
      border-top: 2px solid currentColor;
      border-right: 2px solid currentColor;
      border-radius: 0 8px 0 0;
      opacity: 0.58;
      transform: translate(8px, -7px) rotate(-18deg);
    }

    .sidebar-action {
      width: 100%;
      justify-content: center;
      background: #fff;
      color: var(--accent-strong);
    }

    .nav-list,
    .task-list {
      display: grid;
      gap: 7px;
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .nav-item,
    .task-item {
      border-radius: 8px;
      padding: 9px 10px;
      color: var(--muted);
    }

    .nav-item {
      display: grid;
      grid-template-columns: 24px minmax(0, 1fr);
      align-items: center;
      gap: 8px;
    }

    .nav-glyph {
      display: inline-grid;
      place-items: center;
      width: 22px;
      height: 22px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.72);
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
    }

    .nav-item.active,
    .task-item.active {
      background: var(--sidebar-strong);
      color: var(--accent-strong);
      font-weight: 750;
    }

    .nav-item.active .nav-glyph {
      background: var(--accent-soft);
      color: var(--accent-strong);
    }

    .empty-direction-card {
      display: grid;
      grid-template-columns: 28px minmax(0, 1fr);
      gap: 10px;
      align-items: start;
      border: 1px dashed #cbd5d0;
      background: rgba(255, 255, 255, 0.58);
    }

    .empty-dot {
      display: inline-grid;
      place-items: center;
      width: 24px;
      height: 24px;
      border-radius: 7px;
      background: #fff;
      color: var(--accent-strong);
      font-weight: 800;
    }

    .sidebar-heading {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 750;
    }

    .task-meta,
    .profile-meta,
    .hint,
    .stage-detail {
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }

    .profile {
      grid-row: 6;
      display: flex;
      gap: 10px;
      align-items: center;
      align-self: end;
      padding-top: 16px;
      border-top: 1px solid var(--line);
    }

    .profile-mark::before {
      content: "AA";
      font-size: 12px;
      letter-spacing: 0;
    }

    .profile-name {
      font-weight: 750;
    }

    .workbench {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto auto auto;
      height: 100vh;
      min-height: 0;
      overflow: hidden;
      background: var(--canvas);
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      min-height: 58px;
      padding: 0 22px;
      border-bottom: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.92);
    }

    .topbar-left,
    .topbar-actions {
      display: flex;
      align-items: center;
      min-width: 0;
    }

    .topbar-left {
      gap: 10px;
    }

    .topbar-title {
      font-weight: 750;
      color: var(--text);
    }

    .topbar-kicker {
      color: var(--muted);
      font-size: 12px;
    }

    .topbar-actions {
      justify-content: flex-end;
      gap: 8px;
      flex-wrap: wrap;
    }

    .topbar-action {
      min-height: 32px;
      border-color: transparent;
      background: transparent;
      color: var(--muted);
      padding: 0 9px;
      font-size: 13px;
    }

    .topbar-action:hover,
    .topbar-action:focus-visible {
      border-color: var(--line);
      background: var(--panel);
      color: var(--text);
    }

    .status-pill {
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--panel);
      color: var(--muted);
      padding: 5px 9px;
      min-width: 116px;
      text-align: center;
      white-space: nowrap;
      font-size: 12px;
    }

    .status-pill.completed { color: var(--ok); border-color: #86efac; }
    .status-pill.failed { color: var(--danger); border-color: #fecaca; }
    .status-pill.running { color: var(--warn); border-color: #fde68a; }

    .canvas-scroll {
      display: grid;
      align-items: center;
      justify-items: center;
      min-height: 0;
      padding: 22px 36px;
      overflow: auto;
    }

    .center-stage {
      width: min(880px, 100%);
      text-align: center;
    }

    .hero-mark {
      width: 52px;
      height: 52px;
      margin-bottom: 14px;
      background: var(--accent-soft);
    }

    .hero-mark::before {
      font-size: 26px;
    }

    .hero-mark::after {
      width: 16px;
      height: 13px;
      transform: translate(10px, -9px) rotate(-18deg);
    }

    .subtitle {
      margin: 0 auto 26px;
      max-width: 620px;
      color: var(--muted);
      font-size: 17px;
    }

    .capability-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 16px;
    }

    .capability-card {
      min-height: 140px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      padding: 20px 16px;
      display: grid;
      gap: 10px;
      align-content: center;
      line-height: 1.42;
      transition: border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
    }

    .capability-card:hover,
    .capability-card:focus-visible {
      border-color: #b7cac2;
      box-shadow: 0 10px 24px rgba(22, 45, 34, 0.08);
      outline: 0;
      transform: translateY(-1px);
    }

    .capability-icon {
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      margin: 0 auto;
      border-radius: 8px;
      background: var(--accent-soft);
      border: 1px solid #d3e7de;
      color: var(--accent-strong);
      font-weight: 800;
      font-size: 18px;
      box-shadow: inset 0 -1px 0 rgba(13, 93, 65, 0.08);
    }

    .capability-card h2 {
      margin: 0;
      font-size: 17px;
    }

    .capability-card p {
      margin: 0;
      color: var(--muted);
      font-size: 13px;
    }

    .activity-view,
    .result-view {
      display: none;
      text-align: left;
    }

    body[data-run-state="running"] .start-view,
    body[data-run-state="completed"] .start-view,
    body[data-run-state="failed"] .start-view {
      display: none;
    }

    body[data-run-state="running"] .activity-view,
    body[data-run-state="failed"] .activity-view {
      display: block;
    }

    body[data-run-state="completed"] .result-view {
      display: block;
    }

    .activity-feed {
      display: grid;
      gap: 10px;
    }

    .activity-item {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      padding: 12px;
      display: grid;
      gap: 5px;
    }

    .activity-title {
      font-weight: 750;
    }

    .prompt-dock {
      margin: 0 36px 14px;
      border: 1px solid #c9d3cf;
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 12px 26px rgba(18, 31, 25, 0.08);
      padding: 12px;
      display: grid;
      gap: 8px;
    }

    .prompt-dock textarea {
      min-height: 58px;
      border: 0;
      padding: 4px;
      resize: vertical;
    }

    .prompt-dock textarea:focus {
      outline: 0;
    }

    .prompt-controls,
    .actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
    }

    .prompt-controls {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      justify-content: space-between;
      border-top: 1px solid var(--line-soft);
      padding-top: 8px;
    }

    .control-group {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: nowrap;
      min-width: 0;
    }

    .workspace-hint {
      flex: 0 0 auto;
    }

    .toolbar-field {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      white-space: nowrap;
    }

    .compact-select {
      width: min(178px, 100%);
      min-width: 0;
      max-width: 178px;
      height: 34px;
      padding: 6px 28px 6px 9px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    #todoList {
      display: grid;
      gap: 0;
      list-style: none;
      margin: 0;
      padding: 4px;
      border: 1px solid var(--line-soft);
      border-radius: 8px;
      background: #fff;
    }

    #todoList li {
      border: 0;
      border-top: 1px solid var(--line-soft);
      border-radius: 0;
      background: transparent;
      color: var(--muted);
      padding: 9px 10px;
      line-height: 1.42;
    }

    #todoList li:first-child {
      border-top: 0;
      color: var(--text);
      font-weight: 750;
    }

    .inspector {
      display: grid;
      align-content: start;
      gap: 0;
      height: 100vh;
      overflow: auto;
      border-left: 1px solid var(--line);
      background: var(--panel);
    }

    .inspector-section {
      padding: 14px 18px;
      border-bottom: 1px solid var(--line);
    }

    .inspector-section h2 {
      margin-bottom: 10px;
      font-size: 14px;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }

    .inspector .summary-grid {
      grid-template-columns: 1fr;
      gap: 0;
      overflow: hidden;
      border: 1px solid var(--line-soft);
      border-radius: 8px;
      background: #fff;
    }

    .metric {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 9px 10px;
      background: #fff;
      min-height: 56px;
    }

    .metric .label {
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 4px;
    }

    .metric .value {
      font-size: 15px;
      font-weight: 750;
      overflow-wrap: anywhere;
    }

    .inspector .metric {
      display: grid;
      grid-template-columns: 76px minmax(0, 1fr);
      gap: 8px;
      align-items: baseline;
      min-height: 0;
      border: 0;
      border-top: 1px solid var(--line-soft);
      border-radius: 0;
      background: transparent;
      padding: 9px 10px;
    }

    .inspector .metric:first-child {
      border-top: 0;
    }

    .inspector .metric .label {
      margin: 0;
      line-height: 1.35;
    }

    .inspector .metric .value {
      font-size: 14px;
      line-height: 1.36;
    }

    .settings-dock {
      margin: 0 22px 18px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      padding: 12px 14px;
      overflow: auto;
    }

    .settings-dock[open] {
      max-height: min(62vh, 680px);
    }

    .bottom-status {
      display: flex;
      justify-content: flex-end;
      gap: 14px;
      align-items: center;
      min-height: 34px;
      padding: 0 22px 10px;
      color: var(--muted);
      font-size: 12px;
    }

    .bottom-status span {
      border-left: 1px solid var(--line);
      padding-left: 14px;
    }

    .bottom-status span:first-child {
      border-left: 0;
      color: var(--accent-strong);
      font-weight: 750;
    }

    .details-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
      margin-top: 14px;
    }

    .section {
      background: var(--canvas);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
    }

    .fields {
      display: grid;
      gap: 12px;
    }

    .row,
    .split {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .timeline {
      display: grid;
      gap: 10px;
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .timeline-item {
      display: grid;
      grid-template-columns: 96px minmax(0, 1fr);
      gap: 10px;
      align-items: start;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      background: #fff;
    }

    .stage-state {
      border-radius: 999px;
      padding: 3px 8px;
      text-align: center;
      font-size: 12px;
      font-weight: 700;
      color: var(--muted);
      background: var(--line-soft);
    }

    .stage-state.done { color: var(--ok); background: #ecfdf3; }
    .stage-state.active { color: var(--info); background: #eff6ff; }
    .stage-state.waiting { color: var(--warn); background: #fffbeb; }
    .stage-state.failed { color: var(--danger); background: #fff5f5; }
    .stage-state.skipped { color: var(--muted); background: #f8fafc; }

    .stage-title,
    .note-agent {
      font-weight: 750;
      overflow-wrap: anywhere;
    }

    .rootlet-grid,
    .transcript-grid,
    .model-output-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .rootlet-card,
    .work-note,
    .model-output-card {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      padding: 10px;
      min-height: 126px;
      display: grid;
      gap: 7px;
    }

    .note-header {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: start;
    }

    .note-status {
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }

    .visible-output-items {
      display: grid;
      gap: 8px;
    }

    .visible-output-item {
      display: grid;
      gap: 4px;
      border-top: 1px solid var(--line-soft);
      padding-top: 6px;
    }

    .visible-output-field {
      display: grid;
      grid-template-columns: 128px minmax(0, 1fr);
      gap: 8px;
      font-size: 12px;
    }

    .visible-output-field span:first-child {
      color: var(--muted);
      font-weight: 650;
      overflow-wrap: anywhere;
    }

    .visible-output-field span:last-child {
      overflow-wrap: anywhere;
    }

    .truncated-mark {
      color: var(--warn);
      font-weight: 700;
    }

    .kv {
      display: grid;
      gap: 4px;
      color: var(--muted);
      font-size: 12px;
    }

    .kv div {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      border-top: 1px solid var(--line-soft);
      padding-top: 4px;
    }

    .kv span:last-child {
      color: var(--text);
      font-weight: 650;
      text-align: right;
      overflow-wrap: anywhere;
    }

    ul {
      margin: 0;
      padding-left: 18px;
    }

    li {
      margin: 4px 0;
      overflow-wrap: anywhere;
    }

    .text-block {
      display: grid;
      gap: 6px;
      color: var(--text);
    }

    .text-block div {
      overflow-wrap: anywhere;
    }

    details summary {
      cursor: pointer;
      font-weight: 750;
    }

    pre {
      margin: 12px 0 0;
      max-height: 340px;
      overflow: auto;
      border-radius: 6px;
      padding: 12px;
      background: var(--code);
      color: #f8fafc;
      font-size: 12px;
      white-space: pre-wrap;
    }

    .empty {
      color: var(--muted);
      padding: 12px;
      border: 1px dashed var(--line);
      border-radius: 6px;
      background: #fff;
    }

    .error-text {
      color: var(--danger);
    }

    @media (max-width: 1180px) {
      .app-shell {
        grid-template-columns: 220px minmax(0, 1fr) 296px;
      }

      .canvas-scroll {
        padding: 20px 24px;
      }

      .prompt-dock {
        margin: 0 24px 14px;
      }

      .settings-dock {
        margin: 0 24px 18px;
      }

      .capability-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 820px) {
      .app-shell,
      .details-grid,
      .row,
      .split,
      .summary-grid,
      .rootlet-grid,
      .transcript-grid,
      .model-output-grid,
      .inspector {
        grid-template-columns: 1fr;
      }

      .app-shell {
        height: auto;
        min-height: 100vh;
        overflow: visible;
      }

      .sidebar,
      .workbench,
      .inspector {
        height: auto;
        overflow: visible;
      }

      .workbench {
        order: 1;
      }

      .sidebar {
        order: 2;
      }

      .inspector {
        order: 3;
      }

      .canvas-scroll {
        padding: 28px 16px;
      }

      h1 {
        font-size: 32px;
      }

      .prompt-dock {
        margin: 0 16px 16px;
      }

      .prompt-controls {
        grid-template-columns: 1fr;
      }

      .control-group {
        flex-wrap: wrap;
      }

      .toolbar-field {
        width: 100%;
        flex-wrap: wrap;
      }

      .compact-select {
        width: 100%;
        max-width: none;
      }

      #runButton {
        justify-self: end;
      }

      .settings-dock {
        margin: 0 16px 16px;
      }

      .topbar {
        align-items: flex-start;
        flex-direction: column;
        padding: 12px 16px;
      }

      .timeline-item,
      .visible-output-field {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body data-run-state="idle">
  <div class="app-shell">
    <aside class="sidebar" aria-label="AgentArbor 工作台导航">
      <div class="brand"><span class="arbor-mark brand-mark" aria-hidden="true"></span><span>AgentArbor</span></div>
      <button class="sidebar-action" type="button">新建方向</button>
      <nav>
        <ul class="nav-list">
          <li class="nav-item"><span class="nav-glyph">土</span><span>土壤</span></li>
          <li class="nav-item active"><span class="nav-glyph">地</span><span>地下组织</span></li>
          <li class="nav-item"><span class="nav-glyph">上</span><span>地上组织</span></li>
          <li class="nav-item"><span class="nav-glyph">自</span><span>自动化</span></li>
        </ul>
      </nav>
      <section>
        <div class="sidebar-heading"><span>方向记录</span><span>+</span></div>
        <ul class="task-list">
          <li class="task-item empty-direction-card">
            <span class="empty-dot" aria-hidden="true">-</span>
            <div>
              <div>暂无方向任务</div>
              <div class="task-meta">运行后会在这里显示方向记录。</div>
            </div>
          </li>
        </ul>
      </section>
      <div class="profile">
        <span class="profile-mark" aria-hidden="true"></span>
        <div>
          <div class="profile-name">本地会话</div>
          <div class="profile-meta">本地工作区</div>
        </div>
      </div>
    </aside>

    <main class="workbench">
      <div class="topbar">
        <div class="topbar-left">
          <div class="topbar-title">地下组织工作台</div>
          <div class="topbar-kicker">本地地下组织运行面</div>
        </div>
        <div class="topbar-actions">
          <button class="topbar-action" type="button">文档</button>
          <button class="topbar-action" type="button">设置</button>
          <div id="runStatus" class="status-pill" aria-live="polite">待启动 (pending)</div>
        </div>
      </div>

      <section class="canvas-scroll" aria-label="方向工作区">
        <div class="center-stage">
          <div class="start-view">
            <div class="arbor-mark hero-mark" aria-hidden="true"></div>
            <h1>把想法长成方向</h1>
            <p class="subtitle">地下组织先理解、探索、收束，再交给地上生长</p>
            <div class="capability-grid" aria-label="地下组织能力入口">
              <article class="capability-card" tabindex="0">
                <div class="capability-icon">研</div>
                <h2>网页研究</h2>
                <p>搜索互联网信息，了解现状、案例与趋势</p>
              </article>
              <article class="capability-card" tabindex="0">
                <div class="capability-icon">码</div>
                <h2>代码理解</h2>
                <p>理解本地代码库，梳理实现与依赖脉络</p>
              </article>
              <article class="capability-card" tabindex="0">
                <div class="capability-icon">证</div>
                <h2>证据整理</h2>
                <p>整合多源证据，构建事实链与关键洞察</p>
              </article>
              <article class="capability-card" tabindex="0">
                <div class="capability-icon">交</div>
                <h2>方向交接</h2>
                <p>形成方向交接包，交给地上组织继续生长</p>
              </article>
            </div>
          </div>

          <div class="activity-view">
            <h1>地下组织正在扎根</h1>
            <p class="subtitle">目标已进入地下组织，活动流会随轮询持续刷新。</p>
            <div id="workflowTimeline" class="activity-feed"></div>
          </div>

          <div class="result-view">
            <h1>方向已收束</h1>
            <p class="subtitle">中央区域只展示方向判断与交接审查；底部详情保留运行证据。</p>
            <section class="section split">
              <div>
                <h2>方向判断</h2>
                <div id="convergenceExplanation" class="text-block"></div>
              </div>
              <div>
                <h2>方向交接摘要</h2>
                <div id="packageResult" class="text-block"></div>
              </div>
            </section>
          </div>
        </div>
      </section>

      <form id="runForm" class="prompt-dock">
        <textarea id="goalInput" required placeholder="描述你的目标，地下组织会先把问题想清楚。"></textarea>
        <div class="prompt-controls">
          <div class="control-group">
            <span class="hint workspace-hint">本地工作区</span>
            <label class="toolbar-field"><span>模型</span>
              <select id="aiModeInput" class="compact-select">
                <option value="none">无 AI</option>
                <option value="fake">Fake AI</option>
                <option value="openai-compatible">OpenAI-compatible</option>
              </select>
            </label>
          </div>
          <button id="runButton" type="submit">启动地下运行</button>
        </div>
      </form>

      <details class="settings-dock">
        <summary>设置与调试详情</summary>
        <div class="details-grid">
          <section class="section">
            <h2>模型配置</h2>
            <form id="configForm" class="fields">
              <div class="row">
                <label>模型接口地址
                  <input id="baseUrlInput" autocomplete="off">
                </label>
                <label>模型名
                  <input id="modelInput" autocomplete="off" placeholder="gpt-4.1-mini">
                </label>
              </div>
              <div class="row">
                <label>默认 AI 模式
                  <select id="defaultAiModeInput">
                    <option value="none">无 AI (none)</option>
                    <option value="fake">Fake AI (fake)</option>
                    <option value="openai-compatible">OpenAI-compatible (openai-compatible)</option>
                  </select>
                </label>
                <label>API Key
                  <input id="apiKeyInput" type="password" autocomplete="new-password" placeholder="仅写入，不回显">
                </label>
              </div>
              <div class="actions">
                <button id="configButton" type="submit">保存配置</button>
                <span id="secretState" class="hint">密钥未配置</span>
              </div>
            </form>
          </section>

          <section class="section">
            <h2>工具配置</h2>
            <form id="toolConfigForm" class="fields">
              <div class="row">
                <label>搜索工具 Provider
                  <select id="webSearchProviderInput">
                    <option value="tavily">Tavily 搜索 (tavily)</option>
                    <option value="none">不启用搜索 provider (none)</option>
                  </select>
                </label>
                <label>搜索结果数
                  <input id="tavilyMaxResultsInput" type="number" min="1" max="10" step="1">
                </label>
              </div>
              <div class="row">
                <label>Tavily API Key
                  <input id="tavilyApiKeyInput" type="password" autocomplete="new-password" placeholder="仅写入，不回显">
                </label>
                <label>信息源配置
                  <input id="informationSourcePreferenceInput" autocomplete="off" readonly>
                </label>
              </div>
              <div class="actions">
                <button id="toolConfigButton" type="submit">保存搜索工具</button>
                <span id="informationSourceState" class="hint">搜索工具未配置</span>
              </div>
            </form>
          </section>

          <section class="section">
            <h2>运行详情</h2>
            <div class="split">
              <div>
                <h3>Rootlet 详情</h3>
                <div id="rootletWorkspace" class="rootlet-grid"></div>
              </div>
              <div>
                <h3>模型输出</h3>
                <div id="modelOutputList" class="model-output-grid"></div>
              </div>
            </div>
          </section>

          <section class="section">
            <h2>模型与 Provider 指标</h2>
            <div id="configStatus" class="summary-grid"></div>
            <div id="modelTraceMetrics" class="summary-grid" style="margin-top: 10px;"></div>
          </section>

          <section class="section">
            <h2>调试视图</h2>
            <div class="split">
              <div>
                <h3>模型事件序列</h3>
                <ul id="modelEventList"></ul>
              </div>
              <div>
                <h3>模型调用引用</h3>
                <ul id="modelCallList"></ul>
              </div>
            </div>
            <h3 style="margin-top: 12px;">事件流摘要</h3>
            <ul id="eventList"></ul>
            <h3 style="margin-top: 12px;">Agent Transcript</h3>
            <div id="agentTranscript" class="transcript-grid"></div>
            <details style="margin-top: 12px;">
              <summary>Observation Snapshot</summary>
              <pre id="snapshotView">{}</pre>
            </details>
          </section>
        </div>
      </details>

      <footer class="bottom-status" aria-label="底部状态栏">
        <span id="bottomToolStatus">工具状态待检测</span>
        <span>安全模式</span>
      </footer>
    </main>

    <aside class="inspector" aria-label="右侧检查器">
      <section class="inspector-section">
        <h2>待办</h2>
        <ul id="todoList">
          <li>暂无待办</li>
          <li>需要你确认的事项会显示在这里。</li>
        </ul>
      </section>

      <section class="inspector-section">
        <h2>上下文</h2>
        <div id="contextMetrics" class="summary-grid">
          <div class="metric"><div class="label">上下文容量</div><div class="value">待计算</div></div>
          <div class="metric"><div class="label">规则</div><div class="value">AGENTS.md</div></div>
          <div class="metric"><div class="label">任务看板</div><div class="value">已连接</div></div>
          <div class="metric"><div class="label">开发指南</div><div class="value">已连接</div></div>
        </div>
      </section>

      <section class="inspector-section">
        <h2>运行状态</h2>
        <div id="overviewMetrics" class="summary-grid"></div>
      </section>
    </aside>
  </div>

  <script>
    const ROOTLET_KINDS = ["option", "risk", "asset_fit", "evidence", "constraint", "counterfactual"];
    const WORKFLOW_STAGES = [
      { id: "goal", title: "理解目标", events: ["goal.received"], detail: "接收用户目标并生成地下运行上下文。" },
      { id: "planning", title: "规划探索", events: ["underground.exploration_planned"], detail: "地下组织判断需要哪些探索根须。" },
      { id: "rootlets", title: "根须探索", events: ["rootlet_cluster.started"], detail: "围绕选项、风险、证据、约束和反事实并行探索。" },
      { id: "model", title: "智能补充", events: ["model.requested", "model.completed", "model.failed"], detail: "仅在 fake 或 OpenAI-compatible 模式下经 IntelligenceChannel 调用。" },
      { id: "tools", title: "信息获取", events: ["tool.requested", "tool.completed", "tool.failed"], detail: "工具只通过统一 ToolCenter 执行，并只展示安全引用和摘要。" },
      { id: "candidates", title: "整理候选", events: ["exploration_candidate.produced", "candidate_pool.updated"], detail: "探索输出被包装为候选并进入唯一候选池。" },
      { id: "autonomy", title: "自治判断", events: ["autonomy_review.completed", "convergence_review.requested"], detail: "地下自治核心判断继续探索、请求收束、询问用户或停止。" },
      { id: "convergence", title: "收束方向", events: ["convergence_review.completed"], detail: "收束评审解释 accepted / merged / rejected / unknown。" },
      { id: "handoff", title: "方向交接", events: ["direction_handoff.completed", "user_approval.requested"], detail: "生成方向交接包或请求用户澄清。" }
    ];
    const STATUS_LABELS = {
      pending: "待启动 (pending)",
      running: "运行中 (running)",
      completed: "已完成 (completed)",
      failed: "失败 (failed)",
      not_started: "未开始 (not_started)",
      in_progress: "进行中 (in_progress)",
      blocked: "阻塞 (blocked)",
      skipped: "跳过 (skipped)",
      requested: "已请求 (requested)",
      disabled: "已禁用 (disabled)",
      configuration_failed: "配置失败 (configuration_failed)"
    };
    const PHASE_LABELS = {
      not_started: "未开始",
      underground: "地下中枢",
      handoff: "方向交接",
      aboveground: "地上中枢",
      verification: "验证",
      fruits: "果实",
      governance: "治理",
      soil_return: "土壤回流",
      completed: "完成"
    };
    const STAGE_LABELS = {
      not_started: "未开始",
      goal_received: "目标已接收",
      underground_exploration_planned: "地下探索已规划",
      rootlet_clusters_started: "Rootlet 集群已启动",
      exploration_candidates_produced: "探索候选已产出",
      candidate_pool_updated: "候选池已更新",
      model_requested: "模型请求已发出",
      model_completed: "模型请求已完成",
      model_failed: "模型请求失败",
      tool_requested: "工具调用已发出",
      tool_completed: "工具调用已完成",
      tool_failed: "工具调用失败",
      autonomy_review_completed: "自治评审已完成",
      convergence_review_requested: "收束评审已请求",
      convergence_review_completed: "收束评审已完成",
      direction_handoff_completed: "方向交接已完成",
      user_approval_requested: "等待用户确认",
      user_approval_received: "用户确认已收到"
    };
    const EVENT_LABELS = {
      "goal.received": "目标已接收",
      "underground.exploration_planned": "地下探索已规划",
      "rootlet_cluster.started": "Rootlet 集群已启动",
      "exploration_candidate.produced": "探索候选已产出",
      "candidate_pool.updated": "候选池已更新",
      "model.requested": "模型请求已发出",
      "model.completed": "模型请求已完成",
      "model.failed": "模型请求失败",
      "tool.requested": "工具调用已发出",
      "tool.completed": "工具调用已完成",
      "tool.failed": "工具调用失败",
      "autonomy_review.completed": "自治评审已完成",
      "convergence_review.requested": "收束评审已请求",
      "convergence_review.completed": "收束评审已完成",
      "direction_handoff.completed": "方向交接已完成",
      "user_approval.requested": "请求用户澄清",
      "user_approval.received": "用户澄清已接收",
      "direction_handoff.revision_requested": "方向交接请求修订"
    };
    const ROOTLET_LABELS = {
      option: "选项",
      risk: "风险",
      asset_fit: "资产适配",
      evidence: "证据",
      constraint: "约束",
      counterfactual: "反事实"
    };
    const PROVIDER_STATUS_LABELS = {
      network_disabled: "默认不联网",
      fake_provider: "Fake provider 就绪",
      ready: "OpenAI-compatible 配置完整",
      missing_model: "缺少模型名",
      missing_secret: "缺少 API key",
      missing_model_and_secret: "缺少模型名和 API key"
    };
    const WEB_SEARCH_STATUS_LABELS = {
      ready: "Tavily 已配置",
      "no-provider": "Tavily 未配置",
      disabled: "搜索 provider 已禁用"
    };
    const CONVERGENCE_LABELS = {
      approved: "已批准 (approved)",
      awaiting_user: "等待用户澄清 (awaiting_user)",
      stopped: "已停止 (stopped)"
    };
    const PACKAGE_STATUS_LABELS = {
      approved: "已批准 (approved)",
      awaiting_user: "等待用户 (awaiting_user)",
      stopped: "已停止 (stopped)"
    };
    const STAGE_STATE_LABELS = {
      done: "已完成",
      active: "正在执行",
      waiting: "等待",
      failed: "失败",
      skipped: "跳过"
    };

    const state = { config: undefined, informationAccess: undefined, tools: undefined, lastRun: undefined, pollToken: 0 };

    const runStatus = document.getElementById("runStatus");
    const goalInput = document.getElementById("goalInput");
    const aiModeInput = document.getElementById("aiModeInput");
    const baseUrlInput = document.getElementById("baseUrlInput");
    const modelInput = document.getElementById("modelInput");
    const defaultAiModeInput = document.getElementById("defaultAiModeInput");
    const apiKeyInput = document.getElementById("apiKeyInput");
    const secretState = document.getElementById("secretState");
    const webSearchProviderInput = document.getElementById("webSearchProviderInput");
    const tavilyApiKeyInput = document.getElementById("tavilyApiKeyInput");
    const tavilyMaxResultsInput = document.getElementById("tavilyMaxResultsInput");
    const informationSourcePreferenceInput = document.getElementById("informationSourcePreferenceInput");
    const informationSourceState = document.getElementById("informationSourceState");
    const runButton = document.getElementById("runButton");
    const configButton = document.getElementById("configButton");
    const toolConfigButton = document.getElementById("toolConfigButton");
    const todoList = document.getElementById("todoList");
    const bottomToolStatus = document.getElementById("bottomToolStatus");

    document.getElementById("runForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      await runUnderground();
    });

    document.getElementById("configForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      await saveConfig();
    });

    document.getElementById("toolConfigForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      await saveToolConfig();
    });

    loadConfig().catch((error) => showError(error));

    async function loadConfig() {
      const response = await requestJson("/api/config");
      const toolsResponse = await requestJson("/api/config/tools");
      state.config = response.config;
      state.informationAccess = response.informationAccess;
      state.tools = toolsResponse.tools;
      renderConfig(response.config);
      renderInformationAccess(toolsResponse.informationAccess || response.informationAccess, toolsResponse.tools);
      renderProviderStatus(response.config, undefined, response.informationAccess);
      renderIdleWorkbench(response.config);
    }

    async function saveConfig() {
      setButtons(false);
      try {
        const response = await requestJson("/api/config/model-provider", {
          method: "POST",
          body: {
            baseUrl: baseUrlInput.value,
            model: modelInput.value,
            defaultAiMode: defaultAiModeInput.value,
            apiKey: apiKeyInput.value
          }
        });
        apiKeyInput.value = "";
        state.config = response.config;
        state.informationAccess = response.informationAccess || state.informationAccess;
        renderConfig(response.config);
        renderProviderStatus(response.config, undefined, state.informationAccess);
        if (!state.lastRun) {
          renderIdleWorkbench(response.config);
        }
      } catch (error) {
        showError(error);
      } finally {
        setButtons(true);
      }
    }

    async function saveToolConfig() {
      setButtons(false);
      try {
        const response = await requestJson("/api/config/tools/web-search", {
          method: "POST",
          body: {
            provider: webSearchProviderInput.value,
            apiKey: tavilyApiKeyInput.value,
            maxResults: Number(tavilyMaxResultsInput.value || "5")
          }
        });
        tavilyApiKeyInput.value = "";
        state.tools = response.tools;
        state.informationAccess = response.informationAccess || state.informationAccess;
        renderInformationAccess(state.informationAccess, response.tools);
        renderProviderStatus(getCurrentConfig(), undefined, state.informationAccess);
      } catch (error) {
        showError(error);
      } finally {
        setButtons(true);
      }
    }

    async function runUnderground() {
      const goal = goalInput.value;
      const aiMode = aiModeInput.value;
      const config = getCurrentConfig();
      const pollToken = state.pollToken + 1;
      state.pollToken = pollToken;
      setButtons(false);
      setStatus("running");
      renderRunningSkeleton({ goal, aiMode, config });
      try {
        const response = await requestJson("/api/underground/runs", {
          method: "POST",
          body: {
            goal,
            aiMode
          }
        });
        state.lastRun = response;
        state.config = response.config;
        setStatus(response.status);
        renderRun(response);
        if (!isTerminalRun(response)) {
          await pollRunUntilDone(response.runId, pollToken);
        }
      } catch (error) {
        setStatus("failed");
        showError(error);
      } finally {
        setButtons(true);
      }
    }

    async function pollRunUntilDone(runId, pollToken) {
      while (state.pollToken === pollToken) {
        await delay(1500);
        const response = await requestJson("/api/underground/runs/" + encodeURIComponent(runId));
        state.lastRun = response;
        state.config = response.config;
        setStatus(response.status);
        renderRun(response);
        if (isTerminalRun(response)) {
          return;
        }
      }
    }

    function isTerminalRun(response) {
      return response.status === "completed" || response.status === "failed";
    }

    function delay(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function requestJson(path, options = {}) {
      const response = await fetch(path, {
        method: options.method || "GET",
        headers: { "content-type": "application/json" },
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) {
        const error = new Error(data.error?.message || "面板请求失败。");
        error.details = data;
        throw error;
      }
      return data;
    }

    function renderConfig(config) {
      baseUrlInput.value = config.baseUrl || "";
      modelInput.value = config.model || "";
      defaultAiModeInput.value = config.defaultAiMode || "none";
      aiModeInput.value = config.defaultAiMode || "none";
      secretState.textContent = config.secretConfigured ? "密钥已配置" : "密钥未配置";
    }

    function renderInformationAccess(informationAccess, tools) {
      if (!informationAccess) {
        tavilyMaxResultsInput.value = "5";
        informationSourcePreferenceInput.value = "";
        informationSourceState.textContent = "搜索工具未配置";
        bottomToolStatus.textContent = "工具状态待检测";
        return;
      }
      const webSearch = tools?.webSearch || informationAccess.web;
      webSearchProviderInput.value = webSearch?.provider || "tavily";
      tavilyMaxResultsInput.value = String(webSearch?.maxResults || 5);
      tavilyApiKeyInput.placeholder = webSearch?.secretConfigured ? "已配置，留空保持不变" : "仅写入，不回显";
      informationSourcePreferenceInput.value = (informationAccess.sourcePreference || []).join(", ");
      const statusLabel = WEB_SEARCH_STATUS_LABELS[webSearch?.status] || (webSearch?.secretConfigured ? "Tavily 已配置" : "Tavily 未配置");
      informationSourceState.textContent = statusLabel;
      bottomToolStatus.textContent = webSearch?.status === "ready"
        ? "搜索工具就绪"
        : webSearch?.status === "disabled"
          ? "搜索工具已禁用"
          : "搜索工具未配置";
    }

    function renderProviderStatus(config, provider, informationAccess) {
      const providerStatus = provider?.status || inferProviderStatus(config, config.defaultAiMode || "none");
      const sources = informationAccess || state.informationAccess;
      renderMetricsInto("configStatus", [
        ["默认模式", formatAiMode(config.defaultAiMode || "none")],
        ["Provider", PROVIDER_STATUS_LABELS[providerStatus] || providerStatus],
        ["模型", config.model || "未配置"],
        ["接口地址", config.baseUrl || "未配置"],
        ["密钥", config.secretConfigured ? "已配置" : "未配置"],
        ["协议", config.protocolKind || "未配置"],
        ["搜索工具", WEB_SEARCH_STATUS_LABELS[sources?.web?.status] || (sources?.web?.secretConfigured ? "Tavily 已配置" : "Tavily 未配置")],
        ["信息源", (sources?.sourcePreference || []).join(" / ") || "未配置"]
      ]);
    }

    function renderIdleWorkbench(config) {
      setWorkbenchState("idle");
      renderTodoList([
        "暂无待办",
        "需要你确认的事项会显示在这里。"
      ]);
      renderMetricsInto("overviewMetrics", [
        ["运行状态", "准备扎根"],
        ["当前阶段", "未开始 (not_started)"],
        ["等待点", "等待目标输入"]
      ]);
      renderWorkflowTimeline(createIdleTimeline());
      renderRootletCards(createIdleRootlets());
      renderModelTraceIdle(config);
      renderModelVisibleOutputIdle();
      renderTranscript({ workNotes: [], modelCalls: [] });
      renderTextBlock("convergenceExplanation", ["暂无运行。启动后会解释 accepted / merged / rejected / unknown 的收束含义。"]);
      renderTextBlock("packageResult", ["暂无方向包。地下运行完成后展示版本、状态、校验和 Aboveground not_started 边界。"]);
      renderList("eventList", []);
      document.getElementById("snapshotView").textContent = "{}";
    }

    function renderRunningSkeleton(input) {
      const providerStatus = inferProviderStatus(input.config, input.aiMode);
      setWorkbenchState("running");
      renderTodoList([
        "目标已提交，等待地下组织返回第一批事件。",
        "当前待办：观察目标是否需要补充边界。",
        input.aiMode === "none" ? "本次不会访问模型 provider。" : "模型与工具只展示脱敏状态和安全引用。"
      ]);
      renderProviderStatus(input.config, { status: providerStatus }, state.informationAccess);
      renderMetricsInto("overviewMetrics", [
        ["运行状态", "正在扎根 (running)"],
        ["当前阶段", "请求已发出"],
        ["目标", compactText(input.goal, 72)],
        ["等待点", "等待后台 job 返回"]
      ]);
      renderWorkflowTimeline(createRunningTimeline(input.aiMode));
      renderRootletCards(createRunningRootlets(input.aiMode));
      renderModelTraceRunning(input);
      renderModelVisibleOutputRunning(input.aiMode);
      renderTranscript({ workNotes: [], modelCalls: [] });
      renderTextBlock("convergenceExplanation", [
        "正在等待候选池与收束评审返回。",
        "完成后会按 accepted / merged / rejected / unknown 解释每类候选处置。"
      ]);
      renderTextBlock("packageResult", [
        "正在等待方向交接包结果。",
        "完成后会展示 package 状态、版本、校验、错误 / 警告和 Aboveground not_started。"
      ]);
      renderList("eventList", ["正在创建后台运行 job；事件游标会在轮询返回后刷新。"]);
      document.getElementById("snapshotView").textContent = JSON.stringify({ status: "running", mode: input.aiMode }, null, 2);
    }

    function renderRun(response) {
      const tracking = response.tracking;
      state.informationAccess = response.informationAccess || state.informationAccess;
      setWorkbenchState(response.status);
      renderRunTodos(response);
      renderInformationAccess(state.informationAccess);
      renderProviderStatus(response.config, tracking.provider, tracking.informationSources || state.informationAccess);
      renderMetricsInto("overviewMetrics", [
        ["运行状态", formatStatus(tracking.run.status)],
        ["当前相位", labelWithId(PHASE_LABELS, tracking.run.phase)],
        ["当前阶段", labelWithId(STAGE_LABELS, tracking.run.stage)],
        ["等待点", tracking.run.waitingPoint],
        ["方向包状态", tracking.package?.status || "尚未生成"],
        ["用户确认", tracking.convergence?.userEscalationRequired ? "需要确认" : "暂无阻塞"]
      ]);
      renderWorkflowTimeline(createTimeline(response));
      renderRootletWorkspace(tracking);
      renderModelTrace(response);
      renderModelVisibleOutputs(response.transcript?.modelCalls || []);
      renderTranscript(response.transcript);
      renderConvergenceExplanation(tracking);
      if (tracking.package && response.summary && response.observation) {
        renderPackageResult(response);
      } else {
        renderTextBlock("packageResult", [
          response.error ? "未生成方向包：" + response.error.message : "方向包尚未生成。",
          "当前等待点：" + tracking.run.waitingPoint
        ]);
      }
      renderEventList(getRunEvents(response));
      document.getElementById("snapshotView").textContent = JSON.stringify(response.observation || response.trace || {}, null, 2);
    }

    function renderTodoList(items) {
      todoList.replaceChildren(...items.map((item) => {
        const node = document.createElement("li");
        node.textContent = item;
        return node;
      }));
    }

    function renderRunTodos(response) {
      const tracking = response.tracking;
      if (response.status === "running") {
        renderTodoList([
          "地下组织正在推进：" + labelWithId(STAGE_LABELS, tracking.run.stage),
          "当前等待点：" + tracking.run.waitingPoint,
          tracking.convergence?.userEscalationRequired ? "可能需要你补充方向边界。" : "暂无阻塞待办。"
        ]);
        return;
      }
      if (tracking.convergence?.userEscalationRequired || tracking.package?.status === "awaiting_user") {
        renderTodoList([
          "需要你确认方向边界或开放问题。",
          "审查收束解释中的 unknown 项。",
          "确认后再生成新的方向交接版本。"
        ]);
        return;
      }
      if (response.status === "completed") {
        renderTodoList([
          "审查方向判断是否符合目标。",
          "确认方向交接摘要可交给地上组织。",
          "必要时展开设置与调试详情查看证据。"
        ]);
        return;
      }
      renderTodoList([
        "运行失败，需要检查错误摘要。",
        "确认模型 / 工具配置是否完整。",
        "修正后重新启动地下运行。"
      ]);
    }

    function renderWorkflowTimeline(stages) {
      const host = document.getElementById("workflowTimeline");
      host.replaceChildren(...stages.map((stage) => {
        const item = document.createElement("div");
        item.className = "activity-item";
        const status = document.createElement("div");
        status.className = "stage-state " + stage.state;
        status.textContent = STAGE_STATE_LABELS[stage.state] || stage.state;
        const body = document.createElement("div");
        const title = document.createElement("div");
        title.className = "activity-title";
        title.textContent = stage.title;
        const detail = document.createElement("div");
        detail.className = "stage-detail";
        detail.textContent = stage.detail;
        body.append(title, detail);
        item.append(status, body);
        return item;
      }));
    }

    function createIdleTimeline() {
      return WORKFLOW_STAGES.map((stage) => ({
        title: stage.title,
        state: "waiting",
        detail: stage.detail
      }));
    }

    function createRunningTimeline(aiMode) {
      return WORKFLOW_STAGES.map((stage) => {
        if (stage.id === "goal") {
          return { title: stage.title, state: "active", detail: "目标已提交到本地 panel server，等待后台 job 返回事件游标。" };
        }
        if (stage.id === "model" && aiMode === "none") {
          return { title: stage.title, state: "skipped", detail: "当前 AI 模式为 none，本次不会触发 provider 或模型事件。" };
        }
        if (stage.id === "model") {
          return { title: stage.title, state: "active", detail: "正在等待服务返回；provider 只会通过 IntelligenceChannel 调用。" };
        }
        return { title: stage.title, state: "waiting", detail: "等待轮询返回后刷新事件和 transcript。" };
      });
    }

    function createTimeline(response) {
      if (response.status === "completed" && response.summary && response.observation) {
        return createCompletedTimeline(response);
      }
      const events = getRunEvents(response);
      const eventTypes = new Set(events.map((event) => event.type));
      const lastEventType = response.trace?.eventCursor?.lastEventType;
      const aiMode = response.tracking?.provider?.requestedMode || aiModeInput.value;
      return WORKFLOW_STAGES.map((stage) => {
        if (stage.id === "model" && aiMode === "none") {
          return { title: stage.title, state: "skipped", detail: "当前 AI 模式为 none，本次不会触发 provider 或模型事件。" };
        }
        const hasStageEvent = stage.events.some((eventType) => eventTypes.has(eventType));
        if (response.status === "failed" && hasStageEvent && stage.events.includes(lastEventType)) {
          return { title: stage.title, state: "failed", detail: response.error?.message || "运行失败。" };
        }
        if (hasStageEvent && response.status === "running" && stage.events.includes(lastEventType)) {
          return { title: stage.title, state: "active", detail: response.tracking.run.waitingPoint };
        }
        if (hasStageEvent) {
          return { title: stage.title, state: "done", detail: stage.detail };
        }
        return { title: stage.title, state: "waiting", detail: stage.detail };
      });
    }

    function createCompletedTimeline(response) {
      const eventTypes = new Set(response.observation.events.map((event) => event.type));
      const aiMode = response.summary.ai.mode;
      return WORKFLOW_STAGES.map((stage) => {
        if (stage.id === "model" && aiMode === "none") {
          return { title: stage.title, state: "skipped", detail: "本次无 AI 模式，未触发模型调用。" };
        }
        if (stage.id === "tools" && response.summary.tools.eventCounts.requested === 0) {
          return { title: stage.title, state: "skipped", detail: "本次未触发工具调用。" };
        }
        const hasStageEvent = stage.events.some((eventType) => eventTypes.has(eventType));
        if (!hasStageEvent) {
          return { title: stage.title, state: "waiting", detail: stage.detail };
        }
        if (stage.id === "model" && response.summary.ai.eventCounts.failed > 0) {
          return {
            title: stage.title,
            state: "failed",
            detail: "模型事件 requested/completed/failed = " + response.summary.ai.eventCounts.requested + "/" + response.summary.ai.eventCounts.completed + "/" + response.summary.ai.eventCounts.failed
          };
        }
        return {
          title: stage.title,
          state: "done",
          detail: completedStageDetail(stage.id, response)
        };
      });
    }

    function completedStageDetail(stageId, response) {
      if (stageId === "goal") {
        return "目标已进入 EventLog，事件游标 " + response.observation.eventCursor.eventCount + "。";
      }
      if (stageId === "planning") {
        return "已规划 rootlet kind：" + response.summary.underground.rootletKinds.join(" / ") + "。";
      }
      if (stageId === "rootlets") {
        return "根须详情已展示每种 kind 的启动、调用、候选和 AI / 回退状态。";
      }
      if (stageId === "model") {
        return "模型事件 requested/completed/failed = " + response.summary.ai.eventCounts.requested + "/" + response.summary.ai.eventCounts.completed + "/" + response.summary.ai.eventCounts.failed + "。";
      }
      if (stageId === "tools") {
        return "工具事件 requested/completed/failed = " + response.summary.tools.eventCounts.requested + "/" + response.summary.tools.eventCounts.completed + "/" + response.summary.tools.eventCounts.failed + "。";
      }
      if (stageId === "candidates") {
        return "候选池总数 " + response.tracking.candidates.total.total + "，并按 rootlet kind 分组展示。";
      }
      if (stageId === "autonomy") {
        const autonomy = response.tracking.autonomy;
        return "自治动作：" + (autonomy.latestAction || "未产生") + "；cycles " + autonomy.cycleCount + "；spawned rootlets " + autonomy.spawnedRootletCount + "。";
      }
      if (stageId === "convergence") {
        return "收束结果：" + convergenceLabel(response.tracking.convergence.outcome) + "。";
      }
      return "方向包 " + response.summary.directionPackage.id + " v" + response.summary.directionPackage.version + "，状态 " + packageStatusLabel(response.summary.directionPackage.status) + "。";
    }

    function renderRootletWorkspace(tracking) {
      renderRootletCards(ROOTLET_KINDS.map((kind) => {
        const item = tracking.rootletsByKind[kind];
        return {
          kind,
          clusterStatus: formatStatus(item.clusterStatus),
          invocationStatus: item.invocationStatus ? formatStatus(item.invocationStatus) : "未启动",
          modelStatus: formatStatus(item.model.status),
          modelCounts: item.model.requested + "/" + item.model.completed + "/" + item.model.failed,
          candidateCounts: item.candidates.total + " 总 / " + item.candidates.accepted + " 接受 / " + item.candidates.merged + " 合并 / " + item.candidates.rejected + " 拒绝 / " + item.candidates.unknown + " 未知",
          aiStatus: item.aiCandidateCount + " AI 候选 / " + item.fallbackCount + " 回退"
        };
      }));
    }

    function createIdleRootlets() {
      return ROOTLET_KINDS.map((kind) => ({
        kind,
        clusterStatus: "等待运行",
        invocationStatus: "等待运行",
        modelStatus: "未请求",
        modelCounts: "0/0/0",
        candidateCounts: "0 总",
        aiStatus: "0 AI 候选 / 0 回退"
      }));
    }

    function createRunningRootlets(aiMode) {
      return ROOTLET_KINDS.map((kind) => ({
        kind,
        clusterStatus: "等待地下运行返回",
        invocationStatus: "等待调度结果",
        modelStatus: aiMode === "none" ? "跳过" : "等待服务返回",
        modelCounts: "0/0/0",
        candidateCounts: "待刷新",
        aiStatus: aiMode === "none" ? "0 AI 候选 / 0 回退" : "等待模型事件"
      }));
    }

    function renderRootletCards(items) {
      const host = document.getElementById("rootletWorkspace");
      host.replaceChildren(...items.map((item) => {
        const card = document.createElement("div");
        card.className = "rootlet-card";
        const title = document.createElement("h3");
        title.textContent = rootletLabel(item.kind);
        const kv = document.createElement("div");
        kv.className = "kv";
        appendKv(kv, "集群", item.clusterStatus);
        appendKv(kv, "调用", item.invocationStatus);
        appendKv(kv, "模型", item.modelStatus + " · " + item.modelCounts);
        appendKv(kv, "候选", item.candidateCounts);
        appendKv(kv, "AI / 回退", item.aiStatus);
        card.append(title, kv);
        return card;
      }));
    }

    function renderModelTraceIdle(config) {
      renderMetricsInto("modelTraceMetrics", [
        ["模型状态", "未请求"],
        ["Provider", PROVIDER_STATUS_LABELS[inferProviderStatus(config, config.defaultAiMode || "none")]],
        ["模型", config.model || "未配置"],
        ["成功 / 失败", "0 / 0"],
        ["AI 候选", "0"],
        ["回退", "0"]
      ]);
      renderList("modelEventList", ["暂无模型事件。"]);
      renderList("modelCallList", ["暂无模型调用引用。"]);
    }

    function renderModelTraceRunning(input) {
      const providerStatus = inferProviderStatus(input.config, input.aiMode);
      renderMetricsInto("modelTraceMetrics", [
        ["模型状态", input.aiMode === "none" ? "本次跳过" : "等待服务返回"],
        ["Provider", PROVIDER_STATUS_LABELS[providerStatus] || providerStatus],
        ["模型", input.config.model || "未配置"],
        ["成功 / 失败", "0 / 0"],
        ["AI 候选", "待刷新"],
        ["回退", "待刷新"]
      ]);
      renderList("modelEventList", [
        input.aiMode === "none"
          ? "AI 模式 none：不会创建 provider，也不会发布 model.* 事件。"
          : "正在等待轮询返回模型事件；provider 只会通过 IntelligenceChannel 调用。"
      ]);
      renderList("modelCallList", [
        input.aiMode === "openai-compatible"
          ? "OpenAI-compatible 只读取脱敏配置状态；API key 不会被读回或展示。"
          : "等待模型调用引用。"
      ]);
    }

    function renderModelTrace(response) {
      const ai = response.summary?.ai;
      const counts = response.tracking.modelTotals;
      const modelCalls = response.transcript?.modelCalls || [];
      const modelStatus =
        ai?.status ||
        (counts.failed > 0 ? "failed" : counts.completed > 0 ? "completed" : counts.requested > 0 ? "requested" : "not_requested");
      renderMetricsInto("modelTraceMetrics", [
        ["模型状态", formatStatus(modelStatus)],
        ["Provider", PROVIDER_STATUS_LABELS[response.tracking.provider.status] || response.tracking.provider.status],
        ["模型", response.tracking.provider.model || ai?.model || "未配置"],
        ["成功 / 失败", counts.completed + " / " + counts.failed],
        ["AI 候选", String(response.tracking.aiCandidates.total)],
        ["回退", response.tracking.aiCandidates.fallbackUsed ? response.tracking.aiCandidates.fallbackTotal + "，已触发" : String(response.tracking.aiCandidates.fallbackTotal)]
      ]);

      const modelEvents = getRunEvents(response).filter((event) =>
        event.type === "model.requested" || event.type === "model.completed" || event.type === "model.failed"
      );
      renderList("modelEventList", modelEvents.length === 0
        ? ["本次无模型事件。"]
        : modelEvents.map((event) => "#" + event.sequence + " " + labelWithId(EVENT_LABELS, event.type) + formatEventRefs(event)));

      renderList("modelCallList", modelCalls.length === 0
        ? ["本次无模型调用引用。"]
        : modelCalls.map((call) => {
            const kind = call.rootletKind ? rootletLabel(call.rootletKind) : "未归属 rootlet";
            const responseId = call.responseId ? "；response " + call.responseId : "";
            const validation = call.validationStatus ? "；校验 " + call.validationStatus : "";
            return kind + "：" + formatStatus(call.status) + "；request " + call.requestId + responseId + validation + "；候选 " + call.candidateRefs.length;
          }));
    }

    function renderModelVisibleOutputIdle() {
      renderModelVisibleOutputs([]);
    }

    function renderModelVisibleOutputRunning(aiMode) {
      const host = document.getElementById("modelOutputList");
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = aiMode === "none"
        ? "AI 模式 none：本次不会产生模型输出。"
        : "等待通过 outputContract validation 的模型输出安全投影。";
      host.replaceChildren(empty);
    }

    function renderModelVisibleOutputs(modelCalls) {
      const host = document.getElementById("modelOutputList");
      const visibleCalls = modelCalls.filter((call) => call.visibleOutput);
      if (visibleCalls.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = modelCalls.length === 0
          ? "暂无模型输出。"
          : "暂无通过 outputContract validation 的模型输出；validation failed、provider failed 或 fallback 只展示状态和安全引用。";
        host.replaceChildren(empty);
        return;
      }
      host.replaceChildren(...visibleCalls.map(renderModelVisibleOutputCard));
    }

    function renderModelVisibleOutputCard(call) {
      const output = call.visibleOutput;
      const card = document.createElement("div");
      card.className = "model-output-card";
      const title = document.createElement("h3");
      title.textContent = (call.rootletKind ? rootletLabel(call.rootletKind) : "未归属 rootlet") + " · " + call.requestId;

      const meta = document.createElement("div");
      meta.className = "stage-detail";
      meta.textContent =
        "校验 " + output.validationStatus +
        "；contract " + output.contractId +
        "；output kind " + output.outputKind +
        "；source " + output.source +
        (output.truncated ? "；已截断 (truncated)" : "");

      const items = document.createElement("div");
      items.className = "visible-output-items";
      items.replaceChildren(...output.items.map((item) => renderModelVisibleOutputItem(item)));
      card.append(title, meta, items);
      return card;
    }

    function renderModelVisibleOutputItem(item) {
      const node = document.createElement("div");
      node.className = "visible-output-item";
      const label = document.createElement("div");
      label.className = "stage-detail";
      label.textContent = "输出项 " + item.itemId;
      node.append(label, ...item.fields.map((field) => renderModelVisibleOutputField(field)));
      return node;
    }

    function renderModelVisibleOutputField(field) {
      const row = document.createElement("div");
      row.className = "visible-output-field";
      const name = document.createElement("span");
      name.textContent = field.name;
      const value = document.createElement("span");
      value.textContent = field.value + (field.truncated ? " 已截断 (truncated)" : "");
      if (field.truncated) {
        value.className = "truncated-mark";
      }
      row.append(name, value);
      return row;
    }

    function renderTranscript(transcript) {
      const host = document.getElementById("agentTranscript");
      const notes = transcript?.workNotes || [];
      if (notes.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "暂无工作笔记。启动运行后会显示各 agent 的观察、动作、产出和引用。";
        host.replaceChildren(empty);
        return;
      }
      host.replaceChildren(...notes.map((note) => {
        const card = document.createElement("div");
        card.className = "work-note";
        const header = document.createElement("div");
        header.className = "note-header";
        const agent = document.createElement("div");
        agent.className = "note-agent";
        agent.textContent = note.agentLabel + " · " + note.stage;
        const status = document.createElement("div");
        status.className = "note-status";
        status.textContent = formatStatus(note.status);
        header.append(agent, status);
        const summary = document.createElement("div");
        summary.textContent = note.summary;
        const detail = document.createElement("div");
        detail.className = "stage-detail";
        detail.textContent = note.detail;
        const refs = document.createElement("div");
        refs.className = "stage-detail";
        refs.textContent =
          "事件 " + note.eventRefs.length +
          "；候选 " + note.candidateRefs.length +
          "；模型调用 " + note.modelCallRefs.length;
        card.append(header, summary, detail, refs);
        return card;
      }));
    }

    function renderConvergenceExplanation(tracking) {
      const convergence = tracking.convergence;
      if (!convergence) {
        renderTextBlock("convergenceExplanation", [
          "收束评审尚未完成。",
          "当前等待点：" + tracking.run.waitingPoint
        ]);
        return;
      }
      renderTextBlock("convergenceExplanation", [
        "收束结果：" + convergenceLabel(convergence.outcome) + "；review " + convergence.reviewId + "。",
        "accepted 接受：" + convergence.accepted + "，可直接进入方向交接候选。",
        "merged 合并：" + convergence.merged + "，作为补充方向合入主方向。",
        "rejected 拒绝：" + convergence.rejected + "，保留为 why-not / risk / decision 证据。",
        "unknown 未知：" + convergence.unknown + "，需要继续澄清或作为开放问题保留。",
        "用户澄清：" + (convergence.userEscalationRequired ? "需要用户澄清" : "不需要用户澄清"),
        "停止原因：" + (convergence.stopReason || "无")
      ]);
    }

    function renderPackageResult(response) {
      const pkg = response.summary.directionPackage;
      const validation = pkg.validation;
      renderTextBlock("packageResult", [
        "Package ID：" + pkg.id,
        "Direction ID：" + pkg.directionId,
        "版本：v" + pkg.version,
        "状态：" + packageStatusLabel(pkg.status),
        "校验：" + (validation.passed ? "通过" : "未通过") + "；错误 / 警告 " + validation.errors.length + " / " + validation.warnings.length,
        "Aboveground：" + formatStatus(response.observation.aboveground.status),
        "谱系版本：" + response.summary.versions.join(" / ")
      ]);
    }

    function renderEventList(events) {
      renderList("eventList", events.map((event) => {
        const eventLabel = labelWithId(EVENT_LABELS, event.type);
        const progress = event.progress ? "；状态 " + formatStatus(event.progress.status) : "";
        return "#" + event.sequence + " " + eventLabel + progress + formatEventRefs(event);
      }));
    }

    function getRunEvents(response) {
      return response.observation?.events || response.trace?.events || [];
    }

    function renderMetricsInto(id, items) {
      const host = document.getElementById(id);
      host.replaceChildren(...items.map(([label, value]) => {
        const node = document.createElement("div");
        node.className = "metric";
        const labelNode = document.createElement("div");
        labelNode.className = "label";
        labelNode.textContent = label;
        const valueNode = document.createElement("div");
        valueNode.className = "value";
        valueNode.textContent = value;
        node.append(labelNode, valueNode);
        return node;
      }));
    }

    function renderList(id, items) {
      const host = document.getElementById(id);
      if (items.length === 0) {
        const empty = document.createElement("li");
        empty.textContent = "暂无";
        host.replaceChildren(empty);
        return;
      }
      host.replaceChildren(...items.map((item) => {
        const node = document.createElement("li");
        node.textContent = item;
        return node;
      }));
    }

    function renderTextBlock(id, lines) {
      const host = document.getElementById(id);
      host.replaceChildren(...lines.map((line) => {
        const node = document.createElement("div");
        node.textContent = line;
        return node;
      }));
    }

    function showError(error) {
      const message = error?.message || String(error);
      const details = error?.details;
      const config = details?.config || getCurrentConfig();
      setWorkbenchState("failed");
      renderTodoList([
        "运行失败，需要检查错误摘要。",
        "确认模型 / 工具配置是否完整。",
        "修正后重新启动地下运行。"
      ]);
      if (config) {
        renderProviderStatus(config, undefined, details?.informationAccess || state.informationAccess);
      }
      renderMetricsInto("overviewMetrics", [
        ["运行状态", "失败 (failed)"],
        ["错误", message],
        ["当前阶段", "配置或运行失败"],
        ["模型调用", "0 / 0 / 0"],
        ["候选总数", "0"],
        ["方向包状态", "未生成"]
      ]);
      renderWorkflowTimeline(createFailedTimeline(message));
      renderRootletCards(createIdleRootlets());
      renderModelTraceError(details, message);
      renderModelVisibleOutputs(details?.transcript?.modelCalls || []);
      renderTranscript({ workNotes: [], modelCalls: [] });
      renderTextBlock("convergenceExplanation", ["错误：" + message]);
      renderTextBlock("packageResult", ["未生成方向包。"]);
      renderList("eventList", []);
      document.getElementById("snapshotView").textContent = JSON.stringify({ error: message }, null, 2);
    }

    function createFailedTimeline(message) {
      return WORKFLOW_STAGES.map((stage, index) => ({
        title: stage.title,
        state: index === 0 ? "failed" : "waiting",
        detail: index === 0 ? message : "运行失败后未继续推进。"
      }));
    }

    function renderModelTraceError(details, message) {
      const ai = details?.summary?.ai;
      renderMetricsInto("modelTraceMetrics", [
        ["模型状态", ai?.status ? formatStatus(ai.status) : "失败"],
        ["Provider", ai?.configurationError?.message || "不可用"],
        ["模型", ai?.model || "未配置"],
        ["成功 / 失败", "0 / 0"],
        ["AI 候选", "0"],
        ["回退", "0"]
      ]);
      renderList("modelEventList", [message]);
      renderList("modelCallList", ["配置失败或运行失败，未生成模型调用引用。"]);
    }

    function appendKv(host, label, value) {
      const row = document.createElement("div");
      const key = document.createElement("span");
      key.textContent = label;
      const val = document.createElement("span");
      val.textContent = value;
      row.append(key, val);
      host.append(row);
    }

    function setStatus(status) {
      setWorkbenchState(status);
      runStatus.textContent = formatStatus(status);
      runStatus.className = "status-pill " + status;
    }

    function setWorkbenchState(status) {
      document.body.dataset.runState =
        status === "running" || status === "completed" || status === "failed" ? status : "idle";
    }

    function setButtons(enabled) {
      runButton.disabled = !enabled;
      configButton.disabled = !enabled;
      toolConfigButton.disabled = !enabled;
    }

    function formatAiMode(mode) {
      if (mode === "none") {
        return "无 AI (none)";
      }
      if (mode === "fake") {
        return "Fake AI (fake)";
      }
      return "OpenAI-compatible (openai-compatible)";
    }

    function formatStatus(status) {
      return STATUS_LABELS[status] || status;
    }

    function labelWithId(labels, id) {
      return (labels[id] || "未识别") + " (" + id + ")";
    }

    function rootletLabel(kind) {
      return labelWithId(ROOTLET_LABELS, kind);
    }

    function convergenceLabel(outcome) {
      return CONVERGENCE_LABELS[outcome] || outcome;
    }

    function packageStatusLabel(status) {
      return PACKAGE_STATUS_LABELS[status] || status;
    }

    function formatEventRefs(event) {
      if (!Array.isArray(event.refs) || event.refs.length === 0) {
        return "";
      }
      return "；引用 " + event.refs.map((ref) => ref.kind + ":" + ref.id).join("，");
    }

    function inferProviderStatus(config, mode) {
      if (mode === "none") {
        return "network_disabled";
      }
      if (mode === "fake") {
        return "fake_provider";
      }
      const missingModel = !config.model;
      const missingSecret = !config.secretConfigured;
      if (missingModel && missingSecret) {
        return "missing_model_and_secret";
      }
      if (missingModel) {
        return "missing_model";
      }
      if (missingSecret) {
        return "missing_secret";
      }
      return "ready";
    }

    function getCurrentConfig() {
      return state.config || {
        baseUrl: "",
        model: undefined,
        defaultAiMode: "none",
        protocolKind: "openai_compatible_chat_completions",
        providerKind: "openai_compatible",
        secretConfigured: false
      };
    }

    function compactText(value, maxLength) {
      const trimmed = String(value || "").trim();
      if (trimmed.length <= maxLength) {
        return trimmed || "未填写";
      }
      return trimmed.slice(0, maxLength - 1) + "…";
    }
  </script>
</body>
</html>`;
}
