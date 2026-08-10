import assert from "node:assert/strict";
import test from "node:test";

import { createWorkspaceDeletionCoordinator } from "./workspace-deletion-coordinator.js";

test("Workspace deletion stops processes, deletes owner conversations, revokes links and marks deleting", async () => {
  const operations: string[] = [];
  const coordinator = createWorkspaceDeletionCoordinator({
    workspaces: {
      commands: {
        async deleteWorkspace(workspaceId) { operations.push(`delete-workspace:${workspaceId}`); },
        async unlinkWorkspaceFromSpace(linkId) { operations.push(`unlink:${linkId}`); },
      },
      queries: {
        async get(workspaceId) {
          return {
            id: workspaceId,
            title: "AgentArbor",
            status: "available" as const,
            createdAt: "now",
            updatedAt: "now",
            mounts: [],
            links: [
              { linkId: "link-1", spaceId: "space-1", workspaceId, mountVersion: "m-1", status: "active" as const, createdAt: "now" },
              { linkId: "link-2", spaceId: "space-1", workspaceId, mountVersion: "m-1", status: "revoked" as const, createdAt: "now", revokedAt: "now" },
            ],
          };
        },
      },
    },
    ordinary: {
      commands: {
        async deleteConversation(conversationId) { operations.push(`delete-conversation:${conversationId}`); },
      },
      queries: {
        async listConversationsByOwner(owner) {
          operations.push(`list:${owner.kind}:${owner.id}`);
          return [
            { conversationId: "conversation-1" } as never,
            { conversationId: "conversation-2" } as never,
          ];
        },
      },
    },
    agentNotes: {
      async deleteByOwner(owner) { operations.push(`delete-agent-notes:${owner.kind}:${owner.id}`); },
    },
    memory: {
      async deleteByOwner(owner) { operations.push(`delete-path-dependencies:${owner.kind}:${owner.id}`); return 0; },
    },
    processes: {
      async cleanupByConversation(conversationId: string) {
        operations.push(`cleanup:${conversationId}`);
        return {
          kind: "process_registry_cleanup" as const,
          reason: "conversation_deleted" as const,
          observedAt: "now",
          attempted: [],
          skipped: [],
          fact: {
            kind: "process_cleanup" as const,
            observedAt: "now",
            scope: "conversation" as const,
            reason: "conversation_deleted" as const,
            attempted: [],
            skipped: [],
            conversationId,
          },
        };
      },
    },
    processTerminator: { killTree: () => ({ status: "killed" }) },
  });

  await coordinator.deleteWorkspace("workspace-1");

  assert.deepEqual(operations, [
    "delete-workspace:workspace-1",
    "list:workspace:workspace-1",
    "cleanup:conversation-1",
    "delete-conversation:conversation-1",
    "cleanup:conversation-2",
    "delete-conversation:conversation-2",
    "delete-path-dependencies:workspace:workspace-1",
    "delete-agent-notes:workspace:workspace-1",
    "unlink:link-1",
  ]);
  assert.equal(coordinator.isDeleting("workspace-1"), false);
});

test("Workspace deletion rejects a missing Workspace and blocks while deleting", async () => {
  const coordinator = createWorkspaceDeletionCoordinator({
    workspaces: {
      commands: {
        async deleteWorkspace() {},
        async unlinkWorkspaceFromSpace() { throw new Error("not used"); },
      },
      queries: { async get() { return undefined; } },
    },
    ordinary: {
      commands: { async deleteConversation() { throw new Error("not used"); } },
      queries: { async listConversationsByOwner() { return []; } },
    },
    agentNotes: { async deleteByOwner() { throw new Error("not used"); } },
    processes: {
      async cleanupByConversation() {
        return {
          kind: "process_registry_cleanup" as const,
          reason: "conversation_deleted" as const,
          observedAt: "now",
          attempted: [],
          skipped: [],
          fact: {
            kind: "process_cleanup" as const,
            observedAt: "now",
            scope: "conversation" as const,
            reason: "conversation_deleted" as const,
            attempted: [],
            skipped: [],
          },
        };
      },
    },
    processTerminator: { killTree: () => ({ status: "killed" }) },
  });

  await assert.rejects(
    coordinator.deleteWorkspace("workspace-missing"),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "workspace_not_found",
  );

  coordinator.assertAvailable("workspace-1");
});

test("Workspace deletion blocks on unresolved process stops", async () => {
  const coordinator = createWorkspaceDeletionCoordinator({
    workspaces: {
      commands: {
        async deleteWorkspace() {},
        async unlinkWorkspaceFromSpace() { throw new Error("not used"); },
      },
      queries: {
        async get(workspaceId) {
          return {
            id: workspaceId,
            title: "AgentArbor",
            status: "available" as const,
            createdAt: "now",
            updatedAt: "now",
            mounts: [],
            links: [],
          };
        },
      },
    },
    ordinary: {
      commands: { async deleteConversation() { throw new Error("not used"); } },
      queries: {
        async listConversationsByOwner() { return [{ conversationId: "conversation-1" } as never]; },
      },
    },
    agentNotes: { async deleteByOwner() { throw new Error("not used"); } },
    processes: {
      async cleanupByConversation() {
        return {
          kind: "process_registry_cleanup" as const,
          reason: "conversation_deleted" as const,
          observedAt: "now",
          attempted: [{
            processId: "process-1",
            pid: 123,
            beforeStatus: "running" as const,
            afterStatus: "unknown" as const,
            outcome: "unknown" as const,
            killTree: { status: "unknown" as const, message: "state unavailable" },
          }],
          skipped: [],
          fact: {
            kind: "process_cleanup" as const,
            observedAt: "now",
            scope: "conversation" as const,
            reason: "conversation_deleted" as const,
            attempted: [{
              processId: "process-1",
              pid: 123,
              beforeStatus: "running" as const,
              afterStatus: "unknown" as const,
              outcome: "unknown" as const,
              killTree: { status: "unknown" as const, message: "state unavailable" },
            }],
            skipped: [],
          },
        };
      },
    },
    processTerminator: { killTree: () => ({ status: "unknown" }) },
  });

  await assert.rejects(
    coordinator.deleteWorkspace("workspace-1"),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "background_process_stop_pending",
  );
  assert.equal(coordinator.isDeleting("workspace-1"), true, "a failed cascade keeps the owner denied for retry");
});

test("Workspace admission is serialized with deletion and honors the durable deleting status", async () => {
  let status: "available" | "deleting" = "available";
  let resolveAdmission!: () => void;
  let admissionStarted!: () => void;
  const started = new Promise<void>((resolve) => { admissionStarted = resolve; });
  const hold = new Promise<void>((resolve) => { resolveAdmission = resolve; });
  const detail = (workspaceId: string) => ({
    id: workspaceId,
    title: "AgentArbor",
    status,
    createdAt: "now",
    updatedAt: "now",
    mounts: [],
    links: [],
  });
  const coordinator = createWorkspaceDeletionCoordinator({
    workspaces: {
      commands: {
        async deleteWorkspace() { status = "deleting"; },
        async unlinkWorkspaceFromSpace() {},
      },
      queries: { async get(workspaceId) { return detail(workspaceId); } },
    },
    ordinary: {
      commands: { async deleteConversation() {} },
      queries: { async listConversationsByOwner() { return []; } },
    },
    agentNotes: { async deleteByOwner() {} },
    processes: { async cleanupByConversation() {
      return {
        kind: "process_registry_cleanup" as const,
        reason: "conversation_deleted" as const,
        observedAt: "now",
        attempted: [],
        skipped: [],
        fact: {
          kind: "process_cleanup" as const,
          observedAt: "now",
          scope: "conversation" as const,
          reason: "conversation_deleted" as const,
          attempted: [],
          skipped: [],
        },
      };
    } },
    processTerminator: { killTree: () => ({ status: "killed" }) },
  });

  const admitted = coordinator.admit("workspace-1", async () => {
    admissionStarted();
    await hold;
    return "admitted";
  });
  await started;
  const deleting = coordinator.deleteWorkspace("workspace-1");
  await assert.rejects(
    coordinator.admit("workspace-1", async () => "late"),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "workspace_deletion_in_progress",
  );
  resolveAdmission();
  assert.equal(await admitted, "admitted");
  await deleting;
  await assert.rejects(
    coordinator.admit("workspace-1", async () => "after"),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "workspace_not_available",
  );
});

test("a failed owner cascade keeps Workspace denied and an explicit retry can finish", async () => {
  let status: "available" | "deleting" = "available";
  let failNotes = true;
  const detail = (workspaceId: string) => ({
    id: workspaceId,
    title: "AgentArbor",
    status,
    createdAt: "now",
    updatedAt: "now",
    mounts: [],
    links: [],
  });
  const coordinator = createWorkspaceDeletionCoordinator({
    workspaces: {
      commands: {
        async deleteWorkspace() { status = "deleting"; },
        async unlinkWorkspaceFromSpace() {},
      },
      queries: { async get(workspaceId) { return detail(workspaceId); } },
    },
    ordinary: {
      commands: { async deleteConversation() {} },
      queries: { async listConversationsByOwner() { return []; } },
    },
    agentNotes: {
      async deleteByOwner() {
        if (failNotes) throw new Error("simulated owner-note repository failure");
      },
    },
    processes: {
      async cleanupByConversation() {
        return {
          kind: "process_registry_cleanup" as const,
          reason: "conversation_deleted" as const,
          observedAt: "now",
          attempted: [],
          skipped: [],
          fact: {
            kind: "process_cleanup" as const,
            observedAt: "now",
            scope: "conversation" as const,
            reason: "conversation_deleted" as const,
            attempted: [],
            skipped: [],
          },
        };
      },
    },
    processTerminator: { killTree: () => ({ status: "killed" }) },
  });

  await assert.rejects(coordinator.deleteWorkspace("workspace-retry"), /simulated owner-note repository failure/);
  assert.equal(status, "deleting", "the durable deleting marker must survive a later cascade failure");
  assert.equal(coordinator.isDeleting("workspace-retry"), true);
  await assert.rejects(
    coordinator.admit("workspace-retry", async () => "must-not-run"),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "workspace_deletion_in_progress",
  );

  failNotes = false;
  await coordinator.deleteWorkspace("workspace-retry");
  assert.equal(coordinator.isDeleting("workspace-retry"), false);
  assert.throws(
    () => coordinator.assertAvailable("workspace-retry"),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "workspace_not_available",
  );
  await assert.rejects(
    coordinator.admit("workspace-retry", async () => "must-stay-denied"),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "workspace_not_available",
  );
});

test("Workspace coordinator restores a durable deleting gate before request admission", async () => {
  const coordinator = createWorkspaceDeletionCoordinator({
    workspaces: {
      commands: { async deleteWorkspace() {}, async unlinkWorkspaceFromSpace() {} },
      queries: {
        async get() {
          return {
            id: "workspace-restarted",
            title: "Restarted",
            status: "deleting" as const,
            createdAt: "now",
            updatedAt: "now",
            mounts: [],
            links: [],
          };
        },
        async list() {
          return [{ id: "workspace-restarted", title: "Restarted", status: "deleting" as const, createdAt: "now", updatedAt: "now", linkCount: 0 }];
        },
      },
    },
    ordinary: {
      commands: { async deleteConversation() {} },
      queries: { async listConversationsByOwner() { return []; } },
    },
    agentNotes: { async deleteByOwner() {} },
    processes: { async cleanupByConversation() { throw new Error("not used"); } },
    processTerminator: { killTree: () => ({ status: "killed" }) },
  });

  await coordinator.ready();
  assert.equal(coordinator.isDeleting("workspace-restarted"), true);
  assert.throws(
    () => coordinator.assertAvailable("workspace-restarted"),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "workspace_deletion_in_progress",
  );
  await assert.rejects(
    coordinator.admit("workspace-restarted", async () => "must-not-run"),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "workspace_deletion_in_progress",
  );
});
