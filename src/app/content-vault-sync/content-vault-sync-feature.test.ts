import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import {
  CONTENT_VAULT_PROTOCOL_VERSION,
  contentVaultHash,
  createSqliteContentVaultRepository,
  type ContentVaultMutation,
} from "../content-vault/index.js";
import { createPersonalKnowledgeFeature } from "../personal-knowledge/personal-knowledge-feature.js";
import { createSqlitePersonalKnowledgeRepository } from "../personal-knowledge/sqlite-repository.js";
import { createContentVaultSyncFeature } from "./content-vault-sync-feature.js";
import { createPersonalNoteContentVaultContributor } from "./personal-note-contributor.js";
import { createSqliteContentVaultSyncStore, type ContentVaultSyncStore } from "./sqlite-store.js";

test("production synchronization rejects an incomplete contributor set", () => {
  assert.throws(() => createContentVaultSyncFeature({
    store: {} as ContentVaultSyncStore,
    credential: async () => undefined,
    contributors: [],
    requireAllResourceKinds: true,
  }), /contributors are missing: space, space_reference/u);
});

test("Personal Knowledge notes synchronize through durable Vault clocks and tombstones", async (t) => {
  const fixture = await createFixture(t);
  const local = await fixture.knowledge.commands.createNote({
    id: "local-note",
    spaceId: "space-one",
    title: "本地笔记",
    bodyMarkdown: "第一版",
  });

  await fixture.sync.commands.synchronize();
  assert.equal(fixture.vault.readResource(ACCOUNT_ID, "personal_note", local.id)?.payload?.bodyMarkdown, "第一版");

  applyRemoteNote(fixture, {
    mutationId: "mobile-create",
    resourceId: "mobile-note",
    baseRevision: 0,
    title: "手机新建",
    bodyMarkdown: "来自手机",
    sourceRevision: 1,
  });
  await fixture.sync.commands.synchronize();
  assert.equal((await fixture.knowledge.queries.note("mobile-note"))?.bodyMarkdown, "来自手机");

  const localRemote = fixture.vault.readResource(ACCOUNT_ID, "personal_note", local.id)!;
  applyRemoteNote(fixture, {
    mutationId: "mobile-update",
    resourceId: local.id,
    baseRevision: localRemote.revision,
    title: "手机改名",
    bodyMarkdown: "第二版来自手机",
    sourceRevision: 2,
    createdAt: local.createdAt,
  });
  await fixture.sync.commands.synchronize();
  const afterMobile = (await fixture.knowledge.queries.note(local.id))!;
  assert.equal(afterMobile.title, "手机改名");
  assert.equal(afterMobile.bodyMarkdown, "第二版来自手机");

  await fixture.knowledge.commands.updateNote({
    id: local.id,
    expectedRevision: afterMobile.revision,
    bodyMarkdown: "第三版来自桌面",
  });
  await fixture.sync.commands.synchronize();
  const afterDesktop = fixture.vault.readResource(ACCOUNT_ID, "personal_note", local.id)!;
  assert.equal(afterDesktop.payload?.bodyMarkdown, "第三版来自桌面");

  const beforeDelete = (await fixture.knowledge.queries.note(local.id))!;
  await fixture.knowledge.commands.deleteNote({ id: local.id, expectedRevision: beforeDelete.revision });
  await fixture.sync.commands.synchronize();
  assert.equal(fixture.vault.readResource(ACCOUNT_ID, "personal_note", local.id)?.deleted, true);
  assert.equal(fixture.sync.queries.status().state, "synced");
});

test("a persisted outbox resumes after restart without changing its mutation identity", async (t) => {
  const fixture = await createFixture(t, { remoteFailure: true });
  await fixture.knowledge.commands.createNote({
    id: "retry-note",
    spaceId: "space-one",
    title: "等待续传",
    bodyMarkdown: "不会丢",
  });
  await assert.rejects(fixture.sync.commands.synchronize(), /temporary outage/u);
  const queued = fixture.store.pending(ACCOUNT_ID);
  assert.equal(queued.length, 1);

  await fixture.sync.release();
  fixture.sync = fixture.createSync(false);
  await fixture.sync.commands.synchronize();

  assert.equal(fixture.store.pending(ACCOUNT_ID).length, 0);
  assert.equal(fixture.vault.readResource(ACCOUNT_ID, "personal_note", "retry-note")?.payload?.bodyMarkdown, "不会丢");
  assert.equal(fixture.vaultMutationIds.at(-1), queued[0]?.mutation.mutationId);
});

test("concurrent desktop and mobile edits become a durable conflict instead of overwriting either side", async (t) => {
  const fixture = await createFixture(t);
  const note = await fixture.knowledge.commands.createNote({
    id: "conflict-note",
    spaceId: "space-one",
    title: "冲突",
    bodyMarkdown: "共同版本",
  });
  await fixture.sync.commands.synchronize();

  await fixture.knowledge.commands.updateNote({
    id: note.id,
    expectedRevision: note.revision,
    bodyMarkdown: "桌面版本",
  });
  const remote = fixture.vault.readResource(ACCOUNT_ID, "personal_note", note.id)!;
  applyRemoteNote(fixture, {
    mutationId: "mobile-conflict",
    resourceId: note.id,
    baseRevision: remote.revision,
    title: "冲突",
    bodyMarkdown: "手机版本",
    sourceRevision: 2,
    createdAt: note.createdAt,
  });
  applyRemoteNote(fixture, {
    mutationId: "mobile-independent-note",
    resourceId: "independent-note",
    baseRevision: 0,
    title: "不相关笔记",
    bodyMarkdown: "不应被前一个冲突阻塞",
    sourceRevision: 1,
  });

  await fixture.sync.commands.synchronize();
  assert.equal((await fixture.knowledge.queries.note(note.id))?.bodyMarkdown, "桌面版本");
  assert.equal(fixture.vault.readResource(ACCOUNT_ID, "personal_note", note.id)?.payload?.bodyMarkdown, "手机版本");
  assert.equal((await fixture.knowledge.queries.note("independent-note"))?.bodyMarkdown, "不应被前一个冲突阻塞");
  assert.equal(fixture.sync.queries.status().state, "blocked");
  assert.equal(fixture.store.listConflicts(ACCOUNT_ID)[0]?.reason, "revision_mismatch");

  await fixture.sync.release();
  fixture.sync = fixture.createSync(false);
  assert.equal(fixture.sync.queries.conflicts(ACCOUNT_ID)[0]?.resourceId, note.id);
});

test("forgetting an account clears only its durable sync metadata", async (t) => {
  const fixture = await createFixture(t);
  await fixture.knowledge.commands.createNote({
    id: "local-content-survives",
    spaceId: "space-one",
    bodyMarkdown: "仍保留在桌面",
  });
  await fixture.sync.commands.synchronize();
  assert.equal(fixture.store.listClocks(ACCOUNT_ID, "personal_note").length, 1);

  await fixture.sync.commands.clearAccount(ACCOUNT_ID);

  assert.deepEqual(fixture.store.accountState(ACCOUNT_ID), { cursor: 0, snapshotInitialized: false });
  assert.equal(fixture.store.listClocks(ACCOUNT_ID, "personal_note").length, 0);
  assert.equal(fixture.store.pending(ACCOUNT_ID).length, 0);
  assert.equal(fixture.store.listConflicts(ACCOUNT_ID).length, 0);
  assert.equal((await fixture.knowledge.queries.note("local-content-survives"))?.bodyMarkdown, "仍保留在桌面");
});

test("a remote resource without a local owner becomes a durable conflict", async (t) => {
  const fixture = await createFixture(t);
  const payload = { title: "未装配资产", kind: "markdown", text: "不能静默跳过", language: "md" };
  const applied = fixture.vault.applyMutation({
    accountId: ACCOUNT_ID,
    deviceId: "mobile-one",
    mutation: {
      protocolVersion: CONTENT_VAULT_PROTOCOL_VERSION,
      mutationId: "unsupported-kind",
      kind: "workbench_asset",
      resourceId: "asset-without-owner",
      operation: "upsert",
      baseRevision: 0,
      payloadSchemaVersion: 1,
      payload,
      contentHash: contentVaultHash(payload),
    },
    at: "2026-08-04T00:00:00.000Z",
  });
  assert.equal(applied.status, "applied");
  if (applied.status !== "applied") return;

  await fixture.sync.commands.synchronize();

  assert.equal(fixture.store.accountState(ACCOUNT_ID).cursor, applied.cursor);
  assert.deepEqual(fixture.sync.queries.conflicts(ACCOUNT_ID).map((conflict) => ({
    kind: conflict.kind,
    resourceId: conflict.resourceId,
    reason: conflict.reason,
    message: conflict.message,
  })), [{
    kind: "workbench_asset",
    resourceId: "asset-without-owner",
    reason: "remote_apply_failed",
    message: "No local Content Vault contributor owns workbench_asset",
  }]);
});

const ACCOUNT_ID = "account-one";

async function createFixture(t: test.TestContext, options: { readonly remoteFailure?: boolean } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-vault-sync-"));
  const localDatabase = new SqliteRuntimeDatabase(path.join(root, "local.sqlite3"));
  const vaultDatabase = new SqliteRuntimeDatabase(path.join(root, "vault.sqlite3"));
  const store = createSqliteContentVaultSyncStore(localDatabase);
  const knowledge = createPersonalKnowledgeFeature({
    repository: createSqlitePersonalKnowledgeRepository(localDatabase),
    spaceExists: async (spaceId) => spaceId === "space-one",
  });
  const vault = createSqliteContentVaultRepository({ database: vaultDatabase });
  const vaultMutationIds: string[] = [];
  const contributor = createPersonalNoteContentVaultContributor({
    list: async () => (await knowledge.queries.snapshot()).notes,
    read: (id) => knowledge.queries.note(id),
    create: async (input) => { await knowledge.commands.createNote(input); },
    update: async (input) => { await knowledge.commands.updateNote(input); },
    delete: async (input) => { await knowledge.commands.deleteNote(input); },
    subscribe: (listener) => knowledge.events.subscribe((event) => {
      if (event.type.startsWith("personal_knowledge.note_")) listener();
    }),
  });
  let ids = 0;
  const createSync = (remoteFailure = options.remoteFailure === true) => createContentVaultSyncFeature({
    store,
    credential: async () => ({ accountId: ACCOUNT_ID, deviceId: "desktop-one", baseUrl: "https://unused.invalid", token: "x".repeat(32) }),
    contributors: [contributor],
    idFactory: () => `desktop-mutation-${++ids}`,
    now: monotonicIso(),
    remote: () => ({
      async mutate(mutations) {
        if (remoteFailure) throw new Error("temporary outage");
        return mutations.map((mutation) => {
          vaultMutationIds.push(mutation.mutationId);
          return vault.applyMutation({ accountId: ACCOUNT_ID, deviceId: "desktop-one", mutation, at: new Date().toISOString() });
        });
      },
      async changes(after, limit = 100) {
        const all = vault.listChanges(ACCOUNT_ID, after, limit + 1);
        const changes = all.slice(0, limit);
        return {
          changes,
          nextCursor: changes.at(-1)?.cursor ?? after,
          hasMore: all.length > changes.length,
        };
      },
      async snapshot(cursor, limit = 100) {
        return vault.snapshot(ACCOUNT_ID, cursor, limit);
      },
    }),
  });
  let sync = createSync();
  const fixture = { knowledge, vault, store, vaultMutationIds, createSync, get sync() { return sync; }, set sync(value) { sync = value; } };
  t.after(async () => {
    await sync.release();
    await knowledge.release();
    localDatabase.close();
    vaultDatabase.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  });
  return fixture;
}

function applyRemoteNote(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  input: {
    readonly mutationId: string;
    readonly resourceId: string;
    readonly baseRevision: number;
    readonly title: string;
    readonly bodyMarkdown: string;
    readonly sourceRevision: number;
    readonly createdAt?: number;
  },
): void {
  const payload = {
    spaceId: "space-one",
    title: input.title,
    bodyMarkdown: input.bodyMarkdown,
    materialRefs: [],
    createdAt: input.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    sourceRevision: input.sourceRevision,
  };
  const mutation: ContentVaultMutation = {
    protocolVersion: CONTENT_VAULT_PROTOCOL_VERSION,
    mutationId: input.mutationId,
    kind: "personal_note",
    resourceId: input.resourceId,
    operation: "upsert",
    baseRevision: input.baseRevision,
    payloadSchemaVersion: 1,
    payload,
    contentHash: contentVaultHash(payload),
  };
  const result = fixture.vault.applyMutation({
    accountId: ACCOUNT_ID,
    deviceId: "mobile-one",
    mutation,
    at: new Date().toISOString(),
  });
  assert.equal(result.status, "applied");
}

function monotonicIso(): () => string {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 7, 4, 0, 0, tick++)).toISOString();
}
