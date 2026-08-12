import assert from "node:assert/strict";
import test from "node:test";

import {
  REMOTE_CONVERSATION_PAGE_MAX_JSON_BYTES,
  RemoteCommandConflict,
  parseRemoteMessageContent,
} from "../remote-collaboration/index.js";
import { createPanelRemoteCollaborationPorts, resolveRemoteModelSelectionForRun } from "./remote-collaboration-ports.js";

test("remote model selection accepts only a currently published option", async () => {
  const selected = await resolveRemoteModelSelectionForRun(
    async (id) => id === '["profile-a","model-a"]' ? { profileId: "profile-a", model: "model-a" } : undefined,
    '["profile-a","model-a"]',
  );
  assert.deepEqual(selected, { profileId: "profile-a", model: "model-a" });

  await assert.rejects(
    resolveRemoteModelSelectionForRun(async () => undefined, '["profile-a","old-model"]'),
    (error: unknown) => error instanceof RemoteCommandConflict && error.code === "model_selection_stale",
  );
  await assert.rejects(
    resolveRemoteModelSelectionForRun(async () => undefined, "not-json"),
    (error: unknown) => error instanceof RemoteCommandConflict && error.code === "model_selection_invalid",
  );
});

test("remote Ordinary adapter refuses to create an unowned conversation", async () => {
  type PortsInput = Parameters<typeof createPanelRemoteCollaborationPorts>[0];
  const ports = createPanelRemoteCollaborationPorts({
    ordinary: {} as PortsInput["ordinary"],
    spaces: {} as PortsInput["spaces"],
    async modelOptions() { return []; },
    async resolveModelSelection() { return undefined; },
    async prepareOrdinaryRunBirth() { throw new Error("must not prepare an unowned run"); },
  });

  await assert.rejects(
    ports.ordinary.submit({ submissionId: "submission-unowned", message: "create without owner" }),
    (error: unknown) => error instanceof RemoteCommandConflict && error.code === "conversation_owner_required",
  );
});

test("remote new-conversation submission synchronizes Vault before rejecting a missing Space", async () => {
  type PortsInput = Parameters<typeof createPanelRemoteCollaborationPorts>[0];
  let synchronized = false;
  let linkedConversationId: string | undefined;
  const ports = createPanelRemoteCollaborationPorts({
    ordinary: {
      commands: {
        async submitTurn() {
          assert.equal(synchronized, true);
          return {
            conversation: { conversationId: "conversation-1", title: "Remote conversation" },
            run: { runId: "run-1" },
          };
        },
      },
    } as unknown as PortsInput["ordinary"],
    spaces: {
      queries: {
        async getTree(spaceId: string) {
          return synchronized && spaceId === "space-1" ? { space: { id: spaceId }, entries: [] } : undefined;
        },
        async findConversationOwner() { return undefined; },
      },
      commands: {
        async addReference(input: { readonly reference: { readonly conversationId: string } }) {
          linkedConversationId = input.reference.conversationId;
        },
        async linkConversationOwner(input: { readonly conversationId: string }) {
          linkedConversationId = input.conversationId;
        },
      },
    } as unknown as PortsInput["spaces"],
    async modelOptions() { return []; },
    async resolveModelSelection() { return undefined; },
    async synchronizeContentVault() { synchronized = true; },
    async prepareOrdinaryRunBirth() { return {} as Awaited<ReturnType<PortsInput["prepareOrdinaryRunBirth"]>>; },
  });

  const submitted = await ports.ordinary.submit({
    submissionId: "submission-1",
    spaceId: "space-1",
    message: "Create after the Space arrives",
  });

  assert.deepEqual(submitted, { conversationId: "conversation-1", runId: "run-1" });
  assert.equal(linkedConversationId, "conversation-1");
});

test("remote conversation pages shrink by UTF-8 bytes without losing the older-page cursor", async () => {
  const createdAt = "2026-08-04T00:00:00.000Z";
  const largeChineseText = "中".repeat(900_000);
  const conversation = {
    conversationId: "conversation-1",
    title: "Large conversation",
    createdAt,
    updatedAt: createdAt,
    queuedRunIds: [],
    turns: [1, 2, 3].map((ordinal) => ({
      turnId: `turn-${ordinal}`,
      runId: `run-${ordinal}`,
      role: "assistant" as const,
      content: largeChineseText,
      status: "completed" as const,
      createdAt,
      updatedAt: createdAt,
    })),
  };
  type PortsInput = Parameters<typeof createPanelRemoteCollaborationPorts>[0];
  const ports = createPanelRemoteCollaborationPorts({
    ordinary: {
      queries: {
        async getConversation(conversationId: string) {
          return conversationId === conversation.conversationId ? conversation : undefined;
        },
      },
    } as unknown as PortsInput["ordinary"],
    spaces: {} as PortsInput["spaces"],
    async modelOptions() { return []; },
    async resolveModelSelection() { return undefined; },
    async prepareOrdinaryRunBirth() { throw new Error("not used by this projection test"); },
    idFactory: () => "page-event",
  });

  const latest = await ports.ordinary.conversationPage({ conversationId: conversation.conversationId, limit: 3 });
  assert.deepEqual(latest.turns.map((turn) => turn.turnId), ["turn-2", "turn-3"]);
  assert.equal(latest.hasMore, true);
  assert.equal(latest.nextBeforeTurnId, "turn-2");
  assert.ok(Buffer.byteLength(JSON.stringify(latest), "utf8") <= REMOTE_CONVERSATION_PAGE_MAX_JSON_BYTES);
  assert.doesNotThrow(() => parseRemoteMessageContent({ type: "event", event: latest }));

  const older = await ports.ordinary.conversationPage({
    conversationId: conversation.conversationId,
    beforeTurnId: latest.nextBeforeTurnId,
    limit: 3,
  });
  assert.deepEqual(older.turns.map((turn) => turn.turnId), ["turn-1"]);
  assert.equal(older.hasMore, false);
});
