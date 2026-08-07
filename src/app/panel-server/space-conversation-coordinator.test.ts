import assert from "node:assert/strict";
import test from "node:test";

import type { ProcessRegistryCleanupResult } from "../runtime-guard/index.js";
import {
  createSpaceConversationDeletionCoordinator,
  createSpaceConversationLinkCoordinator,
} from "./space-conversation-coordinator.js";
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
    },
    personalKnowledge: {
      commands: {
        async cleanupSpace({ spaceId }) { operations.push(`cleanup-knowledge:${spaceId}`); },
      },
    },
  });
  await coordinator.deleteSpace("space-1");

  assert.deepEqual(operations, [
    "cleanup:space-1",
    "delete-conversation:conversation-1",
    "cleanup-knowledge:space-1",
    "delete-space:space-1",
  ]);
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
      },
      personalKnowledge: {
        commands: { async cleanupSpace() { operations.push("cleanup-knowledge"); } },
      },
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
    },
    personalKnowledge: {
      commands: {
        async cleanupSpace() { /* no-op */ },
      },
    },
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

test("birth recovery unlinks an incomplete owner without replaying the failed Ordinary submission", async () => {
  const journal = memoryLinkJournal();
  let owner: { readonly spaceId: string; readonly referenceItemId: string } | undefined;
  let unlinkFails = true;
  let submissionAttempts = 0;
  const ports = {
    journal,
    processTerminator: { killTree: () => ({ status: "killed" as const }) },
    processes: {
      async cleanupByConversation(conversationId: string) {
        return cleanupResult("conversation", "conversation_deleted", { conversationId });
      },
    },
    spaces: {
      queries: { async findConversationOwner() { return owner; } },
      commands: {
        async linkConversationOwner(request: { readonly id?: string; readonly spaceId: string }) {
          if (request.id === undefined) throw new Error("expected a deterministic reference id");
          owner = { spaceId: request.spaceId, referenceItemId: request.id };
          return {} as never;
        },
        async unlinkConversationReferenceItem(referenceItemId: string) {
          if (unlinkFails) throw new Error("Space repository unavailable");
          if (owner?.referenceItemId === referenceItemId) owner = undefined;
        },
      },
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
    /could not be reconciled/,
  );
  assert.equal(submissionAttempts, 1);
  assert.deepEqual((await journal.list()).map((record) => ({ operation: record.operation, phase: record.phase })), [
    { operation: "birth", phase: "owner_linked" },
  ]);

  unlinkFails = false;
  const restarted = createSpaceConversationLinkCoordinator(ports);
  await restarted.ready();

  assert.equal(owner, undefined);
  assert.equal(submissionAttempts, 1);
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
