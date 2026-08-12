import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import {
  CONTENT_VAULT_MAX_INLINE_BYTES,
  createContentVaultHttpHandler,
  contentVaultHash,
  createSqliteContentVaultRepository,
} from "./index.js";
import { createRemoteRelayStore } from "../remote-collaboration/relay-store.js";
import { startRemoteRelayServer } from "../remote-collaboration/relay-server.js";

test("Content Vault exposes account-scoped HTTP mutations without turning Relay into a content store", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarbor-content-vault-http-"));
  const relayDatabase = new SqliteRuntimeDatabase(path.join(root, "relay.sqlite"));
  const vaultDatabase = new SqliteRuntimeDatabase(path.join(root, "vault.sqlite"));
  const relayStore = createRemoteRelayStore({ database: relayDatabase, allowOpenSignup: true });
  const vault = createContentVaultHttpHandler({
    repository: createSqliteContentVaultRepository({ database: vaultDatabase }),
    authenticate(token) {
      const auth = relayStore.authenticate(token);
      return { accountId: auth.account.accountId, deviceId: auth.deviceId };
    },
  });
  const notifications: { accountId: string; sourceDeviceId: string; cursor: number }[] = [];
  vault.subscribe((event) => notifications.push(event));
  const relay = await startRemoteRelayServer({ store: relayStore, contentVault: vault, port: 0 });
  t.after(async () => {
    await relay.close();
    vaultDatabase.close();
    relayDatabase.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  });

  const activation = relayStore.activateAccount("Desktop");
  const payload = { title: "云端笔记", kind: "markdown" as const, text: "只保存软件维护的内容", language: "md" };
  const mutation = {
    protocolVersion: "content-vault/v1" as const,
    mutationId: "http-mutation-1",
    kind: "workbench_asset" as const,
    resourceId: "asset-http-1",
    baseRevision: 0,
    operation: "upsert" as const,
    payloadSchemaVersion: 1 as const,
    payload,
    contentHash: contentVaultHash(payload),
  };
  const applied = await request(relay.url, "/v1/vault/mutations", "POST", { protocolVersion: "content-vault/v1", mutations: [mutation] }, activation.accessToken);
  assert.equal(applied.status, 200);
  const appliedBody = await applied.json() as { results: readonly [{ status: string; cursor: number }] };
  assert.equal(appliedBody.results[0]?.status, "applied");
  assert.equal(appliedBody.results[0]?.cursor, 1);
  assert.deepEqual(notifications, [{
    accountId: activation.account.accountId,
    sourceDeviceId: activation.deviceId,
    cursor: 1,
  }]);

  const resource = await request(relay.url, "/v1/vault/resources/workbench_asset/asset-http-1", "GET", undefined, activation.accessToken);
  assert.equal(resource.status, 200);
  assert.equal((await resource.json() as { resource: { payload: { text: string } } }).resource.payload.text, "只保存软件维护的内容");

  const changes = await request(relay.url, "/v1/vault/changes?after=0&limit=10", "GET", undefined, activation.accessToken);
  assert.equal((await changes.json() as { changes: readonly unknown[] }).changes.length, 1);
  const usage = await request(relay.url, "/v1/vault/usage", "GET", undefined, activation.accessToken);
  assert.equal((await usage.json() as { usage: { activeResources: number } }).usage.activeResources, 1);

  await request(relay.url, "/v1/vault/mutations", "POST", {
    protocolVersion: "content-vault/v1",
    mutations: [2, 3].map((suffix) => ({
      ...mutation,
      mutationId: `http-mutation-${suffix}`,
      resourceId: `asset-http-${suffix}`,
    })),
  }, activation.accessToken);
  const firstSnapshot = await request(relay.url, "/v1/vault/snapshot?limit=1", "GET", undefined, activation.accessToken);
  const firstSnapshotBody = await firstSnapshot.json() as {
    readonly resources: readonly { readonly resourceId: string }[];
    readonly changeCursor: number;
    readonly nextCursor: { readonly changeCursor: number; readonly afterKind: string; readonly afterResourceId: string };
  };
  assert.deepEqual(firstSnapshotBody.resources.map((item) => item.resourceId), ["asset-http-1"]);
  assert.deepEqual(firstSnapshotBody.nextCursor, {
    changeCursor: firstSnapshotBody.changeCursor,
    afterKind: "workbench_asset",
    afterResourceId: "asset-http-1",
  });
  const nextQuery = new URLSearchParams({
    at: String(firstSnapshotBody.nextCursor.changeCursor),
    afterKind: firstSnapshotBody.nextCursor.afterKind,
    afterResourceId: firstSnapshotBody.nextCursor.afterResourceId,
    limit: "10",
  });
  const remainingSnapshot = await request(relay.url, `/v1/vault/snapshot?${nextQuery}`, "GET", undefined, activation.accessToken);
  assert.deepEqual((await remainingSnapshot.json() as { resources: readonly { resourceId: string }[] }).resources
    .map((item) => item.resourceId), ["asset-http-2", "asset-http-3"]);

  const conversation = await request(relay.url, "/v1/vault/mutations", "POST", {
    protocolVersion: "content-vault/v1",
    mutations: [{ ...mutation, mutationId: "conversation-must-not-enter-vault", kind: "conversation" }],
  }, activation.accessToken);
  assert.equal(conversation.status, 400);
  assert.equal((await conversation.json() as { error: { code: string } }).error.code, "invalid_vault_request");

  const workspaceNotebookPayload = {
    notebookId: "workspace-one",
    label: "本地工作区笔记",
    scope: "workspace",
    content: "This resource has no path-independent owner.",
  };
  const workspaceNotebook = await request(relay.url, "/v1/vault/mutations", "POST", {
    protocolVersion: "content-vault/v1",
    mutations: [{
      ...mutation,
      mutationId: "workspace-notebook-must-not-enter-vault",
      kind: "agent_notebook",
      resourceId: "workspace-one",
      payload: workspaceNotebookPayload,
      contentHash: contentVaultHash(workspaceNotebookPayload),
    }],
  }, activation.accessToken);
  assert.equal(workspaceNotebook.status, 400);
  assert.equal((await workspaceNotebook.json() as { error: { code: string } }).error.code, "invalid_vault_request");
});

test("Content Vault accepts one maximum-size inline resource through HTTP", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarbor-content-vault-max-http-"));
  const relayDatabase = new SqliteRuntimeDatabase(path.join(root, "relay.sqlite"));
  const vaultDatabase = new SqliteRuntimeDatabase(path.join(root, "vault.sqlite"));
  const relayStore = createRemoteRelayStore({ database: relayDatabase, allowOpenSignup: true });
  const vault = createContentVaultHttpHandler({
    repository: createSqliteContentVaultRepository({ database: vaultDatabase }),
    authenticate(token) {
      const auth = relayStore.authenticate(token);
      return { accountId: auth.account.accountId, deviceId: auth.deviceId };
    },
  });
  const relay = await startRemoteRelayServer({ store: relayStore, contentVault: vault, port: 0 });
  t.after(async () => {
    await relay.close();
    vaultDatabase.close();
    relayDatabase.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  });

  const activation = relayStore.activateAccount("Desktop");
  const emptyPayload = { title: "最大文档", kind: "markdown" as const, text: "", language: "md" };
  const payload = {
    ...emptyPayload,
    text: "x".repeat(CONTENT_VAULT_MAX_INLINE_BYTES - Buffer.byteLength(JSON.stringify(emptyPayload), "utf8")),
  };
  const response = await request(relay.url, "/v1/vault/mutations", "POST", {
    protocolVersion: "content-vault/v1",
    mutations: [{
      protocolVersion: "content-vault/v1",
      mutationId: "max-inline-resource",
      kind: "workbench_asset",
      resourceId: "max-inline-resource",
      baseRevision: 0,
      operation: "upsert",
      payloadSchemaVersion: 1,
      payload,
      contentHash: contentVaultHash(payload),
    }],
  }, activation.accessToken);

  assert.equal(response.status, 200);
});

test("Content Vault bounds change and snapshot pages by serialized response bytes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarbor-content-vault-response-budget-"));
  const relayDatabase = new SqliteRuntimeDatabase(path.join(root, "relay.sqlite"));
  const vaultDatabase = new SqliteRuntimeDatabase(path.join(root, "vault.sqlite"));
  const relayStore = createRemoteRelayStore({ database: relayDatabase, allowOpenSignup: true });
  const vault = createContentVaultHttpHandler({
    repository: createSqliteContentVaultRepository({ database: vaultDatabase }),
    authenticate(token) {
      const auth = relayStore.authenticate(token);
      return { accountId: auth.account.accountId, deviceId: auth.deviceId };
    },
  });
  const relay = await startRemoteRelayServer({ store: relayStore, contentVault: vault, port: 0 });
  t.after(async () => {
    await relay.close();
    vaultDatabase.close();
    relayDatabase.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  });

  const activation = relayStore.activateAccount("Desktop");
  const text = "x".repeat(4_500_000);
  for (const ordinal of [1, 2]) {
    const payload = { title: `大型文档 ${ordinal}`, kind: "markdown" as const, text, language: "md" };
    const response = await request(relay.url, "/v1/vault/mutations", "POST", {
      protocolVersion: "content-vault/v1",
      mutations: [{
        protocolVersion: "content-vault/v1",
        mutationId: `large-mutation-${ordinal}`,
        kind: "workbench_asset",
        resourceId: `large-resource-${ordinal}`,
        baseRevision: 0,
        operation: "upsert",
        payloadSchemaVersion: 1,
        payload,
        contentHash: contentVaultHash(payload),
      }],
    }, activation.accessToken);
    assert.equal(response.status, 200);
  }

  const firstChanges = await request(relay.url, "/v1/vault/changes?after=0&limit=10", "GET", undefined, activation.accessToken);
  const firstChangesBody = await firstChanges.json() as {
    readonly changes: readonly { readonly cursor: number }[];
    readonly nextCursor: number;
    readonly hasMore: boolean;
  };
  assert.equal(firstChangesBody.changes.length, 1);
  assert.equal(firstChangesBody.nextCursor, 1);
  assert.equal(firstChangesBody.hasMore, true);
  const remainingChanges = await request(relay.url, `/v1/vault/changes?after=${firstChangesBody.nextCursor}&limit=10`, "GET", undefined, activation.accessToken);
  assert.deepEqual((await remainingChanges.json() as { changes: readonly { cursor: number }[] }).changes.map((change) => change.cursor), [2]);

  const firstSnapshot = await request(relay.url, "/v1/vault/snapshot?limit=10", "GET", undefined, activation.accessToken);
  const firstSnapshotBody = await firstSnapshot.json() as {
    readonly resources: readonly { readonly resourceId: string }[];
    readonly nextCursor: { readonly changeCursor: number; readonly afterKind: string; readonly afterResourceId: string };
  };
  assert.deepEqual(firstSnapshotBody.resources.map((resource) => resource.resourceId), ["large-resource-1"]);
  assert.equal(firstSnapshotBody.nextCursor.afterResourceId, "large-resource-1");
  const nextQuery = new URLSearchParams({
    at: String(firstSnapshotBody.nextCursor.changeCursor),
    afterKind: firstSnapshotBody.nextCursor.afterKind,
    afterResourceId: firstSnapshotBody.nextCursor.afterResourceId,
    limit: "10",
  });
  const remainingSnapshot = await request(relay.url, `/v1/vault/snapshot?${nextQuery}`, "GET", undefined, activation.accessToken);
  assert.deepEqual((await remainingSnapshot.json() as { resources: readonly { resourceId: string }[] }).resources
    .map((resource) => resource.resourceId), ["large-resource-2"]);
});

async function request(baseUrl: string, pathname: string, method: string, body: unknown, token: string): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
