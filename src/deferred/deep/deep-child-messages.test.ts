import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  InMemoryDeepChildMessageStore,
  createDeepChildMessageRecord,
  createDeepChildMessageRef,
  createFileSystemDeepChildMessageStore,
} from "./deep-child-messages.js";

test("DeepChildMessageStore keeps raw parent-child content behind messageRef", async () => {
  const store = new InMemoryDeepChildMessageStore();
  const record = createDeepChildMessageRecord({
    runId: "deep-run-1",
    childRunId: "deep-child-run-1",
    instructionId: "deep-child-instruction-1",
    source: "control_api",
    status: "executed",
    content: "请沿用同一个子 Agent，补齐只有内部恢复需要的原文。",
    requestedAt: "2026-05-01T00:00:00.000Z",
    executedAt: "2026-05-01T00:00:01.000Z",
  });

  await store.upsert(record);

  const fetched = await store.getByRef("deep-run-1", createDeepChildMessageRef("deep-child-instruction-1"));
  assert.equal(fetched?.content, "请沿用同一个子 Agent，补齐只有内部恢复需要的原文。");
  assert.equal(fetched?.messageRef, "child_message:deep-child-instruction-1");
  assert.equal(fetched?.contentSummary.includes("内部恢复"), true);
  assert.equal((await store.listForChild("deep-run-1", "deep-child-run-1")).length, 1);
});

test("FileSystemDeepChildMessageStore writes under deep-runs child-messages partition", async () => {
  const runtimeHome = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-child-messages-"));
  try {
    const store = createFileSystemDeepChildMessageStore(runtimeHome);
    const record = createDeepChildMessageRecord({
      runId: "deep-run:file-safe",
      childRunId: "deep-child-run-1",
      instructionId: "deep-child-instruction-1",
      source: "manager",
      status: "queued",
      content: "父 Agent 给子 Agent 的原始续跑要求。",
      requestedAt: "2026-05-01T00:00:00.000Z",
      queuedAt: "2026-05-01T00:00:00.000Z",
    });

    await store.upsert(record);

    const fetched = await store.getByRef("deep-run:file-safe", record.messageRef);
    assert.equal(fetched?.messageRef, record.messageRef);
    assert.equal(fetched?.content, record.content);
    assert.equal(fetched?.status, "queued");
    assert.equal(fetched?.queuedAt, record.queuedAt);
    const records = await store.listForRun("deep-run:file-safe");
    assert.equal(records.length, 1);
    assert.equal(records[0]?.content, "父 Agent 给子 Agent 的原始续跑要求。");

    const expectedPath = path.join(
      runtimeHome,
      "deep-runs",
      encodeURIComponent("deep-run:file-safe"),
      "child-messages",
      `${encodeURIComponent(record.messageRef)}.json`,
    );
    assert.equal(await fileExists(expectedPath), true);
  } finally {
    await fs.rm(runtimeHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

async function fileExists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(
    () => true,
    () => false,
  );
}
