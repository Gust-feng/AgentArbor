import assert from "node:assert/strict";
import test from "node:test";

import {
  REMOTE_CONVERSATION_PAGE_MAX_JSON_BYTES,
  RemoteCommandConflict,
  parseRemoteMessageContent,
} from "../remote-collaboration/index.js";
import {
  createPanelRemoteCollaborationPorts,
  resolveRemoteModelSelectionForRun,
  withRemoteConversationProjectionInvalidation,
} from "./remote-collaboration-ports.js";

test("remote commands publish conversation projection invalidation with the owning Space", async () => {
  const published: unknown[] = [];
  const basePorts = {
    ordinary: {
      async submit() { return { conversationId: "conversation-1", runId: "run-1" }; },
      async cancel() { return undefined; },
      async decide() { return undefined; },
    },
  };
  const ports = withRemoteConversationProjectionInvalidation({
    ports: basePorts as unknown as Parameters<typeof withRemoteConversationProjectionInvalidation>[0]["ports"],
    getConversationOwner: async (conversationId) =>
      conversationId === "conversation-1" ? { kind: "space", id: "space-1" } : undefined,
    conversationIdOfRun: async (runId) => runId === "run-1" ? "conversation-1" : undefined,
    publish: (change) => { published.push(change); },
  });

  const submitted = await ports.ordinary.submit({ submissionId: "submission-1", message: "hi" });
  assert.deepEqual(submitted, { conversationId: "conversation-1", runId: "run-1" });
  await ports.ordinary.cancel("run-1");
  await ports.ordinary.decide({ runId: "run-1", confirmationId: "confirmation-1", decision: "approve_once" });

  assert.deepEqual(published, [
    { owners: ["conversations", "spaces"], conversationIds: ["conversation-1"], spaceIds: ["space-1"] },
    { owners: ["conversations", "spaces"], conversationIds: ["conversation-1"], spaceIds: ["space-1"] },
    { owners: ["conversations", "spaces"], conversationIds: ["conversation-1"], spaceIds: ["space-1"] },
  ]);
});

test("remote command invalidation failures never fail the already-successful command", async () => {
  const basePorts = {
    ordinary: {
      async submit() { return { conversationId: "conversation-9", runId: "run-9" }; },
    },
  };
  const ports = withRemoteConversationProjectionInvalidation({
    ports: basePorts as unknown as Parameters<typeof withRemoteConversationProjectionInvalidation>[0]["ports"],
    getConversationOwner: async () => { throw new Error("owner lookup unavailable"); },
    conversationIdOfRun: async () => { throw new Error("run lookup unavailable"); },
    publish: () => { throw new Error("feed released"); },
  });

  const submitted = await ports.ordinary.submit({ submissionId: "submission-9", message: "hi" });
  assert.deepEqual(submitted, { conversationId: "conversation-9", runId: "run-9" });
});

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

test("remote new-conversation submission synchronizes Vault and declares the canonical Space owner", async () => {
  type PortsInput = Parameters<typeof createPanelRemoteCollaborationPorts>[0];
  let synchronized = false;
  let submitTurnInput: { readonly owner?: unknown; readonly input?: { readonly taskSoil?: { readonly permissionBoundaryRefs?: readonly string[] } } } | undefined;
  let birthArgs: { readonly owner?: unknown; readonly conversationId?: string } | undefined;
  const ports = createPanelRemoteCollaborationPorts({
    ordinary: {
      commands: {
        async submitTurn(input: typeof submitTurnInput) {
          assert.equal(synchronized, true);
          submitTurnInput = input;
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
        async findConversationOwner() { throw new Error("new conversations must not read the legacy tree link"); },
      },
      commands: {
        async linkConversationOwner() { throw new Error("new conversations must not write the legacy tree link"); },
      },
    } as unknown as PortsInput["spaces"],
    async modelOptions() { return []; },
    async resolveModelSelection() { return undefined; },
    async synchronizeContentVault() { synchronized = true; },
    async prepareOrdinaryRunBirth(birthInput, conversationId) {
      birthArgs = { owner: birthInput.owner, ...(conversationId === undefined ? {} : { conversationId }) };
      return {} as Awaited<ReturnType<PortsInput["prepareOrdinaryRunBirth"]>>;
    },
  });

  const submitted = await ports.ordinary.submit({
    submissionId: "submission-1",
    spaceId: "space-1",
    message: "Create after the Space arrives",
  });

  assert.deepEqual(submitted, { conversationId: "conversation-1", runId: "run-1" });
  assert.deepEqual(submitTurnInput?.owner, { kind: "space", id: "space-1" });
  assert.deepEqual(submitTurnInput?.input?.taskSoil?.permissionBoundaryRefs, ["scope:space:space-1"]);
  // Run 出生必须冻结 owner 作用域，否则 birth 直接拒绝（owner required before run birth）。
  assert.deepEqual(birthArgs, { owner: { kind: "space", id: "space-1" } });
});

test("remote submission to an existing conversation resolves its Space through the canonical owner", async () => {
  type PortsInput = Parameters<typeof createPanelRemoteCollaborationPorts>[0];
  const tree = {
    space: { id: "space-1" },
    entries: [{
      item: {
        id: "reference-1",
        title: "Doc",
        reference: { kind: "local_file", path: "C:/docs/doc.md" },
      },
    }],
  };
  let submitTurnInput: {
    readonly owner?: unknown;
    readonly input?: { readonly taskSoil?: { readonly contextRefs?: readonly { readonly ref: string }[]; readonly permissionBoundaryRefs?: readonly string[] } };
  } | undefined;
  let birthArgs: { readonly owner?: unknown; readonly conversationId?: string } | undefined;
  const ports = createPanelRemoteCollaborationPorts({
    ordinary: {
      commands: {
        async submitTurn(input: typeof submitTurnInput) {
          submitTurnInput = input;
          return {
            conversation: { conversationId: "conversation-1", title: "Existing conversation" },
            run: { runId: "run-1" },
          };
        },
      },
      queries: {
        async getConversationOwner(conversationId: string) {
          return conversationId === "conversation-1" ? { kind: "space", id: "space-1" } : undefined;
        },
      },
    } as unknown as PortsInput["ordinary"],
    spaces: {
      queries: {
        async getTree(spaceId: string) { return spaceId === "space-1" ? tree : undefined; },
        async findConversationOwner() { throw new Error("canonical owners must not fall back to the legacy tree link"); },
      },
    } as unknown as PortsInput["spaces"],
    async modelOptions() { return []; },
    async resolveModelSelection() { return undefined; },
    async prepareOrdinaryRunBirth(birthInput, conversationId) {
      birthArgs = { owner: birthInput.owner, ...(conversationId === undefined ? {} : { conversationId }) };
      return {} as Awaited<ReturnType<PortsInput["prepareOrdinaryRunBirth"]>>;
    },
  });

  const submitted = await ports.ordinary.submit({
    submissionId: "submission-2",
    conversationId: "conversation-1",
    spaceId: "space-1",
    message: "Continue in the owning Space",
  });

  assert.deepEqual(submitted, { conversationId: "conversation-1", runId: "run-1" });
  // 既有对话由 conversationId 在出生流程内解析 canonical owner。
  assert.deepEqual(birthArgs, { owner: undefined, conversationId: "conversation-1" });
  assert.deepEqual(submitTurnInput?.input?.taskSoil?.contextRefs?.map((ref) => ref.ref), ["local-file:C:/docs/doc.md"]);
  assert.ok(submitTurnInput?.input?.taskSoil?.permissionBoundaryRefs?.includes("scope:space:space-1"));

  await assert.rejects(
    ports.ordinary.submit({
      submissionId: "submission-3",
      conversationId: "conversation-1",
      spaceId: "space-2",
      message: "Continue in the wrong Space",
    }),
    (error: unknown) => error instanceof RemoteCommandConflict && error.code === "conversation_space_conflict",
  );
});

test("remote conversation index reports the Space from the canonical owner", async () => {
  type PortsInput = Parameters<typeof createPanelRemoteCollaborationPorts>[0];
  const ports = createPanelRemoteCollaborationPorts({
    ordinary: {
      queries: {
        async listConversations() {
          return [{
            conversationId: "conversation-1",
            title: "Canonical conversation",
            updatedAt: "2026-08-04T00:00:00.000Z",
            turns: [],
          }];
        },
        async getConversationOwner() { return { kind: "space", id: "space-1" }; },
      },
    } as unknown as PortsInput["ordinary"],
    spaces: {
      queries: {
        async findConversationOwner() { throw new Error("canonical owners must not fall back to the legacy tree link"); },
      },
    } as unknown as PortsInput["spaces"],
    async modelOptions() { return []; },
    async resolveModelSelection() { return undefined; },
    async prepareOrdinaryRunBirth() { throw new Error("not used by this projection test"); },
  });

  const index = await ports.ordinary.conversationIndex();
  assert.deepEqual(index.conversations.map((conversation) => ({
    conversationId: conversation.conversationId,
    spaceId: conversation.spaceId,
    status: conversation.status,
  })), [{ conversationId: "conversation-1", spaceId: "space-1", status: "idle" }]);
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
