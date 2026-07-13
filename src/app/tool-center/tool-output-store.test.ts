import assert from "node:assert/strict";
import test from "node:test";
import {
  validateModelVisibleToolContract,
  type ToolExecutionBroker,
  type ToolExecutionContext,
} from "../../domain/tools/index.js";
import { createReadToolOutputTool, MAX_TOOL_OUTPUT_READ_CHARS } from "./adapters/tool-output-read-tool.js";
import {
  DEFAULT_TOOL_OUTPUT_TTL_MS,
  InMemoryToolOutputStore,
  ToolOutputStoreError,
} from "./tool-output-store.js";
import { DEFAULT_MAX_INLINE_TOOL_OUTPUT_CHARS } from "./tool-output-limits.js";
import { createAgentToolRegistry } from "./builtin-tool-runtime.js";

const TOOL_CONTEXT: ToolExecutionContext = {
  callerAgentId: "agent-tool-output-test",
  traceId: "trace-tool-output-test",
  goalId: "goal-tool-output-test",
};

test("InMemoryToolOutputStore and read_tool_output reconstruct exact retained text across forward continuations", async () => {
  const store = deterministicStore();
  const content = "alpha-中文-beta-0123456789-omega";
  const retained = await store.retain({
    mediaType: "text/plain",
    content,
    sourceToolName: "fixture_large_tool",
    sourceCallId: "call-large-text",
  });
  assert.equal(
    Date.parse(retained.expiresAt) - Date.parse(retained.createdAt),
    DEFAULT_TOOL_OUTPUT_TTL_MS,
  );
  const tool = createReadToolOutputTool(store);
  const segments: string[] = [];
  let input: ReadToolInput = { ref: retained.ref, startChar: 0, maxChars: 6 };
  let previousStart = -1;

  while (true) {
    const output = await executeReadTool(tool, input);
    assert.equal(output.continuationAvailability, "live_only");
    assert.equal(output.mediaType, "text/plain");
    assert.equal(output.sourceToolName, "fixture_large_tool");
    assert.equal(output.sourceCallId, "call-large-text");
    assert.equal(output.totalChars, content.length);
    assert.equal(output.startChar > previousStart, true);
    previousStart = output.startChar;
    segments.push(output.content);
    if (!output.hasMoreAfter) {
      assert.equal(output.truncated, false);
      assert.equal(output.continuation, undefined);
      break;
    }
    assert.equal(output.truncated, true);
    assert.equal(output.continuation?.ref, retained.ref);
    const nextInput = asReadInput(output.continuation?.nextInput);
    assert.equal(nextInput.startChar, output.startChar + output.textChars);
    assert.equal(nextInput.startChar > output.startChar, true);
    input = nextInput;
  }

  assert.equal(segments.join(""), content);
  assert.equal(await store.read(retained.ref, { startChar: 0, maxChars: 2 }), undefined);
});

test("read_tool_output never splits an emoji surrogate pair across windows", async () => {
  const store = deterministicStore();
  const content = "A😀B";
  const retained = await store.retain({
    mediaType: "text/plain",
    content,
    sourceToolName: "fixture_unicode_tool",
    sourceCallId: "call-unicode",
  });
  const tool = createReadToolOutputTool(store);

  const first = await executeReadTool(tool, { ref: retained.ref, startChar: 0, maxChars: 2 });
  const second = await executeReadTool(tool, asReadInput(first.continuation?.nextInput));
  await assert.rejects(
    store.read(retained.ref, { startChar: 2, maxChars: 2 }),
    (error: unknown) => (
      error instanceof ToolOutputStoreError && error.code === "invalid_tool_output_window"
    ),
  );
  const third = await executeReadTool(tool, asReadInput(second.continuation?.nextInput));

  assert.deepEqual([first.content, second.content, third.content], ["A", "😀", "B"]);
  assert.equal(first.content + second.content + third.content, content);
});

test("read_tool_output exposes a complete model-visible tool contract", () => {
  const tool = createReadToolOutputTool(deterministicStore());
  assert.deepEqual(validateModelVisibleToolContract(tool.definition), { ok: true, missing: [] });
});

test("InMemoryToolOutputStore preserves canonical JSON media type and exact character windows", async () => {
  const store = deterministicStore();
  const content = JSON.stringify({ ok: true, values: [1, 2, 3], note: "exact" });
  const retained = await store.retain({
    mediaType: "application/json",
    content,
    sourceToolName: "fixture_json_tool",
    sourceCallId: "call-json",
  });

  const first = await store.read(retained.ref, { startChar: 0, maxChars: 7 });
  const second = await store.read(retained.ref, { startChar: 7, maxChars: content.length });
  assert.ok(first);
  assert.ok(second);
  assert.equal(first.mediaType, "application/json");
  assert.equal(first.content + second.content, content);
  assert.equal(first.hasMoreAfter, true);
  assert.equal(second.hasMoreAfter, false);
});

test("InMemoryToolOutputStore expires entries and reclaims entry and character capacity", async () => {
  let now = 1_000;
  let token = 0;
  const store = new InMemoryToolOutputStore({
    ttlMs: 10,
    maxEntries: 1,
    maxItemChars: 10,
    maxTotalChars: 5,
    now: () => now,
    createRefToken: () => `expiry-${token += 1}`,
  });
  const expired = await store.retain(retainInput("12345", "call-expired"));
  now = 1_010;

  assert.equal(await store.read(expired.ref, { startChar: 0, maxChars: 2 }), undefined);
  const replacement = await store.retain(retainInput("abcde", "call-replacement"));
  assert.equal((await store.read(replacement.ref, { startChar: 0, maxChars: 5 }))?.content, "abcde");
});

test("InMemoryToolOutputStore reports item, entry, and total-character capacity failures without evicting live facts", async () => {
  const itemLimited = new InMemoryToolOutputStore({
    maxItemChars: 4,
    maxEntries: 4,
    maxTotalChars: 20,
  });
  await assertStoreRejects(
    itemLimited.retain(retainInput("12345", "call-too-large")),
    "tool_output_item_too_large",
  );

  const entryLimited = new InMemoryToolOutputStore({
    maxEntries: 1,
    maxItemChars: 10,
    maxTotalChars: 10,
  });
  const retainedEntry = await entryLimited.retain(retainInput("one", "call-one"));
  await assertStoreRejects(
    entryLimited.retain(retainInput("two", "call-two")),
    "tool_output_capacity_exceeded",
  );
  assert.equal((await entryLimited.read(retainedEntry.ref, { startChar: 0, maxChars: 3 }))?.content, "one");

  const totalLimited = new InMemoryToolOutputStore({
    maxEntries: 3,
    maxItemChars: 10,
    maxTotalChars: 5,
  });
  const retainedTotal = await totalLimited.retain(retainInput("1234", "call-four"));
  await assertStoreRejects(
    totalLimited.retain(retainInput("56", "call-over-total")),
    "tool_output_capacity_exceeded",
  );
  assert.equal((await totalLimited.read(retainedTotal.ref, { startChar: 0, maxChars: 4 }))?.content, "1234");
});

test("InMemoryToolOutputStore refuses provenance that would create an unreadable continuation", async () => {
  const store = deterministicStore();
  await assertStoreRejects(
    store.retain({
      mediaType: "text/plain",
      content: "retained content",
      sourceToolName: "fixture_tool",
      sourceCallId: "\u0000".repeat(20_000),
    }),
    "tool_output_source_metadata_too_large",
  );
});

test("InMemoryToolOutputStore releases individual refs and run owners to reclaim live capacity", async () => {
  const store = new InMemoryToolOutputStore({
    maxEntries: 2,
    maxItemChars: 6,
    maxTotalChars: 7,
  });
  const first = await store.retain(retainInput("one", "call-one", "trace-a"));
  const second = await store.retain(retainInput("two", "call-two", "trace-a"));
  await assertStoreRejects(
    store.retain(retainInput("new", "call-new", "trace-b")),
    "tool_output_capacity_exceeded",
  );

  assert.equal(await store.release(first.ref), true);
  assert.equal(await store.release(first.ref), false);
  const replacement = await store.retain(retainInput("new", "call-new", "trace-b"));
  assert.equal(await store.releaseOwner("trace-a"), 1);
  assert.equal(await store.read(second.ref, { startChar: 0, maxChars: 3 }), undefined);
  assert.equal((await store.read(replacement.ref, { startChar: 0, maxChars: 3 }))?.content, "new");
  assert.equal(await store.releaseOwner("trace-a"), 0);
  await store.retain(retainInput("more", "call-more", "trace-c"));
});

test("InMemoryToolOutputStore clear removes retained facts and resets capacity", async () => {
  const store = new InMemoryToolOutputStore({
    maxEntries: 1,
    maxItemChars: 10,
    maxTotalChars: 10,
  });
  const first = await store.retain(retainInput("first", "call-first"));
  await store.clear();
  assert.equal(await store.read(first.ref, { startChar: 0, maxChars: 5 }), undefined);

  const second = await store.retain(retainInput("second", "call-second"));
  assert.equal((await store.read(second.ref, { startChar: 0, maxChars: 6 }))?.content, "second");
});

test("read_tool_output rejects invalid windows and never emits a zero-progress continuation", async () => {
  const store = deterministicStore();
  const retained = await store.retain(retainInput("abcdefghij", "call-window"));
  const tool = createReadToolOutputTool(store);

  await assert.rejects(() => tool.execute({ ref: retained.ref, maxChars: 1 }, TOOL_CONTEXT), /between 2 and 29000/);
  await assert.rejects(
    () => tool.execute({ ref: retained.ref, maxChars: MAX_TOOL_OUTPUT_READ_CHARS + 1 }, TOOL_CONTEXT),
    /between 2 and 29000/,
  );
  await assert.rejects(() => tool.execute({ ref: retained.ref, startChar: -1 }, TOOL_CONTEXT), /non-negative integer/);
  await assert.rejects(() => tool.execute({ ref: retained.ref, startChar: 1.5 }, TOOL_CONTEXT), /safe integer/);
  await assertStoreRejects(
    store.read(retained.ref, { startChar: 11, maxChars: 2 }),
    "tool_output_window_out_of_range",
  );

  const output = await executeReadTool(tool, { ref: retained.ref, startChar: 0, maxChars: 2 });
  const nextInput = asReadInput(output.continuation?.nextInput);
  assert.equal(output.textChars, 2);
  assert.equal(nextInput.startChar, 2);
});

test("read_tool_output stays within the inline budget under worst-case JSON escaping", async () => {
  const store = deterministicStore();
  const retained = await store.retain(retainInput(
    "\u0000".repeat(MAX_TOOL_OUTPUT_READ_CHARS + 1),
    "call-escaped-window",
  ));
  const output = await executeReadTool(createReadToolOutputTool(store), {
    ref: retained.ref,
    startChar: 0,
    maxChars: MAX_TOOL_OUTPUT_READ_CHARS,
  });

  assert.equal(output.textChars, MAX_TOOL_OUTPUT_READ_CHARS);
  assert.equal(JSON.stringify(output).length <= DEFAULT_MAX_INLINE_TOOL_OUTPUT_CHARS, true);
  assert.equal(output.hasMoreAfter, true);
});

test("read_tool_output shrinks escaped windows for long provenance without skipping content", async () => {
  const store = deterministicStore();
  const content = "\u0000".repeat(MAX_TOOL_OUTPUT_READ_CHARS + 17);
  const retained = await store.retain({
    mediaType: "text/plain",
    content,
    sourceToolName: "fixture_tool",
    sourceCallId: "call-" + "x".repeat(60_000),
  });
  const tool = createReadToolOutputTool(store);
  const segments: string[] = [];
  let input: ReadToolInput = {
    ref: retained.ref,
    startChar: 0,
    maxChars: MAX_TOOL_OUTPUT_READ_CHARS,
  };

  while (true) {
    const output = await executeReadTool(tool, input);
    assert.equal(JSON.stringify(output).length <= DEFAULT_MAX_INLINE_TOOL_OUTPUT_CHARS, true);
    assert.equal(output.startChar, segments.reduce((total, segment) => total + segment.length, 0));
    assert.equal(output.textChars > 0, true);
    segments.push(output.content);
    if (!output.hasMoreAfter) {
      break;
    }
    const nextInput = asReadInput(output.continuation?.nextInput);
    assert.equal(nextInput.startChar, output.startChar + output.textChars);
    input = nextInput;
  }

  assert.equal(segments[0]!.length < MAX_TOOL_OUTPUT_READ_CHARS, true);
  assert.equal(segments.join(""), content);
});

test("independent ToolCenters share the configured store and rebuild large results without rerunning producers", async () => {
  const store = deterministicStore();
  const producerRegistry = createAgentToolRegistry({
    toolOutputStore: store,
    toolCatalogNames: ["read_tool_output"],
  });
  const fixtures = [
    {
      toolName: "large_text_result",
      output: `text-start-${"x".repeat(200_000)}-text-end`,
    },
    {
      toolName: "large_json_result",
      output: {
        kind: "large-json",
        values: Array.from({ length: 20_000 }, (_, index) => `value-${index}`),
      },
    },
  ] as const;
  const executionCounts = new Map<string, number>();
  for (const fixture of fixtures) {
    producerRegistry.register({
      executor: {
        definition: {
          name: fixture.toolName,
          description: "Return a large result for output-store wiring verification.",
          inputSchema: { type: "object", properties: {} },
          metadata: {
            category: "other",
            riskLevel: "low",
            operationType: "read-only",
            requiresConfirmation: false,
          },
        },
        execute: async () => {
          executionCounts.set(fixture.toolName, (executionCounts.get(fixture.toolName) ?? 0) + 1);
          return fixture.output;
        },
      },
      scopes: ["agent-basic"],
      enabledByDefault: true,
    });
  }
  const producerCenter = producerRegistry.createToolCenter("agent-basic");
  const readerCenter = createAgentToolRegistry({
    toolOutputStore: store,
    toolCatalogNames: ["read_tool_output"],
  }).createToolCenter("agent-basic");

  for (const fixture of fixtures) {
    const result = await producerCenter.execute(
      { callId: `call-${fixture.toolName}`, toolName: fixture.toolName, input: {} },
      TOOL_CONTEXT,
      {
        callerAgentId: TOOL_CONTEXT.callerAgentId,
        allowedTools: [fixture.toolName, "read_tool_output"],
      },
    );
    const delivery = result.output as {
      readonly mediaType?: unknown;
      readonly continuation?: { readonly nextInput?: unknown };
    };
    const rebuilt = await readAllRetainedContent(readerCenter, delivery.continuation?.nextInput);

    assert.equal(result.status, "completed");
    assert.equal(
      rebuilt,
      typeof fixture.output === "string" ? fixture.output : JSON.stringify(fixture.output),
    );
    assert.equal(
      delivery.mediaType,
      typeof fixture.output === "string" ? "text/plain" : "application/json",
    );
    assert.equal(executionCounts.get(fixture.toolName), 1);
  }
});

function deterministicStore(): InMemoryToolOutputStore {
  let token = 0;
  return new InMemoryToolOutputStore({
    now: () => 1_000,
    createRefToken: () => `test-${token += 1}`,
  });
}

function retainInput(content: string, sourceCallId: string, ownerId?: string) {
  return {
    mediaType: "text/plain" as const,
    content,
    sourceToolName: "fixture_tool",
    sourceCallId,
    ...(ownerId === undefined ? {} : { ownerId }),
  };
}

type ReadToolInput = {
  readonly ref: string;
  readonly startChar: number;
  readonly maxChars: number;
};

type ReadToolOutput = {
  readonly ref: string;
  readonly mediaType: "text/plain" | "application/json";
  readonly sourceToolName: string;
  readonly sourceCallId: string;
  readonly content: string;
  readonly startChar: number;
  readonly textChars: number;
  readonly totalChars: number;
  readonly hasMoreAfter: boolean;
  readonly truncated: boolean;
  readonly continuationAvailability: "live_only";
  readonly continuation?: {
    readonly ref?: string;
    readonly nextInput?: unknown;
  };
};

async function executeReadTool(
  tool: ReturnType<typeof createReadToolOutputTool>,
  input: ReadToolInput,
): Promise<ReadToolOutput> {
  return await tool.execute(input, TOOL_CONTEXT) as ReadToolOutput;
}

async function readAllRetainedContent(
  center: ToolExecutionBroker,
  initialInput: unknown,
): Promise<string> {
  let input = asReadInput(initialInput);
  const segments: string[] = [];
  while (true) {
    const result = await center.execute(
      {
        callId: `read-shared-output-${segments.length + 1}`,
        toolName: "read_tool_output",
        input,
      },
      TOOL_CONTEXT,
      {
        callerAgentId: TOOL_CONTEXT.callerAgentId,
        allowedTools: ["read_tool_output"],
      },
    );
    assert.equal(result.status, "completed");
    const output = result.output as ReadToolOutput;
    segments.push(output.content);
    if (!output.hasMoreAfter) {
      return segments.join("");
    }
    input = asReadInput(output.continuation?.nextInput);
  }
}

function asReadInput(value: unknown): ReadToolInput {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  const record = value as Partial<ReadToolInput>;
  assert.equal(typeof record.ref, "string");
  assert.equal(typeof record.startChar, "number");
  assert.equal(typeof record.maxChars, "number");
  return record as ReadToolInput;
}

async function assertStoreRejects(
  promise: Promise<unknown>,
  code: ToolOutputStoreError["code"],
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.equal(error instanceof ToolOutputStoreError, true);
    assert.equal((error as ToolOutputStoreError).code, code);
    return true;
  });
}
