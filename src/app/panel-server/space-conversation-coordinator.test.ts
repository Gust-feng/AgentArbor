import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import type { ProcessRegistryCleanupResult } from "../runtime-guard/index.js";
import { InMemoryLocalWorkspaceMutationCoordinator } from "../tool-center/adapters/local-workspace-mutation-coordinator.js";
import {
  createSpaceConversationDeletionCoordinator,
  createSpaceConversationLinkCoordinator,
} from "./space-conversation-coordinator.js";
import { workbenchDeletionLifecycleLockKey } from "./workbench-deletion-lifecycle-lock.js";
import type {
  SpaceConversationDeletionJournal,
  SpaceConversationDeletionRecord,
} from "./space-conversation-deletion-journal.js";
import type {
  SpaceConversationLinkJournal,
  SpaceConversationLinkRecord,
} from "./space-conversation-link-journal.js";

test("Space deletion stops owned processes before deleting conversations and Space metadata", async () => {
  const operations: string[] = [];

  const coordinator = createSpaceConversationDeletionCoordinator({
    journal: memoryJournal(),
    processTerminator: { killTree: () => ({ status: "killed" }) },
    processes: {
      async cleanupBySpace(spaceId) {
        operations.push(`cleanup:${spaceId}`);
        return cleanupResult("space", "space_deleted", { spaceId });
      },
    },
    spaces: {
      queries: {
        async getTree() {
          return {
            space: { id: "space-1", title: "Space", createdAt: "now", updatedAt: "now" },
            entries: [{
              kind: "reference" as const,
              item: {
                id: "conversation-reference",
                spaceId: "space-1",
                title: "Conversation",
                reference: { kind: "conversation" as const, conversationId: "conversation-1" },
                createdAt: "now",
                updatedAt: "now",
              },
            }],
          };
        },
      },
      commands: {
        async deleteSpace(spaceId) { operations.push(`delete-space:${spaceId}`); },
      },
    },
    ordinary: {
      commands: {
        async deleteConversation(conversationId) { operations.push(`delete-conversation:${conversationId}`); },
      },
      queries: {
        async listConversationsByOwner() {
          return [{ conversationId: "conversation-1" } as never];
        },
      },
    },
    personalKnowledge: {
      commands: {
        async cleanupSpace({ spaceId }) { operations.push(`cleanup-knowledge:${spaceId}`); },
      },
    },
    memory: {
      async deleteByOwner(owner) { operations.push(`delete-path-dependencies:${owner.kind}:${owner.id}`); return 0; },
    },
    agentNotes: {
      async deleteByOwner(owner) { operations.push(`delete-agent-notes:${owner.kind}:${owner.id}`); },
    },
  });
  await coordinator.deleteSpace("space-1");

  assert.deepEqual(operations, [
    "cleanup:space-1",
    "delete-conversation:conversation-1",
    "delete-path-dependencies:space:space-1",
    "delete-agent-notes:space:space-1",
    "cleanup-knowledge:space-1",
    "delete-space:space-1",
  ]);
});

test("deleteSpace does not self-deadlock when the deletion lifecycle takes a runtimeHome subdirectory lease on the same coordinator", async () => {
  // Reproduces the composition-root nesting: the deletion coordinator holds its
  // exclusive lifecycle lock while SpaceFeature's reference deletion lifecycle
  // acquires a runtimeHome subdirectory lease (space-reference-deletions) on the
  // SAME, non-reentrant coordinator. Binding the lifecycle lock to runtimeHome
  // itself would make the inner lease block on its own ancestor forever.
  const runtimeHome = process.platform === "win32" ? "C:\\runtime-home" : "/runtime-home";
  const coordinator = new InMemoryLocalWorkspaceMutationCoordinator();
  const spaceReferenceDeletionsRoot = path.join(runtimeHome, "space-reference-deletions");
  let innerLeaseRan = false;

  const deletion = createSpaceConversationDeletionCoordinator({
    journal: memoryJournal(),
    processTerminator: { killTree: () => ({ status: "killed" }) },
    processes: {
      async cleanupBySpace(spaceId: string) {
        return cleanupResult("space", "space_deleted", { spaceId });
      },
    },
    spaces: {
      queries: {
        async getTree() {
          return { space: { id: "space-1", title: "Space", createdAt: "now", updatedAt: "now" }, entries: [] };
        },
      },
      commands: {
        async deleteSpace() {
          await coordinator.runExclusive(spaceReferenceDeletionsRoot, async () => { innerLeaseRan = true; });
        },
      },
    },
    ordinary: {
      commands: { async deleteConversation() {} },
      queries: { async listConversationsByOwner() { return []; } },
    },
    personalKnowledge: { commands: { async cleanupSpace() {} } },
    memory: { async deleteByOwner() { return 0; } },
    agentNotes: { async deleteByOwner() {} },
    runExclusive: (operation) => coordinator.runExclusive(workbenchDeletionLifecycleLockKey(runtimeHome), operation),
  });

  await withDeadlockTimeout(
    deletion.deleteSpace("space-1"),
    "deleteSpace deadlocked while holding the deletion lifecycle lock",
  );
  assert.equal(innerLeaseRan, true);
});

test("deletion lifecycle lock stays mutually exclusive with the runtimeHome backup lease but not with its subdirectories", async () => {
  const runtimeHome = process.platform === "win32" ? "C:\\runtime-home" : "/runtime-home";
  const coordinator = new InMemoryLocalWorkspaceMutationCoordinator();
  const lifecycleLock = workbenchDeletionLifecycleLockKey(runtimeHome);

  // Backup snapshots take an exclusive runtimeHome lease; it must still block the
  // lifecycle lock (an ancestor overlaps its descendant).
  let backupHeld = false;
  let lifecycleRanDuringBackup = false;
  let releaseBackup!: () => void;
  const backup = coordinator.runExclusive(runtimeHome, async () => {
    backupHeld = true;
    await new Promise<void>((resolve) => { releaseBackup = resolve; });
  });
  await Promise.resolve();
  const blockedLifecycle = coordinator.runExclusive(lifecycleLock, async () => { lifecycleRanDuringBackup = true; });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(backupHeld, true);
  assert.equal(lifecycleRanDuringBackup, false, "lifecycle lock must wait for the runtimeHome backup lease");
  releaseBackup();
  await backup;
  await blockedLifecycle;
  assert.equal(lifecycleRanDuringBackup, true);

  // Holding the lifecycle lock must NOT block a runtimeHome subdirectory lease
  // (siblings, not ancestor/descendant) — this is what breaks the self-deadlock.
  let subdirRanDuringLifecycle = false;
  let releaseLifecycle!: () => void;
  const lifecycle = coordinator.runExclusive(lifecycleLock, async () => {
    await new Promise<void>((resolve) => { releaseLifecycle = resolve; });
  });
  await Promise.resolve();
  await withDeadlockTimeout(
    coordinator.runExclusive(path.join(runtimeHome, "space-reference-deletions"), async () => { subdirRanDuringLifecycle = true; }),
    "subdirectory lease blocked on the sibling lifecycle lock",
  );
  assert.equal(subdirRanDuringLifecycle, true);
  releaseLifecycle();
  await lifecycle;
});

test("Space admission drains before deletion snapshots conversations and rejects late owners", async () => {
  let treeExists = true;
  let releaseAdmission!: () => void;
  let markAdmissionStarted!: () => void;
  const admissionStarted = new Promise<void>((resolve) => { markAdmissionStarted = resolve; });
  const holdAdmission = new Promise<void>((resolve) => { releaseAdmission = resolve; });
  let listedAfterAdmission = false;
  const coordinator = createSpaceConversationDeletionCoordinator({
    journal: memoryJournal(),
    processTerminator: { killTree: () => ({ status: "killed" as const }) },
    processes: {
      async cleanupBySpace(spaceId: string) {
        return cleanupResult("space", "space_deleted", { spaceId });
      },
    },
    spaces: {
      queries: {
        async getTree() {
          return treeExists
            ? { space: { id: "space-race", title: "Race", createdAt: "now", updatedAt: "now" }, entries: [] }
            : undefined;
        },
      },
      commands: {
        async deleteSpace() { treeExists = false; },
      },
    },
    ordinary: {
      commands: { async deleteConversation() {} },
      queries: {
        async listConversationsByOwner() {
          listedAfterAdmission = true;
          return [];
        },
      },
    },
    personalKnowledge: { commands: { async cleanupSpace() {} } },
    agentNotes: { async deleteByOwner() {} },
  });

  const admitted = coordinator.admit("space-race", async () => {
    markAdmissionStarted();
    await holdAdmission;
    return "admitted";
  });
  await admissionStarted;
  const deleting = coordinator.deleteSpace("space-race");
  await assert.rejects(
    () => coordinator.admit("space-race", async () => "late"),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "space_deletion_in_progress",
  );
  releaseAdmission();
  assert.equal(await admitted, "admitted");
  await deleting;
  assert.equal(listedAfterAdmission, true);
  await assert.rejects(
    () => coordinator.admit("space-race", async () => "after"),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "space_not_found",
  );
});

test("unresolved process cleanup blocks Space and Conversation deletion", async () => {
  const operations: string[] = [];
  const pending = cleanupResult("space", "space_deleted", {
    spaceId: "space-1",
    attempted: [{
      processId: "process-1",
      pid: 123,
      beforeStatus: "running",
      afterStatus: "unknown",
      outcome: "unknown",
      killTree: { status: "unknown", message: "state unavailable" },
    }],
  });

  const coordinator = createSpaceConversationDeletionCoordinator({
      journal: memoryJournal(),
      processTerminator: { killTree: () => ({ status: "unknown" }) },
      processes: { async cleanupBySpace() { return pending; } },
      spaces: {
        queries: {
          async getTree() {
            return {
              space: { id: "space-1", title: "Space", createdAt: "now", updatedAt: "now" },
              entries: [],
            };
          },
        },
        commands: { async deleteSpace() { operations.push("delete-space"); } },
      },
      ordinary: {
        commands: { async deleteConversation() { operations.push("delete-conversation"); } },
        queries: {
          async listConversationsByOwner() {
            return [{ conversationId: "conversation-1" } as never];
          },
        },
      },
      personalKnowledge: {
        commands: { async cleanupSpace() { operations.push("cleanup-knowledge"); } },
      },
      agentNotes: { async deleteByOwner() { throw new Error("not used"); } },
    });
  await assert.rejects(
    coordinator.deleteSpace("space-1"),
    (error: unknown) => error instanceof Error &&
      "code" in error && error.code === "background_process_stop_pending",
  );
  assert.deepEqual(operations, []);

  const conversationOperations: string[] = [];
  const conversationCoordinator = createSpaceConversationLinkCoordinator({
    journal: memoryLinkJournal(),
    processTerminator: { killTree: () => ({ status: "unknown" }) },
    processes: {
      async cleanupByConversation() {
        return cleanupResult("conversation", "conversation_deleted", {
          conversationId: "conversation-1",
          attempted: pending.attempted,
        });
      },
    },
    spaces: {
      queries: { async findConversationOwner() { return undefined; } },
      commands: {
        async linkConversationOwner() { throw new Error("not used"); },
        async unlinkConversationReferenceItem() { conversationOperations.push("unlink-conversation"); },
      },
    },
    ordinary: {
      queries: {
        async getConversation() { return undefined; },
        async getConversationOwner() { return undefined; },
      },
      commands: {
        async submitTurn() { throw new Error("not used"); },
        async deleteConversation() { conversationOperations.push("delete-conversation"); },
      },
    },
  });
  await assert.rejects(
    conversationCoordinator.deleteConversation("conversation-1"),
    (error: unknown) => error instanceof Error &&
      "code" in error && error.code === "background_process_stop_pending",
  );
  assert.deepEqual(conversationOperations, []);
});

test("startup recovery resumes after Conversation tombstones without repeating completed phases", async () => {
  const journal = memoryJournal();
  let spaceDeleteFails = true;
  let conversationDeletes = 0;
  let processCleanups = 0;
  const ports = {
    journal,
    processTerminator: { killTree: () => ({ status: "killed" as const }) },
    processes: {
      async cleanupBySpace(spaceId: string) {
        processCleanups += 1;
        return cleanupResult("space", "space_deleted", { spaceId });
      },
    },
    spaces: {
      queries: {
        async getTree() {
          return {
            space: { id: "space-1", title: "Space", createdAt: "now", updatedAt: "now" },
            entries: [{
              kind: "reference" as const,
              item: {
                id: "conversation-reference",
                spaceId: "space-1",
                title: "Conversation",
                reference: { kind: "conversation" as const, conversationId: "conversation-1" },
                createdAt: "now",
                updatedAt: "now",
              },
            }],
          };
        },
      },
      commands: {
        async deleteSpace() {
          if (spaceDeleteFails) throw new Error("space repository unavailable");
        },
      },
    },
    ordinary: {
      commands: {
        async deleteConversation() { conversationDeletes += 1; },
      },
      queries: {
        async listConversationsByOwner() {
          return [{ conversationId: "conversation-1" } as never];
        },
      },
    },
    personalKnowledge: {
      commands: {
        async cleanupSpace() { /* no-op */ },
      },
    },
    agentNotes: { async deleteByOwner() { /* no-op */ } },
  };
  const first = createSpaceConversationDeletionCoordinator(ports);

  await assert.rejects(first.deleteSpace("space-1"), /space repository unavailable/);
  assert.equal(first.isDeleting("space-1"), true);
  assert.throws(() => first.assertAvailable("space-1"), /being deleted/);
  assert.equal(processCleanups, 1);
  assert.equal(conversationDeletes, 1);
  const failed = (await journal.list())[0];
  assert.equal(failed?.phase, "failed");
  assert.equal(failed?.resumeFrom, "knowledge_cleaned");

  spaceDeleteFails = false;
  const recovered = createSpaceConversationDeletionCoordinator(ports);
  await recovered.ready();

  assert.equal(processCleanups, 1);
  assert.equal(conversationDeletes, 1);
  assert.deepEqual(await journal.list(), []);
  assert.equal(recovered.isDeleting("space-1"), false);
});

test("birth recovery clears an incomplete submission without replaying the failed Ordinary turn", async () => {
  const journal = memoryLinkJournal();
  let submissionAttempts = 0;
  let spaceAdmissionCalls = 0;
  const ports = {
    journal,
    processTerminator: { killTree: () => ({ status: "killed" as const }) },
    processes: {
      async cleanupByConversation(conversationId: string) {
        return cleanupResult("conversation", "conversation_deleted", { conversationId });
      },
    },
    spaces: {
      queries: { async findConversationOwner() { return undefined; } },
      commands: {
        async linkConversationOwner() { throw new Error("new space births never create a tree link"); },
        async unlinkConversationReferenceItem() { throw new Error("not used"); },
      },
    },
    spaceAdmission: async <T>(spaceId: string, operation: () => Promise<T>): Promise<T> => {
      spaceAdmissionCalls += 1;
      assert.equal(spaceId, "space-1");
      return operation();
    },
    ordinary: {
      queries: {
        async getConversation() { return undefined; },
        async getConversationOwner() { return undefined; },
      },
      commands: {
        async submitTurn() {
          submissionAttempts += 1;
          throw new Error("Ordinary repository unavailable");
        },
        async deleteConversation() { throw new Error("not used"); },
      },
    },
  };
  const first = createSpaceConversationLinkCoordinator(ports);

  await assert.rejects(
    first.submit({
      owner: { kind: "space", id: "space-1" },
      submissionId: "submission-1",
      title: "新对话",
      runInput: {} as never,
      birth: {} as never,
    }),
    /Ordinary repository unavailable/,
  );
  assert.equal(submissionAttempts, 1);
  assert.equal(spaceAdmissionCalls, 1, "Space submissions must pass the deletion admission gate");
  assert.deepEqual(await journal.list(), []);
});

test("single Conversation deletion resumes after its Ordinary tombstone without repeating completed phases", async () => {
  const journal = memoryLinkJournal();
  let owner: { readonly spaceId: string; readonly referenceItemId: string } | undefined = {
    spaceId: "space-1",
    referenceItemId: "conversation-reference-1",
  };
  let conversationExists = true;
  let unlinkFails = true;
  let processCleanups = 0;
  let ordinaryDeletes = 0;
  const ports = {
    journal,
    processTerminator: { killTree: () => ({ status: "killed" as const }) },
    processes: {
      async cleanupByConversation(conversationId: string) {
        processCleanups += 1;
        return cleanupResult("conversation", "conversation_deleted", { conversationId });
      },
    },
    spaces: {
      queries: { async findConversationOwner() { return owner; } },
      commands: {
        async linkConversationOwner() { throw new Error("not used"); },
        async unlinkConversationReferenceItem(referenceItemId: string) {
          if (unlinkFails) throw new Error("Space repository unavailable");
          if (owner?.referenceItemId === referenceItemId) owner = undefined;
        },
      },
    },
    ordinary: {
      queries: {
        async getConversation() { return conversationExists ? {} as never : undefined; },
        async getConversationOwner() { return undefined; },
      },
      commands: {
        async submitTurn() { throw new Error("not used"); },
        async deleteConversation() {
          ordinaryDeletes += 1;
          conversationExists = false;
        },
      },
    },
  };
  const first = createSpaceConversationLinkCoordinator(ports);

  await assert.rejects(first.deleteConversation("conversation-1"), /Space repository unavailable/);
  assert.equal(processCleanups, 1);
  assert.equal(ordinaryDeletes, 1);
  assert.throws(
    () => first.assertConversationAvailable("conversation-1"),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "conversation_deletion_in_progress",
  );
  assert.deepEqual((await journal.list()).map((record) => ({ operation: record.operation, phase: record.phase })), [
    { operation: "delete", phase: "conversation_deleted" },
  ]);

  unlinkFails = false;
  const restarted = createSpaceConversationLinkCoordinator(ports);
  await restarted.ready();

  assert.equal(owner, undefined);
  assert.equal(processCleanups, 1);
  assert.equal(ordinaryDeletes, 1);
  assert.deepEqual(await journal.list(), []);
});

test("workspace owner submission creates a canonical owner conversation without a Space tree link", async () => {
  const journal = memoryLinkJournal();
  const operations: string[] = [];
  let workspaceAdmissionCalls = 0;
  const ports = {
    journal,
    processTerminator: { killTree: () => ({ status: "killed" as const }) },
    processes: {
      async cleanupByConversation(conversationId: string) {
        return cleanupResult("conversation", "conversation_deleted", { conversationId });
      },
    },
    spaces: {
      queries: {
        async findConversationOwner() { return undefined; },
      },
      commands: {
        async linkConversationOwner() { throw new Error("workspace owner must not create a Space tree link"); },
        async unlinkConversationReferenceItem() { throw new Error("not used"); },
      },
    },
    workspaces: {
      queries: {
        async get(workspaceId: string) {
          return workspaceId === "workspace-1"
            ? { id: "workspace-1", title: "AgentArbor", status: "available" as const, createdAt: "now", updatedAt: "now", mounts: [], links: [] }
            : undefined;
        },
      },
    },
    workspaceAdmission: async <T>(workspaceId: string, operation: () => Promise<T>): Promise<T> => {
      workspaceAdmissionCalls += 1;
      assert.equal(workspaceId, "workspace-1");
      return operation();
    },
    ordinary: {
      queries: {
        async getConversation() { return undefined; },
        async getConversationOwner() { return undefined; },
      },
      commands: {
        async submitTurn(input: { readonly owner?: { readonly kind: string; readonly id: string }; readonly newConversationId?: string }) {
          operations.push(`submit:${input.newConversationId}:${input.owner?.kind}:${input.owner?.id}`);
          return { conversation: {} as never, run: {} as never };
        },
        async deleteConversation() { throw new Error("not used"); },
      },
    },
  };
  const coordinator = createSpaceConversationLinkCoordinator(ports);
  await coordinator.submit({
    owner: { kind: "workspace", id: "workspace-1" },
    submissionId: "submission-workspace",
    title: "修复项目",
    runInput: {} as never,
    birth: {} as never,
  });
  assert.deepEqual(operations, ["submit:conversation:submission-workspace:workspace:workspace-1"]);
  assert.equal(workspaceAdmissionCalls, 1, "Workspace submissions must pass the deletion admission gate");
  assert.deepEqual(await journal.list(), []);
});

test("workspace owner submission rejects a missing or unavailable workspace", async () => {
  const journal = memoryLinkJournal();
  const ports = {
    journal,
    processTerminator: { killTree: () => ({ status: "killed" as const }) },
    processes: {
      async cleanupByConversation(conversationId: string) {
        return cleanupResult("conversation", "conversation_deleted", { conversationId });
      },
    },
    spaces: {
      queries: { async findConversationOwner() { return undefined; } },
      commands: {
        async linkConversationOwner() { throw new Error("not used"); },
        async unlinkConversationReferenceItem() { throw new Error("not used"); },
      },
    },
    workspaces: {
      queries: { async get() { return undefined; } },
    },
    ordinary: {
      queries: {
        async getConversation() { return undefined; },
        async getConversationOwner() { return undefined; },
      },
      commands: {
        async submitTurn() { throw new Error("not used"); },
        async deleteConversation() { throw new Error("not used"); },
      },
    },
  };
  const coordinator = createSpaceConversationLinkCoordinator(ports);
  await assert.rejects(
    coordinator.submit({
      owner: { kind: "workspace", id: "workspace-missing" },
      submissionId: "submission-workspace-missing",
      title: "任务",
      runInput: {} as never,
      birth: {} as never,
    }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "workspace_not_found",
  );
  assert.deepEqual(await journal.list(), []);
});

function cleanupResult(
  scope: ProcessRegistryCleanupResult["fact"]["scope"],
  reason: ProcessRegistryCleanupResult["reason"],
  input: {
    readonly spaceId?: string;
    readonly conversationId?: string;
    readonly attempted?: ProcessRegistryCleanupResult["attempted"];
  },
): ProcessRegistryCleanupResult {
  const attempted = input.attempted ?? [];
  return {
    kind: "process_registry_cleanup",
    reason,
    observedAt: "now",
    attempted,
    skipped: [],
    fact: {
      kind: "process_cleanup",
      observedAt: "now",
      scope,
      reason,
      attempted,
      skipped: [],
      ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
      ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
    },
  };
}

async function withDeadlockTimeout<T>(operation: Promise<T>, message: string, timeoutMs = 2_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Deadlock timeout: ${message}`)), timeoutMs);
  });
  try {
    return await Promise.race([operation, guard]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function memoryJournal(...initial: SpaceConversationDeletionRecord[]): SpaceConversationDeletionJournal {
  const records = new Map(initial.map((record) => [record.deletionId, structuredClone(record)]));
  return {
    async list() { return [...records.values()].map((record) => structuredClone(record)); },
    async getBySpace(spaceId) {
      const record = [...records.values()].find((candidate) => candidate.spaceId === spaceId);
      return record === undefined ? undefined : structuredClone(record);
    },
    async save(record) { records.set(record.deletionId, structuredClone(record)); },
    async delete(deletionId) { records.delete(deletionId); },
  };
}

function memoryLinkJournal(...initial: SpaceConversationLinkRecord[]): SpaceConversationLinkJournal {
  const records = new Map(initial.map((record) => [record.operationId, structuredClone(record)]));
  return {
    async list() { return [...records.values()].map((record) => structuredClone(record)); },
    async getByConversation(conversationId) {
      const record = [...records.values()].find((candidate) => candidate.conversationId === conversationId);
      return record === undefined ? undefined : structuredClone(record);
    },
    async save(record) { records.set(record.operationId, structuredClone(record)); },
    async delete(operationId) { records.delete(operationId); },
  };
}
