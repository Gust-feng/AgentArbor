import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import { contentVaultHash } from "./sqlite-repository.js";
import { ContentVaultError, createSqliteContentVaultRepository } from "./sqlite-repository.js";

test("Content Vault applies idempotent CAS mutations and keeps delete tombstones", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarbor-content-vault-"));
  const database = new SqliteRuntimeDatabase(path.join(root, "vault.sqlite"));
  const repository = createSqliteContentVaultRepository({ database });
  t.after(async () => {
    database.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  });

  const payload = {
    title: "同步说明",
    kind: "markdown" as const,
    text: "第一版内容",
    language: "md",
  };
  const mutation = {
    protocolVersion: "content-vault/v1" as const,
    mutationId: "mutation-1",
    kind: "workbench_asset" as const,
    resourceId: "asset-1",
    baseRevision: 0,
    operation: "upsert" as const,
    payloadSchemaVersion: 1 as const,
    payload,
    contentHash: contentVaultHash(payload),
  };
  const applied = repository.applyMutation({ accountId: "account-1", deviceId: "desktop-1", mutation, at: "2026-08-04T00:00:00.000Z" });
  assert.equal(applied.status, "applied");
  if (applied.status !== "applied") return;
  assert.equal(applied.resource.revision, 1);

  const retried = repository.applyMutation({ accountId: "account-1", deviceId: "desktop-1", mutation, at: "2026-08-04T00:00:01.000Z" });
  assert.deepEqual(retried, applied);

  const stale = repository.applyMutation({
    accountId: "account-1",
    deviceId: "mobile-1",
    mutation: { ...mutation, mutationId: "mutation-stale", baseRevision: 0, payload: { ...payload, text: "过期内容" }, contentHash: contentVaultHash({ ...payload, text: "过期内容" }) },
    at: "2026-08-04T00:00:02.000Z",
  });
  assert.equal(stale.status, "conflict");
  assert.equal(stale.status === "conflict" ? stale.reason : undefined, "revision_mismatch");

  const deleted = repository.applyMutation({
    accountId: "account-1",
    deviceId: "desktop-1",
    mutation: {
      protocolVersion: "content-vault/v1",
      mutationId: "mutation-delete",
      kind: "workbench_asset",
      resourceId: "asset-1",
      baseRevision: 1,
      operation: "delete",
    },
    at: "2026-08-04T00:00:03.000Z",
  });
  assert.equal(deleted.status, "applied");
  assert.equal(deleted.status === "applied" ? deleted.resource.deleted : undefined, true);

  const resurrectedWithoutBase = repository.applyMutation({
    accountId: "account-1",
    deviceId: "mobile-1",
    mutation: { ...mutation, mutationId: "mutation-resurrect-old", baseRevision: 0 },
    at: "2026-08-04T00:00:04.000Z",
  });
  assert.equal(resurrectedWithoutBase.status, "conflict");
  assert.equal(resurrectedWithoutBase.status === "conflict" ? resurrectedWithoutBase.reason : undefined, "revision_mismatch");

  const restored = repository.applyMutation({
    accountId: "account-1",
    deviceId: "mobile-1",
    mutation: { ...mutation, mutationId: "mutation-restore", baseRevision: 2, payload: { ...payload, text: "恢复内容" }, contentHash: contentVaultHash({ ...payload, text: "恢复内容" }) },
    at: "2026-08-04T00:00:05.000Z",
  });
  assert.equal(restored.status, "applied");
  assert.equal(restored.status === "applied" ? restored.resource.revision : undefined, 3);

  const changes = repository.listChanges("account-1", 0, 20);
  assert.deepEqual(changes.map((change) => [change.cursor, change.resource.revision]), [[3, 3]]);
  assert.equal(repository.readResource("account-1", "workbench_asset", "asset-1")?.revision, 3);
  assert.equal(repository.readResource("account-2", "workbench_asset", "asset-1"), undefined);
});

test("Content Vault enforces inline and account quotas without partial writes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarbor-content-vault-quota-"));
  const database = new SqliteRuntimeDatabase(path.join(root, "vault.sqlite"));
  const repository = createSqliteContentVaultRepository({ database, accountBytes: 10, maxResources: 1 });
  t.after(async () => {
    database.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  });

  const firstPayload = { title: "a", kind: "markdown" as const, text: "1234567890", language: "md" };
  assert.throws(
    () => repository.applyMutation({
      accountId: "account-1",
      deviceId: "desktop-1",
      mutation: {
        protocolVersion: "content-vault/v1",
        mutationId: "quota-1",
        kind: "workbench_asset",
        resourceId: "asset-1",
        baseRevision: 0,
        operation: "upsert",
        payloadSchemaVersion: 1,
        payload: firstPayload,
        contentHash: contentVaultHash(firstPayload),
      },
      at: "2026-08-04T00:00:00.000Z",
    }),
    (error: unknown) => error instanceof ContentVaultError && error.code === "vault_quota_exceeded",
  );
  assert.deepEqual(repository.usage("account-1").contentBytes, 0);
});

test("Content Vault snapshot keeps a fixed cursor while concurrent inserts use the change feed", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarbor-content-vault-snapshot-"));
  const database = new SqliteRuntimeDatabase(path.join(root, "vault.sqlite"));
  const repository = createSqliteContentVaultRepository({ database });
  t.after(async () => {
    database.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  });

  const upsert = (resourceId: string, mutationId: string) => {
    const payload = { title: resourceId, kind: "markdown" as const, text: resourceId, language: "md" };
    return repository.applyMutation({
      accountId: "account-1",
      deviceId: "desktop-1",
      mutation: {
        protocolVersion: "content-vault/v1",
        mutationId,
        kind: "workbench_asset",
        resourceId,
        baseRevision: 0,
        operation: "upsert",
        payloadSchemaVersion: 1,
        payload,
        contentHash: contentVaultHash(payload),
      },
      at: "2026-08-04T00:00:00.000Z",
    });
  };

  upsert("b", "mutation-b");
  upsert("c", "mutation-c");
  upsert("d", "mutation-d");
  const first = repository.snapshot("account-1", undefined, 1);
  assert.deepEqual(first.resources.map((resource) => resource.resourceId), ["b"]);
  assert.deepEqual(first.nextCursor, {
    changeCursor: 3,
    afterKind: "workbench_asset",
    afterResourceId: "b",
  });

  upsert("a", "mutation-a");
  const second = repository.snapshot("account-1", first.nextCursor, 10);
  assert.equal(second.changeCursor, 3);
  assert.deepEqual(second.resources.map((resource) => resource.resourceId), ["c", "d"]);
  assert.deepEqual(repository.listChanges("account-1", second.changeCursor, 10)
    .map((change) => change.resource.resourceId), ["a"]);
});

test("Content Vault coalesces autosave bursts and applies the byte budget before loading the next body", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarbor-content-vault-changes-"));
  const database = new SqliteRuntimeDatabase(path.join(root, "vault.sqlite"));
  const repository = createSqliteContentVaultRepository({ database });
  t.after(async () => {
    database.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  });

  let revision = 0;
  for (let index = 1; index <= 100; index += 1) {
    const payload = { title: "autosave", kind: "markdown" as const, text: `version-${index}`, language: "md" };
    const result = repository.applyMutation({
      accountId: "account-1",
      deviceId: "desktop-1",
      mutation: {
        protocolVersion: "content-vault/v1",
        mutationId: `autosave-${index}`,
        kind: "workbench_asset",
        resourceId: "asset-1",
        baseRevision: revision,
        operation: "upsert",
        payloadSchemaVersion: 1,
        payload,
        contentHash: contentVaultHash(payload),
      },
      at: new Date(Date.UTC(2026, 7, 4, 0, 0, index)).toISOString(),
    });
    assert.equal(result.status, "applied");
    if (result.status === "applied") revision = result.resource.revision;
  }
  const secondPayload = { title: "second", kind: "markdown" as const, text: "second body", language: "md" };
  repository.applyMutation({
    accountId: "account-1",
    deviceId: "desktop-1",
    mutation: {
      protocolVersion: "content-vault/v1",
      mutationId: "second-resource",
      kind: "workbench_asset",
      resourceId: "asset-2",
      baseRevision: 0,
      operation: "upsert",
      payloadSchemaVersion: 1,
      payload: secondPayload,
      contentHash: contentVaultHash(secondPayload),
    },
    at: "2026-08-04T00:02:00.000Z",
  });

  const coalesced = repository.listChanges("account-1", 0, 500);
  assert.deepEqual(coalesced.map((change) => [change.cursor, change.resource.resourceId]), [[100, "asset-1"], [101, "asset-2"]]);
  assert.equal(coalesced[0]?.resource.payload?.text, "version-100");

  const firstPage = repository.listChanges("account-1", 0, 500, 1);
  assert.deepEqual(firstPage.map((change) => change.resource.resourceId), ["asset-1"]);
  assert.deepEqual(repository.listChanges("account-1", firstPage[0]!.cursor, 500, 1)
    .map((change) => change.resource.resourceId), ["asset-2"]);
});

test("Content Vault bounds tombstone identities and prunes superseded history after 30 days", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarbor-content-vault-retention-"));
  const database = new SqliteRuntimeDatabase(path.join(root, "vault.sqlite"));
  const repository = createSqliteContentVaultRepository({ database, accountBytes: 1_024, maxResources: 1 });
  t.after(async () => {
    database.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  });

  const payload = { title: "one", kind: "markdown" as const, text: "v1", language: "md" };
  const upsert = repository.applyMutation({
    accountId: "account-1",
    deviceId: "desktop-1",
    mutation: {
      protocolVersion: "content-vault/v1",
      mutationId: "resource-one-v1",
      kind: "workbench_asset",
      resourceId: "asset-1",
      baseRevision: 0,
      operation: "upsert",
      payloadSchemaVersion: 1,
      payload,
      contentHash: contentVaultHash(payload),
    },
    at: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(upsert.status, "applied");
  const updatedPayload = { ...payload, text: "v2" };
  repository.applyMutation({
    accountId: "account-1",
    deviceId: "desktop-1",
    mutation: {
      protocolVersion: "content-vault/v1",
      mutationId: "resource-one-v2",
      kind: "workbench_asset",
      resourceId: "asset-1",
      baseRevision: 1,
      operation: "upsert",
      payloadSchemaVersion: 1,
      payload: updatedPayload,
      contentHash: contentVaultHash(updatedPayload),
    },
    at: "2026-01-02T00:00:00.000Z",
  });
  repository.applyMutation({
    accountId: "account-1",
    deviceId: "desktop-1",
    mutation: {
      protocolVersion: "content-vault/v1",
      mutationId: "resource-one-delete",
      kind: "workbench_asset",
      resourceId: "asset-1",
      baseRevision: 2,
      operation: "delete",
    },
    at: "2026-02-15T00:00:00.000Z",
  });

  const changeCount = database.connection.prepare("SELECT COUNT(*) AS count FROM vault_changes WHERE account_id = ?")
    .get("account-1") as { readonly count: number };
  const receiptCount = database.connection.prepare("SELECT COUNT(*) AS count FROM vault_mutations WHERE account_id = ?")
    .get("account-1") as { readonly count: number };
  assert.equal(changeCount.count, 2);
  assert.equal(receiptCount.count, 1);

  const second = { title: "two", kind: "markdown" as const, text: "new", language: "md" };
  assert.throws(() => repository.applyMutation({
    accountId: "account-1",
    deviceId: "desktop-1",
    mutation: {
      protocolVersion: "content-vault/v1",
      mutationId: "resource-two",
      kind: "workbench_asset",
      resourceId: "asset-2",
      baseRevision: 0,
      operation: "upsert",
      payloadSchemaVersion: 1,
      payload: second,
      contentHash: contentVaultHash(second),
    },
    at: "2026-02-15T00:01:00.000Z",
  }), (error: unknown) => error instanceof ContentVaultError && error.code === "vault_resource_limit_exceeded");
});
