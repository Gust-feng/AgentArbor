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
import { ConfigCenter } from "../config-center/index.js";
import { ToolCenter, type FetchLike } from "../tool-center/index.js";
import { projectToolDisplay } from "../tool-projection/tool-display-projection.js";
import { createDefaultResearchRuntime } from "./research-runtime.js";
import { createResearchReadTool, createResearchSearchTool } from "./research-tools.js";
import {
  createConfiguredResearchToolCenter,
  createResearchEnabledToolCenter,
} from "./research-tool-contribution.js";
import type { PageFetchLike } from "./source-adapters.js";

const suggestionPattern = /\btry\b|\bprovide\b|\bsuggest|\brecommend\b|recoveryHint|\u5efa\u8bae/iu;

test("default ToolCenter exposes model-visible search and read tools", async () => {
  const center = createResearchEnabledToolCenter({ env: {}, playwrightAvailable: true });
  const names = center.list().map((tool) => tool.name);

  assertCoreDesktopToolNames(names);
  assert.equal(center.has("web_search"), false);

  const search = await center.execute(
    { callId: "call-search", toolName: "search", input: { query: "AgentArbor", sources: ["web"] } },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    { callerAgentId: "agent-test", allowedTools: ["search", "read"] }
  );
  const output = search.output as { readonly researchStatus?: string };

  assert.equal(search.status, "completed");
  assertDirectToolFacts(search.output);
  assert.equal(output.researchStatus, "no-provider");
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
  const searchFacts = search as {
    readonly researchStatus?: string;
    readonly requestedSources?: readonly string[];
  };
  const readFacts = read as {
    readonly researchStatus?: string;
    readonly requestedSources?: readonly string[];
  };

  assertDirectToolFacts(search);
  assertDirectToolFacts(read);
  assert.equal(searchFacts.researchStatus, "no-provider");
  assert.deepEqual(searchFacts.requestedSources, ["soil", "run_memory"]);
  assert.equal(readFacts.researchStatus, "no-provider");
  assert.deepEqual(readFacts.requestedSources, ["soil"]);
});

test("research read tool returns direct single-ref facts", async () => {
  const contentPreview = "single ref content";
  const expected = fixedReadResult({
    ref: "research:codebase:one",
    status: "completed",
    source: "codebase",
    contentPreview,
  });
  const runtime = fixedResearchRuntime({
    read: async () => expected,
  });
  const readTool = createResearchReadTool(runtime);

  const read = await readTool.execute(
    { ref: "research:codebase:one", maxLength: 100 },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" }
  );

  assertDirectToolFacts(read);
  const facts = read as {
    readonly ref?: string;
    readonly researchStatus?: string;
    readonly refId?: string;
    readonly source?: string;
    readonly contentPreview?: string;
    readonly truncated?: boolean;
  };
  assert.equal(facts.ref, expected.ref);
  assert.equal(facts.researchStatus, expected.status);
  assert.equal(facts.refId, "read:research:codebase:one");
  assert.equal(facts.source, "codebase");
  assert.equal(facts.contentPreview, contentPreview);
  assert.equal(facts.truncated, false);
});

test("research read tool continues from the first unread character without repeating content", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-research-read-continuation-"));
  const source = `${"a".repeat(200)}${"b".repeat(200)}${"c".repeat(50)}`;
  await fs.writeFile(path.join(directory, "long.txt"), source, "utf8");
  try {
    const readTool = createResearchReadTool(createDefaultResearchRuntime({ codebaseRoot: directory }));
    let nextInput: Readonly<Record<string, unknown>> = {
      ref: "long.txt",
      source: "codebase",
      maxLength: 200,
    };
    const chunks: string[] = [];
    const starts: number[] = [];

    for (;;) {
      const output = await readTool.execute(nextInput, {
        callerAgentId: "agent-test",
        traceId: "trace-test",
        goalId: "goal-test",
      }) as Readonly<Record<string, unknown>>;
      const preview = String(output.contentPreview ?? "");
      chunks.push(preview);
      starts.push(Number(output.startChar));
      if (output.truncated !== true) {
        assert.equal(output.continuation, undefined);
        break;
      }
      const continuation = asRecord(output.continuation);
      nextInput = asRecord(continuation.nextInput);
      assert.equal(Number(nextInput.startChar), starts.at(-1)! + preview.length);
    }

    assert.deepEqual(starts, [0, 200, 400]);
    assert.equal(chunks.join(""), source);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
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
  ) as {
    readonly researchStatus?: string;
    readonly error?: string;
    readonly errorFacts?: Readonly<Record<string, string | number | boolean>>;
  };

  assertDirectToolFacts(read);
  assert.equal(read.researchStatus, "provider-failed");
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

  const output = await readTool.execute(
    { ref: ["src/a.ts", "src/b.ts"], source: "codebase", maxLength: 200 },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" }
  ) as {
    readonly items: readonly {
      readonly ref: string;
      readonly researchStatus: string;
      readonly contentPreview?: string;
      readonly truncated: boolean;
      readonly source?: string;
    }[];
    readonly continuations?: readonly unknown[];
  };
  const read = output.items;

  assertDirectToolFacts(output);
  read.forEach(assertDirectToolFacts);
  assert.deepEqual(calls.map((call) => ({ ref: call.ref, source: call.source, maxLength: call.maxLength, startChar: call.startChar })), [
    { ref: "src/a.ts", source: "codebase", maxLength: 200, startChar: 0 },
    { ref: "src/b.ts", source: "codebase", maxLength: 200, startChar: 0 },
  ]);
  assert.deepEqual(read.map((item) => item.ref), ["src/a.ts", "src/b.ts"]);
  assert.deepEqual(read.map((item) => item.researchStatus), ["completed", "completed"]);
  assert.deepEqual(read.map((item) => item.contentPreview), ["content for src/a.ts", "content for src/b.ts"]);
  assert.deepEqual(read.map((item) => item.truncated), [false, false]);
  assert.equal(output.continuations, undefined);
});

test("research read tool bounds batch fan-out concurrency", async () => {
  let active = 0;
  let maxActive = 0;
  let started = 0;
  let resolveStarted!: () => void;
  let releaseReads!: () => void;
  const firstWaveStarted = new Promise<void>((resolve) => { resolveStarted = resolve; });
  const release = new Promise<void>((resolve) => { releaseReads = resolve; });
  const runtime = fixedResearchRuntime({
    read: async (request) => {
      active += 1;
      started += 1;
      maxActive = Math.max(maxActive, active);
      if (started === 4) resolveStarted();
      await release;
      active -= 1;
      return fixedReadResult({
        ref: request.ref,
        status: "completed",
        source: "codebase",
        contentPreview: request.ref,
      });
    },
  });
  const running = createResearchReadTool(runtime).execute(
    { ref: Array.from({ length: 12 }, (_, index) => `ref-${index}`) },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
  );

  await firstWaveStarted;
  assert.equal(started, 4);
  assert.equal(maxActive, 4);
  releaseReads();
  const output = await running as { readonly items: readonly unknown[] };
  assert.equal(output.items.length, 12);
  assert.equal(maxActive, 4);
});

test("research read tool rejects oversized batches before calling a provider", async () => {
  let calls = 0;
  const runtime = fixedResearchRuntime({
    read: async (request) => {
      calls += 1;
      return fixedReadResult({ ref: request.ref, status: "completed", source: "codebase" });
    },
  });

  await assert.rejects(
    () => createResearchReadTool(runtime).execute(
      { ref: Array.from({ length: 17 }, (_, index) => `ref-${index}`) },
      { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    ),
    /at most 16 refs/u,
  );
  assert.equal(calls, 0);
});

test("research read tool propagates batch cancellation instead of reporting provider failure", async () => {
  const controller = new AbortController();
  let calls = 0;
  const runtime = fixedResearchRuntime({
    read: async () => {
      calls += 1;
      const error = new Error("cancelled by adapter");
      error.name = "AbortError";
      throw error;
    },
  });

  await assert.rejects(
    () => createResearchReadTool(runtime).execute(
      { ref: Array.from({ length: 12 }, (_, index) => `ref-${index}`) },
      {
        callerAgentId: "agent-test",
        traceId: "trace-test",
        goalId: "goal-test",
        abortSignal: controller.signal,
      },
    ),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
  assert.equal(calls <= 4, true);
});

test("research read tool normalizes an aborted signal reason to AbortError", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled by user"));
  let calls = 0;
  const runtime = fixedResearchRuntime({
    read: async (request) => {
      calls += 1;
      return fixedReadResult({ ref: request.ref, status: "completed", source: "codebase" });
    },
  });

  await assert.rejects(
    () => createResearchReadTool(runtime).execute(
      { ref: ["a.md", "b.md"] },
      {
        callerAgentId: "agent-test",
        traceId: "trace-test",
        goalId: "goal-test",
        abortSignal: controller.signal,
      },
    ),
    (error: unknown) => error instanceof Error &&
      error.name === "AbortError" &&
      error.message === "cancelled by user",
  );
  assert.equal(calls, 0);
});

test("ToolCenter records in-flight research batch cancellation as cancelled", async () => {
  const controller = new AbortController();
  let signalStarted!: () => void;
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  const runtime = fixedResearchRuntime({
    read: async (request) => {
      signalStarted();
      return new Promise<InformationReadResult>((_resolve, reject) => {
        request.abortSignal?.addEventListener("abort", () => reject(request.abortSignal?.reason), { once: true });
      });
    },
  });
  const center = new ToolCenter();
  center.register(createResearchReadTool(runtime));
  const executing = center.execute(
    { callId: "call-cancel-batch", toolName: "read", input: { ref: ["a.md", "b.md"] } },
    {
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      abortSignal: controller.signal,
    },
    { callerAgentId: "agent-test", allowedTools: ["read"] },
  );

  await started;
  controller.abort(new Error("cancelled by user"));
  const result = await executing;

  assert.equal(result.status, "cancelled");
});

test("research batch read exposes each executable continuation only at the top level", async () => {
  const runtime = fixedResearchRuntime({
    read: async (request) => fixedReadResult({
      ref: request.ref,
      status: "completed",
      source: "codebase",
      contentPreview: request.ref === "a.md" ? "aaaa" : "bbbb",
      startChar: request.startChar ?? 0,
      charCount: 12,
      truncated: true,
    }),
  });
  const output = await createResearchReadTool(runtime).execute(
    { ref: ["a.md", "b.md"], source: "codebase", maxLength: 4 },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
  ) as {
    readonly items: readonly Readonly<Record<string, unknown>>[];
    readonly continuations?: readonly { readonly nextInput: Readonly<Record<string, unknown>> }[];
  };

  assert.deepEqual(output.items.map((item) => item.truncated), [true, true]);
  assert.equal(output.items.every((item) => item.continuation === undefined), true);
  assert.deepEqual(output.continuations?.map((item) => item.nextInput), [
    { ref: "a.md", source: "codebase", maxLength: 4, startChar: 4 },
    { ref: "b.md", source: "codebase", maxLength: 4, startChar: 4 },
  ]);
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

  assert.deepEqual(read, { items: [] });
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

  const output = await readTool.execute(
    { ref: ["ok.md", "missing.md", "throws.md"], source: "codebase" },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" }
  ) as { readonly items: readonly {
      readonly ref: string;
      readonly researchStatus: string;
      readonly contentPreview?: string;
      readonly truncated: boolean;
      readonly error?: string;
    }[] };
  const read = output.items;

  assertDirectToolFacts(output);
  read.forEach(assertDirectToolFacts);
  assert.deepEqual(read.map((item) => item.ref), ["ok.md", "missing.md", "throws.md"]);
  assert.deepEqual(read.map((item) => item.researchStatus), ["completed", "provider-failed", "provider-failed"]);
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
    return {
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => "missing",
    };
  };
  const refusingFetch: PageFetchLike = async () => {
    const error = new TypeError("fetch failed") as Error & { cause?: unknown };
    error.cause = cause;
    throw error;
  };
  const runtime = createDefaultResearchRuntime({
    pageFetch: async (url, init) => url.includes("127.0.0.1") ? refusingFetch(url, init) : pageFetch(url, init),
    commandLogRegistry: {
      read: (ref) => ref === "command-log://shell-batch"
        ? { content: "shell batch log\n" }
        : undefined,
    },
  });
  const readTool = createResearchReadTool(runtime);

  const output = await readTool.execute(
    {
      ref: [
        "command-log://shell-batch",
        "http://127.0.0.1:43210/status",
        "https://example.test/missing",
        "command-log://missing",
      ],
    },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" }
  ) as { readonly items: readonly {
      readonly ref: string;
      readonly researchStatus: string;
      readonly contentPreview?: string;
      readonly error?: string;
      readonly errorFacts?: Readonly<Record<string, string | number | boolean>>;
    }[] };
  const read = output.items;

  assertDirectToolFacts(output);
  read.forEach(assertDirectToolFacts);
  assert.deepEqual(read.map((item) => item.researchStatus), ["completed", "provider-failed", "provider-failed", "invalid-input"]);
  assert.equal(read[0]?.contentPreview, "shell batch log\n");
  assert.match(read[1]?.error ?? "", /ECONNREFUSED/);
  assert.equal(read[1]?.errorFacts?.code, "ECONNREFUSED");
  assert.equal(read[1]?.errorFacts?.errno, -4078);
  assert.equal(read[1]?.errorFacts?.syscall, "connect");
  assert.equal(read[1]?.errorFacts?.address, "127.0.0.1");
  assert.equal(read[1]?.errorFacts?.port, 43210);
  assert.equal(typeof read[1]?.errorFacts?.durationMs, "number");
  assert.equal(read[2]?.error, "Page read returned HTTP 404 Not Found.");
  assert.equal(read[2]?.errorFacts?.statusCode, 404);
  assert.equal(read[2]?.errorFacts?.statusText, "Not Found");
  assert.equal(read[2]?.errorFacts?.method, "GET");
  assert.equal(read[2]?.errorFacts?.url, "https://example.test/missing");
  assert.equal(read[3]?.error, "Unknown or unregistered command log ref.");
});

test("ToolCenter read direct bad HTTP URL preserves page error facts through output and display", async () => {
  const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:43210"), {
    code: "ECONNREFUSED",
    errno: -4078,
    syscall: "connect",
    address: "127.0.0.1",
    port: 43210,
  });
  const pageFetch = async () => {
    const error = new TypeError("fetch failed") as Error & { cause?: unknown };
    error.cause = cause;
    throw error;
  };
  const center = createResearchEnabledToolCenter({
    env: {},
    fetch: pageFetch as unknown as FetchLike,
    playwrightAvailable: false,
    toolCatalogNames: ["read"],
  });

  const result = await center.execute(
    { callId: "call-read-refused-url", toolName: "read", input: { ref: "http://127.0.0.1:43210/status" } },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    { callerAgentId: "agent-test", allowedTools: ["read"] }
  );
  const output = result.output as {
    readonly researchStatus?: string;
    readonly error?: string;
    readonly errorFacts?: Readonly<Record<string, string | number | boolean>>;
    readonly sourceSteps?: readonly {
      readonly status?: string;
      readonly errorFacts?: Readonly<Record<string, string | number | boolean>>;
    }[];
  };
  const display = projectToolDisplay({ callId: result.callId, toolName: result.toolName, input: result.input }, result.output);

  assert.equal(result.status, "completed");
  assertDirectToolFacts(output);
  assert.equal(output.researchStatus, "provider-failed");
  assert.match(output.error ?? "", /ECONNREFUSED/);
  assert.equal(output.errorFacts?.code, "ECONNREFUSED");
  assert.equal(output.errorFacts?.errno, -4078);
  assert.equal(output.errorFacts?.syscall, "connect");
  assert.equal(output.errorFacts?.address, "127.0.0.1");
  assert.equal(output.errorFacts?.port, 43210);
  assert.equal(output.errorFacts?.method, "GET");
  assert.equal(output.errorFacts?.url, "http://127.0.0.1:43210/status");
  assert.equal(typeof output.errorFacts?.durationMs, "number");
  assert.equal(output.sourceSteps?.[0]?.status, "provider-failed");
  assert.equal(output.sourceSteps?.[0]?.errorFacts?.code, "ECONNREFUSED");
  assert.equal(display?.kind, "read_result");
  if (display?.kind !== "read_result") {
    throw new Error("expected read_result display");
  }
  assert.equal(JSON.stringify(display).includes("errorFacts"), false);
  assert.equal(JSON.stringify(result).includes("recoveryHint"), false);
  assert.doesNotMatch(JSON.stringify(result), suggestionPattern);
});

test("ToolCenter search empty query is invalid-input instead of empty results", async () => {
  const center = createResearchEnabledToolCenter({
    env: {},
    playwrightAvailable: false,
    toolCatalogNames: ["search"],
  });

  const result = await center.execute(
    { callId: "call-search-empty-query", toolName: "search", input: { query: "   " } },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    { callerAgentId: "agent-test", allowedTools: ["search"] }
  );
  const output = result.output as {
    readonly researchStatus?: string;
    readonly message?: string;
    readonly results?: readonly unknown[];
    readonly sourceSteps?: readonly {
      readonly status?: string;
      readonly message?: string;
    }[];
  };
  const display = projectToolDisplay({ callId: result.callId, toolName: result.toolName, input: result.input }, result.output);

  assert.equal(result.status, "completed");
  assertDirectToolFacts(output);
  assert.equal(output.researchStatus, "invalid-input");
  assert.equal(output.message, "search requires a non-empty query.");
  assert.equal(output.results?.length, 0);
  assert.equal(output.sourceSteps?.[0]?.status, "invalid-input");
  assert.equal(output.sourceSteps?.[0]?.message, "search requires a non-empty query.");
  assert.equal(display?.kind, "search_results");
  if (display?.kind !== "search_results") {
    throw new Error("expected search_results display");
  }
  assert.equal(display.message, "search requires a non-empty query.");
  assert.equal(display.results.length, 0);
  assert.equal(JSON.stringify(display).includes("researchStatus"), false);
  assert.equal(JSON.stringify(result).includes("recoveryHint"), false);
  assert.doesNotMatch(JSON.stringify(result), suggestionPattern);
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
    bodies.push(JSON.parse(init.body ?? "{}") as Record<string, unknown>);
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
  const center = createResearchEnabledToolCenter({
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
    bodies.push(JSON.parse(init.body ?? "{}") as Record<string, unknown>);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        results: [{ title: "Scoped", url: "https://example.test/scoped", content: "scoped snippet" }],
      }),
    };
  };
  const center = createResearchEnabledToolCenter({
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
    bodies.push(JSON.parse(init.body ?? "{}") as Record<string, unknown>);
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

    const center = await createConfiguredResearchToolCenter(configCenter, { fetch, playwrightAvailable: true });
    const names = center.list().map((tool) => tool.name);
    const search = await center.execute(
      { callId: "call-search", toolName: "search", input: { query: "AgentArbor", sources: ["web"] } },
      { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
      { callerAgentId: "agent-test", allowedTools: ["search", "read"] }
    );

    assertCoreDesktopToolNames(names);
    assert.equal(search.status, "completed");
    assert.equal(bodies[0]?.max_results, 1);
    assert.equal(JSON.stringify(search.output).includes("tvly-configured-tool-secret"), false);
  } finally {
    await removeTestDirectory(directory);
  }
});

test("configured ToolCenter reads Exa web search config and routes search through Exa", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-configured-tool-center-exa-"));
  const calls: { readonly headers: Record<string, string>; readonly body: Record<string, unknown> }[] = [];
  const fetch: FetchLike = async (_url, init) => {
    calls.push({
      headers: init.headers,
      body: JSON.parse(init.body ?? "{}") as Record<string, unknown>,
    });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        results: [{ title: "Configured Exa", url: "https://example.test/exa", highlights: ["configured exa snippet"] }],
      }),
    };
  };
  try {
    const configCenter = new ConfigCenter({
      settingsStore: new FileSystemNormalSettingsStore(directory),
      secretStore: new FileSystemLocalDevSecretStore(directory),
    });
    await configCenter.updateWebSearchConfig({
      provider: "exa",
      apiKey: "exa-configured-tool-secret",
      maxResults: 2,
    });

    const center = await createConfiguredResearchToolCenter(configCenter, { fetch, playwrightAvailable: true });
    const search = await center.execute(
      { callId: "call-search-exa", toolName: "search", input: { query: "AgentArbor", sources: ["web"] } },
      { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
      { callerAgentId: "agent-test", allowedTools: ["search", "read"] }
    );
    const output = search.output as {
      readonly results?: readonly { readonly metadata?: Readonly<Record<string, unknown>>; readonly snippet?: string }[];
    };

    assert.equal(search.status, "completed");
    assert.equal(calls[0]?.headers["x-api-key"], "exa-configured-tool-secret");
    assert.equal(calls[0]?.body.numResults, 2);
    assert.equal(output.results?.[0]?.metadata?.provider, "exa");
    assert.equal(output.results?.[0]?.snippet, "configured exa snippet");
    assert.equal(JSON.stringify(search.output).includes("exa-configured-tool-secret"), false);
  } finally {
    await removeTestDirectory(directory);
  }
});

test("configured ToolCenter reads Metaso web search config and routes search through Metaso", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-configured-tool-center-metaso-"));
  const calls: { readonly url: string; readonly headers: Record<string, string>; readonly body: Record<string, unknown> }[] = [];
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
          resultId: "configured-metaso-result",
          text: "Configured Metaso answer",
          references: [
            {
              title: "Configured Metaso",
              url: "https://example.test/metaso",
              summary: "configured metaso snippet",
              siteName: "Example",
            },
          ],
        },
      }),
    };
  };
  try {
    const configCenter = new ConfigCenter({
      settingsStore: new FileSystemNormalSettingsStore(directory),
      secretStore: new FileSystemLocalDevSecretStore(directory),
    });
    await configCenter.updateWebSearchConfig({
      provider: "metaso",
      apiKey: "metaso-configured-tool-secret",
      maxResults: 2,
    });

    const center = await createConfiguredResearchToolCenter(configCenter, { fetch, playwrightAvailable: true });
    const search = await center.execute(
      { callId: "call-search-metaso", toolName: "search", input: { query: "AgentArbor", sources: ["web"] } },
      { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
      { callerAgentId: "agent-test", allowedTools: ["search", "read"] }
    );
    const output = search.output as {
      readonly results?: readonly { readonly metadata?: Readonly<Record<string, unknown>>; readonly snippet?: string }[];
    };

    assert.equal(search.status, "completed");
    assert.match(calls[0]?.url ?? "", /metaso\.cn\/api\/open\/search\/v2/);
    assert.equal(calls[0]?.headers.authorization, "Bearer metaso-configured-tool-secret");
    assert.equal(calls[0]?.body.question, "AgentArbor");
    assert.equal(calls[0]?.body.lang, "zh");
    assert.equal(output.results?.[0]?.metadata?.provider, "metaso");
    assert.equal(output.results?.[0]?.snippet, "configured metaso snippet");
    assert.equal(JSON.stringify(search.output).includes("metaso-configured-tool-secret"), false);
  } finally {
    await removeTestDirectory(directory);
  }
});

test("configured ToolCenter still registers search/read and degrades web search without Tavily key", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-configured-tool-center-nokey-"));
  try {
    const configCenter = new ConfigCenter({
      settingsStore: new FileSystemNormalSettingsStore(directory),
      secretStore: new FileSystemLocalDevSecretStore(directory),
    });
    const center = await createConfiguredResearchToolCenter(configCenter, { playwrightAvailable: true });
    const names = center.list().map((tool) => tool.name);
    const search = await center.execute(
      { callId: "call-search", toolName: "search", input: { query: "AgentArbor", sources: ["web"] } },
      { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
      { callerAgentId: "agent-test", allowedTools: ["search", "read"] }
    );

    assertCoreDesktopToolNames(names);
    assert.equal(search.status, "completed");
    assertDirectToolFacts(search.output);
    assert.equal((search.output as { researchStatus?: string }).researchStatus, "no-provider");
  } finally {
    await removeTestDirectory(directory);
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
    const center = await createConfiguredResearchToolCenter(configCenter, { workspaceRoot: workspace, playwrightAvailable: true });
    const read = await center.execute(
      { callId: "call-read-file", toolName: "read_file", input: { path: "note.txt" } },
      { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
      { callerAgentId: "agent-test", allowedTools: ["read_file"] }
    );

    assert.equal(read.status, "completed");
    assert.equal((read.output as { refId?: string }).refId, "workspace:file:note.txt");
    assert.equal(JSON.stringify(read.output).includes("workspace note"), true);
  } finally {
    await removeTestDirectory(directory);
    await removeTestDirectory(workspace);
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
    const center = await createConfiguredResearchToolCenter(configCenter, { workspaceRoot: workspace, playwrightAvailable: true });
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
    await removeTestDirectory(directory);
    await removeTestDirectory(workspace);
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

    const center = await createConfiguredResearchToolCenter(configCenter, { fetch, playwrightAvailable: true });
    const search = await center.execute(
      { callId: "call-search", toolName: "search", input: { query: "AgentArbor", sources: ["web"] } },
      { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
      { callerAgentId: "agent-test", allowedTools: ["search", "read"] }
    );

    assert.equal(search.status, "completed");
    assertDirectToolFacts(search.output);
    assert.equal((search.output as { researchStatus?: string }).researchStatus, "no-provider");
    assert.equal(JSON.stringify(search.output).includes("tvly-disabled-tool-secret"), false);
    assert.equal(fetchCalls, 0);
  } finally {
    await removeTestDirectory(directory);
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

function assertCoreDesktopToolNames(names: readonly string[]): void {
  for (const expected of [
    "search",
    "read",
    "read_file",
    "list_dir",
    "grep_files",
    "create_file",
    "write_file",
    "edit_file",
    "delete_file",
    "shell_command",
    "http_request",
    "browser_snapshot",
  ]) {
    assert.equal(names.includes(expected), true, `expected ToolCenter to include ${expected}`);
  }
  assert.equal(names.includes("web_search"), false);
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

function assertDirectToolFacts(value: unknown): void {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  const output = value as Readonly<Record<string, unknown>>;
  for (const legacyField of ["action", "status", "summary", "result"]) {
    assert.equal(legacyField in output, false, `research tool output must not contain ${legacyField}`);
  }
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function fixedReadResult(input: {
  readonly ref: string;
  readonly status: InformationReadResult["status"];
  readonly source?: InformationSourceKind;
  readonly contentPreview?: string;
  readonly startChar?: number;
  readonly charCount?: number;
  readonly truncated?: boolean;
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
          startChar: input.startChar ?? 0,
          contentChars: input.contentPreview?.length ?? 0,
          charCount: input.charCount ?? input.contentPreview?.length ?? 0,
          hasMoreAfter: input.truncated ?? false,
          truncated: input.truncated ?? false,
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

async function removeTestDirectory(directory: string): Promise<void> {
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
