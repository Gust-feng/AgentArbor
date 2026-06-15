import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileSystemLocalDevSecretStore, FileSystemNormalSettingsStore } from "../../adapters/config/index.js";
import type {
  InformationAccess,
  InformationQuery,
  InformationReadRequest,
  InformationReadResult,
  InformationSearchResult,
  InformationSourceKind,
} from "../../domain/research/index.js";
import { ConfigCenter } from "../config-center.js";
import { createConfiguredToolCenter, createDefaultToolCenter } from "../model-runtime/index.js";
import type { FetchLike } from "../tool-center/index.js";
import { createDefaultResearchRuntime } from "./research-runtime.js";
import { createResearchReadTool, createResearchSearchTool } from "./research-tools.js";
import type { PageFetchLike } from "./source-adapters.js";

test("default ToolCenter exposes model-visible search and read tools", async () => {
  const center = createDefaultToolCenter({ env: {}, playwrightAvailable: true });
  const names = center.list().map((tool) => tool.name);

  assert.deepEqual(names, ["search", "read", "read_file", "list_dir", "grep_files", "create_file", "write_file", "edit_file", "delete_file", "shell_command", "http_request", "browser_snapshot"]);
  assert.equal(center.has("web_search"), false);

  const search = await center.execute(
    { callId: "call-search", toolName: "search", input: { query: "AgentArbor", sources: ["web"] } },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    { callerAgentId: "agent-test", allowedTools: ["search", "read"] }
  );

  assert.equal(search.status, "completed");
  assert.equal((search.output as { status?: string }).status, "no-provider");
});

test("research tool definitions describe only currently model-visible sources", () => {
  const runtime = createDefaultResearchRuntime({ env: {}, tavilyFetch: undefined });
  const search = createResearchSearchTool(runtime).definition;
  const read = createResearchReadTool(runtime).definition;
  const sourcesProperty = search.inputSchema.properties.sources as {
    readonly items?: { readonly enum?: readonly string[] };
    readonly description?: string;
  };
  const sourceOverrideProperty = read.inputSchema.properties.source as {
    readonly enum?: readonly string[];
    readonly description?: string;
  };

  assert.deepEqual(sourcesProperty.items?.enum, ["codebase"]);
  assert.equal(search.description.includes("docs"), false);
  assert.equal(search.description.includes("packages"), false);
  assert.equal(search.description.includes("github"), false);
  assert.equal(search.description.includes("soil"), false);
  assert.equal(search.description.includes("run_memory"), false);
  assert.equal(JSON.stringify(search.modelContract).includes("soil"), false);
  assert.equal(JSON.stringify(search.modelContract).includes("run memory"), false);
  assert.equal(JSON.stringify(search.modelContract).includes("run_memory"), false);
  assert.equal(sourcesProperty.description?.includes("docs"), false);
  assert.equal(sourcesProperty.description?.includes("soil"), false);
  assert.equal(sourcesProperty.items?.enum?.includes("soil"), false);
  assert.equal(sourcesProperty.items?.enum?.includes("run_memory"), false);
  assert.equal(sourceOverrideProperty.enum?.includes("docs"), false);
  assert.equal(sourceOverrideProperty.enum?.includes("soil"), false);
  assert.equal(sourceOverrideProperty.enum?.includes("run_memory"), false);
  assert.equal("site" in search.inputSchema.properties, true);
  assert.equal(JSON.stringify(search.modelContract).includes("site"), true);
  assert.equal(read.description.includes("contentPreview"), true);
  assert.equal(JSON.stringify(read.inputSchema.properties.ref).includes("array"), true);
  assert.equal(JSON.stringify(read.modelContract).includes("array"), true);
});

test("research tools keep explicitly requested hidden sources as no-provider facts", async () => {
  const runtime = createDefaultResearchRuntime({ env: {}, tavilyFetch: undefined });
  const searchTool = createResearchSearchTool(runtime);
  const readTool = createResearchReadTool(runtime);

  const search = await searchTool.execute(
    { query: "createResearchSearchTool", sources: ["soil", "run_memory"] },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" }
  );
  const read = await readTool.execute(
    { ref: "research:soil:unavailable", source: "soil" },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" }
  );

  assert.equal((search as { status?: string }).status, "no-provider");
  assert.deepEqual((search as { trace?: { requestedSources?: readonly string[] } }).trace?.requestedSources, ["soil", "run_memory"]);
  assert.equal((read as { status?: string }).status, "no-provider");
  assert.deepEqual((read as { trace?: { requestedSources?: readonly string[] } }).trace?.requestedSources, ["soil"]);
});

test("research read tool keeps single ref output compatible", async () => {
  const expected = fixedReadResult({
    ref: "research:codebase:one",
    status: "completed",
    source: "codebase",
    contentPreview: "single compatible content",
  });
  const runtime = fixedResearchRuntime({
    read: async () => expected,
  });
  const readTool = createResearchReadTool(runtime);

  const read = await readTool.execute(
    { ref: "research:codebase:one", maxLength: 100 },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" }
  );

  assert.deepEqual(read, expected);
});

test("research read tool exposes single-ref failure facts", async () => {
  const expected = fixedReadResult({
    ref: "http://127.0.0.1:43210/status",
    status: "provider-failed",
    source: "page",
    message: "http_request failed: ECONNREFUSED 127.0.0.1:43210",
    errorFacts: {
      code: "ECONNREFUSED",
      errno: -4078,
      syscall: "connect",
      address: "127.0.0.1",
      port: 43210,
      method: "GET",
      url: "http://127.0.0.1:43210/status",
      durationMs: 3,
    },
  });
  const runtime = fixedResearchRuntime({
    read: async () => expected,
  });
  const readTool = createResearchReadTool(runtime);

  const read = await readTool.execute(
    { ref: "http://127.0.0.1:43210/status" },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" }
  ) as InformationReadResult & {
    readonly error?: string;
    readonly errorFacts?: Readonly<Record<string, string | number | boolean>>;
  };

  assert.equal(read.status, "provider-failed");
  assert.match(read.error ?? "", /ECONNREFUSED/);
  assert.equal(read.errorFacts?.code, "ECONNREFUSED");
  assert.equal(read.errorFacts?.errno, -4078);
  assert.equal(read.errorFacts?.syscall, "connect");
  assert.equal(read.errorFacts?.address, "127.0.0.1");
  assert.equal(read.errorFacts?.port, 43210);
  assert.equal(read.errorFacts?.method, "GET");
  assert.equal(read.errorFacts?.url, "http://127.0.0.1:43210/status");
  assert.equal(read.errorFacts?.durationMs, 3);
});

test("research read tool batches multiple refs without changing per-item content", async () => {
  const calls: InformationReadRequest[] = [];
  const runtime = fixedResearchRuntime({
    read: async (request) => {
      calls.push(request);
      return fixedReadResult({
        ref: request.ref,
        status: "completed",
        source: "codebase",
        contentPreview: `content for ${request.ref}`,
      });
    },
  });
  const readTool = createResearchReadTool(runtime);

  const read = await readTool.execute(
    { ref: ["src/a.ts", "src/b.ts"], source: "codebase", maxLength: 200 },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" }
  ) as readonly {
    readonly ref: string;
    readonly status: string;
    readonly contentPreview?: string;
    readonly truncated: boolean;
    readonly source?: string;
  }[];

  assert.equal(Array.isArray(read), true);
  assert.deepEqual(calls.map((call) => ({ ref: call.ref, source: call.source, maxLength: call.maxLength })), [
    { ref: "src/a.ts", source: "codebase", maxLength: 200 },
    { ref: "src/b.ts", source: "codebase", maxLength: 200 },
  ]);
  assert.deepEqual(read.map((item) => item.ref), ["src/a.ts", "src/b.ts"]);
  assert.deepEqual(read.map((item) => item.status), ["completed", "completed"]);
  assert.deepEqual(read.map((item) => item.contentPreview), ["content for src/a.ts", "content for src/b.ts"]);
  assert.deepEqual(read.map((item) => item.truncated), [false, false]);
});

test("research read tool returns an empty batch without provider calls", async () => {
  let calls = 0;
  const runtime = fixedResearchRuntime({
    read: async () => {
      calls += 1;
      throw new Error("read should not be called for an empty batch");
    },
  });
  const readTool = createResearchReadTool(runtime);

  const read = await readTool.execute(
    { ref: [] },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" }
  );

  assert.deepEqual(read, []);
  assert.equal(calls, 0);
});

test("research read tool batch reports partial failures per ref", async () => {
  const runtime = fixedResearchRuntime({
    read: async (request) => {
      if (request.ref === "missing.md") {
        return fixedReadResult({
          ref: request.ref,
          status: "provider-failed",
          message: "codebase read could not read the requested text file.",
        });
      }
      if (request.ref === "throws.md") {
        throw new Error("adapter exploded");
      }
      return fixedReadResult({
        ref: request.ref,
        status: "completed",
        source: "codebase",
        contentPreview: "available content",
      });
    },
  });
  const readTool = createResearchReadTool(runtime);

  const read = await readTool.execute(
    { ref: ["ok.md", "missing.md", "throws.md"], source: "codebase" },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" }
  ) as readonly {
    readonly ref: string;
    readonly status: string;
    readonly contentPreview?: string;
    readonly truncated: boolean;
    readonly error?: string;
  }[];

  assert.deepEqual(read.map((item) => item.ref), ["ok.md", "missing.md", "throws.md"]);
  assert.deepEqual(read.map((item) => item.status), ["completed", "provider-failed", "provider-failed"]);
  assert.equal(read[0]?.contentPreview, "available content");
  assert.equal(read[1]?.error, "codebase read could not read the requested text file.");
  assert.equal(read[2]?.error, "adapter exploded");
  assert.equal(read.every((item) => typeof item.truncated === "boolean"), true);
});

test("research read tool batch preserves command-log successes and HTTP failure facts", async () => {
  const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:43210"), {
    code: "ECONNREFUSED",
    errno: -4078,
    syscall: "connect",
    address: "127.0.0.1",
    port: 43210,
  });
  const pageFetch: PageFetchLike = async () => {
    const error = new TypeError("fetch failed") as Error & { cause?: unknown };
    error.cause = cause;
    throw error;
  };
  const runtime = createDefaultResearchRuntime({
    pageFetch,
    commandLogRegistry: {
      read: (ref) => ref === "command-log://shell-batch"
        ? { content: "shell batch log\n" }
        : undefined,
    },
  });
  const readTool = createResearchReadTool(runtime);

  const read = await readTool.execute(
    { ref: ["command-log://shell-batch", "http://127.0.0.1:43210/status", "command-log://missing"] },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" }
  ) as readonly {
    readonly ref: string;
    readonly status: string;
    readonly contentPreview?: string;
    readonly error?: string;
    readonly errorFacts?: Readonly<Record<string, string | number | boolean>>;
  }[];

  assert.deepEqual(read.map((item) => item.status), ["completed", "provider-failed", "invalid-input"]);
  assert.equal(read[0]?.contentPreview, "shell batch log\n");
  assert.match(read[1]?.error ?? "", /ECONNREFUSED/);
  assert.equal(read[1]?.errorFacts?.code, "ECONNREFUSED");
  assert.equal(read[1]?.errorFacts?.errno, -4078);
  assert.equal(read[1]?.errorFacts?.syscall, "connect");
  assert.equal(read[1]?.errorFacts?.address, "127.0.0.1");
  assert.equal(read[1]?.errorFacts?.port, 43210);
  assert.equal(typeof read[1]?.errorFacts?.durationMs, "number");
  assert.equal(read[2]?.error, "Unknown or unregistered command log ref.");
});

test("research search tool passes site constraint into runtime query", async () => {
  let captured: InformationQuery | undefined;
  const runtime = fixedResearchRuntime({
    search: async (query) => {
      captured = query;
      return fixedSearchResult(query);
    },
  });
  const searchTool = createResearchSearchTool(runtime);

  const search = await searchTool.execute(
    { query: "AgentArbor", site: "example.com", sources: ["web"], limit: 3 },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" }
  ) as InformationSearchResult;

  assert.equal(captured?.query, "AgentArbor");
  assert.equal(captured?.site, "example.com");
  assert.deepEqual(captured?.sources, ["web"]);
  assert.equal(captured?.limit, 3);
  assert.equal(search.site, "example.com");
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

test("default ToolCenter folds search site into provider query without exposing the key", async () => {
  const bodies: Record<string, unknown>[] = [];
  const fetch: FetchLike = async (_url, init) => {
    bodies.push(JSON.parse(init.body) as Record<string, unknown>);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        results: [{ title: "Scoped", url: "https://example.test/scoped", content: "scoped snippet" }],
      }),
    };
  };
  const center = createDefaultToolCenter({
    env: {
      AGENTARBOR_TAVILY_API_KEY: "tvly-site-secret",
    },
    fetch,
    playwrightAvailable: true,
  });

  const search = await center.execute(
    { callId: "call-search-site", toolName: "search", input: { query: "AgentArbor", site: "https://Example.TEST/docs", sources: ["web"] } },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    { callerAgentId: "agent-test", allowedTools: ["search"] }
  );
  const output = search.output as {
    readonly site?: string;
    readonly results?: readonly { readonly metadata?: Readonly<Record<string, unknown>> }[];
  };

  assert.equal(search.status, "completed");
  assert.equal(bodies[0]?.query, "AgentArbor site:example.test");
  assert.equal(output.site, "https://Example.TEST/docs");
  assert.equal(output.results?.[0]?.metadata?.site, "https://Example.TEST/docs");
  assert.equal(JSON.stringify(search.output).includes("tvly-site-secret"), false);
});

test("configured ToolCenter reads Tavily config and registers search/read without exposing the configured key", async () => {
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

    assert.deepEqual(names, ["search", "read", "read_file", "list_dir", "grep_files", "create_file", "write_file", "edit_file", "delete_file", "shell_command", "http_request", "browser_snapshot"]);
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

    assert.deepEqual(names, ["search", "read", "read_file", "list_dir", "grep_files", "create_file", "write_file", "edit_file", "delete_file", "shell_command", "http_request", "browser_snapshot"]);
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

function fixedResearchRuntime(overrides: {
  readonly search?: (query: InformationQuery) => Promise<InformationSearchResult>;
  readonly read?: (request: InformationReadRequest) => Promise<InformationReadResult>;
}): InformationAccess {
  return {
    search: overrides.search ?? (async (query) => fixedSearchResult(query)),
    read: overrides.read ?? (async (request) => fixedReadResult({
      ref: request.ref,
      status: "completed",
      source: request.source ?? "codebase",
      contentPreview: "fixed content",
    })),
    getCapabilities: () => ({
      sources: [
        { source: "web", label: "web", searchable: true, readable: false, modelVisible: true },
        { source: "codebase", label: "codebase", searchable: true, readable: true, modelVisible: true },
      ],
      searchableSources: ["web", "codebase"],
      readableSources: ["codebase"],
      defaultSearchSources: ["web", "codebase"],
    }),
  };
}

function fixedSearchResult(query: InformationQuery): InformationSearchResult {
  return {
    action: "search",
    query: query.query,
    site: query.site,
    status: "empty",
    results: [],
    trace: {
      traceId: "research-trace-test",
      action: "search",
      query: query.query,
      site: query.site,
      requestedSources: query.sources ?? [],
      status: "empty",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:00.001Z",
      sourceSteps: [],
    },
  };
}

function fixedReadResult(input: {
  readonly ref: string;
  readonly status: InformationReadResult["status"];
  readonly source?: InformationSourceKind;
  readonly contentPreview?: string;
  readonly message?: string;
  readonly errorFacts?: Readonly<Record<string, string | number | boolean>>;
}): InformationReadResult {
  return {
    action: "read",
    ref: input.ref,
    status: input.status,
    result: input.status === "completed"
      ? {
          refId: `read:${input.ref}`,
          source: input.source ?? "codebase",
          title: input.ref,
          uri: input.source === "page" ? `https://example.test/${input.ref}` : `repo://${input.ref}`,
          status: "completed",
          summary: input.contentPreview ?? "",
          contentPreview: input.contentPreview,
          truncated: false,
          metadata: { fixture: true },
        }
      : undefined,
    trace: {
      traceId: "research-trace-test",
      action: "read",
      ref: input.ref,
      requestedSources: input.source === undefined ? [] : [input.source],
      status: input.status,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:00.001Z",
      sourceSteps: [
        {
          source: input.source ?? "codebase",
          status: input.status,
          resultRefs: input.status === "completed" ? [`read:${input.ref}`] : [],
          message: input.message,
          errorFacts: input.errorFacts,
        },
      ],
    },
  };
}
