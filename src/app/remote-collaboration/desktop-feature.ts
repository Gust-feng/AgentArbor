import { randomUUID } from "node:crypto";

import { WebSocket } from "ws";
import { z } from "zod";

import {
  REMOTE_COLLABORATION_PROTOCOL_VERSION,
  remoteServerFrameSchema,
  type RemoteEvent,
  type RemoteRelayMessage,
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
  readonly pairingCode?: string;
  readonly pairingExpiresAt?: string;
  readonly lastInboxSequence: number;
  readonly error?: { readonly code: string; readonly message: string };
};

export function createRemoteCollaborationFeature(input: {
  readonly store: RemoteDesktopStore;
  readonly credentials: RemoteCredentialStore;
  readonly commandHandler: { apply(command: import("./protocol.js").RemoteCommand): Promise<RemoteCommandApplication> };
  readonly fetch?: typeof globalThis.fetch;
  readonly idFactory?: () => string;
  readonly now?: () => string;
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
  let status = initialStatus(input.store);

  function publish(patch: Partial<RemoteDesktopConnectionStatus>): void {
    status = { ...status, ...patch };
    for (const listener of listeners) {
      try { listener(structuredClone(status)); } catch { /* Status observers cannot affect transport. */ }
    }
  }

  async function beginPairing(relayUrl: string, deviceName: string) {
    const normalizedRelayUrl = normalizeRelayUrl(relayUrl);
    const response = await fetchJson(fetch, `${normalizedRelayUrl}/v1/pairings`, {
      method: "POST",
      body: JSON.stringify({ deviceName }),
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
      lastInboxSequence: 0,
      updatedAt: now(),
    });
    input.store.clearPairing();
    publish({
      state: "offline",
      relayUrl: pairing.relayUrl,
      deviceId: device.deviceId,
      peerDeviceId: remoteStatus.peer.deviceId,
      peerDeviceName: remoteStatus.peer.deviceName,
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
          cursor: binding.lastInboxSequence,
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
              lastInboxSequence: Math.max(binding.lastInboxSequence, frame.cursor),
              updatedAt: now(),
            });
            publish({
              state: "connected",
              peerDeviceId: frame.peerDeviceId,
              peerDeviceName: frame.peerDeviceName,
              lastInboxSequence: Math.max(binding.lastInboxSequence, frame.cursor),
              error: undefined,
            });
            flushOutbox();
            resolve();
            return;
          }
          if (frame.type === "message.accepted") {
            input.store.acceptOutbox(frame.clientMessageId, now());
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
          publish({ state: "offline" });
          scheduleReconnect();
        }
      });
    });
    const attempt = connected.catch((error: unknown) => {
      publish({ state: "offline", error: { code: "relay_connect_failed", message: error instanceof Error ? error.message : "Relay connection failed" } });
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
      acknowledge(message.sequence);
      return;
    }
    const inbox = input.store.beginInbox({
      messageId: message.messageId,
      commandId: message.content.command.commandId,
      sequence: message.sequence,
      receivedAt: now(),
    });
    let application: RemoteCommandApplication;
    if (inbox.state === "applied" && inbox.result !== undefined) {
      application = inbox.result as RemoteCommandApplication;
    } else {
      application = await input.commandHandler.apply(message.content.command);
      input.store.completeInbox(message.messageId, application, now());
    }
    queueApplication(message.messageId, application);
    flushOutbox();
    acknowledge(message.sequence);
  }

  function queueApplication(messageId: string, application: RemoteCommandApplication): void {
    const events: readonly RemoteEvent[] = [application.result, ...application.snapshots];
    for (const [index, event] of events.entries()) {
      input.store.enqueueOutbox(`${messageId}:event:${index}`, { type: "event", event }, now());
    }
  }

  function flushOutbox(): void {
    if (socket?.readyState !== WebSocket.OPEN || status.state !== "connected") return;
    for (const item of input.store.pendingOutbox()) {
      socket.send(JSON.stringify({
        protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
        type: "message.submit",
        clientMessageId: item.clientMessageId,
        content: item.content,
      }));
    }
  }

  function acknowledge(sequence: number): void {
    const binding = input.store.getBinding();
    publish({ lastInboxSequence: Math.max(status.lastInboxSequence, sequence) });
    if (binding !== undefined && sequence > binding.lastInboxSequence) {
      input.store.saveBinding({ ...binding, lastInboxSequence: sequence, updatedAt: now() });
    }
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
        type: "message.ack",
        sequence,
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
        publish({ state: input.store.getBinding() === undefined ? "unpaired" : "offline" });
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
          lastInboxSequence: 0,
          error: undefined,
        });
      },
      queueEvent(event: RemoteEvent): void {
        input.store.enqueueOutbox(idFactory(), { type: "event", event }, now());
        flushOutbox();
      },
      async publishSnapshots(): Promise<void> {
        const application = await input.commandHandler.apply({
          kind: "sync.snapshot.request",
          commandId: idFactory(),
        });
        for (const snapshot of application.snapshots) {
          input.store.enqueueOutbox(idFactory(), { type: "event", event: snapshot }, now());
        }
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
      socket?.close(1001, "feature_release");
      socket = undefined;
      listeners.clear();
    },
  };
}

export type RemoteCollaborationFeature = ReturnType<typeof createRemoteCollaborationFeature>;

function initialStatus(store: RemoteDesktopStore): RemoteDesktopConnectionStatus {
  const binding = store.getBinding();
  if (binding !== undefined) return {
    state: "offline",
    relayUrl: binding.relayUrl,
    deviceId: binding.deviceId,
    peerDeviceId: binding.peerDeviceId,
    peerDeviceName: binding.peerDeviceName,
    lastInboxSequence: binding.lastInboxSequence,
  };
  const pairing = store.getPairing();
  if (pairing !== undefined) return {
    state: "pairing",
    relayUrl: pairing.relayUrl,
    deviceId: pairing.deviceId,
    pairingCode: pairing.pairingCode,
    pairingExpiresAt: pairing.expiresAt,
    lastInboxSequence: 0,
  };
  return { state: "unpaired", lastInboxSequence: 0 };
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
