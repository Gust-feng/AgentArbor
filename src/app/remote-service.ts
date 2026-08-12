import path from "node:path";

import { SqliteRuntimeDatabase } from "../adapters/runtime-storage/sqlite-runtime-database.js";
import { createContentVaultHttpHandler, createSqliteContentVaultRepository } from "./content-vault/index.js";
import { createRemoteRelayStore } from "./remote-collaboration/relay-store.js";
import { startRemoteRelayServer } from "./remote-collaboration/relay-server.js";

const host = process.env.AGENTARBOR_RELAY_HOST ?? "127.0.0.1";
const port = parsePort(process.env.AGENTARBOR_RELAY_PORT ?? "4310");
const relayDatabasePath = path.resolve(process.env.AGENTARBOR_RELAY_DATABASE ?? path.join(".agentarbor-relay", "relay.sqlite"));
const vaultDatabasePath = path.resolve(process.env.AGENTARBOR_VAULT_DATABASE ?? path.join(".agentarbor-relay", "vault.sqlite"));
const invitationCodes = (process.env.AGENTARBOR_RELAY_INVITE_CODES ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value.length > 0);
const allowOpenSignup = parseBoolean(process.env.AGENTARBOR_RELAY_ALLOW_OPEN_SIGNUP ?? "true");
const accountBytes = parsePositiveInteger(process.env.AGENTARBOR_VAULT_ACCOUNT_BYTES ?? String(150 * 1_024 * 1_024), "AGENTARBOR_VAULT_ACCOUNT_BYTES");
const maxResources = parsePositiveInteger(process.env.AGENTARBOR_VAULT_MAX_RESOURCES ?? "50000", "AGENTARBOR_VAULT_MAX_RESOURCES");

const relayDatabase = new SqliteRuntimeDatabase(relayDatabasePath);
const vaultDatabase = new SqliteRuntimeDatabase(vaultDatabasePath);
const relayStore = createRemoteRelayStore({
  database: relayDatabase,
  invitationCodes,
  allowOpenSignup,
});
const vaultRepository = createSqliteContentVaultRepository({ database: vaultDatabase, accountBytes, maxResources });
const vault = createContentVaultHttpHandler({
  repository: vaultRepository,
  authenticate(accessToken) {
    const auth = relayStore.authenticate(accessToken);
    return { accountId: auth.account.accountId, deviceId: auth.deviceId };
  },
});
const service = await startRemoteRelayServer({ store: relayStore, contentVault: vault, host, port });

console.log(`AgentArbor Remote Service listening at ${service.url}`);
console.log(`WebSocket endpoint: ${service.websocketUrl}`);
console.log(`Relay database: ${relayDatabasePath}`);
console.log(`Content Vault database: ${vaultDatabasePath}`);

let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await service.close();
  vaultDatabase.close();
  relayDatabase.close();
};
process.once("SIGINT", () => void close().then(() => process.exit(0)));
process.once("SIGTERM", () => void close().then(() => process.exit(0)));

function parsePort(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) throw new Error(`Invalid relay port: ${value}`);
  return parsed;
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive safe integer`);
  return parsed;
}

function parseBoolean(value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Invalid boolean value: ${value}`);
}
