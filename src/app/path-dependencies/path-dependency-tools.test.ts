import test from "node:test";
import assert from "node:assert/strict";
import {
  createInMemoryPathDependencyRepository,
  createPathDependencyFeature,
  createPathDependencyTools,
  type OrdinaryMemoryFactSink,
} from "./index.js";

const owner = { kind: "space", id: "space-1" } as const;
const context = {
  callerAgentId: "ordinary-agent",
  traceId: "trace-not-the-run-id",
  goalId: "goal-not-the-run-id",
  conversationId: "conversation-1",
  toolCallId: "tool-call-1",
};

function toolSet(options: Parameters<typeof createPathDependencyTools>[0]) {
  return new Map(createPathDependencyTools(options).map((tool) => [tool.definition.name, tool] as const));
}

function sinkFor(facts: { reads: unknown[]; references: unknown[] }): OrdinaryMemoryFactSink {
  return {
    async recordRead(input) {
      facts.reads.push(input);
    },
    async recordReference(input) {
      const hasRead = facts.reads.some((candidate) => {
        if (typeof candidate !== "object" || candidate === null) return false;
        const read = candidate as { readonly memoryId?: unknown; readonly revision?: unknown; readonly owner?: unknown };
        return read.memoryId === input.memoryId &&
          read.revision === input.revision &&
          JSON.stringify(read.owner) === JSON.stringify(input.owner);
      });
      if (!hasRead) return "not_read";
      facts.references.push(input);
      return "recorded";
    },
  };
}

test("memory read requires a durable fact sink and reference follows an exact read", async () => {
  const feature = createPathDependencyFeature({
    repository: createInMemoryPathDependencyRepository(),
    idFactory: () => "path-dependency:one",
    now: () => "2026-08-10T00:00:00.000Z",
  });
  const saved = await feature.commands.save({
    owner,
    title: "稳定下载",
    methodology: "先验证来源，再下载并检查可播放性。",
  });
  assert.equal(saved.status, "created");
  if (saved.status !== "created") return;

  const withoutSink = toolSet({ dependencies: feature, owner, run: { runId: "run-1", conversationId: "conversation-1" } });
  assert.deepEqual(
    await withoutSink.get("MemoryRead")?.execute({ memoryId: saved.dependency.id }, context),
    {
      status: "memory_fact_sink_unavailable",
      message: "This run cannot durably record memory facts, so the memory was not returned as read or applied.",
    },
  );

  const facts = { reads: [] as unknown[], references: [] as unknown[] };
  const tools = toolSet({
    dependencies: feature,
    owner,
    run: { runId: "run-1", conversationId: "conversation-1" },
    memoryFacts: sinkFor(facts),
  });
  const reference = tools.get("MemoryReference");
  assert.ok(reference);
  assert.deepEqual(
    await reference.execute({ memoryId: saved.dependency.id, revision: 1 }, context),
    {
      status: "memory_not_read_in_run",
      memoryId: saved.dependency.id,
      revision: 1,
      message: "This exact revision was not durably read by the run.",
    },
  );
  const read = tools.get("MemoryRead");
  assert.ok(read);
  const readResult = await read.execute({ memoryId: saved.dependency.id, revision: 1 }, context) as { readonly status: string; readonly memory?: { readonly methodology: string } };
  assert.equal(readResult.status, "ok");
  assert.equal(readResult.memory?.methodology, "先验证来源，再下载并检查可播放性。");
  assert.equal(facts.reads.length, 1);
  assert.deepEqual(await reference.execute({ memoryId: saved.dependency.id, revision: 1, note: "适用本轮任务" }, context), {
    status: "referenced",
    memoryId: saved.dependency.id,
    revision: 1,
  });
  assert.equal(facts.references.length, 1);

  // A resumed run may rebuild the tool contribution. The durable Ordinary
  // fact, not an executor-local Set, remains the authority for adoption.
  const rebuiltReference = toolSet({
    dependencies: feature,
    owner,
    run: { runId: "run-1", conversationId: "conversation-1" },
    memoryFacts: sinkFor(facts),
  }).get("MemoryReference");
  assert.ok(rebuiltReference);
  assert.deepEqual(await rebuiltReference.execute({ memoryId: saved.dependency.id, revision: 1 }, context), {
    status: "referenced",
    memoryId: saved.dependency.id,
    revision: 1,
  });
  assert.equal(facts.references.length, 2);
  await feature.release();
});

test("path dependency save uses host-injected run provenance and cannot run without it", async () => {
  const feature = createPathDependencyFeature({
    repository: createInMemoryPathDependencyRepository(),
    idFactory: () => "path-dependency:source",
    now: () => "2026-08-10T00:00:00.000Z",
  });
  const noRun = toolSet({ dependencies: feature, owner });
  assert.deepEqual(await noRun.get("PathDependencySave")?.execute({
    scope: "owner",
    title: "方法",
    methodology: "方法正文",
  }, context), {
    status: "memory_run_unavailable",
    message: "This tool is not attached to a concrete Ordinary run and cannot create provenance.",
  });

  const tools = toolSet({
    dependencies: feature,
    owner,
    run: { runId: "ordinary-run-1", conversationId: "conversation-1" },
  });
  const result = await tools.get("PathDependencySave")?.execute({
    scope: "owner",
    title: "方法",
    methodology: "方法正文",
  }, context) as { readonly status: string; readonly dependency?: { readonly id: string } };
  assert.equal(result.status, "created");
  assert.equal((await feature.queries.get(result.dependency?.id ?? ""))?.sourceRunRefs[0]?.runId, "ordinary-run-1");
  await feature.release();
});

test("MemoryRead refuses an oversized body instead of returning a summary", async () => {
  const feature = createPathDependencyFeature({
    repository: createInMemoryPathDependencyRepository(),
    idFactory: () => "path-dependency:oversized",
    now: () => "2026-08-10T00:00:00.000Z",
  });
  const saved = await feature.commands.save({
    owner,
    title: "过大的方法",
    methodology: "x".repeat(9_000),
  });
  assert.equal(saved.status, "created");
  if (saved.status !== "created") return;
  const facts = { reads: [] as unknown[], references: [] as unknown[] };
  const read = toolSet({
    dependencies: feature,
    owner,
    run: { runId: "run-oversized", conversationId: "conversation-1" },
    memoryFacts: sinkFor(facts),
    countMemoryTokens: (text) => text.length,
  }).get("MemoryRead");
  assert.ok(read);
  assert.deepEqual(await read.execute({ memoryId: saved.dependency.id, revision: 1 }, context), {
    status: "memory_read_budget_exceeded",
    memoryId: saved.dependency.id,
    revision: 1,
    message: "This memory is larger than the run's complete-read budget. The body was not summarized or marked as read; revise the memory into a smaller methodology before reading it.",
  });
  assert.equal(facts.reads.length, 0);
  await feature.release();
});

test("path dependency save keeps evidence as the canonical provenance field", async () => {
  const feature = createPathDependencyFeature({
    repository: createInMemoryPathDependencyRepository(),
    idFactory: () => "path-dependency:verification-evidence",
    now: () => "2026-08-10T00:00:00.000Z",
  });
  const tools = toolSet({
    dependencies: feature,
    owner,
    run: { runId: "ordinary-run-1", conversationId: "conversation-1" },
  });
  const result = await tools.get("PathDependencySave")?.execute({
    scope: "owner",
    title: "方法",
    methodology: "方法正文",
    verification: "observed",
    evidenceRefs: ["tool-evidence:verification"],
  }, context) as { readonly status: string; readonly dependency?: { readonly id: string } };
  assert.equal(result.status, "created");
  assert.deepEqual(
    (await feature.queries.get(result.dependency?.id ?? ""))?.verification,
    { status: "observed" },
  );
  assert.deepEqual(
    (await feature.queries.get(result.dependency?.id ?? ""))?.evidenceRefs,
    ["tool-evidence:verification"],
  );
  const updatedTools = toolSet({
    dependencies: feature,
    owner,
    run: { runId: "ordinary-run-2", conversationId: "conversation-1" },
  });
  const updated = await updatedTools.get("PathDependencySave")?.execute({
    scope: "owner",
    memoryId: result.dependency?.id,
    expectedRevision: 1,
    title: "方法（校准）",
    methodology: "方法正文（校准）",
    verification: "user_confirmed",
  }, context) as { readonly status: string };
  assert.equal(updated.status, "invalid_input");
  assert.deepEqual(
    (await feature.queries.get(result.dependency?.id ?? ""))?.verification,
    { status: "observed" },
  );
  await feature.release();
});

test("path dependency tools reject malformed ids, revisions, arrays, and notes", async () => {
  const feature = createPathDependencyFeature({
    repository: createInMemoryPathDependencyRepository(),
    idFactory: () => "path-dependency:invalid-input",
    now: () => "2026-08-10T00:00:00.000Z",
  });
  const tools = toolSet({
    dependencies: feature,
    owner,
    run: { runId: "ordinary-run-invalid-input", conversationId: "conversation-1" },
  });

  async function assertInvalid(toolName: string, input: unknown): Promise<void> {
    const tool = tools.get(toolName);
    assert.ok(tool, `${toolName} must be registered`);
    const result = await tool.execute(input, context) as { readonly status?: unknown };
    assert.equal(result.status, "invalid_input", `${toolName} should reject malformed input without throwing`);
  }

  for (const memoryId of ["../escape", "a/b", "a\\b", ".", "..", "bad\u0000id"]) {
    await assertInvalid("MemoryRead", { memoryId });
    await assertInvalid("MemoryReference", { memoryId, revision: 1 });
    await assertInvalid("PathDependencySave", {
      scope: "owner",
      memoryId,
      expectedRevision: 1,
      title: "方法",
      methodology: "正文",
    });
  }

  for (const revision of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "1", [], null]) {
    await assertInvalid("MemoryRead", { memoryId: "path-dependency:missing", revision });
    await assertInvalid("MemoryReference", { memoryId: "path-dependency:missing", revision });
    await assertInvalid("PathDependencySave", {
      scope: "owner",
      memoryId: "path-dependency:missing",
      expectedRevision: revision,
      title: "方法",
      methodology: "正文",
    });
  }

  await assertInvalid("PathDependencySave", {
    scope: "owner",
    title: "方法",
    methodology: "正文",
    tags: Array.from({ length: 25 }, (_, index) => `tag-${index}`),
  });
  await assertInvalid("PathDependencySave", {
    scope: "owner",
    title: "方法",
    methodology: "正文",
    tags: ["x".repeat(81)],
  });
  await assertInvalid("PathDependencySave", {
    scope: "owner",
    title: "方法",
    methodology: "正文",
    evidenceRefs: ["x".repeat(513)],
  });
  await assertInvalid("PathDependencySave", {
    scope: "owner",
    title: "方法",
    methodology: "正文",
    verification: { status: "observed" },
  });
  await assertInvalid("MemoryReference", {
    memoryId: "path-dependency:missing",
    revision: 1,
    note: [],
  });

  await feature.release();
});
