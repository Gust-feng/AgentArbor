import path from "node:path";
import { fileURLToPath } from "node:url";

import { SqliteRuntimeDatabase } from "../adapters/runtime-storage/sqlite-runtime-database.js";
import {
  DEFAULT_RELAY_ACCOUNT_QUOTA_BYTES,
  DEFAULT_RELAY_DOCUMENT_QUOTA_BYTES,
  createRemoteRelayStore,
} from "./remote-collaboration/relay-store.js";
import { startRemoteRelayServer } from "./remote-collaboration/relay-server.js";

const host = process.env.AGENTARBOR_RELAY_HOST ?? "127.0.0.1";
const port = parsePort(process.env.AGENTARBOR_RELAY_PORT ?? "4310");
const databasePath = path.resolve(process.env.AGENTARBOR_RELAY_DATABASE ?? path.join(".agentarbor-relay", "relay.sqlite"));
const accountQuotaBytes = parsePositiveInteger(
  process.env.AGENTARBOR_RELAY_ACCOUNT_QUOTA_BYTES ?? String(DEFAULT_RELAY_ACCOUNT_QUOTA_BYTES),
  "AGENTARBOR_RELAY_ACCOUNT_QUOTA_BYTES",
);
const documentQuotaBytes = parsePositiveInteger(
  process.env.AGENTARBOR_RELAY_DOCUMENT_QUOTA_BYTES ?? String(DEFAULT_RELAY_DOCUMENT_QUOTA_BYTES),
  "AGENTARBOR_RELAY_DOCUMENT_QUOTA_BYTES",
);
const invitationCodes = (process.env.AGENTARBOR_RELAY_INVITE_CODES ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value.length > 0);
const allowOpenSignup = parseBoolean(process.env.AGENTARBOR_RELAY_ALLOW_OPEN_SIGNUP ?? "false");
const database = new SqliteRuntimeDatabase(databasePath);
const staticRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "mobile-ui");
const relay = await startRemoteRelayServer({
  store: createRemoteRelayStore({
    database,
    accountQuotaBytes,
    documentQuotaBytes,
    invitationCodes,
    allowOpenSignup,
  }),
  host,
  port,
  staticRoot,
  maxSyncBodyBytes: documentQuotaBytes + 64 * 1_024,
});

console.log(`AgentArbor Remote Relay listening at ${relay.url}`);
console.log(`WebSocket endpoint: ${relay.websocketUrl}`);
console.log(`Database: ${databasePath}`);

let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await relay.close();
  database.close();
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
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`Invalid ${name}: ${value}`);
  return parsed;
}

function parseBoolean(value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Invalid boolean value: ${value}`);
}
