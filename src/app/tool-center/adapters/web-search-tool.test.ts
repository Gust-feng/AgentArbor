import assert from "node:assert/strict";
import test from "node:test";
import { createWebSearchTool, type FetchLike } from "./web-search-tool.js";

test("web_search maps Tavily results through injected fetch", async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
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
    message: "No configured search provider; no live web search was performed. Set a Tavily API key to enable live search.",
  });
});
