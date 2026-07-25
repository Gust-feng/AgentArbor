#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs as parseNodeArgs } from "node:util";
import { stopDevelopmentProcessTree } from "./panel-dev-process-tree.mjs";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_FRONTEND_PORT = 4305;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");

const args = parseCliArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const frontendPort = await resolvePort({
  host: args.host,
  preferredPort: args.port,
  exact: args.exactPort || args.portExplicit,
  label: "frontend",
});
const apiPort = await resolvePort({
  host: args.host,
  preferredPort: args.apiPort ?? frontendPort + 1,
  exact: args.exactPort || args.apiPortExplicit,
  label: "backend",
});

const tscBin = path.join(root, "node_modules", "typescript", "bin", "tsc");
const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
const electronBin = path.join(root, "node_modules", "electron", "cli.js");
const packageJson = path.join(root, "package.json");
const tsconfig = path.join(root, "tsconfig.json");
const copySubAgentsScript = path.join(root, "scripts", "copy-sub-agent-assets.mjs");
const panelEntry = path.join(root, "dist", "app", "panel.js");
const panelDesktopEntry = path.join(root, "dist", "app", "panel-desktop.js");

assertLocalFile(packageJson, "package.json");
assertLocalFile(tsconfig, "tsconfig.json");
assertLocalFile(copySubAgentsScript, "scripts/copy-sub-agent-assets.mjs");
assertLocalTool(tscBin, "typescript");
assertLocalTool(viteBin, "vite");
if (args.desktop) {
  assertLocalTool(electronBin, "electron");
}

runInitialNodeBuild();

console.log("AgentArbor panel dev server");
console.log(`  UI:  http://${args.host}:${frontendPort}/`);
console.log(`  API: http://${args.host}:${apiPort}/`);
if (args.desktop) {
  console.log("  Desktop: Electron will load the Vite UI after dev servers are ready.");
}

const childEnv = {
  ...process.env,
  AGENTARBOR_PANEL_API_HOST: args.host,
  AGENTARBOR_PANEL_API_PORT: String(apiPort),
};
const shouldStartPanelApi = !args.desktop || args.smoke;
const children = [];
pushChild(spawnLabeled("tsc-watch", process.execPath, [
    tscBin,
    "-p",
    tsconfig,
    "--watch",
    "--preserveWatchOutput",
    "false",
  ]));
if (shouldStartPanelApi) {
  pushChild(spawnLabeled("panel-api", process.execPath, [
      "--watch",
      panelEntry,
      "--host",
      args.host,
      "--port",
      String(apiPort),
      ...configDirectoryArgs(args.configDirectory),
    ], { env: childEnv }));
}
pushChild(spawnLabeled("vite", process.execPath, [
    viteBin,
    "--config",
    path.join(root, "vite.panel.config.ts"),
    "--host",
    args.host,
    "--port",
    String(frontendPort),
    "--strictPort",
  ], { env: childEnv }));

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void stopAll(0);
  });
}

if (args.smoke || args.desktop) {
  try {
    await waitForDevServers(args.host, frontendPort, apiPort, {
      waitForApi: shouldStartPanelApi,
      waitForProxy: shouldStartPanelApi,
    });
    if (args.smoke) {
      console.log("[dev] smoke check passed.");
      void stopAll(0);
    } else {
      pushChild(spawnLabeled("electron", process.execPath, [
        electronBin,
        panelDesktopEntry,
        "--host",
        args.host,
        "--port",
        String(apiPort),
        "--dev-url",
        `http://${args.host}:${frontendPort}/`,
        ...configDirectoryArgs(args.configDirectory),
      ], { env: childEnv }));
    }
  } catch (error) {
    console.error(`[dev] startup check failed: ${errorMessage(error)}`);
    void stopAll(1);
  }
}

function parseCliArgs(argv) {
  let parsed;
  try {
    parsed = parseNodeArgs({
      args: stripArgumentSeparator(argv),
      allowPositionals: false,
      options: {
        "host": { type: "string", default: DEFAULT_HOST },
        "port": { type: "string", default: String(DEFAULT_FRONTEND_PORT) },
        "api-port": { type: "string" },
        "backend-port": { type: "string" },
        "config-dir": { type: "string" },
        "desktop": { type: "boolean", default: false },
        "smoke": { type: "boolean", default: false },
        "exact-port": { type: "boolean", default: false },
        "help": { type: "boolean", short: "h", default: false },
      },
      strict: true,
      tokens: true,
    });
  } catch (error) {
    throw new Error(errorMessage(error).replace(/^Unknown option/, "Unknown panel dev argument"));
  }

  const portExplicit = hasOption(parsed.tokens, "port");
  const apiPortExplicit = hasOption(parsed.tokens, "api-port") || hasOption(parsed.tokens, "backend-port");
  const values = parsed.values;
  const host = values.host.trim();
  if (host.length === 0) {
    throw new Error("--host requires a value.");
  }

  return {
    host,
    port: parsePort(values.port, "--port"),
    apiPort: values["api-port"] === undefined && values["backend-port"] === undefined
      ? undefined
      : parsePort(values["api-port"] ?? values["backend-port"], values["api-port"] === undefined ? "--backend-port" : "--api-port"),
    configDirectory: values["config-dir"]?.trim(),
    portExplicit,
    apiPortExplicit,
    exactPort: values["exact-port"],
    desktop: values.desktop,
    help: values.help,
    smoke: values.smoke,
  };
}

function stripArgumentSeparator(argv) {
  const separatorIndex = argv.indexOf("--");
  if (separatorIndex < 0) {
    return argv;
  }
  return [
    ...argv.slice(0, separatorIndex),
    ...argv.slice(separatorIndex + 1),
  ];
}

function hasOption(tokens, name) {
  return tokens.some((token) => token.kind === "option" && token.name === name);
}

function parsePort(value, flag) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${flag} requires an integer between 1 and 65535.`);
  }
  return port;
}

async function resolvePort({ host, preferredPort, exact, label }) {
  for (let port = preferredPort; port <= Math.min(65535, preferredPort + 20); port += 1) {
    if (await canListen(host, port)) {
      if (port !== preferredPort) {
        console.warn(`[dev] ${label} port ${preferredPort} is busy; using ${port}.`);
      }
      return port;
    }
    if (exact) {
      throw new Error(`${label} port ${preferredPort} is already in use.`);
    }
  }
  throw new Error(`No available ${label} port found near ${preferredPort}.`);
}

function canListen(host, port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => {
      resolve(false);
    });
    server.listen({ host, port }, () => {
      server.close(() => {
        resolve(true);
      });
    });
  });
}

function assertLocalFile(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing ${label} at ${filePath}.`);
  }
}

function assertLocalTool(filePath, packageName) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing local ${packageName}. Run pnpm install first.`);
  }
}

function runInitialNodeBuild() {
  const result = spawnSync(process.execPath, [tscBin, "-p", tsconfig], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`Initial TypeScript build failed with code ${result.status ?? 1}.`);
  }
  const copyResult = spawnSync(process.execPath, [copySubAgentsScript], {
    cwd: root,
    stdio: "inherit",
  });
  if (copyResult.status !== 0) {
    throw new Error(`Initial sub-agent asset copy failed with code ${copyResult.status ?? 1}.`);
  }
  assertLocalFile(panelEntry, "dist/app/panel.js");
  if (args.desktop) {
    assertLocalFile(panelDesktopEntry, "dist/app/panel-desktop.js");
  }
}

function pushChild(child) {
  children.push(child);
  child.on("exit", (code, signal) => {
    if (stopping) {
      return;
    }
    const reason = signal === null ? `code ${code ?? 1}` : `signal ${signal}`;
    console.error(`[dev] ${child.label} exited with ${reason}.`);
    void stopAll(code ?? 1);
  });
}

function spawnLabeled(label, command, commandArgs, options = {}) {
  const child = spawn(command, commandArgs, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    ...options,
  });
  child.label = label;
  prefixStream(child.stdout, label, process.stdout);
  prefixStream(child.stderr, label, process.stderr);
  return child;
}

function prefixStream(stream, label, target) {
  let buffered = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffered += chunk;
    let newlineIndex = buffered.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffered.slice(0, newlineIndex).replace(/\r$/, "");
      buffered = buffered.slice(newlineIndex + 1);
      if (line.length > 0) {
        target.write(`[${label}] ${line}\n`);
      }
      newlineIndex = buffered.indexOf("\n");
    }
  });
  stream.on("end", () => {
    const line = buffered.trimEnd();
    if (line.length > 0) {
      target.write(`[${label}] ${line}\n`);
    }
  });
}

function configDirectoryArgs(configDirectory) {
  return configDirectory === undefined || configDirectory.length === 0 ? [] : ["--config-dir", configDirectory];
}

async function waitForHttp(label, url, predicate) {
  const deadline = Date.now() + 15_000;
  let lastError = "not ready";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      const body = await response.text();
      if (predicate(response, body)) {
        return;
      }
      lastError = `returned ${response.status}`;
    } catch (error) {
      lastError = errorMessage(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} at ${url} did not become ready: ${lastError}`);
}

async function waitForDevServers(host, frontendPort, apiPort, options = {}) {
  const { waitForApi = true, waitForProxy = true } = options;
  await waitForHttp("vite", `http://${host}:${frontendPort}/`, (response, body) => {
    return response.status === 200 && body.includes('<div id="root">') && body.includes("/src/main.tsx");
  });
  if (waitForApi) {
    await waitForHttp("panel-api", `http://${host}:${apiPort}/health`, (response, body) => {
      return response.status === 200 && body.includes('"ok":true');
    });
  }
  if (waitForProxy) {
    await waitForHttp("vite-proxy", `http://${host}:${frontendPort}/health`, (response, body) => {
      return response.status === 200 && body.includes('"ok":true');
    });
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function stopAll(exitCode) {
  if (stopping) {
    return;
  }
  stopping = true;
  await Promise.allSettled(children.map((child) => stopDevelopmentProcessTree(child)));
  // Windows can retain stdio handles for terminated watcher children. End the
  // supervisor explicitly so a dead dev session cannot look healthy.
  process.exit(exitCode);
}

function printHelp() {
  console.log(`Usage: pnpm panel:dev [-- --host 127.0.0.1 --port 4305 --api-port 4306 --config-dir <path> --desktop --smoke --exact-port]

Starts:
  - TypeScript compiler in watch mode
  - Panel API with node --watch
  - Vite panel UI with HMR and API proxy
  - Electron desktop shell when --desktop is provided
`);
}
