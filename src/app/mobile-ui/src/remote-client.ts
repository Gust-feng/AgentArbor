import { z } from "zod";

import {
  REMOTE_COLLABORATION_PROTOCOL_VERSION,
  remoteServerFrameSchema,
  type RemoteCommand,
  type RemoteEvent,
  type RemoteMessageContent,
} from "../../remote-collaboration/protocol";
import { createMobileCredentialStore, type MobileCredentialStore } from "./credential-storage";
import type { MobileBinding, MobilePairingClaim, MobileRemoteStorage } from "./storage";

type ConversationIndex = Extract<RemoteEvent, { readonly kind: "conversation.index" }>;
type ConversationPage = Extract<RemoteEvent, { readonly kind: "conversation.page" }>;
type RunSnapshot = Extract<RemoteEvent, { readonly kind: "run.snapshot" }>;
type SpaceSnapshot = Extract<RemoteEvent, { readonly kind: "space.snapshot" }>;
type NotebookSnapshot = Extract<RemoteEvent, { readonly kind: "notebook.snapshot" }>;
type AssetSnapshot = Extract<RemoteEvent, { readonly kind: "asset.snapshot" }>;
type ManagedFolderSnapshot = Extract<RemoteEvent, { readonly kind: "managed_folder.snapshot" }>;

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
  readonly spaces: SpaceSnapshot["spaces"];
  readonly notebooks: NotebookSnapshot["notebooks"];
  readonly assets: AssetSnapshot["assets"];
  readonly managedFolders: ManagedFolderSnapshot["folders"];
  readonly pendingCommandIds: readonly string[];
  readonly commandResults: readonly Extract<RemoteEvent, { readonly kind: "command.result" }>[];
  readonly error?: string;
};

export type NewRemoteCommand = RemoteCommand extends infer Command
  ? Command extends { readonly commandId: string } ? Omit<Command, "commandId"> : never
  : never;

export class RemoteMobileClient {
  readonly #listeners = new Set<() => void>();
  #state: MobileRemoteState = emptyState();
  #socket?: WebSocket;
  #released = false;
  #reconnectTimer?: number;
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
    this.#released = false;
    const [pairing, binding, events, outbox, token] = await Promise.all([
      this.storage.getPairing(),
      this.storage.getBinding(),
      this.storage.listEvents(),
      this.storage.listOutbox(),
      this.credentials.readDeviceToken(),
    ]);
    let state = events.reduce(applyRemoteEvent, emptyState());
    const usableBinding = token === undefined ? undefined : binding;
    state = {
      ...state,
      connection: usableBinding !== undefined ? "offline" : pairing !== undefined && token !== undefined ? "pairing" : "unpaired",
      peerOnline: false,
      ...(pairing === undefined || token === undefined ? {} : { pairing }),
      ...(usableBinding === undefined ? {} : { binding: usableBinding }),
      pendingCommandIds: outbox.flatMap((entry) => entry.content.type === "command" ? [entry.content.command.commandId] : []),
    };
    this.#setState(state);
    if (pairing !== undefined && token !== undefined) await this.inspectPairing().catch(() => undefined);
    if (usableBinding !== undefined && !this.#released) await this.connect().catch(() => undefined);
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

  async inspectPairing(): Promise<void> {
    const pairing = this.#state.pairing ?? await this.storage.getPairing();
    if (pairing === undefined) return;
    const response = await fetchJson(this.fetch, `${pairing.relayUrl}/v1/pairings/${encodeURIComponent(pairing.pairingId)}/status`, {
      method: "POST",
      body: JSON.stringify({ claimSecret: pairing.claimSecret }),
    });
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
    await this.storage.clearPairing();
    this.#setState({ ...this.#state, connection: "offline", pairing: undefined, binding, error: undefined });
    await this.connect();
  }

  async connect(): Promise<void> {
    const [binding, token] = await Promise.all([this.storage.getBinding(), this.credentials.readDeviceToken()]);
    if (binding === undefined || token === undefined || this.#released || this.#socket?.readyState === WebSocket.OPEN) return;
    if (this.#reconnectTimer !== undefined) window.clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = undefined;
    this.#setState({ ...this.#state, connection: "connecting", binding, error: undefined });
    const socket = this.createWebSocket(websocketUrl(binding.relayUrl));
    this.#socket = socket;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("连接中继超时")), 10_000);
      let ready = false;
      socket.onopen = () => socket.send(JSON.stringify({
        protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
        type: "client.hello",
        token,
      }));
      socket.onmessage = (message) => {
        void (async () => {
          const frame = remoteServerFrameSchema.parse(JSON.parse(String(message.data)) as unknown);
          if (frame.type === "server.ready") {
            ready = true;
            window.clearTimeout(timeout);
            this.#reconnectAttempts = 0;
            const current = await this.storage.getBinding();
            if (current === undefined) return;
            const next = {
              ...current,
              ...(frame.peerDeviceId === undefined ? {} : { peerDeviceId: frame.peerDeviceId }),
              ...(frame.peerDeviceName === undefined ? {} : { peerDeviceName: frame.peerDeviceName }),
            };
            await this.storage.saveBinding(next);
            this.#setState({
              ...this.#state,
              connection: "connected",
              binding: next,
              peerOnline: frame.peerOnline,
              error: undefined,
            });
            await this.#flushOutbox();
            if (frame.peerOnline) await this.#ensureSnapshotRequest();
            resolve();
            return;
          }
          if (frame.type === "message.accepted") {
            if (frame.settled) await this.storage.removeOutbox(frame.clientMessageId);
            return;
          }
          if (frame.type === "message.received") {
            await this.storage.removeOutbox(frame.clientMessageId);
            return;
          }
          if (frame.type === "message.rejected") {
            this.#setState({ ...this.#state, peerOnline: false, error: frame.message });
            return;
          }
          if (frame.type === "peer.presence") {
            this.#setState({ ...this.#state, peerOnline: frame.online, error: undefined });
            if (frame.online) {
              await this.#flushOutbox();
              await this.#ensureSnapshotRequest();
            }
            return;
          }
          if (frame.type === "message.deliver") {
            await this.#receiveMessage(frame.message.messageId, frame.message.clientMessageId, frame.message.content);
            return;
          }
          if (frame.type === "server.error") this.#setState({ ...this.#state, error: frame.message });
        })().catch((error: unknown) => this.#setState({
          ...this.#state,
          error: error instanceof Error ? error.message : "无法处理同步消息",
        }));
      };
      socket.onerror = () => {
        if (!ready) {
          window.clearTimeout(timeout);
          reject(new Error("无法连接中继"));
        }
      };
      socket.onclose = () => {
        window.clearTimeout(timeout);
        if (this.#socket === socket) this.#socket = undefined;
        if (!this.#released) {
          this.#setState({ ...this.#state, connection: "offline", peerOnline: false });
          this.#scheduleReconnect();
        }
      };
    }).catch((error: unknown) => {
      this.#setState({
        ...this.#state,
        connection: "offline",
        peerOnline: false,
        error: error instanceof Error ? error.message : "连接失败",
      });
      this.#scheduleReconnect();
      throw error;
    });
  }

  async sendCommand(command: NewRemoteCommand): Promise<string> {
    const commandId = createClientId();
    const complete = { ...command, commandId } as RemoteCommand;
    await this.storage.putOutbox({
      clientMessageId: commandId,
      content: { type: "command", command: complete },
      createdAt: new Date().toISOString(),
    });
    this.#setState({
      ...this.#state,
      pendingCommandIds: [...new Set([...this.#state.pendingCommandIds, commandId])],
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

  async forgetDevice(): Promise<void> {
    this.#released = true;
    if (this.#reconnectTimer !== undefined) window.clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = undefined;
    const [binding, token] = await Promise.all([this.storage.getBinding(), this.credentials.readDeviceToken()]);
    if (binding !== undefined && token !== undefined) {
      await fetchJson(this.fetch, `${binding.relayUrl}/v1/devices/${encodeURIComponent(binding.deviceId)}/revoke`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
    }
    this.#socket?.close(1000, "mobile_forgot_device");
    this.#socket = undefined;
    await Promise.all([this.storage.clearDeviceData(), this.credentials.deleteDeviceToken()]);
    this.#released = false;
    this.#setState(emptyState("unpaired"));
  }

  release(): void {
    this.#released = true;
    if (this.#reconnectTimer !== undefined) window.clearTimeout(this.#reconnectTimer);
    this.#socket?.close(1000, "mobile_release");
    this.#socket = undefined;
    this.#listeners.clear();
  }

  async #receiveMessage(messageId: string, clientMessageId: string, content: RemoteMessageContent): Promise<void> {
    if (await this.storage.hasReceived(clientMessageId)) {
      this.#acknowledge(messageId);
      return;
    }
    if (content.type === "event") {
      const next = applyRemoteEvent(this.#state, content.event);
      if (content.event.kind !== "run.delta") {
        await this.storage.saveEvent(materializeCachedEvent(next, content.event));
      }
      this.#setState(next);
    }
    await this.storage.markReceived(clientMessageId, new Date().toISOString());
    this.#acknowledge(messageId);
  }

  #acknowledge(messageId: string): void {
    if (this.#socket?.readyState === WebSocket.OPEN) this.#socket.send(JSON.stringify({
      protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
      type: "message.received",
      messageId,
    }));
  }

  async #flushOutbox(): Promise<void> {
    if (this.#socket?.readyState !== WebSocket.OPEN || this.#state.connection !== "connected" || !this.#state.peerOnline) return;
    for (const entry of await this.storage.listOutbox()) this.#socket.send(JSON.stringify({
      protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
      type: "message.submit",
      clientMessageId: entry.clientMessageId,
      content: entry.content,
    }));
  }

  async #ensureSnapshotRequest(): Promise<void> {
    const pending = await this.storage.listOutbox();
    if (pending.some((entry) => entry.content.type === "command" && entry.content.command.kind === "sync.snapshot.request")) return;
    await this.sendCommand({ kind: "sync.snapshot.request" });
  }

  #scheduleReconnect(): void {
    if (this.#released || this.#reconnectTimer !== undefined) return;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(5, this.#reconnectAttempts++));
    this.#reconnectTimer = window.setTimeout(() => {
      this.#reconnectTimer = undefined;
      void this.connect().catch(() => undefined);
    }, delay);
  }

  #setState(state: MobileRemoteState): void {
    this.#state = state;
    for (const listener of this.#listeners) listener();
  }
}

export function applyRemoteEvent(state: MobileRemoteState, event: RemoteEvent): MobileRemoteState {
  switch (event.kind) {
    case "conversation.index": return { ...state, conversations: event.conversations };
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
      if (current === undefined) return state;
      return {
        ...state,
        runs: replaceBy(state.runs, {
          ...current,
          visibleAssistantText: `${current.visibleAssistantText ?? ""}${event.delta}`,
        }, "runId"),
      };
    }
    case "space.snapshot": return { ...state, spaces: event.spaces };
    case "notebook.snapshot": return { ...state, notebooks: event.notebooks };
    case "asset.snapshot": {
      const base = event.pageIndex === 0 ? [] : state.assets;
      let assets: MobileRemoteState["assets"] = [...base];
      for (const asset of event.assets) assets = replaceBy(assets, asset, "assetId");
      return { ...state, assets };
    }
    case "managed_folder.snapshot": {
      const base = event.pageIndex === 0 ? [] : state.managedFolders;
      let managedFolders: MobileRemoteState["managedFolders"] = [...base];
      for (const pageFolder of event.folders) {
        const current = managedFolders.find((folder) => folder.referenceId === pageFolder.referenceId);
        let files = [...(current?.files ?? [])];
        for (const file of pageFolder.files) files = replaceBy(files, file, "relativePath");
        const folder = current === undefined
          ? pageFolder
          : { ...pageFolder, files };
        managedFolders = replaceBy(managedFolders, folder, "referenceId");
      }
      return { ...state, managedFolders };
    }
    case "command.result": return {
      ...state,
      pendingCommandIds: state.pendingCommandIds.filter((id) => id !== event.commandId),
      commandResults: [event, ...state.commandResults.filter((result) => result.commandId !== event.commandId)].slice(0, 50),
    };
  }
}

function materializeCachedEvent(state: MobileRemoteState, event: RemoteEvent): RemoteEvent {
  if (event.kind === "asset.snapshot") {
    return { ...event, pageIndex: 0, pageCount: 1, assets: state.assets };
  }
  if (event.kind === "managed_folder.snapshot") {
    return { ...event, pageIndex: 0, pageCount: 1, folders: state.managedFolders };
  }
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
    spaces: [],
    notebooks: [],
    assets: [],
    managedFolders: [],
    pendingCommandIds: [],
    commandResults: [],
  };
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
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("中继地址必须使用 http 或 https");
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
