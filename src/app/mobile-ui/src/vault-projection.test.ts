import { describe, expect, test } from "vitest";

import type { ContentVaultMutation, ContentVaultResource, ContentVaultResourceKind } from "../../content-vault/contracts";
import type { MobileVaultConflict, MobileVaultOutboxEntry } from "./storage";
import type { MobileRemoteState } from "./remote-client";
import { conflictPresentation, knowledgeMatchesQuery, normalizeManagedFileName, normalizeRelativePath, projectKnowledge, projectPendingVaultContent, projectSpaceConflicts, projectSpaceContent, projectSpaces, updatedTextPayload } from "./vault-projection";

describe("mobile Vault projection", () => {
  test("keeps Space navigation stable when synchronized resources arrive out of order", () => {
    const later = resource("space", "space-b", { title: "后创建", createdAt: "2026-08-05T00:00:00.000Z" });
    const earlierB = resource("space", "space-c", { title: "先创建 B", createdAt: "2026-08-04T00:00:00.000Z" });
    const earlierA = resource("space", "space-a", { title: "先创建 A", createdAt: "2026-08-04T00:00:00.000Z" });

    expect(projectSpaces(remoteState([later, earlierB, earlierA])).map((space) => space.id)).toEqual([
      "space-a",
      "space-c",
      "space-b",
    ]);
  });

  test("keeps ownership metadata out of the user-facing knowledge list", () => {
    const state = remoteState([
      resource("personal_note", "note-1", { title: "笔记", bodyMarkdown: "正文" }),
      resource("workbench_asset", "asset-1", { title: "资料.md", text: "资料" }),
      resource("knowledge_link", "link-1", { sourcePageId: "a", targetPageId: "b", relation: "supports", createdAt: "2026-08-04T00:00:00.000Z", updatedAt: "2026-08-04T00:00:00.000Z" }),
    ]);

    expect(projectKnowledge(state).map((item) => item.title)).toEqual(["笔记", "资料.md"]);
  });

  test("searches knowledge body text and exposes Space context only when useful", () => {
    const state = remoteState([
      resource("space", "space-1", { title: "产品空间" }),
      resource("personal_note", "note-1", { spaceId: "space-1", title: "方向", bodyMarkdown: "移动端需要保持实时同步" }),
      resource("workbench_asset", "asset-1", { title: "接口.md", text: "relay protocol", language: "markdown" }),
    ]);

    const items = projectKnowledge(state);
    expect(items[0]).toMatchObject({ title: "方向", ownerLabel: "产品空间", detail: "笔记" });
    expect(items.filter((item) => knowledgeMatchesQuery(item, "实时同步")).map((item) => item.id)).toEqual(["note-1"]);
    expect(items.filter((item) => knowledgeMatchesQuery(item, "relay")).map((item) => item.id)).toEqual(["asset-1"]);
  });

  test("summarizes the owning Spaces of shared knowledge assets", () => {
    const state = remoteState([
      resource("space", "space-1", { title: "产品空间" }),
      resource("space", "space-2", { title: "研究空间" }),
      resource("workbench_asset", "asset-1", { title: "接口.md", text: "relay protocol", language: "markdown" }),
      resource("space_reference", "reference-1", { spaceId: "space-1", reference: { assetId: "asset-1" } }),
      resource("space_reference", "reference-2", { spaceId: "space-2", reference: { assetId: "asset-1" } }),
    ]);

    expect(projectKnowledge(state).find((item) => item.id === "asset-1")).toMatchObject({
      ownerLabel: "2 个空间",
      detail: "markdown",
    });
  });

  test("projects a conflict as a user-facing title and bounded local/remote previews", () => {
    const current = resource("personal_note", "note-1", { title: "移动端方向", bodyMarkdown: "电脑版本正文" });
    const mutation = {
      protocolVersion: "content-vault/v1",
      mutationId: "mutation-1",
      kind: "personal_note",
      resourceId: "note-1",
      baseRevision: 1,
      operation: "upsert",
      payloadSchemaVersion: 1,
      payload: { title: "移动端方向", bodyMarkdown: `${"手机版本".repeat(40)}` },
      contentHash: `sha256:${"b".repeat(64)}`,
    } satisfies ContentVaultMutation;
    const conflict = {
      mutationId: "mutation-1",
      mutation,
      reason: "revision_mismatch",
      current,
      detectedAt: "2026-08-04T08:15:00.000Z",
    } satisfies MobileVaultConflict;

    const result = conflictPresentation(conflict);
    expect(result.title).toBe("移动端方向");
    expect(result.localPreview).toMatch(/^手机版本/u);
    expect(result.localPreview!.length).toBeLessThanOrEqual(121);
    expect(result.localContent).toBe("手机版本".repeat(40));
    expect(result.remotePreview).toBe("电脑版本正文");
    expect(result.remoteContent).toBe("电脑版本正文");
    expect(result.canKeepLocal).toBe(true);
    expect(result.detectedAt).toBe("2026-08-04T08:15:00.000Z");
  });

  test("projects a Space as notes, managed roots, and their files", () => {
    const state = remoteState([
      resource("personal_note", "note-1", { spaceId: "space-1", title: "笔记", bodyMarkdown: "正文" }),
      resource("managed_root", "root-1", { spaceId: "space-1", title: "软件文件" }),
      resource("managed_file", "file-1", { managedRootId: "root-1", relativePath: "docs/plan.md", text: "计划" }),
    ]);

    expect(projectSpaceContent(state, "space-1").map((item) => ({ title: item.title, detail: item.detail, indent: item.indent }))).toEqual([
      { title: "笔记", detail: "笔记", indent: undefined },
      { title: "软件文件", detail: undefined, indent: undefined },
      { title: "docs", detail: undefined, indent: undefined },
      { title: "plan.md", detail: "docs", indent: true },
    ]);
  });

  test("projects durable pending notes and managed files only into their owning Space", () => {
    const state = remoteState([], [
      outboxEntry({
        mutationId: "pending-note",
        kind: "personal_note",
        resourceId: "note-pending",
        baseRevision: 0,
        operation: "upsert",
        payloadSchemaVersion: 1,
        payload: {
          spaceId: "space-1",
          title: "离线笔记",
          bodyMarkdown: "还未同步的正文",
          materialRefs: [],
          createdAt: 1,
          updatedAt: 1,
          sourceRevision: 1,
        },
        contentHash: `sha256:${"a".repeat(64)}`,
      }, "2026-08-05T00:00:00.000Z"),
      outboxEntry({
        mutationId: "pending-root",
        kind: "managed_root",
        resourceId: "root-pending",
        baseRevision: 0,
        operation: "upsert",
        payloadSchemaVersion: 1,
        payload: { spaceId: "space-2", title: "离线文件" },
        contentHash: `sha256:${"b".repeat(64)}`,
      }, "2026-08-05T00:00:00.000Z"),
      outboxEntry({
        mutationId: "pending-file",
        kind: "managed_file",
        resourceId: "file-pending",
        baseRevision: 0,
        operation: "upsert",
        payloadSchemaVersion: 1,
        payload: { managedRootId: "root-pending", relativePath: "docs/plan.md", text: "离线文件正文" },
        contentHash: `sha256:${"c".repeat(64)}`,
      }, "2026-08-05T00:00:00.000Z"),
      outboxEntry({
        mutationId: "unowned-file",
        kind: "managed_file",
        resourceId: "file-unowned",
        baseRevision: 0,
        operation: "upsert",
        payloadSchemaVersion: 1,
        payload: { managedRootId: "missing-root", relativePath: "draft.md", text: "不应显示" },
        contentHash: `sha256:${"d".repeat(64)}`,
      }, "2026-08-05T00:00:00.000Z"),
    ]);

    expect(projectPendingVaultContent(state)).toEqual([
      {
        kind: "managed_file",
        resourceId: "file-pending",
        spaceId: "space-2",
        title: "plan.md",
        draftText: "离线文件正文",
        detail: "等待同步",
      },
      {
        kind: "personal_note",
        resourceId: "note-pending",
        spaceId: "space-1",
        title: "离线笔记",
        draftText: "还未同步的正文",
        detail: "等待同步",
      },
    ]);
  });

  test("keeps same-time pending projection order deterministic", () => {
    const state = remoteState([], [
      outboxEntry({
        mutationId: "pending-z",
        kind: "personal_note",
        resourceId: "note-z",
        baseRevision: 0,
        operation: "upsert",
        payloadSchemaVersion: 1,
        payload: { spaceId: "space-1", title: "Z", bodyMarkdown: "", materialRefs: [], createdAt: 1, updatedAt: 1, sourceRevision: 1 },
        contentHash: `sha256:${"e".repeat(64)}`,
      }),
      outboxEntry({
        mutationId: "pending-a",
        kind: "personal_note",
        resourceId: "note-a",
        baseRevision: 0,
        operation: "upsert",
        payloadSchemaVersion: 1,
        payload: { spaceId: "space-1", title: "A", bodyMarkdown: "", materialRefs: [], createdAt: 1, updatedAt: 1, sourceRevision: 1 },
        contentHash: `sha256:${"f".repeat(64)}`,
      }),
    ]);

    expect(projectPendingVaultContent(state).map((item) => item.resourceId)).toEqual(["note-a", "note-z"]);
  });

  test("keeps nested managed files inside stable mobile folder parents", () => {
    const state = remoteState([
      resource("managed_root", "root-1", { spaceId: "space-1", title: "软件文件" }),
      resource("managed_file", "file-a", { managedRootId: "root-1", relativePath: "docs/plan.md", text: "计划" }),
      resource("managed_file", "file-b", { managedRootId: "root-1", relativePath: "docs/research/notes.md", text: "笔记" }),
    ]);

    expect(projectSpaceContent(state, "space-1").map((item) => ({ title: item.title, parentId: item.parentId, depth: item.depth }))).toEqual([
      { title: "软件文件", parentId: undefined, depth: undefined },
      { title: "docs", parentId: "root-1", depth: 1 },
      { title: "plan.md", parentId: "root-1:folder:docs", depth: 2 },
      { title: "research", parentId: "root-1:folder:docs", depth: 2 },
      { title: "notes.md", parentId: "root-1:folder:docs/research", depth: 3 },
    ]);
  });

  test("projects a conflict only into the Space that owns the resource", () => {
    const note = resource("personal_note", "note-1", { spaceId: "space-1", title: "笔记", bodyMarkdown: "电脑版本" });
    const conflict = {
      mutationId: "mutation-space-1",
      mutation: {
        protocolVersion: "content-vault/v1",
        mutationId: "mutation-space-1",
        kind: "personal_note",
        resourceId: "note-1",
        baseRevision: 1,
        operation: "upsert",
        payloadSchemaVersion: 1,
        payload: { spaceId: "space-1", title: "笔记", bodyMarkdown: "手机版本" },
        contentHash: `sha256:${"b".repeat(64)}`,
      } satisfies ContentVaultMutation,
      reason: "revision_mismatch",
      current: note,
      detectedAt: "2026-08-04T08:15:00.000Z",
    } satisfies MobileVaultConflict;
    const state = { ...remoteState([note]), vaultConflicts: [conflict] };

    expect(projectSpaceConflicts(state, "space-1")).toEqual([conflict]);
    expect(projectSpaceConflicts(state, "space-2")).toEqual([]);
  });

  test("normalizes managed paths and preserves note revision semantics", () => {
    expect(normalizeRelativePath("/docs\\plan.md/")).toBe("docs/plan.md");
    expect(() => normalizeRelativePath("../outside.md")).toThrow("相对路径");
    expect(normalizeManagedFileName(" 计划.md ")).toBe("计划.md");
    expect(() => normalizeManagedFileName("docs/计划.md")).toThrow("文件名");
    const note = resource("personal_note", "note-1", { bodyMarkdown: "旧", sourceRevision: 4 });
    expect(updatedTextPayload(note, "新", 7, "新标题")).toMatchObject({ title: "新标题", bodyMarkdown: "新", sourceRevision: 8 });
  });
});

function remoteState(vaultResources: readonly ContentVaultResource[], vaultOutbox: readonly MobileVaultOutboxEntry[] = []): MobileRemoteState {
  return {
    connection: "connected",
    peerOnline: true,
    conversations: [],
    conversationPages: {},
    runs: [],
    vaultResources,
    vaultOutbox,
    vaultCursor: 1,
    vaultConflicts: [],
    pendingCommandIds: [],
    pendingConversations: [],
    commandResults: [],
  };
}

function outboxEntry(
  mutation: Omit<Extract<MobileVaultOutboxEntry["mutation"], { readonly operation: "upsert" }>, "protocolVersion">,
  createdAt = "2026-08-04T00:00:00.000Z",
): MobileVaultOutboxEntry {
  const complete = { protocolVersion: "content-vault/v1" as const, ...mutation } as MobileVaultOutboxEntry["mutation"];
  return { mutationId: complete.mutationId, mutation: complete, createdAt };
}

function resource(kind: ContentVaultResourceKind, resourceId: string, payload: Readonly<Record<string, unknown>>): ContentVaultResource {
  return {
    kind,
    resourceId,
    revision: 1,
    deleted: false,
    payloadSchemaVersion: 1,
    payload,
    contentHash: `sha256:${"a".repeat(64)}`,
    contentBytes: 1,
    updatedAt: "2026-08-04T00:00:00.000Z",
    updatedByDeviceId: "desktop-1",
  };
}
