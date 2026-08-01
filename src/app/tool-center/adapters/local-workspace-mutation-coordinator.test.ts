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

test("mutation coordinator publishes only committed path changes", async () => {
  const coordinator = new InMemoryLocalWorkspaceMutationCoordinator();
  const observed: string[] = [];
  coordinator.events.subscribe((event) => observed.push(event.absolutePath));
  coordinator.events.subscribe(() => { throw new Error("observer failed"); });
  const committedPath = path.resolve("workspace", "saved.md");

  await coordinator.run(committedPath, async () => "saved");
  await assert.rejects(
    coordinator.run(path.resolve("workspace", "failed.md"), async () => { throw new Error("write failed"); }),
    /write failed/u,
  );

  assert.deepEqual(observed, [process.platform === "win32" ? committedPath.toLowerCase() : committedPath]);
});

test("exclusive read leases serialize without publishing a mutation", async () => {
  const coordinator = new InMemoryLocalWorkspaceMutationCoordinator();
  const observed: string[] = [];
  coordinator.events.subscribe((event) => observed.push(event.absolutePath));
  const root = path.resolve("workspace");
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });

  const snapshot = coordinator.runExclusive(root, async () => {
    order.push("snapshot:start");
    await gate;
    order.push("snapshot:end");
  });
  const mutation = coordinator.run(path.join(root, "note.md"), async () => { order.push("mutation"); });
  await Promise.resolve();
  assert.deepEqual(order, ["snapshot:start"]);
  release();
  await Promise.all([snapshot, mutation]);

  assert.deepEqual(order, ["snapshot:start", "snapshot:end", "mutation"]);
  assert.equal(observed.length, 1);
});
