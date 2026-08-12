import assert from "node:assert/strict";
import test from "node:test";

import { contentVaultHash, type ContentVaultResource } from "../content-vault/index.js";
import {
  createPersonalKnowledgeContentVaultContributors,
  knowledgeAssignmentResourceId,
  knowledgeLinkResourceId,
  selectSynchronizablePersonalKnowledge,
  type KnowledgeAssignmentSyncRecord,
  type KnowledgeLinkSyncRecord,
  type KnowledgePageSyncRecord,
  type KnowledgeThemeSyncRecord,
  type PersonalKnowledgeSyncSnapshot,
} from "./personal-knowledge-contributors.js";

test("Knowledge Vault selection excludes pages whose content cannot be restored", () => {
  const snapshot = {
    pages: [
      { refId: "note-1", kind: "note" as const, collectedAt: 1 },
      { refId: "markdown-1", kind: "material" as const, collectedAt: 2 },
      { refId: "pdf-1", kind: "material" as const, collectedAt: 3 },
      { refId: "import-1", kind: "space_reference" as const, collectedAt: 4 },
    ],
    links: [
      { from: "note-1", to: "markdown-1" },
      { from: "note-1", to: "pdf-1" },
    ],
    themes: [{ id: "theme-1", name: "主题", color: "green", origin: "user" as const }],
    assignments: [
      { refId: "markdown-1", themeId: "theme-1", by: "user" as const, locked: true },
      { refId: "pdf-1", themeId: "theme-1", by: "user" as const, locked: true },
    ],
  };

  assert.deepEqual(selectSynchronizablePersonalKnowledge(snapshot, new Set(["markdown-1"])), {
    pages: snapshot.pages.slice(0, 2),
    links: [snapshot.links[0]],
    themes: snapshot.themes,
    assignments: [snapshot.assignments[0]],
  });
});

test("Personal Knowledge contributors project stable resources and apply remote changes", async () => {
  const state: MutableKnowledge = {
    pages: [{ refId: "note-1", kind: "note", collectedAt: 1 }],
    links: [],
    themes: [{ id: "theme-1", name: "研究", color: "violet", origin: "user" }],
    assignments: [],
  };
  const listeners = new Set<() => void>();
  const contributors = createPersonalKnowledgeContentVaultContributors({
    snapshot: async () => cloneSnapshot(state),
    async upsertPage(page) { upsert(state.pages, page, (item) => item.refId); },
    async deletePage(refId) { remove(state.pages, (item) => item.refId === refId); },
    async upsertLink(link) { upsert(state.links, link, knowledgeLinkResourceId); },
    async deleteLink(link) { remove(state.links, (item) => knowledgeLinkResourceId(item) === knowledgeLinkResourceId(link)); },
    async upsertTheme(theme) { upsert(state.themes, theme, (item) => item.id); },
    async deleteTheme(themeId) { remove(state.themes, (item) => item.id === themeId); },
    async upsertAssignment(assignment) { upsert(state.assignments, assignment, knowledgeAssignmentResourceId); },
    async deleteAssignment(assignment) {
      remove(state.assignments, (item) => knowledgeAssignmentResourceId(item) === knowledgeAssignmentResourceId(assignment));
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  });

  const byKind = new Map(contributors.map((contributor) => [contributor.kind, contributor]));
  assert.equal((await byKind.get("knowledge_page")!.list())[0]?.resourceId, "note-1");
  assert.equal((await byKind.get("knowledge_theme")!.read("theme-1"))?.payload.name, "研究");

  await byKind.get("knowledge_page")!.apply(resource("knowledge_page", "material-1", {
    refId: "material-1",
    kind: "material",
    collectedAt: 2,
  }));
  await byKind.get("knowledge_theme")!.apply(resource("knowledge_theme", "theme-1", {
    name: "长期研究",
    color: "green",
    origin: "user",
  }));
  const link = { from: "note-1", to: "material-1" } as const;
  await byKind.get("knowledge_link")!.apply(resource("knowledge_link", knowledgeLinkResourceId(link), link));
  const assignment = { refId: "material-1", themeId: "theme-1", by: "user", locked: true } as const;
  await byKind.get("knowledge_assignment")!.apply(resource(
    "knowledge_assignment",
    knowledgeAssignmentResourceId(assignment),
    assignment,
  ));

  assert.deepEqual(state.pages.at(-1), { refId: "material-1", kind: "material", collectedAt: 2 });
  assert.deepEqual(state.themes[0], { id: "theme-1", name: "长期研究", color: "green", origin: "user" });
  assert.deepEqual(state.links, [link]);
  assert.deepEqual(state.assignments, [assignment]);
});

test("relation tombstones resolve their identity from the local projection", async () => {
  const link = { from: "note-1", to: "material-1" } as const;
  const assignment = { refId: "material-1", themeId: "theme-1", by: "agent", locked: false } as const;
  const state: MutableKnowledge = {
    pages: [],
    links: [link],
    themes: [],
    assignments: [assignment],
  };
  const contributors = createPersonalKnowledgeContentVaultContributors({
    snapshot: async () => cloneSnapshot(state),
    upsertPage: async () => undefined,
    deletePage: async () => undefined,
    upsertLink: async () => undefined,
    async deleteLink(value) { remove(state.links, (item) => knowledgeLinkResourceId(item) === knowledgeLinkResourceId(value)); },
    upsertTheme: async () => undefined,
    deleteTheme: async () => undefined,
    upsertAssignment: async () => undefined,
    async deleteAssignment(value) {
      remove(state.assignments, (item) => knowledgeAssignmentResourceId(item) === knowledgeAssignmentResourceId(value));
    },
    subscribe: () => () => undefined,
  });
  const byKind = new Map(contributors.map((contributor) => [contributor.kind, contributor]));

  await byKind.get("knowledge_link")!.apply(tombstone("knowledge_link", knowledgeLinkResourceId(link)));
  await byKind.get("knowledge_assignment")!.apply(tombstone(
    "knowledge_assignment",
    knowledgeAssignmentResourceId(assignment),
  ));

  assert.deepEqual(state.links, []);
  assert.deepEqual(state.assignments, []);
});

type MutableKnowledge = {
  pages: KnowledgePageSyncRecord[];
  links: KnowledgeLinkSyncRecord[];
  themes: KnowledgeThemeSyncRecord[];
  assignments: KnowledgeAssignmentSyncRecord[];
};

function cloneSnapshot(state: MutableKnowledge): PersonalKnowledgeSyncSnapshot {
  return structuredClone(state);
}

function upsert<T>(values: T[], value: T, id: (item: T) => string): void {
  const index = values.findIndex((item) => id(item) === id(value));
  if (index < 0) values.push(value);
  else values[index] = value;
}

function remove<T>(values: T[], predicate: (item: T) => boolean): void {
  const index = values.findIndex(predicate);
  if (index >= 0) values.splice(index, 1);
}

function resource(
  kind: ContentVaultResource["kind"],
  resourceId: string,
  payload: Readonly<Record<string, unknown>>,
): ContentVaultResource {
  return {
    kind,
    resourceId,
    revision: 1,
    deleted: false,
    payloadSchemaVersion: 1,
    payload,
    contentHash: contentVaultHash(payload),
    contentBytes: Buffer.byteLength(JSON.stringify(payload), "utf8"),
    updatedAt: "2026-08-04T00:00:00.000Z",
    updatedByDeviceId: "mobile-1",
  };
}

function tombstone(kind: ContentVaultResource["kind"], resourceId: string): ContentVaultResource {
  return {
    kind,
    resourceId,
    revision: 2,
    deleted: true,
    payloadSchemaVersion: 1,
    contentHash: `sha256:${"0".repeat(64)}`,
    contentBytes: 0,
    updatedAt: "2026-08-04T00:00:00.000Z",
    updatedByDeviceId: "mobile-1",
  };
}
