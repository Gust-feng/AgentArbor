import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceFeatureError } from "./contracts.js";
import {
  assertWorkspacePathUniqueness,
  canonicalWorkspacePathIdentity,
  workspacePathNesting,
} from "./workspace-identity.js";

test("canonicalWorkspacePathIdentity 解析为绝对路径并按平台规范化大小写", () => {
  const identity = canonicalWorkspacePathIdentity("Z:\\AgentArbor\\sub");
  const drive = identity.slice(0, 2).toLowerCase();
  assert.equal(drive, "z:");
  if (process.platform === "win32") {
    assert.equal(canonicalWorkspacePathIdentity("Z:\\AGENTARBOR"), canonicalWorkspacePathIdentity("z:\\agentarbor"));
  }
});

test("workspacePathNesting 识别重复、父子与无关路径", () => {
  assert.equal(workspacePathNesting("Z:\\Project", "Z:\\Project").kind, "duplicate");
  assert.equal(workspacePathNesting("Z:\\Project\\Sub", "Z:\\Project").kind, "nested");
  assert.equal(workspacePathNesting("Z:\\Project", "Z:\\Project\\Sub").kind, "parent");
  assert.equal(workspacePathNesting("Z:\\Project", "Z:\\Other").kind, "none");
});

test("assertWorkspacePathUniqueness 拒绝重复与父子嵌套", () => {
  const existing = ["Z:\\Project", "Z:\\Docs"];
  assert.doesNotThrow(() => assertWorkspacePathUniqueness(existing, "Z:\\Code"));
  assert.throws(
    () => assertWorkspacePathUniqueness(existing, "Z:\\Project"),
    (error: unknown) => error instanceof WorkspaceFeatureError && error.code === "workspace_duplicate_path",
  );
  assert.throws(
    () => assertWorkspacePathUniqueness(existing, "Z:\\Project\\Sub"),
    (error: unknown) => error instanceof WorkspaceFeatureError && error.code === "workspace_nested_path",
  );
  assert.throws(
    () => assertWorkspacePathUniqueness(existing, "Z:\\Docs\\Parent"),
    (error: unknown) => error instanceof WorkspaceFeatureError && error.code === "workspace_nested_path",
  );
});
