import test from "node:test";
import assert from "node:assert/strict";
import {
  isMemoryOwner,
  memoryOwnerKey,
  memoryOwnersForConversation,
} from "./owner.js";

test("memory owners use stable identities and only expose global plus direct owner", () => {
  const space = { kind: "space", id: "space-1" } as const;
  assert.deepEqual(memoryOwnersForConversation(space), [{ kind: "global" }, space]);
  assert.equal(memoryOwnerKey(space), "space:space-1");
  assert.equal(memoryOwnerKey({ kind: "global" }), "global");
});

test("memory owner validation rejects malformed identities", () => {
  assert.equal(isMemoryOwner({ kind: "workspace", id: "workspace-1" }), true);
  assert.equal(isMemoryOwner({ kind: "global" }), true);
  assert.equal(isMemoryOwner({ kind: "workspace", id: "" }), false);
  assert.equal(isMemoryOwner({ kind: "global", id: "unexpected" }), false);
  assert.equal(isMemoryOwner("workspace:project"), false);
});
