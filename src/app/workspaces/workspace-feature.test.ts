import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  WORKSPACE_SCHEMA_VERSION,
  WorkspaceFeatureError,
  type WorkspaceEvent,
  type WorkspaceRepository,
  type WorkspaceSnapshot,
} from "./contracts.js";
import { canonicalWorkspacePathIdentity } from "./workspace-identity.js";
import { createWorkspaceFeature } from "./workspace-feature.js";

function memoryRepository(): { repository: WorkspaceRepository; current: () => WorkspaceSnapshot } {
  let snapshot: WorkspaceSnapshot = { schemaVersion: WORKSPACE_SCHEMA_VERSION, workspaces: [], mounts: [], links: [] };
  return {
    repository: {
      async read() { return snapshot; },
      async write(next) { snapshot = next; },
    },
    current: () => snapshot,
  };
}

function createFeature(overrides?: { readonly idFactory?: () => string; readonly mountVersionFactory?: () => string }) {
  const memory = memoryRepository();
  let mountCounter = 0;
  let idCounter = 0;
  const feature = createWorkspaceFeature({
    repository: memory.repository,
    now: () => "2026-08-07T00:00:00.000Z",
    idFactory: overrides?.idFactory ?? (() => `id-${++idCounter}`),
    mountVersionFactory: overrides?.mountVersionFactory ?? (() => `m-${++mountCounter}`),
  });
  return { feature, current: memory.current };
}

const root = "Z:\\AgentArbor";
const rootIdentity = "123:456";

test("注册 Workspace：创建 workspace + active mount，标题默认取目录名", async () => {
  const { feature, current } = createFeature();
  const events: WorkspaceEvent[] = [];
  feature.events.subscribe((event) => events.push(event));
  const { workspace, mount } = await feature.commands.registerWorkspace({
    rootPath: root,
    sourceIdentity: rootIdentity,
  });
  assert.equal(workspace.status, "available");
  assert.equal(workspace.title, "AgentArbor");
  assert.equal(mount.status, "active");
  assert.equal(mount.rootPath, canonicalWorkspacePathIdentity(root));
  assert.equal(mount.sourceIdentity, rootIdentity);
  assert.equal(current().workspaces.length, 1);
  assert.equal(current().mounts.length, 1);
  assert.deepEqual(events.map((event) => event.type), ["workspace.registered"]);
});

test("注册拒绝重复路径与父子嵌套", async () => {
  const { feature } = createFeature();
  await feature.commands.registerWorkspace({ rootPath: root, sourceIdentity: rootIdentity });
  await assert.rejects(
    feature.commands.registerWorkspace({ rootPath: root, sourceIdentity: "other:1" }),
    (error: unknown) => error instanceof WorkspaceFeatureError && error.code === "workspace_duplicate_path",
  );
  await assert.rejects(
    feature.commands.registerWorkspace({ rootPath: `${root}\\sub`, sourceIdentity: "other:2" }),
    (error: unknown) => error instanceof WorkspaceFeatureError && error.code === "workspace_nested_path",
  );
  await assert.rejects(
    feature.commands.registerWorkspace({ rootPath: path.dirname(root), sourceIdentity: "other:3" }),
    (error: unknown) => error instanceof WorkspaceFeatureError && error.code === "workspace_nested_path",
  );
});

test("注册拒绝已登记的同一物理对象（sourceIdentity 相同）", async () => {
  const { feature } = createFeature();
  await feature.commands.registerWorkspace({ rootPath: root, sourceIdentity: rootIdentity });
  await assert.rejects(
    feature.commands.registerWorkspace({ rootPath: "Z:\\Moved", sourceIdentity: rootIdentity }),
    (error: unknown) => error instanceof WorkspaceFeatureError && error.code === "workspace_duplicate_identity",
  );
});

test("重新连接：同一对象生成新 mountVersion 并恢复 available；不同对象与同路径拒绝", async () => {
  const { feature, current } = createFeature();
  const events: WorkspaceEvent[] = [];
  feature.events.subscribe((event) => events.push(event));
  const { workspace } = await feature.commands.registerWorkspace({ rootPath: root, sourceIdentity: rootIdentity });
  await feature.commands.invalidateMount(workspace.id);

  await assert.rejects(
    feature.commands.reconnectWorkspace({ workspaceId: workspace.id, rootPath: "Z:\\Different", sourceIdentity: "other:9" }),
    (error: unknown) => error instanceof WorkspaceFeatureError && error.code === "workspace_mount_conflict",
  );
  await assert.rejects(
    feature.commands.reconnectWorkspace({ workspaceId: workspace.id, rootPath: root, sourceIdentity: rootIdentity }),
    (error: unknown) => error instanceof WorkspaceFeatureError && error.code === "workspace_mount_conflict",
  );

  const { mount } = await feature.commands.reconnectWorkspace({
    workspaceId: workspace.id,
    rootPath: "Z:\\AgentArbor-v2",
    sourceIdentity: rootIdentity,
  });
  assert.equal(mount.mountVersion, "m-2");
  assert.equal(mount.rootPath, canonicalWorkspacePathIdentity("Z:\\AgentArbor-v2"));
  assert.equal(current().workspaces[0].status, "available");
  assert.equal(current().mounts.filter((entry) => entry.status === "active").length, 1);
  assert.deepEqual(events.map((event) => event.type), ["workspace.registered", "workspace.mount_invalidated", "workspace.reconnected"]);
});

test("link：创建携带当前 mountVersion；重复 link 与不可用 Workspace 拒绝", async () => {
  const { feature } = createFeature();
  const { workspace } = await feature.commands.registerWorkspace({ rootPath: root, sourceIdentity: rootIdentity });
  const link = await feature.commands.linkWorkspaceToSpace({ spaceId: "space-1", workspaceId: workspace.id });
  assert.equal(link.status, "active");
  assert.equal(link.mountVersion, "m-1");
  assert.equal(link.linkId, "id-2");
  await assert.rejects(
    feature.commands.linkWorkspaceToSpace({ spaceId: "space-1", workspaceId: workspace.id }),
    (error: unknown) => error instanceof WorkspaceFeatureError && error.code === "workspace_link_conflict",
  );
  await feature.commands.invalidateMount(workspace.id);
  await assert.rejects(
    feature.commands.linkWorkspaceToSpace({ spaceId: "space-2", workspaceId: workspace.id }),
    (error: unknown) => error instanceof WorkspaceFeatureError && error.code === "workspace_not_available",
  );
});

test("mount 失效：撤销全部 active links 并返回 linkId 列表，Workspace 进入 disconnected", async () => {
  const { feature, current } = createFeature();
  const events: WorkspaceEvent[] = [];
  feature.events.subscribe((event) => events.push(event));
  const { workspace } = await feature.commands.registerWorkspace({ rootPath: root, sourceIdentity: rootIdentity });
  await feature.commands.linkWorkspaceToSpace({ spaceId: "space-1", workspaceId: workspace.id });
  const revoked = await feature.commands.invalidateMount(workspace.id);
  assert.deepEqual(revoked, ["id-2"]);
  assert.equal(current().workspaces[0].status, "disconnected");
  assert.equal(current().mounts[0].status, "invalidated");
  assert.equal(current().links[0].status, "revoked");
  const revokedEvent = events.find((event) => event.type === "workspace.link_revoked");
  assert.equal(revokedEvent?.type === "workspace.link_revoked" && revokedEvent.link.status, "revoked");
});

test("unlink：幂等撤销并发布事件", async () => {
  const { feature, current } = createFeature();
  const events: WorkspaceEvent[] = [];
  feature.events.subscribe((event) => events.push(event));
  const { workspace } = await feature.commands.registerWorkspace({ rootPath: root, sourceIdentity: rootIdentity });
  const link = await feature.commands.linkWorkspaceToSpace({ spaceId: "space-1", workspaceId: workspace.id });
  await feature.commands.unlinkWorkspaceFromSpace(link.linkId);
  assert.equal(current().links[0].status, "revoked");
  await feature.commands.unlinkWorkspaceFromSpace(link.linkId);
  assert.equal(events.filter((event) => event.type === "workspace.link_revoked").length, 1);
  await assert.rejects(
    feature.commands.unlinkWorkspaceFromSpace("missing-link"),
    (error: unknown) => error instanceof WorkspaceFeatureError && error.code === "workspace_link_not_found",
  );
});

test("删除：进入 deleting 并发布事件，重复删除幂等", async () => {
  const { feature, current } = createFeature();
  const events: WorkspaceEvent[] = [];
  feature.events.subscribe((event) => events.push(event));
  const { workspace } = await feature.commands.registerWorkspace({ rootPath: root, sourceIdentity: rootIdentity });
  await feature.commands.deleteWorkspace(workspace.id);
  assert.equal(current().workspaces[0].status, "deleting");
  await feature.commands.deleteWorkspace(workspace.id);
  assert.equal(events.filter((event) => event.type === "workspace.deleted").length, 1);
});

test("purge：仅允许在 deleting 后物理移除元数据与 mount，活跃 Workspace 拒绝", async () => {
  const { feature, current } = createFeature();
  const { workspace } = await feature.commands.registerWorkspace({ rootPath: root, sourceIdentity: rootIdentity });
  await assert.rejects(
    feature.commands.purgeWorkspace(workspace.id),
    (error: unknown) => error instanceof WorkspaceFeatureError && error.code === "workspace_not_deleting",
  );
  await feature.commands.deleteWorkspace(workspace.id);
  await feature.commands.purgeWorkspace(workspace.id);
  assert.deepEqual(current().workspaces, []);
  assert.deepEqual(current().mounts, []);
  assert.equal(await feature.queries.get(workspace.id), undefined);
  assert.deepEqual(await feature.queries.list(), []);
  const reRegistered = await feature.commands.registerWorkspace({ rootPath: root, sourceIdentity: rootIdentity });
  assert.equal(reRegistered.workspace.status, "available");
});

test("查询：list 带 currentMount/linkCount，get 返回详情，findByRootPath 按规范化路径匹配", async () => {
  const { feature } = createFeature();
  const { workspace } = await feature.commands.registerWorkspace({ rootPath: root, sourceIdentity: rootIdentity });
  await feature.commands.linkWorkspaceToSpace({ spaceId: "space-1", workspaceId: workspace.id });

  const list = await feature.queries.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].currentMount?.mountVersion, "m-1");
  assert.equal(list[0].linkCount, 1);

  const detail = await feature.queries.get(workspace.id);
  assert.equal(detail?.mounts.length, 1);
  assert.equal(detail?.links.length, 1);
  assert.equal(await feature.queries.get("missing"), undefined);

  const found = await feature.queries.findByRootPath(root);
  assert.equal(found?.id, workspace.id);
  assert.equal(await feature.queries.findByRootPath("Z:\\Nope"), undefined);
  assert.equal((await feature.queries.listLinksBySpace("space-1")).length, 1);
  assert.equal((await feature.queries.listLinksBySpace("space-2")).length, 0);
});
