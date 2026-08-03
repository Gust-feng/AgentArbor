import path from "node:path";
import { fileURLToPath } from "node:url";

import { SqliteRuntimeDatabase } from "../adapters/runtime-storage/index.js";
import { createRemoteRelayStore, startRemoteRelayServer } from "./remote-collaboration/index.js";

const host = process.env.AGENTARBOR_RELAY_HOST ?? "127.0.0.1";
const port = parsePort(process.env.AGENTARBOR_RELAY_PORT ?? "4310");
const databasePath = path.resolve(process.env.AGENTARBOR_RELAY_DATABASE ?? path.join(".agentarbor-relay", "relay.sqlite"));
const database = new SqliteRuntimeDatabase(databasePath);
const staticRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "mobile-ui");
const relay = await startRemoteRelayServer({ store: createRemoteRelayStore({ database }), host, port, staticRoot });

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
