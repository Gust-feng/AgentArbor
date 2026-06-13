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

test("ResearchRuntime soil and run_memory sources expose refs without inline asset bodies", async () => {
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
  const read = await runtime.read({ ref: runMemory.results[0]!.refId });

  assert.equal(soil.status, "completed");
  assert.equal(soil.results[0]?.source, "soil");
  assert.equal(runMemory.status, "completed");
  assert.equal(runMemory.results[0]?.source, "run_memory");
  assert.equal(read.result?.summary.includes("Similar task"), true);
});

test("ResearchRuntime docs packages and github adapters are explicit stubs", async () => {
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

    assert.equal(search.status, "stub");
    assert.equal(search.results.length, 0);
    assert.equal(read.status, "stub");
    assert.equal(read.result?.source, source);
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
