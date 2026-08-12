import { z } from "zod";

import {
  REMOTE_COLLABORATION_PROTOCOL_VERSION,
  remoteServerFrameSchema,
  type RemoteCommand,
  type RemoteEvent,
  type RemoteMessageContent,
} from "../../remote-collaboration/protocol";
import { createContentVaultHttpClient } from "../../content-vault/client";
import {
  canonicalContentVaultJson,
  canonicalManagedFileIdentity,
  managedFileResourceIdFromSha256,
  type ContentVaultMutation,
  type ContentVaultResource,
  type ContentVaultSnapshotCursor,
} from "../../content-vault/contracts";
import type { MobileOutboxEntry, MobilePendingConversation, MobileVaultConflict, MobileVaultOutboxEntry } from "./storage";
import { createMobileCredentialStore, type MobileCredentialStore } from "./credential-storage";
import type { MobileBinding, MobilePairingClaim, MobileRemoteStorage } from "./storage";

type ConversationIndex = Extract<RemoteEvent, { readonly kind: "conversation.index" }>;
type ConversationPage = Extract<RemoteEvent, { readonly kind: "conversation.page" }>;
type RunSnapshot = Extract<RemoteEvent, { readonly kind: "run.snapshot" }>;
type SocketContext = {
  readonly socket: WebSocket;
  readonly socketGeneration: number;
  readonly lifecycleGeneration: number;
};
const HEARTBEAT_INTERVAL_MS = 20_000;

const accountSchema = z.object({
  accountId: z.string().min(1),
  handle: z.string().min(3),
  displayName: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict();
const pairingClaimSchema = z.object({
  pairingId: z.string().min(1),
  pairingCode: z.string().regex(/^\d{6}$/u),
  deviceId: z.string().min(1),
  deviceName: z.string().min(1),
  role: z.literal("mobile"),
  claimSecret: z.string().min(32),
  accessToken: z.string().min(32),
  expiresAt: z.string().min(1),
  account: accountSchema,
}).strict();
const pairingStatusSchema = z.object({
  pairingId: z.string().min(1),
  pairingCode: z.string().regex(/^\d{6}$/u),
  status: z.enum(["waiting_for_mobile", "waiting_for_approval", "paired", "expired", "rejected"]),
  expiresAt: z.string().min(1),
  mobile: z.object({ deviceId: z.string().min(1), deviceName: z.string().min(1) }).strict().optional(),
  desktop: z.object({ deviceId: z.string().min(1), deviceName: z.string().min(1) }).strict(),
  account: accountSchema,
}).strict();

export type MobileRemoteState = {
  readonly connection: "loading" | "unpaired" | "pairing" | "connecting" | "connected" | "offline";
  readonly pairing?: MobilePairingClaim & {
    readonly status?: "waiting_for_approval" | "paired" | "expired" | "rejected";
    readonly peerDeviceName?: string;
  };
  readonly binding?: MobileBinding;
  readonly peerOnline: boolean;
  readonly conversations: ConversationIndex["conversations"];
  readonly conversationPages: Readonly<Record<string, ConversationPage>>;
  readonly runs: readonly RunSnapshot[];
  /** Highest live activity sequence observed for each run. This is a client projection guard, not a business fact. */
  readonly runActivitySequences?: Readonly<Record<string, number>>;
  readonly vaultResources: readonly ContentVaultResource[];
  /** Durable local Vault mutations that have not yet been applied or resolved. */
  readonly vaultOutbox?: readonly MobileVaultOutboxEntry[];
  readonly vaultCursor: number;
  readonly vaultConflicts: readonly MobileVaultConflict[];
  readonly modelOptions?: NonNullable<ConversationIndex["modelOptions"]>;
  readonly pendingCommandIds: readonly string[];
  readonly pendingConversations: readonly MobilePendingConversation[];
  readonly commandResults: readonly Extract<RemoteEvent, { readonly kind: "command.result" }>[];
  readonly error?: string;
  /** Knowledge-base synchronization failures stay separate from connection or command errors. */
  readonly vaultError?: string;
};

export type NewRemoteCommand = RemoteCommand extends infer Command
  ? Command extends { readonly commandId: string } ? Omit<Command, "commandId"> : never
  : never;

export type NewVaultMutation =
  | Omit<Extract<ContentVaultMutation, { readonly operation: "upsert" }>, "protocolVersion" | "mutationId" | "contentHash">
  | Omit<Extract<ContentVaultMutation, { readonly operation: "delete" }>, "protocolVersion" | "mutationId">;

export async function createManagedFileResourceId(input: {
  readonly managedRootId: string;
  readonly relativePath: string;
}): Promise<string> {
  return managedFileResourceIdFromSha256(await sha256Hex(canonicalManagedFileIdentity(input)));
}

export class RemoteMobileClient {
  readonly #listeners = new Set<() => void>();
  #state: MobileRemoteState = emptyState();
  #socket?: WebSocket;
  readonly #reliableInFlight = new Set<string>();
  #released = false;
  #started = false;
  #lifecycleGeneration = 0;
  #socketGeneration = 0;
  #connectPromise?: Promise<void>;
  #connectCancellation?: { readonly cancel: () => void };
  #reconnectTimer?: number;
  #heartbeatTimer?: number;
  #vaultSyncTimer?: number;
  #vaultSync?: Promise<void>;
  #reconnectAttempts = 0;

  constructor(
    readonly storage: MobileRemoteStorage,
    readonly fetch: typeof globalThis.fetch = globalThis.fetch,
    readonly createWebSocket: (url: string) => WebSocket = (url) => new WebSocket(url),
    readonly credentials: MobileCredentialStore = createMobileCredentialStore(),
  ) {}

  snapshot = (): MobileRemoteState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  async start(): Promise<void> {
    if (this.#started && !this.#released) return;
    this.#started = true;
    const lifecycleGeneration = ++this.#lifecycleGeneration;
    this.#released = false;
    const [pairing, binding, events, outbox, pendingConversations, token] = await Promise.all([
      this.storage.getPairing(),
      this.storage.getBinding(),
      this.storage.listEvents(),
      this.storage.listOutbox(),
      this.storage.listPendingConversations(),
      this.credentials.readDeviceToken(),
    ]);
    if (!this.#isCurrentLifecycle(lifecycleGeneration)) return;
    const [vaultResources, vaultCursor, vaultConflicts, vaultOutbox] = await Promise.all([
      this.storage.listVaultResources(),
      this.storage.getVaultCursor(),
      this.storage.listVaultConflicts(),
      typeof this.storage.listVaultOutbox === "function" ? this.storage.listVaultOutbox() : Promise.resolve([]),
    ]);
    if (!this.#isCurrentLifecycle(lifecycleGeneration)) return;
    let state = events.reduce(applyRemoteEvent, emptyState());
    const usableBinding = token === undefined ? undefined : binding;
    const completedCommandIds = new Set(state.commandResults.map((result) => result.commandId));
    const orphanedConversationEntries = outbox.filter(isUnownedNewConversationEntry);
    const recoverableOutbox = outbox.filter((entry) => !isUnownedNewConversationEntry(entry));
    const orphanedPendingConversations = pendingConversations.filter((entry) => !hasOpaqueId(entry.spaceId));
    const ownerScopedPendingConversations = pendingConversations.filter((entry) => hasOpaqueId(entry.spaceId));
    const restoredPendingConversations = mergePendingConversations([
      ...ownerScopedPendingConversations,
      ...recoverableOutbox.flatMap((entry) => {
        if (entry.content.type !== "command") return [];
        const pending = pendingConversationFromCommand(entry.content.command, entry.createdAt);
        return pending === undefined ? [] : [pending];
      }),
    ]).filter((entry) => !completedCommandIds.has(entry.commandId));
    state = {
      ...state,
      connection: usableBinding !== undefined ? "offline" : pairing !== undefined && token !== undefined ? "pairing" : "unpaired",
      peerOnline: false,
      ...(pairing === undefined || token === undefined ? {} : { pairing }),
      ...(usableBinding === undefined ? {} : { binding: usableBinding }),
      pendingCommandIds: recoverableOutbox.flatMap((entry) => entry.content.type === "command" ? [entry.content.command.commandId] : []),
      pendingConversations: restoredPendingConversations,
      vaultResources,
      vaultOutbox,
      vaultCursor,
      vaultConflicts,
    };
    this.#setState(state);
    await Promise.all([
      ...orphanedConversationEntries.map((entry) => this.storage.removeOutbox(entry.clientMessageId)),
      ...orphanedPendingConversations.map((entry) => this.storage.removePendingConversation(entry.commandId)),
      ...ownerScopedPendingConversations
        .filter((entry) => completedCommandIds.has(entry.commandId))
        .map((entry) => this.storage.removePendingConversation(entry.commandId)),
    ]);
    if (!this.#isCurrentLifecycle(lifecycleGeneration)) return;
    if (pairing !== undefined && token !== undefined) await this.inspectPairing(lifecycleGeneration).catch(() => undefined);
    if (!this.#isCurrentLifecycle(lifecycleGeneration)) return;
    if (usableBinding !== undefined && token !== undefined) {
      void this.#synchronizeVault(token, usableBinding.relayUrl).catch((error: unknown) => {
        if (!this.#isCurrentLifecycle(lifecycleGeneration)) return;
        this.#setState({
          ...this.#state,
          vaultError: error instanceof Error ? error.message : "无法同步知识库",
        });
      });
      this.#scheduleVaultSync(token, usableBinding.relayUrl);
      await this.connect().catch(() => undefined);
    }
  }

  async joinPairing(relayUrl: string, pairingCode: string, deviceName: string): Promise<void> {
    const normalizedRelayUrl = normalizeRelayUrl(relayUrl);
    const response = await fetchJson(this.fetch, `${normalizedRelayUrl}/v1/pairings/join`, {
      method: "POST",
      body: JSON.stringify({ pairingCode: pairingCode.replace(/\D/gu, ""), deviceName }),
    });
    const remote = pairingClaimSchema.parse(response.pairing);
    const pairing: MobilePairingClaim = {
      relayUrl: normalizedRelayUrl,
      pairingId: remote.pairingId,
      pairingCode: remote.pairingCode,
      deviceId: remote.deviceId,
      deviceName: remote.deviceName,
      claimSecret: remote.claimSecret,
      expiresAt: remote.expiresAt,
      account: {
        accountId: remote.account.accountId,
        handle: remote.account.handle,
        displayName: remote.account.displayName,
      },
    };
    await this.credentials.writeDeviceToken(remote.accessToken);
    try {
      await this.storage.savePairing(pairing);
    } catch (error) {
      await this.credentials.deleteDeviceToken().catch(() => undefined);
      throw error;
    }
    this.#setState({
      ...this.#state,
      connection: "pairing",
      pairing: { ...pairing, status: "waiting_for_approval" },
      error: undefined,
    });
  }

  async inspectPairing(expectedLifecycleGeneration = this.#lifecycleGeneration): Promise<void> {
    if (!this.#isCurrentLifecycle(expectedLifecycleGeneration)) return;
    const pairing = this.#state.pairing ?? await this.storage.getPairing();
    if (pairing === undefined || !this.#isCurrentLifecycle(expectedLifecycleGeneration)) return;
    const response = await fetchJson(this.fetch, `${pairing.relayUrl}/v1/pairings/${encodeURIComponent(pairing.pairingId)}/status`, {
      method: "POST",
      body: JSON.stringify({ claimSecret: pairing.claimSecret }),
    });
    if (!this.#isCurrentLifecycle(expectedLifecycleGeneration)) return;
    const status = pairingStatusSchema.parse(response.pairing);
    this.#setState({
      ...this.#state,
      connection: "pairing",
      pairing: { ...pairing, status: status.status === "waiting_for_mobile" ? "waiting_for_approval" : status.status, peerDeviceName: status.desktop.deviceName },
    });
    if (status.status !== "paired") return;
    const binding: MobileBinding = {
      relayUrl: pairing.relayUrl,
      accountId: status.account.accountId,
      accountHandle: status.account.handle,
      displayName: status.account.displayName,
      deviceId: pairing.deviceId,
      peerDeviceId: status.desktop.deviceId,
      peerDeviceName: status.desktop.deviceName,
    };
    await this.storage.saveBinding(binding);
    if (!this.#isCurrentLifecycle(expectedLifecycleGeneration)) return;
    await this.storage.clearPairing();
    if (!this.#isCurrentLifecycle(expectedLifecycleGeneration)) return;
    this.#setState({ ...this.#state, connection: "offline", pairing: undefined, binding, error: undefined });
    const token = await this.credentials.readDeviceToken();
    if (!this.#isCurrentLifecycle(expectedLifecycleGeneration)) return;
    if (token !== undefined) this.#scheduleVaultSync(token, binding.relayUrl);
    await this.connect();
  }

  connect(): Promise<void> {
    if (this.#connectPromise !== undefined) return this.#connectPromise;
    const lifecycleGeneration = this.#lifecycleGeneration;
    const promise = this.#connectInternal(lifecycleGeneration);
    this.#connectPromise = promise;
    void promise.then(
      () => this.#clearConnectPromise(promise),
      () => this.#clearConnectPromise(promise),
    );
    return promise;
  }

  async #connectInternal(lifecycleGeneration: number): Promise<void> {
    const [binding, token] = await Promise.all([this.storage.getBinding(), this.credentials.readDeviceToken()]);
    if (!this.#isCurrentLifecycle(lifecycleGeneration) || binding === undefined || token === undefined) return;
    if (this.#socket?.readyState === WebSocket.OPEN) return;
    if (this.#socket?.readyState === WebSocket.CONNECTING) return;
    if (this.#reconnectTimer !== undefined) window.clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = undefined;
    this.#setState({ ...this.#state, connection: "connecting", binding, error: undefined });

    const previousSocket = this.#socket;
    if (previousSocket !== undefined) {
      this.#socket = undefined;
      this.#socketGeneration += 1;
      this.#clearHeartbeat();
      try {
        previousSocket.close(1000, "mobile_replace_connection");
      } catch {
        // A stale socket is already detached; its close failure cannot affect the new attempt.
      }
    }
    const socket = this.createWebSocket(websocketUrl(binding.relayUrl));
    const socketGeneration = ++this.#socketGeneration;
    const context: SocketContext = { socket, socketGeneration, lifecycleGeneration };
    this.#socket = socket;

    let frameChain = Promise.resolve();
    let ready = false;
    let settled = false;
    let resolveAttempt!: () => void;
    let rejectAttempt!: (error: unknown) => void;
    const timeout = window.setTimeout(() => {
      if (!this.#isCurrentSocket(context)) return;
      settleReject(new Error("连接中继超时"));
      try {
        socket.close(1000, "mobile_connect_timeout");
      } catch {
        // The attempt is already rejected; close is best effort.
      }
    }, 10_000);
    const settleResolve = (): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolveAttempt();
    };
    const settleReject = (error: unknown): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      rejectAttempt(error);
    };
    const attempt = new Promise<void>((resolve, reject) => {
      resolveAttempt = resolve;
      rejectAttempt = reject;
    });
    const cancellation = {
      cancel: () => settleResolve(),
    };
    this.#connectCancellation = cancellation;

    socket.onopen = () => {
      if (!this.#isCurrentSocket(context)) return;
      try {
        socket.send(JSON.stringify({
          protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
          type: "client.hello",
          token,
        }));
      } catch (error) {
        settleReject(error);
      }
    };
    socket.onmessage = (message) => {
      if (!this.#isCurrentSocket(context)) return;
      frameChain = frameChain.then(async () => {
        if (!this.#isCurrentSocket(context)) return;
        const frame = remoteServerFrameSchema.parse(JSON.parse(String(message.data)) as unknown);
        if (frame.type === "server.ready") {
          ready = true;
          window.clearTimeout(timeout);
          this.#reconnectAttempts = 0;
          this.#reliableInFlight.clear();
          this.#startHeartbeat(socket);
          const current = await this.storage.getBinding();
          if (!this.#isCurrentSocket(context)) {
            settleResolve();
            return;
          }
          if (current === undefined) {
            settleReject(new Error("移动端绑定已丢失"));
            return;
          }
          const next = {
            ...current,
            ...(frame.peerDeviceId === undefined ? {} : { peerDeviceId: frame.peerDeviceId }),
            ...(frame.peerDeviceName === undefined ? {} : { peerDeviceName: frame.peerDeviceName }),
          };
          await this.storage.saveBinding(next);
          if (!this.#isCurrentSocket(context)) {
            settleResolve();
            return;
          }
          this.#setState({
            ...this.#state,
            connection: "connected",
            binding: next,
            peerOnline: frame.peerOnline,
            error: undefined,
          });
          try {
            await this.#flushOutbox(context);
          } catch (error) {
            if (this.#isCurrentSocket(context)) this.#setState({
              ...this.#state,
              error: error instanceof Error ? error.message : "无法发送待处理消息",
            });
          }
          if (!this.#isCurrentSocket(context)) {
            settleResolve();
            return;
          }
          void this.#synchronizeVault(token, next.relayUrl).catch((error: unknown) => {
            if (!this.#isCurrentSocket(context)) return;
            this.#setState({
              ...this.#state,
              vaultError: error instanceof Error ? error.message : "无法同步知识库",
            });
          });
          settleResolve();
          return;
        }
        if (frame.type === "message.accepted") {
          if (frame.settled) {
            this.#reliableInFlight.delete(frame.clientMessageId);
            await this.storage.removeOutbox(frame.clientMessageId);
            await this.#flushOutbox(context);
          }
          return;
        }
        if (frame.type === "message.received") {
          this.#reliableInFlight.delete(frame.clientMessageId);
          await this.storage.removeOutbox(frame.clientMessageId);
          await this.#flushOutbox(context);
          return;
        }
        if (frame.type === "message.rejected") {
          this.#reliableInFlight.delete(frame.clientMessageId);
          this.#setState({ ...this.#state, peerOnline: false, error: frame.message });
          return;
        }
        if (frame.type === "peer.presence") {
          if (!frame.online) this.#reliableInFlight.clear();
          this.#setState({ ...this.#state, peerOnline: frame.online, error: undefined });
          if (frame.online) await this.#flushOutbox(context);
          return;
        }
        if (frame.type === "vault.changed") {
          this.#scheduleNotifiedVaultSync(token, binding.relayUrl, frame.cursor);
          return;
        }
        if (frame.type === "message.deliver") {
          await this.#receiveMessage(frame.message.messageId, frame.message.clientMessageId, frame.message.content, context);
          return;
        }
        if (frame.type === "server.error") this.#setState({ ...this.#state, error: frame.message });
      }).catch((error: unknown) => {
        if (!this.#isCurrentSocket(context)) return;
        if (!ready) settleReject(error);
        else this.#setState({
          ...this.#state,
          error: error instanceof Error ? error.message : "无法处理同步消息",
        });
      });
    };
    socket.onerror = () => {
      if (!this.#isCurrentSocket(context)) return;
      if (!ready) settleReject(new Error("无法连接中继"));
    };
    socket.onclose = () => {
      window.clearTimeout(timeout);
      if (!this.#isCurrentSocket(context)) return;
      this.#reliableInFlight.clear();
      this.#clearHeartbeat();
      this.#socket = undefined;
      this.#socketGeneration += 1;
      if (!settled) settleReject(new Error("中继连接已关闭"));
      if (!this.#released) {
        this.#setState({ ...this.#state, connection: "offline", peerOnline: false });
        this.#scheduleReconnect(lifecycleGeneration);
      }
    };

    try {
      await attempt;
    } catch (error) {
      if (this.#isCurrentSocket(context)) {
        this.#socket = undefined;
        this.#socketGeneration += 1;
        this.#clearHeartbeat();
        try {
          socket.close(1000, "mobile_connect_failed");
        } catch {
          // The failed attempt is detached; no further state transition is needed here.
        }
        if (this.#isCurrentLifecycle(lifecycleGeneration)) {
          this.#setState({
            ...this.#state,
            connection: "offline",
            peerOnline: false,
            error: error instanceof Error ? error.message : "连接失败",
          });
          this.#scheduleReconnect(lifecycleGeneration);
        }
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
      if (this.#connectCancellation === cancellation) {
        this.#connectCancellation = undefined;
      }
    }
  }

  async sendCommand(command: NewRemoteCommand): Promise<string> {
    const commandId = createClientId();
    const complete = { ...command, commandId } as RemoteCommand;
    const createdAt = new Date().toISOString();
    const pendingConversation = pendingConversationFromCommand(complete, createdAt);
    await this.storage.putOutbox({
      clientMessageId: commandId,
      content: { type: "command", command: complete },
      createdAt,
    });
    if (pendingConversation !== undefined) await this.storage.putPendingConversation(pendingConversation);
    this.#setState({
      ...this.#state,
      pendingCommandIds: [...new Set([...this.#state.pendingCommandIds, commandId])],
      pendingConversations: pendingConversation === undefined
        ? this.#state.pendingConversations
        : mergePendingConversations([...this.#state.pendingConversations, pendingConversation]),
    });
    await this.#flushOutbox();
    return commandId;
  }

  async requestConversationPage(conversationId: string, beforeTurnId?: string): Promise<string> {
    return this.sendCommand({
      kind: "conversation.page.request",
      conversationId,
      ...(beforeTurnId === undefined ? {} : { beforeTurnId }),
      limit: 50,
    });
  }

  async submitVaultMutation(mutation: NewVaultMutation): Promise<string> {
    const mutationId = createClientId();
    const contentHash = mutation.operation === "upsert"
      ? await hashVaultPayload(mutation.payload)
      : undefined;
    const complete = {
      protocolVersion: "content-vault/v1" as const,
      mutationId,
      ...mutation,
      ...(contentHash === undefined ? {} : { contentHash }),
    } as ContentVaultMutation;
    const entry: MobileVaultOutboxEntry = { mutationId, mutation: complete, createdAt: new Date().toISOString() };
    await this.storage.putVaultOutbox(entry);
    this.#setState({
      ...this.#state,
      vaultOutbox: [entry, ...(this.#state.vaultOutbox ?? []).filter((candidate) => candidate.mutationId !== entry.mutationId)],
    });
    const binding = await this.storage.getBinding();
    const token = await this.credentials.readDeviceToken();
    if (binding !== undefined && token !== undefined) {
      await this.#synchronizeVault(token, binding.relayUrl);
      const conflict = (await this.storage.listVaultConflicts()).find((item) => item.mutationId === mutationId);
      if (conflict !== undefined) {
        throw new Error(vaultConflictMessage(conflict.reason));
      }
    }
    return mutationId;
  }

  async synchronizeVault(): Promise<void> {
    const [binding, token] = await Promise.all([this.storage.getBinding(), this.credentials.readDeviceToken()]);
    if (binding === undefined || token === undefined) return;
    await this.#synchronizeVault(token, binding.relayUrl);
  }

  async resolveVaultConflict(mutationId: string, resolution: "accept_remote" | "retry_local"): Promise<void> {
    const conflict = (await this.storage.listVaultConflicts()).find((item) => item.mutationId === mutationId);
    if (conflict === undefined) return;
    if (resolution === "accept_remote") {
      if (conflict.current !== undefined) await this.storage.putVaultResource(conflict.current);
      await this.storage.removeVaultConflict(mutationId);
      await this.#refreshVaultState();
      return;
    }
    const baseRevision = conflict.current?.revision ?? 0;
    const mutation: NewVaultMutation = conflict.mutation.operation === "upsert"
      ? {
          kind: conflict.mutation.kind,
          resourceId: conflict.mutation.resourceId,
          operation: "upsert",
          baseRevision,
          payloadSchemaVersion: 1,
          payload: conflict.mutation.payload,
        }
      : {
          kind: conflict.mutation.kind,
          resourceId: conflict.mutation.resourceId,
          operation: "delete",
          baseRevision,
        };
    await this.submitVaultMutation(mutation);
    await this.storage.removeVaultConflict(mutationId);
    await this.#refreshVaultState();
  }

  async forgetDevice(): Promise<void> {
    const lifecycleGeneration = ++this.#lifecycleGeneration;
    this.#started = false;
    this.#released = true;
    if (this.#reconnectTimer !== undefined) window.clearTimeout(this.#reconnectTimer);
    this.#clearHeartbeat();
    if (this.#vaultSyncTimer !== undefined) window.clearTimeout(this.#vaultSyncTimer);
    this.#reconnectTimer = undefined;
    this.#vaultSyncTimer = undefined;
    this.#cancelConnect();
    this.#detachSocket("mobile_forgot_device");
    const [binding, token] = await Promise.all([this.storage.getBinding(), this.credentials.readDeviceToken()]);
    if (this.#lifecycleGeneration !== lifecycleGeneration) return;
    if (binding !== undefined && token !== undefined) {
      await fetchJson(this.fetch, `${binding.relayUrl}/v1/devices/${encodeURIComponent(binding.deviceId)}/revoke`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
    }
    if (this.#lifecycleGeneration !== lifecycleGeneration) return;
    this.#reliableInFlight.clear();
    await Promise.all([this.storage.clearDeviceData(), this.credentials.deleteDeviceToken()]);
    if (this.#lifecycleGeneration !== lifecycleGeneration) return;
    this.#released = false;
    this.#setState(emptyState("unpaired"));
  }

  release(): void {
    this.#lifecycleGeneration += 1;
    this.#started = false;
    this.#released = true;
    if (this.#reconnectTimer !== undefined) window.clearTimeout(this.#reconnectTimer);
    this.#clearHeartbeat();
    if (this.#vaultSyncTimer !== undefined) window.clearTimeout(this.#vaultSyncTimer);
    this.#reconnectTimer = undefined;
    this.#vaultSyncTimer = undefined;
    this.#cancelConnect();
    this.#detachSocket("mobile_release");
    this.#reliableInFlight.clear();
    this.#listeners.clear();
  }

  async #receiveMessage(messageId: string, clientMessageId: string, content: RemoteMessageContent, context: SocketContext): Promise<void> {
    if (!this.#isCurrentSocket(context)) return;
    if (content.type === "event" && content.event.kind === "run.delta") {
      this.#setState(applyRemoteEvent(this.#state, content.event));
      this.#acknowledge(messageId, context);
      return;
    }
    if (await this.storage.hasReceived(clientMessageId)) {
      if (this.#isCurrentSocket(context)) this.#acknowledge(messageId, context);
      return;
    }
    if (content.type === "event") {
      const next = applyRemoteEvent(this.#state, content.event);
      await this.storage.saveEvent(materializeCachedEvent(next, content.event));
      if (!this.#isCurrentSocket(context)) return;
      if (content.event.kind === "command.result") {
        await this.storage.removePendingConversation(content.event.commandId);
      }
      if (!this.#isCurrentSocket(context)) return;
      this.#setState(next);
    }
    await this.storage.markReceived(clientMessageId, new Date().toISOString());
    if (this.#isCurrentSocket(context)) this.#acknowledge(messageId, context);
  }

  #acknowledge(messageId: string, context?: SocketContext): void {
    const socket = context?.socket ?? this.#socket;
    if (socket === undefined || socket.readyState !== WebSocket.OPEN) return;
    if (context !== undefined && !this.#isCurrentSocket(context)) return;
    socket.send(JSON.stringify({
      protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
      type: "message.received",
      messageId,
    }));
  }

  async #flushOutbox(context?: SocketContext): Promise<void> {
    const socket = context?.socket ?? this.#socket;
    if (socket === undefined) return;
    const socketContext = context ?? {
      socket,
      socketGeneration: this.#socketGeneration,
      lifecycleGeneration: this.#lifecycleGeneration,
    };
    if (!this.#isCurrentSocket(socketContext) || socket.readyState !== WebSocket.OPEN
      || this.#state.connection !== "connected" || !this.#state.peerOnline) return;
    for (const entry of await this.storage.listOutbox()) {
      if (!this.#isCurrentSocket(socketContext) || socket.readyState !== WebSocket.OPEN
        || this.#state.connection !== "connected" || !this.#state.peerOnline) return;
      if (this.#reliableInFlight.has(entry.clientMessageId)) continue;
      this.#reliableInFlight.add(entry.clientMessageId);
      try {
        socket.send(JSON.stringify({
          protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
          type: "message.submit",
          clientMessageId: entry.clientMessageId,
          content: entry.content,
        }));
      } catch (error) {
        this.#reliableInFlight.delete(entry.clientMessageId);
        throw error;
      }
    }
  }

  async #flushVaultOutbox(client: ReturnType<typeof createContentVaultHttpClient>): Promise<void> {
    const entries = await this.storage.listVaultOutbox();
    for (const entry of entries) {
      const results = await client.mutate([entry.mutation]);
      const result = results[0];
      if (result === undefined) continue;
      if (result.status === "applied") {
        const [verified] = await verifyVaultResources([result.resource]);
        if (verified === undefined) throw new Error("同步内容校验失败：服务器返回了空资源");
        await this.storage.putVaultResource(verified);
        await this.storage.removeVaultOutbox(entry.mutationId);
        await this.storage.removeVaultConflict(entry.mutationId);
        continue;
      }
      await this.storage.putVaultConflict({
        mutationId: entry.mutationId,
        mutation: entry.mutation,
        reason: result.reason,
        ...(result.current === undefined ? {} : { current: result.current }),
        detectedAt: new Date().toISOString(),
      });
      await this.storage.removeVaultOutbox(entry.mutationId);
    }
  }

  async #synchronizeVault(token: string, relayUrl: string): Promise<void> {
    if (this.#vaultSync !== undefined) return this.#vaultSync;
    const synchronization = this.#runVaultSynchronization(token, relayUrl)
      .finally(() => {
        if (this.#vaultSync === synchronization) this.#vaultSync = undefined;
      });
    this.#vaultSync = synchronization;
    return synchronization;
  }

  async #runVaultSynchronization(token: string, relayUrl: string): Promise<void> {
    const client = createContentVaultHttpClient({ baseUrl: relayUrl, token, fetch: this.fetch });
    await this.#flushVaultOutbox(client);
    let cursor = await this.storage.getVaultCursor();
    let resources = await this.storage.listVaultResources();
    if (cursor === 0 && resources.length === 0) {
      let snapshotCursor: ContentVaultSnapshotCursor | undefined;
      while (true) {
        const page = await client.snapshot(snapshotCursor, 100);
        await this.storage.applyVaultChanges(await verifyVaultResources(page.resources), cursor);
        if (page.nextCursor === undefined) {
          cursor = page.changeCursor;
          await this.storage.applyVaultChanges([], cursor);
          break;
        }
        snapshotCursor = page.nextCursor;
      }
    } else {
      while (true) {
        const page = await client.changes(cursor, 100);
        if (page.hasMore && page.nextCursor === cursor) {
          throw new Error("知识库同步游标没有向前推进");
        }
        await this.storage.applyVaultChanges(await verifyVaultResources(page.changes.map((change) => change.resource)), page.nextCursor);
        cursor = page.nextCursor;
        if (!page.hasMore) break;
      }
    }
    await this.#refreshVaultState();
  }

  async #refreshVaultState(): Promise<void> {
    const [vaultResources, vaultCursor, vaultConflicts, vaultOutbox] = await Promise.all([
      this.storage.listVaultResources(),
      this.storage.getVaultCursor(),
      this.storage.listVaultConflicts(),
      typeof this.storage.listVaultOutbox === "function" ? this.storage.listVaultOutbox() : Promise.resolve([]),
    ]);
    this.#setState({ ...this.#state, vaultResources, vaultOutbox, vaultCursor, vaultConflicts, vaultError: undefined });
  }

  #scheduleVaultSync(token: string, relayUrl: string): void {
    if (this.#released || this.#vaultSyncTimer !== undefined) return;
    this.#vaultSyncTimer = window.setTimeout(() => {
      this.#vaultSyncTimer = undefined;
      void this.#synchronizeVault(token, relayUrl)
        .catch((error: unknown) => this.#setState({
          ...this.#state,
          vaultError: error instanceof Error ? error.message : "无法同步知识库",
        }))
        .finally(() => this.#scheduleVaultSync(token, relayUrl));
    }, 10_000);
  }

  #scheduleNotifiedVaultSync(token: string, relayUrl: string, targetCursor: number): void {
    void this.#synchronizeVault(token, relayUrl)
      .then(async () => {
        if (await this.storage.getVaultCursor() < targetCursor) {
          await this.#synchronizeVault(token, relayUrl);
        }
      })
      .catch((error: unknown) => this.#setState({
        ...this.#state,
        vaultError: error instanceof Error ? error.message : "无法同步知识库",
      }));
  }

  #scheduleReconnect(lifecycleGeneration = this.#lifecycleGeneration): void {
    if (!this.#isCurrentLifecycle(lifecycleGeneration) || this.#reconnectTimer !== undefined) return;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(5, this.#reconnectAttempts++));
    const timer = window.setTimeout(() => {
      if (this.#reconnectTimer !== timer) return;
      this.#reconnectTimer = undefined;
      if (!this.#isCurrentLifecycle(lifecycleGeneration)) return;
      void this.connect().catch(() => undefined);
    }, delay);
    this.#reconnectTimer = timer;
  }

  #isCurrentLifecycle(lifecycleGeneration: number): boolean {
    return !this.#released && this.#lifecycleGeneration === lifecycleGeneration;
  }

  #isCurrentSocket(context: SocketContext): boolean {
    return this.#isCurrentLifecycle(context.lifecycleGeneration)
      && this.#socket === context.socket
      && this.#socketGeneration === context.socketGeneration;
  }

  #clearConnectPromise(promise: Promise<void>): void {
    if (this.#connectPromise === promise) this.#connectPromise = undefined;
  }

  #cancelConnect(): void {
    this.#connectPromise = undefined;
    const cancellation = this.#connectCancellation;
    this.#connectCancellation = undefined;
    cancellation?.cancel();
  }

  #detachSocket(reason: string): void {
    const socket = this.#socket;
    this.#socket = undefined;
    this.#socketGeneration += 1;
    this.#clearHeartbeat();
    if (socket === undefined || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) return;
    try {
      socket.close(1000, reason);
    } catch {
      // Detachment already invalidated every handler; closing is best effort.
    }
  }

  #startHeartbeat(socket: WebSocket): void {
    this.#clearHeartbeat();
    this.#heartbeatTimer = window.setInterval(() => {
      if (this.#socket !== socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({
        protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
        type: "heartbeat",
        sentAt: new Date().toISOString(),
      }));
    }, HEARTBEAT_INTERVAL_MS);
  }

  #clearHeartbeat(): void {
    if (this.#heartbeatTimer !== undefined) window.clearInterval(this.#heartbeatTimer);
    this.#heartbeatTimer = undefined;
  }

  #setState(state: MobileRemoteState): void {
    this.#state = state;
    for (const listener of this.#listeners) listener();
  }
}

function vaultConflictMessage(reason: MobileVaultConflict["reason"]): string {
  if (reason === "revision_mismatch") return "另一台设备已经修改了这项内容，请先处理同步冲突";
  if (reason === "resource_deleted") return "这项内容已在另一台设备删除";
  return "云端找不到这项内容，请先处理同步冲突";
}

async function verifyVaultResources(resources: readonly ContentVaultResource[]): Promise<readonly ContentVaultResource[]> {
  for (const resource of resources) {
    if (resource.deleted || resource.payload === undefined) continue;
    const payloadJson = canonicalContentVaultJson(resource.payload);
    const byteLength = new TextEncoder().encode(payloadJson).byteLength;
    if (byteLength !== resource.contentBytes) {
      throw new Error(`同步内容校验失败：${resource.resourceId} 的大小不一致`);
    }
    const hash = `sha256:${await sha256Hex(payloadJson)}`;
    if (hash !== resource.contentHash) {
      throw new Error(`同步内容校验失败：${resource.resourceId} 的摘要不一致`);
    }
  }
  return resources;
}

export function applyRemoteEvent(state: MobileRemoteState, event: RemoteEvent): MobileRemoteState {
  switch (event.kind) {
    case "conversation.index": return { ...state, conversations: event.conversations, modelOptions: event.modelOptions ?? state.modelOptions };
    case "conversation.page": {
      const current = state.conversationPages[event.conversationId];
      const merged = event.beforeTurnId === undefined || current === undefined
        ? event
        : {
            ...event,
            turns: uniqueTurns([...event.turns, ...current.turns]),
          };
      return { ...state, conversationPages: { ...state.conversationPages, [event.conversationId]: merged } };
    }
    case "run.snapshot": return { ...state, runs: replaceBy(state.runs, event, "runId") };
    case "run.delta": {
      const current = state.runs.find((run) => run.runId === event.runId);
      if (current === undefined || ["completed", "failed", "cancelled", "blocked"].includes(current.status)) return state;
      const lastSequence = state.runActivitySequences?.[event.runId] ?? 0;
      if (event.activitySequence <= lastSequence) return state;
      return {
        ...state,
        runs: replaceBy(state.runs, {
          ...current,
          visibleAssistantText: `${current.visibleAssistantText ?? ""}${event.delta}`,
        }, "runId"),
        runActivitySequences: {
          ...state.runActivitySequences,
          [event.runId]: event.activitySequence,
        },
      };
    }
    case "command.result": return {
      ...state,
      pendingCommandIds: state.pendingCommandIds.filter((id) => id !== event.commandId),
      pendingConversations: state.pendingConversations.filter((entry) => entry.commandId !== event.commandId),
      commandResults: [event, ...state.commandResults.filter((result) => result.commandId !== event.commandId)].slice(0, 50),
    };
  }
}

export function materializeCachedEvent(state: MobileRemoteState, event: RemoteEvent): RemoteEvent {
  if (event.kind === "conversation.page") return state.conversationPages[event.conversationId] ?? event;
  return event;
}

function replaceBy<T, K extends keyof T>(items: readonly T[], item: T, key: K): T[] {
  return [item, ...items.filter((candidate) => candidate[key] !== item[key])];
}

function uniqueTurns(turns: ConversationPage["turns"]): ConversationPage["turns"] {
  const seen = new Set<string>();
  return turns.filter((turn) => !seen.has(turn.turnId) && seen.add(turn.turnId));
}

function emptyState(connection: MobileRemoteState["connection"] = "loading"): MobileRemoteState {
  return {
    connection,
    peerOnline: false,
    conversations: [],
    conversationPages: {},
    runs: [],
    vaultResources: [],
    vaultCursor: 0,
    vaultConflicts: [],
    modelOptions: [],
    pendingCommandIds: [],
    pendingConversations: [],
    commandResults: [],
  };
}

function pendingConversationFromCommand(command: RemoteCommand, createdAt: string): MobilePendingConversation | undefined {
  if (command.kind !== "conversation.submit" || hasOpaqueId(command.conversationId) || !hasOpaqueId(command.spaceId)) return undefined;
  return {
    commandId: command.commandId,
    spaceId: command.spaceId,
    message: command.message,
    createdAt,
    ...(command.modelSelectionId === undefined ? {} : { modelSelectionId: command.modelSelectionId }),
  };
}

function isUnownedNewConversationEntry(entry: MobileOutboxEntry): boolean {
  if (entry.content.type !== "command" || entry.content.command.kind !== "conversation.submit") return false;
  return !hasOpaqueId(entry.content.command.conversationId) && !hasOpaqueId(entry.content.command.spaceId);
}

function hasOpaqueId(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function mergePendingConversations(entries: readonly MobilePendingConversation[]): MobilePendingConversation[] {
  const byCommandId = new Map(entries.map((entry) => [entry.commandId, entry]));
  return [...byCommandId.values()].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt)
    || left.commandId.localeCompare(right.commandId));
}

async function hashVaultPayload(payload: Readonly<Record<string, unknown>>): Promise<string> {
  return `sha256:${await sha256Hex(canonicalContentVaultJson(payload))}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fetchJson(fetch: typeof globalThis.fetch, url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init.headers } });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    const error = typeof body.error === "object" && body.error !== null ? body.error as Record<string, unknown> : {};
    throw new Error(typeof error.message === "string" ? error.message : `请求失败 (${response.status})`);
  }
  return body;
}

function normalizeRelayUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("官方协同服务配置无效");
  return url.toString().replace(/\/$/u, "");
}

function websocketUrl(relayUrl: string): string {
  const url = new URL(relayUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/u, "")}/v1/connect`;
  return url.toString();
}

export function createClientId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
