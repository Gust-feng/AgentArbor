import assert from "node:assert/strict";
import test from "node:test";
import { canonicalSpacePathIdentity, resolveSpacePath } from "./space-path-resolver.js";
import type { SpacePathGrant } from "./space-path-resolver.js";

const noRealpath = async (target: string) => target;

function identityFor(platform: string) {
  return (value: string) => canonicalSpacePathIdentity(value, noRealpath, platform);
}

function workspaceGrant(id: string, folderPath: string): SpacePathGrant {
  return { referenceId: id, kind: "folder", path: folderPath };
}

test("Windows 路径身份统一分隔符并忽略大小写", async () => {
  const identity = identityFor("win32");
  assert.equal(await identity("C:\\Work\\Sub\\"), await identity("c:/work/sub"));
});

test("Unix 路径身份保留大小写语义", async () => {
  const identity = identityFor("linux");
  assert.notEqual(await identity("/srv/Work"), await identity("/srv/work"));
});

test("真实路径解析到所属引用并给出相对路径", async () => {
  const result = await resolveSpacePath({
    requestedPath: "Z:\\Projects\\AgentArbor\\src\\App.tsx",
    grants: [workspaceGrant("ref-1", "Z:\\Projects\\AgentArbor")],
    identity: identityFor("win32"),
  });
  assert.equal(result.outcome, "resolved");
  assert.partialDeepStrictEqual(result, { referenceId: "ref-1", relativePath: "src/app.tsx" });
});

test("引用根之外的路径不被授权", async () => {
  const result = await resolveSpacePath({
    requestedPath: "Z:\\Other\\secret.txt",
    grants: [workspaceGrant("ref-1", "Z:\\Projects\\AgentArbor")],
    identity: identityFor("win32"),
  });
  assert.equal(result.outcome, "outside_reference");
});

test("父目录逃逸在规范化后被拒绝", async () => {
  const result = await resolveSpacePath({
    requestedPath: "Z:\\Projects\\AgentArbor\\..\\secret.txt",
    grants: [workspaceGrant("ref-1", "Z:\\Projects\\AgentArbor")],
    identity: identityFor("win32"),
  });
  assert.equal(result.outcome, "outside_reference");
});

test("同名前缀目录不被误判为引用内部", async () => {
  const result = await resolveSpacePath({
    requestedPath: "Z:\\Projects\\AgentArbor-2\\file.txt",
    grants: [workspaceGrant("ref-1", "Z:\\Projects\\AgentArbor")],
    identity: identityFor("win32"),
  });
  assert.equal(result.outcome, "outside_reference");
});

test("多个有效根同时命中时拒绝而不猜测", async () => {
  const result = await resolveSpacePath({
    requestedPath: "Z:\\Projects\\AgentArbor\\src\\App.tsx",
    grants: [
      workspaceGrant("ref-1", "Z:\\Projects\\AgentArbor"),
      workspaceGrant("ref-2", "Z:\\Projects\\AgentArbor\\src"),
    ],
    identity: identityFor("win32"),
  });
  assert.equal(result.outcome, "mount_conflict");
});

test("symlink 逃逸到边界外按真实目标拒绝", async () => {
  const identity = (value: string) =>
    canonicalSpacePathIdentity(
      value,
      async (target) => target.replaceAll("\\", "/").toLowerCase().startsWith("z:/projects/agentarbor/link")
        ? "Z:\\Outside\\real.txt"
        : target,
      "win32",
    );
  const result = await resolveSpacePath({
    requestedPath: "Z:\\Projects\\AgentArbor\\link",
    grants: [workspaceGrant("ref-1", "Z:\\Projects\\AgentArbor")],
    identity,
  });
  assert.equal(result.outcome, "outside_reference");
});

test("单文件授权只匹配原文件并返回可执行的父目录与文件名", async () => {
  const result = await resolveSpacePath({
    requestedPath: "Z:\\Projects\\AgentArbor\\README.md",
    grants: [{ referenceId: "file-1", kind: "file", path: "Z:\\Projects\\AgentArbor\\README.md" }],
    identity: identityFor("win32"),
  });
  assert.equal(result.outcome, "resolved");
  assert.partialDeepStrictEqual(result, {
    referenceId: "file-1",
    rootPath: "Z:\\Projects\\AgentArbor",
    relativePath: "README.md",
  });

  assert.equal((await resolveSpacePath({
    requestedPath: "Z:\\Projects\\AgentArbor\\OTHER.md",
    grants: [{ referenceId: "file-1", kind: "file", path: "Z:\\Projects\\AgentArbor\\README.md" }],
    identity: identityFor("win32"),
  })).outcome, "outside_reference");
});