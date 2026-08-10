import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createFileSystemOrdinaryMemoryFactRepository,
  createInMemoryOrdinaryMemoryFactRepository,
  type OrdinaryMemoryFact,
} from "./index.js";

const fact: OrdinaryMemoryFact = {
  factId: "run-1:tool-1:read",
  runId: "run-1",
  conversationId: "conversation-1",
  kind: "read",
  memoryId: "path-dependency:one",
  memoryKind: "path_dependency",
  owner: { kind: "space", id: "space-1" },
  revision: 2,
  title: "稳定下载",
  recordedAt: "2026-08-10T00:00:00.000Z",
};

test("memory facts are idempotent and reject a conflicting duplicate", async () => {
  const repository = createInMemoryOrdinaryMemoryFactRepository();
  assert.equal(await repository.append(fact), "recorded");
  assert.equal(await repository.append({ ...fact }), "already_recorded");
  await assert.rejects(
    repository.append({ ...fact, title: "被篡改" }),
    /conflicts with an existing fact/,
  );
});
test("filesystem memory facts survive restart and delete by run", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-memory-facts-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repository = createFileSystemOrdinaryMemoryFactRepository(root);
  assert.equal(await repository.append(fact), "recorded");
  assert.deepEqual(await createFileSystemOrdinaryMemoryFactRepository(root).list({ memoryId: fact.memoryId }), [fact]);
  await repository.deleteByRunIds([fact.runId]);
  assert.deepEqual(await createFileSystemOrdinaryMemoryFactRepository(root).list(), []);
});
