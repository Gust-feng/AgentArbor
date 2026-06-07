import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileSystemLocalDevSecretStore, FileSystemNormalSettingsStore } from "../../adapters/config/index.js";
import { ConfigCenter } from "../config-center.js";
import { createConfiguredToolCenter, createDefaultToolCenter } from "../model-runtime/index.js";
import type { FetchLike } from "../tool-center/index.js";

test("default ToolCenter exposes model-visible search and read tools", async () => {
  const center = createDefaultToolCenter({ env: {}, playwrightAvailable: true });
  const names = center.list().map((tool) => tool.name);

  assert.deepEqual(names, ["search", "read", "read_file", "list_dir", "grep_files", "create_file", "edit_file", "delete_file", "run_command", "browser_snapshot"]);
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
    playwrightAvailable: true,
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

test("configured ToolCenter reads Tavily config, registers search/read, and redacts the key", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-configured-tool-center-"));
  const bodies: Record<string, unknown>[] = [];
  const fetch: FetchLike = async (_url, init) => {
    bodies.push(JSON.parse(init.body) as Record<string, unknown>);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        results: [{ title: "Configured search", url: "https://example.test/configured", content: "configured snippet" }],
      }),
    };
  };
  try {
    const configCenter = new ConfigCenter({
      settingsStore: new FileSystemNormalSettingsStore(directory),
      secretStore: new FileSystemLocalDevSecretStore(directory),
    });
    await configCenter.updateWebSearchConfig({
      provider: "tavily",
      apiKey: "tvly-configured-tool-secret",
      maxResults: 1,
    });

    const center = await createConfiguredToolCenter(configCenter, { fetch, playwrightAvailable: true });
    const names = center.list().map((tool) => tool.name);
    const search = await center.execute(
      { callId: "call-search", toolName: "search", input: { query: "AgentArbor", sources: ["web"] } },
      { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
      { callerAgentId: "agent-test", allowedTools: ["search", "read"] }
    );

    assert.deepEqual(names, ["search", "read", "read_file", "list_dir", "grep_files", "create_file", "edit_file", "delete_file", "run_command", "browser_snapshot"]);
    assert.equal(search.status, "completed");
    assert.equal(bodies[0]?.max_results, 1);
    assert.equal(JSON.stringify(search.output).includes("tvly-configured-tool-secret"), false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("configured ToolCenter still registers search/read and degrades web search without Tavily key", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-configured-tool-center-nokey-"));
  try {
    const configCenter = new ConfigCenter({
      settingsStore: new FileSystemNormalSettingsStore(directory),
      secretStore: new FileSystemLocalDevSecretStore(directory),
    });
    const center = await createConfiguredToolCenter(configCenter, { playwrightAvailable: true });
    const names = center.list().map((tool) => tool.name);
    const search = await center.execute(
      { callId: "call-search", toolName: "search", input: { query: "AgentArbor", sources: ["web"] } },
      { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
      { callerAgentId: "agent-test", allowedTools: ["search", "read"] }
    );

    assert.deepEqual(names, ["search", "read", "read_file", "list_dir", "grep_files", "create_file", "edit_file", "delete_file", "run_command", "browser_snapshot"]);
    assert.equal(search.status, "completed");
    assert.equal((search.output as { status?: string }).status, "no-provider");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("configured ToolCenter uses workspaceRoot for local tools", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-tool-center-workspace-config-"));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-tool-center-workspace-"));
  try {
    await fs.writeFile(path.join(workspace, "note.txt"), "workspace note", "utf8");
    const configCenter = new ConfigCenter({
      settingsStore: new FileSystemNormalSettingsStore(directory),
      secretStore: new FileSystemLocalDevSecretStore(directory),
    });
    const center = await createConfiguredToolCenter(configCenter, { workspaceRoot: workspace, playwrightAvailable: true });
    const read = await center.execute(
      { callId: "call-read-file", toolName: "read_file", input: { path: "note.txt" } },
      { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
      { callerAgentId: "agent-test", allowedTools: ["read_file"] }
    );

    assert.equal(read.status, "completed");
    assert.equal((read.output as { refId?: string }).refId, "workspace:file:note.txt");
    assert.equal(JSON.stringify(read.output).includes("workspace note"), true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("configured ToolCenter uses workspaceRoot for codebase research search", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-tool-center-codebase-config-"));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-tool-center-codebase-"));
  try {
    const query = `workspace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-sentinel`;
    await fs.writeFile(path.join(workspace, "research-note.md"), `Only this workspace contains ${query}.`, "utf8");
    const configCenter = new ConfigCenter({
      settingsStore: new FileSystemNormalSettingsStore(directory),
      secretStore: new FileSystemLocalDevSecretStore(directory),
    });
    const center = await createConfiguredToolCenter(configCenter, { workspaceRoot: workspace, playwrightAvailable: true });
    const search = await center.execute(
      { callId: "call-search-codebase", toolName: "search", input: { query, sources: ["codebase"] } },
      { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
      { callerAgentId: "agent-test", allowedTools: ["search"] }
    );
    const output = search.output as {
      readonly results?: readonly {
        readonly title?: string;
        readonly uri?: string;
      }[];
    };

    assert.equal(search.status, "completed");
    assert.equal(output.results?.some((result) => result.title === "research-note.md"), true);
    assert.equal(output.results?.some((result) => result.uri === "repo://research-note.md"), true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("configured ToolCenter keeps web search disabled even when a historical Tavily key exists", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-configured-tool-center-disabled-"));
  let fetchCalls = 0;
  const fetch: FetchLike = async () => {
    fetchCalls += 1;
    throw new Error("Disabled web search provider must not call Tavily fetch.");
  };
  try {
    const configCenter = new ConfigCenter({
      settingsStore: new FileSystemNormalSettingsStore(directory),
      secretStore: new FileSystemLocalDevSecretStore(directory),
    });
    await configCenter.updateWebSearchConfig({
      provider: "tavily",
      apiKey: "tvly-disabled-tool-secret",
      maxResults: 1,
    });
    await configCenter.updateWebSearchConfig({ provider: "none" });

    const center = await createConfiguredToolCenter(configCenter, { fetch, playwrightAvailable: true });
    const search = await center.execute(
      { callId: "call-search", toolName: "search", input: { query: "AgentArbor", sources: ["web"] } },
      { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
      { callerAgentId: "agent-test", allowedTools: ["search", "read"] }
    );

    assert.equal(search.status, "completed");
    assert.equal((search.output as { status?: string }).status, "no-provider");
    assert.equal(JSON.stringify(search.output).includes("tvly-disabled-tool-secret"), false);
    assert.equal(fetchCalls, 0);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
