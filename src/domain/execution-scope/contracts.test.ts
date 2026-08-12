import assert from "node:assert/strict";
import test from "node:test";

import {
  conversationOwnerKey,
  defaultOwnerCwd,
  validateConversationOwner,
} from "./contracts.js";

test("conversationOwnerKey 区分 space 与 workspace 并保持稳定", () => {
  const space: ConversationOwnerFixture = { kind: "space", id: "space-1" };
  const workspace: ConversationOwnerFixture = { kind: "workspace", id: "ws-1" };
  assert.equal(conversationOwnerKey(space), "space:space-1");
  assert.equal(conversationOwnerKey(workspace), "workspace:ws-1");
  assert.notEqual(conversationOwnerKey(space), conversationOwnerKey(workspace));
});

test("validateConversationOwner 接受合法 space/workspace owner", () => {
  assert.deepEqual(validateConversationOwner({ kind: "space", id: "space-1" }), { kind: "space", id: "space-1" });
  assert.deepEqual(validateConversationOwner({ kind: "workspace", id: "ws-1" }), { kind: "workspace", id: "ws-1" });
});

test("validateConversationOwner 拒绝非法 kind、空 id 与非对象", () => {
  assert.throws(() => validateConversationOwner({ kind: "folder", id: "x" }), /must be "space" or "workspace"/);
  assert.throws(() => validateConversationOwner({ kind: "space", id: "" }), /non-empty string/);
  assert.throws(() => validateConversationOwner({ kind: "space", id: undefined }), /non-empty string/);
  assert.throws(() => validateConversationOwner(null), /object with kind and id/);
  assert.throws(() => validateConversationOwner("space:1"), /object with kind and id/);
});

test("defaultOwnerCwd: workspace owner 使用当前 mount 根目录", () => {
  assert.equal(
    defaultOwnerCwd({ kind: "workspace", id: "ws-1" }, { workspaceMountRoot: "Z:\\Project" }),
    "Z:\\Project",
  );
});

test("defaultOwnerCwd: 空 Space owner 仍解析到 managedRoot（无任何引用也必须成立）", () => {
  assert.equal(
    defaultOwnerCwd({ kind: "space", id: "space-1" }, { spaceManagedRoot: "C:\\AgentArborData\\spaces\\space-1\\files" }),
    "C:\\AgentArborData\\spaces\\space-1\\files",
  );
  assert.equal(
    defaultOwnerCwd({ kind: "space", id: "space-1" }, { spaceManagedRoot: "C:\\AgentArborData\\spaces\\space-1\\files", workspaceMountRoot: "Z:\\Other" }),
    "C:\\AgentArborData\\spaces\\space-1\\files",
  );
});

test("defaultOwnerCwd: 缺失 mount/managedRoot 返回 undefined，由 Host 在 Run 出生前显式失败", () => {
  assert.equal(defaultOwnerCwd({ kind: "workspace", id: "ws-1" }, {}), undefined);
  assert.equal(defaultOwnerCwd({ kind: "space", id: "space-1" }, {}), undefined);
});

type ConversationOwnerFixture = { kind: "space" | "workspace"; id: string };