import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createDeepChildLoopContextRecord,
  createDeepChildLoopContextRef,
  createFileSystemDeepChildLoopContextStore,
  InMemoryDeepChildLoopContextStore,
  type DeepChildLoopContextStore,
} from "./deep-child-loop-contexts.js";

test("Deep child loop context keeps one latest in-memory snapshot per child", async () => {
  await assertLatestContextContract(new InMemoryDeepChildLoopContextStore());
});

test("Deep child loop context keeps one latest filesystem snapshot per child", async () => {
  const runtimeHome = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-deep-child-context-"));
  try {
    await assertLatestContextContract(createFileSystemDeepChildLoopContextStore(runtimeHome));
  } finally {
    await fs.rm(runtimeHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

async function assertLatestContextContract(store: DeepChildLoopContextStore): Promise<void> {
  const runId = "deep-run-context-contract";
  const childRunId = "deep-child-context-contract";
  const contextRef = createDeepChildLoopContextRef(childRunId);
  const first = createDeepChildLoopContextRecord({
    runId,
    childRunId,
    createdAt: "2026-07-12T01:00:00.000Z",
    updatedAt: "2026-07-12T01:00:00.000Z",
    messages: [{ role: "assistant", content: "first segment" }],
  });
  const savedFirst = await store.upsert(first);

  assert.equal(savedFirst.contextRef, `child_loop_context:${childRunId}`);
  assert.equal(savedFirst.contextRef, contextRef);

  const responsesOutputItems = [{
    id: "reasoning-context-1",
    type: "reasoning",
    summary: [{ type: "summary_text", text: "Need the tool result before continuing." }],
    encrypted_content: "encrypted-reasoning-state",
  }, {
    id: "function-call-context-1",
    type: "function_call",
    call_id: "call-context-1",
    name: "read",
    arguments: JSON.stringify({ path: "requirements.md" }),
  }];

  const second = createDeepChildLoopContextRecord({
    runId,
    childRunId,
    createdAt: "2026-07-12T02:00:00.000Z",
    updatedAt: "2026-07-12T02:00:00.000Z",
    messages: [{
      role: "assistant" as const,
      content: "second segment replaces the latest snapshot",
      attachments: [{
        kind: "image",
        filename: "ephemeral.png",
        source: { kind: "data", mimeType: "image/png", data: "aW1hZ2U=" },
      }],
      protocolExtensions: {
        response_id: "response-ephemeral",
        providerResponseId: "unknown-provider-field",
        openai_responses_output_items: responsesOutputItems,
      },
    }],
  });
  const savedSecond = await store.upsert(second);
  const records = await store.listForChild(runId, childRunId);

  assert.equal(savedSecond.contextRef, contextRef);
  assert.equal(savedSecond.createdAt, savedFirst.createdAt);
  assert.equal(savedSecond.updatedAt, "2026-07-12T02:00:00.000Z");
  const expectedMessages = [{
    role: "assistant" as const,
    content: "second segment replaces the latest snapshot",
    protocolExtensions: { openai_responses_output_items: responsesOutputItems },
  }];
  assert.deepEqual(savedSecond.messages, expectedMessages);
  assert.equal(records.length, 1);
  assert.equal(records[0]?.contextRef, contextRef);
  assert.equal(records[0]?.createdAt, "2026-07-12T01:00:00.000Z");
  assert.equal(records[0]?.updatedAt, "2026-07-12T02:00:00.000Z");
  assert.deepEqual(records[0]?.messages, expectedMessages);
  assert.equal(JSON.stringify(savedSecond).includes("unknown-provider-field"), false);
  assert.equal(JSON.stringify(savedSecond).includes("aW1hZ2U="), false);

  await assert.rejects(
    store.upsert({ ...second, contextRef: `${contextRef}:context-0001` }),
    /Invalid Deep child loop context record/,
  );
}

test("Deep child loop context preserves large valid Responses continuation and refuses invalid items", () => {
  const oversized = {
    runId: "deep-run-oversized-context",
    childRunId: "deep-child-oversized-context",
    messages: [{
      role: "assistant" as const,
      content: "The provider extension exceeds the durable context boundary.",
      protocolExtensions: {
        openai_responses_output_items: [{
          type: "reasoning",
          encrypted_content: "x".repeat(1_100_000),
        }],
      },
    }],
  };
  const invalid = {
    runId: "deep-run-invalid-context",
    childRunId: "deep-child-invalid-context",
    messages: [{
      role: "assistant" as const,
      content: "The provider extension does not match the Responses item shape.",
      protocolExtensions: {
        openai_responses_output_items: [{ encrypted_content: "missing-type" }],
      },
    }],
  };

  const record = createDeepChildLoopContextRecord(oversized);
  assert.equal(
    JSON.stringify(record.messages[0]?.protocolExtensions).includes("x".repeat(1_100_000)),
    true,
  );
  assert.throws(
    () => createDeepChildLoopContextRecord(invalid),
    (error: unknown) => (error as { readonly code?: unknown }).code === "model_protocol_continuation_not_persistable",
  );
});
