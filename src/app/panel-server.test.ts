import assert from "node:assert/strict";
import { request } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startLocalPanelServer, type PanelProviderFetch } from "./panel-server.js";
import {
  removeTemporaryTree,
  requestJson,
} from "./panel-server-test-utils.js";
import {
  createOpenAiSearchToolCallResponse,
  createStubOpenAiResponse,
  hasResponsesToolDefinition,
  hasResponsesToolOutput,
  parseResponsesRequestBody,
} from "./panel-openai-test-fixtures.js";

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
    assert.equal(css.text.includes(".app-root"), true);
    assert.equal(js.text.includes("/api/basic-agent/runs/"), true);
    assert.equal((await requestText(server.url, "/assets/%2e%2e/index.html")).status, 404);
  } finally {
    await server.close();
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
    const body = parseResponsesRequestBody(init.body);
    const hasToolMessage = hasResponsesToolOutput(body);
    return hasToolMessage || !hasResponsesToolDefinition(body, "search")
      ? createStubOpenAiResponse("disabled-tools-model")
      : createOpenAiSearchToolCallResponse();
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
    assert.equal(modelFetchCalls >= 1, true);
    assert.equal(tavilyFetchCalls, 0);
    assert.equal(run.body.trace.events.some((event: { type: string }) => event.type === "tool.completed"), true);
    assert.equal(JSON.stringify(run.body).includes(modelSecret), false);
    assert.equal(JSON.stringify(run.body).includes(tavilySecret), false);
  } finally {
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
    assert.deepEqual(response.body.skills[0].triggers, ["summary"]);
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
    assert.equal(JSON.stringify(refreshed.body.skills).includes("EXTRA_BODY_SENTINEL"), false);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

function extractPanelAssetPaths(html: string): readonly string[] {
  const paths = new Set<string>();
  for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) {
    paths.add(match[1] ?? "");
  }
  return [...paths].filter((value) => value.length > 0);
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
