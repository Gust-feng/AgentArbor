import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createNetServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { ToolExecutionProgress } from "../../../domain/tools/index.js";
import { ensurePidExited } from "./background-process-test-utils.js";
import { createLocalShellCommandTool } from "./local-workspace-command-tools.js";
import {
  InMemoryProcessRegistry,
  type PortOccupantProbe,
  type ProcessPortFact,
  type ProcessRecordUpdate,
  type ProcessRegistration,
} from "../../runtime-guard/index.js";

const context = { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" };
const processContext = {
  ...context,
  runId: "run-test",
  toolCallId: "tool-call-test",
} as typeof context & { readonly runId: string; readonly toolCallId: string };
const commandLogRefPrefix = "command-log://";

test("shell_command returns stable foreground cancellation facts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-command-runtime-"));
  try {
    const registry = createRecordingProcessRegistry();
    const shellCommand = createLocalShellCommandTool(root, { processRegistry: registry });
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 150);
    try {
      const output = await shellCommand.execute(
        {
          command: process.execPath,
          args: ["-e", "console.log('before-cancel'); setInterval(() => {}, 1000);"],
          timeoutMs: 10_000,
        },
        { ...processContext, abortSignal: controller.signal }
      );
      const result = asDirectToolFacts(output);

      assert.equal(result.exitCode, 130);
      assert.equal(result.cancelled, true);
      assert.equal(result.timedOut, undefined);
      assert.equal("processId" in result, false);
      assert.match(String(result.stdout), /before-cancel/);
      assert.match(String(result.stderr), /Command execution cancelled\./);
      assert.equal(registry.registered.length, 1);
      assert.equal(registry.registered[0]?.kind, "foreground");
      assert.equal(registry.registered[0]?.owned, true);
      assert.equal(registry.registered[0]?.runId, "run-test");
      assert.equal(registry.registered[0]?.toolCallId, "tool-call-test");
      assert.equal(registry.registered[0]?.status, "running");
      assert.equal(registry.exited.length, 1);
      assert.equal(registry.exited[0]?.input?.exitCode, 130);
      assert.equal(registry.listAll()[0]?.status, "exited");
      assert.equal(registry.listAll()[0]?.exitCode, 130);
    } finally {
      clearTimeout(abortTimer);
    }
  } finally {
    await removeTempTree(root);
  }
});

test("shell_command preserves foreground exit code and stdout stderr facts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-command-runtime-"));
  try {
    const registry = createRecordingProcessRegistry();
    const shellCommand = createLocalShellCommandTool(root, { processRegistry: registry });
    const output = await shellCommand.execute({
      command: process.execPath,
      args: ["-e", "console.log('known-stdout'); console.error('known-stderr'); process.exit(7);"],
    }, processContext);
    const result = asDirectToolFacts(output);

    assert.equal(result.exitCode, 7);
    assert.equal(result.stdout, "known-stdout\n");
    assert.equal(result.stderr, "known-stderr\n");
    assert.equal(result.stdoutTruncated, false);
    assert.equal(result.stderrTruncated, false);
    assert.equal(result.stdoutChars, "known-stdout\n".length);
    assert.equal(result.stderrChars, "known-stderr\n".length);
    assert.equal("processId" in result, false);
    assert.equal(registry.registered.length, 1);
    assert.equal(registry.registered[0]?.kind, "foreground");
    assert.equal(registry.registered[0]?.status, "running");
    assert.equal(registry.exited.length, 1);
    assert.equal(registry.exited[0]?.input?.exitCode, 7);
    assert.equal(registry.listAll()[0]?.status, "exited");
    assert.equal(registry.listAll()[0]?.exitCode, 7);
  } finally {
    await removeTempTree(root);
  }
});

test("shell_command reports bounded stdout and stderr progress before completion", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-command-progress-"));
  try {
    const progress: ToolExecutionProgress[] = [];
    const shellCommand = createLocalShellCommandTool(root);
    const output = await shellCommand.execute({
      command: process.execPath,
      args: [
        "-e",
        "process.stdout.write('first'); setTimeout(() => process.stderr.write('second'), 180); setTimeout(() => process.exit(0), 300);",
      ],
    }, {
      ...context,
      reportProgress: (update) => progress.push(update),
    });
    const result = asDirectToolFacts(output);

    assert.equal(result.exitCode, 0);
    assert.equal(progress.length >= 2, true);
    assert.equal(progress.every((update) => update.kind === "command_output"), true);
    assert.equal(progress.some((update) =>
      update.kind === "command_output" && update.stdoutTail?.includes("first") === true), true);
    const finalProgress = progress.at(-1);
    assert.equal(finalProgress?.kind, "command_output");
    if (finalProgress?.kind !== "command_output") throw new Error("Expected command output progress");
    assert.equal(finalProgress.stderrTail?.includes("second"), true);
    assert.equal(finalProgress.stdoutChars, "first".length);
    assert.equal(finalProgress.stderrChars, "second".length);
  } finally {
    await removeTempTree(root);
  }
});

test("shell_command records background process facts and port wait facts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-command-runtime-"));
  try {
    const registry = createRecordingProcessRegistry();
    const port = await unusedLocalPort();
    const shellCommand = createLocalShellCommandTool(root, { processRegistry: registry });
    const output = await shellCommand.execute(
      {
        command: process.execPath,
        args: [
          "-e",
          [
            "const http=require('node:http');",
            "const server=http.createServer((req,res)=>res.end('ok'));",
            `server.listen(${port}, '127.0.0.1', () => console.log('background-started:${port}'));`,
            "setInterval(() => {}, 1000);",
          ].join(""),
        ],
        background: true,
        backgroundWaitMs: 50,
        waitForPort: port,
        waitForPortTimeoutMs: 3_000,
      },
      processContext
    );
    const result = asDirectToolFacts(output);

    try {
      assert.equal(result.exitCode, null);
      assert.equal(result.background, true);
      assert.equal(result.processState, "running");
      assert.equal(result.lifetime, "workspace_session");
      assert.equal(result.waitForPort, port);
      assert.equal(result.portReady, true);
      assert.equal(typeof result.pid, "number");
      assert.equal(typeof result.processId, "string");
      assertControlledLogRef(result);
      assert.equal(registry.registered.length, 1);
      assert.equal(registry.registered[0]?.kind, "background");
      assert.equal(registry.registered[0]?.status, "running");
      assert.equal(registry.registered[0]?.runId, "run-test");
      assert.equal(registry.registered[0]?.toolCallId, "tool-call-test");
      assert.equal(registry.portFacts.length, 1);
      assert.deepEqual(registry.portFacts[0], {
        port,
        host: "127.0.0.1",
        requestedAt: registry.portFacts[0]!.requestedAt,
        checkedAt: registry.portFacts[0]!.checkedAt,
        durationMs: registry.portFacts[0]!.durationMs,
        timeoutMs: 3_000,
        status: "ready",
        ready: true,
      });
      assert.equal(registry.listAll()[0]?.ports.length, 1);
      assert.equal(registry.listAll()[0]?.ports[0]?.port, port);
      assert.equal(registry.listAll()[0]?.ports[0]?.ready, true);
    } finally {
      await shellCommand.execute({ commandLine: String(result.stopCommand), timeoutMs: 2_000 }, processContext);
      await ensurePidExited(typeof result.pid === "number" ? result.pid : undefined, 5_000);
    }
  } finally {
    await removeTempTree(root);
  }
});

test("shell_command terminates a child when app shutdown closes process registration", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-command-runtime-"));
  try {
    const registry = new InMemoryProcessRegistry();
    await registry.cleanupOwnedProcesses({ killTree: () => ({ status: "killed" as const }) });
    const pidFile = path.join(root, "started.pid");
    const shellCommand = createLocalShellCommandTool(root, { processRegistry: registry });

    await assert.rejects(
      shellCommand.execute({
        command: process.execPath,
        args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`],
        background: true,
        backgroundWaitMs: 100,
      }, processContext),
      /no longer accepts registrations/
    );

    try {
      const pid = Number(await readFile(pidFile, "utf8"));
      assert.equal(Number.isInteger(pid), true);
      await ensurePidExited(pid, 5_000);
    } catch (error) {
      // Shutdown can terminate the child before its script reaches the first
      // filesystem write. In that case the missing marker is itself expected.
      if (!(error instanceof Error) || !/ENOENT/u.test(error.message)) {
        throw error;
      }
    }
  } finally {
    await removeTempTree(root);
  }
});

test("shell_command returns background metadata when waitForPort is cancelled", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-command-runtime-"));
  try {
    const port = await unusedLocalPort();
    const registry = createRecordingProcessRegistry();
    const shellCommand = createLocalShellCommandTool(root, { processRegistry: registry });
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 150);
    let stopCommand: string | undefined;
    let backgroundPid: number | undefined;
    try {
      const output = await shellCommand.execute(
        {
          command: process.execPath,
          args: ["-e", "console.log('background-started'); setInterval(() => {}, 1000);"],
          background: true,
          backgroundWaitMs: 50,
          waitForPort: port,
          waitForPortTimeoutMs: 5_000,
        },
        { ...context, abortSignal: controller.signal }
      );
      const result = asDirectToolFacts(output);
      stopCommand = typeof result.stopCommand === "string" ? result.stopCommand : undefined;
      backgroundPid = typeof result.pid === "number" ? result.pid : undefined;

      assert.equal(result.exitCode, null);
      assert.equal(result.background, true);
      assert.equal(result.processState, "running");
      assert.equal(result.lifetime, "workspace_session");
      assert.equal(typeof result.pid, "number");
      assertControlledLogRef(result);
      assert.equal(typeof result.logPath, "string");
      assert.equal(typeof result.stopCommand, "string");
      assert.equal(result.waitForPort, port);
      assert.equal(result.portReady, false);
      assert.equal(result.portWaitCancelled, true);
      assert.equal(typeof result.processId, "string");
      assert.match(String(result.stderr), new RegExp(`Port wait for ${port} was cancelled before the port became ready\\.`));
      assert.equal(registry.registered.length, 1);
      assert.equal(registry.registered[0]?.kind, "background");
      assert.equal(registry.registered[0]?.status, "running");
      assert.equal(registry.portFacts.length, 1);
      assert.equal(registry.portFacts[0]?.port, port);
      assert.equal(registry.portFacts[0]?.cancelled, true);
      assert.equal(registry.portFacts[0]?.host, "127.0.0.1");
      assert.equal(typeof registry.portFacts[0]?.durationMs, "number");
      assert.equal(registry.portFacts[0]?.timeoutMs, 5_000);
      assert.equal(registry.portFacts[0]?.error?.code, "ABORT_ERR");
    } finally {
      clearTimeout(abortTimer);
      if (stopCommand !== undefined) {
        await shellCommand.execute({ commandLine: stopCommand, timeoutMs: 2_000 }, context);
        await ensurePidExited(backgroundPid, 5_000);
      }
    }
  } finally {
    await removeTempTree(root);
  }
});

test("shell_command returns a controlled logRef for background command logs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-command-runtime-"));
  try {
    const registry = createRecordingProcessRegistry();
    const shellCommand = createLocalShellCommandTool(root, { processRegistry: registry });
    const output = await shellCommand.execute({
      command: process.execPath,
      args: ["-e", "console.log('background-log-ref-ready'); setInterval(() => {}, 1000);"],
      background: true,
      backgroundWaitMs: 50,
    }, context);
    const result = asDirectToolFacts(output);

    try {
      assert.equal(result.exitCode, null);
      assert.equal(result.background, true);
      assert.equal(result.processState, "running");
      assert.equal(result.lifetime, "workspace_session");
      assertControlledLogRef(result);
      assert.equal(typeof result.processId, "string");
      assert.equal(registry.registered.length, 1);
      assert.equal(registry.registered[0]?.kind, "background");
      assert.equal(registry.registered[0]?.status, "running");
      assert.match(String(result.stdout), new RegExp(`Log: ${escapeRegExp(String(result.logRef))}`));
      assert.doesNotMatch(String(result.stdout), new RegExp(`Log: ${escapeRegExp(String(result.logPath))}`));
    } finally {
      await shellCommand.execute({ commandLine: String(result.stopCommand), timeoutMs: 2_000 }, context);
      await ensurePidExited(typeof result.pid === "number" ? result.pid : undefined, 5_000);
    }
  } finally {
    await removeTempTree(root);
  }
});

test("shell_command returns a controlled logRef for truncated foreground output", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-command-runtime-"));
  try {
    const shellCommand = createLocalShellCommandTool(root);
    const output = await shellCommand.execute({
      command: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(20000)); process.stderr.write('foreground-stderr-tail');"],
    }, context);
    const result = asDirectToolFacts(output);

    assert.equal(asRecord(output).truncated, true);
    assert.equal(result.stdoutTruncated, true);
    assert.equal(result.stderrTruncated, false);
    assertControlledLogRef(result);
    const logText = await readFile(String(result.logPath), "utf8");
    assert.match(logText, /x{100}/);
    assert.match(logText, /foreground-stderr-tail/);
  } finally {
    await removeTempTree(root);
  }
});

test("shell_command returns factual background waitForPort timeout state", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-command-runtime-"));
  try {
    const port = await unusedLocalPort();
    const registry = createRecordingProcessRegistry();
    const shellCommand = createLocalShellCommandTool(root, { processRegistry: registry });
    const output = await shellCommand.execute({
      command: process.execPath,
      args: ["-e", "console.log('no-port-server'); setInterval(() => {}, 1000);"],
      background: true,
      backgroundWaitMs: 50,
      waitForPort: port,
      waitForPortTimeoutMs: 250,
    }, context);
    const result = asDirectToolFacts(output);

    assert.equal(result.exitCode, null);
    assert.equal(result.background, true);
    assert.equal(result.processState, "running");
    assert.equal(result.lifetime, "workspace_session");
    assertControlledLogRef(result);
    assert.equal(result.waitForPort, port);
    assert.equal(result.portReady, false);
    assert.equal(typeof result.processId, "string");
    assert.match(String(result.stderr), new RegExp(`Port ${port} did not become ready within 250ms\\.`));
    assert.equal(registry.registered.length, 1);
    assert.equal(registry.registered[0]?.kind, "background");
    assert.equal(registry.registered[0]?.status, "running");
    assert.equal(registry.portFacts.length, 1);
    assert.equal(registry.portFacts[0]?.port, port);
    assert.equal(registry.portFacts[0]?.ready, false);
    assert.equal(registry.portFacts[0]?.host, "127.0.0.1");
    assert.equal(typeof registry.portFacts[0]?.durationMs, "number");
    assert.equal(registry.portFacts[0]?.timeoutMs, 250);
    assert.equal(registry.portFacts[0]?.timedOut, true);
    assert.equal(registry.portFacts[0]?.error?.code, "ECONNREFUSED");
    await shellCommand.execute({ commandLine: String(result.stopCommand), timeoutMs: 2_000 }, context);
    await ensurePidExited(typeof result.pid === "number" ? result.pid : undefined, 5_000);
  } finally {
    await removeTempTree(root);
  }
});

test("shell_command records post-start external port occupant facts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-command-runtime-"));
  const server = createNetServer();
  let listenTimer: ReturnType<typeof setTimeout> | undefined;
  let delayedListen: Promise<void> | undefined;
  let stopCommand: string | undefined;
  let backgroundPid: number | undefined;
  try {
    const port = await unusedLocalPort();
    const registry = createRecordingProcessRegistry();
    const portOccupantProbe: PortOccupantProbe = (input) => {
      assert.equal(input.port, port);
      return {
        pid: 54321,
        observedBy: "platform_probe",
      };
    };
    const shellCommand = createLocalShellCommandTool(root, { processRegistry: registry, portOccupantProbe });
    listenTimer = setTimeout(() => {
      delayedListen = listenOnLocalPort(server, port).catch(() => undefined);
    }, 100);

    const output = await shellCommand.execute(
      {
        command: process.execPath,
        args: ["-e", "console.log('background-no-port'); setInterval(() => {}, 1000);"],
        background: true,
        backgroundWaitMs: 50,
        waitForPort: port,
        waitForPortTimeoutMs: 3_000,
      },
      processContext
    );
    const result = asDirectToolFacts(output);
    stopCommand = typeof result.stopCommand === "string" ? result.stopCommand : undefined;
    backgroundPid = typeof result.pid === "number" ? result.pid : undefined;

    assert.equal(result.exitCode, null);
    assert.equal(result.background, true);
    assert.equal(result.processState, "running");
    assert.equal(result.lifetime, "workspace_session");
    assert.equal(typeof result.processId, "string");
    assert.equal(result.waitForPort, port);
    assert.equal(result.portReady, true);
    assert.equal(registry.portFacts.length, 1);
    assert.deepEqual(registry.portFacts[0]?.externalOccupant, {
      pid: 54321,
      observedBy: "platform_probe",
      ownedByUs: false,
    });
    assert.deepEqual(registry.listAll()[0]?.ports[0]?.externalOccupant, {
      pid: 54321,
      observedBy: "platform_probe",
      ownedByUs: false,
    });
  } finally {
    if (listenTimer !== undefined) {
      clearTimeout(listenTimer);
    }
    await delayedListen;
    await closeServer(server);
    const shellCommand = createLocalShellCommandTool(root);
    if (stopCommand !== undefined) {
      await shellCommand.execute({ commandLine: stopCommand, timeoutMs: 2_000 }, context);
      await ensurePidExited(backgroundPid, 5_000);
    }
    await removeTempTree(root);
  }
});

test("shell_command returns pre-start occupied port facts without starting a duplicate server", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-command-runtime-"));
  const server = createNetServer();
  try {
    const port = await listenOnUnusedLocalPort(server);
    const registry = createRecordingProcessRegistry();
    const occupantProbeCalls: number[] = [];
    const portOccupantProbe: PortOccupantProbe = (input) => {
      occupantProbeCalls.push(input.port);
      assert.equal(input.host, "127.0.0.1");
      return {
        pid: 54321,
        observedBy: "platform_probe",
      };
    };
    const shellCommand = createLocalShellCommandTool(root, { processRegistry: registry, portOccupantProbe });
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
        backgroundWaitMs: 750,
        waitForPort: port,
        waitForPortTimeoutMs: 1_000,
      },
      processContext
    );
    const result = asDirectToolFacts(output);
    const occupancy = asRecord(result.preStartPortOccupancy);

    assert.equal(result.notStarted, true);
    assert.equal(result.background, undefined);
    assert.equal(result.exitCode, null);
    assert.equal(result.waitForPort, port);
    assert.equal(result.portReady, false);
    assert.equal(result.pid, undefined);
    assert.equal(result.logRef, undefined);
    assert.equal("processId" in result, false);
    assert.equal(registry.registered.length, 0);
    assert.equal(registry.portFacts.length, 0);
    assert.equal(occupancy.kind, "pre_start_port_occupancy");
    assert.equal(occupancy.port, port);
    assert.equal(occupancy.host, "127.0.0.1");
    assert.equal(occupancy.occupied, true);
    assert.equal(occupancy.pid, 54321);
    assert.equal(occupancy.pidKnown, true);
    assert.equal(occupancy.owner, "unknown");
    assert.equal(occupancy.ownerUnknown, true);
    assert.equal(occupancy.ownedByUs, undefined);
    assert.equal(occupancy.source, "platform_probe");
    assert.equal(typeof occupancy.checkedAt, "string");
    assert.deepEqual(occupantProbeCalls, [port]);
    assert.equal(server.listening, true);
    await assert.rejects(() => readFile(markerPath, "utf8"));
  } finally {
    await closeServer(server);
    await removeTempTree(root);
  }
});

test("shell_command marks pre-start occupied ports as owned when registry has the active process", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-command-runtime-"));
  const server = createNetServer();
  try {
    const port = await listenOnUnusedLocalPort(server);
    const registry = createRecordingProcessRegistry();
    registry.register({
      processId: "existing-dev-server",
      runId: "previous-run",
      toolCallId: "previous-tool-call",
      pid: 43210,
      kind: "background",
      owned: true,
      commandLine: "pnpm dev",
      cwd: root,
      startedAt: "2026-06-15T00:00:00.000Z",
      status: "running",
      ports: [{
        port,
        host: "127.0.0.1",
        requestedAt: "2026-06-15T00:00:00.000Z",
        checkedAt: "2026-06-15T00:00:00.000Z",
        status: "ready",
        ready: true,
      }],
    });
    registry.registered.length = 0;
    const occupantProbeCalls: number[] = [];
    const portOccupantProbe: PortOccupantProbe = (input) => {
      occupantProbeCalls.push(input.port);
      return {
        pid: 43210,
        observedBy: "platform_probe",
      };
    };
    const shellCommand = createLocalShellCommandTool(root, { processRegistry: registry, portOccupantProbe });
    const markerPath = path.join(root, "owned-started.txt");
    const output = await shellCommand.execute(
      {
        command: process.execPath,
        args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'started');`],
        background: true,
        backgroundWaitMs: 50,
        waitForPort: port,
        waitForPortTimeoutMs: 1_000,
      },
      processContext
    );
    const result = asDirectToolFacts(output);
    const occupancy = asRecord(result.preStartPortOccupancy);

    assert.equal(result.notStarted, true);
    assert.equal(result.exitCode, null);
    assert.equal(result.waitForPort, port);
    assert.equal(result.portReady, false);
    assert.equal(registry.registered.length, 0);
    assert.equal(occupancy.owner, "agentarbor");
    assert.equal(occupancy.ownedByUs, true);
    assert.equal(occupancy.ownerUnknown, undefined);
    assert.equal(occupancy.pid, 43210);
    assert.equal(occupancy.pidKnown, true);
    assert.equal(occupancy.source, "platform_probe");
    assert.equal(occupancy.ownershipSource, "process_registry");
    assert.equal(occupancy.registryProcessId, "existing-dev-server");
    assert.deepEqual(occupantProbeCalls, [port]);
    await assert.rejects(() => readFile(markerPath, "utf8"));
  } finally {
    await closeServer(server);
    await removeTempTree(root);
  }
});

test("shell_command keeps pre-start port ownership unknown without an observed pid match", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-command-runtime-"));
  const server = createNetServer();
  try {
    const port = await listenOnUnusedLocalPort(server);
    const registry = createRecordingProcessRegistry();
    registry.register({
      processId: "stale-port-fact",
      runId: "previous-run",
      toolCallId: "previous-tool-call",
      pid: 43210,
      kind: "background",
      owned: true,
      commandLine: "pnpm dev",
      cwd: root,
      startedAt: "2026-06-15T00:00:00.000Z",
      status: "running",
      ports: [{
        port,
        host: "127.0.0.1",
        requestedAt: "2026-06-15T00:00:00.000Z",
        checkedAt: "2026-06-15T00:00:00.000Z",
        status: "ready",
        ready: true,
      }],
    });
    registry.registered.length = 0;
    const portOccupantProbe: PortOccupantProbe = () => ({
      observedBy: "platform_probe",
    });
    const shellCommand = createLocalShellCommandTool(root, { processRegistry: registry, portOccupantProbe });
    const markerPath = path.join(root, "unknown-owner-started.txt");
    const output = await shellCommand.execute(
      {
        command: process.execPath,
        args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'started');`],
        background: true,
        backgroundWaitMs: 50,
        waitForPort: port,
        waitForPortTimeoutMs: 1_000,
      },
      processContext
    );
    const result = asDirectToolFacts(output);
    const occupancy = asRecord(result.preStartPortOccupancy);

    assert.equal(result.notStarted, true);
    assert.equal(result.portReady, false);
    assert.equal(registry.registered.length, 0);
    assert.equal(occupancy.kind, "pre_start_port_occupancy");
    assert.equal(occupancy.port, port);
    assert.equal(occupancy.pid, undefined);
    assert.equal(occupancy.pidKnown, false);
    assert.equal(occupancy.owner, "unknown");
    assert.equal(occupancy.ownerUnknown, true);
    assert.equal(occupancy.ownedByUs, undefined);
    assert.equal(occupancy.ownershipSource, undefined);
    assert.equal(occupancy.registryProcessId, undefined);
    assert.equal(occupancy.source, "platform_probe");
    await assert.rejects(() => readFile(markerPath, "utf8"));
  } finally {
    await closeServer(server);
    await removeTempTree(root);
  }
});

async function removeTempTree(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

async function unusedLocalPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : undefined;
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        if (port === undefined) {
          reject(new Error("Could not allocate local port."));
          return;
        }
        resolve(port);
      });
    });
  });
}

function listenOnUnusedLocalPort(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
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

function listenOnLocalPort(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
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

function asRecord(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
}

function asDirectToolFacts(value: unknown): Record<string, unknown> {
  const output = asRecord(value);
  for (const legacyField of ["action", "status", "summary", "result"]) {
    assert.equal(legacyField in output, false, `command output must not contain ${legacyField}`);
  }
  return output;
}

function assertControlledLogRef(result: Record<string, unknown>): void {
  assert.equal(typeof result.logRef, "string");
  assert.equal(typeof result.logPath, "string");
  const logRef = String(result.logRef);
  assert.equal(logRef.startsWith(commandLogRefPrefix), true);
  const id = logRef.slice(commandLogRefPrefix.length);
  assert.doesNotMatch(id, /[\\/]/);
  assert.equal(logRef, `${commandLogRefPrefix}${path.basename(String(result.logPath), ".log")}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createRecordingProcessRegistry() {
  const registry = new InMemoryProcessRegistry({ now: () => "2026-06-15T00:00:00.000Z" });
  const registered: ProcessRegistration[] = [];
  const updates: Array<{ readonly processId: string; readonly patch: ProcessRecordUpdate }> = [];
  const exited: Array<{
    readonly processId: string;
    readonly input?: { readonly exitCode?: number; readonly signal?: string; readonly exitedAt?: string };
  }> = [];
  const portFacts: ProcessPortFact[] = [];
  return {
    registered,
    updates,
    exited,
    portFacts,
    register(input: ProcessRegistration): unknown {
      registered.push(input);
      return registry.register(input);
    },
    update(processId: string, patch: ProcessRecordUpdate): unknown {
      updates.push({ processId, patch });
      return registry.update(processId, patch);
    },
    markExited(
      processId: string,
      input?: { readonly exitCode?: number; readonly signal?: string; readonly exitedAt?: string }
    ): unknown {
      exited.push({ processId, input });
      return registry.markExited(processId, input);
    },
    appendPortFact(processId: string, fact: ProcessPortFact): unknown {
      portFacts.push(fact);
      return registry.appendPortFact(processId, fact);
    },
    get: registry.get.bind(registry),
    listAll: registry.listAll.bind(registry),
  };
}
