import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { createServer as createNetServer, type Server as NetServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import type { BasicAgentRunExecutionInput, BasicAgentRunExecutionResult } from "../basic-agent-runtime/index.js";
import type { PanelRunJob } from "../panel-run-jobs.js";
import { closePanelServer } from "../panel-server/request-handler.js";
import { createPanelRuntime, type PanelRuntime } from "../panel-server/runtime.js";
import { createLocalShellCommandTool } from "../tool-center/adapters/local-workspace-command-tools.js";
import { ensurePidExited } from "../tool-center/adapters/background-process-test-utils.js";
import {
  createPlatformProcessTerminator,
  InMemoryProcessRegistry,
  waitForLocalPort,
} from "./index.js";

const context = {
  callerAgentId: "agent-runtime-guard-e2e",
  traceId: "trace-runtime-guard-e2e",
  goalId: "goal-runtime-guard-e2e",
};

test("runtime guard starts a background dev server, records waitForPort, and cleans it by run", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-runtime-guard-e2e-"));
  const runId = "run-runtime-guard-e2e-cleanup";
  let ownedPid: number | undefined;
  try {
    const port = await unusedLocalPort();
    const registry = new InMemoryProcessRegistry();
    const shellCommand = createLocalShellCommandTool(root, { processRegistry: registry });
    const output = await shellCommand.execute(
      {
        command: process.execPath,
        args: ["-e", nodeHttpServerScript(port, "owned-dev-server-ready")],
        background: true,
        backgroundWaitMs: 50,
        waitForPort: port,
        waitForPortTimeoutMs: 4_000,
      },
      toolContext(runId, "tool-call-runtime-guard-start")
    );
    const result = asRecord(asRecord(output).result);
    ownedPid = numberField(result.pid);

    assert.equal(result.exitCode, 0);
    assert.equal(result.background, true);
    assert.equal(result.waitForPort, port);
    assert.equal(result.portReady, true);
    assert.equal(typeof result.logRef, "string");
    assert.equal(typeof ownedPid, "number");

    const record = onlyRecord(registry.listByRun(runId));
    assert.equal(record.pid, ownedPid);
    assert.equal(record.kind, "background");
    assert.equal(record.owned, true);
    assert.equal(record.status, "running");
    assert.equal(record.logRef, result.logRef);
    assert.equal(record.commandLine.includes(process.execPath), true);
    assert.equal(record.ports.length, 1);
    assert.equal(record.ports[0]?.port, port);
    assert.equal(record.ports[0]?.ready, true);
    assert.equal(record.ports[0]?.status, "ready");

    const cleanup = await registry.cleanupByRun(runId, createPlatformProcessTerminator());

    assert.deepEqual(cleanup.skipped, []);
    assert.equal(cleanup.attempted.length, 1);
    assert.equal(cleanup.attempted[0]?.processId, record.processId);
    assert.match(cleanup.attempted[0]?.outcome ?? "", /^(killed|already-exited|unknown)$/);
    assert.notEqual(registry.get(record.processId)?.status, "running");
    assert.equal(await waitForPidExit(ownedPid, 5_000), true);

    const portAfterCleanup = await waitForLocalPort({
      port,
      host: "127.0.0.1",
      timeoutMs: 350,
      probeTimeoutMs: 100,
      pollIntervalMs: 50,
    });
    assert.equal(portAfterCleanup.ready, false);
  } finally {
    await ensurePidExited(ownedPid, 2_000);
    await removeTempTree(root);
  }
});

test("shell_command reports an external occupied port as notStarted without spawning a duplicate process", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-runtime-guard-e2e-"));
  const server = createNetServer();
  try {
    const port = await listenOnUnusedLocalPort(server);
    const registry = new InMemoryProcessRegistry();
    const shellCommand = createLocalShellCommandTool(root, { processRegistry: registry });
    const markerPath = path.join(root, "duplicate-started.txt");
    const output = await shellCommand.execute(
      {
        command: process.execPath,
        args: [
          "-e",
          [
            `require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'started');`,
            "const net=require('node:net');",
            "const server=net.createServer();",
            "server.on('error', () => process.exit(31));",
            `server.listen(${port}, '127.0.0.1');`,
            "setInterval(() => {}, 1000);",
          ].join(""),
        ],
        background: true,
        backgroundWaitMs: 500,
        waitForPort: port,
        waitForPortTimeoutMs: 1_000,
      },
      toolContext("run-runtime-guard-e2e-occupied", "tool-call-duplicate-start")
    );
    const result = asRecord(asRecord(output).result);
    const occupancy = asRecord(result.preStartPortOccupancy);

    assert.equal(result.notStarted, true);
    assert.equal(result.exitCode, null);
    assert.equal(result.background, undefined);
    assert.equal(result.pid, undefined);
    assert.equal(result.logRef, undefined);
    assert.equal(result.waitForPort, port);
    assert.equal(result.portReady, false);
    assert.equal(occupancy.kind, "pre_start_port_occupancy");
    assert.equal(occupancy.port, port);
    assert.equal(occupancy.host, "127.0.0.1");
    assert.equal(occupancy.occupied, true);
    assert.equal(occupancy.owner, "unknown");
    assert.equal(occupancy.ownerUnknown, true);
    assert.match(String(occupancy.source), /^(connect_probe|netstat|lsof|ss|platform_probe)$/);
    assert.deepEqual(registry.listAll(), []);
    assert.equal(server.listening, true);
    await assert.rejects(() => readFile(markerPath, "utf8"));
  } finally {
    await closeNetServer(server);
    await removeTempTree(root);
  }
});

test("panel server close cleans owned background processes and leaves unowned external processes running", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-runtime-guard-e2e-"));
  const runtime = createPanelRuntime({}, panelRuntimeHooks());
  const panelServer = createHttpServer((_request, response) => {
    response.end("ok");
  });
  let ownedPid: number | undefined;
  let externalChild: ChildProcess | undefined;
  try {
    const ownedPort = await unusedLocalPort();
    const externalPort = await unusedLocalPort();
    const shellCommand = createLocalShellCommandTool(root, { processRegistry: runtime.processRegistry });
    const output = await shellCommand.execute(
      {
        command: process.execPath,
        args: ["-e", nodeHttpServerScript(ownedPort, "panel-owned-dev-server-ready")],
        background: true,
        backgroundWaitMs: 50,
        waitForPort: ownedPort,
        waitForPortTimeoutMs: 4_000,
      },
      toolContext("run-panel-close-owned", "tool-call-panel-owned")
    );
    const result = asRecord(asRecord(output).result);
    ownedPid = numberField(result.pid);
    assert.equal(result.portReady, true);
    assert.equal(typeof ownedPid, "number");

    externalChild = await startExternalNodeServer(externalPort);
    assert.equal(typeof externalChild.pid, "number");
    runtime.processRegistry.register({
      processId: "external-dev-server",
      runId: "run-panel-close-external",
      toolCallId: "tool-call-external",
      pid: externalChild.pid,
      kind: "background",
      owned: false,
      commandLine: "external node dev server",
      cwd: root,
      startedAt: new Date().toISOString(),
      status: "running",
      ports: [{
        port: externalPort,
        host: "127.0.0.1",
        requestedAt: new Date().toISOString(),
        checkedAt: new Date().toISOString(),
        status: "ready",
        ready: true,
      }],
    });
    await listenHttpServer(panelServer);

    await closePanelServer(panelServer, runtime);

    const ownedRecord = onlyRecord(runtime.processRegistry.listByRun("run-panel-close-owned"));
    assert.match(ownedRecord.status, /^(killed|exited|unknown)$/);
    assert.equal(await waitForPidExit(ownedPid, 5_000), true);
    const externalRecord = runtime.processRegistry.get("external-dev-server");
    assert.equal(externalRecord?.status, "running");
    assert.equal(isPidRunning(externalChild.pid), true);
    const externalPortAfterClose = await waitForLocalPort({
      port: externalPort,
      host: "127.0.0.1",
      timeoutMs: 500,
      probeTimeoutMs: 100,
      pollIntervalMs: 50,
    });
    assert.equal(externalPortAfterClose.ready, true);

    const cleanupFacts = runtime.processRegistry.listCleanupFacts();
    assert.equal(
      cleanupFacts.some((fact) => fact.attempted.some((attempt) => attempt.processId === ownedRecord.processId)),
      true
    );
    assert.equal(
      cleanupFacts.some((fact) => fact.skipped.some((skip) => skip.processId === "external-dev-server" && skip.reason === "unowned")),
      true
    );
  } finally {
    if (panelServer.listening) {
      await closeHttpServer(panelServer);
    }
    if (externalChild?.pid !== undefined) {
      externalChild.kill();
      await ensurePidExited(externalChild.pid, 2_000);
    }
    await ensurePidExited(ownedPid, 2_000);
    await removeTempTree(root);
  }
});

function panelRuntimeHooks() {
  return {
    async executeRun(_runtime: PanelRuntime, _execution: BasicAgentRunExecutionInput): Promise<BasicAgentRunExecutionResult> {
      throw new Error("runtime guard e2e test should not execute a panel run");
    },
    async failRun(): Promise<void> {
      throw new Error("runtime guard e2e test should not fail a panel run");
    },
    scheduleNextQueuedConversationRun(_runtime: PanelRuntime, _completedJob: PanelRunJob): void {
      return undefined;
    },
  };
}

function toolContext(runId: string, toolCallId: string): typeof context & {
  readonly runId: string;
  readonly toolCallId: string;
} {
  return { ...context, runId, toolCallId };
}

function nodeHttpServerScript(port: number, readyText: string): string {
  return [
    "const http=require('node:http');",
    "const server=http.createServer((_req,res)=>res.end('ok'));",
    `server.listen(${port}, '127.0.0.1', () => console.log(${JSON.stringify(readyText)}));`,
    "setInterval(() => {}, 1000);",
  ].join("");
}

async function startExternalNodeServer(port: number): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["-e", nodeHttpServerScript(port, "external-dev-server-ready")], {
    stdio: "ignore",
    windowsHide: true,
  });
  try {
    const startup = await Promise.race([
      waitForLocalPort({
        port,
        host: "127.0.0.1",
        timeoutMs: 4_000,
        probeTimeoutMs: 100,
        pollIntervalMs: 50,
      }),
      onceChildExit(child),
    ]);
    if ("exitCode" in startup) {
      throw new Error(`External dev server exited during startup: ${startup.exitCode}`);
    }
    assert.equal(startup.ready, true);
    return child;
  } catch (error) {
    if (child.pid !== undefined) {
      child.kill();
      await ensurePidExited(child.pid, 2_000);
    }
    throw error;
  }
}

function onceChildExit(child: ChildProcess): Promise<{ readonly exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve({ exitCode: code }));
  });
}

async function unusedLocalPort(): Promise<number> {
  const server = createNetServer();
  try {
    return await listenOnUnusedLocalPort(server);
  } finally {
    await closeNetServer(server);
  }
}

function listenOnUnusedLocalPort(server: NetServer): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : undefined;
      if (port === undefined) {
        reject(new Error("Could not allocate local port."));
        return;
      }
      resolve(port);
    });
  });
}

function listenHttpServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeHttpServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function closeNetServer(server: NetServer): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function waitForPidExit(pid: number | undefined, timeoutMs: number): Promise<boolean> {
  if (pid === undefined) {
    await delay(50);
    return true;
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    if (!isPidRunning(pid)) {
      return true;
    }
    await delay(100);
  }
  return false;
}

function isPidRunning(pid: number | undefined): boolean {
  if (pid === undefined) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function removeTempTree(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

function onlyRecord<T>(records: readonly T[]): T {
  assert.equal(records.length, 1);
  return records[0]!;
}

function asRecord(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
