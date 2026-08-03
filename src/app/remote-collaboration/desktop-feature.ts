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
const accountSchema = z.object({
  accountId: z.string().min(1),
  handle: z.string().min(3),
  displayName: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict();
const activationSchema = z.object({
  account: accountSchema,
  deviceId: z.string().min(1),
  deviceName: z.string().min(1),
  role: z.literal("desktop"),
  accessToken: z.string().min(32),
}).strict();
const pairingClaimSchema = z.object({
  pairingId: z.string().min(1),
  pairingCode: z.string().regex(/^\d{6}$/u),
  expiresAt: z.string().min(1),
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

export type RemoteCredentialStore = {
  readSecret(secretRef: string): Promise<string | undefined>;
  writeSecret(secretRef: string, value: string): Promise<unknown>;
  deleteSecret(secretRef: string): Promise<unknown>;
};

export type RemoteDesktopConnectionStatus = {
  readonly state: "unregistered" | "pairing" | "connecting" | "connected" | "offline";
  readonly relayUrl?: string;
  readonly accountId?: string;
  readonly accountHandle?: string;
  readonly displayName?: string;
  readonly deviceId?: string;
  readonly deviceName?: string;
  readonly peerDeviceId?: string;
  readonly peerDeviceName?: string;
  readonly peerOnline: boolean;
  readonly suggestedRelayUrl?: string;
  readonly pairingCode?: string;
  readonly pairingExpiresAt?: string;
  readonly pairingStatus?: z.infer<typeof pairingStatusSchema>["status"];
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
  const runSubscriptions = new Map<string, () => void>();
  let socket: WebSocket | undefined;
  let released = false;
  let manualDisconnect = false;
  let reconnectAttempts = 0;
  let reconnectTimer: NodeJS.Timeout | undefined;
  let connectPromise: Promise<void> | undefined;
  let status = initialStatus(input.store, input.defaultRelayUrl);

  function publish(patch: Partial<RemoteDesktopConnectionStatus>): void {
    status = { ...status, ...patch };
    for (const listener of listeners) {
      try { listener(structuredClone(status)); } catch { /* Status observers cannot affect transport. */ }
    }
  }

  async function activateAccount(relayUrl: string, deviceName: string, invitationCode?: string) {
    if (input.store.getBinding() !== undefined) throw new Error("This desktop already has a remote account");
    const normalizedRelayUrl = normalizeRelayUrl(relayUrl);
    const response = await fetchJson(fetch, `${normalizedRelayUrl}/v1/accounts/activate`, {
      method: "POST",
      body: JSON.stringify({ deviceName, ...(invitationCode === undefined ? {} : { invitationCode }) }),
    });
    const credential = activationSchema.parse(response.credential);
    await input.credentials.writeSecret(REMOTE_DEVICE_TOKEN_REF, credential.accessToken);
    try {
      input.store.saveBinding({
        relayUrl: normalizedRelayUrl,
        accountId: credential.account.accountId,
        accountHandle: credential.account.handle,
        displayName: credential.account.displayName,
        deviceId: credential.deviceId,
        deviceName: credential.deviceName,
        updatedAt: now(),
      });
    } catch (error) {
      await input.credentials.deleteSecret(REMOTE_DEVICE_TOKEN_REF).catch(() => undefined);
      throw error;
    }
    publish({
      state: "offline",
      relayUrl: normalizedRelayUrl,
      accountId: credential.account.accountId,
      accountHandle: credential.account.handle,
      displayName: credential.account.displayName,
      deviceId: credential.deviceId,
      deviceName: credential.deviceName,
      peerOnline: false,
      error: undefined,
    });
    return credential;
  }

  async function beginPairing() {
    const { binding, token } = await requireCredential(input.store, input.credentials);
    const response = await fetchJson(fetch, `${binding.relayUrl}/v1/pairings`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    const pairing = pairingClaimSchema.parse(response.pairing);
    const saved = { ...pairing, relayUrl: binding.relayUrl, updatedAt: now() };
    input.store.savePairing(saved);
    publish({
      state: "pairing",
      pairingCode: pairing.pairingCode,
      pairingExpiresAt: pairing.expiresAt,
      pairingStatus: "waiting_for_mobile",
      error: undefined,
    });
    return saved;
  }

  async function inspectPairing() {
    const pairing = input.store.getPairing();
    if (pairing === undefined) throw new Error("No phone pairing is in progress");
    const token = await requireToken(input.credentials);
    const response = await fetchJson(fetch, `${pairing.relayUrl}/v1/pairings/${encodeURIComponent(pairing.pairingId)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    });
    const remoteStatus = pairingStatusSchema.parse(response.pairing);
    publish({
      pairingStatus: remoteStatus.status,
      ...(remoteStatus.mobile === undefined ? {} : {
        peerDeviceId: remoteStatus.mobile.deviceId,
        peerDeviceName: remoteStatus.mobile.deviceName,
      }),
    });
    return remoteStatus;
  }

  async function approvePairing() {
    const pairing = input.store.getPairing();
    if (pairing === undefined) throw new Error("No phone pairing is in progress");
    const token = await requireToken(input.credentials);
    const response = await fetchJson(fetch, `${pairing.relayUrl}/v1/pairings/${encodeURIComponent(pairing.pairingId)}/approve`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ pairingCode: pairing.pairingCode }),
    });
    const remoteStatus = pairingStatusSchema.parse(response.pairing);
    if (remoteStatus.status !== "paired" || remoteStatus.mobile === undefined) return remoteStatus;
    const binding = input.store.getBinding();
    if (binding === undefined) throw new Error("The desktop account binding is unavailable");
    input.store.saveBinding({
      ...binding,
      accountHandle: remoteStatus.account.handle,
      displayName: remoteStatus.account.displayName,
      peerDeviceId: remoteStatus.mobile.deviceId,
      peerDeviceName: remoteStatus.mobile.deviceName,
      updatedAt: now(),
    });
    input.store.clearPairing();
    publish({
      state: socket?.readyState === WebSocket.OPEN ? "connected" : "offline",
      accountHandle: remoteStatus.account.handle,
      displayName: remoteStatus.account.displayName,
      peerDeviceId: remoteStatus.mobile.deviceId,
      peerDeviceName: remoteStatus.mobile.deviceName,
      pairingCode: undefined,
      pairingExpiresAt: undefined,
      pairingStatus: undefined,
      error: undefined,
    });
    return remoteStatus;
  }

  async function updateAccountHandle(handle: string) {
    const { binding, token } = await requireCredential(input.store, input.credentials);
    const response = await fetchJson(fetch, `${binding.relayUrl}/v1/account/handle`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ handle }),
    });
    const account = accountSchema.parse(response.account);
    input.store.saveBinding({ ...binding, accountHandle: account.handle, displayName: account.displayName, updatedAt: now() });
    publish({ accountHandle: account.handle, displayName: account.displayName, error: undefined });
    return account;
  }

  async function connect(): Promise<void> {
    if (released) throw new Error("Remote Collaboration feature is released");
    if (socket?.readyState === WebSocket.OPEN) return;
    if (connectPromise !== undefined) return connectPromise;
    const binding = input.store.getBinding();
    const token = await input.credentials.readSecret(REMOTE_DEVICE_TOKEN_REF);
    if (binding === undefined || token === undefined) {
      publish({ state: "unregistered" });
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
      next.on("open", () => next.send(JSON.stringify({
        protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
        type: "client.hello",
        token,
      })));
      next.on("message", (raw) => {
        void (async () => {
          const frame = remoteServerFrameSchema.parse(JSON.parse(raw.toString()) as unknown);
          if (frame.type === "server.ready") {
            ready = true;
            clearTimeout(timeout);
            reconnectAttempts = 0;
            input.store.saveBinding({
              ...binding,
              ...(frame.peerDeviceId === undefined ? {} : { peerDeviceId: frame.peerDeviceId }),
              ...(frame.peerDeviceName === undefined ? {} : { peerDeviceName: frame.peerDeviceName }),
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
            if (frame.peerOnline) void publishSnapshots().catch(publishSnapshotError);
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
              void publishSnapshots().catch(publishSnapshotError);
            }
            return;
          }
          if (frame.type === "message.deliver") {
            await receiveMessage(frame.message);
            return;
          }
          if (frame.type === "server.error") publish({ error: { code: frame.code, message: frame.message } });
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
    const application = inbox.state === "applied" && inbox.result !== undefined
      ? inbox.result as RemoteCommandApplication
      : await input.commandHandler.apply(message.content.command);
    if (inbox.state !== "applied") input.store.completeInbox(inbox.messageId, application, now());
    queueApplication(application);
    if (application.watchRunId !== undefined) subscribeRun(application.watchRunId);
    flushOutbox();
    markReceived(message.messageId);
  }

  function queueApplication(application: RemoteCommandApplication): void {
    for (const event of [application.result, ...application.snapshots]) {
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
    if (socket?.readyState !== WebSocket.OPEN || status.state !== "connected" || !status.peerOnline) return;
    for (const item of input.store.pendingOutbox()) socket.send(JSON.stringify({
      protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
      type: "message.submit",
      clientMessageId: item.clientMessageId,
      content: item.content,
    }));
  }

  function markReceived(messageId: string): void {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({
      protocolVersion: REMOTE_COLLABORATION_PROTOCOL_VERSION,
      type: "message.received",
      messageId,
    }));
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

  function publishSnapshotError(error: unknown): void {
    publish({ error: { code: "remote_snapshot_failed", message: error instanceof Error ? error.message : "Remote snapshot failed" } });
  }

  async function publishSnapshots(): Promise<void> {
    if (!status.peerOnline) return;
    const application = await input.commandHandler.apply({ kind: "sync.snapshot.request", commandId: idFactory() });
    for (const snapshot of application.snapshots) {
      input.store.enqueueOutbox(snapshot.eventId, { type: "event", event: snapshot }, now());
    }
    flushOutbox();
  }

  return {
    commands: {
      activateAccount,
      beginPairing,
      inspectPairing,
      approvePairing,
      updateAccountHandle,
      connect,
      disconnect(): void {
        manualDisconnect = true;
        clearReconnectTimer();
        socket?.close(1000, "desktop_disconnect");
        socket = undefined;
        publish({ state: input.store.getBinding() === undefined ? "unregistered" : "offline", peerOnline: false });
      },
      async revokePeerDevice(): Promise<void> {
        const { binding, token } = await requireCredential(input.store, input.credentials);
        if (binding.peerDeviceId === undefined) return;
        await fetchJson(fetch, `${binding.relayUrl}/v1/devices/${encodeURIComponent(binding.peerDeviceId)}/revoke`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
        });
        input.store.saveBinding({
          ...binding,
          peerDeviceId: undefined,
          peerDeviceName: undefined,
          updatedAt: now(),
        });
        input.store.clearPairing();
        publish({ peerDeviceId: undefined, peerDeviceName: undefined, peerOnline: false, error: undefined });
      },
      async forgetAccount(): Promise<void> {
        manualDisconnect = true;
        clearReconnectTimer();
        const binding = input.store.getBinding();
        const token = await input.credentials.readSecret(REMOTE_DEVICE_TOKEN_REF);
        if (binding !== undefined && token !== undefined) {
          await fetchJson(fetch, `${binding.relayUrl}/v1/devices/${encodeURIComponent(binding.deviceId)}/revoke`, {
            method: "POST",
            headers: { authorization: `Bearer ${token}` },
          });
        }
        socket?.close(1000, "desktop_account_removed");
        socket = undefined;
        input.store.clearBinding();
        await input.credentials.deleteSecret(REMOTE_DEVICE_TOKEN_REF);
        publish({
          state: "unregistered",
          relayUrl: undefined,
          accountId: undefined,
          accountHandle: undefined,
          displayName: undefined,
          deviceId: undefined,
          deviceName: undefined,
          peerDeviceId: undefined,
          peerDeviceName: undefined,
          pairingCode: undefined,
          pairingExpiresAt: undefined,
          pairingStatus: undefined,
          peerOnline: false,
          error: undefined,
        });
      },
      queueEvent(event: RemoteEvent): void {
        if (!status.peerOnline) return;
        input.store.enqueueOutbox(idFactory(), { type: "event", event }, now());
        flushOutbox();
      },
      publishSnapshots,
      async publishRun(runId: string): Promise<void> {
        if (!status.peerOnline) return;
        for (const event of await input.commandHandler.snapshotsForRun(runId)) {
          input.store.enqueueOutbox(event.eventId, { type: "event", event }, now());
        }
        subscribeRun(runId);
        flushOutbox();
      },
    },
    queries: { status: () => structuredClone(status) },
    events: {
      subscribe(listener: (next: RemoteDesktopConnectionStatus) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    async start(): Promise<void> {
      // Desktop activation persists, but each application start requires an explicit user connection action.
    },
    async release(): Promise<void> {
      released = true;
      manualDisconnect = true;
      clearReconnectTimer();
      for (const unsubscribe of runSubscriptions.values()) unsubscribe();
      runSubscriptions.clear();
      socket?.close(1001, "feature_release");
      socket = undefined;
      listeners.clear();
    },
  };
}

export type RemoteCollaborationFeature = ReturnType<typeof createRemoteCollaborationFeature>;

function initialStatus(store: RemoteDesktopStore, defaultRelayUrl?: string): RemoteDesktopConnectionStatus {
  const binding = store.getBinding();
  if (binding === undefined) return {
    state: "unregistered",
    peerOnline: false,
    ...(defaultRelayUrl === undefined ? {} : { suggestedRelayUrl: defaultRelayUrl }),
  };
  const pairing = store.getPairing();
  return {
    state: pairing === undefined ? "offline" : "pairing",
    relayUrl: binding.relayUrl,
    accountId: binding.accountId,
    accountHandle: binding.accountHandle,
    displayName: binding.displayName,
    deviceId: binding.deviceId,
    deviceName: binding.deviceName,
    peerDeviceId: binding.peerDeviceId,
    peerDeviceName: binding.peerDeviceName,
    peerOnline: false,
    ...(pairing === undefined ? {} : {
      pairingCode: pairing.pairingCode,
      pairingExpiresAt: pairing.expiresAt,
      pairingStatus: "waiting_for_mobile" as const,
    }),
    ...(defaultRelayUrl === undefined ? {} : { suggestedRelayUrl: defaultRelayUrl }),
  };
}

async function requireCredential(store: RemoteDesktopStore, credentials: RemoteCredentialStore) {
  const binding = store.getBinding();
  if (binding === undefined) throw new Error("The desktop remote account is not activated");
  return { binding, token: await requireToken(credentials) };
}

async function requireToken(credentials: RemoteCredentialStore): Promise<string> {
  const token = await credentials.readSecret(REMOTE_DEVICE_TOKEN_REF);
  if (token === undefined) throw new Error("The desktop remote credential is missing; a new invitation is required");
  return token;
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
