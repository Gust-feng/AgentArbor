import {
  REMOTE_COLLABORATION_PROTOCOL_VERSION,
  parseRemoteSyncSnapshot,
  remoteServerFrameSchema,
  type RemoteCommand,
  type RemoteEvent,
  type RemoteMessageContent,
} from "../../remote-collaboration/protocol";
import type {
  MobileBinding,
  MobilePairingClaim,
  MobileRemoteStorage,
} from "./storage";

type ConversationSnapshot = Extract<RemoteEvent, { readonly kind: "conversation.snapshot" }>;
type RunSnapshot = Extract<RemoteEvent, { readonly kind: "run.snapshot" }>;
type SpaceSnapshot = Extract<RemoteEvent, { readonly kind: "space.snapshot" }>;
type NotebookSnapshot = Extract<RemoteEvent, { readonly kind: "notebook.snapshot" }>;
type AssetSnapshot = Extract<RemoteEvent, { readonly kind: "asset.snapshot" }>;
type ManagedFolderSnapshot = Extract<RemoteEvent, { readonly kind: "managed_folder.snapshot" }>;

export type MobileRemoteState = {
  readonly connection: "loading" | "unpaired" | "pairing" | "connecting" | "connected" | "offline";
  readonly pairing?: MobilePairingClaim & {
    readonly peerDeviceName?: string;
    readonly localConfirmed?: boolean;
    readonly peerConfirmed?: boolean;
  };
  readonly binding?: MobileBinding;
  readonly peerOnline: boolean;
  readonly conversations: readonly ConversationSnapshot[];
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
  ) {}

  snapshot = (): MobileRemoteState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  async start(): Promise<void> {
    this.#released = false;
    const [pairing, binding, events, outbox] = await Promise.all([
      this.storage.getPairing(),
      this.storage.getBinding(),
      this.storage.listEvents(),
      this.storage.listOutbox(),
    ]);
    let state = events.reduce(applyRemoteEvent, emptyState());
    state = {
      ...state,
      connection: binding !== undefined ? "offline" : pairing !== undefined ? "pairing" : "unpaired",
      peerOnline: false,
      ...(pairing === undefined ? {} : { pairing }),
      ...(binding === undefined ? {} : { binding }),
      pendingCommandIds: outbox.flatMap((entry) => entry.content.type === "command" ? [entry.content.command.commandId] : []),
    };
    this.#setState(state);
    if (binding !== undefined && !this.#released) await this.connect().catch(() => undefined);
  }

  async joinPairing(relayUrl: string, pairingCode: string, deviceName: string): Promise<void> {
    const normalizedRelayUrl = normalizeRelayUrl(relayUrl);
    const response = await fetchJson(this.fetch, `${normalizedRelayUrl}/v1/pairings/join`, {
      method: "POST",
      body: JSON.stringify({ pairingCode: pairingCode.replace(/\D/gu, ""), deviceName }),
    });
    const remote = response.pairing as Omit<MobilePairingClaim, "relayUrl">;
    const pairing = { ...remote, relayUrl: normalizedRelayUrl };
    await this.storage.savePairing(pairing);
    this.#setState({ ...this.#state, connection: "pairing", pairing, error: undefined });
  }

  async inspectPairing(): Promise<void> {
    const pairing = this.#state.pairing;
    if (pairing === undefined) return;
    const response = await fetchJson(this.fetch, `${pairing.relayUrl}/v1/pairings/${encodeURIComponent(pairing.pairingId)}/status`, {
      method: "POST",
      body: JSON.stringify({ claimSecret: pairing.claimSecret }),
    });
    await this.#applyPairingStatus(response.pairing as PairingStatus);
  }

  async confirmPairing(): Promise<void> {
    const pairing = this.#state.pairing;
    if (pairing === undefined) return;
    const response = await fetchJson(this.fetch, `${pairing.relayUrl}/v1/pairings/${encodeURIComponent(pairing.pairingId)}/confirm`, {
      method: "POST",
      body: JSON.stringify({ claimSecret: pairing.claimSecret, pairingCode: pairing.pairingCode }),
    });
    await this.#applyPairingStatus(response.pairing as PairingStatus);
  }

  async #applyPairingStatus(status: PairingStatus): Promise<void> {
    const pairing = this.#state.pairing;
    if (pairing === undefined) return;
    this.#setState({
      ...this.#state,
      pairing: {
        ...pairing,
        ...(status.peer === undefined ? {} : { peerDeviceName: status.peer.deviceName }),
        localConfirmed: status.localConfirmed,
        peerConfirmed: status.peerConfirmed,
      },
    });
    if (status.status !== "paired" || status.peer === undefined) return;
    const response = await fetchJson(this.fetch, `${pairing.relayUrl}/v1/pairings/${encodeURIComponent(pairing.pairingId)}/token`, {
      method: "POST",
      body: JSON.stringify({ claimSecret: pairing.claimSecret }),
    });
    const token = response.device as { deviceId: string; accessToken: string };
    const binding: MobileBinding = {
      relayUrl: pairing.relayUrl,
      deviceId: token.deviceId,
      accessToken: token.accessToken,
      peerDeviceId: status.peer.deviceId,
      peerDeviceName: status.peer.deviceName,
    };
    await this.storage.saveBinding(binding);
    await this.storage.clearPairing();
    this.#setState({ ...this.#state, connection: "offline", pairing: undefined, binding });
    await this.connect();
  }

  async connect(): Promise<void> {
    const binding = await this.storage.getBinding();
    if (binding === undefined || this.#released || this.#socket?.readyState === WebSocket.OPEN) return;
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
        token: binding.accessToken,
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
              peerDeviceId: frame.peerDeviceId,
              peerDeviceName: frame.peerDeviceName,
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
            await this.#pullSnapshots();
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
            }
            return;
          }
          if (frame.type === "message.deliver") {
            await this.#receiveMessage(
              frame.message.messageId,
              frame.message.clientMessageId,
              frame.message.content,
            );
            return;
          }
          if (frame.type === "server.error") {
            this.#setState({ ...this.#state, error: frame.message });
          }
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

  async forgetDevice(): Promise<void> {
    this.#released = true;
    if (this.#reconnectTimer !== undefined) window.clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = undefined;
    const binding = await this.storage.getBinding();
    try {
      if (binding !== undefined) {
        await fetchJson(this.fetch, `${binding.relayUrl}/v1/devices/${encodeURIComponent(binding.deviceId)}/revoke`, {
          method: "POST",
          headers: { authorization: `Bearer ${binding.accessToken}` },
        });
      }
    } catch (error) {
      this.#socket?.close(1000, "mobile_revoke_failed");
      this.#socket = undefined;
      this.#released = false;
      this.#setState({
        ...this.#state,
        connection: binding === undefined ? "pairing" : "offline",
        error: error instanceof Error ? error.message : "无法撤销远程设备",
      });
      throw error;
    }
    this.#socket?.close(1000, "mobile_forgot_device");
    this.#socket = undefined;
    await this.storage.clearDeviceData();
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

  async #receiveMessage(
    messageId: string,
    clientMessageId: string,
    content: RemoteMessageContent,
  ): Promise<void> {
    if (await this.storage.hasReceived(clientMessageId)) {
      this.#acknowledge(messageId);
      return;
    }
    if (content.type === "event") {
      if (content.event.kind === "sync.changed") {
        await this.#pullSnapshots();
      } else {
        if (content.event.kind !== "run.delta") await this.storage.saveEvent(content.event);
        this.#setState(applyRemoteEvent(this.#state, content.event));
      }
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
    if (this.#socket?.readyState !== WebSocket.OPEN || this.#state.connection !== "connected") return;
    for (const entry of await this.storage.listOutbox()) this.#socket.send(JSON.stringify({
      protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
      type: "message.submit",
      clientMessageId: entry.clientMessageId,
      content: entry.content,
    }));
  }

  async #pullSnapshots(): Promise<void> {
    const binding = await this.storage.getBinding();
    if (binding === undefined) return;
    const body = await fetchJson(this.fetch, `${binding.relayUrl}/v1/sync/snapshots`, {
      method: "GET",
      headers: { authorization: `Bearer ${binding.accessToken}` },
    });
    const documents = Array.isArray(body.documents) ? body.documents : [];
    for (const document of documents) {
      if (typeof document !== "object" || document === null || !("snapshot" in document)) continue;
      const snapshot = parseRemoteSyncSnapshot((document as { snapshot: unknown }).snapshot);
      await this.storage.saveEvent(snapshot);
      this.#setState(applyRemoteEvent(this.#state, snapshot));
    }
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
    case "conversation.snapshot":
      return { ...state, conversations: replaceBy(state.conversations, event, "conversationId") };
    case "run.snapshot":
      return { ...state, runs: replaceBy(state.runs, event, "runId") };
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
    case "sync.changed": return state;
    case "space.snapshot": return { ...state, spaces: event.spaces };
    case "notebook.snapshot": return { ...state, notebooks: event.notebooks };
    case "asset.snapshot": return { ...state, assets: event.assets };
    case "managed_folder.snapshot": return { ...state, managedFolders: event.folders };
    case "command.result": return {
      ...state,
      pendingCommandIds: state.pendingCommandIds.filter((id) => id !== event.commandId),
      commandResults: [event, ...state.commandResults.filter((result) => result.commandId !== event.commandId)].slice(0, 50),
    };
  }
}

function replaceBy<T, K extends keyof T>(items: readonly T[], item: T, key: K): readonly T[] {
  return [item, ...items.filter((candidate) => candidate[key] !== item[key])];
}

function emptyState(connection: MobileRemoteState["connection"] = "loading"): MobileRemoteState {
  return {
    connection,
    peerOnline: false,
    conversations: [],
    runs: [],
    spaces: [],
    notebooks: [],
    assets: [],
    managedFolders: [],
    pendingCommandIds: [],
    commandResults: [],
  };
}

type PairingStatus = {
  readonly status: "waiting_for_peer" | "waiting_for_confirmation" | "paired" | "expired";
  readonly localConfirmed: boolean;
  readonly peerConfirmed: boolean;
  readonly peer?: { readonly deviceId: string; readonly deviceName: string };
};

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
