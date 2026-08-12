import type { ContentVaultResource, ContentVaultResourceKind } from "../../content-vault/contracts";
import type { NewRemoteCommand, NewVaultMutation, MobileRemoteState } from "./remote-client";
import { RemoteMobileClient } from "./remote-client";
import { createIndexedDbMobileRemoteStorage } from "./storage";

type DemoConversationPage = MobileRemoteState["conversationPages"][string];

/**
 * A local-only client for reviewing the mobile surface without pairing a device.
 * It is loaded only by the Vite development entry and never participates in APK builds.
 */
export class DemoRemoteClient extends RemoteMobileClient {
  #demoState: MobileRemoteState = createDemoState();
  #demoListeners = new Set<() => void>();
  #sequence = 0;

  constructor() {
    super(createIndexedDbMobileRemoteStorage());
  }

  override snapshot = (): MobileRemoteState => this.#demoState;

  override subscribe = (listener: () => void): (() => void) => {
    this.#demoListeners.add(listener);
    return () => this.#demoListeners.delete(listener);
  };

  override async start(): Promise<void> {
    this.#emit();
  }

  override release(): void {
    this.#demoListeners.clear();
  }

  override async connect(): Promise<void> {
    this.#demoState = { ...this.#demoState, connection: "connected", peerOnline: true };
    this.#emit();
  }

  override async sendCommand(command: NewRemoteCommand): Promise<string> {
    const commandId = this.#nextId("demo-command");
    if (command.kind === "conversation.submit") {
      const conversationId = command.conversationId ?? this.#nextId("demo-conversation");
      const now = new Date().toISOString();
      const title = command.message.length > 32 ? `${command.message.slice(0, 32)}…` : command.message;
      const currentPage = this.#demoState.conversationPages[conversationId];
      const conversation = {
        conversationId,
        title,
        updatedAt: now,
        status: "completed" as const,
        ...(command.spaceId === undefined ? {} : { spaceId: command.spaceId }),
      };
      const page = currentPage === undefined
        ? createDemoPage(conversationId, command.message, now)
        : appendDemoTurn(currentPage, command.message, now);
      this.#demoState = {
        ...this.#demoState,
        conversations: [conversation, ...this.#demoState.conversations.filter((item) => item.conversationId !== conversationId)],
        conversationPages: {
          ...this.#demoState.conversationPages,
          [conversationId]: page,
        },
        commandResults: [
          {
            kind: "command.result",
            eventId: this.#nextId("demo-event"),
            commandId,
            status: "applied",
            entity: { conversationId },
          },
          ...this.#demoState.commandResults,
        ],
      };
      this.#emit();
      return commandId;
    }

    if (command.kind === "conversation.page.request") {
      this.#emit();
      return commandId;
    }

    this.#emit();
    return commandId;
  }

  override async requestConversationPage(conversationId: string): Promise<string> {
    const page = this.#demoState.conversationPages[conversationId];
    if (page === undefined) return this.sendCommand({ kind: "conversation.page.request", conversationId, limit: 50 });
    this.#demoState = {
      ...this.#demoState,
      conversationPages: { ...this.#demoState.conversationPages, [conversationId]: page },
    };
    this.#emit();
    return this.#nextId("demo-page-request");
  }

  override async submitVaultMutation(mutation: NewVaultMutation): Promise<string> {
    const mutationId = this.#nextId("demo-mutation");
    const current = this.#demoState.vaultResources.find((resource) =>
      resource.kind === mutation.kind && resource.resourceId === mutation.resourceId);
    const nextRevision = (current?.revision ?? 0) + 1;
    const resource: ContentVaultResource = mutation.operation === "delete"
      ? {
          kind: mutation.kind,
          resourceId: mutation.resourceId,
          revision: nextRevision,
          deleted: true,
          payloadSchemaVersion: 1,
          contentHash: `sha256:${"0".repeat(64)}`,
          contentBytes: 0,
          updatedAt: new Date().toISOString(),
          updatedByDeviceId: "demo-mobile",
        }
      : {
          kind: mutation.kind,
          resourceId: mutation.resourceId,
          revision: nextRevision,
          deleted: false,
          payloadSchemaVersion: 1,
          payload: mutation.payload,
          contentHash: `sha256:${"a".repeat(64)}`,
          contentBytes: 64,
          updatedAt: new Date().toISOString(),
          updatedByDeviceId: "demo-mobile",
        };
    this.#demoState = {
      ...this.#demoState,
      vaultCursor: this.#demoState.vaultCursor + 1,
      vaultResources: [resource, ...this.#demoState.vaultResources.filter((item) =>
        item.kind !== resource.kind || item.resourceId !== resource.resourceId)],
    };
    this.#emit();
    return mutationId;
  }

  override async resolveVaultConflict(): Promise<void> {
    return undefined;
  }

  override async forgetDevice(): Promise<void> {
    return undefined;
  }

  override async inspectPairing(): Promise<void> {
    return undefined;
  }

  override async joinPairing(): Promise<void> {
    return undefined;
  }

  #nextId(prefix: string): string {
    this.#sequence += 1;
    return `${prefix}-${this.#sequence}`;
  }

  #emit(): void {
    for (const listener of this.#demoListeners) listener();
  }
}

function createDemoState(): MobileRemoteState {
  const now = "2026-08-04T00:00:00.000Z";
  const firstConversationId = "demo-conversation-1";
  const secondConversationId = "demo-conversation-2";
  return {
    connection: "connected",
    peerOnline: true,
    binding: {
      relayUrl: "",
      accountId: "demo-account",
      accountHandle: "feng",
      displayName: "feng",
      deviceId: "demo-mobile",
      peerDeviceId: "demo-desktop",
      peerDeviceName: "feng 的电脑",
    },
    conversations: [
      {
        conversationId: firstConversationId,
        title: "AI 模型身份的询问",
        updatedAt: now,
        status: "completed",
        spaceId: "demo-space-learning",
      },
      {
        conversationId: secondConversationId,
        title: "移动端界面优化",
        updatedAt: "2026-08-03T00:00:00.000Z",
        status: "idle",
        spaceId: "demo-space-project",
      },
    ],
    conversationPages: {
      [firstConversationId]: createDemoPage(firstConversationId, "请帮我整理一下这周的学习计划。", now),
      [secondConversationId]: createDemoPage(secondConversationId, "把移动端的输入区做得更安静一些。", "2026-08-03T00:00:00.000Z"),
    },
    runs: [],
    vaultResources: [
      demoResource("space", "demo-space-learning", {
        title: "学习空间",
        createdAt: now,
        updatedAt: now,
      }),
      demoResource("space", "demo-space-project", {
        title: "项目空间",
        createdAt: now,
        updatedAt: now,
      }),
      demoResource("space", "demo-space-ideas", {
        title: "灵感收集",
        createdAt: now,
        updatedAt: now,
      }),
      demoResource("personal_note", "demo-note-1", {
        spaceId: "demo-space-learning",
        title: "本周学习计划",
        bodyMarkdown: "整理 Transformer 的注意力机制，并完成一份简短笔记。",
        materialRefs: [],
        createdAt: 1,
        updatedAt: 1,
        sourceRevision: 1,
      }),
      demoResource("managed_root", "demo-root-1", {
        spaceId: "demo-space-learning",
        title: "学习资料",
      }),
      demoResource("managed_file", "demo-file-1", {
        managedRootId: "demo-root-1",
        relativePath: "attention/reading-list.md",
        text: "# 阅读清单\n\n- Attention Is All You Need",
      }),
      demoResource("workbench_asset", "demo-asset-1", {
        title: "空间说明.md",
        kind: "markdown",
        text: "这是一个用于整理学习资料和笔记的空间。",
        language: "markdown",
      }),
    ],
    vaultCursor: 7,
    vaultConflicts: [],
    modelOptions: [
      { id: "demo-model-fast", label: "DeepSeek-V4-flash", providerLabel: "DeepSeek", supportsTools: true, supportsVision: false, isDefault: true },
      { id: "demo-model-reasoning", label: "Claude Sonnet", providerLabel: "Anthropic", supportsTools: true, supportsVision: true, isDefault: false },
    ],
    pendingCommandIds: [],
    pendingConversations: [],
    commandResults: [],
  };
}

function createDemoPage(conversationId: string, message: string, createdAt: string): DemoConversationPage {
  return {
    kind: "conversation.page",
    eventId: `demo-page-${conversationId}`,
    conversationId,
    turns: [
      {
        turnId: `${conversationId}-user`,
        runId: `${conversationId}-run`,
        role: "user",
        content: message,
        status: "completed",
        createdAt,
        updatedAt: createdAt,
      },
      {
        turnId: `${conversationId}-assistant`,
        runId: `${conversationId}-run`,
        role: "assistant",
        content: "可以。我会把重点整理成清晰的步骤，并保留在这个空间里，方便之后继续。",
        status: "completed",
        createdAt,
        updatedAt: createdAt,
      },
    ],
    hasMore: false,
  };
}

function appendDemoTurn(page: DemoConversationPage, message: string, createdAt: string): DemoConversationPage {
  const runId = `${page.conversationId}-run-${page.turns.length}`;
  return {
    ...page,
    eventId: `${page.eventId}-next`,
    turns: [
      ...page.turns,
      {
        turnId: `${page.conversationId}-user-${page.turns.length}`,
        runId,
        role: "user",
        content: message,
        status: "completed",
        createdAt,
        updatedAt: createdAt,
      },
      {
        turnId: `${page.conversationId}-assistant-${page.turns.length}`,
        runId,
        role: "assistant",
        content: "已收到。我会沿着当前空间的上下文继续处理，并把结果保留在这段对话中。",
        status: "completed",
        createdAt,
        updatedAt: createdAt,
      },
    ],
  };
}

function demoResource(kind: ContentVaultResourceKind, resourceId: string, payload: Readonly<Record<string, unknown>>): ContentVaultResource {
  return {
    kind,
    resourceId,
    revision: 1,
    deleted: false,
    payloadSchemaVersion: 1,
    payload,
    contentHash: `sha256:${"a".repeat(64)}`,
    contentBytes: 64,
    updatedAt: "2026-08-04T00:00:00.000Z",
    updatedByDeviceId: "demo-desktop",
  };
}
