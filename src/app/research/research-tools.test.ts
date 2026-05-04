import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultToolCenter } from "../intelligence-channel-factory.js";
import type { FetchLike } from "../tool-center/index.js";

test("default ToolCenter exposes model-visible search and read tools", async () => {
  const center = createDefaultToolCenter({ env: {} });
  const names = center.list().map((tool) => tool.name);

  assert.deepEqual(names, ["search", "read"]);
  assert.equal(center.has("web_search"), false);

  const search = await center.execute(
    { callId: "call-search", toolName: "search", input: { query: "AgentArbor", sources: ["web"] } },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    { callerAgentId: "agent-test", allowedTools: ["search", "read"] }
  );

  assert.equal(search.status, "completed");
  assert.equal((search.output as { status?: string }).status, "no-provider");
});

test("default ToolCenter passes configured Tavily max results into ResearchRuntime", async () => {
  const bodies: Record<string, unknown>[] = [];
  const fetch: FetchLike = async (_url, init) => {
    bodies.push(JSON.parse(init.body) as Record<string, unknown>);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          { title: "A", url: "https://example.test/a", content: "alpha" },
          { title: "B", url: "https://example.test/b", content: "beta" },
          { title: "C", url: "https://example.test/c", content: "gamma" },
        ],
      }),
    };
  };
  const center = createDefaultToolCenter({
    env: {
      AGENTARBOR_TAVILY_API_KEY: "tvly-configured-secret",
      AGENTARBOR_TAVILY_MAX_RESULTS: "2",
    },
    fetch,
  });

  const search = await center.execute(
    { callId: "call-search", toolName: "search", input: { query: "AgentArbor", sources: ["web"] } },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    { callerAgentId: "agent-test", allowedTools: ["search"] }
  );
  const output = search.output as { results?: readonly unknown[] };

  assert.equal(search.status, "completed");
  assert.equal(bodies[0]?.max_results, 2);
  assert.equal(output.results?.length, 2);
  assert.equal(JSON.stringify(search.output).includes("tvly-configured-secret"), false);
});
