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
    await fs.rm(runtimeHome, { recursive: true, force: true });
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

  const second = createDeepChildLoopContextRecord({
    runId,
    childRunId,
    createdAt: "2026-07-12T02:00:00.000Z",
    updatedAt: "2026-07-12T02:00:00.000Z",
    messages: [{ role: "assistant", content: "second segment replaces the latest snapshot" }],
  });
  const savedSecond = await store.upsert(second);
  const records = await store.listForChild(runId, childRunId);

  assert.equal(savedSecond.contextRef, contextRef);
  assert.equal(savedSecond.createdAt, savedFirst.createdAt);
  assert.equal(savedSecond.updatedAt, "2026-07-12T02:00:00.000Z");
  assert.deepEqual(savedSecond.messages, [{ role: "assistant", content: "second segment replaces the latest snapshot" }]);
  assert.equal(records.length, 1);
  assert.equal(records[0]?.contextRef, contextRef);
  assert.equal(records[0]?.createdAt, "2026-07-12T01:00:00.000Z");
  assert.equal(records[0]?.updatedAt, "2026-07-12T02:00:00.000Z");
  assert.deepEqual(records[0]?.messages, [{ role: "assistant", content: "second segment replaces the latest snapshot" }]);

  await assert.rejects(
    store.upsert({ ...second, contextRef: `${contextRef}:context-0001` }),
    /Invalid Deep child loop context record/,
  );
}
