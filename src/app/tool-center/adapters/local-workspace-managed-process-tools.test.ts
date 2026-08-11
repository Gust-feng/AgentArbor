import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createNetServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createPlatformProcessTerminator,
  InMemoryProcessRegistry,
} from "../../runtime-guard/index.js";
import { ensurePidExited } from "./background-process-test-utils.js";
import { createLocalManagedProcessTools } from "./local-workspace-managed-process-tools.js";
import { createLocalShellCommandTool } from "./local-workspace-command-tools.js";

const context = {
  callerAgentId: "agent-test",
  traceId: "run-managed-tools",
  goalId: "goal-managed-tools",
  toolCallId: "call-managed-tools",
};

test("managed process tools start, inspect, and stop a workspace-session service by processId", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-managed-process-"));
  const registry = new InMemoryProcessRegistry();
  const options = {
    processRegistry: registry,
    processTerminator: createPlatformProcessTerminator(),
  };
  const tools = createLocalManagedProcessTools(root, options);
  const startProcess = createLocalShellCommandTool(root, options);
  const inspectProcess = requiredTool(tools, "ProcessRead");
  const stopProcess = requiredTool(tools, "ProcessStop");
  let pid: number | undefined;

  try {
    const started = asRecord(await startProcess.execute({
      command: process.execPath,
      args: ["-e", "console.log('managed-ready'); setInterval(() => {}, 1000);"],
      background: true,
      backgroundWaitMs: 50,
    }, context));
    pid = typeof started.pid === "number" ? started.pid : undefined;

    assert.equal(started.processState, "running");
    assert.equal(started.lifetime, "workspace_session");
    assert.equal(typeof started.processId, "string");
    assert.equal(started.exitCode, null);

    const processId = String(started.processId);
    const inspected = asRecord(await inspectProcess.execute({ processId }, context));
    assert.equal(inspected.found, true);
    assert.equal(inspected.processId, processId);
    assert.equal(inspected.state, "running");

    const runCleanup = await registry.cleanupByRun(context.traceId, createPlatformProcessTerminator());
    assert.deepEqual(runCleanup.attempted, []);

    const stopped = asRecord(await stopProcess.execute({ processId }, context));
    assert.equal(stopped.stopStatus, "stopped");
    assert.equal(["killed", "exited"].includes(String(stopped.state)), true);
    await ensurePidExited(pid, 5_000);
  } finally {
    if (pid !== undefined && registry.listAll().some((record) => record.pid === pid && record.status === "running")) {
      await createPlatformProcessTerminator().killTree(pid, registry.listAll().find((record) => record.pid === pid)!);
    }
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("process_inspect lists only managed processes inside its workspace", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-managed-process-list-"));
  const registry = new InMemoryProcessRegistry();
  registry.register({
    processId: "inside-workspace",
    pid: 31001,
    kind: "background",
    lifetime: "workspace_session",
    owned: true,
    commandLine: "pnpm dev",
    cwd: root,
    startedAt: "2026-07-19T00:00:00.000Z",
    status: "running",
  });
  registry.register({
    processId: "outside-workspace",
    pid: 31002,
    kind: "background",
    lifetime: "workspace_session",
    owned: true,
    commandLine: "node server.js",
    cwd: path.dirname(root),
    startedAt: "2026-07-19T00:00:00.000Z",
    status: "running",
  });

  try {
    const inspectProcess = requiredTool(createLocalManagedProcessTools(root, {
      processRegistry: registry,
      processTerminator: createPlatformProcessTerminator(),
    }), "ProcessRead");
    const result = asRecord(await inspectProcess.execute({}, context));
    const processes = result.processes as readonly Record<string, unknown>[];

    assert.deepEqual(processes.map((process) => process.processId), ["inside-workspace"]);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("process_start returns not_started facts when the requested port is already occupied", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-managed-process-occupied-"));
  const registry = new InMemoryProcessRegistry();
  const server = createNetServer();
  try {
    const port = await listenOnUnusedLocalPort(server);
    const startProcess = createLocalShellCommandTool(root, {
      processRegistry: registry,
    });
    const result = asRecord(await startProcess.execute({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000);"],
      background: true,
      waitForPort: port,
    }, context));

    assert.equal(result.notStarted, true);
    assert.equal(result.lifetime, "workspace_session");
    assert.equal(result.processId, undefined);
    assert.equal(registry.listAll().length, 0);
  } finally {
    await closeServer(server);
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

function requiredTool(
  tools: ReturnType<typeof createLocalManagedProcessTools>,
  name: string,
) {
  const tool = tools.find((candidate) => candidate.definition.name === name);
  assert.notEqual(tool, undefined);
  return tool!;
}

function asRecord(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
}

function listenOnUnusedLocalPort(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || address === null) {
        reject(new Error("Could not allocate a local test port."));
        return;
      }
      resolve(address.port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => error === undefined ? resolve() : reject(error));
  });
}
