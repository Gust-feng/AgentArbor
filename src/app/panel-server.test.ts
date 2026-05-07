import assert from "node:assert/strict";
import { request } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileSystemNormalSettingsStore } from "../adapters/config/index.js";
import { createPanelHtml } from "./panel-assets.js";
import { startLocalPanelServer, type PanelProviderFetch } from "./panel-server.js";

test("panel HTML defaults to Simplified Chinese labels and status text", () => {
  const html = createPanelHtml();

  assert.equal(html.includes("AgentArbor 面板"), true);
  assert.equal(html.includes("Desktop Shell 工作台"), true);
  assert.equal(html.includes("Plan / Fruit 主画布"), true);
  assert.equal(html.includes("Task Soil"), true);
  assert.equal(html.includes("Aboveground Execution Runtime"), true);
  assert.equal(html.includes("Fruits"), true);
  assert.equal(html.includes("Agent transcript 为空"), true);
  assert.equal(html.includes("Main Canvas 展示 Plan / Fruit"), true);
  assert.equal(html.includes("描述你的任务。Desktop Shell 会先形成 Task Soil，再展示 Plan 和 Fruits。"), true);
  assert.equal(html.includes('<option value="none">AI 禁用</option>'), true);
  assert.equal(html.includes('<option value="fake">Fake AI</option>'), true);
  assert.equal(html.includes('<option value="openai-compatible">OpenAI-compatible</option>'), true);
  assert.equal(html.includes("运行状态"), true);
  assert.equal(html.includes("Agent Run Tree inspector"), true);
  assert.equal(html.includes("折叠调试区"), true);
  assert.equal(html.includes("执行智能"), true);
  assert.equal(html.includes("暂无 Desktop Shell 任务"), true);
  assert.equal(html.includes("模型配置"), true);
  assert.equal(html.includes("工具配置"), true);
  assert.equal(html.includes("启动"), true);
  assert.equal(html.includes("搜索 Provider"), true);
  assert.equal(html.includes("保存工具配置"), true);
  assert.equal(html.includes("Tavily API Key"), true);
  assert.equal(html.includes("待启动 (pending)"), true);
  assert.equal(html.includes("run.started"), true);
  assert.equal(html.includes("model.output.delta"), true);
  assert.equal(html.includes("tool.completed"), true);
  assert.equal(html.includes("final.result"), true);
  assert.equal(html.includes("网页研究"), false);
  assert.equal(html.includes("代码理解"), false);
  assert.equal(html.includes("证据整理"), false);
  assert.equal(html.includes("方向交接"), false);
  assert.equal(html.includes("短视频平台差异化优势与发展路径调研"), false);
  assert.equal(html.includes("产品定位与核心指标体系梳理"), false);
  assert.equal(html.includes("AI 内容创作工具方向探索"), false);
  assert.equal(html.includes("个人知识助手产品形态研究"), false);
  assert.equal(html.includes("开源项目机会扫描"), false);
  assert.equal(html.includes("需要你确认的 3 项"), false);
  assert.equal(html.includes("是否允许访问 GitHub 仓库"), false);
  assert.equal(html.includes("是否需要联网调研竞品"), false);
  assert.equal(html.includes("是否沉淀为方向模板"), false);
  assert.equal(html.includes("36%"), false);
  assert.equal(html.includes("项目文档"), false);
  assert.equal(html.includes("v0.8.0-beta"), false);
  assert.equal(html.includes("BETA"), false);
  assert.equal(html.includes("beta-badge"), false);
  assert.equal(html.includes("Gust-feng"), false);
  assert.equal(html.includes("<h2>工作流阶段时间线</h2>"), false);
  assert.equal(html.includes("<h2>Rootlet 工作区</h2>"), false);
  assert.equal(html.includes("<h2>模型调用追踪</h2>"), false);
  assert.equal(html.includes("<h2>配置中心</h2>"), false);
  assert.equal(html.includes("<h2>Provider 状态</h2>"), false);
  assert.equal(html.includes("<summary>调试视图：Observation Snapshot</summary>"), false);
  assert.equal(html.includes(">芽<"), false);
  assert.equal(html.includes(">木<"), false);
  assert.equal(html.includes("Run Underground"), false);
  assert.equal(html.includes("Save Config"), false);
  assert.equal(html.includes("key configured"), false);
});

test("panel config API returns sanitized provider config and never echoes raw API key", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-config-"));
  const secret = "sk-panel-secret";
  const tavilySecret = "tvly-panel-secret";
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const update = await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example/",
        model: "panel-model",
        defaultAiMode: "fake",
        apiKey: secret,
      },
    });
    const informationUpdate = await requestJson(server.url, "/api/config/information-sources", {
      method: "POST",
      body: {
        tavilyApiKey: tavilySecret,
        tavilyMaxResults: 2,
      },
    });
    const config = await requestJson(server.url, "/api/config");
    const settingsRaw = await fs.readFile(new FileSystemNormalSettingsStore(directory).settingsPath, "utf8");

    assert.equal(update.status, 200);
    assert.equal(informationUpdate.status, 200);
    assert.equal(config.status, 200);
    assert.equal(update.text.includes(secret), false);
    assert.equal(informationUpdate.text.includes(tavilySecret), false);
    assert.equal(config.text.includes(secret), false);
    assert.equal(config.text.includes(tavilySecret), false);
    assert.equal(settingsRaw.includes(secret), false);
    assert.equal(settingsRaw.includes(tavilySecret), false);
    assert.equal(update.body.config.secretConfigured, true);
    assert.equal(informationUpdate.body.informationAccess.web.secretConfigured, true);
    assert.equal(informationUpdate.body.informationAccess.web.maxResults, 2);
    assert.equal(config.body.informationAccess.web.secretConfigured, true);
    assert.equal(update.body.config.baseUrl, "https://provider.example");
    assert.equal(update.body.config.defaultAiMode, "fake");
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("panel tools config routes return sanitized web search config and never echo raw key", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-tools-config-"));
  const tavilySecret = "tvly-panel-tools-secret";
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const initial = await requestJson(server.url, "/api/config/tools");
    const update = await requestJson(server.url, "/api/config/tools/web-search", {
      method: "POST",
      body: {
        provider: "tavily",
        apiKey: tavilySecret,
        maxResults: 2,
      },
    });
    const after = await requestJson(server.url, "/api/config/tools");
    const settingsRaw = await fs.readFile(new FileSystemNormalSettingsStore(directory).settingsPath, "utf8");

    assert.equal(initial.status, 200);
    assert.equal(initial.body.tools.webSearch.provider, "tavily");
    assert.equal(initial.body.tools.webSearch.status, "no-provider");
    assert.equal(update.status, 200);
    assert.equal(after.status, 200);
    assert.equal(update.text.includes(tavilySecret), false);
    assert.equal(after.text.includes(tavilySecret), false);
    assert.equal(settingsRaw.includes(tavilySecret), false);
    assert.equal(update.body.tools.webSearch.secretConfigured, true);
    assert.equal(update.body.tools.webSearch.status, "ready");
    assert.equal(update.body.tools.webSearch.maxResults, 2);
    assert.equal(after.body.tools.webSearch.secretConfigured, true);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("panel tools route can disable web search without using the stored Tavily key", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-tools-disabled-"));
  const modelSecret = "sk-disabled-tools-secret";
  const tavilySecret = "tvly-disabled-panel-secret";
  let modelFetchCalls = 0;
  let tavilyFetchCalls = 0;
  const providerFetch: PanelProviderFetch = async (url, init) => {
    if (url === "https://api.tavily.com/search") {
      tavilyFetchCalls += 1;
      throw new Error("Disabled web search provider must not call Tavily fetch.");
    }

    modelFetchCalls += 1;
    const body = JSON.parse(init.body) as { messages?: readonly { role?: string }[] };
    const hasToolMessage = body.messages?.some((message) => message.role === "tool") ?? false;
    return hasToolMessage ? createStubOpenAiResponse("disabled-tools-model") : createOpenAiSearchToolCallResponse();
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "disabled-tools-model",
        apiKey: modelSecret,
      },
    });
    await requestJson(server.url, "/api/config/tools/web-search", {
      method: "POST",
      body: {
        provider: "tavily",
        apiKey: tavilySecret,
        maxResults: 1,
      },
    });
    const disabled = await requestJson(server.url, "/api/config/tools/web-search", {
      method: "POST",
      body: { provider: "none" },
    });

    const run = await requestJson(server.url, "/api/underground/run", {
      method: "POST",
      body: { goal: "Build a small deterministic helper.", aiMode: "openai-compatible" },
    });

    assert.equal(disabled.status, 200);
    assert.equal(disabled.body.tools.webSearch.provider, "none");
    assert.equal(disabled.body.tools.webSearch.status, "disabled");
    assert.equal(disabled.body.tools.webSearch.secretConfigured, true);
    assert.equal(disabled.text.includes(tavilySecret), false);
    assert.equal(run.status, 200);
    assert.equal(modelFetchCalls >= 2, true);
    assert.equal(tavilyFetchCalls, 0);
    assert.equal(run.body.trace.events.some((event: { type: string }) => event.type === "tool.completed"), true);
    assert.equal(JSON.stringify(run.body).includes(modelSecret), false);
    assert.equal(JSON.stringify(run.body).includes(tavilySecret), false);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("panel rejects disabled AI mode without starting an approved underground run or leaking secrets", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-ai-disabled-"));
  const secret = "sk-ai-disabled-secret";
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: { apiKey: secret, model: "unused-model" },
    });
    const run = await requestJson(server.url, "/api/underground/run", {
      method: "POST",
      body: { goal: "Build a small deterministic helper.", aiMode: "none" },
    });

    assert.equal(run.status, 400);
    assert.equal(run.text.includes(secret), false);
    assert.equal(run.body.ok, false);
    assert.equal(run.body.error.code, "ai_disabled");
    assert.equal(run.body.summary.ai.enabled, false);
    assert.equal(run.body.summary.ai.status, "configuration_failed");
    assert.equal(run.body.summary.ai.eventCounts.requested, 0);
    assert.equal(run.body.summary.ai.modelCallRefs.length, 0);
    assert.equal(run.body.observation, undefined);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("panel fake AI run exposes model and candidate summaries without model prompt content", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-fake-"));
  const secret = "sk-visible-output-secret";
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        model: "unused-fake-model",
        apiKey: secret,
      },
    });
    const run = await requestJson(server.url, "/api/underground/run", {
      method: "POST",
      body: {
        goal: "需要风险、安全、资产、证据、约束和反驳，并且权限未知待确认。",
        aiMode: "fake",
      },
    });

    assert.equal(run.status, 200);
    assert.equal(run.body.summary.ai.mode, "fake");
    assert.equal(run.body.summary.ai.eventCounts.requested > 0, true);
    assert.equal(run.body.summary.ai.modelCallRefs.length > 0, true);
    assert.equal(run.body.summary.ai.modelCallRefs.some((call: { visibleOutput?: unknown }) => call.visibleOutput !== undefined), true);
    assert.equal(run.body.tracking.provider.status, "fake_provider");
    assert.equal(run.body.tracking.modelTotals.requested > 0, true);
    assert.equal(run.body.tracking.rootletsByKind.option.model.completed > 0, true);
    assert.equal(run.body.tracking.aiCandidates.total > 0, true);
    assert.equal(run.body.tracking.convergence.outcome === "approved" || run.body.tracking.convergence.outcome === "awaiting_user", true);
    const visibleCalls = run.body.transcript.modelCalls.filter(
      (call: { visibleOutput?: unknown }) => call.visibleOutput !== undefined
    ) as {
      readonly rootletKind?: string;
      readonly visibleOutput: {
        readonly contractId: string;
        readonly outputKind: string;
        readonly validationStatus: string;
        readonly rootletKind?: string;
        readonly truncated: boolean;
        readonly items: readonly {
          readonly fields: readonly { readonly name: string; readonly value: string; readonly truncated: boolean }[];
        }[];
      };
    }[];
    const optionCall = visibleCalls.find((call: { rootletKind?: string }) => call.rootletKind === "option");
    const riskCall = visibleCalls.find((call: { rootletKind?: string }) => call.rootletKind === "risk");
    assert.equal(visibleCalls.length > 0, true);
    if (optionCall === undefined) {
      throw new Error("Expected option visible output in fake AI panel run.");
    }
    if (riskCall === undefined) {
      throw new Error("Expected risk visible output in fake AI panel run.");
    }
    assert.equal(optionCall.visibleOutput.contractId, "underground.rootlet_candidate_advice.option.v2");
    assert.equal(optionCall.visibleOutput.outputKind, "candidate");
    assert.equal(optionCall.visibleOutput.validationStatus, "passed");
    assert.equal(optionCall.visibleOutput.rootletKind, "option");
    assert.equal(optionCall.visibleOutput.truncated, false);
    const optionFields = optionCall.visibleOutput.items[0]?.fields ?? [];
    assert.equal(
      optionFields.some(
        (field: { name: string; value: string }) =>
          field.name === "summary" && field.value.includes("Fake option candidate advice 1")
      ),
      true
    );
    assert.equal(optionFields.some((field: { name: string; value: string }) => field.name === "tradeoffs" && field.value.includes("goal-specific")), true);
    assert.equal(optionFields.some((field: { name: string; truncated: boolean }) => field.name === "applicability" && field.truncated === false), true);
    assert.equal(
      riskCall.visibleOutput.items[0].fields.some((field: { name: string }) => field.name === "impactScope"),
      true
    );
    assertSafePanelJsonText(run.text);
    assert.equal(run.text.includes("API key"), false);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("desktop async fake run returns main canvas with Task Soil, approved Plan, Aboveground artifact, and Fruit", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-fake-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "Build a Desktop Shell visible Plan and Fruit result." },
    });
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );

    assert.equal(start.status, 202);
    assert.equal(start.body.runKind, "desktop");
    assert.equal(completed.body.runKind, "desktop");
    assert.equal(completed.body.canvas.taskSoil.goalSummary.includes("Desktop Shell visible Plan"), true);
    assert.equal(completed.body.canvas.taskSoil.contextRefs.length > 0, true);
    assert.equal(completed.body.canvas.taskSoil.permissionBoundaryRefs.length > 0, true);
    assert.equal(completed.body.canvas.plan.status, "approved");
    assert.equal(completed.body.canvas.plan.validationPassed, true);
    assert.equal(completed.body.canvas.plan.packageRef.packageId.length > 0, true);
    assert.equal(completed.body.canvas.plan.recommendedDirection.summary.length > 0, true);
    assert.equal(completed.body.canvas.plan.keyEvidenceRefs.length > 0, true);
    assert.equal(completed.body.canvas.aboveground.consumer, "Aboveground Execution Runtime");
    assert.equal(completed.body.canvas.aboveground.artifact.artifactId.length > 0, true);
    assert.equal(completed.body.canvas.aboveground.verification.status, "passed");
    assert.equal(completed.body.canvas.fruits.fruit.fruitId.length > 0, true);
    assert.equal(completed.body.canvas.fruits.runMemory.runMemoryId.length > 0, true);
    assert.equal(completed.body.canvas.fruits.experienceCandidate.candidateId.length > 0, true);
    assert.equal(completed.body.canvas.fruits.pathBias.pathBiasId.length > 0, true);
    assert.equal(completed.body.tracking.run.abovegroundStatus, "completed");
    assert.equal(completed.body.tracking.candidates.total.total > 0, true);
    assert.equal(completed.body.tracking.package.validationPassed, true);
    assert.equal(completed.body.tracking.agentRunTree.childRuns.length > 0, true);
    assert.equal(completed.body.transcript.events.some((event: { type: string }) => event.type === "final.result"), true);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("desktop aiMode none fails at boundary and does not approve a Plan", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-none-"));
  const secret = "sk-desktop-none-secret";
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: { apiKey: secret, model: "unused-desktop-model" },
    });
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "Attempt a disabled Desktop Shell run.", aiMode: "none" },
    });
    const failed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "failed",
      4_000,
      "/api/desktop/runs"
    );

    assert.equal(start.status, 202);
    assert.equal(failed.body.runKind, "desktop");
    assert.equal(failed.body.status, "failed");
    assert.equal(failed.body.error.code, "ai_disabled");
    assert.equal(failed.body.canvas, undefined);
    assert.equal(failed.text.includes(secret), false);
    assert.equal(failed.text.includes('"status":"approved"'), false);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("desktop openai-compatible missing config fails before provider fetch", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-missing-key-"));
  let fetchCalls = 0;
  const providerFetch: PanelProviderFetch = async () => {
    fetchCalls += 1;
    throw new Error("provider fetch must not be called for missing desktop config");
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: { model: "desktop-openai-model" },
    });
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "Build a Desktop Shell run with missing key.", aiMode: "openai-compatible" },
    });
    const failed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "failed",
      4_000,
      "/api/desktop/runs"
    );

    assert.equal(fetchCalls, 0);
    assert.equal(failed.body.error.code, "missing_api_key");
    assert.equal(failed.body.canvas, undefined);
    assert.equal(failed.body.summary.ai.eventCounts.requested, 0);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("desktop openai-compatible missing model fails before provider fetch and redacts key", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-missing-model-"));
  const secret = "sk-desktop-missing-model-secret";
  let fetchCalls = 0;
  const providerFetch: PanelProviderFetch = async () => {
    fetchCalls += 1;
    throw new Error("provider fetch must not be called for missing desktop model");
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: { apiKey: secret },
    });
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "Build a Desktop Shell run with missing model.", aiMode: "openai-compatible" },
    });
    const failed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "failed",
      4_000,
      "/api/desktop/runs"
    );

    assert.equal(fetchCalls, 0);
    assert.equal(failed.body.error.code, "missing_model_name");
    assert.equal(failed.body.canvas, undefined);
    assert.equal(failed.text.includes(secret), false);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("desktop canvas, tracking, transcript, and SSE keep model and tool internals redacted", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-safe-"));
  const secret = "sk-desktop-safe-secret";
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        model: "unused-desktop-safe-model",
        apiKey: secret,
      },
    });
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "需要 Plan 和 Fruit，但不要泄漏模型内部材料。", aiMode: "fake" },
    });
    const stream = await requestSse(server.url, `/api/desktop/runs/${encodeURIComponent(start.body.runId)}/stream?cursor=0`);
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );
    const safeText = `${JSON.stringify({
      canvas: completed.body.canvas,
      tracking: completed.body.tracking,
      transcript: completed.body.transcript,
    })}\n${stream.text}`;

    assert.equal(stream.status, 200);
    assert.equal(stream.events.some((event) => event.type === "final.result"), true);
    assert.equal(safeText.includes(secret), false);
    assert.equal(safeText.includes("rawPrompt"), false);
    assert.equal(safeText.includes("raw_prompt"), false);
    assert.equal(safeText.includes("sanitizedMessages"), false);
    assert.equal(safeText.includes("Return JSON only"), false);
    assert.equal(safeText.includes("raw provider response"), false);
    assert.equal(safeText.includes("hidden reasoning"), false);
    assert.equal(safeText.includes("raw tool output"), false);
    assertSafePanelJsonText(safeText);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("panel async underground run starts without waiting for provider completion and exposes partial cursor", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-async-"));
  const secret = "sk-async-secret";
  let fetchCalls = 0;
  let releaseFirstFetch: (() => void) | undefined;
  const firstFetchGate = new Promise<void>((resolve) => {
    releaseFirstFetch = resolve;
  });
  const providerFetch: PanelProviderFetch = async () => {
    fetchCalls += 1;
    if (fetchCalls === 1) {
      await firstFetchGate;
    }
    return createStubOpenAiResponse("async-panel-model");
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "async-panel-model",
        defaultAiMode: "openai-compatible",
        apiKey: secret,
      },
    });

    const startedAt = Date.now();
    const start = await requestJson(server.url, "/api/underground/runs", {
      method: "POST",
      body: { goal: "Build an observable async underground run.", aiMode: "openai-compatible" },
    });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(start.status, 202);
    assert.equal(typeof start.body.runId, "string");
    assert.equal(start.body.runKind, "underground");
    assert.equal(start.body.config.secretConfigured, true);
    assert.equal(start.text.includes(secret), false);
    assert.equal(elapsedMs < 1_000, true);

    const running = await waitForRun(server.url, start.body.runId, (body) =>
      body.status === "running" && body.trace.events.some((event: { type: string }) => event.type === "model.requested")
    );
    assert.equal(running.body.status, "running");
    assert.equal(running.body.runKind, "underground");
    assert.equal(running.body.trace.eventCursor.eventCount > 0, true);
    assert.equal(running.body.tracking.modelTotals.requested > 0, true);
    assert.equal(running.body.transcript.modelCalls.some((call: { status: string }) => call.status === "requested"), true);

    releaseFirstFetch?.();
    const completed = await waitForRun(server.url, start.body.runId, (body) => body.status === "completed");
    assert.equal(completed.body.status, "completed");
    assert.equal(completed.body.trace.eventCursor.eventCount >= running.body.trace.eventCursor.eventCount, true);
    assert.equal(completed.body.observation.eventCursor.eventCount, completed.body.trace.eventCursor.eventCount);
  } finally {
    releaseFirstFetch?.();
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("panel run stream disconnect does not stop the background run", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-sse-disconnect-"));
  const secret = "sk-sse-disconnect-secret";
  let fetchCalls = 0;
  let releaseFirstFetch: (() => void) | undefined;
  const firstFetchGate = new Promise<void>((resolve) => {
    releaseFirstFetch = resolve;
  });
  const providerFetch: PanelProviderFetch = async () => {
    fetchCalls += 1;
    if (fetchCalls === 1) {
      await firstFetchGate;
    }
    return createStubOpenAiResponse("sse-disconnect-model");
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "sse-disconnect-model",
        defaultAiMode: "openai-compatible",
        apiKey: secret,
      },
    });
    const start = await requestJson(server.url, "/api/underground/runs", {
      method: "POST",
      body: { goal: "Build an observable run that survives stream disconnect.", aiMode: "openai-compatible" },
    });

    await openAndAbortSse(server.url, `/api/underground/runs/${encodeURIComponent(start.body.runId)}/stream?cursor=0`);
    releaseFirstFetch?.();
    const completed = await waitForRun(server.url, start.body.runId, (body) => body.status === "completed");

    assert.equal(completed.body.status, "completed");
    assert.equal(completed.text.includes(secret), false);
    assert.equal(completed.body.transcript.events.some((event: { type: string }) => event.type === "final.result"), true);
  } finally {
    releaseFirstFetch?.();
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("panel run stream returns safe SSE events with fake model output deltas", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-sse-fake-"));
  const secret = "sk-sse-fake-secret";
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        model: "unused-fake-model",
        apiKey: secret,
      },
    });
    const start = await requestJson(server.url, "/api/underground/runs", {
      method: "POST",
      body: {
        goal: "需要风险、安全、资产、证据、约束和反驳，并且权限未知待确认。",
        aiMode: "fake",
      },
    });

    const stream = await requestSse(server.url, `/api/underground/runs/${encodeURIComponent(start.body.runId)}/stream?cursor=0`);
    const deltas = stream.events.filter((event) => event.type === "model.output.delta");

    assert.equal(stream.status, 200);
    assert.equal(String(stream.headers["content-type"]).includes("text/event-stream"), true);
    assert.equal(stream.events[0].type, "run.started");
    assert.equal(deltas.length > 1, true);
    const liveDeltaRequestIds = new Set(
      deltas
        .filter((event) => event.eventId.includes(":live:model.output.delta:"))
        .flatMap((event) => event.modelCallRefs)
    );
    assert.equal(
      deltas.some(
        (event) =>
          !event.eventId.includes(":live:model.output.delta:") &&
          event.modelCallRefs.some((requestId: string) => liveDeltaRequestIds.has(requestId))
      ),
      false
    );
    assert.equal(stream.events.some((event) => event.type === "model.output.completed"), true);
    assert.equal(stream.events.some((event) => event.type === "final.result"), true);
    assert.equal(stream.text.includes(secret), false);
    assert.equal(stream.text.includes("sanitizedMessages"), false);
    assert.equal(stream.text.includes("Return JSON only"), false);
    assertSafePanelJsonText(stream.text);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("panel run stream cursor resumes without repeating older events", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-sse-cursor-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const start = await requestJson(server.url, "/api/underground/runs", {
      method: "POST",
      body: { goal: "Build a deterministic helper through a resumable stream.", aiMode: "fake" },
    });
    const completed = await waitForRun(server.url, start.body.runId, (body) => body.status === "completed");
    const cursor = completed.body.transcript.events[1].sequence;
    const stream = await requestSse(server.url, `/api/underground/runs/${encodeURIComponent(start.body.runId)}/stream?cursor=${cursor}`);

    assert.equal(stream.status, 200);
    assert.equal(stream.events.length > 0, true);
    assert.equal(stream.events.some((event) => event.sequence <= cursor), false);
    assert.equal(new Set(stream.events.map((event) => event.sequence)).size, stream.events.length);
    assert.equal(stream.events.some((event) => event.type === "final.result"), true);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("panel async fake AI transcript includes agent work notes and redacts model internals", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-transcript-"));
  const secret = "sk-transcript-secret";
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        model: "unused-fake-model",
        apiKey: secret,
      },
    });
    const start = await requestJson(server.url, "/api/underground/runs", {
      method: "POST",
      body: {
        goal: "需要风险、安全、资产、证据、约束和反驳，并且权限未知待确认。",
        aiMode: "fake",
      },
    });
    const completed = await waitForRun(server.url, start.body.runId, (body) => body.status === "completed");
    const transcriptText = JSON.stringify(completed.body.transcript);
    const agentIds = completed.body.transcript.workNotes.map((note: { agentId: string }) => note.agentId);

    assert.equal(agentIds.includes("underground-rootlet-agents"), true);
    assert.equal(agentIds.includes("intelligence-channel"), true);
    assert.equal(agentIds.includes("underground-convergence-judge"), true);
    assert.equal(agentIds.includes("underground-handoff-steward"), true);
    assert.equal(completed.body.transcript.modelCalls.length > 0, true);
    assert.equal(
      completed.body.transcript.modelCalls.some((call: { visibleOutput?: unknown }) => call.visibleOutput !== undefined),
      true
    );
    assert.equal(transcriptText.includes(secret), false);
    assert.equal(transcriptText.includes("sanitizedMessages"), false);
    assert.equal(transcriptText.includes("Return JSON only"), false);
    assertSafePanelJsonText(transcriptText);
    assert.equal(transcriptText.includes("Fake option candidate advice"), true);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("panel openai-compatible visible output truncates long fields and excludes raw provider response", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-visible-output-"));
  const secret = "sk-visible-output-secret";
  const longSummary = "Long visible model output ".repeat(20);
  const providerFetch: PanelProviderFetch = async () =>
    createStubOpenAiResponse("visible-output-model", { summary: longSummary });
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "visible-output-model",
        apiKey: secret,
      },
    });

    const run = await requestJson(server.url, "/api/underground/run", {
      method: "POST",
      body: { goal: "Build a visible output helper.", aiMode: "openai-compatible" },
    });
    const visibleOutput = run.body.transcript.modelCalls.find(
      (call: { visibleOutput?: unknown }) => call.visibleOutput !== undefined
    )?.visibleOutput;
    const summaryField = visibleOutput?.items[0].fields.find((field: { name: string }) => field.name === "summary");

    assert.equal(run.status, 200);
    assert.equal(visibleOutput?.validationStatus, "passed");
    assert.equal(summaryField?.truncated, true);
    assert.equal(summaryField.value.length <= 180, true);
    assert.equal(run.text.includes(longSummary), false);
    assert.equal(run.text.includes("choices"), false);
    assertSafePanelJsonText(run.text);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("panel validation failed model output falls back without approved visible output", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-invalid-output-"));
  const secret = "sk-invalid-output-secret";
  const providerFetch: PanelProviderFetch = async () => createInvalidOpenAiResponse("invalid-output-model");
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "invalid-output-model",
        apiKey: secret,
      },
    });

    const run = await requestJson(server.url, "/api/underground/run", {
      method: "POST",
      body: { goal: "Build a helper with invalid provider output.", aiMode: "openai-compatible" },
    });
    const failedCall = run.body.transcript.modelCalls.find((call: { status: string }) => call.status === "failed");

    assert.equal(run.status, 200);
    assert.equal(failedCall?.validationStatus, "failed");
    assert.equal(failedCall?.visibleOutput, undefined);
    assert.equal(run.body.summary.ai.fallbackCount > 0, true);
    assert.equal(run.text.includes("bad raw output"), false);
    assert.equal(run.text.includes("hidden_reasoning"), false);
    assert.equal(run.text.includes("provider raw response marker"), false);
    assertSafePanelJsonText(run.text);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("panel openai-compatible missing key fails before provider fetch", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-missing-key-"));
  let fetchCalls = 0;
  const providerFetch: PanelProviderFetch = async () => {
    fetchCalls += 1;
    throw new Error("fetch must not be called");
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: { model: "panel-model" },
    });
    const run = await requestJson(server.url, "/api/underground/run", {
      method: "POST",
      body: { goal: "Build a small deterministic helper.", aiMode: "openai-compatible" },
    });

    assert.equal(run.status, 400);
    assert.equal(fetchCalls, 0);
    assert.equal(run.body.ok, false);
    assert.equal(run.body.error.code, "missing_api_key");
    assert.equal(run.body.error.message, "OpenAI-compatible 模式缺少 API key，已在发起网络请求前停止。");
    assert.equal(run.body.summary.ai.status, "configuration_failed");
    assert.equal(run.body.summary.ai.eventCounts.requested, 0);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("panel openai-compatible run uses configured ToolCenter search from tools route", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-configured-tools-run-"));
  const modelSecret = "sk-configured-tools-secret";
  const tavilySecret = "tvly-configured-tools-secret";
  let modelFetchCalls = 0;
  let tavilyFetchCalls = 0;
  const providerFetch: PanelProviderFetch = async (url, init) => {
    if (url === "https://api.tavily.com/search") {
      tavilyFetchCalls += 1;
      const body = JSON.parse(init.body) as { api_key?: string; max_results?: number };
      assert.equal(body.api_key, tavilySecret);
      assert.equal(body.max_results, 1);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            {
              title: "Configured panel search",
              url: "https://example.test/panel-search",
              content: "Panel configured ToolCenter search snippet.",
            },
          ],
        }),
      };
    }

    modelFetchCalls += 1;
    const body = JSON.parse(init.body) as { messages?: readonly { role?: string; content?: string }[] };
    const isCandidateAggregation = body.messages?.some(
      (message) => typeof message.content === "string" && message.content.includes("Underground Candidate Collector")
    ) ?? false;
    if (isCandidateAggregation) {
      return createStubOpenAiAggregationResponse("configured-tools-model");
    }
    const hasToolMessage = body.messages?.some((message) => message.role === "tool") ?? false;
    return hasToolMessage ? createStubOpenAiResponse("configured-tools-model") : createOpenAiSearchToolCallResponse();
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "configured-tools-model",
        apiKey: modelSecret,
      },
    });
    await requestJson(server.url, "/api/config/tools/web-search", {
      method: "POST",
      body: {
        provider: "tavily",
        apiKey: tavilySecret,
        maxResults: 1,
      },
    });

    const run = await requestJson(server.url, "/api/underground/run", {
      method: "POST",
      body: { goal: "Build a small deterministic helper.", aiMode: "openai-compatible" },
    });

    assert.equal(run.status, 200);
    assert.equal(modelFetchCalls >= 2, true);
    assert.equal(tavilyFetchCalls, 2);
    assert.equal(run.body.trace.events.some((event: { type: string }) => event.type === "tool.completed"), true);
    assert.equal(JSON.stringify(run.body).includes(modelSecret), false);
    assert.equal(JSON.stringify(run.body).includes(tavilySecret), false);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("panel openai-compatible missing model does not leak configured API key", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-missing-model-"));
  const secret = "sk-model-missing-secret";
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: { apiKey: secret },
    });
    const run = await requestJson(server.url, "/api/underground/run", {
      method: "POST",
      body: { goal: "Build a small deterministic helper.", aiMode: "openai-compatible" },
    });

    assert.equal(run.status, 400);
    assert.equal(run.text.includes(secret), false);
    assert.equal(run.body.error.code, "missing_model_name");
    assert.equal(run.body.error.message, "OpenAI-compatible 模式缺少模型名，已在发起网络请求前停止。");
    assert.equal(run.body.summary.ai.eventCounts.requested, 0);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

type RequestJsonOptions = {
  readonly method?: "GET" | "POST";
  readonly body?: unknown;
};

type RequestJsonResult = {
  readonly status: number;
  readonly text: string;
  readonly body: any;
};

type RequestSseResult = {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly text: string;
  readonly events: readonly any[];
};

function requestJson(baseUrl: string, pathname: string, options: RequestJsonOptions = {}): Promise<RequestJsonResult> {
  const url = new URL(pathname, baseUrl);
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: options.method ?? "GET",
        headers:
          body === undefined
            ? undefined
            : {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(body),
              },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            text,
            body: JSON.parse(text),
          });
        });
      }
    );
    req.on("error", reject);
    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

function requestSse(baseUrl: string, pathname: string, timeoutMs = 5_000): Promise<RequestSseResult> {
  const url = new URL(pathname, baseUrl);
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "GET" }, (response) => {
      let text = "";
      const timeout = setTimeout(() => {
        req.destroy(new Error(`Timed out waiting for SSE ${pathname}`));
      }, timeoutMs);
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        text += chunk;
      });
      response.on("end", () => {
        clearTimeout(timeout);
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          text,
          events: parseSseEvents(text),
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function openAndAbortSse(baseUrl: string, pathname: string, timeoutMs = 2_000): Promise<void> {
  const url = new URL(pathname, baseUrl);
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        req.destroy();
        reject(new Error(`Timed out waiting for first SSE chunk ${pathname}`));
      }
    }, timeoutMs);
    const req = request(url, { method: "GET" }, (response) => {
      response.setEncoding("utf8");
      response.once("data", () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          req.destroy();
          resolve();
        }
      });
    });
    req.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    });
    req.end();
  });
}

function parseSseEvents(text: string): readonly any[] {
  return text
    .split(/\n\n/g)
    .map((block) => block.trim())
    .filter((block) => block.length > 0 && !block.startsWith(":"))
    .map((block) => {
      const dataLine = block.split(/\n/g).find((line) => line.startsWith("data: "));
      if (dataLine === undefined) {
        return undefined;
      }
      return JSON.parse(dataLine.slice("data: ".length));
    })
    .filter((event): event is any => event !== undefined);
}

async function waitForRun(
  baseUrl: string,
  runId: string,
  predicate: (body: any) => boolean,
  timeoutMs = 4_000,
  runsPath = "/api/underground/runs"
): Promise<RequestJsonResult> {
  const startedAt = Date.now();
  let last: RequestJsonResult | undefined;
  while (Date.now() - startedAt < timeoutMs) {
    last = await requestJson(baseUrl, `${runsPath}/${encodeURIComponent(runId)}`);
    if (predicate(last.body)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for panel run ${runId}; last=${last?.text}`);
}

function createStubOpenAiResponse(
  model: string,
  candidateOverrides: Record<string, unknown> = {}
): Awaited<ReturnType<PanelProviderFetch>> {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      model,
      choices: [
        {
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: JSON.stringify({
              candidates: [
                {
                  summary: "Stub candidate advice.",
                  tradeoffs: ["observable run state", "package validation remains in charge"],
                  applicability: "Use for panel polling tests.",
                  mitigation: "Keep provider output as candidate advice only.",
                  evidenceType: "test",
                  confidence: "medium",
                  constraintLevel: "soft",
                  enforcementGate: "direction_handoff",
                  alternativeDirection: "Use a reduced fake AI pass.",
                  whyNotChosen: "This test needs model.requested visibility.",
                  ...candidateOverrides,
                },
              ],
            }),
          },
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 12,
        total_tokens: 22,
      },
    }),
  };
}

function createStubOpenAiAggregationResponse(
  model: string
): Awaited<ReturnType<PanelProviderFetch>> {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      model,
      choices: [
        {
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: JSON.stringify({
              aggregationRationale: "Stub aggregation: merged rootlet outputs into unified candidate pool.",
              deduplicationNotes: ["No duplicates detected."],
              implicitRelations: [],
              decisionSummary: "Aggregated candidates from rootlet agents.",
              uncertainty: "None for stub.",
              confidence: 0.9,
            }),
          },
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 12,
        total_tokens: 22,
      },
    }),
  };
}

function createOpenAiSearchToolCallResponse(): Awaited<ReturnType<PanelProviderFetch>> {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      model: "configured-tools-model",
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call-panel-search",
                type: "function",
                function: {
                  name: "search",
                  arguments: JSON.stringify({
                    query: "AgentArbor configured panel search",
                    sources: ["web"],
                  }),
                },
              },
            ],
          },
        },
      ],
    }),
  };
}

function createInvalidOpenAiResponse(model: string): Awaited<ReturnType<PanelProviderFetch>> {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      model,
      choices: [
        {
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: JSON.stringify({
              rationale: "bad raw output with provider raw response marker",
              hidden_reasoning: "must not leave provider normalization with Bearer leaked-token, system prompt, and sk-raw-secret",
            }),
          },
        },
      ],
    }),
  };
}

function assertSafePanelJsonText(text: string): void {
  const lower = text.toLowerCase();
  assert.equal(/\bsk-[A-Za-z0-9_-]{6,}/.test(text), false);
  assert.equal(text.includes("Bearer "), false);
  assert.equal(lower.includes("system prompt"), false);
  assert.equal(text.includes("完整 prompt"), false);
  assert.equal(text.includes("sanitizedMessages"), false);
  assert.equal(text.includes("Return JSON only"), false);
  assert.equal(lower.includes("provider raw response"), false);
  assert.equal(lower.includes("hidden reasoning"), false);
}
