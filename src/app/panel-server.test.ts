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

  assert.equal(html.includes("AgentArbor 地下运行面板"), true);
  assert.equal(html.includes("运行输入"), true);
  assert.equal(html.includes("运行总览"), true);
  assert.equal(html.includes("工作流阶段时间线"), true);
  assert.equal(html.includes("Rootlet 工作区"), true);
  assert.equal(html.includes("模型调用追踪"), true);
  assert.equal(html.includes("收束解释"), true);
  assert.equal(html.includes("方向包结果"), true);
  assert.equal(html.includes("启动地下运行"), true);
  assert.equal(html.includes("配置中心"), true);
  assert.equal(html.includes("待启动 (pending)"), true);
  assert.equal(html.includes("正在等待地下运行返回；当前版本为单请求模式，完成后刷新完整事件。"), true);
  assert.equal(html.includes("调试视图：Observation Snapshot"), true);
  assert.equal(html.includes("Run Underground"), false);
  assert.equal(html.includes("Save Config"), false);
  assert.equal(html.includes("key configured"), false);
});

test("panel config API returns sanitized provider config and never echoes raw API key", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-config-"));
  const secret = "sk-panel-secret";
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
    const config = await requestJson(server.url, "/api/config");
    const settingsRaw = await fs.readFile(new FileSystemNormalSettingsStore(directory).settingsPath, "utf8");

    assert.equal(update.status, 200);
    assert.equal(config.status, 200);
    assert.equal(update.text.includes(secret), false);
    assert.equal(config.text.includes(secret), false);
    assert.equal(settingsRaw.includes(secret), false);
    assert.equal(update.body.config.secretConfigured, true);
    assert.equal(update.body.config.baseUrl, "https://provider.example");
    assert.equal(update.body.config.defaultAiMode, "fake");
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("panel can run no-AI underground session without writing a package path or leaking secrets", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-noai-"));
  const secret = "sk-noai-secret";
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

    assert.equal(run.status, 200);
    assert.equal(run.text.includes(secret), false);
    assert.equal(run.body.summary.ai.enabled, false);
    assert.equal(run.body.summary.ai.eventCounts.requested, 0);
    assert.equal(run.body.summary.writtenPackagePath, undefined);
    assert.equal(run.body.summary.eventLog.includes("growth_plan.completed"), false);
    assert.equal(run.body.observation.aboveground.status, "not_started");
    assert.equal(run.body.observation.events.some((event: { type: string }) => event.type === "model.requested"), false);
    assert.equal(run.body.tracking.run.phase, "handoff");
    assert.equal(run.body.tracking.run.stage, "direction_handoff_completed");
    assert.equal(run.body.tracking.run.abovegroundStatus, "not_started");
    assert.equal(run.body.tracking.provider.status, "network_disabled");
    assert.equal(run.body.tracking.modelTotals.requested, 0);
    assert.equal(run.body.tracking.candidates.byKind.option.total > 0, true);
    assert.equal(run.body.tracking.package.validationPassed, true);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("panel fake AI run exposes model and candidate summaries without model prompt content", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-fake-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
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
    assert.equal(run.body.tracking.provider.status, "fake_provider");
    assert.equal(run.body.tracking.modelTotals.requested > 0, true);
    assert.equal(run.body.tracking.rootletsByKind.option.model.completed > 0, true);
    assert.equal(run.body.tracking.aiCandidates.total > 0, true);
    assert.equal(run.body.tracking.convergence.outcome === "approved" || run.body.tracking.convergence.outcome === "awaiting_user", true);
    assert.equal(run.text.includes("sanitizedMessages"), false);
    assert.equal(run.text.includes("API key"), false);
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
