import { startLocalPanelServer } from "./panel-server.js";

await main();

async function main(): Promise<void> {
  const args = parsePanelArgs(process.argv.slice(2));
  const server = await startLocalPanelServer({
    host: args.host,
    port: args.port,
    configDirectory: args.configDirectory,
  });

  console.log(`AgentArbor 本地面板：${server.url}`);
  if (server.configDirectory !== undefined) {
    console.log(`配置目录：${server.configDirectory}`);
  }

  if (args.smoke) {
    await server.close();
    return;
  }

  process.on("SIGINT", () => {
    server
      .close()
      .then(() => {
        process.exit(0);
      })
      .catch(() => {
        process.exit(1);
      });
  });
}

function parsePanelArgs(argv: readonly string[]): {
  readonly host: string;
  readonly port: number;
  readonly configDirectory?: string;
  readonly smoke: boolean;
} {
  let host = "127.0.0.1";
  let port = 9090;
  let configDirectory: string | undefined;
  let smoke = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--smoke") {
      smoke = true;
      continue;
    }
    if (arg === "--host") {
      host = requireNext(argv, index, "--host");
      index += 1;
      continue;
    }
    if (arg.startsWith("--host=")) {
      host = requireValue(arg.slice("--host=".length), "--host");
      continue;
    }
    if (arg === "--port") {
      port = parsePort(requireNext(argv, index, "--port"));
      index += 1;
      continue;
    }
    if (arg.startsWith("--port=")) {
      port = parsePort(requireValue(arg.slice("--port=".length), "--port"));
      continue;
    }
    if (arg === "--config-dir") {
      configDirectory = requireNext(argv, index, "--config-dir");
      index += 1;
      continue;
    }
    if (arg.startsWith("--config-dir=")) {
      configDirectory = requireValue(arg.slice("--config-dir=".length), "--config-dir");
      continue;
    }
    throw new Error(`Unknown panel argument: ${arg}`);
  }

  return { host, port, configDirectory, smoke };
}

function requireNext(argv: readonly string[], index: number, flag: string): string {
  return requireValue(argv[index + 1], flag);
}

function requireValue(value: string | undefined, flag: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${flag} requires a value.`);
  }
  return value.trim();
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("--port requires an integer between 0 and 65535.");
  }
  return port;
}
