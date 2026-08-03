import { randomUUID } from "node:crypto";

import { WebSocket } from "ws";
import { z } from "zod";

import {
  REMOTE_COLLABORATION_PROTOCOL_VERSION,
  isRemoteSyncSnapshot,
  remoteServerFrameSchema,
  type RemoteEvent,
  type RemoteRelayMessage,
  type RemoteSyncSnapshot,
} from "./protocol.js";
import type { RemoteCommandApplication } from "./command-handler.js";
import type { RemoteDesktopStore } from "./desktop-store.js";

const REMOTE_DEVICE_TOKEN_REF = "secret://local-dev/remote-collaboration/device-token";
const pairingClaimSchema = z.object({
  pairingId: z.string().min(1),
  pairingCode: z.string().regex(/^\d{6}$/u),
  deviceId: z.string().min(1),
  deviceName: z.string().min(1),
  role: z.literal("desktop"),
  claimSecret: z.string().min(32),
  expiresAt: z.string().min(1),
}).strict();
const pairingStatusSchema = z.object({
  pairingId: z.string().min(1),
  pairingCode: z.string().regex(/^\d{6}$/u),
  deviceId: z.string().min(1),
  deviceName: z.string().min(1),
  role: z.literal("desktop"),
  peer: z.object({ deviceId: z.string().min(1), deviceName: z.string().min(1), role: z.literal("mobile") }).strict().optional(),
  status: z.enum(["waiting_for_peer", "waiting_for_confirmation", "paired", "expired"]),
  localConfirmed: z.boolean(),
  peerConfirmed: z.boolean(),
  expiresAt: z.string().min(1),
}).strict();
const syncDocumentReceiptSchema = z.object({
  kind: z.enum(["space.snapshot", "notebook.snapshot", "asset.snapshot", "managed_folder.snapshot"]),
  version: z.number().int().positive(),
  updatedAt: z.string().min(1),
}).passthrough();

export type RemoteCredentialStore = {
  readSecret(secretRef: string): Promise<string | undefined>;
  writeSecret(secretRef: string, value: string): Promise<unknown>;
  deleteSecret(secretRef: string): Promise<unknown>;
};

export type RemoteDesktopConnectionStatus = {
  readonly state: "unpaired" | "pairing" | "connecting" | "connected" | "offline";
  readonly relayUrl?: string;
  readonly deviceId?: string;
  readonly peerDeviceId?: string;
  readonly peerDeviceName?: string;
  readonly peerOnline: boolean;
  readonly suggestedRelayUrl?: string;
  readonly pairingCode?: string;
  readonly pairingExpiresAt?: string;
  readonly error?: { readonly code: string; readonly message: string };
};

export function createRemoteCollaborationFeature(input: {
  readonly store: RemoteDesktopStore;
  readonly credentials: RemoteCredentialStore;
  readonly commandHandler: {
    apply(command: import("./protocol.js").RemoteCommand): Promise<RemoteCommandApplication>;
    watchRun(
      runId: string,
      listener: (events: readonly RemoteEvent[]) => void,
      onError?: (error: unknown) => void,
    ): () => void;
    snapshotsForRun(runId: string): Promise<readonly RemoteEvent[]>;
  };
  readonly fetch?: typeof globalThis.fetch;
  readonly idFactory?: () => string;
  readonly now?: () => string;
  readonly defaultRelayUrl?: string;
}) {
  const fetch = input.fetch ?? globalThis.fetch;
  const idFactory = input.idFactory ?? randomUUID;
  const now = input.now ?? (() => new Date().toISOString());
  const listeners = new Set<(status: RemoteDesktopConnectionStatus) => void>();
  let socket: WebSocket | undefined;
  let released = false;
  let manualDisconnect = false;
  let reconnectAttempts = 0;
  let reconnectTimer: NodeJS.Timeout | undefined;
  let connectPromise: Promise<void> | undefined;
  const runSubscriptions = new Map<string, () => void>();
  const syncUploads = new Set<string>();
  const syncUploadTasks = new Set<Promise<void>>();
  let status = initialStatus(input.store, input.defaultRelayUrl);

  function publish(patch: Partial<RemoteDesktopConnectionStatus>): void {
    status = { ...status, ...patch };
    for (const listener of listeners) {
      try { listener(structuredClone(status)); } catch { /* Status observers cannot affect transport. */ }
    }
  }

  async function beginPairing(relayUrl: string, deviceName: string, invitationCode?: string) {
    const normalizedRelayUrl = normalizeRelayUrl(relayUrl);
    const response = await fetchJson(fetch, `${normalizedRelayUrl}/v1/pairings`, {
      method: "POST",
      body: JSON.stringify({ deviceName, ...(invitationCode === undefined ? {} : { invitationCode }) }),
    });
    const pairing = pairingClaimSchema.parse(response.pairing);
    const saved = { ...pairing, relayUrl: normalizedRelayUrl, updatedAt: now() };
    input.store.savePairing(saved);
    publish({
      state: "pairing",
      relayUrl: normalizedRelayUrl,
      deviceId: pairing.deviceId,
      pairingCode: pairing.pairingCode,
      pairingExpiresAt: pairing.expiresAt,
      error: undefined,
    });
    return saved;
  }

  async function inspectPairing() {
    const pairing = input.store.getPairing();
    if (pairing === undefined) throw new Error("No desktop pairing is in progress");
    const response = await fetchJson(fetch, `${pairing.relayUrl}/v1/pairings/${encodeURIComponent(pairing.pairingId)}/status`, {
      method: "POST",
      body: JSON.stringify({ claimSecret: pairing.claimSecret }),
    });
    const remoteStatus = pairingStatusSchema.parse(response.pairing);
    await finishPairingIfReady(pairing, remoteStatus);
    return remoteStatus;
  }

  async function confirmPairing() {
    const pairing = input.store.getPairing();
    if (pairing === undefined) throw new Error("No desktop pairing is in progress");
    const response = await fetchJson(fetch, `${pairing.relayUrl}/v1/pairings/${encodeURIComponent(pairing.pairingId)}/confirm`, {
      method: "POST",
      body: JSON.stringify({ claimSecret: pairing.claimSecret, pairingCode: pairing.pairingCode }),
    });
    const remoteStatus = pairingStatusSchema.parse(response.pairing);
    await finishPairingIfReady(pairing, remoteStatus);
    return remoteStatus;
  }

  async function finishPairingIfReady(
    pairing: NonNullable<ReturnType<RemoteDesktopStore["getPairing"]>>,
    remoteStatus: z.infer<typeof pairingStatusSchema>,
  ): Promise<void> {
    if (remoteStatus.status !== "paired" || remoteStatus.peer === undefined) return;
    const response = await fetchJson(fetch, `${pairing.relayUrl}/v1/pairings/${encodeURIComponent(pairing.pairingId)}/token`, {
      method: "POST",
      body: JSON.stringify({ claimSecret: pairing.claimSecret }),
    });
    const device = z.object({ deviceId: z.string().min(1), accessToken: z.string().min(32) }).strict().parse(response.device);
    await input.credentials.writeSecret(REMOTE_DEVICE_TOKEN_REF, device.accessToken);
    input.store.saveBinding({
      relayUrl: pairing.relayUrl,
      deviceId: device.deviceId,
      peerDeviceId: remoteStatus.peer.deviceId,
      peerDeviceName: remoteStatus.peer.deviceName,
      updatedAt: now(),
    });
    input.store.clearPairing();
    publish({
      state: "offline",
      relayUrl: pairing.relayUrl,
      deviceId: device.deviceId,
      peerDeviceId: remoteStatus.peer.deviceId,
      peerDeviceName: remoteStatus.peer.deviceName,
      peerOnline: false,
      pairingCode: undefined,
      pairingExpiresAt: undefined,
      error: undefined,
    });
  }

  async function connect(): Promise<void> {
    if (released) throw new Error("Remote Collaboration feature is released");
    if (socket?.readyState === WebSocket.OPEN) return;
    if (connectPromise !== undefined) return connectPromise;
    const binding = input.store.getBinding();
    const token = await input.credentials.readSecret(REMOTE_DEVICE_TOKEN_REF);
    if (binding === undefined || token === undefined) {
      publish({ state: input.store.getPairing() === undefined ? "unpaired" : "pairing" });
      return;
    }
    manualDisconnect = false;
    clearReconnectTimer();
    publish({ state: "connecting", relayUrl: binding.relayUrl, deviceId: binding.deviceId, error: undefined });
    const connected = new Promise<void>((resolve, reject) => {
      const next = new WebSocket(websocketUrl(binding.relayUrl));
      socket = next;
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for Relay server.ready")), 10_000);
      timeout.unref?.();
      let ready = false;
      next.on("open", () => {
        next.send(JSON.stringify({
          protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
          type: "client.hello",
          token,
        }));
      });
      next.on("message", (raw) => {
        void (async () => {
          const frame = remoteServerFrameSchema.parse(JSON.parse(raw.toString()) as unknown);
          if (frame.type === "server.ready") {
            ready = true;
            clearTimeout(timeout);
            reconnectAttempts = 0;
            input.store.saveBinding({
              ...binding,
              peerDeviceId: frame.peerDeviceId,
              peerDeviceName: frame.peerDeviceName,
              updatedAt: now(),
            });
            publish({
              state: "connected",
              peerDeviceId: frame.peerDeviceId,
              peerDeviceName: frame.peerDeviceName,
              peerOnline: frame.peerOnline,
              error: undefined,
            });
            flushOutbox();
            void publishSnapshots(frame.peerOnline).catch((error: unknown) => publish({
              error: { code: "remote_snapshot_failed", message: error instanceof Error ? error.message : "Remote snapshot failed" },
            }));
            resolve();
            return;
          }
          if (frame.type === "message.accepted") {
            if (frame.settled) input.store.acceptOutbox(frame.clientMessageId, now());
            return;
          }
          if (frame.type === "message.received") {
            input.store.acceptOutbox(frame.clientMessageId, now());
            return;
          }
          if (frame.type === "message.rejected") {
            publish({ peerOnline: false, error: { code: frame.code, message: frame.message } });
            return;
          }
          if (frame.type === "peer.presence") {
            publish({ peerOnline: frame.online, error: undefined });
            if (frame.online) {
              flushOutbox();
              void publishSnapshots(true).catch((error: unknown) => publish({
                error: { code: "remote_snapshot_failed", message: error instanceof Error ? error.message : "Remote snapshot failed" },
              }));
            }
            return;
          }
          if (frame.type === "message.deliver") {
            await receiveMessage(frame.message);
            return;
          }
          if (frame.type === "server.error") {
            publish({ error: { code: frame.code, message: frame.message } });
          }
        })().catch((error: unknown) => publish({
          error: { code: "remote_frame_failed", message: error instanceof Error ? error.message : "Remote frame failed" },
        }));
      });
      next.once("error", (error) => {
        if (!ready) {
          clearTimeout(timeout);
          reject(error);
        }
      });
      next.once("close", () => {
        clearTimeout(timeout);
        if (socket === next) socket = undefined;
        if (!released && !manualDisconnect) {
          publish({ state: "offline", peerOnline: false });
          scheduleReconnect();
        }
      });
    });
    const attempt = connected.catch((error: unknown) => {
      publish({ state: "offline", peerOnline: false, error: { code: "relay_connect_failed", message: error instanceof Error ? error.message : "Relay connection failed" } });
      scheduleReconnect();
      throw error;
    });
    connectPromise = attempt;
    try {
      await attempt;
    } finally {
      if (connectPromise === attempt) connectPromise = undefined;
    }
  }

  async function receiveMessage(message: RemoteRelayMessage): Promise<void> {
    if (message.content.type !== "command") {
      markReceived(message.messageId);
      return;
    }
    const inbox = input.store.beginInbox({
      messageId: message.messageId,
      commandId: message.content.command.commandId,
      receivedAt: now(),
    });
    let application: RemoteCommandApplication;
    if (inbox.state === "applied" && inbox.result !== undefined) {
      application = inbox.result as RemoteCommandApplication;
    } else {
      application = await input.commandHandler.apply(message.content.command);
      input.store.completeInbox(inbox.messageId, application, now());
    }
    queueApplication(application);
    if (application.watchRunId !== undefined) subscribeRun(application.watchRunId);
    flushOutbox();
    markReceived(message.messageId);
  }

  function queueApplication(application: RemoteCommandApplication): void {
    const events: readonly RemoteEvent[] = [application.result, ...application.snapshots];
    for (const event of events) {
      input.store.enqueueOutbox(`${application.result.commandId}:event:${event.eventId}`, { type: "event", event }, now());
    }
  }

  function subscribeRun(runId: string): void {
    if (runSubscriptions.has(runId)) return;
    const unsubscribe = input.commandHandler.watchRun(runId, (events) => {
      for (const event of events) {
        if (event.kind === "run.delta" && !status.peerOnline) continue;
        input.store.enqueueOutbox(event.eventId, { type: "event", event }, now());
        if (event.kind === "run.snapshot" && ["completed", "failed", "cancelled", "blocked"].includes(event.status)) {
          runSubscriptions.get(runId)?.();
          runSubscriptions.delete(runId);
        }
      }
      flushOutbox();
    }, (error) => publish({
      error: { code: "remote_run_watch_failed", message: error instanceof Error ? error.message : "Remote run watch failed" },
    }));
    runSubscriptions.set(runId, unsubscribe);
  }

  function flushOutbox(): void {
    if (socket?.readyState !== WebSocket.OPEN || status.state !== "connected") return;
    for (const item of input.store.pendingOutbox()) {
      if (item.content.type === "event" && isRemoteSyncSnapshot(item.content.event)) {
        const task = uploadSyncSnapshot(item.clientMessageId, item.content.event);
        syncUploadTasks.add(task);
        void task.finally(() => syncUploadTasks.delete(task));
        continue;
      }
      socket.send(JSON.stringify({
        protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
        type: "message.submit",
        clientMessageId: item.clientMessageId,
        content: item.content,
      }));
    }
  }

  async function uploadSyncSnapshot(
    clientMessageId: string,
    snapshot: RemoteSyncSnapshot,
  ): Promise<void> {
    if (syncUploads.has(clientMessageId)) return;
    syncUploads.add(clientMessageId);
    let uploaded = false;
    try {
      const binding = input.store.getBinding();
      const token = await input.credentials.readSecret(REMOTE_DEVICE_TOKEN_REF);
      if (binding === undefined || token === undefined) throw new Error("Remote device binding is unavailable");
      const response = await fetchJson(
        fetch,
        `${binding.relayUrl}/v1/sync/snapshots/${encodeURIComponent(snapshot.kind)}`,
        {
          method: "PUT",
          headers: { authorization: `Bearer ${token}` },
          body: JSON.stringify(snapshot),
        },
      );
      const document = syncDocumentReceiptSchema.parse(response.document);
      input.store.acceptOutbox(clientMessageId, now());
      uploaded = true;
      if (status.peerOnline) {
        const changed: RemoteEvent = {
          kind: "sync.changed",
          eventId: idFactory(),
          documentKind: document.kind,
          version: document.version,
          updatedAt: document.updatedAt,
        };
        input.store.enqueueOutbox(changed.eventId, { type: "event", event: changed }, now());
      }
    } catch (error) {
      publish({
        error: { code: "remote_sync_upload_failed", message: error instanceof Error ? error.message : "Remote sync upload failed" },
      });
    } finally {
      syncUploads.delete(clientMessageId);
      if (uploaded) flushOutbox();
    }
  }

  function markReceived(messageId: string): void {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
        type: "message.received",
        messageId,
      }));
    }
  }

  function scheduleReconnect(): void {
    if (released || manualDisconnect || reconnectTimer !== undefined) return;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(5, reconnectAttempts++));
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      void connect().catch(() => undefined);
    }, delay);
    reconnectTimer.unref?.();
  }

  function clearReconnectTimer(): void {
    if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }

  return {
    commands: {
      beginPairing,
      inspectPairing,
      confirmPairing,
      connect,
      disconnect(): void {
        manualDisconnect = true;
        clearReconnectTimer();
        socket?.close(1000, "desktop_disconnect");
        socket = undefined;
        publish({ state: input.store.getBinding() === undefined ? "unpaired" : "offline", peerOnline: false });
      },
      async forgetDevice(): Promise<void> {
        manualDisconnect = true;
        clearReconnectTimer();
        const binding = input.store.getBinding();
        const token = await input.credentials.readSecret(REMOTE_DEVICE_TOKEN_REF);
        try {
          if (binding !== undefined && token !== undefined) {
            await fetchJson(fetch, `${binding.relayUrl}/v1/devices/${encodeURIComponent(binding.deviceId)}/revoke`, {
              method: "POST",
              headers: { authorization: `Bearer ${token}` },
            });
          }
        } catch (error) {
          manualDisconnect = false;
          publish({ error: { code: "remote_revoke_failed", message: error instanceof Error ? error.message : "Remote device revocation failed" } });
          throw error;
        }
        socket?.close(1000, "desktop_forgot_device");
        socket = undefined;
        input.store.clearBinding();
        await input.credentials.deleteSecret(REMOTE_DEVICE_TOKEN_REF);
        publish({
          state: "unpaired",
          relayUrl: undefined,
          deviceId: undefined,
          peerDeviceId: undefined,
          peerDeviceName: undefined,
          pairingCode: undefined,
          pairingExpiresAt: undefined,
          peerOnline: false,
          error: undefined,
        });
      },
      queueEvent(event: RemoteEvent): void {
        input.store.enqueueOutbox(idFactory(), { type: "event", event }, now());
        flushOutbox();
      },
      async publishSnapshots(): Promise<void> {
        await publishSnapshots(status.peerOnline);
      },
      async publishRun(runId: string): Promise<void> {
        for (const event of await input.commandHandler.snapshotsForRun(runId)) {
          input.store.enqueueOutbox(event.eventId, { type: "event", event }, now());
        }
        subscribeRun(runId);
        flushOutbox();
      },
    },
    queries: {
      status: () => structuredClone(status),
    },
    events: {
      subscribe(listener: (next: RemoteDesktopConnectionStatus) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    async start(): Promise<void> {
      if (input.store.getBinding() !== undefined) await connect().catch(() => undefined);
    },
    async release(): Promise<void> {
      released = true;
      manualDisconnect = true;
      clearReconnectTimer();
      for (const unsubscribe of runSubscriptions.values()) unsubscribe();
      runSubscriptions.clear();
      await Promise.allSettled([...syncUploadTasks]);
      syncUploadTasks.clear();
      syncUploads.clear();
      socket?.close(1001, "feature_release");
      socket = undefined;
      listeners.clear();
    },
  };

  async function publishSnapshots(includeTransient: boolean): Promise<void> {
        const application = await input.commandHandler.apply({
          kind: "sync.snapshot.request",
          commandId: idFactory(),
        });
        for (const snapshot of application.snapshots) {
          if (!includeTransient && !isRemoteSyncSnapshot(snapshot)) continue;
          input.store.enqueueOutbox(idFactory(), { type: "event", event: snapshot }, now());
        }
        flushOutbox();
  }
}

export type RemoteCollaborationFeature = ReturnType<typeof createRemoteCollaborationFeature>;

function initialStatus(store: RemoteDesktopStore, defaultRelayUrl?: string): RemoteDesktopConnectionStatus {
  const binding = store.getBinding();
  if (binding !== undefined) return {
    state: "offline",
    relayUrl: binding.relayUrl,
    deviceId: binding.deviceId,
    peerDeviceId: binding.peerDeviceId,
    peerDeviceName: binding.peerDeviceName,
    peerOnline: false,
    ...(defaultRelayUrl === undefined ? {} : { suggestedRelayUrl: defaultRelayUrl }),
  };
  const pairing = store.getPairing();
  if (pairing !== undefined) return {
    state: "pairing",
    relayUrl: pairing.relayUrl,
    deviceId: pairing.deviceId,
    pairingCode: pairing.pairingCode,
    pairingExpiresAt: pairing.expiresAt,
    peerOnline: false,
    ...(defaultRelayUrl === undefined ? {} : { suggestedRelayUrl: defaultRelayUrl }),
  };
  return {
    state: "unpaired",
    peerOnline: false,
    ...(defaultRelayUrl === undefined ? {} : { suggestedRelayUrl: defaultRelayUrl }),
  };
}

async function fetchJson(
  fetch: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init.headers } });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    const error = typeof body.error === "object" && body.error !== null ? body.error as Record<string, unknown> : {};
    throw new Error(typeof error.message === "string" ? error.message : `Relay request failed with ${response.status}`);
  }
  return body;
}

function normalizeRelayUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Relay URL must use http or https");
  return url.toString().replace(/\/$/u, "");
}

function websocketUrl(relayUrl: string): string {
  const url = new URL(relayUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/u, "")}/v1/connect`;
  return url.toString();
}
