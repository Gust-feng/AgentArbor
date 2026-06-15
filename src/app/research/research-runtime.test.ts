import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { InMemoryReadonlySoilStore } from "../../domain/soil/index.js";
import type { Constraint } from "../../domain/constraints.js";
import {
  createCodebaseInformationSourceAdapter,
  createDefaultResearchRuntime,
  createPageInformationSourceAdapter,
  createStubInformationSourceAdapter,
  ResearchRuntime,
  type InformationSourceAdapter,
  type PageFetchLike,
} from "./index.js";
import type { FetchLike as TavilyFetchLike } from "../tool-center/adapters/web-search-tool.js";

test("ResearchRuntime web source returns no-provider without Tavily key", async () => {
  const runtime = createDefaultResearchRuntime({ env: {}, tavilyFetch: undefined });

  const result = await runtime.search({ query: "AgentArbor research", sources: ["web"] });

  assert.equal(result.status, "no-provider");
  assert.equal(result.results.length, 0);
  assert.equal(result.trace.sourceSteps[0]?.source, "web");
  assert.equal(result.trace.sourceSteps[0]?.status, "no-provider");
});

test("ResearchRuntime default model-visible search sources exclude unavailable stubs", async () => {
  const runtime = createDefaultResearchRuntime({ env: {}, tavilyFetch: undefined });

  const capabilities = runtime.getCapabilities();
  const result = await runtime.search({ query: "AgentArbor research" });

  assert.deepEqual(capabilities.defaultSearchSources, ["codebase"]);
  assert.equal(capabilities.sources.find((source) => source.source === "docs")?.modelVisible, false);
  assert.equal(capabilities.sources.find((source) => source.source === "packages")?.modelVisible, false);
  assert.equal(capabilities.sources.find((source) => source.source === "github")?.modelVisible, false);
  assert.equal(capabilities.sources.find((source) => source.source === "soil")?.modelVisible, false);
  assert.equal(capabilities.sources.find((source) => source.source === "run_memory")?.modelVisible, false);
  assert.deepEqual(result.trace.requestedSources, ["codebase"]);
  assert.equal(result.trace.requestedSources.includes("docs"), false);
  assert.equal(result.trace.requestedSources.includes("packages"), false);
  assert.equal(result.trace.requestedSources.includes("github"), false);
  assert.equal(result.trace.requestedSources.includes("soil"), false);
  assert.equal(result.trace.requestedSources.includes("run_memory"), false);
});

test("ResearchRuntime search returns a top-level message for empty queries", async () => {
  const runtime = createDefaultResearchRuntime({ env: {}, tavilyFetch: undefined });

  const result = await runtime.search({ query: "" });

  assert.equal(result.status, "invalid-input");
  assert.equal(result.message, "search requires a non-empty query.");
  assert.equal(result.results.length, 0);
  assert.equal(result.trace.sourceSteps[0]?.message, "search requires a non-empty query.");
});

test("ResearchRuntime explicit hidden stub sources degrade to no-provider instead of returning stub payloads", async () => {
  const runtime = createDefaultResearchRuntime({ env: {}, tavilyFetch: undefined });

  const search = await runtime.search({ query: "provider", sources: ["docs"] });
  const read = await runtime.read({ ref: "research:docs:stub", source: "docs" });

  assert.equal(search.status, "no-provider");
  assert.equal(search.results.length, 0);
  assert.equal(search.trace.sourceSteps[0]?.status, "no-provider");
  assert.equal(read.status, "no-provider");
  assert.equal(read.result, undefined);
  assert.equal(read.trace.sourceSteps[0]?.status, "no-provider");
});

test("ResearchRuntime follows configured source preference and links search trace refs", async () => {
  const runtime = new ResearchRuntime({
    sourcePreference: ["codebase", "web"],
    defaultLimit: 1,
    adapters: [
      fixedSearchAdapter("web", "research:web:late", "Late web result"),
      fixedSearchAdapter("codebase", "research:codebase:first", "First codebase result"),
    ],
  });

  const result = await runtime.search({ query: "AgentArbor" });

  assert.equal(result.status, "completed");
  assert.deepEqual(result.trace.requestedSources, ["codebase", "web"]);
  assert.deepEqual(result.results.map((item) => item.refId), ["research:codebase:first"]);
  assert.deepEqual(result.trace.sourceSteps[0]?.resultRefs, ["research:codebase:first"]);
  assert.equal(result.trace.sourceSteps.length, 1);
});

test("ResearchRuntime searches web refs and reads selected pages through previews", async () => {
  const secret = "tvly-research-secret";
  const tavilyCalls: Record<string, unknown>[] = [];
  const tavilyFetch: TavilyFetchLike = async (_url, init) => {
    tavilyCalls.push(JSON.parse(init.body) as Record<string, unknown>);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            title: "Research Runtime",
            url: "https://example.test/research",
            content: "Short search snippet.",
          },
        ],
      }),
    };
  };
  const pageFetch: PageFetchLike = async () => ({
    ok: true,
    status: 200,
    text: async () =>
      "<html><head><script>secret()</script></head><body><h1>Research Runtime</h1><p>Clean page body for AgentArbor.</p></body></html>",
  });
  const runtime = createDefaultResearchRuntime({
    env: { AGENTARBOR_TAVILY_API_KEY: secret },
    tavilyFetch,
    pageFetch,
  });

  const search = await runtime.search({ query: "Research Runtime", sources: ["web"] });
  const read = await runtime.read({ ref: search.results[0]!.refId, maxLength: 80 });
  const serialized = JSON.stringify({ search, read });

  assert.equal(search.status, "completed");
  assert.equal(search.results[0]?.source, "web");
  assert.equal(read.status, "completed");
  assert.equal(read.result?.source, "page");
  assert.equal(read.result?.sourceSearchRef, search.results[0]?.refId);
  assert.equal(read.result?.contentPreview?.includes("Clean page body"), true);
  assert.equal(read.result?.contentPreview?.includes("secret()"), false);
  assert.equal(serialized.includes(secret), false);
  assert.equal(tavilyCalls[0]?.api_key, secret);
});

test("ResearchRuntime page source rejects invalid URLs and degrades when fetch is unavailable", async () => {
  const globalWithFetch = globalThis as { fetch?: PageFetchLike };
  const originalFetch = globalWithFetch.fetch;
  globalWithFetch.fetch = undefined;
  try {
    const adapter = createPageInformationSourceAdapter();

    const invalid = await adapter.read!({ ref: "repo://README.md", maxLength: 200 });
    const missingProvider = await adapter.read!({ ref: "https://example.test/research", maxLength: 200 });

    assert.equal(invalid.status, "invalid-input");
    assert.equal(missingProvider.status, "no-provider");
  } finally {
    globalWithFetch.fetch = originalFetch;
  }
});

test("ResearchRuntime page read returns structured HTTP failure facts", async () => {
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
  const runtime = createDefaultResearchRuntime({ pageFetch });

  const read = await runtime.read({ ref: "http://127.0.0.1:43210/status" });
  const step = read.trace.sourceSteps[0];

  assert.equal(read.status, "provider-failed");
  assert.equal(step?.source, "page");
  assert.equal(step?.status, "provider-failed");
  assert.match(step?.message ?? "", /ECONNREFUSED/);
  assert.equal(step?.errorFacts?.code, "ECONNREFUSED");
  assert.equal(step?.errorFacts?.errno, -4078);
  assert.equal(step?.errorFacts?.syscall, "connect");
  assert.equal(step?.errorFacts?.address, "127.0.0.1");
  assert.equal(step?.errorFacts?.port, 43210);
  assert.equal(step?.errorFacts?.method, "GET");
  assert.equal(step?.errorFacts?.url, "http://127.0.0.1:43210/status");
  assert.equal(typeof step?.errorFacts?.durationMs, "number");
});

test("ResearchRuntime page read returns HTTP status facts for non-OK responses", async () => {
  const pageFetch: PageFetchLike = async () => ({
    ok: false,
    status: 500,
    statusText: "Internal Server Error",
    text: async () => "server failed",
  });
  const runtime = createDefaultResearchRuntime({ pageFetch });

  const read = await runtime.read({ ref: "https://example.test/fail" });
  const step = read.trace.sourceSteps[0];

  assert.equal(read.status, "provider-failed");
  assert.equal(step?.source, "page");
  assert.equal(step?.status, "provider-failed");
  assert.equal(step?.message, "Page read returned HTTP 500.");
  assert.equal(step?.errorFacts?.statusCode, 500);
  assert.equal(step?.errorFacts?.statusText, "Internal Server Error");
  assert.equal(step?.errorFacts?.method, "GET");
  assert.equal(step?.errorFacts?.url, "https://example.test/fail");
  assert.equal(typeof step?.errorFacts?.durationMs, "number");
});

test("ResearchRuntime reads only registered command-log refs", async () => {
  const codebaseRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-research-command-log-codebase-"));
  const logRef = "command-log://shell-abc123";
  try {
    await fs.writeFile(path.join(codebaseRoot, "shell-abc123"), "must not be read through command-log fallback", "utf8");
    const runtime = createDefaultResearchRuntime({
      codebaseRoot,
      commandLogRegistry: {
        read: async (ref) => ref === logRef
          ? {
              title: "shell command log",
              content: "background-ready\nserver listening\n",
              metadata: { pid: 1234 },
            }
          : undefined,
      },
    });

    const registered = await runtime.read({ ref: logRef, maxLength: 200 });
    const unknown = await runtime.read({ ref: "command-log://shell-unknown", maxLength: 200 });
    const illegal = await runtime.read({ ref: "command-log://../shell-abc123", maxLength: 200 });

    assert.equal(registered.status, "completed");
    assert.equal(registered.result?.source, "command_log");
    assert.equal(registered.result?.uri, logRef);
    assert.equal(registered.result?.contentPreview, "background-ready\nserver listening\n");
    assert.equal(registered.result?.metadata?.refKind, "command_log");
    assert.equal(registered.result?.metadata?.pid, 1234);
    assert.equal(unknown.status, "invalid-input");
    assert.equal(unknown.result, undefined);
    assert.equal(unknown.trace.sourceSteps[0]?.message, "Unknown or unregistered command log ref.");
    assert.equal(illegal.status, "invalid-input");
    assert.equal(illegal.result, undefined);
    assert.equal(JSON.stringify({ unknown, illegal }).includes("must not be read"), false);
  } finally {
    await fs.rm(codebaseRoot, { recursive: true, force: true });
  }
});

test("ResearchRuntime codebase adapter searches and reads repository text files", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-research-codebase-"));
  try {
    await fs.writeFile(path.join(directory, "module.ts"), "export const marker = 'ResearchRuntime codebase search';\n");
    const runtime = createDefaultResearchRuntime({ codebaseRoot: directory });

    const search = await runtime.search({ query: "ResearchRuntime", sources: ["codebase"] });
    const read = await runtime.read({ ref: search.results[0]!.refId });

    assert.equal(search.status, "completed");
    assert.equal(search.results[0]?.uri, "repo://module.ts");
    assert.equal(read.status, "completed");
    assert.equal(read.result?.uri, "repo://module.ts");
    assert.equal(read.result?.contentPreview?.includes("ResearchRuntime codebase search"), true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("ResearchRuntime codebase adapter rejects path traversal reads", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-research-codebase-"));
  try {
    const adapter = createCodebaseInformationSourceAdapter({ rootDirectory: directory });

    const read = await adapter.read!({ ref: "../outside.txt", maxLength: 200 });

    assert.equal(read.status, "invalid-input");
    assert.equal(read.message?.includes("escapes repository root"), true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("ResearchRuntime exposes Soil refs but keeps Run Memory hidden until enabled", async () => {
  const constraint: Constraint = {
    id: "constraint:research",
    source: "soil",
    type: "technical",
    level: "hard",
    statement: "Research output must remain candidate evidence.",
    owner: "underground_center",
    appliesTo: ["direction_handoff"],
    enforcementGate: "direction_handoff",
    conflictPolicy: "block",
    status: "active",
    evidenceRefs: ["spec:research"],
  };
  const soilStore = new InMemoryReadonlySoilStore({
    constraints: [constraint],
    historicalRunRefs: [
      {
        id: "soil:run-memory:similar-task",
        kind: "historical_run",
        summary: "Similar task used a no-provider search fallback.",
        evidenceRefs: ["event:tool.completed"],
      },
    ],
  });
  const runtime = createDefaultResearchRuntime({ soilStore });

  const soil = await runtime.search({ query: "candidate evidence", sources: ["soil"] });
  const runMemory = await runtime.search({ query: "fallback", sources: ["run_memory"] });
  const read = await runtime.read({ ref: "soil:run-memory:similar-task", source: "run_memory" });

  assert.equal(soil.status, "completed");
  assert.equal(soil.results[0]?.source, "soil");
  assert.equal(runMemory.status, "no-provider");
  assert.equal(runMemory.results.length, 0);
  assert.equal(runMemory.message, "Run Memory is not enabled in the current ordinary Agent tool contract.");
  assert.equal(read.status, "no-provider");
  assert.equal(read.result, undefined);
});

test("ResearchRuntime keeps empty Soil stores out of model-visible search sources", async () => {
  const runtime = createDefaultResearchRuntime({
    soilStore: new InMemoryReadonlySoilStore({ constraints: [] }),
  });

  const capabilities = runtime.getCapabilities();
  const search = await runtime.search({ query: "anything" });
  const explicitSoil = await runtime.search({ query: "anything", sources: ["soil"] });

  assert.equal(capabilities.sources.find((source) => source.source === "soil")?.modelVisible, false);
  assert.equal(capabilities.defaultSearchSources.includes("soil"), false);
  assert.equal(search.trace.requestedSources.includes("soil"), false);
  assert.equal(explicitSoil.status, "no-provider");
  assert.equal(explicitSoil.message, "No readonly Soil refs are configured.");
});

test("ResearchRuntime docs packages and github adapters stay hidden from model-visible execution", async () => {
  const runtime = new ResearchRuntime({
    adapters: [
      createStubInformationSourceAdapter("docs"),
      createStubInformationSourceAdapter("packages"),
      createStubInformationSourceAdapter("github"),
    ],
  });

  for (const source of ["docs", "packages", "github"] as const) {
    const search = await runtime.search({ query: "provider", sources: [source] });
    const read = await runtime.read({ ref: `research:${source}:stub`, source });

    assert.equal(search.status, "no-provider");
    assert.equal(search.results.length, 0);
    assert.equal(read.status, "no-provider");
    assert.equal(read.result, undefined);
  }
});

function fixedSearchAdapter(
  source: "web" | "codebase",
  refId: string,
  title: string
): InformationSourceAdapter {
  return {
    source,
    async search(request) {
      return {
        status: "completed",
        results: [
          {
            refId,
            source,
            title,
            uri: source === "web" ? "https://example.test" : `repo://${title}.md`,
            snippet: `${title} for ${request.query}`,
            status: "available",
          },
        ],
      };
    },
  };
}
