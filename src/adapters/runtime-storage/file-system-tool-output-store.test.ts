import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createReadToolOutputTool } from "../../app/tool-center/adapters/tool-output-read-tool.js";
import { ToolCenter } from "../../app/tool-center/tool-center.js";
import { ToolOutputStoreError } from "../../app/tool-center/tool-output-store.js";
import type { ToolExecutionContext, ToolExecutor } from "../../domain/tools/index.js";
import { FileSystemToolOutputStore } from "./file-system-tool-output-store.js";

const context: ToolExecutionContext = {
  callerAgentId: "tool-evidence-test",
  traceId: "ordinary-run-1",
  goalId: "goal-1",
};

test("FileSystemToolOutputStore keeps exact evidence readable across restart and final reads", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-tool-evidence-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const content = `alpha😀${"x".repeat(40)}omega`;
  const first = new FileSystemToolOutputStore(root, {
    now: () => Date.parse("2026-07-17T00:00:00.000Z"),
    createRefToken: () => "durable-evidence-1",
  });
  const retained = await first.retain({
    mediaType: "text/plain",
    content,
    sourceToolName: "fixture_tool",
    sourceCallId: "call-1",
    sourceFactId: "ordinary-run-1/tool:call-1",
    ownerId: "ordinary-run-1",
  });
  assert.equal(retained.availability, "durable");
  assert.equal(retained.expiresAt, undefined);
  assert.equal(retained.totalChars, content.length);
  assert.equal(retained.byteLength, Buffer.byteLength(content, "utf8"));
  assert.match(retained.sha256, /^[a-f0-9]{64}$/u);
  await first.close();

  const restarted = new FileSystemToolOutputStore(root);
  const tool = createReadToolOutputTool(restarted);
  const finalWindow = await tool.execute({ ref: retained.ref, startChar: 0, maxChars: content.length }, context) as {
    readonly content: string;
    readonly continuationAvailability: string;
    readonly hasMoreAfter: boolean;
  };
  assert.equal(finalWindow.continuationAvailability, "durable");
  assert.equal(finalWindow.hasMoreAfter, false);
  assert.equal(finalWindow.content, content);

  const full = await restarted.read(retained.ref, { startChar: 0, maxChars: content.length });
  assert.equal(full?.content, content);
  assert.equal(full?.availability, "durable");
  assert.equal(full?.sourceFactId, "ordinary-run-1/tool:call-1");
});

test("FileSystemToolOutputStore releases only evidence owned by the requested run", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-tool-evidence-owner-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let token = 0;
  const store = new FileSystemToolOutputStore(root, {
    createRefToken: () => `owner-evidence-${token += 1}`,
  });
  const first = await store.retain(retainInput("first", "call-1", "run-a"));
  const second = await store.retain(retainInput("second", "call-2", "run-a"));
  const other = await store.retain(retainInput("other", "call-3", "run-b"));

  assert.equal(await store.releaseOwner("run-a"), 2);
  assert.equal(await store.read(first.ref, { startChar: 0, maxChars: 10 }), undefined);
  assert.equal(await store.read(second.ref, { startChar: 0, maxChars: 10 }), undefined);
  assert.equal((await store.read(other.ref, { startChar: 0, maxChars: 10 }))?.content, "other");
});

test("ToolCenter publishes a durable evidence continuation without duplicating the full output", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-tool-evidence-center-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new FileSystemToolOutputStore(root, { createRefToken: () => "tool-center-evidence" });
  const center = new ToolCenter({ outputStore: store, maxInlineOutputChars: 32 });
  center.register(createReadToolOutputTool(store));
  const source: ToolExecutor = {
    definition: {
      name: "large_fixture",
      description: "Return one large deterministic fixture.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      metadata: {
        category: "other",
        riskLevel: "low",
        operationType: "read-only",
        requiresConfirmation: false,
      },
    },
    async execute() {
      return { content: "large evidence ".repeat(20) };
    },
  };
  center.register(source);

  const result = await center.execute(
    { callId: "provider-call", factId: "ordinary-run-1/tool:provider-call", toolName: source.definition.name, input: {} },
    context,
    { callerAgentId: context.callerAgentId, allowedTools: [source.definition.name, "ReadOutput"] },
  );
  assert.equal(result.status, "completed");
  const delivery = result.output as {
    readonly contentRef?: string;
    readonly continuationAvailability?: string;
    readonly contentSha256?: string;
    readonly contentPreview?: string;
    readonly content?: string;
    readonly expiresAt?: string;
  };
  assert.equal(delivery.continuationAvailability, "durable");
  assert.ok(delivery.contentRef);
  assert.match(delivery.contentRef ?? "", /^tool-output:\/\//u);
  assert.match(delivery.contentSha256 ?? "", /^[a-f0-9]{64}$/u);
  assert.equal(delivery.expiresAt, undefined);
  assert.equal(delivery.content, undefined);
  assert.equal((delivery.contentPreview?.length ?? 0) > 0, true);
  const retained = await store.read(delivery.contentRef, { startChar: 0, maxChars: 10_000 });
  assert.equal(retained?.sourceCallId, "provider-call");
  assert.equal(retained?.sourceFactId, "ordinary-run-1/tool:provider-call");
});

test("FileSystemToolOutputStore fails fast when durable evidence content is damaged", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-tool-evidence-corrupt-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new FileSystemToolOutputStore(root, { createRefToken: () => "corrupt-evidence" });
  const retained = await store.retain(retainInput("original", "call-corrupt", "run-corrupt"));
  await fs.writeFile(path.join(root, "entries", "corrupt-evidence", "content.txt"), "changed", "utf8");

  await assert.rejects(
    store.read(retained.ref, { startChar: 0, maxChars: 10 }),
    (error: unknown) => error instanceof ToolOutputStoreError && error.code === "tool_output_corrupt",
  );
});

test("FileSystemToolOutputStore invalidates verified read cache when evidence changes", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-tool-evidence-cache-invalidate-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new FileSystemToolOutputStore(root, { createRefToken: () => "cached-evidence" });
  const retained = await store.retain(retainInput("original", "call-cache", "run-cache"));
  assert.equal((await store.read(retained.ref, { startChar: 0, maxChars: 3 }))?.content, "ori");
  const contentPath = path.join(root, "entries", "cached-evidence", "content.txt");
  await fs.writeFile(contentPath, "changed!", "utf8");
  const changedTime = new Date(Date.now() + 2_000);
  await fs.utimes(contentPath, changedTime, changedTime);

  await assert.rejects(
    store.read(retained.ref, { startChar: 3, maxChars: 3 }),
    (error: unknown) => error instanceof ToolOutputStoreError && error.code === "tool_output_corrupt",
  );
});

test("FileSystemToolOutputStore streams one large verification and reuses its bounded window index", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-tool-evidence-indexed-read-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const content = `${"a".repeat(65_535)}😀中${"b".repeat(70_000)}😀tail`;
  const store = new FileSystemToolOutputStore(root, {
    createRefToken: () => "indexed-evidence",
    maxReadCacheBytes: 8,
  });
  const retained = await store.retain(retainInput(content, "call-indexed", "run-indexed"));

  const firstStart = 65_533;
  const first = await store.read(retained.ref, { startChar: firstStart, maxChars: 8 });
  assert.equal(first?.content, content.slice(firstStart, firstStart + 8));
  assert.equal(first?.textChars, 8);
  assert.equal(first?.hasMoreAfter, true);

  const internals = store as unknown as {
    readonly verifiedFiles: Map<string, { readonly checkpoints: readonly unknown[] }>;
    readonly cachedContent: Map<string, unknown>;
  };
  const verifiedAfterFirstRead = internals.verifiedFiles.get(retained.ref);
  assert.ok(verifiedAfterFirstRead);
  assert.equal((verifiedAfterFirstRead?.checkpoints.length ?? 0) >= 3, true);
  assert.equal(internals.cachedContent.has(retained.ref), false);

  const secondStart = content.length - 7;
  const second = await store.read(retained.ref, { startChar: secondStart, maxChars: 7 });
  assert.equal(second?.content, content.slice(secondStart));
  assert.equal(second?.hasMoreAfter, false);
  assert.equal(internals.verifiedFiles.get(retained.ref), verifiedAfterFirstRead);
  assert.equal(internals.cachedContent.has(retained.ref), false);

  await assert.rejects(
    store.read(retained.ref, { startChar: 65_536, maxChars: 4 }),
    (error: unknown) => error instanceof ToolOutputStoreError &&
      error.code === "invalid_tool_output_window" && error.facts.startChar === 65_536,
  );

  const contentPath = path.join(root, "entries", "indexed-evidence", "content.txt");
  await fs.writeFile(contentPath, `${content.slice(0, -1)}!`, "utf8");
  const changedTime = new Date(Date.now() + 2_000);
  await fs.utimes(contentPath, changedTime, changedTime);
  await assert.rejects(
    store.read(retained.ref, { startChar: secondStart, maxChars: 7 }),
    (error: unknown) => error instanceof ToolOutputStoreError && error.code === "tool_output_corrupt",
  );
});

test("FileSystemToolOutputStore rejects an item above the durable byte limit without writing it", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-tool-evidence-item-limit-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new FileSystemToolOutputStore(root, {
    createRefToken: () => "oversized-evidence",
    maxItemBytes: 4,
    maxTotalBytes: 20,
    maxEntries: 2,
  });

  await assert.rejects(
    store.retain(retainInput("😀a", "call-large", "run-large")),
    (error: unknown) => error instanceof ToolOutputStoreError &&
      error.code === "tool_output_item_too_large" && error.facts.incomingBytes === 5,
  );
  await assert.rejects(() => fs.access(path.join(root, "entries", "oversized-evidence")));
});

test("FileSystemToolOutputStore enforces durable entry and total byte capacity across restart", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-tool-evidence-capacity-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let token = 0;
  const options = {
    createRefToken: () => `capacity-${token += 1}`,
    maxItemBytes: 10,
    maxTotalBytes: 6,
    maxEntries: 2,
  };
  const first = new FileSystemToolOutputStore(root, options);
  await first.retain(retainInput("abc", "call-1", "run-capacity"));
  await first.close();

  const restarted = new FileSystemToolOutputStore(root, options);
  await restarted.retain(retainInput("de", "call-2", "run-capacity"));
  await assert.rejects(
    restarted.retain(retainInput("fg", "call-3", "run-capacity")),
    (error: unknown) => error instanceof ToolOutputStoreError &&
      error.code === "tool_output_capacity_exceeded",
  );
});

function retainInput(content: string, sourceCallId: string, ownerId: string) {
  return {
    mediaType: "text/plain" as const,
    content,
    sourceToolName: "fixture_tool",
    sourceCallId,
    ownerId,
  };
}
