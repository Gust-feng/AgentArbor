import { afterEach, expect, test, vi } from "vitest";
import { loadAppBootstrap } from "./app-bootstrap";
import { isMultiAgentEntryEnabled, MULTI_AGENT_ENTRY_AVAILABLE } from "./app-multi-agent-availability";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("the paused Multi-Agent release entry ignores an existing beta preference", () => {
  expect(MULTI_AGENT_ENTRY_AVAILABLE).toBe(false);
  expect(isMultiAgentEntryEnabled(false)).toBe(false);
  expect(isMultiAgentEntryEnabled(true)).toBe(false);
});

test("bootstrap does not load Multi-Agent history while its entry is unavailable", async () => {
  const requestedPaths: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    requestedPaths.push(path);
    return jsonResponse(responseFor(path));
  }));

  const bootstrap = await loadAppBootstrap();

  expect(requestedPaths.some((path) => path.startsWith("/api/deep/"))).toBe(false);
  expect(bootstrap.deepConversations).toEqual([]);
  expect(bootstrap.deepRuns).toEqual([]);
});

function responseFor(path: string): unknown {
  switch (path) {
    case "/api/config": return {};
    case "/api/config/tools": return {};
    case "/api/config/mcp": return {};
    case "/api/app/update": return { status: "idle" };
    case "/api/skills": return { skills: [] };
    case "/api/config/sub-agents": return { subAgents: [] };
    case "/api/conversations": return { conversations: [] };
    default: throw new Error(`Unexpected bootstrap request: ${path}`);
  }
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
