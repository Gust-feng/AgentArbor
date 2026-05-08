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
      --bg: #f7f8fa;
      --side: #f0f3f5;
      --canvas: #ffffff;
      --panel: #f8fafc;
      --line: #dfe6ec;
      --line-soft: #edf2f6;
      --text: #111827;
      --muted: #64707d;
      --accent: #0f766e;
      --accent-strong: #0f5f59;
      --accent-soft: #e8f5f2;
      --danger: #b42318;
      --warn: #9a6700;
      --info: #2563eb;
      --shadow: 0 18px 42px rgba(15, 23, 42, 0.08);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      overflow-x: hidden;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.48 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }

    button, input, select, textarea { font: inherit; }

    button {
      min-height: 36px;
      border: 1px solid var(--accent-strong);
      border-radius: 7px;
      background: var(--accent);
      color: #fff;
      padding: 0 14px;
      cursor: pointer;
      white-space: nowrap;
      font-weight: 720;
    }

    button.secondary {
      background: #fff;
      color: var(--accent-strong);
    }

    button:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }

    input, select, textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: #fff;
      color: var(--text);
      padding: 9px 10px;
    }

    textarea {
      min-height: 86px;
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
      font-size: 26px;
      line-height: 1.16;
      letter-spacing: 0;
    }

    h2 {
      margin-bottom: 10px;
      font-size: 15px;
    }

    h3 {
      margin: 0;
      font-size: 13px;
    }

    .app {
      display: grid;
      grid-template-columns: 236px minmax(0, 1fr) 384px;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
    }

    .sidebar {
      min-width: 0;
      display: grid;
      grid-template-rows: auto auto auto minmax(0, 1fr) auto;
      gap: 18px;
      height: 100vh;
      padding: 16px;
      overflow-y: auto;
      overflow-x: hidden;
      border-right: 1px solid var(--line);
      background: var(--side);
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--accent-strong);
      font-size: 17px;
      font-weight: 800;
    }

    .mark {
      position: relative;
      display: inline-grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border: 1px solid #a9c9bb;
      border-radius: 50%;
      background: #fff;
      color: var(--accent);
      font-weight: 800;
    }

    .mark::before {
      content: "A";
      font-size: 18px;
    }

    .mark::after {
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

    .new-run {
      width: 100%;
      background: #fff;
      color: var(--accent-strong);
    }

    .nav, .runs {
      display: grid;
      gap: 7px;
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .nav li, .run-item {
      border-radius: 8px;
      padding: 9px 10px;
      color: var(--muted);
      overflow: hidden;
    }

    .nav li {
      display: grid;
      grid-template-columns: 22px minmax(0, 1fr);
      gap: 8px;
      align-items: center;
    }

    .nav li.active, .run-item.active {
      background: #e4ebe7;
      color: var(--accent-strong);
      font-weight: 760;
    }

    .glyph {
      display: inline-grid;
      place-items: center;
      width: 22px;
      height: 22px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.72);
      font-size: 12px;
      font-weight: 800;
    }

    .side-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 750;
    }

    .run-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .run-meta, .hint, .meta {
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }

    .profile {
      display: flex;
      align-items: center;
      gap: 10px;
      padding-top: 16px;
      border-top: 1px solid var(--line);
    }

    .profile .mark::before {
      content: "AA";
      font-size: 12px;
    }

    .main {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      min-width: 0;
      height: 100vh;
      background: linear-gradient(180deg, #ffffff 0%, #fbfcfd 100%);
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      min-height: 54px;
      padding: 0 20px;
      border-bottom: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.94);
    }

    .topbar-title {
      font-weight: 780;
    }

    .status-pill {
      min-width: 118px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--panel);
      color: var(--muted);
      padding: 5px 10px;
      text-align: center;
      font-size: 12px;
      white-space: nowrap;
    }

    .status-pill.running { color: var(--warn); border-color: #f8d77a; }
    .status-pill.completed { color: var(--accent-strong); border-color: #8ccab1; }
    .status-pill.failed { color: var(--danger); border-color: #ffc9c2; }

    .transcript-wrap {
      min-height: 0;
      overflow: auto;
      padding: 26px clamp(18px, 5vw, 58px);
    }

    .intro {
      display: none;
      max-width: 780px;
      margin: 0 auto 18px;
      text-align: left;
    }

    .intro .mark {
      display: none;
    }

    .intro .mark::before {
      font-size: 26px;
    }

    .intro p {
      margin: 0;
      color: var(--muted);
      font-size: 15px;
    }

    .transcript {
      display: grid;
      gap: 12px;
      max-width: 880px;
      margin: 0 auto;
    }

    .canvas-summary {
      display: grid;
      gap: 14px;
      max-width: 880px;
      margin: 0 auto 18px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #fff;
      box-shadow: 0 18px 48px rgba(15, 23, 42, 0.04);
      padding: 18px;
    }

    .canvas-summary h2 {
      margin: 0;
      font-size: 16px;
    }

    .canvas-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .canvas-item {
      border: 1px solid var(--line-soft);
      border-radius: 9px;
      background: #fbfcfd;
      padding: 11px;
      min-width: 0;
    }

    .canvas-item strong {
      display: block;
      margin-bottom: 5px;
      color: var(--accent-strong);
    }

    .canvas-item span {
      display: block;
      color: var(--muted);
      overflow-wrap: anywhere;
    }

    .empty-transcript {
      border: 1px dashed #cbd6d1;
      border-radius: 8px;
      background: #fbfcfc;
      padding: 18px;
      color: var(--muted);
      text-align: center;
    }

    .entry {
      display: grid;
      grid-template-columns: 116px minmax(0, 1fr);
      gap: 12px;
      align-items: start;
    }

    .entry-label {
      color: var(--muted);
      font-size: 12px;
      font-weight: 750;
      padding-top: 10px;
      text-align: right;
    }

    .bubble {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      padding: 12px 14px;
      box-shadow: 0 6px 20px rgba(30, 43, 36, 0.04);
    }

    .bubble.model {
      border-color: #bfd9cf;
      background: #fbfffd;
    }

    .bubble.tool {
      border-color: #cbdaf6;
      background: #fbfdff;
    }

    .bubble.final {
      border-color: #8ccab1;
      background: #f3fbf7;
    }

    .bubble.failed {
      border-color: #ffc9c2;
      background: #fff8f7;
    }

    .entry-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 5px;
      font-weight: 760;
    }

    .entry-body {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .refs {
      margin-top: 8px;
      color: var(--muted);
      font-size: 12px;
    }

    .composer {
      margin: 0 clamp(18px, 5vw, 64px) 18px;
      border: 1px solid #c9d4cf;
      border-radius: 10px;
      background: #fff;
      box-shadow: var(--shadow);
      padding: 12px;
      display: grid;
      gap: 8px;
    }

    .composer textarea {
      min-height: 70px;
      border: 0;
      padding: 4px;
    }

    .composer textarea:focus { outline: 0; }

    .soil-inputs {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 240px;
      gap: 10px;
      border-top: 1px solid var(--line-soft);
      padding-top: 8px;
    }

    .soil-inputs textarea,
    .soil-inputs input {
      border: 1px solid var(--line-soft);
      background: #fbfcfc;
    }

    .soil-inputs textarea {
      min-height: 48px;
      max-height: 110px;
      padding: 8px 9px;
      font-size: 12px;
    }

    .composer-controls {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      border-top: 1px solid var(--line-soft);
      padding-top: 8px;
    }

    .control-line {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      min-width: 0;
    }

    .compact-select {
      width: 190px;
      max-width: 100%;
      height: 34px;
      padding: 6px 28px 6px 9px;
    }

    .inspector {
      min-width: 0;
      height: 100vh;
      overflow: hidden;
      border-left: 1px solid var(--line);
      background: #f8fafc;
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr);
      align-content: start;
    }

    .panel-box {
      min-width: 0;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #fff;
      padding: 12px;
    }

    .rail-header {
      margin: 12px 12px 8px;
      display: grid;
      gap: 8px;
      background: #ffffff;
      color: var(--text);
      border-color: var(--line);
      box-shadow: 0 16px 36px rgba(15, 23, 42, 0.05);
    }

    .rail-title-row {
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 12px;
      min-width: 0;
    }

    .inspector-tabs {
      position: sticky;
      top: 0;
      z-index: 4;
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 4px;
      margin: 0 12px;
      padding: 4px;
      border-bottom: 1px solid var(--line);
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #eef3f6;
      backdrop-filter: blur(10px);
    }

    .inspector-tab {
      min-width: 0;
      min-height: 34px;
      border: 1px solid transparent;
      border-radius: 8px;
      background: transparent;
      color: var(--muted);
      padding: 0 8px;
      font-size: 12px;
      font-weight: 760;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .inspector-tab.active {
      border-color: #d6e0e7;
      background: #fff;
      color: var(--accent-strong);
      box-shadow: 0 8px 20px rgba(15, 23, 42, 0.06);
    }

    .inspector-panels {
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
    }

    .inspector-panel {
      display: none;
      gap: 10px;
      padding: 12px;
    }

    .inspector-panel.active {
      display: grid;
    }

    .rail-header h2 {
      margin: 0;
      font-size: 17px;
    }

    .rail-header p {
      margin: 0;
      color: var(--muted);
      font-size: 12px;
    }

    .section-kicker {
      color: var(--accent-strong);
      font-size: 11px;
      font-weight: 820;
      letter-spacing: 0;
      text-transform: uppercase;
    }

    .section-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 10px;
    }

    .section-title h2 {
      margin: 0;
    }

    .rail-card {
      box-shadow: 0 12px 30px rgba(15, 23, 42, 0.04);
    }

    .run-path {
      display: grid;
      gap: 7px;
    }

    .path-step {
      display: grid;
      grid-template-columns: 18px minmax(0, 1fr) auto;
      gap: 8px;
      align-items: start;
      padding: 8px 0;
      border-top: 1px solid var(--line-soft);
    }

    .path-step:first-child {
      border-top: 0;
      padding-top: 0;
    }

    .path-dot {
      display: inline-grid;
      place-items: center;
      width: 18px;
      height: 18px;
      border: 1px solid var(--line);
      border-radius: 50%;
      background: #fff;
      color: var(--muted);
      font-size: 10px;
      font-weight: 800;
    }

    .path-step.done .path-dot {
      border-color: #8ccab1;
      background: var(--accent-soft);
      color: var(--accent-strong);
    }

    .path-step.failed .path-dot {
      border-color: #ffc9c2;
      background: #fff2ef;
      color: var(--danger);
    }

    .path-main {
      min-width: 0;
      display: grid;
      gap: 2px;
    }

    .path-main strong {
      font-size: 12px;
    }

    .path-main span {
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }

    .inspector-summary {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }

    .panel-stack {
      display: grid;
      gap: 8px;
    }

    .status-line {
      min-width: 0;
      display: grid;
      gap: 4px;
      border: 1px solid var(--line-soft);
      border-radius: 9px;
      background: #fbfcfd;
      padding: 9px 10px;
      overflow-wrap: anywhere;
    }

    .status-line strong {
      color: var(--accent-strong);
    }

    .status-line.warn strong { color: var(--warn); }
    .status-line.error strong { color: var(--danger); }

    .status-line.good strong { color: var(--accent-strong); }

    .metrics {
      display: grid;
      gap: 0;
      border: 1px solid var(--line-soft);
      border-radius: 9px;
      overflow: hidden;
    }

    .metric {
      display: grid;
      grid-template-columns: 84px minmax(0, 1fr);
      gap: 8px;
      padding: 9px 10px;
      border-top: 1px solid var(--line-soft);
      font-size: 13px;
    }

    .metric:first-child { border-top: 0; }
    .metric span:first-child { color: var(--muted); }
    .metric span:last-child { font-weight: 700; overflow-wrap: anywhere; }

    .inspector .metrics {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .inspector .metric {
      display: grid;
      grid-template-columns: 1fr;
      gap: 2px;
      min-height: 52px;
      border-top: 0;
      border-left: 1px solid var(--line-soft);
      padding: 7px 8px;
    }

    .inspector .metric:nth-child(odd) {
      border-left: 0;
    }

    .inspector .metric:nth-child(n + 3) {
      border-top: 1px solid var(--line-soft);
    }

    .inspector .status-line {
      padding: 7px 8px;
    }

    .inspector .status-line strong {
      font-size: 12px;
    }

    .rail-kpis {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 8px;
    }

    .rail-kpi {
      border: 1px solid var(--line-soft);
      border-radius: 9px;
      background: #fbfcfc;
      padding: 8px;
      min-width: 0;
    }

    .rail-kpi strong {
      display: block;
      margin-bottom: 2px;
      color: var(--accent-strong);
      font-size: 16px;
    }

    .rail-kpi span {
      display: block;
      color: var(--muted);
      font-size: 11px;
      overflow-wrap: anywhere;
    }

    .call-list {
      display: grid;
      gap: 7px;
    }

    .section-note {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
    }

    .call-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      align-items: start;
      border: 1px solid var(--line-soft);
      border-radius: 9px;
      background: #fbfcfd;
      padding: 8px 9px;
      min-width: 0;
    }

    .call-row.failed {
      border-color: #ffc9c2;
      background: #fff8f7;
    }

    .call-row.completed {
      border-color: #cfe0d8;
      background: #fbfffd;
    }

    .call-title {
      font-weight: 760;
      overflow-wrap: anywhere;
    }

    .call-meta {
      margin-top: 3px;
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }

    .agent-tree {
      display: grid;
      gap: 8px;
      margin-top: 8px;
    }

    .agent-node {
      border: 1px solid var(--line-soft);
      border-radius: 9px;
      padding: 9px 10px;
      background: #fbfcfd;
    }

    .agent-node.child {
      margin-left: 12px;
      width: calc(100% - 12px) !important;
      border-left: 3px solid #9cc7b5;
    }

    .agent-node.selected {
      border-color: #8ccab1;
      background: #f3fbf7;
    }

    .node-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
      font-weight: 760;
    }

    .node-head span:first-child {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      overflow-wrap: anywhere;
    }

    .node-meta {
      margin-top: 4px;
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }

    .detail-grid {
      display: grid;
      gap: 7px;
      margin-top: 8px;
    }

    .detail-item {
      display: grid;
      grid-template-columns: 74px minmax(0, 1fr);
      gap: 8px;
      border-top: 1px solid var(--line-soft);
      padding-top: 7px;
      font-size: 12px;
    }

    .detail-item:first-child {
      border-top: 0;
      padding-top: 0;
    }

    .detail-item span:first-child {
      color: var(--muted);
    }

    .detail-item span:last-child {
      font-weight: 650;
      overflow-wrap: anywhere;
    }

    .tag {
      display: inline-flex;
      align-items: center;
      min-height: 20px;
      max-width: 100%;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent-strong);
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 780;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    details {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      padding: 10px 12px;
    }

    details summary {
      cursor: pointer;
      font-weight: 760;
    }

    .fields {
      display: grid;
      gap: 10px;
      margin-top: 12px;
    }

    .split {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .debug-list {
      display: grid;
      gap: 7px;
      padding-left: 17px;
      margin: 10px 0 0;
      color: var(--muted);
      font-size: 12px;
    }

    pre {
      max-height: 320px;
      overflow: auto;
      margin: 12px 0 0;
      border-radius: 7px;
      background: #202938;
      color: #f8fafc;
      padding: 12px;
      white-space: pre-wrap;
      font-size: 12px;
    }

    .error { color: var(--danger); }

    @media (max-width: 1080px) {
      .app {
        grid-template-columns: 216px minmax(0, 1fr);
      }

      .inspector {
        display: none;
      }
    }

    @media (max-width: 760px) {
      .app {
        display: block;
        height: auto;
        overflow: visible;
      }

      .sidebar, .main {
        height: auto;
        min-height: 0;
      }

      .sidebar {
        border-right: 0;
        border-bottom: 1px solid var(--line);
      }

      .entry {
        grid-template-columns: 1fr;
        gap: 4px;
      }

      .entry-label {
        text-align: left;
        padding-top: 0;
      }

      .composer-controls,
      .soil-inputs,
      .canvas-grid,
      .split {
        grid-template-columns: 1fr;
      }

      .compact-select {
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <div class="brand"><span class="mark" aria-hidden="true"></span><span>AgentArbor</span></div>
      <button class="new-run secondary" id="newRunButton">新建任务</button>
      <nav>
        <ul class="nav">
          <li><span class="glyph">S</span><span>土壤</span></li>
          <li class="active"><span class="glyph">U</span><span>方向智能</span></li>
          <li><span class="glyph">A</span><span>执行智能</span></li>
          <li><span class="glyph">R</span><span>自动化</span></li>
        </ul>
      </nav>
      <section>
        <div class="side-title"><span>任务记录</span><span id="runCount">0</span></div>
        <ul class="runs" id="runHistory">
          <li class="run-item">
            <div class="run-title">暂无 Desktop Shell 任务</div>
            <div class="run-meta">提交目标后会出现在这里。</div>
          </li>
        </ul>
      </section>
      <div class="profile">
        <span class="mark" aria-hidden="true"></span>
        <div>
          <div><strong>本地工作区</strong></div>
          <div class="run-meta" id="workspaceStatus">配置读取中</div>
        </div>
      </div>
    </aside>

    <main class="main">
      <header class="topbar">
        <div>
          <div class="topbar-title">Desktop Shell 工作台</div>
          <div class="hint">Main Canvas 展示 Plan / Fruit；Observation Panel 展示 agent 集群如何形成结果。</div>
        </div>
        <div class="status-pill" id="runStatus">待启动 (pending)</div>
      </header>

      <section class="transcript-wrap" id="transcriptWrap">
        <div class="intro" id="introBlock">
          <span class="mark" aria-hidden="true"></span>
          <h1>Desktop Shell 工作台</h1>
          <p>提交任务后，AgentArbor 会把目标、上下文 refs、只读短预览和权限边界形成 Task Soil，再进入真实 AI 优先的运行闭环。</p>
        </div>
        <div class="canvas-summary" id="mainCanvas">
          <h2>Plan / Fruit 主画布</h2>
          <p class="hint">当前没有运行结果。提交任务后，这里展示 Plan Package、Aboveground artifact、Fruit、Run Memory、Experience Candidate 和 Path Bias 候选。</p>
        </div>
        <div class="transcript" id="transcript">
          <div class="empty-transcript">Agent transcript 为空。输入任务后，这里会开始流式追加工作过程。</div>
        </div>
      </section>

      <section class="composer" aria-label="任务输入">
        <textarea id="goalInput" placeholder="描述你的任务。Desktop Shell 会先形成 Task Soil，再展示 Plan 和 Fruits。"></textarea>
        <div class="soil-inputs">
          <label>Task Soil context refs
            <textarea id="contextRefsInput" placeholder="可选，每行：file:src/app/panel-assets.ts | file | 只读摘要 | 短预览"></textarea>
          </label>
          <label>权限 refs
            <input id="permissionRefsInput" autocomplete="off" placeholder="read:file:src/app/panel-assets.ts">
          </label>
        </div>
        <div class="composer-controls">
          <div class="control-line">
            <span class="hint">模型</span>
            <select id="aiMode" class="compact-select">
              <option value="none">AI 禁用</option>
              <option value="openai-compatible">OpenAI-compatible 推荐</option>
              <option value="fake">Fake AI 测试模式</option>
            </select>
            <span class="hint" id="providerHint">配置读取中</span>
          </div>
          <button id="runButton">启动</button>
        </div>
      </section>
    </main>

    <aside class="inspector" aria-label="运行监督工作台">
      <section class="panel-box rail-header">
        <div class="rail-title-row">
          <div>
            <div class="section-kicker">Observation Panel</div>
            <h2>Agent 运行监督</h2>
          </div>
          <span class="tag" id="railStatusBadge">待启动</span>
        </div>
        <p>安全投影：模型调用、派生 agent、父层综合和阻断原因。</p>
      </section>

      <nav class="inspector-tabs" aria-label="运行监督分区">
        <button class="inspector-tab active" type="button" data-tab="overview">监督</button>
        <button class="inspector-tab" type="button" data-tab="ai">真实 AI</button>
        <button class="inspector-tab" type="button" data-tab="agents">Agent 树</button>
        <button class="inspector-tab" type="button" data-tab="settings">设置</button>
      </nav>

      <div class="inspector-panels">
        <section class="inspector-panel active" id="tabOverview" data-panel="overview">
          <section class="panel-box rail-card">
            <div class="section-title">
              <h2>运行路径</h2>
            </div>
            <div class="run-path" id="runPath"></div>
          </section>

          <section class="panel-box rail-card">
            <div class="section-title"><h2>运行健康</h2></div>
            <div class="metrics" id="runMetrics"></div>
            <div class="panel-stack" id="supervisionStatus"></div>
          </section>

          <section class="panel-box rail-card">
            <div class="section-title"><h2>风险 / 不确定性 / 下一步</h2></div>
            <div class="panel-stack" id="riskPanel"></div>
          </section>
        </section>

        <section class="inspector-panel" id="tabAi" data-panel="ai">
          <section class="panel-box rail-card">
            <div class="section-title"><h2>真实 AI 诊断</h2></div>
            <div class="panel-stack" id="failurePanel">
              <div class="status-line"><strong>暂无阻断</strong><span class="node-meta">真实 provider 失败、输出契约失败或配置边界会显示在这里。</span></div>
            </div>
          </section>

          <section class="panel-box rail-card">
            <div class="section-title"><h2>模型 / 工具流</h2></div>
            <div class="section-note">只显示 purpose、contract、状态、模型/工具 refs 和安全摘要；不展示 raw prompt、raw provider response 或 raw tool output。</div>
            <div class="panel-stack" id="flowList">
              <div class="status-line"><strong>等待运行</strong><span class="node-meta">模型和工具调用会以安全 refs 展示。</span></div>
            </div>
          </section>
        </section>

        <section class="inspector-panel" id="tabAgents" data-panel="agents">
          <section class="panel-box rail-card">
            <div class="section-title"><h2>Agent Run Tree / 父层综合</h2></div>
            <div class="agent-tree" id="agentTree">
              <div class="node-meta">暂无派生 agent。</div>
            </div>
          </section>
          <section class="panel-box rail-card">
            <div class="section-title"><h2>选中 Agent</h2></div>
            <div class="node-meta" id="agentInspector">运行后显示 spec、权限、预算和输出引用。</div>
          </section>
          <section class="panel-box rail-card">
            <div class="section-title"><h2>父层 synthesis</h2></div>
            <div class="status-line" id="parentSynthesis">
              <strong>父层 synthesis</strong>
              <span class="node-meta">等待 child/rootlet 安全摘要。</span>
            </div>
          </section>
        </section>

        <section class="inspector-panel" id="tabSettings" data-panel="settings">
          <details open>
            <summary>模型配置</summary>
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
              <label>API Key <input id="apiKeyInput" type="password" autocomplete="off" placeholder="保存后不会回显"></label>
              <button id="saveConfigButton" class="secondary">保存模型配置</button>
              <div class="hint" id="configStatus">模型配置未加载。</div>
            </div>
          </details>

          <details>
            <summary>工具配置</summary>
            <div class="fields">
              <label>搜索 Provider
                <select id="webSearchProviderInput">
                  <option value="tavily">Tavily</option>
                  <option value="none">无</option>
                </select>
              </label>
              <div class="split">
                <label>Tavily API Key <input id="tavilyKeyInput" type="password" autocomplete="off" placeholder="保存后不会回显"></label>
                <label>结果数 <input id="tavilyMaxResultsInput" type="number" min="1" max="10" step="1"></label>
              </div>
              <button id="saveToolConfigButton" class="secondary">保存工具配置</button>
              <div class="hint" id="toolConfigStatus">工具配置未加载。</div>
            </div>
          </details>

          <details>
            <summary>折叠调试区</summary>
            <ul class="debug-list" id="debugList">
              <li>EventLog、Observation、CandidatePool、Convergence 和 rootlet 细节默认折叠。</li>
            </ul>
            <pre id="debugJson">{}</pre>
          </details>
        </section>
      </div>
    </aside>
  </div>

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
      pending: "待启动 (pending)",
      running: "运行中 (running)",
      completed: "已完成 (completed)",
      failed: "失败 (failed)"
    };

    const EVENT_LABELS = {
      "run.started": "运行开始",
      "agent.note.delta": "工作笔记",
      "agent.note.completed": "工作笔记",
      "model.output.delta": "模型输出",
      "model.output.completed": "模型完成",
      "tool.requested": "工具请求",
      "tool.completed": "工具完成",
      "tool.failed": "工具失败",
      "agent.delegation.planned": "派生计划",
      "agent.child.started": "派生启动",
      "agent.child.completed": "派生完成",
      "agent.child.waiting": "等待派生",
      "agent.parent_synthesis.completed": "父层综合",
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
      providerHint: document.getElementById("providerHint"),
      runButton: document.getElementById("runButton"),
      newRunButton: document.getElementById("newRunButton"),
      runHistory: document.getElementById("runHistory"),
      runCount: document.getElementById("runCount"),
      workspaceStatus: document.getElementById("workspaceStatus"),
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
    dom.inspectorTabs.forEach((button) => {
      button.addEventListener("click", () => setInspectorTab(button.dataset.tab || "overview", true));
    });
    dom.aiMode.addEventListener("change", () => {
      if (state.config) {
        renderProviderStatus();
      } else {
        renderSupervision(undefined);
      }
      renderRiskPanel(undefined);
    });

    init();

    async function init() {
      setInspectorTab("overview", false);
      renderMetrics("pending", undefined);
      renderRunPath(undefined);
      renderAgentTree(undefined);
      renderSupervision(undefined);
      renderFailurePanel(undefined);
      renderFlow(undefined);
      renderRiskPanel(undefined);
      await Promise.all([loadConfig(), loadToolsConfig()]);
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
      if (response && response.tracking && response.tracking.agentRunTree && response.status === "running") {
        setInspectorTab("agents", false);
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
        appendLocalEntry("用户目标", "请先输入目标。", "failed");
        return;
      }

      stopLiveUpdates();
      state.seenSequences = new Set();
      state.lastSequence = 0;
      state.currentRunId = undefined;
      state.lastFocusedTerminalRunId = undefined;
      dom.transcript.replaceChildren();
      dom.introBlock.style.display = "none";
      appendLocalEntry("用户目标", compact(goal, 1200), "running");
      setRunStatus("running");
      state.inspectorPinned = false;
      setInspectorTab("overview", false);
      renderRunPath(undefined);
      renderMetrics("running", undefined);
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
        rememberRun(goal, response.runId);
        renderPollingResponse(response);
        openRunStream(response.runId, response.streamCursor ? response.streamCursor.lastSequence : 0);
      } catch (error) {
        appendLocalEntry("运行失败", error.message, "failed");
        setRunStatus("failed");
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
        // The stream already delivered the terminal event. Polling refresh is best-effort only.
      }
    }

    function renderPollingResponse(response) {
      autoInspectorTab(response);
      setRunStatus(response.status || "running");
      renderRunPath(response);
      renderMetrics(response.status || "running", response);
      renderCanvas(response.canvas, response.status || "running");
      renderAgentTree(response);
      renderSupervision(response);
      renderFailurePanel(response);
      renderFlow(response);
      renderRiskPanel(response);
      if (response.transcript && Array.isArray(response.transcript.events)) {
        response.transcript.events.forEach(appendStreamEvent);
      }
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
      if (!response || (response.status !== "completed" && response.status !== "failed")) {
        return;
      }
      if (state.lastFocusedTerminalRunId === response.runId) {
        return;
      }
      state.lastFocusedTerminalRunId = response.runId;
      if (dom.transcriptWrap) {
        dom.transcriptWrap.scrollTo({ top: 0, behavior: "smooth" });
      }
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

      if (event.type === "model.output.delta") {
        appendModelOutputDelta(event);
        return;
      }
      if (event.type === "model.output.completed") {
        completeModelOutput(event);
        return;
      }

      const label = event.agentLabel || EVENT_LABELS[event.type] || event.type;
      const content = event.delta || event.summary || EVENT_LABELS[event.type] || event.type;
      const status = event.status || (event.type === "run.failed" ? "failed" : event.type === "final.result" ? "completed" : "running");
      appendEntry({
        label: label,
        title: EVENT_LABELS[event.type] || event.type,
        body: content,
        status: status,
        type: event.type,
        refs: refsText(event)
      });
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
        label: event.agentLabel || "模型",
        title: "模型输出",
        body: visibleModelOutputText(chunk),
        status: event.status || "running",
        type: event.type,
        refs: refsText(event),
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
        if (event.summary) {
          const refs = existing.row.querySelector(".refs");
          if (refs) {
            refs.textContent = [refs.textContent, event.summary].filter(Boolean).join("；");
          }
        }
        return;
      }
      appendEntry({
        label: event.agentLabel || "模型",
        title: "模型完成",
        body: event.summary || "模型调用完成。",
        status: event.status || "completed",
        type: event.type,
        refs: refsText(event)
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
      if (text.length <= 680) {
        return text;
      }
      return compact(text, 680) + "\\n\\n（安全投影已截断，完整结构以 refs 和调试投影为准。）";
    }

    function updateEntryStatus(row, statusValue) {
      const bubble = row.querySelector(".bubble");
      const meta = row.querySelector(".entry-title .meta");
      if (bubble) {
        bubble.className = "bubble " + bubbleClass("model.output.delta", statusValue);
      }
      if (meta) {
        meta.textContent = STATUS_LABELS[statusValue] || statusValue || "";
      }
    }

    function appendLocalEntry(label, body, status) {
      dom.introBlock.style.display = "none";
      appendEntry({ label: label, title: label, body: body, status: status, type: "local", refs: "" });
    }

    function appendEntry(input) {
      removeEmptyTranscript();
      const row = document.createElement("div");
      row.className = "entry";
      const label = document.createElement("div");
      label.className = "entry-label";
      label.textContent = input.label;
      const bubble = document.createElement("div");
      bubble.className = "bubble " + bubbleClass(input.type, input.status);
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
      bubble.append(title, body);
      if (input.refs) {
        const refs = document.createElement("div");
        refs.className = "refs";
        refs.textContent = input.refs;
        bubble.append(refs);
      }
      row.append(label, bubble);
      dom.transcript.append(row);
      row.scrollIntoView({ block: "nearest" });
      if (input.returnParts) {
        return { row, body };
      }
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

    function refsText(event) {
      const parts = [];
      if (event.toolName) {
        parts.push("工具 " + event.toolName);
      }
      if (event.sourceRefs && event.sourceRefs.length > 0) {
        parts.push("来源 " + event.sourceRefs.slice(0, 4).join("，"));
      }
      if (event.modelCallRefs && event.modelCallRefs.length > 0) {
        parts.push("模型调用 " + event.modelCallRefs.slice(0, 3).join("，"));
      }
      if (event.toolCallRefs && event.toolCallRefs.length > 0) {
        parts.push("工具调用 " + event.toolCallRefs.slice(0, 3).join("，"));
      }
      return parts.join("；");
    }

    function renderRunPath(response) {
      const tracking = response && response.tracking;
      const canvas = response && response.canvas;
      const failed = response && response.status === "failed";
      const steps = [
        {
          label: "Task Soil",
          state: canvas && canvas.taskSoil ? "done" : tracking ? "done" : failed ? "failed" : "pending",
          detail: canvas && canvas.taskSoil
            ? "context refs " + canvas.taskSoil.contextRefs.length + "；permission refs " + canvas.taskSoil.permissionBoundaryRefs.length
            : tracking
              ? "任务输入已进入运行上下文。"
              : "等待用户任务和上下文 refs。"
        },
        {
          label: "Underground",
          state: tracking && tracking.run.phase !== "not_started" ? (failed ? "failed" : "done") : "pending",
          detail: tracking
            ? tracking.run.phase + " / " + tracking.run.stage
            : "等待方向智能启动。"
        },
        {
          label: "Plan",
          state: canvas && canvas.plan ? "done" : failed ? "failed" : "pending",
          detail: canvas && canvas.plan
            ? canvas.plan.packageRef.packageId + " v" + canvas.plan.packageRef.version + "；" + canvas.plan.status
            : failed
              ? "未形成 approved Plan。"
              : "等待父层 synthesis / convergence。"
        },
        {
          label: "Aboveground",
          state: canvas && canvas.aboveground && canvas.aboveground.artifact ? "done" : failed ? "pending" : "pending",
          detail: canvas && canvas.aboveground && canvas.aboveground.artifact
            ? canvas.aboveground.artifact.summary
            : "等待 Plan consumer。"
        },
        {
          label: "Fruits",
          state: canvas && canvas.fruits && canvas.fruits.fruit ? "done" : failed ? "pending" : "pending",
          detail: canvas && canvas.fruits && canvas.fruits.fruit
            ? canvas.fruits.fruit.summary
            : "等待可见成果和候选经验。"
        }
      ];
      dom.runPath.replaceChildren(...steps.map((step, index) => {
        const row = document.createElement("div");
        row.className = "path-step " + step.state;
        const dot = document.createElement("span");
        dot.className = "path-dot";
        dot.textContent = step.state === "done" ? "✓" : step.state === "failed" ? "!" : String(index + 1);
        const main = document.createElement("div");
        main.className = "path-main";
        const strong = document.createElement("strong");
        strong.textContent = step.label;
        const span = document.createElement("span");
        span.textContent = step.detail;
        main.append(strong, span);
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = step.state === "done" ? "完成" : step.state === "failed" ? "阻断" : "等待";
        row.append(dot, main, tag);
        return row;
      }));
    }

    function renderMetrics(status, response) {
      const tracking = response && response.tracking;
      if (dom.railStatusBadge) {
        dom.railStatusBadge.textContent = STATUS_LABELS[status] || status;
        dom.railStatusBadge.className = "tag";
      }
      const rows = [
        ["状态", STATUS_LABELS[status] || status],
        ["阶段", tracking ? tracking.run.stage : "未启动"],
        ["模型事件", tracking ? counts(tracking.modelTotals) : "0 / 0 / 0"],
        ["候选", tracking ? String(tracking.candidates.total.total) : "0"]
      ];
      dom.runMetrics.replaceChildren(...rows.map((row) => {
        const item = document.createElement("div");
        item.className = "metric";
        const key = document.createElement("span");
        key.textContent = row[0];
        const value = document.createElement("span");
        value.textContent = row[1];
        item.append(key, value);
        return item;
      }));
    }

    function renderSupervision(response) {
      const tracking = response && response.tracking;
      const provider = tracking && tracking.provider;
      const config = state.config;
      const status = provider ? provider.status : config ? providerStatusFromConfig(config, dom.aiMode.value) : "missing_model_and_secret";
      const todos = providerTodos(status, config || {});
      const rows = [
        statusLine(
          "真实 AI",
          provider
            ? modeLabel(provider.requestedMode) + "；provider " + provider.providerKind + "；model " + (provider.model || "未填写") + "；secret " + (provider.secretConfigured ? "已配置" : "未配置")
            : config
              ? modeLabel(dom.aiMode.value) + "；provider " + config.providerKind + "；model " + (config.model || "未填写") + "；secret " + (config.secretConfigured ? "已配置" : "未配置")
              : "配置读取后展示 provider、model 和 secret 状态。",
          status === "ready" ? "" : status === "fake_provider" ? "warn" : "error"
        ),
        statusLine("配置待办", todos.length === 0 ? "可以发起真实 provider 调用。" : todos.join("；"), todos.length === 0 ? "" : "warn")
      ];
      dom.supervisionStatus.replaceChildren(...rows);
    }

    function renderFlow(response) {
      const tracking = response && response.tracking;
      if (!tracking) {
        dom.flowList.replaceChildren(statusLine("模型 / 工具流", "等待运行。模型和工具调用只展示安全 refs、状态和摘要。"));
        return;
      }
      const model = counts(tracking.modelTotals);
      const tool = counts(tracking.toolTotals);
      const source = tracking.informationSources && tracking.informationSources.web
        ? "web " + tracking.informationSources.web.provider + " / " + tracking.informationSources.web.status
        : "information source pending";
      const calls = response.transcript && Array.isArray(response.transcript.modelCalls)
        ? response.transcript.modelCalls.slice(-3).reverse()
        : [];
      const list = document.createElement("div");
      list.className = "call-list";
      if (calls.length === 0) {
        list.append(statusLine("模型调用明细", "暂无模型调用。真实运行开始后会显示 purpose、contract、状态和失败原因。"));
      } else {
        calls.forEach((call) => list.append(modelCallRow(call)));
      }
      dom.flowList.replaceChildren(
        statusLine("模型调用", "请求 / 完成 / 失败 = " + model + "；provider " + tracking.provider.status, tracking.modelTotals.failed > 0 ? "error" : tracking.provider.status === "ready" || tracking.provider.status === "fake_provider" ? "" : "warn"),
        list,
        statusLine("工具调用", "请求 / 完成 / 失败 = " + tool + "；信息源 " + source, tracking.toolTotals.failed > 0 ? "warn" : ""),
        statusLine("候选池", "候选总数 " + tracking.candidates.total.total + "；AI candidates " + tracking.aiCandidates.total + "；fallback " + tracking.aiCandidates.fallbackTotal)
      );
    }

    function renderFailurePanel(response) {
      const failedCalls = response && response.transcript && Array.isArray(response.transcript.modelCalls)
        ? response.transcript.modelCalls.filter((call) => call.status === "failed")
        : [];
      const latestFailed = failedCalls[failedCalls.length - 1];
      if (!response || (!response.error && failedCalls.length === 0)) {
        dom.failurePanel.replaceChildren(
          statusLine("暂无阻断", "真实 provider 失败、输出契约失败或配置边界会显示在这里。", "good")
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
      meta.className = "call-meta";
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
      if (status === "requested") {
        return "请求中";
      }
      if (status === "completed") {
        return "完成";
      }
      if (status === "failed") {
        return "失败";
      }
      return String(status || "");
    }

    function remediationForModelFailure(call) {
      if (call.failureKind === "output_validation") {
        return "模型返回已到达，但没有通过输出契约；下一步应收紧该 agent 的 JSON 协议、增加修复/重试回合，不能把失败输出当 Plan。";
      }
      if (call.failureKind === "provider_auth") {
        return "检查 API Key、账号权限和 provider base URL。";
      }
      if (call.failureKind === "provider_rate_limit") {
        return "降低并发或稍后重试；预算边界不能绕过。";
      }
      if (call.failureKind === "provider_network" || call.failureKind === "provider_timeout") {
        return "检查网络、provider 可用性和超时设置。";
      }
      return "保留失败 refs，先定位 provider / contract / agent purpose，再决定是否重试。";
    }

    function remediationForError(error) {
      if (error.code === "missing_api_key") {
        return "保存 API Key 后重新运行；当前没有发起 provider 网络请求。";
      }
      if (error.code === "missing_model_name") {
        return "填写模型名后重新运行；当前没有发起 provider 网络请求。";
      }
      if (error.code === "ai_disabled") {
        return "切回 OpenAI-compatible；AI 禁用只用于边界检查，不会形成 approved Plan。";
      }
      return "查看模型/工具流和 Agent Run Tree，失败只展示安全摘要和 refs。";
    }

    function renderRiskPanel(response) {
      const tracking = response && response.tracking;
      const canvas = response && response.canvas;
      if (!tracking && !canvas && !(response && response.error)) {
        const configStatus = state.config ? providerStatusFromConfig(state.config, dom.aiMode.value) : "missing_model_and_secret";
        const nextStep = configStatus === "ready"
          ? "输入任务后可直接启动真实 provider 调用。"
          : configStatus === "fake_provider"
            ? "当前选择 Fake AI 测试模式；真实验证请切回 OpenAI-compatible。"
            : "补齐 openai-compatible 的模型名和 API Key，或显式选择 Fake AI 测试模式。";
        dom.riskPanel.replaceChildren(
          statusLine("下一步", nextStep, configStatus === "ready" ? "" : "warn"),
          statusLine("安全边界", "不会展示 raw prompt、raw provider response、hidden reasoning、raw tool output、secret 或未授权正文。")
        );
        return;
      }
      const uncertainty = canvas && canvas.plan && canvas.plan.uncertainty && canvas.plan.uncertainty.length > 0
        ? canvas.plan.uncertainty.slice(0, 3).join("；")
        : "未发现需要用户立即处理的不确定性。";
      const nextStep = response.error
        ? response.error.message
        : tracking && tracking.run.status === "completed"
          ? "查看 Plan、Aboveground artifact 和 Fruits；需要补充事实时后续进入 Nutrient Request。"
          : tracking
            ? tracking.run.waitingPoint
            : "等待运行结果。";
      dom.riskPanel.replaceChildren(
        statusLine("风险 / 不确定性", uncertainty, response.error ? "error" : ""),
        statusLine("下一步", nextStep, response.error ? "error" : ""),
        statusLine("安全投影", "面板只显示安全投影、refs、短摘要和配置状态。")
      );
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

    function renderCanvas(canvas, status) {
      if (!canvas) {
        dom.mainCanvas.replaceChildren();
        const title = document.createElement("h2");
        title.textContent = "Plan / Fruit 主画布";
        const hint = document.createElement("p");
        hint.className = "hint";
        hint.textContent = status === "failed"
          ? "运行未形成 approved Plan。请查看错误摘要和 Observation Panel。"
          : "Desktop Shell 正在形成 Task Soil、Plan Package、Aboveground artifact 和 Fruits。";
        dom.mainCanvas.append(title, hint);
        return;
      }
      const title = document.createElement("h2");
      title.textContent = "Plan / Fruit 主画布";
      const intro = document.createElement("p");
      intro.className = "hint";
      intro.textContent = canvas.explanation.resultWhyReasonable;
      const grid = document.createElement("div");
      grid.className = "canvas-grid";
      const contextLines = canvas.taskSoil.contextRefs.slice(0, 5).map((ref) => {
        const preview = ref.readonlyPreview ? "；preview " + compact(ref.readonlyPreview.text, 90) + (ref.readonlyPreview.truncated ? "…" : "") : "";
        return ref.kind + " " + ref.ref + (ref.summary ? "：" + ref.summary : "") + preview;
      });
      grid.append(
        canvasItem("Task Soil", [
          canvas.taskSoil.goalSummary,
          "context refs " + canvas.taskSoil.contextRefs.length,
          contextLines.join(" / "),
          "permission refs " + canvas.taskSoil.permissionBoundaryRefs.join("，")
        ].filter(Boolean).join("；")),
        canvasItem("Plan Package", canvas.plan.packageRef.packageId + " v" + canvas.plan.packageRef.version + "；status " + canvas.plan.status + "；" + canvas.plan.recommendedDirection.reason),
        canvasItem("Aboveground Execution Runtime", (canvas.aboveground.task ? canvas.aboveground.task.title : "task pending") + "；artifact " + (canvas.aboveground.artifact ? canvas.aboveground.artifact.summary : "pending") + "；verification " + (canvas.aboveground.verification.status || "pending")),
        canvasItem("Fruits", [
          canvas.fruits.fruit ? "fruit " + canvas.fruits.fruit.fruitId : "fruit pending",
          canvas.fruits.runMemory ? "run memory " + canvas.fruits.runMemory.runMemoryId : "run memory pending",
          canvas.fruits.experienceCandidate ? "experience candidate " + canvas.fruits.experienceCandidate.candidateId : "candidate pending",
          canvas.fruits.pathBias ? "path bias " + canvas.fruits.pathBias.pathBiasId : "path bias pending"
        ].join("；"))
      );
      dom.mainCanvas.replaceChildren(title, intro, grid);
    }

    function canvasItem(label, text) {
      const item = document.createElement("div");
      item.className = "canvas-item";
      const strong = document.createElement("strong");
      strong.textContent = label;
      const span = document.createElement("span");
      span.textContent = compact(text, 420);
      item.append(strong, span);
      return item;
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
        selected: true,
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
          onClick: () => renderAgentInspector(run, tree)
        }));
      });
      dom.agentTree.replaceChildren(...nodes);
      if (tree.parentSyntheses.length > 0) {
        const latest = tree.parentSyntheses[tree.parentSyntheses.length - 1];
        renderSynthesisInspector(latest);
        dom.parentSynthesis.replaceChildren(
          statusLine(
            "父层 synthesis",
            compact(latest.decisionSummary, 240) + "；material refs " + latest.retainedMaterialRefs.slice(0, 4).join("，")
          )
        );
      } else {
        renderRootInspector(tree);
        dom.parentSynthesis.replaceChildren(statusLine("父层 synthesis", "中枢已建立运行树，等待 child/rootlet 材料回收。"));
      }
    }

    function agentNode(input) {
      const node = document.createElement("button");
      node.type = "button";
      node.className = "agent-node secondary" + (input.child ? " child" : "") + (input.selected ? " selected" : "");
      node.style.textAlign = "left";
      node.style.width = "100%";
      node.addEventListener("click", input.onClick || (() => {}));
      const head = document.createElement("div");
      head.className = "node-head";
      const title = document.createElement("span");
      title.textContent = input.title;
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = agentStatusLabel(input.status);
      head.append(title, tag);
      const meta = document.createElement("div");
      meta.className = "node-meta";
      meta.textContent = input.meta || "";
      node.append(head, meta);
      return node;
    }

    function agentStatusLabel(status) {
      if (status === "completed") {
        return "完成";
      }
      if (status === "running") {
        return "运行中";
      }
      if (status === "failed") {
        return "失败";
      }
      if (status === "stopped") {
        return "停止";
      }
      if (status === "planned") {
        return "计划";
      }
      if (status === "interrupted") {
        return "打断";
      }
      if (status === "resumed") {
        return "恢复";
      }
      return String(status || "");
    }

    function renderAgentInspector(run, tree) {
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
        ["综合", tree.parentSyntheses.length + " parent syntheses；child output 不直通 Plan"]
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
      if (response.tracking) {
        items.push("phase: " + response.tracking.run.phase + " / stage: " + response.tracking.run.stage);
        items.push("model requested/completed/failed: " + counts(response.tracking.modelTotals));
        items.push("tool requested/completed/failed: " + counts(response.tracking.toolTotals));
      }
      if (response.error) {
        items.push("error: " + response.error.code);
      }
      dom.debugList.replaceChildren(...items.map((text) => {
        const li = document.createElement("li");
        li.textContent = text;
        return li;
      }));
      dom.debugJson.textContent = JSON.stringify({
        runId: response.runId,
        runKind: response.runKind,
        status: response.status,
        canvas: response.canvas,
        tracking: response.tracking,
        summary: response.summary,
        observation: response.observation,
        error: response.error
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
        ? "推荐入口已就绪：OpenAI-compatible"
        : status === "fake_provider"
          ? "当前是 Fake AI 测试模式；真实工作流建议切换 OpenAI-compatible"
          : "OpenAI-compatible 待配置：" + todos.join("；");
      dom.workspaceStatus.textContent = "配置中心已连接";
      dom.configStatus.textContent = "当前运行入口：" + modeLabel(selectedMode) + "；设置默认：" + modeLabel(config.defaultAiMode || "openai-compatible") + "；模型：" + (config.model || "未填写") + "；密钥：" + (config.secretConfigured ? "已配置" : "未配置");
      dom.configStatus.className = "hint" + (status === "missing_model" || status === "missing_secret" || status === "missing_model_and_secret" ? " error" : "");
      renderSupervision(undefined);
      renderFailurePanel(undefined);
      renderRiskPanel(undefined);
    }

    function preferredRunMode() {
      return "openai-compatible";
    }

    function providerStatusFromConfig(config, requestedMode) {
      if (requestedMode === "none") {
        return "network_disabled";
      }
      if (requestedMode === "fake") {
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

    function providerTodos(status, config) {
      if (status === "ready") {
        return [];
      }
      if (status === "fake_provider") {
        return ["Fake AI 只用于测试和 CI，不代表真实产品验证"];
      }
      if (status === "network_disabled") {
        return ["AI 禁用只用于边界检查，不能形成 approved Plan"];
      }
      const todos = [];
      if (status === "missing_model" || status === "missing_model_and_secret") {
        todos.push("填写模型名");
      }
      if (status === "missing_secret" || status === "missing_model_and_secret") {
        todos.push("保存 API Key");
      }
      if (!config.baseUrl) {
        todos.push("确认 Base URL");
      }
      return todos;
    }

    function modeLabel(mode) {
      if (mode === "openai-compatible") {
        return "OpenAI-compatible 推荐";
      }
      if (mode === "fake") {
        return "Fake AI 测试模式";
      }
      if (mode === "none") {
        return "AI 禁用";
      }
      return String(mode || "");
    }

    function renderToolStatus() {
      const webSearch = state.tools && state.tools.webSearch;
      if (!webSearch) {
        return;
      }
      dom.toolConfigStatus.textContent = "搜索 provider：" + webSearch.provider + "；状态：" + webSearch.status + "；密钥：" + (webSearch.secretConfigured ? "已配置" : "未配置");
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
        title.textContent = compact(item.goal, 34);
        const meta = document.createElement("div");
        meta.className = "run-meta";
        meta.textContent = item.runId;
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
      state.inspectorPinned = false;
      setInspectorTab("overview", false);
      dom.goalInput.value = "";
      dom.contextRefsInput.value = "";
      dom.permissionRefsInput.value = "";
      dom.introBlock.style.display = "";
      dom.transcript.replaceChildren(emptyTranscriptNode());
      renderCanvas(undefined, "pending");
      setRunStatus("pending");
      renderRunPath(undefined);
      renderMetrics("pending", undefined);
      renderAgentTree(undefined);
      renderSupervision(undefined);
      renderFailurePanel(undefined);
      renderFlow(undefined);
      renderRiskPanel(undefined);
      dom.debugJson.textContent = "{}";
    }

    function emptyTranscriptNode() {
      const node = document.createElement("div");
      node.className = "empty-transcript";
      node.textContent = "Agent transcript 为空。输入任务后，这里会开始流式追加工作过程。";
      return node;
    }

    function stopLiveUpdates() {
      if (state.eventSource) {
        state.eventSource.close();
        state.eventSource = undefined;
      }
      clearInterval(state.pollingTimer);
      state.pollingTimer = undefined;
    }

    function setRunStatus(status) {
      dom.runStatus.textContent = STATUS_LABELS[status] || status;
      dom.runStatus.className = "status-pill " + status;
    }

    function setButtons(enabled) {
      dom.runButton.disabled = !enabled;
      dom.saveConfigButton.disabled = !enabled;
      dom.saveToolConfigButton.disabled = !enabled;
    }

    async function requestJson(path, options) {
      const init = options || {};
      const response = await fetch(path, {
        method: init.method || "GET",
        headers: init.body === undefined ? undefined : { "content-type": "application/json" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body)
      });
      const text = await response.text();
      let body;
      try {
        body = text.trim().length === 0 ? {} : JSON.parse(text);
      } catch {
        throw new Error("面板返回了无效 JSON。");
      }
      if (!response.ok || body.ok === false) {
        const error = new Error(body.error && body.error.message ? body.error.message : "面板请求失败。");
        error.details = body;
        throw error;
      }
      return body;
    }

    function compact(value, maxLength) {
      const text = String(value || "").trim();
      if (text.length <= maxLength) {
        return text;
      }
      return text.slice(0, maxLength - 1) + "…";
    }
  </script>
</body>
</html>`;
}
