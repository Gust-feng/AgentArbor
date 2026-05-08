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
  const firstScreenHtml = html.slice(
    html.indexOf("<!-- ordinary-screen-start -->"),
    html.indexOf("<!-- ordinary-screen-end -->")
  );

  assert.equal(html.includes("AgentArbor 面板"), true);
  assert.equal(firstScreenHtml.includes("新建任务"), true);
  assert.equal(firstScreenHtml.includes("要完成什么？"), true);
  assert.equal(firstScreenHtml.includes("技能"), true);
  assert.equal(firstScreenHtml.includes("自动化"), true);
  assert.equal(firstScreenHtml.includes("任务列表"), true);
  assert.equal(firstScreenHtml.includes("补充材料和权限"), true);
  assert.equal(firstScreenHtml.includes("材料引用"), true);
  assert.equal(firstScreenHtml.includes("权限说明"), true);
  assert.equal(firstScreenHtml.includes("工作会话"), true);
  assert.equal(firstScreenHtml.includes("分析当前项目的主要问题"), true);
  assert.equal(firstScreenHtml.includes("待办"), true);
  assert.equal(firstScreenHtml.includes("上下文"), true);
  assert.equal(firstScreenHtml.includes("近期活动"), true);
  assert.equal(firstScreenHtml.includes("等待任务开始"), true);
  assert.equal(firstScreenHtml.includes("暂无活动。开始任务后，这里会显示正在读取、比较、整理和生成的过程。"), true);
  assert.equal(firstScreenHtml.includes("输入一个真实任务，必要时补充文件、网页或限制条件。"), true);
  assert.equal(firstScreenHtml.includes("Code"), false);
  assert.equal(html.includes('<aside class="context-pane"'), true);
  assert.equal(html.includes('<aside class="developer-drawer"'), true);
  assert.equal(html.includes("需要确认"), true);
  assert.equal(html.includes("证据"), true);
  assert.equal(html.includes('<option value="none">AI 禁用</option>'), true);
  assert.equal(html.includes('<option value="fake">Fake AI 测试模式</option>'), true);
  assert.equal(html.includes('<option value="openai-compatible">OpenAI-compatible 推荐</option>'), true);
  assert.equal(html.includes("真实 AI 诊断"), true);
  assert.equal(html.includes("模型 / 工具流"), true);
  assert.equal(html.includes("运行树 / 父层综合"), true);
  assert.equal(html.includes("模型服务失败、输出契约失败或配置边界会显示在这里。"), true);
  assert.equal(html.includes("折叠调试区"), true);
  assert.equal(html.includes("暂无最近任务"), true);
  assert.equal(html.includes("模型配置"), true);
  assert.equal(html.includes("工具配置"), true);
  assert.equal(html.includes("开始任务后会显示在这里。"), true);
  assert.equal(html.includes("搜索 Provider"), false);
  assert.equal(html.includes("搜索服务"), true);
  assert.equal(html.includes("保存工具配置"), true);
  assert.equal(html.includes("Tavily API Key"), true);
  assert.equal(firstScreenHtml.includes("待启动 (pending)"), false);
  assert.equal(firstScreenHtml.includes("pending"), false);
  assert.equal(firstScreenHtml.includes("running"), false);
  assert.equal(firstScreenHtml.includes("completed"), false);
  assert.equal(firstScreenHtml.includes("failed"), false);
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
  assert.equal(html.includes("Agent Run Tree inspector"), false);
  assert.equal(firstScreenHtml.includes("Task Soil"), false);
  assert.equal(firstScreenHtml.includes("Plan Package"), false);
  assert.equal(firstScreenHtml.includes("Observation Panel"), false);
  assert.equal(firstScreenHtml.includes("Agent Run Tree"), false);
  assert.equal(firstScreenHtml.includes("provider"), false);
  assert.equal(firstScreenHtml.includes("Desktop Shell 工作台"), false);
  assert.equal(firstScreenHtml.includes("方向智能"), false);
  assert.equal(firstScreenHtml.includes("执行智能"), false);
  assert.equal(firstScreenHtml.includes("OpenAI-compatible"), false);
  assert.equal(firstScreenHtml.includes("Fake AI"), false);
  assert.equal(firstScreenHtml.includes("AI 禁用"), false);
  assert.equal(firstScreenHtml.includes("运行模式"), false);
  assert.equal(firstScreenHtml.includes("模型配置"), false);
  assert.equal(firstScreenHtml.includes("工具配置"), false);
  assert.equal(firstScreenHtml.includes("运行树"), false);
  assert.equal(firstScreenHtml.includes("父层 synthesis"), false);
  assert.equal(firstScreenHtml.includes("rootlet"), false);
  assert.equal(firstScreenHtml.includes("EventLog"), false);
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

test("desktop async fake run returns Work Session report canvas with child agents and parent synthesis", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-fake-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "Build a Desktop Shell visible Work Session report.", aiMode: "fake" },
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
    assert.equal(completed.body.canvas.kind, "work_session_canvas");
    assert.equal(completed.body.canvas.taskSoil.goalSummary.includes("Desktop Shell visible Work Session report"), true);
    assert.equal(completed.body.canvas.taskSoil.contextRefs.length > 0, true);
    assert.equal(completed.body.canvas.taskSoil.permissionBoundaryRefs.length > 0, true);
    assert.equal(completed.body.canvas.workSession.status, "completed");
    assert.equal(completed.body.canvas.workSession.artifact.artifactId.length > 0, true);
    assert.equal(completed.body.canvas.workSession.report.title.length > 0, true);
    assert.equal(completed.body.canvas.workSession.report.keyFindings.length > 0, true);
    assert.equal(completed.body.canvas.workSession.report.recommendations.length > 0, true);
    assert.equal(completed.body.canvas.workSession.report.evidenceRefs.length > 0, true);
    assert.equal(completed.body.canvas.workSession.report.keyFindings.some((finding: string) => finding.includes("桌面主线")), true);
    assert.equal(completed.body.canvas.workSession.report.decisionSummary.includes("父层综合"), true);
    assert.equal(completed.body.transcript.events.some((event: { summary: string }) => event.summary.includes("正在整理上下文")), true);
    assert.equal(JSON.stringify(completed.body.canvas).includes("Fake parent synthesis"), false);
    assert.equal(JSON.stringify(completed.body.canvas).includes("Fake Work Session"), false);
    assert.deepEqual(completed.body.canvas.workSession.steps.map((step: { action: string }) => step.action), [
      "spawn_children",
      "synthesize",
      "produce_artifact",
    ]);
    assert.equal(completed.body.tracking.run.abovegroundStatus, "not_started");
    assert.equal(completed.body.tracking.package, undefined);
    assert.equal(completed.body.tracking.agentRunTree.childRuns.length > 0, true);
    assert.equal(completed.body.tracking.agentRunTree.parentSyntheses.length, 1);
    assert.equal(completed.body.trace.events.some((event: { type: string }) => event.type === "direction_handoff.completed"), false);
    assert.equal(completed.body.trace.events.some((event: { type: string }) => event.type === "underground.exploration_planned"), false);
    assert.equal(completed.body.trace.events.some((event: { type: string }) => event.type === "artifact.produced"), true);
    assert.equal(completed.body.transcript.events.some((event: { type: string }) => event.type === "final.result"), true);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("desktop async fake run answers arbitrary lightweight question without report workflow", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-direct-answer-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "你是什么模型？", aiMode: "fake" },
    });
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );

    assert.equal(start.status, 202);
    assert.equal(completed.body.canvas.kind, "desktop_chat_canvas");
    assert.equal(completed.body.canvas.chat.answer.answer.includes("AgentArbor 桌面助手"), true);
    assert.equal(completed.body.canvas.chat.upgradeRequest, undefined);
    assert.equal(completed.body.tracking.agentRunTree, undefined);
    assert.equal(completed.body.trace.events.some((event: { type: string }) => event.type === "artifact.produced"), false);
    assert.equal(completed.body.transcript.events.some((event: { summary?: string }) => String(event.summary ?? "").includes("项目分析")), false);
    assertSafePanelJsonText(completed.text);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("desktop openai-compatible direct answer accepts plain text model output", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-direct-answer-text-"));
  const secret = "sk-desktop-direct-answer-text-secret";
  const bodies: Record<string, unknown>[] = [];
  const providerFetch: PanelProviderFetch = async (_url, init) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    bodies.push(body);
    return createOpenAiTextResponse(
      "desktop-direct-answer-text-model",
      "我是 AgentArbor 桌面助手。底层模型取决于你在设置中配置的模型运行时；普通问题会直接回答，不会被强行包装成项目分析。"
    );
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "desktop-direct-answer-text-model",
        apiKey: secret,
      },
    });
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "你是什么模型？", aiMode: "openai-compatible" },
    });
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );

    assert.equal(start.status, 202);
    assert.equal(bodies.length, 1);
    assert.deepEqual(bodies.map((body) => body.response_format !== undefined), [false]);
    assert.equal(completed.body.canvas.kind, "desktop_chat_canvas");
    assert.equal(completed.body.canvas.chat.answer.answer.includes("普通问题会直接回答"), true);
    assert.equal(completed.body.canvas.chat.upgradeRequest, undefined);
    assert.equal(completed.body.tracking.agentRunTree, undefined);
    assert.equal(completed.body.transcript.modelCalls.some((call: { visibleOutput?: { source?: string; items?: readonly { fields?: readonly { name?: string; value?: string }[] }[] } }) =>
      call.visibleOutput?.source === "text_output" &&
      call.visibleOutput.items?.some((item) => item.fields?.some((field) => field.name === "text" && String(field.value ?? "").includes("普通问题会直接回答")))
    ), true);
    assertSafePanelJsonText(completed.text);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("desktop default run uses openai-compatible and fails at config boundary instead of fake fallback", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-default-openai-"));
  let fetchCalls = 0;
  const providerFetch: PanelProviderFetch = async () => {
    fetchCalls += 1;
    throw new Error("provider fetch must not be called before desktop config is complete");
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "Start with the recommended real AI entry." },
    });
    const failed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "failed",
      4_000,
      "/api/desktop/runs"
    );

    assert.equal(start.status, 202);
    assert.equal(fetchCalls, 0);
    assert.equal(failed.body.tracking.provider.requestedMode, "openai-compatible");
    assert.equal(failed.body.error.code, "missing_api_key");
    assert.equal(failed.body.canvas, undefined);
    assert.equal(failed.body.summary.ai.eventCounts.requested, 0);
    assert.equal(failed.text.includes("fake_provider"), false);
    assert.equal(failed.text.includes('"status":"approved"'), false);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("desktop default ignores legacy fake setting and still recommends real AI boundary", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-legacy-fake-default-"));
  let fetchCalls = 0;
  const providerFetch: PanelProviderFetch = async () => {
    fetchCalls += 1;
    throw new Error("provider fetch must not be called before desktop config is complete");
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: { defaultAiMode: "fake" },
    });
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "Legacy fake settings should not become the Desktop product default." },
    });
    const failed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "failed",
      4_000,
      "/api/desktop/runs"
    );

    assert.equal(fetchCalls, 0);
    assert.equal(failed.body.tracking.provider.defaultAiMode, "fake");
    assert.equal(failed.body.tracking.provider.requestedMode, "openai-compatible");
    assert.equal(failed.text.includes("fake_provider"), false);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("desktop run accepts context refs, permission refs, and readonly previews in Task Soil canvas", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-context-refs-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: {
        goal: "Use explicit Task Soil refs.",
        aiMode: "fake",
        taskSoil: {
          contextRefs: [
            {
              ref: "file:src/app/panel-assets.ts",
              kind: "file",
              summary: "Panel source ref only.",
              readonlyPreview: {
                title: "panel-assets",
                text: "Short readonly preview from the user-selected file.",
              },
            },
            {
              ref: "https://example.test/spec",
              kind: "web",
              summary: "External spec URL ref.",
            },
          ],
          permissionBoundaryRefs: ["read:file:src/app/panel-assets.ts", "ask:before-write"],
        },
      },
    });
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );
    const refs = completed.body.canvas.taskSoil.contextRefs;
    const fileRef = refs.find((ref: { ref: string }) => ref.ref === "file:src/app/panel-assets.ts");

    assert.equal(completed.body.status, "completed");
    assert.equal(refs.some((ref: { kind: string }) => ref.kind === "user_goal"), true);
    assert.notEqual(fileRef, undefined);
    assert.equal(fileRef.readonlyPreview.text, "Short readonly preview from the user-selected file.");
    assert.equal(completed.body.canvas.taskSoil.permissionBoundaryRefs.includes("read:file:src/app/panel-assets.ts"), true);
    assert.equal(completed.body.canvas.taskSoil.permissionBoundaryRefs.includes("ask:before-write"), true);
    assertSafePanelJsonText(JSON.stringify(completed.body.canvas));
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("desktop canvas redacts Task Soil preview secret shapes", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-context-redaction-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: {
        goal: "Redact preview material.",
        aiMode: "fake",
        taskSoil: {
          contextRefs: [
            {
              ref: "file:notes/redaction.md",
              kind: "file",
              summary: "summary api_key=panel-api-value",
              readonlyPreview: {
                title: "token: title-token-value",
                text: "Authorization: Bearer preview-token-value and password=panel-password-value",
              },
            },
          ],
          permissionBoundaryRefs: ["read:file:notes/redaction.md"],
        },
      },
    });
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );
    const canvasText = JSON.stringify(completed.body.canvas);

    assert.equal(canvasText.includes("panel-api-value"), false);
    assert.equal(canvasText.includes("title-token-value"), false);
    assert.equal(canvasText.includes("preview-token-value"), false);
    assert.equal(canvasText.includes("panel-password-value"), false);
    assert.equal(canvasText.includes("[redacted-secret]"), true);
    assert.equal(canvasText.includes("[redacted-token]"), true);
    assertSafePanelJsonText(canvasText);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("desktop run rejects unauthorized context refs before creating a run job", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-invalid-context-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const rejected = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: {
        goal: "Try to pass runtime refs.",
        aiMode: "fake",
        contextRefs: [{ ref: "runtime:store/live", kind: "workspace" }],
      },
    });

    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.ok, false);
    assert.equal(rejected.body.error.code, "unauthorized_context_ref");
    assert.equal(rejected.text.includes('"status":"approved"'), false);
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

test("desktop real AI contract failure surfaces a useful safe diagnostic", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-contract-failure-"));
  const secret = "sk-desktop-contract-failure-secret";
  const providerFetch: PanelProviderFetch = async (_url, init) => {
    const body = JSON.parse(init.body) as { tools?: readonly { function?: { name?: string } }[] };
    return body.tools?.some((tool) => tool.function?.name === "start_work_session")
      ? createOpenAiStartWorkSessionToolCallResponse("desktop-contract-failure-model")
      : createInvalidOpenAiResponse("desktop-contract-failure-model");
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "desktop-contract-failure-model",
        apiKey: secret,
      },
    });
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "Use a real model path with invalid structured output.", aiMode: "openai-compatible" },
    });
    const failed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "failed",
      4_000,
      "/api/desktop/runs"
    );
    const failedCalls = failed.body.transcript.modelCalls.filter((call: { status: string }) => call.status === "failed");
    const failedCall = failedCalls.at(-1);

    assert.equal(failed.body.status, "failed");
    assert.equal(failed.body.error.code, "panel_internal_error");
    assert.equal(failed.body.error.message.includes("真实 AI 输出未通过契约校验"), true);
    assert.equal(failedCall?.failureKind, "output_validation");
    assert.equal(typeof failedCall?.outputContractId, "string");
    assert.equal(failed.body.error.message.includes(failedCall.outputContractId), true);
    assert.equal(failed.body.canvas, undefined);
    assert.equal(failed.text.includes(secret), false);
    assert.equal(failed.text.includes("bad raw output"), false);
    assert.equal(failed.text.includes("hidden_reasoning"), false);
    assertSafePanelJsonText(failed.text);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("desktop openai-compatible Work Session uses configured search tool before synthesis", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-configured-tools-"));
  const modelSecret = "sk-desktop-configured-tools-secret";
  const tavilySecret = "tvly-desktop-configured-tools-secret";
  let modelFetchCalls = 0;
  let tavilyFetchCalls = 0;
  const modelOutputs = [
    "__upgrade_tool_call__",
    "__search_tool_call__",
    {
      action: "use_tools",
      childSpecs: [],
      decisionSummary: "Use configured search evidence before delegation.",
      uncertainty: "Tool refs still require parent synthesis.",
      confidence: 0.72,
    },
    {
      action: "spawn_children",
      childSpecs: [
        {
          specId: "desktop-evidence-child",
          displayName: "Desktop Evidence Child",
          role: "desktop_evidence_child",
          objective: "Review Work Session evidence refs gathered by configured tools.",
          allowedTools: ["read"],
          inputRefs: ["research:web:desktop"],
        },
      ],
      decisionSummary: "Spawn child after tool-backed evidence.",
      uncertainty: "Stub uncertainty.",
      confidence: 0.74,
    },
    {
      summary: "Desktop child reviewed configured tool evidence.",
      findings: ["The desktop Work Session can use configured search before synthesis."],
      evidenceRefs: ["research:web:desktop"],
      uncertainty: "Stub child uncertainty.",
      confidence: 0.73,
    },
    {
      action: "synthesize",
      childSpecs: [],
      decisionSummary: "Synthesize child and tool material.",
      uncertainty: "Stub uncertainty.",
      confidence: 0.75,
    },
    {
      reportTitle: "Desktop tool-backed Work Session report",
      keyFindings: ["Configured search ran before parent synthesis."],
      recommendations: ["Keep tool outputs behind safe refs in canvas and transcript."],
      evidenceRefs: ["research:web:desktop", "tool-call:call-panel-search"],
      uncertainty: ["Tool output remains untrusted until parent synthesis."],
      nextActions: ["Run a real project-analysis smoke when provider env is configured."],
      decisionSummary: "Parent synthesis consumed child material and safe tool refs.",
      confidence: 0.76,
    },
    {
      action: "produce_artifact",
      childSpecs: [],
      decisionSummary: "Produce artifact after parent synthesis.",
      uncertainty: "Stub uncertainty.",
      confidence: 0.77,
    },
  ];
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
              title: "Desktop Work Session tool evidence",
              url: "https://example.test/desktop-work-session",
              content: "Desktop Work Session configured search evidence.",
            },
          ],
        }),
      };
    }

    const output = modelOutputs[modelFetchCalls];
    modelFetchCalls += 1;
    if (output === "__upgrade_tool_call__") {
      return createOpenAiStartWorkSessionToolCallResponse("desktop-configured-tools-model");
    }
    if (output === "__search_tool_call__") {
      return createOpenAiSearchToolCallResponse();
    }
    return createOpenAiJsonResponse("desktop-configured-tools-model", output);
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "desktop-configured-tools-model",
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

    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "Use configured tools in a Desktop Work Session.", aiMode: "openai-compatible" },
    });
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );

    assert.equal(completed.body.canvas.kind, "work_session_canvas");
    assert.equal(modelFetchCalls, modelOutputs.length);
    assert.equal(tavilyFetchCalls, 1);
    assert.equal(completed.body.canvas.workSession.steps[0].action, "use_tools");
    assert.equal(completed.body.canvas.workSession.toolCallRefs.includes("call-panel-search"), true);
    assert.equal(completed.body.trace.events.some((event: { type: string }) => event.type === "tool.completed"), true);
    assert.equal(JSON.stringify(completed.body).includes(modelSecret), false);
    assert.equal(JSON.stringify(completed.body).includes(tavilySecret), false);
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
    assert.equal(failedCall?.failureKind, "output_validation");
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

function createOpenAiStartWorkSessionToolCallResponse(model = "desktop-chat-router-model"): Awaited<ReturnType<PanelProviderFetch>> {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      model,
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call-start-work-session",
                type: "function",
                function: {
                  name: "start_work_session",
                  arguments: JSON.stringify({
                    reason: "这条任务需要进入工作会话。",
                    goal: "Use configured tools in a Desktop Work Session.",
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

function createOpenAiJsonResponse(model: string, output: unknown): Awaited<ReturnType<PanelProviderFetch>> {
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
            content: JSON.stringify(output),
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

function createOpenAiTextResponse(model: string, text: string): Awaited<ReturnType<PanelProviderFetch>> {
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
            content: text,
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
  assert.equal(/\bBearer\s+[A-Za-z0-9._~+/=-]+/i.test(text), false);
  assert.equal(/\bAuthorization\s*[:=]\s*(?:Bearer\s+)?[A-Za-z0-9._~+/=-]+/i.test(text), false);
  assert.equal(/\b(?:api[_ -]?key|apikey)\s*[:=]\s*[^;\s"'}\]]+/i.test(text), false);
  assert.equal(/\btoken\s*[:=]\s*[^;\s"'}\]]+/i.test(text), false);
  assert.equal(lower.includes("system prompt"), false);
  assert.equal(text.includes("完整 prompt"), false);
  assert.equal(text.includes("sanitizedMessages"), false);
  assert.equal(text.includes("Return JSON only"), false);
  assert.equal(lower.includes("provider raw response"), false);
  assert.equal(lower.includes("hidden reasoning"), false);
}
