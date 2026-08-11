import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveAgentArborRuntimePaths } from "../../../adapters/runtime-storage/index.js";
import { startLocalPanelServer, type PanelProviderFetch } from "../../panel-server.js";
import { ConfigCenter } from "../../config-center/index.js";
import { resolveDefaultPanelSkillRoots } from "../runtime.js";
import {
  removeTemporaryTree,
  requestJson,
} from "./panel-server-test-utils.js";
import {
  countChatCompletionsToolOutputs,
  parseChatCompletionsRequestBody,
} from "../../testing/openai-test-fixtures.js";

test("panel server serves Vite React frontend assets", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-assets-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
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
    assert.equal(css.text.includes(".aa-workbench-root"), true);
    assert.equal(js.text.includes("/api/basic-agent/runs/"), true);
    assert.equal((await requestText(server.url, "/assets/%2e%2e/index.html")).status, 404);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("panel server serves real brand favicon assets", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-favicon-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const svg = await requestBuffer(server.url, "/favicon.svg");

    assert.equal(svg.status, 200);
    assert.match(String(svg.headers["content-type"]), /image\/svg\+xml/);
    assert.equal(svg.body.toString("utf8").includes('viewBox="0 0 1024 1024"'), true);
    assert.equal(svg.body.toString("utf8").includes('rx="208"'), true);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("panel config route returns product runtime metadata for settings about page", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-config-product-"));
  const packageJson = JSON.parse(await fs.readFile("package.json", "utf8")) as { readonly version: string };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const response = await requestJson(server.url, "/api/config");

    assert.equal(response.status, 200);
    assert.equal(response.body.product.name, "AgentArbor");
    assert.equal(response.body.product.version, packageJson.version);
    assert.equal(response.body.product.defaultEntry, "Desktop Shell / Panel");
    assert.equal(response.body.product.runtimeMode, "agent");
    assert.equal(response.body.product.runtimeModeLabel, "普通 agent");
    assert.equal(response.body.product.configDirectory, directory);
    assert.equal(response.body.product.runtimeDirectory, path.join(directory, "runtime"));
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("panel reports the deferred Multi-Agent API instead of constructing its runtime", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-deferred-multi-agent-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const response = await requestJson(server.url, "/api/deep/conversations");
    assert.equal(response.status, 410);
    assert.equal(response.body.error.code, "multi_agent_deferred");
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("panel usage statistics route reads the empty Ordinary feature store", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-usage-statistics-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const empty = await requestJson(server.url, "/api/runtime/usage-statistics");
    assert.equal(empty.status, 200);
    assert.equal(empty.body.statistics.storageAvailable, true);
    assert.equal(empty.body.statistics.totals.conversationCount, 0);
    assert.equal(empty.body.statistics.totals.messageCount, 0);
    assert.equal(empty.body.statistics.totals.inputTokens, 0);

  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("panel ignores obsolete legacy runtime snapshots instead of adding a compatibility reader", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-runtime-snapshot-incompatible-"));
  const paths = resolveAgentArborRuntimePaths(directory);
  const runId = "legacy-runtime-run";
  const runDirectory = path.join(paths.runtimeHome, "runs", encodeURIComponent(runId));
  await fs.mkdir(runDirectory, { recursive: true });
  await fs.writeFile(path.join(runDirectory, "run.json"), JSON.stringify({ runId }), "utf8");
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const response = await requestJson(server.url, `/api/runtime/runs/${encodeURIComponent(runId)}`);
    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, "not_found");
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("panel tools route can disable web search without using the stored Tavily key", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-tools-disabled-"));
  const modelSecret = "sk-disabled-tools-secret";
  const tavilySecret = "tvly-disabled-panel-secret";
  let tavilyFetchCalls = 0;
  const modelProvider = await startPanelChatCompletionsProvider();
  const providerFetch: PanelProviderFetch = async (url, init) => {
    if (url === "https://api.tavily.com/search") {
      tavilyFetchCalls += 1;
      throw new Error("Disabled web search provider must not call Tavily fetch.");
    }

    throw new Error(`Unexpected provider fetch from panel test: ${url} ${init.method}`);
  };
  try {
    const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
    try {
      await requestJson(server.url, "/api/config/model-provider", {
        method: "POST",
        body: {
          baseUrl: modelProvider.baseUrl,
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
      const space = await requestJson(server.url, "/api/spaces", {
        method: "POST",
        body: { title: "禁用工具" },
      });
      const spaceId = space.body.space.id as string;

      const started = await requestJson(server.url, "/api/conversations", {
        method: "POST",
        body: { goal: "Build a small deterministic helper.", aiMode: "openai-compatible", spaceId },
      });
      const run = await waitForOrdinaryView(server.url, started.body.run.runId, "completed");

      assert.equal(disabled.status, 200);
      assert.equal(disabled.body.tools.webSearch.provider, "none");
      assert.equal(disabled.body.tools.webSearch.status, "disabled");
      assert.equal(disabled.body.tools.webSearch.secretConfigured, false);
      assert.equal(disabled.text.includes(tavilySecret), false);
      assert.equal(started.status, 202);
      assert.equal(run.status, 200);
      assert.equal(modelProvider.requestCount >= 1, true);
      assert.equal(tavilyFetchCalls, 0);
      assert.equal(JSON.stringify(run.body).includes(modelSecret), false);
      assert.equal(JSON.stringify(run.body).includes(tavilySecret), false);
    } finally {
      await server.close();
    }
  } finally {
    await modelProvider.close();
    await removeTemporaryTree(directory);
  }
});

test("panel Ordinary completes a real tool round through the configured model transport", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-session-tool-round-"));
  const workspace = path.join(directory, "workspace");
  await fs.mkdir(workspace, { recursive: true });
  const readmePath = path.join(workspace, "README.md");
  await fs.writeFile(readmePath, "native session tool evidence", "utf8");
  const modelProvider = await startPanelChatCompletionsProvider([{
    name: "Read",
    input: { path: readmePath },
  }]);
  try {
    const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
    try {
      await requestJson(server.url, "/api/config/model-provider", {
        method: "POST",
        body: {
          baseUrl: modelProvider.baseUrl,
          model: "session-tool-model",
          apiKey: "sk-session-tool-test",
        },
      });
      const space = await requestJson(server.url, "/api/spaces", {
        method: "POST",
        body: { title: "工具轮次" },
      });
      const spaceId = space.body.space.id as string;
      await requestJson(server.url, `/api/spaces/${encodeURIComponent(spaceId)}/references`, {
        method: "POST",
        body: { title: "工作目录", reference: { kind: "workspace_folder", path: workspace } },
      });
      const started = await requestJson(server.url, "/api/conversations", {
        method: "POST",
        body: {
          goal: "Read README.md and report what it contains.",
          aiMode: "openai-compatible",
          workspaceDirectory: workspace,
          spaceId,
        },
      });
      const run = await waitForOrdinaryView(server.url, started.body.run.runId, "completed");

      // run 的工具轮固定使用两次模型请求（工具声明 + 工具结果收尾）；completed
      // 后 Ordinary 还会异步发起一次无工具 auto title 请求，同样命中同一 provider。
      const titleDeadline = Date.now() + 4_000;
      while (modelProvider.requestCount < 3 && Date.now() < titleDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      assert.equal(started.status, 202);
      assert.equal(modelProvider.requestCount, 3);
      assert.equal(run.body.view.workView.answer.content, "The requested file was read successfully.");
      assert.equal(run.body.view.detail.toolResults.length, 1);
      assert.equal(run.body.view.detail.toolResults[0].toolName, "Read");
      assert.equal(run.body.view.detail.toolResults[0].status, "completed");
      assert.match(JSON.stringify(run.body.view.detail.toolResults[0].output), /native session tool evidence/u);
    } finally {
      await server.close();
    }
  } finally {
    await modelProvider.close();
    await removeTemporaryTree(directory);
  }
});

test("panel Ordinary reads a page before writing the Space reference with its own annotation", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-annotation-behavior-"));
  const pageUrl = "https://example.com/feature-visualization";
  const agentAnnotation = {
    markdown: "# 特征可视化\n\n通过优化输入观察神经元激活，深层网络倾向于表示更抽象的概念。",
    keyPoints: ["通过优化输入观察神经元激活"],
    tags: ["深度学习", "可视化"],
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  let modelProvider: Awaited<ReturnType<typeof startPanelChatCompletionsProvider>> | undefined;
  try {
    const space = await requestJson(server.url, "/api/spaces", {
      method: "POST",
      body: { title: "机器学习" },
    });
    const spaceId = space.body.space.id as string;
    // 模型脚本：先 WebFetch 阅读来源，再 SpaceAddReference 提交自己的整理内容。
    modelProvider = await startPanelChatCompletionsProvider([
      { name: "WebFetch", input: { url: pageUrl } },
      {
        name: "SpaceAddReference",
        input: {
          spaceId,
          title: "特征可视化",
          reference: { kind: "web_page", url: pageUrl },
          annotation: agentAnnotation,
        },
      },
    ], "The requested page was added to the Space with an Agent summary.");
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: modelProvider.baseUrl,
        model: "session-tool-model",
        apiKey: "sk-session-tool-test",
      },
    });
    const started = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: {
        goal: `把 ${pageUrl} 加入机器学习空间，并整理一份自己的理解。`,
        aiMode: "openai-compatible",
        spaceId,
      },
    });
    const run = await waitForOrdinaryView(server.url, started.body.run.runId, "completed");

    assert.equal(started.status, 202);
    assert.deepEqual(
      run.body.view.detail.toolResults.map((tool: { readonly toolName: string }) => tool.toolName),
      ["WebFetch", "SpaceAddReference"],
    );
    assert.equal(run.body.view.workView.answer.content, "The requested page was added to the Space with an Agent summary.");

    const tree = await requestJson(server.url, `/api/spaces/${encodeURIComponent(spaceId)}`);
    const item = (tree.body.tree.entries as readonly { readonly item: { readonly id: string; readonly title: string; readonly annotation?: { readonly revision: number; readonly updatedBy: string; readonly markdown: string; readonly actor?: Record<string, unknown> } } }[])
      .find((entry) => entry.item.title === "特征可视化");
    assert.notEqual(item, undefined);
    assert.equal(item!.item.annotation?.revision, 1);
    assert.equal(item!.item.annotation?.updatedBy, "agent");
    assert.equal(item!.item.annotation?.markdown, agentAnnotation.markdown);
    const actor = item!.item.annotation?.actor;
    assert.equal(actor?.kind, "agent");
    assert.equal(typeof actor?.actorId, "string");
    assert.equal(typeof actor?.traceId, "string");
    assert.equal(typeof actor?.goalId, "string");

    const preview = await requestJson(server.url, `/api/spaces/references/${encodeURIComponent(item!.item.id)}/preview`);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.preview.annotation.markdown, agentAnnotation.markdown);
    assert.equal(preview.body.preview.content.kind, "web");
  } finally {
    await modelProvider?.close();
    await server.close();
    await removeTemporaryTree(directory);
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
    assert.equal("triggers" in response.body.skills[0], false);
    assert.equal("sourcePath" in response.body.skills[0], false);
    assert.equal(JSON.stringify(response.body.skills).includes(skillRoot), false);
    assert.equal(JSON.stringify(response.body.skills).includes("BODY_SENTINEL"), false);

    const extraSkillDir = path.join(skillRoot, "extra-skill");
    await fs.mkdir(extraSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(extraSkillDir, "SKILL.md"),
      "---\nname: Extra Skill\ndescription: Extra metadata.\n---\n\nEXTRA_BODY_SENTINEL",
      "utf8"
    );
    const refreshed = await requestJson(server.url, "/api/skills/refresh", { method: "POST" });
    assert.equal(refreshed.status, 200);
    assert.deepEqual(
      refreshed.body.skills.map((skill: { readonly name: string }) => skill.name).sort(),
      ["Extra Skill", "Safe Skill"]
    );
    assert.equal(refreshed.body.skills.some((skill: Record<string, unknown>) => "sourcePath" in skill), false);
    assert.equal(refreshed.body.skills.some((skill: Record<string, unknown>) => "triggers" in skill), false);
    assert.equal(JSON.stringify(refreshed.body.skills).includes("EXTRA_BODY_SENTINEL"), false);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("default panel skill roots include user and project scopes with project precedence", () => {
  const roots = resolveDefaultPanelSkillRoots({
    cwd: path.join("Z:", "AgentArbor"),
    home: path.join("C:", "Users", "developer"),
  });

  assert.deepEqual(roots, [
    {
      rootPath: path.join("C:", "Users", "developer", ".agents", "skills"),
      sourceKind: "user",
      sourceRootId: "user",
      precedence: 10,
    },
    {
      rootPath: path.join("Z:", "AgentArbor", ".agents", "skills"),
      sourceKind: "project",
      sourceRootId: "project",
      precedence: 100,
    },
  ]);
});

test("panel skills state route updates source-qualified skill state", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-skill-state-"));
  const userRoot = path.join(directory, "user-skills");
  const projectRoot = path.join(directory, "project-skills");
  try {
    await fs.mkdir(path.join(userRoot, "shared-skill"), { recursive: true });
    await fs.mkdir(path.join(projectRoot, "shared-skill"), { recursive: true });
    await fs.writeFile(
      path.join(userRoot, "shared-skill", "SKILL.md"),
      "---\nname: shared-skill\ndescription: User skill.\n---\n\nUSER_BODY",
      "utf8"
    );
    await fs.writeFile(
      path.join(projectRoot, "shared-skill", "SKILL.md"),
      "---\nname: shared-skill\ndescription: Project skill.\n---\n\nPROJECT_BODY",
      "utf8"
    );
    const server = await startLocalPanelServer({
      port: 0,
      configDirectory: directory,
      skillRoots: [
        { rootPath: userRoot, sourceKind: "user", sourceRootId: "user", precedence: 10 },
        { rootPath: projectRoot, sourceKind: "project", sourceRootId: "project", precedence: 100 },
      ],
    });
    try {
      const listed = await requestJson(server.url, "/api/skills");
      const projectSkill = listed.body.skills.find((skill: { readonly sourceKind?: string }) => skill.sourceKind === "project");
      const userSkill = listed.body.skills.find((skill: { readonly sourceKind?: string }) => skill.sourceKind === "user");

      assert.equal(listed.status, 200);
      assert.equal(projectSkill.enabled, true);
      assert.equal(userSkill.enabled, true);
      assert.equal(typeof projectSkill.stateKey, "string");

      const ambiguous = await requestJson(server.url, "/api/skills/shared-skill/state", {
        method: "POST",
        body: { enabled: false },
      });
      assert.equal(ambiguous.status, 400);
      assert.equal(ambiguous.body.error.code, "ambiguous_skill_state");

      const updated = await requestJson(server.url, "/api/skills/shared-skill/state", {
        method: "POST",
        body: {
          enabled: false,
          stateKey: projectSkill.stateKey,
        },
      });
      const refreshedProject = updated.body.skills.find((skill: { readonly sourceKind?: string }) => skill.sourceKind === "project");
      const refreshedUser = updated.body.skills.find((skill: { readonly sourceKind?: string }) => skill.sourceKind === "user");

      assert.equal(updated.status, 200);
      assert.equal(refreshedProject.enabled, false);
      assert.equal(refreshedUser.enabled, true);
      assert.equal(JSON.stringify(updated.body.skills).includes("sourcePath"), false);
      assert.equal(JSON.stringify(updated.body.skills).includes("PROJECT_BODY"), false);
      assert.equal(JSON.stringify(updated.body.skills).includes("USER_BODY"), false);
    } finally {
      await server.close();
    }
  } finally {
    await removeTemporaryTree(directory);
  }
});

test("panel server logs unhandled request failures before returning panel_internal_error", async () => {
  const errorLogs: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    errorLogs.push(args);
  };
  try {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-unhandled-request-error-"));
    const brokenConfigCenter = new ConfigCenter({
      settingsStore: {
        async readSettings(): Promise<never> {
          throw new Error("synthetic panel request failure");
        },
        async writeSettings(): Promise<void> {
          throw new Error("synthetic panel request failure");
        },
      },
      secretStore: {
        async getMetadata() {
          return { configured: false } as const;
        },
        async readSecret() {
          return undefined;
        },
        async writeSecret() {
          return { configured: true } as const;
        },
        async deleteSecret() {
          return { configured: false } as const;
        },
      },
    });
    const server = await startLocalPanelServer({
      port: 0,
      configDirectory: directory,
      configCenter: brokenConfigCenter,
    });
    try {
      const failed = await requestText(server.url, "/health");

      assert.equal(failed.status, 500);
      assert.equal(failed.text.includes("\"code\":\"panel_internal_error\""), true);
      assert.equal(
        errorLogs.some((args) => String(args[0]).includes("[panel-server] unhandled request failure GET /health")),
        true
      );
      assert.equal(
        errorLogs.some((args) => args.some((item) => String(item).includes("synthetic panel request failure"))),
        true
      );
    } finally {
      await server.close();
      await removeTemporaryTree(directory);
    }
  } finally {
    console.error = originalConsoleError;
  }
});

function extractPanelAssetPaths(html: string): readonly string[] {
  const paths = new Set<string>();
  for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) {
    paths.add(match[1] ?? "");
  }
  return [...paths].filter((value) => value.length > 0);
}

async function startPanelChatCompletionsProvider(toolCalls?: readonly {
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
}[], finalText = "The requested file was read successfully."): Promise<{
  readonly baseUrl: string;
  readonly requestCount: number;
  close(): Promise<void>;
}> {
  let requestCount = 0;
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
        response.writeHead(404).end();
        return;
      }
      requestCount += 1;
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      const body = parseChatCompletionsRequestBody(Buffer.concat(chunks).toString("utf8"));
      // 每个 tool 结果推进一次脚本：第 n 个请求携带 n-1 个 tool 结果，
      // 返回 toolCalls 序列中的下一个工具，序列用尽后返回最终文本。
      const toolOutputCount = countChatCompletionsToolOutputs(body);
      const toolCall = toolCalls === undefined ? undefined : toolCalls[toolOutputCount];
      const payload = toolCall !== undefined
        ? {
            id: "chatcmpl-panel-tool-call",
            object: "chat.completion.chunk",
            created: 1_776_000_000,
            model: "session-tool-model",
            choices: [{
              index: 0,
              delta: {
                role: "assistant",
                tool_calls: [{
                  index: 0,
                  id: `call-panel-session-tool-${toolOutputCount + 1}`,
                  type: "function",
                  function: {
                    name: toolCall.name,
                    arguments: JSON.stringify(toolCall.input),
                  },
                }],
              },
              finish_reason: "tool_calls",
            }],
          }
        : {
            id: "chatcmpl-panel-complete",
            object: "chat.completion.chunk",
            created: 1_776_000_001,
            model: toolCalls === undefined ? "disabled-tools-model" : "session-tool-model",
            choices: [{
              index: 0,
              delta: {
                role: "assistant",
                content: toolCalls === undefined
                  ? "Configured tools remained disabled."
                  : finalText,
              },
              finish_reason: "stop",
            }],
          };
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      response.end(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`);
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: String(error) } }));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Panel test model provider did not bind a TCP port.");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    get requestCount() { return requestCount; },
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error === undefined ? resolve() : reject(error));
    }),
  };
}

async function waitForOrdinaryView(baseUrl: string, runId: string, status: string) {
  const deadline = Date.now() + 4_000;
  let last: Awaited<ReturnType<typeof requestJson>> | undefined;
  while (Date.now() < deadline) {
    last = await requestJson(baseUrl, `/api/basic-agent/runs/${encodeURIComponent(runId)}/view`);
    if (last.status === 200 && last.body.view.run.status === status) return last;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for Ordinary run ${runId} status ${status}; last=${last?.text}`);
}

type RequestTextResult = {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly text: string;
};

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

type RequestBufferResult = {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: Buffer;
};

function requestBuffer(baseUrl: string, pathname: string): Promise<RequestBufferResult> {
  const url = new URL(pathname, baseUrl);
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "GET" }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer | string) => {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      });
      response.on("end", () => {
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}
