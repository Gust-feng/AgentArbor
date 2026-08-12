import assert from "node:assert/strict";
import test from "node:test";

import {
  bindRemoteAccountContentVaultSync,
  type RemoteAccountConnectionStatus,
} from "./remote-content-vault-lifecycle.js";

test("Content Vault stays active while Relay disconnects and clears state only when the account is removed", async () => {
  const listeners = new Set<(status: RemoteAccountConnectionStatus) => void>();
  let starts = 0;
  let stops = 0;
  const cleared: string[] = [];
  const unsubscribe = bindRemoteAccountContentVaultSync({
    initialStatus: { state: "offline", accountId: "account-1" },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    sync: {
      start() { starts += 1; },
      async stop() { stops += 1; },
      async clearAccount(accountId) { cleared.push(accountId); },
    },
  });

  assert.equal(starts, 1);
  emit(listeners, { state: "connecting", accountId: "account-1" });
  emit(listeners, { state: "connected", accountId: "account-1" });
  emit(listeners, { state: "offline", accountId: "account-1" });
  assert.equal(starts, 1);
  assert.equal(stops, 0);

  emit(listeners, { state: "unregistered" });
  await Promise.resolve();
  assert.deepEqual(cleared, ["account-1"]);
  assert.equal(stops, 0);

  emit(listeners, { state: "offline", accountId: "account-2" });
  assert.equal(starts, 2);
  unsubscribe();
  emit(listeners, { state: "unregistered" });
  assert.deepEqual(cleared, ["account-1"]);
});

function emit(
  listeners: ReadonlySet<(status: RemoteAccountConnectionStatus) => void>,
  status: RemoteAccountConnectionStatus,
): void {
  for (const listener of listeners) listener(status);
}
