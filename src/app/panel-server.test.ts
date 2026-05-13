import assert from "node:assert/strict";
import { request } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileSystemNormalSettingsStore } from "../adapters/config/index.js";
import {
  FileSystemRuntimeDatabase,
  resolveAgentArborRuntimeDatabasePaths,
} from "../adapters/runtime-database/index.js";
import { createPanelHtml } from "./panel-assets.js";
import { startLocalPanelServer, type PanelProviderFetch } from "./panel-server.js";

test("panel HTML serves the React workbench shell without first-screen internals", () => {
  const staticHtml = createPanelHtml();
  const firstScreenHtml = staticHtml.slice(
    staticHtml.indexOf("<!-- ordinary-screen-start -->"),
    staticHtml.indexOf("<!-- ordinary-screen-end -->")
  );

  assert.match(staticHtml, /<script type="module"[^>]+src="\/assets\/[^"]+\.js"/);
  assert.match(staticHtml, /<link rel="stylesheet"[^>]+href="\/assets\/[^"]+\.css"/);
  assert.equal(staticHtml.includes('<div id="root">'), true);
  assert.equal(firstScreenHtml.includes("新对话"), true);
  assert.equal(firstScreenHtml.includes("在忙什么呢？"), true);
  assert.equal(firstScreenHtml.includes("技能"), true);
  assert.equal(firstScreenHtml.includes("工具"), true);
  assert.equal(firstScreenHtml.includes("设置"), true);
  assert.equal(firstScreenHtml.includes("问任何问题，或交给我一个任务"), true);
  assertFirstScreenHasNoInternalTerms(firstScreenHtml);
});

test("panel React source is split into typed frontend modules", async () => {
  const [entry, app, api, types, text, settings] = await Promise.all([
    readPanelUiSource("main.tsx"),
    readPanelUiSource("App.tsx"),
    readPanelUiSource("api.ts"),
    readPanelUiSource("types.ts"),
    readPanelUiSource("text.ts"),
    readPanelUiSource(path.join("components", "settings-panel.tsx")),
  ]);

  assert.equal(entry.includes('import { App } from "./App"'), true);
  assert.equal(app.includes('import { getJson, postJson } from "./api"'), true);
  assert.equal(app.includes('from "./components/sidebar"'), true);
  assert.equal(app.includes('from "./components/settings-panel"'), true);
  assert.equal(app.includes('from "./ui-state"'), true);
  assert.equal(api.includes("export async function requestJson"), true);
  assert.equal(types.includes("export type BasicAgentRun"), true);
  assert.equal(text.includes("export const STATUS_LABELS"), true);
  assert.equal(settings.includes("function ToolCatalog"), true);
});

test("panel React workbench consumes Basic Agent projection APIs", async () => {
  const [app, runtime] = await Promise.all([readPanelUiSource("App.tsx"), readPanelUiSource("runtime.ts")]);

  assert.equal(app.includes("/api/basic-agent/runs/"), true);
  assert.equal(app.includes("/events?cursor="), true);
  assert.equal(runtime.includes("/work-session"), true);
  assert.equal(app.includes("/api/context/attachments/preview"), true);
  assert.equal(app.includes("/cancel"), true);
  assert.equal(app.includes("/confirmations/"), true);
  assert.equal(app.includes("typedToolDisplays"), true);
  assert.equal(runtime.includes("safeWorkSession"), true);
  assert.equal(runtime.includes("/api/desktop/runs/"), true);
  assert.equal(app.includes("innerHTML"), false);
  assert.equal(app.includes("raw provider"), false);
  assert.equal(app.includes("raw tool"), false);
  assert.equal(app.includes("stdout/stderr"), false);
});

test("panel server serves Vite React frontend assets", async () => {
  const server = await startLocalPanelServer({ port: 0 });
  try {
    const html = await requestText(server.url, "/");
    const assetPaths = extractPanelAssetPaths(html.text);
    const cssPath = assetPaths.find((assetPath) => assetPath.endsWith(".css"));
    const jsPath = assetPaths.find((assetPath) => assetPath.endsWith(".js"));

    assert.equal(html.status, 200);
    assert.notEqual(cssPath, undefined);
    assert.notEqual(jsPath, undefined);

    const css = await requestText(server.url, cssPath!);
    const js = await requestText(server.url, jsPath!);

    assert.equal(css.status, 200);
    assert.equal(js.status, 200);
    assert.match(String(css.headers["content-type"]), /text\/css/);
    assert.match(String(js.headers["content-type"]), /text\/javascript/);
    assert.equal(html.text.includes("ordinary-screen-start"), true);
    assert.equal(css.text.includes(".app-shell"), true);
    assert.equal(js.text.includes("/api/basic-agent/runs/"), true);
    assert.equal((await requestText(server.url, "/assets/%2e%2e/index.html")).status, 404);
  } finally {
    await server.close();
  }
});

test("panel config API keeps model provider and search keys out of ordinary responses", async () => {
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
    assert.equal(config.body.config.apiKey, undefined);
    assert.equal(config.text.includes(tavilySecret), false);
    assert.equal(settingsRaw.includes(secret), false);
    assert.equal(settingsRaw.includes(tavilySecret), false);
    assert.equal(update.body.config.secretConfigured, true);
    assert.equal(informationUpdate.body.informationAccess.web.secretConfigured, true);
    assert.equal(informationUpdate.body.informationAccess.web.maxResults, 2);
    assert.equal(config.body.informationAccess.web.secretConfigured, true);
    assert.equal(config.body.capabilities.activeModel.secretConfigured, true);
    assert.equal(config.body.profiles.length, 1);
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
    assert.equal(initial.body.tools.catalog.scope, "desktop-basic");
    assert.equal(
      initial.body.tools.catalog.tools.some((tool: { name?: string; availability?: string }) => tool.name === "browser_snapshot" && (tool.availability === "available" || tool.availability === "unavailable")),
      true
    );
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

test("panel capability and profile APIs expose safe unified capability projections", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-capabilities-"));
  const secret = "sk-panel-capability-secret";
  try {
    const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
    try {
      const createProfile = await requestJson(server.url, "/api/config/model-profiles", {
        method: "POST",
        body: {
          profileId: "custom",
          label: "Custom",
          providerKind: "openai_compatible",
          protocolKind: "openai_compatible_chat_completions",
          baseUrl: "https://provider.example/v1",
          model: "unknown-model",
          defaultAiMode: "openai-compatible",
          apiKey: secret,
        },
      });
      const activate = await requestJson(server.url, "/api/config/model-profiles/custom/activate", { method: "POST" });
      const capabilities = await requestJson(server.url, "/api/config/capabilities");
      const deleteActive = await requestJson(server.url, "/api/config/model-profiles/custom", { method: "DELETE" });

      assert.equal(createProfile.status, 200);
      assert.equal(activate.status, 200);
      assert.equal(capabilities.status, 200);
      assert.equal(capabilities.body.capabilities.activeModel.profileId, "custom");
      assert.equal(capabilities.body.capabilities.modelCapabilities.contextWindowTokens, 16_000);
      assert.equal(capabilities.body.capabilities.modelCapabilities.supportsToolCalling, false);
      assert.equal(Array.isArray(capabilities.body.capabilities.toolCatalog.allowedTools), true);
      assert.equal(capabilities.text.includes(secret), false);
      assert.equal(deleteActive.status, 400);
      assert.equal(deleteActive.body.error.code, "invalid_config");
    } finally {
      await server.close();
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("panel tool state and MCP config APIs return catalogs without raw MCP secret payloads", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-mcp-tools-"));
  try {
    const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
    try {
      const toolState = await requestJson(server.url, "/api/config/tools/shell_command/state", {
        method: "POST",
        body: { enabled: false },
      });
      const mcp = await requestJson(server.url, "/api/config/mcp", {
        method: "POST",
        body: {
          serverId: "docs",
          label: "Docs",
          transport: "stdio",
          command: "node",
          args: ["server.js", "--token=secret-mcp-value"],
          envSecretRefs: ["secret://local-dev/mcp/docs/token"],
          enabled: true,
        },
      });
      const mcpList = await requestJson(server.url, "/api/config/mcp");

      assert.equal(toolState.status, 200);
      assert.equal(toolState.body.tools.catalog.allowedTools.includes("shell_command"), false);
      assert.equal(mcp.status, 200);
      assert.equal(mcp.body.catalog[0].serverId, "docs");
      assert.equal(mcp.body.catalog[0].envSecretRefCount, 1);
      assert.equal(mcp.text.includes("secret-mcp-value"), false);
      assert.equal(mcpList.text.includes("secret-mcp-value"), false);
      assert.equal(mcpList.body.catalog[0].availability, "configured");
    } finally {
      await server.close();
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("panel workspace config route stores and returns the workspace directory", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-workspace-config-"));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-workspace-root-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const initial = await requestJson(server.url, "/api/config");
    const update = await requestJson(server.url, "/api/config/workspace", {
      method: "POST",
      body: { workspaceDirectory: workspace },
    });
    const after = await requestJson(server.url, "/api/config");
    const created = await requestJson(server.url, "/api/config/workspace", {
      method: "POST",
      body: { workspaceDirectory: path.join(workspace, "created", "child") },
    });

    assert.equal(initial.status, 200);
    assert.equal(typeof initial.body.workspace.workspaceDirectory, "string");
    assert.equal(update.status, 200);
    assert.equal(update.body.workspace.workspaceDirectory, path.resolve(workspace));
    assert.equal(after.body.workspace.workspaceDirectory, path.resolve(workspace));
    assert.equal(created.status, 200);
    assert.equal(created.body.workspace.workspaceDirectory, path.resolve(workspace, "created", "child"));
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("panel workspace picker route handles success cancellation and unavailable desktop picker", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-workspace-picker-"));
  const cancelDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-workspace-picker-cancel-"));
  const browserDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-workspace-picker-browser-"));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-picked-workspace-"));
  const server = await startLocalPanelServer({
    port: 0,
    configDirectory: directory,
    workspaceDirectoryPicker: async () => workspace,
  });
  const cancelServer = await startLocalPanelServer({
    port: 0,
    configDirectory: cancelDirectory,
    workspaceDirectoryPicker: async () => undefined,
  });
  const browserServer = await startLocalPanelServer({
    port: 0,
    configDirectory: browserDirectory,
  });
  try {
    const selected = await requestJson(server.url, "/api/config/workspace/select-directory", { method: "POST" });
    const cancelled = await requestJson(cancelServer.url, "/api/config/workspace/select-directory", { method: "POST" });
    const unavailable = await requestJson(browserServer.url, "/api/config/workspace/select-directory", { method: "POST" });

    assert.equal(selected.status, 200);
    assert.equal(selected.body.status, "completed");
    assert.equal(selected.body.workspace.workspaceDirectory, path.resolve(workspace));
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.status, "cancelled");
    assert.equal(typeof cancelled.body.workspace.workspaceDirectory, "string");
    assert.equal(unavailable.status, 501);
    assert.equal(unavailable.body.error.code, "workspace_picker_unavailable");
    assert.equal(unavailable.body.error.message.includes("手动输入工作文件夹路径"), true);
  } finally {
    await server.close();
    await cancelServer.close();
    await browserServer.close();
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rm(cancelDirectory, { recursive: true, force: true });
    await fs.rm(browserDirectory, { recursive: true, force: true });
    await fs.rm(workspace, { recursive: true, force: true });
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

test("desktop explicit deep mode runs Underground organization and stops at Plan boundary", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-fake-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "Build a Desktop Shell visible deep mode direction.", aiMode: "fake", runMode: "deep" },
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
    assert.equal(start.body.runMode, "deep");
    assert.equal(start.body.route, undefined);
    assert.equal(completed.body.runKind, "desktop");
    assert.equal(completed.body.runMode, "deep");
    assert.equal(completed.body.route, undefined);
    assert.equal(
      completed.body.transcript.events.some((event: { type: string; summary?: string }) =>
        event.type === "run.started" && String(event.summary ?? "").includes("深度模式")
      ),
      true
    );
    assert.equal(completed.body.canvas.kind, "underground_deep_canvas");
    assert.equal(completed.body.canvas.task.goalSummary.includes("Desktop Shell visible deep mode direction"), true);
    assert.equal(completed.body.canvas.underground.status, "approved_package_created");
    assert.equal(completed.body.canvas.underground.packageRef.validationPassed, true);
    assert.equal(completed.body.canvas.underground.recommendedDirection.summary.length > 0, true);
    assert.equal(completed.body.canvas.underground.recommendedDirection.reason.includes("地下组织"), true);
    assert.equal(completed.body.canvas.underground.keyEvidenceRefs.length > 0, true);
    assert.equal(completed.body.canvas.underground.childRunCount > 0, true);
    assert.equal(completed.body.canvas.underground.parentSynthesisCount > 0, true);
    assert.equal(
      completed.body.transcript.events.some((event: { summary?: string }) =>
        String(event.summary ?? "").includes("深度模式")
      ),
      true
    );
    assert.equal(JSON.stringify(completed.body.canvas).includes("Fake parent synthesis"), false);
    assert.equal(JSON.stringify(completed.body.canvas).includes("Fake Work Session"), false);
    assert.equal(completed.body.tracking.run.abovegroundStatus, "not_started");
    assert.notEqual(completed.body.tracking.package, undefined);
    assert.equal(completed.body.tracking.agentRunTree.childRuns.length > 0, true);
    assert.equal(completed.body.tracking.agentRunTree.parentSyntheses.length > 0, true);
    assert.equal(completed.body.trace.events.some((event: { type: string }) => event.type === "direction_handoff.completed"), true);
    assert.equal(completed.body.trace.events.some((event: { type: string }) => event.type === "underground.exploration_planned"), true);
    assert.equal(completed.body.trace.events.some((event: { type: string }) => event.type === "artifact.produced"), false);
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
    assert.equal(start.body.route, undefined);
    assert.equal(completed.body.canvas.kind, "desktop_agent_canvas");
    assert.equal(completed.body.runMode, "agent");
    assert.equal(completed.body.route, undefined);
    assert.equal(completed.body.canvas.agent.answer.answer.includes("AgentArbor 桌面 Root Agent"), true);
    assert.equal(completed.body.canvas.agent.pendingConfirmation, undefined);
    assert.equal(completed.body.tracking.agentRunTree, undefined);
    const eventTypes = completed.body.transcript.events.map((event: { type: string }) => event.type);
    assert.equal(eventTypes[0], "run.started");
    assert.equal(eventTypes.at(-1), "final.result");
    assert.equal(eventTypes.filter((type: string) => type === "model.output.delta").length >= 1, true);
    assert.equal(completed.body.transcript.modelCalls.length, 1);
    assert.equal(completed.body.trace.events.some((event: { type: string }) => event.type === "artifact.produced"), false);
    assert.equal(completed.body.transcript.events.some((event: { summary?: string }) => String(event.summary ?? "").includes("项目分析")), false);
    assertSafePanelJsonText(completed.text);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("desktop default fake run does not auto-upgrade complex requests into deep mode", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-default-agent-mode-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "分析当前仓库的问题并给我优化建议", aiMode: "fake" },
    });
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );
    const runtimeRun = await waitForRun(
      server.url,
      start.body.runId,
      (body) =>
        body.status === "completed" &&
        Array.isArray(body.snapshot?.toolCalls) &&
        body.snapshot.toolCalls.some((call: { callId: string }) => call.callId === "call-desktop-agent-search"),
      4_000,
      "/api/runtime/runs"
    );

    assert.equal(completed.body.runMode, "agent");
    assert.equal(completed.body.canvas.kind, "desktop_agent_canvas");
    assert.equal(completed.body.canvas.agent.answer.answer.includes("授权工具检查"), true);
    assert.equal(completed.body.canvas.agent.answer.answer.includes("深度模式"), false);
    assert.equal(completed.body.canvas.agent.toolCallRefs.includes("call-desktop-agent-search"), true);
    assert.equal(completed.body.tracking.agentRunTree, undefined);
    assert.equal(completed.body.trace.events.some((event: { type: string }) => event.type === "agent.delegation.planned"), false);
    assert.equal(completed.body.trace.events.some((event: { type: string }) => event.type === "artifact.produced"), false);
    assert.equal(completed.body.trace.events.some((event: { type: string }) => event.type === "tool.completed"), true);
    assert.equal(completed.body.route, undefined);
    assert.equal(completed.body.transcript.modelCalls.length, 2);
    assert.equal(
      runtimeRun.body.snapshot.toolCalls.some((call: { callId: string }) => call.callId === "call-desktop-agent-search"),
      true
    );
    assertSafePanelJsonText(runtimeRun.text);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("desktop run stream carries safe tool detail through runtime persistence", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-tool-detail-"));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-tool-detail-workspace-"));
  const secret = "sk-tool-detail-secret";
  const rawToolOutput = "RAW_TOOL_OUTPUT_SENTINEL must not reach panel stream or runtime persistence.";
  await fs.writeFile(path.join(workspace, "notes.md"), rawToolOutput, "utf8");
  let providerCalls = 0;
  const providerFetch: PanelProviderFetch = async () => {
    providerCalls += 1;
    return providerCalls === 1
      ? createOpenAiReadFileToolCallResponse("notes.md")
      : createOpenAiTextResponse("desktop-tool-detail-model", "已读取授权文件并形成摘要。");
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "gpt-4o-mini",
        apiKey: secret,
      },
    });
    await requestJson(server.url, "/api/config/workspace", {
      method: "POST",
      body: { workspaceDirectory: workspace },
    });
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "读取 notes.md 并总结", aiMode: "openai-compatible" },
    });
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );
    const runtimeRun = await waitForRun(
      server.url,
      start.body.runId,
      (body) =>
        Array.isArray(body.snapshot?.toolCalls) &&
        body.snapshot.toolCalls.some((call: { toolName?: string }) => call.toolName === "read_file"),
      4_000,
      "/api/runtime/runs"
    );
    const readEvent = completed.body.transcript.events.find(
      (event: { type: string; toolName?: string }) => event.type === "tool.completed" && event.toolName === "read_file"
    );
    const persistedCall = runtimeRun.body.snapshot.toolCalls.find(
      (call: { toolName?: string }) => call.toolName === "read_file"
    );

    assert.notEqual(readEvent, undefined);
    assert.notEqual(persistedCall, undefined);
    assert.equal(readEvent.detail?.kind, "tool");
    assert.equal(readEvent.detail?.path, "notes.md");
    assert.equal(readEvent.detail?.display?.kind, "generic_tool_summary");
    assert.equal(typeof readEvent.detail?.preview, "string");
    assert.equal((readEvent.detail?.preview ?? "").length > 0, true);
    assert.equal(readEvent.detail?.preview?.includes("notes.md"), true);
    assert.equal(readEvent.detail?.preview?.includes("文件正文只进入本轮工具上下文"), true);
    assert.equal(readEvent.detail?.preview?.includes(rawToolOutput), false);
    assert.equal(persistedCall.path, "notes.md");
    assert.equal(persistedCall.display?.kind, "generic_tool_summary");
    assert.equal(typeof persistedCall.preview, "string");
    assert.equal((persistedCall.preview ?? "").length > 0, true);
    assert.equal(persistedCall.preview.includes("notes.md"), true);
    assert.equal(persistedCall.preview.includes("文件正文只进入本轮工具上下文"), true);
    assert.equal(persistedCall.preview.includes(rawToolOutput), false);
    assert.equal(JSON.stringify(readEvent).includes("raw provider payload"), false);
    assert.equal(completed.text.includes(rawToolOutput), false);
    assert.equal(runtimeRun.text.includes(rawToolOutput), false);
    const basicEvents = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(start.body.runId)}/events?cursor=0`
    );
    assert.equal(
      basicEvents.body.events.some((event: { type: string; summary?: string }) =>
        event.type === "tool.completed" && (event.summary ?? "").includes("notes.md")
      ),
      true
    );
    assert.equal(JSON.stringify(basicEvents.body.events).includes(rawToolOutput), false);
    assertSafePanelJsonText(completed.text);
    assertSafePanelJsonText(runtimeRun.text);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rm(workspace, { recursive: true, force: true });
  }
});


test("panel stream ends completed runs with final result and no run failed event", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-completed-stream-terminal-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "你好，你能做什么？", aiMode: "fake" },
    });
    const stream = await requestSse(server.url, `/api/desktop/runs/${encodeURIComponent(start.body.runId)}/stream?cursor=0`);
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );
    const eventTypes = stream.events.map((event) => event.type);

    assert.equal(completed.body.status, "completed");
    assert.equal(eventTypes.at(-1), "final.result");
    assert.equal(eventTypes.includes("run.failed"), false);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("desktop async fake run answers capability questions without upgrading into project analysis", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-capability-answer-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "你好，你能做什么？", aiMode: "fake" },
    });
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );

    assert.equal(start.status, 202);
    assert.equal(completed.body.canvas.kind, "desktop_agent_canvas");
    assert.equal(completed.body.canvas.agent.answer.answer.includes("我可以直接回答问题"), true);
    assert.equal(completed.body.canvas.agent.pendingConfirmation, undefined);
    assert.equal(completed.body.tracking.agentRunTree, undefined);
    assert.equal(completed.text.includes("AgentArbor 项目分析与下一步优化报告"), false);
    assert.equal(completed.text.includes("项目分析报告"), false);
    assert.equal(completed.body.trace.events.some((event: { type: string }) => event.type === "artifact.produced"), false);
    assertSafePanelJsonText(completed.text);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("desktop async fake run keeps efficiency tips request in direct-answer path", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-efficiency-answer-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "请给我三条今天提高效率的建议", aiMode: "fake" },
    });
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );

    assert.equal(start.status, 202);
    assert.equal(completed.body.canvas.kind, "desktop_agent_canvas");
    assert.equal(completed.body.canvas.agent.answer.answer.includes("效率建议"), true);
    assert.equal(completed.body.canvas.agent.pendingConfirmation, undefined);
    assert.equal(completed.body.tracking.agentRunTree, undefined);
    assert.equal(completed.body.trace.events.some((event: { type: string }) => event.type === "artifact.produced"), false);
    assertSafePanelJsonText(completed.text);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("conversation API creates a conversation and attaches the desktop run to assistant turn", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-create-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const start = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "你好，你能做什么？", aiMode: "fake" },
    });
    const runId = start.body.run.runId;
    const conversationId = start.body.conversation.conversationId;
    const completed = await waitForRun(
      server.url,
      runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );
    const conversation = await requestJson(server.url, `/api/conversations/${encodeURIComponent(conversationId)}`);

    assert.equal(start.status, 202);
    assert.equal(start.body.conversation.turns.length, 2);
    assert.equal(start.body.conversation.turns[0].role, "user");
    assert.equal(start.body.conversation.turns[1].role, "assistant");
    assert.equal(start.body.run.runKind, "desktop");
    assert.equal(completed.body.conversation.conversationId, conversationId);
    assert.equal(conversation.body.conversation.turns.length, 2);
    assert.equal(conversation.body.conversation.turns[1].runId, runId);
    assert.equal(conversation.body.conversation.turns[1].content.includes("我可以直接回答问题"), true);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("context attachment preview feeds the Basic Agent work session read model safely", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-context-work-session-"));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-context-workspace-"));
  const fileBody = "private body with sk-work-session-secret";
  await fs.writeFile(path.join(workspace, "notes.md"), fileBody, "utf8");
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    await requestJson(server.url, "/api/config/workspace", {
      method: "POST",
      body: { workspaceDirectory: workspace },
    });
    const preview = await requestJson(server.url, "/api/context/attachments/preview", {
      method: "POST",
      body: { kind: "file", value: "notes.md" },
    });
    const invalidKind = await requestJson(server.url, "/api/context/attachments/preview", {
      method: "POST",
      body: { kind: "runtime", value: "notes.md" },
    });
    const start = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: {
        goal: "请基于附件做一个简短总结",
        aiMode: "fake",
        taskSoilInput: {
          contextRefs: [{
            ref: preview.body.attachment.ref,
            kind: preview.body.attachment.kind,
            summary: preview.body.attachment.summary,
          }],
          permissionBoundaryRefs: preview.body.attachment.permissionRefs,
        },
      },
    });
    const runId = start.body.run.runId;
    await waitForRun(server.url, runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    const workSession = await requestJson(server.url, `/api/basic-agent/runs/${encodeURIComponent(runId)}/work-session`);

    assert.equal(preview.status, 200);
    assert.equal(preview.body.attachment.ref, "file:notes.md");
    assert.equal(preview.text.includes(fileBody), false);
    assert.equal(invalidKind.status, 400);
    assert.equal(invalidKind.body.error.code, "invalid_context_attachment_kind");
    assert.equal(workSession.status, 200);
    assert.equal(workSession.body.workSession.stage, "completed");
    assert.equal(workSession.body.workSession.contextAttachments.some((item: { ref?: string }) => item.ref === "file:notes.md"), true);
    assert.equal(typeof workSession.body.workSession.deliverable?.summary, "string");
    assert.equal(workSession.text.includes(fileBody), false);
    assertSafePanelJsonText(workSession.text);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("conversation summaries do not turn missing local context into synthetic confirmation", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-confirmation-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const start = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "帮我看看桌面文件", aiMode: "fake" },
    });
    const runId = start.body.run.runId;
    const conversationId = start.body.conversation.conversationId;
    await waitForRun(server.url, runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    const conversations = await requestJson(server.url, "/api/conversations");
    const conversation = await requestJson(server.url, `/api/conversations/${encodeURIComponent(conversationId)}`);
    const runtimeRun = await requestJson(server.url, `/api/runtime/runs/${encodeURIComponent(runId)}`);
    const summary = conversations.body.conversations.find(
      (item: { conversationId: string }) => item.conversationId === conversationId
    );

    assert.equal(conversation.body.conversation.requiresUserAction, false);
    assert.equal(summary?.requiresUserAction, false);
    assert.equal(conversation.body.conversation.turns[1].title, "已完成");
    assert.equal(conversation.body.conversation.turns[1].content.includes("文件或文件夹"), true);
    assert.deepEqual(runtimeRun.body.snapshot.confirmations, []);
    assert.equal(JSON.stringify(runtimeRun.body.snapshot.confirmations).includes("sk-"), false);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("panel skills route returns real discovered SKILL metadata only", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-skills-"));
  const skillRoot = path.join(directory, "skills");
  const skillDir = path.join(skillRoot, "safe-skill");
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, "SKILL.md"),
    "---\nname: Safe Skill\ndescription: Helps with safe summaries.\ntriggers: [summary]\n---\n\n# Safe Skill\n\nBODY_SENTINEL",
    "utf8"
  );
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, skillRoots: [skillRoot] });
  try {
    const response = await requestJson(server.url, "/api/skills");

    assert.equal(response.status, 200);
    assert.equal(response.body.skills.length, 1);
    assert.equal(response.body.skills[0].name, "Safe Skill");
    assert.deepEqual(response.body.skills[0].triggers, ["summary"]);
    assert.equal(JSON.stringify(response.body.skills).includes("BODY_SENTINEL"), false);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("conversation API keeps follow-up messages in the same conversation", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-follow-up-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const first = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "你好，你能做什么？", aiMode: "fake" },
    });
    await waitForRun(server.url, first.body.run.runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");

    const second = await requestJson(
      server.url,
      `/api/conversations/${encodeURIComponent(first.body.conversation.conversationId)}/messages`,
      {
        method: "POST",
        body: { goal: "那你能继续解释一下吗？", aiMode: "fake" },
      }
    );
    await waitForRun(server.url, second.body.run.runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    const conversation = await requestJson(
      server.url,
      `/api/conversations/${encodeURIComponent(first.body.conversation.conversationId)}`
    );

    assert.equal(second.status, 202);
    assert.equal(second.body.conversation.conversationId, first.body.conversation.conversationId);
    assert.equal(conversation.body.conversation.turns.length, 4);
    assert.equal(conversation.body.conversation.turns[2].role, "user");
    assert.equal(conversation.body.conversation.turns[2].content.includes("继续解释"), true);
    assert.equal(conversation.body.conversation.turns[3].role, "assistant");
    assert.equal(conversation.body.conversation.turns[3].content.includes("继续"), true);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("conversation API sends follow-up history as role-separated model messages", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-structured-history-"));
  const secret = "sk-conversation-structured-history-secret";
  const requests: Array<{ messages?: readonly { role?: string; content?: string }[]; max_tokens?: number }> = [];
  let callIndex = 0;
  const providerFetch: PanelProviderFetch = async (_url, init) => {
    callIndex += 1;
    const body = JSON.parse(init.body) as { messages?: readonly { role?: string; content?: string }[]; max_tokens?: number };
    requests.push(body);
    return createOpenAiTextResponse(
      "conversation-structured-history-model",
      callIndex === 1
        ? "我可以直接回答问题，也可以在授权范围内读取文件或网页。"
        : "可以继续。我会按前文说明继续回答，不把这轮追问包装成深度模式。"
    );
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "conversation-structured-history-model",
        apiKey: secret,
      },
    });
    const first = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "你好，你能做什么？", aiMode: "openai-compatible" },
    });
    await waitForRun(server.url, first.body.run.runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");

    const second = await requestJson(
      server.url,
      `/api/conversations/${encodeURIComponent(first.body.conversation.conversationId)}/messages`,
      {
        method: "POST",
        body: { goal: "那你能继续解释一下吗？", aiMode: "openai-compatible" },
      }
    );
    await waitForRun(server.url, second.body.run.runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");

    const secondMessages = requests.at(-1)?.messages ?? [];
    assert.deepEqual(secondMessages.map((message) => message.role), ["system", "user", "assistant", "user"]);
    assert.equal(secondMessages[1]?.content?.includes("你好，你能做什么"), true);
    assert.equal(secondMessages[2]?.content?.includes("我可以直接回答问题"), true);
    assert.equal(secondMessages[3]?.content?.includes("Current user message: 那你能继续解释一下吗？"), true);
    assert.equal(secondMessages[3]?.content?.includes("你好，你能做什么"), false);
    assert.equal(JSON.stringify(secondMessages).includes("workspace:conversation-history"), false);
    assert.equal(requests.at(-1)?.max_tokens, 4000);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("conversation API exposes latest desktop run so completed result can be restored on reopen", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-latest-run-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const started = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "分析当前仓库的问题并给我优化建议", aiMode: "fake", runMode: "deep" },
    });
    const conversationId = started.body.conversation.conversationId;
    const runId = started.body.run.runId;
    const completed = await waitForRun(server.url, runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    const conversation = await requestJson(
      server.url,
      `/api/conversations/${encodeURIComponent(conversationId)}`
    );
    const latestRun = await requestJson(
      server.url,
      `/api/desktop/runs/${encodeURIComponent(conversation.body.conversation.latestRunId)}`
    );

    assert.equal(conversation.status, 200);
    assert.equal(conversation.body.conversation.latestRunId, runId);
    assert.equal(conversation.body.conversation.activeRunId, undefined);
    assert.equal(latestRun.status, 200);
    assert.equal(latestRun.body.runId, runId);
    assert.equal(latestRun.body.runMode, "deep");
    assert.equal(latestRun.body.canvas.kind, "underground_deep_canvas");
    assert.equal(typeof latestRun.body.canvas.underground.recommendedDirection.summary, "string");
    assert.equal(latestRun.body.canvas.underground.recommendedDirection.summary.length > 0, true);
    assert.equal(completed.body.canvas.kind, "underground_deep_canvas");
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("conversation and desktop run APIs recover safe history from RuntimeDatabase after restart", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-runtime-recover-"));
  let server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const started = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "你好，你能做什么？", aiMode: "fake" },
    });
    const conversationId = started.body.conversation.conversationId;
    const runId = started.body.run.runId;
    await waitForRun(server.url, runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    await server.close();

    server = await startLocalPanelServer({ port: 0, configDirectory: directory });
    const conversations = await requestJson(server.url, "/api/conversations");
    const conversation = await requestJson(server.url, `/api/conversations/${encodeURIComponent(conversationId)}`);
    const run = await requestJson(server.url, `/api/desktop/runs/${encodeURIComponent(runId)}`);
    const runtimeRun = await requestJson(server.url, `/api/runtime/runs/${encodeURIComponent(runId)}`);

    assert.equal(conversations.status, 200);
    assert.equal(conversations.body.conversations.some((item: { conversationId: string }) => item.conversationId === conversationId), true);
    assert.equal(conversation.status, 200);
    assert.equal(conversation.body.conversation.latestRunId, runId);
    assert.equal(conversation.body.conversation.turns.length, 2);
    assert.equal(conversation.body.conversation.turns[1].content.includes("我可以直接回答问题"), true);
    assert.equal(run.status, 200);
    assert.equal(run.body.restoredFromSnapshot, true);
    assert.equal(run.body.restoredResult.summary.includes("我可以直接回答问题"), true);
    assert.equal(run.body.transcript.events.some((event: { type: string }) => event.type === "agent.note.delta"), false);
    assert.equal(run.body.transcript.events.some((event: { type: string }) => event.type === "model.output.completed"), false);
    assert.equal(run.body.conversation.conversationId, conversationId);
    assert.equal(runtimeRun.body.snapshot.run.runId, runId);
    assertSafePanelJsonText(run.text);
    assertSafePanelJsonText(conversation.text);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("conversation API queues follow-up while the same conversation is still running", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-queue-"));
  const secret = "sk-conversation-queue-secret";
  let releaseFetch: (() => void) | undefined;
  const fetchGate = new Promise<void>((resolve) => {
    releaseFetch = resolve;
  });
  const providerFetch: PanelProviderFetch = async () => {
    await fetchGate;
    return createOpenAiTextResponse("conversation-queue-model", "第一轮已经完成。");
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "conversation-queue-model",
        apiKey: secret,
      },
    });
    const first = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "先回答第一轮", aiMode: "openai-compatible" },
    });
    await waitForRun(
      server.url,
      first.body.run.runId,
      (body) => body.status === "running" && body.trace.events.some((event: { type: string }) => event.type === "model.requested"),
      4_000,
      "/api/desktop/runs"
    );
    const queued = await requestJson(
      server.url,
      `/api/conversations/${encodeURIComponent(first.body.conversation.conversationId)}/messages`,
      {
        method: "POST",
        body: { goal: "继续", aiMode: "fake" },
      }
    );
    const duringFirst = await requestJson(
      server.url,
      `/api/conversations/${encodeURIComponent(first.body.conversation.conversationId)}`
    );

    assert.equal(first.status, 202);
    assert.equal(queued.status, 202);
    assert.equal(queued.body.run.status, "pending");
    assert.equal(queued.body.conversation.queuedRunIds.includes(queued.body.run.runId), true);
    assert.equal(duringFirst.body.conversation.turns.length, 4);
    assert.equal(duringFirst.body.conversation.turns[2].status, "pending");
    assert.equal(duringFirst.body.conversation.turns[3].status, "pending");

    releaseFetch?.();
    await waitForRun(server.url, first.body.run.runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    const completedQueued = await waitForRun(
      server.url,
      queued.body.run.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );
    const conversation = await requestJson(
      server.url,
      `/api/conversations/${encodeURIComponent(first.body.conversation.conversationId)}`
    );

    assert.equal(completedQueued.body.status, "completed");
    assert.equal(conversation.body.conversation.activeRunId, undefined);
    assert.equal(conversation.body.conversation.queuedRunCount, 0);
    assert.equal(conversation.body.conversation.turns.length, 4);
    assert.equal(conversation.body.conversation.turns[2].status, "completed");
    assert.equal(conversation.body.conversation.turns[3].status, "completed");
  } finally {
    releaseFetch?.();
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
      "我是 AgentArbor 桌面 Root Agent。底层模型取决于你在设置中配置的模型运行时；普通问题会直接回答，不会被强行包装成项目分析。"
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
    assert.equal(completed.body.canvas.kind, "desktop_agent_canvas");
    assert.equal(completed.body.route, undefined);
    assert.equal(completed.body.canvas.agent.answer.answer.includes("普通问题会直接回答"), true);
    assert.equal(completed.body.canvas.agent.pendingConfirmation, undefined);
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

test("desktop openai-compatible provider HTTP 400 stays out of main conversation text", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-http400-friendly-"));
  const secret = "sk-desktop-http400-friendly-secret";
  const providerFetch: PanelProviderFetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: { message: "raw provider response marker" } }),
  });
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "desktop-http400-model",
        apiKey: secret,
      },
    });

    const start = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "桌面文件，你看看", aiMode: "openai-compatible" },
    });
    const failed = await waitForRun(
      server.url,
      start.body.run.runId,
      (body) => body.status === "failed",
      4_000,
      "/api/desktop/runs"
    );
    const conversation = await requestJson(
      server.url,
      `/api/conversations/${encodeURIComponent(start.body.conversation.conversationId)}`
    );
    const assistantTurn = conversation.body.conversation.turns.at(-1);

    assert.equal(failed.body.status, "failed");
    assert.equal(failed.body.error.message.includes("模型服务这次没有返回可用结果"), true);
    assert.equal(assistantTurn.content.includes("模型服务这次没有返回可用结果"), true);
    assert.equal(failed.body.error.message.includes("还没有配置模型名"), false);
    assert.equal(assistantTurn.content.includes("还没有配置模型名"), false);
    assert.equal(JSON.stringify(failed.body.conversation).includes("OpenAI-compatible provider returned HTTP 400"), false);
    assert.equal(JSON.stringify(failed.body.conversation).includes("HTTP 400"), false);
    assert.equal(JSON.stringify(failed.body.conversation).includes("raw provider response marker"), false);
    assert.equal(JSON.stringify(failed.body.conversation).includes(secret), false);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("conversation follow-up after a provider failure does not feed internal ids back to the model", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-failure-followup-"));
  const secret = "sk-failure-followup-secret";
  const prompts: string[] = [];
  let callIndex = 0;
  const providerFetch: PanelProviderFetch = async (_url, init) => {
    callIndex += 1;
    const body = JSON.parse(init.body) as { messages?: readonly { content?: string }[] };
    prompts.push(body.messages?.map((message) => message.content ?? "").join("\n") ?? "");
    if (callIndex === 1) {
      return {
        ok: false,
        status: 400,
        json: async () => ({ error: { message: "bad request" } }),
      };
    }
    return createOpenAiTextResponse(
      "failure-followup-model",
      "刚才模型服务没有返回可用结果。对于桌面文件，我需要你选择具体文件或给出只读引用，然后我才能继续看。"
    );
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "failure-followup-model",
        apiKey: secret,
      },
    });

    const first = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "桌面文件，你看看", aiMode: "openai-compatible" },
    });
    await waitForRun(server.url, first.body.run.runId, (body) => body.status === "failed", 4_000, "/api/desktop/runs");

    const second = await requestJson(
      server.url,
      `/api/conversations/${encodeURIComponent(first.body.conversation.conversationId)}/messages`,
      {
        method: "POST",
        body: { goal: "?", aiMode: "openai-compatible" },
      }
    );
    const completed = await waitForRun(
      server.url,
      second.body.run.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );
    const followupPrompt = prompts.at(-1) ?? "";
    const conversation = completed.body.conversation;
    const visibleConversation = JSON.stringify(conversation);

    assert.equal(completed.body.status, "completed");
    assert.equal(completed.body.canvas.agent.answer.answer.includes("桌面文件"), true);
    assert.equal(followupPrompt.includes("OpenAI-compatible provider returned HTTP 400"), false);
    assert.equal(followupPrompt.includes("HTTP 400"), false);
    assert.equal(/\bgoal-\d+\b/.test(followupPrompt), false);
    assert.equal(/\bmodel-request-\d+\b/.test(followupPrompt), false);
    assert.equal(followupPrompt.includes("当前任务"), false);
    assert.equal(visibleConversation.includes("OpenAI-compatible provider returned HTTP 400"), false);
    assert.equal(visibleConversation.includes("HTTP 400"), false);
    assert.equal(/\bgoal-\d+\b/.test(visibleConversation), false);
    assert.equal(visibleConversation.includes(secret), false);
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

test("desktop deep mode real AI contract failure surfaces a stopped diagnostic", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-contract-failure-"));
  const secret = "sk-desktop-contract-failure-secret";
  let modelCallCount = 0;
  const providerFetch: PanelProviderFetch = async () => {
    modelCallCount += 1;
    return createInvalidOpenAiResponse("desktop-contract-failure-model");
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
      body: {
        goal: "分析当前仓库并输出报告，Use a real model path with invalid structured output.",
        aiMode: "openai-compatible",
        runMode: "deep",
      },
    });
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );
    const failedCalls = completed.body.transcript.modelCalls.filter((call: { status: string }) => call.status === "failed");
    const failedCall = failedCalls.at(-1);

    assert.equal(completed.body.status, "completed");
    assert.equal(completed.body.runMode, "deep");
    assert.equal(completed.body.error, undefined);
    assert.equal(completed.body.canvas.kind, "underground_deep_canvas");
    assert.equal(completed.body.canvas.underground.status, "stopped");
    assert.equal(completed.body.canvas.underground.packageRef.validationPassed, false);
    assert.equal(completed.body.trace.events.some((event: { type: string }) => event.type === "model.failed"), true);
    assert.equal(modelCallCount >= 1, true);
    assert.equal(failedCall?.failureKind, "output_validation");
    assert.equal(typeof failedCall?.outputContractId, "string");
    assert.equal(completed.text.includes(secret), false);
    assert.equal(completed.text.includes("bad raw output"), false);
    assert.equal(completed.text.includes("hidden_reasoning"), false);
    assertSafePanelJsonText(completed.text);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("desktop deep mode internal decision stream is not rendered as assistant answer on contract failure", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-internal-stream-filter-"));
  const secret = "sk-desktop-internal-stream-filter-secret";
  const leakedInternalDecision = "我是内部决策流，不应该进入主对话。";
  let modelCallCount = 0;
  const providerFetch: PanelProviderFetch = async () => {
    modelCallCount += 1;
    return createOpenAiStreamTextResponse("desktop-internal-stream-filter-model", [
      leakedInternalDecision.slice(0, 8),
      leakedInternalDecision.slice(8),
    ]);
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "desktop-internal-stream-filter-model",
        apiKey: secret,
      },
    });
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "分析当前仓库并输出报告。", aiMode: "openai-compatible", runMode: "deep" },
    });
    const stream = await requestSse(server.url, `/api/desktop/runs/${encodeURIComponent(start.body.runId)}/stream?cursor=0`);
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );
    const liveAssistantDeltas = stream.events.filter(
      (event) => event.type === "model.output.delta" && event.agentLabel === "助手"
    );

    assert.equal(modelCallCount >= 1, true);
    assert.equal(completed.body.status, "completed");
    assert.equal(completed.body.canvas.kind, "underground_deep_canvas");
    assert.equal(completed.body.canvas.underground.status, "stopped");
    assert.equal(liveAssistantDeltas.length, 0);
    assert.equal(stream.text.includes(leakedInternalDecision), false);
    assert.equal(completed.text.includes(leakedInternalDecision), false);
    assert.equal(stream.text.includes(secret), false);
    assert.equal(completed.text.includes(secret), false);
    assertSafePanelJsonText(`${stream.text}\n${completed.text}`);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("desktop openai-compatible ordinary agent uses configured search tool before answering", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-configured-tools-"));
  const modelSecret = "sk-desktop-configured-tools-secret";
  const tavilySecret = "tvly-desktop-configured-tools-secret";
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
              title: "Desktop assistant tool evidence",
              url: "https://example.test/desktop-agent",
              content: "Desktop ordinary agent configured search evidence.",
            },
          ],
        }),
      };
    }

    modelFetchCalls += 1;
    const body = JSON.parse(init.body) as { messages?: readonly { role?: string }[] };
    const hasToolMessage = body.messages?.some((message) => message.role === "tool") ?? false;
    return hasToolMessage
      ? createOpenAiTextResponse(
          "desktop-configured-tools-model",
          "我已经结合授权搜索结果完成回答；工具输出只以安全摘要和引用进入本轮对话。"
        )
      : createOpenAiSearchToolCallResponse();
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "gpt-4o-mini",
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
      body: { goal: "Use configured tools in the Desktop assistant.", aiMode: "openai-compatible", runMode: "agent" },
    });
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );

    assert.equal(completed.body.canvas.kind, "desktop_agent_canvas");
    assert.equal(modelFetchCalls, 2);
    assert.equal(tavilyFetchCalls, 1);
    assert.equal(completed.body.canvas.agent.answer.answer.includes("授权搜索结果"), true);
    assert.equal(completed.body.canvas.agent.toolCallRefs.includes("call-panel-search"), true);
    assert.equal(completed.body.transcript.events.some((event: { type: string }) => event.type === "agent.note.delta"), true);
    assert.equal(completed.body.transcript.events.some((event: { type: string }) => event.type === "model.output.completed"), true);
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

test("panel persists completed Desktop Agent runs to the local RuntimeDatabase safe projection", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-runtime-db-"));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-runtime-workspace-"));
  const secret = "sk-runtime-db-secret";
  const bearer = "runtime-db-token-value";
  const password = "runtime-db-password-value";
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        model: "runtime-db-model",
        defaultAiMode: "fake",
        apiKey: secret,
      },
    });
    await requestJson(server.url, "/api/config/workspace", {
      method: "POST",
      body: { workspaceDirectory: workspace },
    });

    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: {
        goal: `总结当前工作区。Authorization: Bearer ${bearer} password=${password} ${secret}`,
        aiMode: "fake",
        runMode: "agent",
      },
    });
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );
    const paths = resolveAgentArborRuntimeDatabasePaths(directory);
    const database = new FileSystemRuntimeDatabase(paths);
    const snapshot = await database.getRun(start.body.runId);
    const persistedText = JSON.stringify(snapshot);

    assert.equal(start.status, 202);
    assert.equal(completed.body.status, "completed");
    assert.equal(server.runtimeDirectory, paths.runtimeHome);
    assert.equal(snapshot?.run.runKind, "desktop");
    assert.equal(snapshot?.run.runMode, "agent");
    assert.equal(snapshot?.run.status, "completed");
    assert.equal(snapshot?.run.workspacePath, path.resolve(workspace));
    assert.equal(snapshot?.workspace?.path, path.resolve(workspace));
    assert.equal(path.resolve(snapshot?.run.runHome ?? "").startsWith(path.resolve(paths.runtimeHome)), true);
    assert.equal(path.resolve(snapshot?.run.runHome ?? "").startsWith(path.resolve(workspace)), false);
    assert.equal(snapshot?.events.some((event) => event.type === "goal.received"), true);
    assert.equal(snapshot?.events.some((event) => event.type === "model.requested"), true);
    assert.equal((snapshot?.modelCalls.length ?? 0) > 0, true);
    assert.equal(persistedText.includes(secret), false);
    assert.equal(persistedText.includes(bearer), false);
    assert.equal(persistedText.includes(password), false);
    assert.equal(persistedText.includes("sanitizedMessages"), false);
    assert.equal(persistedText.includes("raw provider response"), false);
    assert.equal(persistedText.includes("raw tool output"), false);
    assertSafePanelJsonText(persistedText);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rm(workspace, { recursive: true, force: true });
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
    const basicEvents = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(start.body.runId)}/events?cursor=${cursor}`
    );

    assert.equal(stream.status, 200);
    assert.equal(stream.events.length > 0, true);
    assert.equal(stream.events.some((event) => event.sequence <= cursor), false);
    assert.equal(new Set(stream.events.map((event) => event.sequence)).size, stream.events.length);
    assert.equal(stream.events.some((event) => event.type === "final.result"), true);
    assert.equal(basicEvents.status, 200);
    assert.equal(basicEvents.body.cursor.lastSequence >= cursor, true);
    assert.equal(basicEvents.body.events.length > 0, true);
    assert.equal(basicEvents.body.events.some((event: { sequence: number }) => event.sequence <= cursor), false);
    assert.equal(basicEvents.body.events.some((event: { type: string }) => event.type === "final.result"), true);
    assert.equal(JSON.stringify(basicEvents.body.events).includes("raw provider response"), false);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("basic agent events endpoint derives completed events without a prior run read", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-basic-events-direct-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "直接回答一个普通问题", aiMode: "fake" },
    });
    const basicEvents = await waitForBasicEvents(
      server.url,
      start.body.runId,
      (body) => body.events.some((event: { type: string }) => event.type === "final.result")
    );

    assert.equal(basicEvents.status, 200);
    assert.equal(basicEvents.body.cursor.lastSequence > 0, true);
    assert.equal(basicEvents.body.events[0].type, "run.started");
    assert.equal(basicEvents.body.events.some((event: { type: string }) => event.type === "final.result"), true);
    assert.equal(JSON.stringify(basicEvents.body.events).includes("raw provider response"), false);
    assertSafePanelJsonText(basicEvents.text);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("basic agent run endpoint returns the transport-neutral completed projection", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-basic-run-endpoint-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "直接回答一个普通问题", aiMode: "fake" },
    });
    await waitForRun(server.url, start.body.runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    const basicRun = await requestJson(server.url, `/api/basic-agent/runs/${encodeURIComponent(start.body.runId)}`);

    assert.equal(basicRun.status, 200);
    assert.equal(basicRun.body.run.runId, start.body.runId);
    assert.equal(basicRun.body.run.status, "completed");
    assert.equal(basicRun.body.run.runMode, "agent");
    assert.equal(basicRun.body.run.requiresUserAction, false);
    assert.equal(basicRun.body.run.eventCursor.lastSequence > 0, true);
    assert.equal(JSON.stringify(basicRun.body).includes("sanitizedMessages"), false);
    assertSafePanelJsonText(basicRun.text);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("basic agent cancel API marks running desktop jobs as cancelled and replays terminal events", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-basic-cancel-"));
  const secret = "sk-basic-cancel-secret";
  let releaseFetch: (() => void) | undefined;
  const fetchGate = new Promise<void>((resolve) => {
    releaseFetch = resolve;
  });
  const providerFetch: PanelProviderFetch = async () => {
    await fetchGate;
    return createOpenAiTextResponse("basic-cancel-model", "This response arrived after cancellation.");
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "basic-cancel-model",
        apiKey: secret,
      },
    });
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "保持运行直到我取消", aiMode: "openai-compatible" },
    });
    await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "running" && body.trace.events.some((event: { type: string }) => event.type === "model.requested"),
      4_000,
      "/api/desktop/runs"
    );
    const cancelled = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(start.body.runId)}/cancel`,
      { method: "POST" }
    );
    const basicEvents = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(start.body.runId)}/events?cursor=0`
    );
    const stream = await requestSse(server.url, `/api/desktop/runs/${encodeURIComponent(start.body.runId)}/stream?cursor=0`);
    const runtimeRun = await requestJson(server.url, `/api/runtime/runs/${encodeURIComponent(start.body.runId)}`);

    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.run.status, "cancelled");
    assert.equal(basicEvents.body.events.some((event: { type: string }) => event.type === "run.cancelled"), true);
    assert.equal(stream.events.some((event) => event.type === "run.cancelled"), true);
    assert.equal(runtimeRun.body.snapshot.run.status, "cancelled");
    assert.equal(JSON.stringify(basicEvents.body.events).includes(secret), false);
    assertSafePanelJsonText(`${cancelled.text}\n${basicEvents.text}\n${stream.text}\n${runtimeRun.text}`);
  } finally {
    releaseFetch?.();
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("basic agent confirmation decisions persist approve and guidance outcomes safely", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-basic-confirmation-decisions-"));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-basic-confirmation-workspace-"));
  let providerFetchCalls = 0;
  const providerFetch: PanelProviderFetch = async () => {
    providerFetchCalls += 1;
    if (providerFetchCalls === 1) {
      return createOpenAiWriteFileToolCallResponse("approved.txt", "approved write content");
    }
    if (providerFetchCalls === 3) {
      return createOpenAiWriteFileToolCallResponse("guidance.txt", "guidance write content");
    }
    return createOpenAiTextResponse("basic-confirmation-model", "文件写入已完成，结果已整理。");
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "gpt-4o-mini",
        apiKey: "sk-basic-confirmation-secret",
      },
    });
    await requestJson(server.url, "/api/config/workspace", {
      method: "POST",
      body: { workspaceDirectory: workspace },
    });
    const approveStart = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "写入 approved.txt 测试确认续跑", aiMode: "openai-compatible" },
    });
    const approveCompleted = await waitForRun(
      server.url,
      approveStart.body.runId,
      (body) => body.status === "completed" && body.canvas?.agent?.pendingConfirmation !== undefined,
      4_000,
      "/api/desktop/runs"
    );
    const approveConfirmationId = approveCompleted.body.canvas.agent.pendingConfirmation.confirmationId;
    const approveDecision = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(approveStart.body.runId)}/confirmations/${encodeURIComponent(approveConfirmationId)}/decision`,
      { method: "POST", body: { decision: "approve_once" } }
    );
    const approveRuntime = await requestJson(server.url, `/api/runtime/runs/${encodeURIComponent(approveStart.body.runId)}`);
    const approveEvents = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(approveStart.body.runId)}/events?cursor=0`
    );
    const approvedFile = await fs.readFile(path.join(workspace, "approved.txt"), "utf8");

    assert.equal(approveDecision.status, 200);
    assert.equal(approveDecision.body.run.status, "completed");
    assert.equal(approveRuntime.body.snapshot.confirmations[0].status, "approved");
    assert.equal(approveRuntime.body.snapshot.toolCalls.some((call: { status: string }) => call.status === "completed"), true);
    assert.equal(approveEvents.body.events.some((event: { type: string }) => event.type === "run.resumed"), true);
    assert.equal(approveEvents.body.events.some((event: { type: string }) => event.type === "tool.completed"), true);
    assert.equal(approvedFile, "approved write content");

    const guidanceSecret = "sk-guidance-decision-secret";
    const guidanceStart = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "写入 guidance.txt 前先等我补充指导", aiMode: "openai-compatible" },
    });
    const guidanceCompleted = await waitForRun(
      server.url,
      guidanceStart.body.runId,
      (body) => body.status === "completed" && body.canvas?.agent?.pendingConfirmation !== undefined,
      4_000,
      "/api/desktop/runs"
    );
    const guidanceConfirmationId = guidanceCompleted.body.canvas.agent.pendingConfirmation.confirmationId;
    const guidanceDecision = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(guidanceStart.body.runId)}/confirmations/${encodeURIComponent(guidanceConfirmationId)}/decision`,
      { method: "POST", body: { decision: "guidance", guidance: `先不要读取文件，只说明需要什么材料。${guidanceSecret}` } }
    );
    const guidanceRuntime = await requestJson(server.url, `/api/runtime/runs/${encodeURIComponent(guidanceStart.body.runId)}`);
    const guidanceEvents = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(guidanceStart.body.runId)}/events?cursor=0`
    );

    assert.equal(guidanceDecision.status, 200);
    assert.equal(guidanceDecision.body.run.status, "needs_input");
    assert.equal(guidanceRuntime.body.snapshot.confirmations[0].status, "guidance");
    assert.equal(guidanceEvents.body.events.some((event: { type: string }) => event.type === "user.guidance"), true);
    assert.equal(guidanceEvents.text.includes(guidanceSecret), false);
    assert.equal(guidanceRuntime.text.includes(guidanceSecret), false);
    assertSafePanelJsonText(`${approveDecision.text}\n${approveRuntime.text}\n${approveEvents.text}\n${guidanceDecision.text}\n${guidanceRuntime.text}\n${guidanceEvents.text}`);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("basic agent denied confirmation restores as blocked with safe replay after restart", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-basic-confirmation-deny-"));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-basic-confirmation-deny-workspace-"));
  const providerFetch: PanelProviderFetch = async () => createOpenAiWriteFileToolCallResponse("denied.txt", "denied write content");
  let server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "gpt-4o-mini",
        apiKey: "sk-basic-deny-secret",
      },
    });
    await requestJson(server.url, "/api/config/workspace", {
      method: "POST",
      body: { workspaceDirectory: workspace },
    });
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "写入 denied.txt 前需要确认", aiMode: "openai-compatible" },
    });
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed" && body.canvas?.agent?.pendingConfirmation !== undefined,
      4_000,
      "/api/desktop/runs"
    );
    const confirmationId = completed.body.canvas.agent.pendingConfirmation.confirmationId;
    const denied = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(start.body.runId)}/confirmations/${encodeURIComponent(confirmationId)}/decision`,
      { method: "POST", body: { decision: "deny" } }
    );
    const runtimeRun = await requestJson(server.url, `/api/runtime/runs/${encodeURIComponent(start.body.runId)}`);
    const blockedEvents = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(start.body.runId)}/events?cursor=0`
    );

    assert.equal(denied.status, 200);
    assert.equal(denied.body.run.status, "blocked");
    assert.equal(runtimeRun.body.snapshot.run.status, "blocked");
    assert.equal(runtimeRun.body.snapshot.confirmations[0].status, "denied");
    assert.equal(blockedEvents.body.events.some((event: { type: string }) => event.type === "user_approval.received"), true);
    assert.equal(blockedEvents.body.events.some((event: { type: string }) => event.type === "run.blocked"), true);
    assertSafePanelJsonText(`${denied.text}\n${runtimeRun.text}\n${blockedEvents.text}`);

    await server.close();
    server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
    const restoredRun = await requestJson(server.url, `/api/basic-agent/runs/${encodeURIComponent(start.body.runId)}`);
    const restoredEvents = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(start.body.runId)}/events?cursor=0`
    );

    assert.equal(restoredRun.status, 200);
    assert.equal(restoredRun.body.run.status, "blocked");
    assert.equal(restoredRun.body.run.requiresUserAction, true);
    assert.equal(restoredEvents.body.events.some((event: { type: string }) => event.type === "run.blocked"), true);
    assert.equal(restoredEvents.body.events.some((event: { type: string }) => event.type === "user_approval.received"), true);
    assertSafePanelJsonText(`${restoredRun.text}\n${restoredEvents.text}`);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("basic agent approve after restart blocks because executable continuation is not persisted", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-basic-confirmation-approve-restart-"));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-basic-confirmation-approve-restart-workspace-"));
  let server = await startLocalPanelServer({
    port: 0,
    configDirectory: directory,
    providerFetch: async () => createOpenAiWriteFileToolCallResponse("restart-approved.txt", "must not be written"),
  });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "gpt-4o-mini",
        apiKey: "sk-restart-approval-secret",
      },
    });
    await requestJson(server.url, "/api/config/workspace", {
      method: "POST",
      body: { workspaceDirectory: workspace },
    });
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "写入 restart-approved.txt 测试重启后确认", aiMode: "openai-compatible" },
    });
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed" && body.canvas?.agent?.pendingConfirmation !== undefined,
      4_000,
      "/api/desktop/runs"
    );
    const confirmationId = completed.body.canvas.agent.pendingConfirmation.confirmationId;

    await server.close();
    server = await startLocalPanelServer({ port: 0, configDirectory: directory });
    const approved = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(start.body.runId)}/confirmations/${encodeURIComponent(confirmationId)}/decision`,
      { method: "POST", body: { decision: "approve_once" } }
    );
    const restoredEvents = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(start.body.runId)}/events?cursor=0`
    );
    const runtimeRun = await requestJson(server.url, `/api/runtime/runs/${encodeURIComponent(start.body.runId)}`);

    assert.equal(approved.status, 200);
    assert.equal(approved.body.run.status, "blocked");
    assert.equal(runtimeRun.body.snapshot.run.status, "blocked");
    assert.equal(runtimeRun.body.snapshot.confirmations[0].status, "approved");
    assert.equal(restoredEvents.body.events.some((event: { type: string }) => event.type === "run.blocked"), true);
    await assert.rejects(() => fs.readFile(path.join(workspace, "restart-approved.txt"), "utf8"));
    assertSafePanelJsonText(`${approved.text}\n${restoredEvents.text}\n${runtimeRun.text}`);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rm(workspace, { recursive: true, force: true });
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

async function readPanelUiSource(fileName: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), "src", "app", "panel-ui", "src", fileName), "utf8");
}

function extractPanelAssetPaths(html: string): readonly string[] {
  const paths = new Set<string>();
  for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) {
    paths.add(match[1] ?? "");
  }
  return [...paths].filter((value) => value.length > 0);
}

function assertFirstScreenHasNoInternalTerms(html: string): void {
  for (const term of [
    "Task Soil",
    "Plan Package",
    "Observation Panel",
    "Agent Run Tree",
    "provider",
    "rootlet",
    "EventLog",
    "Routines",
    "OpenAI-compatible",
    "Fake AI",
    "AI 禁用",
    "运行树",
    "父层 synthesis",
    "详情与诊断",
    "真实 AI 诊断",
    "模型 / 工具流",
  ]) {
    assert.equal(html.includes(term), false, `first screen should not include ${term}`);
  }
}

type RequestJsonOptions = {
  readonly method?: "GET" | "POST" | "DELETE";
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

type RequestTextResult = {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly text: string;
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

function requestText(baseUrl: string, pathname: string): Promise<RequestTextResult> {
  const url = new URL(pathname, baseUrl);
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "GET" }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        text += chunk;
      });
      response.on("end", () => {
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          text,
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

async function waitForBasicEvents(
  baseUrl: string,
  runId: string,
  predicate: (body: any) => boolean,
  timeoutMs = 4_000
): Promise<RequestJsonResult> {
  const startedAt = Date.now();
  let last: RequestJsonResult | undefined;
  while (Date.now() - startedAt < timeoutMs) {
    last = await requestJson(baseUrl, `/api/basic-agent/runs/${encodeURIComponent(runId)}/events?cursor=0`);
    if (predicate(last.body)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for basic agent events ${runId}; last=${last?.text}`);
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

function createOpenAiReadFileToolCallResponse(filePath = "README.md"): Awaited<ReturnType<PanelProviderFetch>> {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      model: "desktop-tool-detail-model",
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call-panel-read-file",
                type: "function",
                function: {
                  name: "read_file",
                  arguments: JSON.stringify({ path: filePath }),
                },
              },
            ],
          },
        },
      ],
    }),
  };
}

function createOpenAiWriteFileToolCallResponse(filePath: string, content: string): Awaited<ReturnType<PanelProviderFetch>> {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      model: "basic-confirmation-model",
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call-panel-write-file",
                type: "function",
                function: {
                  name: "write_file",
                  arguments: JSON.stringify({ path: filePath, content }),
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

function createOpenAiStreamTextResponse(
  model: string,
  chunks: readonly string[]
): Awaited<ReturnType<PanelProviderFetch>> {
  return {
    ok: true,
    status: 200,
    body: sseChunks(
      chunks.map((chunk, index) => ({
        model,
        choices: [
          {
            delta: { content: chunk },
            finish_reason: index === chunks.length - 1 ? "stop" : null,
          },
        ],
      }))
    ),
    json: async () => {
      throw new Error("Streaming response should not be read through json().");
    },
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

async function* sseChunks(chunks: readonly unknown[]): AsyncGenerator<string> {
  for (const chunk of chunks) {
    yield `data: ${JSON.stringify(chunk)}\n\n`;
  }
  yield "data: [DONE]\n\n";
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
