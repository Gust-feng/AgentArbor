import assert from "node:assert/strict";
import test from "node:test";
import { createWebSearchTool, type FetchLike, type WebSearchToolOutput } from "./web-search-tool.js";

test("web_search maps Tavily results through injected fetch", async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body ?? "{}") as Record<string, unknown> });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          { title: "Result A", url: "https://example.test/a", content: "Snippet A" },
          { title: "Result B", url: "https://example.test/b", content: "Snippet B" },
        ],
      }),
    };
  };
  const tool = createWebSearchTool({ apiKey: "tvly-test-secret", maxResults: 1, fetch });

  const output = await tool.execute(
    { query: "AgentArbor ToolCenter" },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" }
  );

  assert.deepEqual(output, {
    provider: "tavily",
    status: "completed",
    searched: true,
    query: "AgentArbor ToolCenter",
    results: [{ title: "Result A", url: "https://example.test/a", snippet: "Snippet A" }],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.body.api_key, "tvly-test-secret");
});

test("web_search returns no_search_provider without API key", async () => {
  const tool = createWebSearchTool();

  const output = await tool.execute(
    { query: "AgentArbor ToolCenter" },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" }
  );

  assert.deepEqual(output, {
    provider: "none",
    status: "no_search_provider",
    searched: false,
    query: "AgentArbor ToolCenter",
    results: [],
    message: "No configured Tavily search provider; no live web search was performed.",
  });
});

test("web_search maps Exa search results and authenticates with x-api-key", async () => {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({
      url,
      headers: init.headers,
      body: JSON.parse(init.body ?? "{}") as Record<string, unknown>,
    });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            title: "Exa Result",
            url: "https://example.test/exa",
            highlights: ["Exa highlight"],
            publishedDate: "2026-06-01",
          },
        ],
      }),
    };
  };
  const tool = createWebSearchTool({ provider: "exa", apiKey: "exa-test-secret", maxResults: 3, fetch });

  const output = await tool.execute(
    { query: "AgentArbor Exa" },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" }
  ) as WebSearchToolOutput;

  assert.equal(output.provider, "exa");
  assert.deepEqual(output.results, [{
    title: "Exa Result",
    url: "https://example.test/exa",
    snippet: "Exa highlight",
    publishedAt: "2026-06-01",
  }]);
  assert.equal(calls[0]?.headers["x-api-key"], "exa-test-secret");
  assert.equal(calls[0]?.body.numResults, 3);
});

test("web_search maps Z.AI web search results", async () => {
  const calls: { headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetch: FetchLike = async (_url, init) => {
    calls.push({
      headers: init.headers,
      body: JSON.parse(init.body ?? "{}") as Record<string, unknown>,
    });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        search_result: [
          {
            title: "ZAI Result",
            link: "https://example.test/zai",
            content: "ZAI snippet",
            media: "Example",
            publish_date: "2026-06-02",
          },
        ],
      }),
    };
  };
  const tool = createWebSearchTool({ provider: "zai", apiKey: "zai-test-secret", maxResults: 2, fetch });

  const output = await tool.execute(
    { query: "AgentArbor ZAI" },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" }
  ) as WebSearchToolOutput;

  assert.equal(output.provider, "zai");
  assert.deepEqual(output.results, [{
    title: "ZAI Result",
    url: "https://example.test/zai",
    snippet: "ZAI snippet",
    source: "Example",
    publishedAt: "2026-06-02",
  }]);
  assert.equal(calls[0]?.headers.authorization, "Bearer zai-test-secret");
  assert.equal(calls[0]?.body.search_query, "AgentArbor ZAI");
});

test("web_search maps Metaso search references and authenticates with bearer token", async () => {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({
      url,
      headers: init.headers,
      body: JSON.parse(init.body ?? "{}") as Record<string, unknown>,
    });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          resultId: "metaso-result-1",
          text: "Metaso answer text",
          references: [
            {
              title: "Metaso Result",
              url: "https://example.test/metaso",
              summary: "Metaso snippet",
              siteName: "Example",
            },
          ],
        },
      }),
    };
  };
  const tool = createWebSearchTool({ provider: "metaso", apiKey: "metaso-test-secret", maxResults: 2, fetch });

  const output = await tool.execute(
    { query: "AgentArbor Metaso" },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" }
  ) as WebSearchToolOutput;

  assert.equal(output.provider, "metaso");
  assert.deepEqual(output.results, [{
    title: "Metaso Result",
    url: "https://example.test/metaso",
    snippet: "Metaso snippet",
    source: "Example",
  }]);
  assert.match(calls[0]?.url ?? "", /metaso\.cn\/api\/open\/search\/v2/);
  assert.equal(calls[0]?.headers.authorization, "Bearer metaso-test-secret");
  assert.equal(calls[0]?.body.question, "AgentArbor Metaso");
  assert.equal(calls[0]?.body.lang, "zh");
});

test("web_search maps Google Custom Search results and requires cx", async () => {
  const urls: string[] = [];
  const fetch: FetchLike = async (url, init) => {
    urls.push(url);
    assert.equal(init.method, "GET");
    return {
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            title: "Google Result",
            link: "https://example.test/google",
            snippet: "Google snippet",
            displayLink: "example.test",
          },
        ],
      }),
    };
  };
  const missingCx = createWebSearchTool({ provider: "google", apiKey: "google-test-secret", fetch });
  const blocked = await missingCx.execute(
    { query: "AgentArbor Google" },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" }
  ) as WebSearchToolOutput;
  const tool = createWebSearchTool({
    provider: "google",
    apiKey: "google-test-secret",
    googleEngineId: "engine-test",
    maxResults: 20,
    fetch,
  });

  const output = await tool.execute(
    { query: "AgentArbor Google" },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" }
  ) as WebSearchToolOutput;

  assert.equal(blocked.status, "no_search_provider");
  assert.equal(output.provider, "google");
  assert.deepEqual(output.results, [{
    title: "Google Result",
    url: "https://example.test/google",
    snippet: "Google snippet",
    source: "example.test",
  }]);
  const url = new URL(urls[0] ?? "");
  assert.equal(url.searchParams.get("cx"), "engine-test");
  assert.equal(url.searchParams.get("num"), "10");
});

test("web_search maps legacy Bing Web Search results", async () => {
  const urls: string[] = [];
  const headers: Record<string, string>[] = [];
  const fetch: FetchLike = async (url, init) => {
    urls.push(url);
    headers.push(init.headers);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        webPages: {
          value: [
            {
              name: "Bing Result",
              url: "https://example.test/bing",
              snippet: "Bing snippet",
              dateLastCrawled: "2026-06-03",
            },
          ],
        },
      }),
    };
  };
  const tool = createWebSearchTool({
    provider: "bing",
    apiKey: "bing-test-secret",
    bingMarket: "en-US",
    maxResults: 4,
    fetch,
  });

  const output = await tool.execute(
    { query: "AgentArbor Bing" },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" }
  ) as WebSearchToolOutput;

  assert.equal(output.provider, "bing");
  assert.deepEqual(output.results, [{
    title: "Bing Result",
    url: "https://example.test/bing",
    snippet: "Bing snippet",
    publishedAt: "2026-06-03",
  }]);
  assert.equal(headers[0]?.["Ocp-Apim-Subscription-Key"], "bing-test-secret");
  assert.equal(new URL(urls[0] ?? "").searchParams.get("mkt"), "en-US");
});
