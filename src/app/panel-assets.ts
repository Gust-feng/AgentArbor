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
      --bg: #f4f6f5;
      --side: #edf1ef;
      --canvas: #ffffff;
      --panel: #fafbfb;
      --line: #dbe2de;
      --line-soft: #edf1ef;
      --text: #1f2723;
      --muted: #66746e;
      --accent: #13734f;
      --accent-strong: #0b5a3d;
      --accent-soft: #e7f4ed;
      --danger: #b42318;
      --warn: #9a6700;
      --info: #2563eb;
      --shadow: 0 18px 42px rgba(28, 42, 35, 0.08);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
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
      font-size: 30px;
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
      grid-template-columns: 248px minmax(0, 1fr) 318px;
      height: 100vh;
      overflow: hidden;
    }

    .sidebar {
      display: grid;
      grid-template-rows: auto auto auto minmax(0, 1fr) auto;
      gap: 18px;
      height: 100vh;
      padding: 18px;
      overflow: auto;
      border-right: 1px solid var(--line);
      background: var(--side);
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--accent-strong);
      font-size: 18px;
      font-weight: 800;
    }

    .mark {
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
      background: var(--canvas);
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      min-height: 58px;
      padding: 0 22px;
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
      padding: 34px clamp(18px, 5vw, 64px);
    }

    .intro {
      max-width: 780px;
      margin: 0 auto 22px;
      text-align: center;
    }

    .intro .mark {
      width: 52px;
      height: 52px;
      margin-bottom: 14px;
      background: var(--accent-soft);
    }

    .intro .mark::before {
      font-size: 26px;
    }

    .intro p {
      margin: 0;
      color: var(--muted);
      font-size: 16px;
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
      border: 1px solid #cfe0d8;
      border-radius: 8px;
      background: #fbfffd;
      padding: 16px;
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
      border-radius: 8px;
      background: #fff;
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
      border-radius: 8px;
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
      height: 100vh;
      overflow: auto;
      border-left: 1px solid var(--line);
      background: var(--panel);
      padding: 18px;
      display: grid;
      align-content: start;
      gap: 14px;
    }

    .panel-box {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      padding: 12px;
    }

    .metrics {
      display: grid;
      gap: 0;
      border: 1px solid var(--line-soft);
      border-radius: 8px;
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

    .agent-tree {
      display: grid;
      gap: 8px;
      margin-top: 8px;
    }

    .agent-node {
      border: 1px solid var(--line-soft);
      border-radius: 8px;
      padding: 9px 10px;
      background: #fbfcfc;
    }

    .agent-node.child {
      margin-left: 12px;
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
      font-weight: 760;
    }

    .node-meta {
      margin-top: 4px;
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }

    .tag {
      display: inline-flex;
      align-items: center;
      min-height: 20px;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent-strong);
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 780;
      white-space: nowrap;
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

      <section class="transcript-wrap">
        <div class="intro" id="introBlock">
          <span class="mark" aria-hidden="true"></span>
          <h1>Desktop Shell 工作台</h1>
          <p>提交任务后，AgentArbor 会形成 Task Soil，经 Underground Cognitive Runtime 收束 Plan，再由 Aboveground Execution Runtime 产出 Fruits。</p>
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
        <div class="composer-controls">
          <div class="control-line">
            <span class="hint">模型</span>
            <select id="aiMode" class="compact-select">
              <option value="none">AI 禁用</option>
              <option value="fake">Fake AI</option>
              <option value="openai-compatible">OpenAI-compatible</option>
            </select>
            <span class="hint" id="providerHint">配置读取中</span>
          </div>
          <button id="runButton">启动</button>
        </div>
      </section>
    </main>

    <aside class="inspector">
      <section class="panel-box">
        <h2>运行状态</h2>
        <div class="metrics" id="runMetrics"></div>
      </section>

      <section class="panel-box">
        <h2>Agent Run Tree inspector</h2>
        <div class="agent-tree" id="agentTree">
          <div class="node-meta">暂无派生 agent。</div>
        </div>
        <div class="node-meta" id="agentInspector">选中运行后显示 spec、权限、预算和输出引用。</div>
      </section>

      <details>
        <summary>模型配置</summary>
        <div class="fields">
          <label>Base URL <input id="baseUrlInput" autocomplete="off"></label>
          <label>模型名 <input id="modelInput" autocomplete="off"></label>
          <label>默认 AI 模式
            <select id="defaultAiModeInput">
              <option value="none">AI 禁用</option>
              <option value="fake">Fake AI</option>
              <option value="openai-compatible">OpenAI-compatible</option>
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
      runHistory: [],
      modelOutputEntries: new Map()
    };

    const dom = {
      runStatus: document.getElementById("runStatus"),
      runMetrics: document.getElementById("runMetrics"),
      mainCanvas: document.getElementById("mainCanvas"),
      transcript: document.getElementById("transcript"),
      introBlock: document.getElementById("introBlock"),
      goalInput: document.getElementById("goalInput"),
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
      agentTree: document.getElementById("agentTree"),
      agentInspector: document.getElementById("agentInspector"),
      debugList: document.getElementById("debugList"),
      debugJson: document.getElementById("debugJson")
    };

    dom.runButton.addEventListener("click", startRun);
    dom.newRunButton.addEventListener("click", resetComposer);
    dom.saveConfigButton.addEventListener("click", saveModelConfig);
    dom.saveToolConfigButton.addEventListener("click", saveToolConfig);

    init();

    async function init() {
      renderMetrics("pending", undefined);
      renderAgentTree(undefined);
      await Promise.all([loadConfig(), loadToolsConfig()]);
    }

    async function loadConfig() {
      try {
        const result = await requestJson("/api/config");
        state.config = result.config;
        state.informationAccess = result.informationAccess;
        dom.baseUrlInput.value = result.config.baseUrl || "";
        dom.modelInput.value = result.config.model || "";
        dom.defaultAiModeInput.value = result.config.defaultAiMode || "fake";
        dom.aiMode.value = "fake";
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
        dom.aiMode.value = result.config.defaultAiMode || dom.aiMode.value;
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
      dom.transcript.replaceChildren();
      dom.introBlock.style.display = "none";
      appendLocalEntry("用户目标", compact(goal, 1200), "running");
      setRunStatus("running");
      renderMetrics("running", undefined);
      setButtons(false);

      try {
        const response = await requestJson("/api/desktop/runs", {
          method: "POST",
          body: { goal: goal, aiMode: dom.aiMode.value }
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
      setRunStatus(response.status || "running");
      renderMetrics(response.status || "running", response);
      renderCanvas(response.canvas, response.status || "running");
      renderAgentTree(response);
      if (response.transcript && Array.isArray(response.transcript.events)) {
        response.transcript.events.forEach(appendStreamEvent);
      }
      renderDebug(response);
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
        existing.body.textContent = existing.text;
        updateEntryStatus(existing.row, "running");
        existing.row.scrollIntoView({ block: "nearest" });
        return;
      }
      const entry = appendEntry({
        label: event.agentLabel || "模型",
        title: "模型输出",
        body: chunk,
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

    function renderMetrics(status, response) {
      const tracking = response && response.tracking;
      const rows = [
        ["状态", STATUS_LABELS[status] || status],
        ["阶段", tracking ? tracking.run.stage : "未启动"],
        ["模型事件", tracking ? counts(tracking.modelTotals) : "0 / 0 / 0"],
        ["工具事件", tracking ? counts(tracking.toolTotals) : "0 / 0 / 0"],
        ["候选", tracking ? String(tracking.candidates.total.total) : "0"],
        ["等待点", tracking ? tracking.run.waitingPoint : "等待目标输入"]
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
      grid.append(
        canvasItem("Task Soil", canvas.taskSoil.goalSummary + "；context refs " + canvas.taskSoil.contextRefs.length + "；permission refs " + canvas.taskSoil.permissionBoundaryRefs.length),
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
        dom.agentInspector.textContent = "选中运行后显示 spec、权限、预算和输出引用。";
        return;
      }
      const nodes = [];
      nodes.push(agentNode({
        title: tree.rootSpec.displayName || tree.rootAgentId,
        status: tree.status,
        meta: "root " + tree.rootAgentId + "；delegation " + tree.delegationDecisions.length + "；synthesis " + tree.parentSyntheses.length,
        selected: true
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
        dom.agentInspector.textContent = "父层综合：" + compact(latest.decisionSummary, 260);
      } else {
        dom.agentInspector.textContent = "中枢已建立运行树，等待 child agent 材料回收。";
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
      tag.textContent = input.status;
      head.append(title, tag);
      const meta = document.createElement("div");
      meta.className = "node-meta";
      meta.textContent = input.meta || "";
      node.append(head, meta);
      return node;
    }

    function renderAgentInspector(run, tree) {
      dom.agentInspector.textContent = [
        "spec " + run.specId,
        "agent " + run.agentId,
        "权限 " + (run.allowModel ? "model" : "no-model") + (run.allowedTools && run.allowedTools.length ? " + " + run.allowedTools.join("/") : ""),
        "预算 M" + run.budget.maxModelRounds + "/T" + run.budget.maxToolRounds,
        "输入 " + run.inputRefs.slice(0, 3).join("，"),
        "输出 " + run.outputRefs.slice(0, 4).join("，"),
        run.uncertainty ? "不确定性 " + compact(run.uncertainty, 160) : ""
      ].filter(Boolean).join("；");
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
      const ready = config.defaultAiMode === "fake" || (config.defaultAiMode === "openai-compatible" && config.model && config.secretConfigured);
      dom.providerHint.textContent = ready
        ? "Desktop Shell 默认 Fake AI；可显式切换模型"
        : "Desktop Shell 默认 Fake AI；OpenAI-compatible 需要模型名和密钥";
      dom.workspaceStatus.textContent = "配置中心已连接";
      dom.configStatus.textContent = "当前默认模式：" + (config.defaultAiMode || "fake") + "；密钥：" + (config.secretConfigured ? "已配置" : "未配置");
      dom.configStatus.className = "hint";
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
      dom.goalInput.value = "";
      dom.introBlock.style.display = "";
      dom.transcript.replaceChildren(emptyTranscriptNode());
      renderCanvas(undefined, "pending");
      setRunStatus("pending");
      renderMetrics("pending", undefined);
      renderAgentTree(undefined);
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
