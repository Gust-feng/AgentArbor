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
      --bg: #f6f7f9;
      --surface: #ffffff;
      --surface-strong: #eef2f5;
      --line: #d7dde3;
      --text: #17202a;
      --muted: #5b6875;
      --accent: #0f766e;
      --accent-strong: #0b5f59;
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
      min-height: 112px;
      resize: vertical;
    }

    label {
      display: grid;
      gap: 5px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
    }

    main {
      max-width: 1360px;
      margin: 0 auto;
      padding: 18px;
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 0 0 14px;
      border-bottom: 1px solid var(--line);
    }

    h1 {
      margin: 0;
      font-size: 20px;
      line-height: 1.2;
    }

    h2 {
      margin: 0 0 12px;
      font-size: 15px;
    }

    h3 {
      margin: 0;
      font-size: 13px;
    }

    .status-pill {
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--surface);
      color: var(--muted);
      padding: 6px 10px;
      min-width: 128px;
      text-align: center;
      white-space: nowrap;
    }

    .status-pill.completed { color: var(--ok); border-color: #86efac; }
    .status-pill.failed { color: var(--danger); border-color: #fecaca; }
    .status-pill.running { color: var(--warn); border-color: #fde68a; }

    .layout {
      display: grid;
      grid-template-columns: minmax(320px, 410px) minmax(0, 1fr);
      gap: 18px;
      margin-top: 18px;
      align-items: start;
    }

    .stack {
      display: grid;
      gap: 14px;
    }

    .section {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
    }

    .fields {
      display: grid;
      gap: 12px;
    }

    .row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
      margin-top: 12px;
    }

    .hint {
      color: var(--muted);
      font-size: 13px;
      margin: 8px 0 0;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }

    .metric {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 10px;
      background: var(--surface-strong);
      min-height: 68px;
    }

    .metric .label {
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 4px;
    }

    .metric .value {
      font-size: 16px;
      font-weight: 750;
      overflow-wrap: anywhere;
    }

    .split {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 14px;
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
      grid-template-columns: 108px minmax(0, 1fr);
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
      background: var(--surface-strong);
    }

    .stage-state.done { color: var(--ok); background: #ecfdf3; }
    .stage-state.active { color: var(--info); background: #eff6ff; }
    .stage-state.waiting { color: var(--warn); background: #fffbeb; }
    .stage-state.failed { color: var(--danger); background: #fff5f5; }
    .stage-state.skipped { color: var(--muted); background: #f8fafc; }

    .stage-title {
      font-weight: 750;
      overflow-wrap: anywhere;
    }

    .stage-detail {
      color: var(--muted);
      margin-top: 3px;
      overflow-wrap: anywhere;
    }

    .rootlet-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }

    .rootlet-card {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      background: #fff;
      display: grid;
      gap: 7px;
      min-height: 148px;
    }

    .transcript-grid,
    .model-output-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .work-note,
    .model-output-card {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      padding: 10px;
      min-height: 132px;
      display: grid;
      gap: 7px;
    }

    .note-header {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: start;
    }

    .note-agent {
      font-weight: 750;
      overflow-wrap: anywhere;
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
      border-top: 1px solid #eef2f5;
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
      border-top: 1px solid #eef2f5;
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

    details {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      padding: 12px 14px;
    }

    summary {
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

    @media (max-width: 1080px) {
      .rootlet-grid, .summary-grid, .transcript-grid, .model-output-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 920px) {
      .layout, .split, .summary-grid, .row, .rootlet-grid, .transcript-grid, .model-output-grid {
        grid-template-columns: 1fr;
      }

      main {
        padding: 12px;
      }

      .topbar {
        align-items: flex-start;
        flex-direction: column;
      }

      .timeline-item {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <main>
    <div class="topbar">
      <h1>AgentArbor 地下运行面板</h1>
      <div id="runStatus" class="status-pill" aria-live="polite">待启动 (pending)</div>
    </div>

    <div class="layout">
      <div class="stack">
        <section class="section">
          <h2>运行输入</h2>
          <form id="runForm" class="fields">
            <label>目标
              <textarea id="goalInput" required>构建一个小型确定性助手。</textarea>
            </label>
            <label>AI 模式
              <select id="aiModeInput">
                <option value="none">无 AI (none)</option>
                <option value="fake">Fake AI (fake)</option>
                <option value="openai-compatible">OpenAI-compatible (openai-compatible)</option>
              </select>
            </label>
            <div class="actions">
              <button id="runButton" type="submit">启动地下运行</button>
            </div>
            <p class="hint">点击后立即创建运行 job；面板会轮询事件游标、等待点、工作笔记和模型调用状态。</p>
          </form>
        </section>

        <section class="section">
          <h2>配置中心</h2>
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
            <h3>信息源配置</h3>
            <div class="row">
              <label>Tavily API Key
                <input id="tavilyApiKeyInput" type="password" autocomplete="new-password" placeholder="仅写入，不回显">
              </label>
              <label>搜索结果数
                <input id="tavilyMaxResultsInput" type="number" min="1" max="10" step="1">
              </label>
            </div>
            <p id="informationSourceState" class="hint">信息源未配置</p>
          </form>
        </section>

        <section class="section">
          <h2>配置 / Provider 状态</h2>
          <div id="configStatus" class="summary-grid"></div>
        </section>
      </div>

      <div class="stack">
        <section class="section">
          <h2>运行总览</h2>
          <div id="overviewMetrics" class="summary-grid"></div>
        </section>

        <section class="section">
          <h2>工作流阶段时间线</h2>
          <ol id="workflowTimeline" class="timeline"></ol>
        </section>

        <section class="section">
          <h2>Rootlet 工作区</h2>
          <div id="rootletWorkspace" class="rootlet-grid"></div>
        </section>

        <section class="section">
          <h2>模型调用追踪</h2>
          <div id="modelTraceMetrics" class="summary-grid"></div>
          <div class="split" style="margin-top: 12px;">
            <div>
              <h3>模型事件序列</h3>
              <ul id="modelEventList"></ul>
            </div>
            <div>
              <h3>模型调用引用</h3>
              <ul id="modelCallList"></ul>
            </div>
          </div>
        </section>

        <section class="section">
          <h2>模型输出</h2>
          <div id="modelOutputList" class="model-output-grid"></div>
        </section>

        <section class="section">
          <h2>Agent Transcript</h2>
          <div id="agentTranscript" class="transcript-grid"></div>
        </section>

        <section class="section split">
          <div>
            <h2>收束解释</h2>
            <div id="convergenceExplanation" class="text-block"></div>
          </div>
          <div>
            <h2>方向包结果</h2>
            <div id="packageResult" class="text-block"></div>
          </div>
        </section>

        <section class="section">
          <h2>事件流摘要</h2>
          <ul id="eventList"></ul>
        </section>

        <details>
          <summary>调试视图：Observation Snapshot</summary>
          <pre id="snapshotView">{}</pre>
        </details>
      </div>
    </div>
  </main>

  <script>
    const ROOTLET_KINDS = ["option", "risk", "asset_fit", "evidence", "constraint", "counterfactual"];
    const WORKFLOW_STAGES = [
      { id: "goal", title: "目标接收", events: ["goal.received"], detail: "接收用户目标并生成地下运行上下文。" },
      { id: "planning", title: "探索规划", events: ["underground.exploration_planned"], detail: "Intent Core 和 Growth Governor 规划 rootlet 集群。" },
      { id: "rootlets", title: "Rootlet 集群", events: ["rootlet_cluster.started"], detail: "按目标画像启动 option / risk / asset / evidence / constraint / counterfactual 根须。" },
      { id: "model", title: "模型调用", events: ["model.requested", "model.completed", "model.failed"], detail: "仅在 fake 或 OpenAI-compatible 模式下经 IntelligenceChannel 调用。" },
      { id: "candidates", title: "候选池", events: ["exploration_candidate.produced", "candidate_pool.updated"], detail: "rootlet 输出被包装为候选并进入唯一候选池。" },
      { id: "convergence", title: "收束评审", events: ["convergence_review.completed"], detail: "Convergence Judge 解释 accepted / merged / rejected / unknown。" },
      { id: "handoff", title: "方向交接", events: ["direction_handoff.completed", "user_approval.requested"], detail: "Handoff Steward 生成方向交接包或请求用户澄清。" }
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

    const state = { config: undefined, informationAccess: undefined, lastRun: undefined, pollToken: 0 };

    const runStatus = document.getElementById("runStatus");
    const goalInput = document.getElementById("goalInput");
    const aiModeInput = document.getElementById("aiModeInput");
    const baseUrlInput = document.getElementById("baseUrlInput");
    const modelInput = document.getElementById("modelInput");
    const defaultAiModeInput = document.getElementById("defaultAiModeInput");
    const apiKeyInput = document.getElementById("apiKeyInput");
    const secretState = document.getElementById("secretState");
    const tavilyApiKeyInput = document.getElementById("tavilyApiKeyInput");
    const tavilyMaxResultsInput = document.getElementById("tavilyMaxResultsInput");
    const informationSourceState = document.getElementById("informationSourceState");
    const runButton = document.getElementById("runButton");
    const configButton = document.getElementById("configButton");

    document.getElementById("runForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      await runUnderground();
    });

    document.getElementById("configForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      await saveConfig();
    });

    loadConfig().catch((error) => showError(error));

    async function loadConfig() {
      const response = await requestJson("/api/config");
      state.config = response.config;
      state.informationAccess = response.informationAccess;
      renderConfig(response.config);
      renderInformationAccess(response.informationAccess);
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
        const informationResponse = await requestJson("/api/config/information-sources", {
          method: "POST",
          body: {
            tavilyApiKey: tavilyApiKeyInput.value,
            tavilyMaxResults: Number(tavilyMaxResultsInput.value || "5")
          }
        });
        apiKeyInput.value = "";
        tavilyApiKeyInput.value = "";
        state.config = response.config;
        state.informationAccess = informationResponse.informationAccess;
        renderConfig(response.config);
        renderInformationAccess(informationResponse.informationAccess);
        renderProviderStatus(response.config, undefined, informationResponse.informationAccess);
        if (!state.lastRun) {
          renderIdleWorkbench(response.config);
        }
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

    function renderInformationAccess(informationAccess) {
      if (!informationAccess) {
        tavilyMaxResultsInput.value = "5";
        informationSourceState.textContent = "信息源未配置";
        return;
      }
      tavilyMaxResultsInput.value = String(informationAccess.web?.maxResults || 5);
      informationSourceState.textContent = informationAccess.web?.secretConfigured ? "Tavily 已配置" : "Tavily 未配置";
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
        ["Tavily", sources?.web?.secretConfigured ? "已配置" : "未配置"],
        ["信息源", (sources?.sourcePreference || []).join(" / ") || "未配置"]
      ]);
    }

    function renderIdleWorkbench(config) {
      renderMetricsInto("overviewMetrics", [
        ["运行状态", "待启动 (pending)"],
        ["当前阶段", "未开始 (not_started)"],
        ["AI 模式", formatAiMode(config.defaultAiMode || "none")],
        ["Provider", PROVIDER_STATUS_LABELS[inferProviderStatus(config, config.defaultAiMode || "none")]],
        ["模型调用", "0 / 0 / 0"],
        ["方向包状态", "暂无"]
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
      renderProviderStatus(input.config, { status: providerStatus }, state.informationAccess);
      renderMetricsInto("overviewMetrics", [
        ["运行状态", "运行中 (running)"],
        ["当前阶段", "请求已发出"],
        ["目标", compactText(input.goal, 72)],
        ["AI 模式", formatAiMode(input.aiMode)],
        ["Provider", PROVIDER_STATUS_LABELS[providerStatus] || providerStatus],
        ["运行提示", "正在创建后台 job；随后按轮询刷新事件游标和 transcript。"]
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
      renderInformationAccess(state.informationAccess);
      renderProviderStatus(response.config, tracking.provider, tracking.informationSources || state.informationAccess);
      renderMetricsInto("overviewMetrics", [
        ["运行状态", formatStatus(tracking.run.status)],
        ["当前相位", labelWithId(PHASE_LABELS, tracking.run.phase)],
        ["当前阶段", labelWithId(STAGE_LABELS, tracking.run.stage)],
        ["模型调用", tracking.modelTotals.requested + " / " + tracking.modelTotals.completed + " / " + tracking.modelTotals.failed],
        ["候选总数", String(tracking.candidates.total.total)],
        ["等待点", tracking.run.waitingPoint]
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

    function renderWorkflowTimeline(stages) {
      const host = document.getElementById("workflowTimeline");
      host.replaceChildren(...stages.map((stage) => {
        const item = document.createElement("li");
        item.className = "timeline-item";
        const status = document.createElement("div");
        status.className = "stage-state " + stage.state;
        status.textContent = STAGE_STATE_LABELS[stage.state] || stage.state;
        const body = document.createElement("div");
        const title = document.createElement("div");
        title.className = "stage-title";
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
        return "Rootlet 工作区已展示每种 kind 的启动、调用、候选和 AI / 回退状态。";
      }
      if (stageId === "model") {
        return "模型事件 requested/completed/failed = " + response.summary.ai.eventCounts.requested + "/" + response.summary.ai.eventCounts.completed + "/" + response.summary.ai.eventCounts.failed + "。";
      }
      if (stageId === "candidates") {
        return "候选池总数 " + response.tracking.candidates.total.total + "，并按 rootlet kind 分组展示。";
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
      runStatus.textContent = formatStatus(status);
      runStatus.className = "status-pill " + status;
    }

    function setButtons(enabled) {
      runButton.disabled = !enabled;
      configButton.disabled = !enabled;
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
