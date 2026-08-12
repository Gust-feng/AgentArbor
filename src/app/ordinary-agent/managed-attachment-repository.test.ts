import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createFileSystemOrdinaryManagedAttachmentRepository,
  OrdinaryManagedAttachmentRepositoryError,
  ORDINARY_MANAGED_ATTACHMENT_SCHEMA_VERSION,
  type OrdinaryManagedAttachmentRecord,
} from "./managed-attachment-repository.js";

test("managed attachment repository creates an atomic draft with its content and record", async (t) => {
  const root = await createRoot(t, "ordinary-managed-attachment-create-");
  const repository = createFileSystemOrdinaryManagedAttachmentRepository(root);
  const content = Uint8Array.from([0, 1, 2, 255]);

  const created = await repository.createDraft({
    attachmentId: "opaque-attachment-1",
    instanceId: "instance-1",
    originalName: "report.bin",
    mimeType: "application/octet-stream",
    content,
    createdAt: "2026-08-02T00:00:00.000Z",
  });

  assert.deepEqual(created, {
    created: true,
    record: {
      schemaVersion: ORDINARY_MANAGED_ATTACHMENT_SCHEMA_VERSION,
      attachmentId: "opaque-attachment-1",
      owner: { kind: "draft", instanceId: "instance-1" },
      originalName: "report.bin",
      mimeType: "application/octet-stream",
      byteLength: 4,
      sha256: sha256(content),
      createdAt: "2026-08-02T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
    },
  });

  const contentPath = await repository.resolveContentPath(created.record.attachmentId);
  assert.deepEqual([...await fs.readFile(contentPath)], [...content]);
  const directory = path.dirname(contentPath);
  assert.match(path.basename(directory), /^attachment-[A-Za-z0-9_-]+$/u);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, "record.json"), "utf8")), created.record);
  assert.deepEqual(await fs.readdir(root), [path.basename(directory)]);
  assert.deepEqual(await repository.get(created.record.attachmentId), created.record);

  if (process.platform !== "win32") {
    assert.equal((await fs.stat(contentPath)).mode & 0o777, 0o600);
    assert.equal((await fs.stat(path.join(directory, "record.json"))).mode & 0o777, 0o600);
  }
});

test("createDraft returns the existing matching draft without overwriting its first-write facts", async (t) => {
  const root = await createRoot(t, "ordinary-managed-attachment-create-idempotent-");
  const repository = createFileSystemOrdinaryManagedAttachmentRepository(root);
  const content = new TextEncoder().encode("same upload");
  const first = await repository.createDraft({
    attachmentId: "stable-upload-0",
    instanceId: "instance-1",
    originalName: "upload.txt",
    mimeType: "text/plain",
    content,
    createdAt: "2026-08-02T00:00:00.000Z",
  });

  const replay = await repository.createDraft({
    attachmentId: "stable-upload-0",
    instanceId: "instance-1",
    originalName: "upload.txt",
    mimeType: "text/plain",
    content: new Uint8Array(content),
    createdAt: "2026-08-02T00:01:00.000Z",
  });

  assert.equal(first.created, true);
  assert.deepEqual(replay, { record: first.record, created: false });
  assert.equal(replay.record.createdAt, "2026-08-02T00:00:00.000Z");

  for (const conflicting of [
    { originalName: "other.txt", mimeType: "text/plain", content },
    { originalName: "upload.txt", mimeType: "application/octet-stream", content },
    { originalName: "upload.txt", mimeType: "text/plain", content: new TextEncoder().encode("other upload") },
  ]) {
    await assertCode(
      repository.createDraft({
        attachmentId: "stable-upload-0",
        instanceId: "instance-1",
        ...conflicting,
        createdAt: "2026-08-02T00:02:00.000Z",
      }),
      "ordinary_managed_attachment_ownership_conflict",
    );
  }

  await repository.claimForConversation({
    attachmentIds: ["stable-upload-0"],
    instanceId: "instance-1",
    conversationId: "conversation-1",
    claimedAt: "2026-08-02T00:03:00.000Z",
  });
  await assertCode(
    repository.createDraft({
      attachmentId: "stable-upload-0",
      instanceId: "instance-1",
      originalName: "upload.txt",
      mimeType: "text/plain",
      content,
      createdAt: "2026-08-02T00:04:00.000Z",
    }),
    "ordinary_managed_attachment_ownership_conflict",
  );
});

test("claim validates every input before mutation and rejects wrong owners", async (t) => {
  const root = await createRoot(t, "ordinary-managed-attachment-claim-validation-");
  const repository = createFileSystemOrdinaryManagedAttachmentRepository(root);
  await createDraft(repository, "first", "instance-1");
  await createDraft(repository, "second", "instance-2");

  await assertCode(
    repository.claimForConversation({
      attachmentIds: ["first", "second"],
      instanceId: "instance-1",
      conversationId: "conversation-1",
      claimedAt: "2026-08-02T00:01:00.000Z",
    }),
    "ordinary_managed_attachment_ownership_conflict",
  );
  assert.equal((await repository.get("first")).owner.kind, "draft");
  assert.deepEqual((await repository.get("first")).owner, { kind: "draft", instanceId: "instance-1" });

  await assertCode(
    repository.claimForConversation({
      attachmentIds: ["first"],
      instanceId: "other-instance",
      conversationId: "conversation-1",
      claimedAt: "2026-08-02T00:01:00.000Z",
    }),
    "ordinary_managed_attachment_ownership_conflict",
  );
  await assertCode(
    repository.discardDraft({ attachmentId: "first", instanceId: "other-instance" }),
    "ordinary_managed_attachment_ownership_conflict",
  );
});

test("claim retries roll forward after a partially claimed record and remain idempotent", async (t) => {
  const root = await createRoot(t, "ordinary-managed-attachment-claim-retry-");
  const repository = createFileSystemOrdinaryManagedAttachmentRepository(root);
  await createDraft(repository, "first", "instance-1");
  await createDraft(repository, "second", "instance-1");

  const firstRecord = await repository.get("first");
  const firstRecordPath = path.join(path.dirname(await repository.resolveContentPath("first")), "record.json");
  await fs.writeFile(firstRecordPath, `${JSON.stringify({
    ...firstRecord,
    owner: { kind: "conversation", conversationId: "conversation-1" },
    updatedAt: "2026-08-02T00:02:00.000Z",
  })}\n`, "utf8");

  const retried = await repository.claimForConversation({
    attachmentIds: ["first", "second"],
    instanceId: "instance-1",
    conversationId: "conversation-1",
    claimedAt: "2026-08-02T00:03:00.000Z",
  });
  assert.deepEqual(retried.records.map((record) => record.owner), [
    { kind: "conversation", conversationId: "conversation-1" },
    { kind: "conversation", conversationId: "conversation-1" },
  ]);
  assert.deepEqual(retried.newlyClaimedAttachmentIds, ["second"]);
  assert.equal(retried.records[0]?.updatedAt, "2026-08-02T00:02:00.000Z");
  assert.equal(retried.records[1]?.updatedAt, "2026-08-02T00:03:00.000Z");

  const sameConversationRetry = await repository.claimForConversation({
    attachmentIds: ["first", "second"],
    instanceId: "a-different-instance-is-irrelevant-after-claim",
    conversationId: "conversation-1",
    claimedAt: "2026-08-02T00:04:00.000Z",
  });
  assert.deepEqual(sameConversationRetry.records, retried.records);
  assert.deepEqual(sameConversationRetry.newlyClaimedAttachmentIds, []);
});

test("releaseConversationClaim rolls back only this attempt's claim and is idempotent", async (t) => {
  const root = await createRoot(t, "ordinary-managed-attachment-claim-release-");
  const repository = createFileSystemOrdinaryManagedAttachmentRepository(root);
  await createDraft(repository, "first", "instance-1");
  await createDraft(repository, "second", "instance-1");
  await createDraft(repository, "other", "instance-1");
  const claimed = await repository.claimForConversation({
    attachmentIds: ["first", "second"],
    instanceId: "instance-1",
    conversationId: "conversation-1",
    claimedAt: "2026-08-02T00:05:00.000Z",
  });
  await repository.claimForConversation({
    attachmentIds: ["other"],
    instanceId: "instance-1",
    conversationId: "conversation-2",
    claimedAt: "2026-08-02T00:06:00.000Z",
  });

  await repository.releaseConversationClaim({
    attachmentIds: claimed.newlyClaimedAttachmentIds,
    instanceId: "instance-1",
    conversationId: "conversation-1",
    releasedAt: "2026-08-02T00:07:00.000Z",
  });
  assert.deepEqual((await repository.get("first")).owner, { kind: "draft", instanceId: "instance-1" });
  assert.deepEqual((await repository.get("second")).owner, { kind: "draft", instanceId: "instance-1" });
  assert.equal((await repository.get("first")).updatedAt, "2026-08-02T00:07:00.000Z");

  await repository.releaseConversationClaim({
    attachmentIds: claimed.newlyClaimedAttachmentIds,
    instanceId: "instance-1",
    conversationId: "conversation-1",
    releasedAt: "2026-08-02T00:07:00.000Z",
  });
  await repository.claimForConversation({
    attachmentIds: ["first"],
    instanceId: "instance-1",
    conversationId: "conversation-1",
    claimedAt: "2026-08-02T00:08:00.000Z",
  });
  await assertCode(
    repository.releaseConversationClaim({
      attachmentIds: ["first", "other"],
      instanceId: "instance-1",
      conversationId: "conversation-1",
      releasedAt: "2026-08-02T00:09:00.000Z",
    }),
    "ordinary_managed_attachment_ownership_conflict",
  );
  assert.deepEqual((await repository.get("first")).owner, {
    kind: "conversation",
    conversationId: "conversation-1",
  });
  assert.deepEqual((await repository.get("other")).owner, {
    kind: "conversation",
    conversationId: "conversation-2",
  });
});

test("discardDraft is owner-checked and idempotent when the draft is absent", async (t) => {
  const root = await createRoot(t, "ordinary-managed-attachment-discard-");
  const repository = createFileSystemOrdinaryManagedAttachmentRepository(root);

  await repository.discardDraft({ attachmentId: "absent", instanceId: "instance-1" });
  await createDraft(repository, "draft-1", "instance-1");
  await assertCode(
    repository.discardDraft({ attachmentId: "draft-1", instanceId: "instance-2" }),
    "ordinary_managed_attachment_ownership_conflict",
  );
  assert.deepEqual((await repository.get("draft-1")).owner, { kind: "draft", instanceId: "instance-1" });
  await repository.discardDraft({ attachmentId: "draft-1", instanceId: "instance-1" });
  await assertCode(repository.get("draft-1"), "ordinary_managed_attachment_not_found");
  await repository.discardDraft({ attachmentId: "draft-1", instanceId: "instance-1" });
});

test("recoverAtStartup reconciles partial claims, orphans, preserved conversations, and crash debris", async (t) => {
  const root = await createRoot(t, "ordinary-managed-attachment-recovery-");
  const repository = createFileSystemOrdinaryManagedAttachmentRepository(root);
  await createDraft(repository, "active", "instance-active");
  await createDraft(repository, "stale", "instance-stale");
  await createDraft(repository, "durable", "instance-stale");
  await createDraft(repository, "preserved", "instance-stale");
  await createDraft(repository, "orphan", "instance-stale");
  await repository.claimForConversation({
    attachmentIds: ["durable"],
    instanceId: "instance-stale",
    conversationId: "conversation-durable",
    claimedAt: "2026-08-02T00:05:00.000Z",
  });
  await repository.claimForConversation({
    attachmentIds: ["preserved"],
    instanceId: "instance-stale",
    conversationId: "conversation-preserved",
    claimedAt: "2026-08-02T00:06:00.000Z",
  });
  await repository.claimForConversation({
    attachmentIds: ["orphan"],
    instanceId: "instance-stale",
    conversationId: "conversation-orphan",
    claimedAt: "2026-08-02T00:07:00.000Z",
  });

  await fs.mkdir(path.join(root, ".pending-crash"), { recursive: true });
  await fs.writeFile(path.join(root, ".pending-crash", "content"), "orphan", "utf8");
  await fs.mkdir(path.join(root, ".deleting-crash"), { recursive: true });
  await fs.writeFile(path.join(root, ".deleting-crash", "record.json"), "orphan", "utf8");
  await fs.writeFile(path.join(root, ".pending-record-root-crash"), "orphan", "utf8");
  const activeDirectory = path.dirname(await repository.resolveContentPath("active"));
  await fs.writeFile(path.join(activeDirectory, ".pending-record-crash"), "orphan", "utf8");

  const recovery = await repository.recoverAtStartup({
    activeInstanceId: "instance-active",
    durableClaims: [{ conversationId: "conversation-durable", attachmentIds: ["durable"] }],
    preserveConversationIds: ["conversation-preserved"],
  });
  assert.deepEqual(recovery.issues, []);
  assert.deepEqual((await repository.get("active")).owner, { kind: "draft", instanceId: "instance-active" });
  assert.deepEqual((await repository.get("durable")).owner, {
    kind: "conversation",
    conversationId: "conversation-durable",
  });
  assert.deepEqual((await repository.get("preserved")).owner, {
    kind: "conversation",
    conversationId: "conversation-preserved",
  });
  await assertCode(repository.get("stale"), "ordinary_managed_attachment_not_found");
  await assertCode(repository.get("orphan"), "ordinary_managed_attachment_not_found");
  await assert.rejects(fs.access(path.join(root, ".pending-crash")));
  await assert.rejects(fs.access(path.join(root, ".deleting-crash")));
  await assert.rejects(fs.access(path.join(root, ".pending-record-root-crash")));
  await assert.rejects(fs.access(path.join(activeDirectory, ".pending-record-crash")));

  await repository.removeDraftsOwnedBy("instance-active");
  await assertCode(repository.get("active"), "ordinary_managed_attachment_not_found");
  assert.equal((await repository.get("durable")).owner.kind, "conversation");
  assert.equal((await repository.get("preserved")).owner.kind, "conversation");
});

test("recoverAtStartup reports a corrupt record without blocking cleanup of other directories", async (t) => {
  const root = await createRoot(t, "ordinary-managed-attachment-recovery-corrupt-");
  const repository = createFileSystemOrdinaryManagedAttachmentRepository(root);
  await createDraft(repository, "active", "instance-active");
  await createDraft(repository, "stale", "instance-stale");
  await createDraft(repository, "orphan", "instance-stale");
  await createDraft(repository, "corrupt", "instance-stale");
  await repository.claimForConversation({
    attachmentIds: ["orphan"],
    instanceId: "instance-stale",
    conversationId: "conversation-orphan",
    claimedAt: "2026-08-02T00:05:00.000Z",
  });
  const corruptDirectory = path.dirname(await repository.resolveContentPath("corrupt"));
  await fs.writeFile(path.join(corruptDirectory, "record.json"), "{not-json", "utf8");
  await fs.writeFile(path.join(corruptDirectory, ".pending-record-preserved"), "evidence", "utf8");

  const recovery = await repository.recoverAtStartup({
    activeInstanceId: "instance-active",
    durableClaims: [],
    preserveConversationIds: [],
  });

  assert.equal(recovery.issues.length, 1);
  assert.equal(recovery.issues[0]?.identity, path.basename(corruptDirectory));
  assert.equal(recovery.issues[0]?.error.code, "ordinary_managed_attachment_corrupt_record");
  await assertCode(repository.get("corrupt"), "ordinary_managed_attachment_corrupt_record");
  await fs.access(path.join(corruptDirectory, ".pending-record-preserved"));
  assert.deepEqual((await repository.get("active")).owner, { kind: "draft", instanceId: "instance-active" });
  await assertCode(repository.get("stale"), "ordinary_managed_attachment_not_found");
  await assertCode(repository.get("orphan"), "ordinary_managed_attachment_not_found");
});

test("deleteConversation stages and removes only attachments owned by that conversation", async (t) => {
  const root = await createRoot(t, "ordinary-managed-attachment-conversation-delete-");
  const repository = createFileSystemOrdinaryManagedAttachmentRepository(root);
  await createDraft(repository, "one", "instance-1");
  await createDraft(repository, "two", "instance-1");
  await createDraft(repository, "other", "instance-1");
  await repository.claimForConversation({
    attachmentIds: ["one", "two"],
    instanceId: "instance-1",
    conversationId: "conversation-1",
    claimedAt: "2026-08-02T00:06:00.000Z",
  });
  await repository.claimForConversation({
    attachmentIds: ["other"],
    instanceId: "instance-1",
    conversationId: "conversation-2",
    claimedAt: "2026-08-02T00:07:00.000Z",
  });

  await repository.deleteConversation("conversation-1");
  await assertCode(repository.get("one"), "ordinary_managed_attachment_not_found");
  await assertCode(repository.get("two"), "ordinary_managed_attachment_not_found");
  assert.deepEqual((await repository.get("other")).owner, { kind: "conversation", conversationId: "conversation-2" });
  await repository.deleteConversation("conversation-1");
  assert.deepEqual(await fs.readdir(root), [path.basename(path.dirname(await repository.resolveContentPath("other")))]);
});

test("managed attachment IDs are path-safe and invalid/corrupt/storage failures are explicit", async (t) => {
  const root = await createRoot(t, "ordinary-managed-attachment-errors-");
  const repository = createFileSystemOrdinaryManagedAttachmentRepository(root);
  const unsafeId = "../../outside/attachment-with-slashes";
  await createDraft(repository, unsafeId, "instance-1");
  const contentPath = await repository.resolveContentPath(unsafeId);
  const relativePath = path.relative(root, contentPath);
  assert.equal(path.isAbsolute(relativePath), false);
  assert.equal(relativePath.startsWith(`..${path.sep}`), false);
  await assert.rejects(fs.access(path.join(path.dirname(root), "outside")));

  await assertCode(repository.get(""), "ordinary_managed_attachment_invalid_id");
  await assertCode(
    repository.createDraft({
      attachmentId: "invalid-input",
      instanceId: "instance-1",
      originalName: " ",
      content: new Uint8Array(),
      createdAt: "2026-08-02T00:00:00.000Z",
    }),
    "ordinary_managed_attachment_invalid_input",
  );

  const corruptRecordPath = path.join(path.dirname(await repository.resolveContentPath(unsafeId)), "record.json");
  await fs.writeFile(corruptRecordPath, "{not-json", "utf8");
  await assertCode(repository.get(unsafeId), "ordinary_managed_attachment_corrupt_record");

  const rootFile = path.join(root, "root-file");
  await fs.writeFile(rootFile, "not a directory", "utf8");
  const brokenRepository = createFileSystemOrdinaryManagedAttachmentRepository(rootFile);
  await assertCode(brokenRepository.get("missing"), "ordinary_managed_attachment_storage_failure");
  await assertCode(
    brokenRepository.recoverAtStartup({
      activeInstanceId: "instance-1",
      durableClaims: [],
      preserveConversationIds: [],
    }),
    "ordinary_managed_attachment_storage_failure",
  );
});

async function createRoot(t: { after(callback: () => void | Promise<void>): void }, prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return root;
}

async function createDraft(
  repository: ReturnType<typeof createFileSystemOrdinaryManagedAttachmentRepository>,
  attachmentId: string,
  instanceId: string,
): Promise<OrdinaryManagedAttachmentRecord> {
  const result = await repository.createDraft({
    attachmentId,
    instanceId,
    originalName: `${attachmentId}.txt`,
    content: new TextEncoder().encode(`content:${attachmentId}`),
    createdAt: "2026-08-02T00:00:00.000Z",
  });
  assert.equal(result.created, true);
  return result.record;
}

function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

async function assertCode(
  promise: Promise<unknown>,
  code: OrdinaryManagedAttachmentRepositoryError["code"],
): Promise<void> {
  await assert.rejects(promise, (error: unknown) =>
    error instanceof OrdinaryManagedAttachmentRepositoryError && error.code === code);
}