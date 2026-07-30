import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { InMemoryLocalWorkspaceMutationCoordinator } from "./local-workspace-mutation-coordinator.js";

test("mutation coordinator serializes a directory lease with descendant files", async () => {
  const coordinator = new InMemoryLocalWorkspaceMutationCoordinator();
  const root = path.resolve("workspace");
  const events: string[] = [];
  let releaseRoot!: () => void;
  const rootGate = new Promise<void>((resolve) => { releaseRoot = resolve; });
  const rootMutation = coordinator.run(root, async () => { events.push("root:start"); await rootGate; events.push("root:end"); });
  const fileMutation = coordinator.run(path.join(root, "notes", "a.md"), async () => { events.push("file"); });
  await Promise.resolve();
  assert.deepEqual(events, ["root:start"]);
  releaseRoot();
  await Promise.all([rootMutation, fileMutation]);
  assert.deepEqual(events, ["root:start", "root:end", "file"]);
});

test("mutation coordinator keeps unrelated sibling files concurrent", async () => {
  const coordinator = new InMemoryLocalWorkspaceMutationCoordinator();
  const root = path.resolve("workspace");
  const events: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const first = coordinator.run(path.join(root, "a.md"), async () => { events.push("a:start"); await gate; });
  const second = coordinator.run(path.join(root, "b.md"), async () => { events.push("b"); });
  await second;
  assert.deepEqual(events, ["a:start", "b"]);
  release();
  await first;
});
