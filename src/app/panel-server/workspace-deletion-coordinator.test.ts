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
    "list:workspace:workspace-1",
    "cleanup:conversation-1",
    "delete-conversation:conversation-1",
    "cleanup:conversation-2",
    "delete-conversation:conversation-2",
    "unlink:link-1",
    "delete-workspace:workspace-1",
  ]);
  assert.equal(coordinator.isDeleting("workspace-1"), false);
});

test("Workspace deletion rejects a missing Workspace and blocks while deleting", async () => {
  const coordinator = createWorkspaceDeletionCoordinator({
    workspaces: {
      commands: {
        async deleteWorkspace() { throw new Error("not used"); },
        async unlinkWorkspaceFromSpace() { throw new Error("not used"); },
      },
      queries: { async get() { return undefined; } },
    },
    ordinary: {
      commands: { async deleteConversation() { throw new Error("not used"); } },
      queries: { async listConversationsByOwner() { return []; } },
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
        async deleteWorkspace() { throw new Error("not used"); },
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
});
