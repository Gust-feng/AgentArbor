import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ensurePidExited } from "./background-process-test-utils.js";
import { createLocalRunCommandTool, createLocalShellCommandTool } from "./local-workspace-command-tools.js";

const context = { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" };
const commandLogRefPrefix = "command-log://";

test("shell_command returns stable foreground cancellation facts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-command-runtime-"));
  try {
    const shellCommand = createLocalShellCommandTool(root);
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 150);
    try {
      const output = await shellCommand.execute(
        {
          command: process.execPath,
          args: ["-e", "console.log('before-cancel'); setInterval(() => {}, 1000);"],
          timeoutMs: 10_000,
        },
        { ...context, abortSignal: controller.signal }
      );
      const result = asRecord(asRecord(output).result);

      assert.equal(asRecord(output).status, "completed");
      assert.equal(result.exitCode, 130);
      assert.equal(result.cancelled, true);
      assert.equal(result.timedOut, undefined);
      assert.match(String(result.stdout), /before-cancel/);
      assert.match(String(result.stderr), /Command execution cancelled\./);
      assert.match(String(asRecord(output).summary), /cancelled \(exit 130\)/);
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
    const shellCommand = createLocalShellCommandTool(root);
    const output = await shellCommand.execute({
      command: process.execPath,
      args: ["-e", "console.log('known-stdout'); console.error('known-stderr'); process.exit(7);"],
    }, context);
    const result = asRecord(asRecord(output).result);

    assert.equal(result.exitCode, 7);
    assert.equal(result.stdout, "known-stdout\n");
    assert.equal(result.stderr, "known-stderr\n");
    assert.equal(result.stdoutTruncated, false);
    assert.equal(result.stderrTruncated, false);
    assert.equal(result.stdoutChars, "known-stdout\n".length);
    assert.equal(result.stderrChars, "known-stderr\n".length);
  } finally {
    await removeTempTree(root);
  }
});

test("shell_command returns background metadata when waitForPort is cancelled", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-command-runtime-"));
  try {
    const port = await unusedLocalPort();
    const shellCommand = createLocalShellCommandTool(root);
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
      const result = asRecord(asRecord(output).result);
      stopCommand = typeof result.stopCommand === "string" ? result.stopCommand : undefined;
      backgroundPid = typeof result.pid === "number" ? result.pid : undefined;

      assert.equal(result.exitCode, 0);
      assert.equal(result.background, true);
      assert.equal(typeof result.pid, "number");
      assertControlledLogRef(result);
      assert.equal(typeof result.logPath, "string");
      assert.equal(typeof result.stopCommand, "string");
      assert.equal(result.waitForPort, port);
      assert.equal(result.portReady, false);
      assert.equal(result.portWaitCancelled, true);
      assert.match(String(result.stderr), new RegExp(`Port wait for ${port} was cancelled before the port became ready\\.`));
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
    const shellCommand = createLocalShellCommandTool(root);
    const output = await shellCommand.execute({
      command: process.execPath,
      args: ["-e", "console.log('background-log-ref-ready'); setInterval(() => {}, 1000);"],
      background: true,
      backgroundWaitMs: 50,
    }, context);
    const result = asRecord(asRecord(output).result);

    try {
      assert.equal(result.exitCode, 0);
      assert.equal(result.background, true);
      assertControlledLogRef(result);
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
    const result = asRecord(asRecord(output).result);

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

test("run_command alias preserves controlled logRef for truncated command output", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-command-runtime-"));
  try {
    const runCommand = createLocalRunCommandTool(root);
    const output = await runCommand.execute({
      command: process.execPath,
      args: ["-e", "process.stdout.write('r'.repeat(20000));"],
    }, context);
    const result = asRecord(asRecord(output).result);

    assert.equal(asRecord(output).action, "run_command");
    assert.equal(asRecord(output).truncated, true);
    assertControlledLogRef(result);
  } finally {
    await removeTempTree(root);
  }
});

test("shell_command makes background waitForPort timeout visible in summary and result", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-command-runtime-"));
  try {
    const port = await unusedLocalPort();
    const shellCommand = createLocalShellCommandTool(root);
    const output = await shellCommand.execute({
      command: process.execPath,
      args: ["-e", "console.log('no-port-server'); setInterval(() => {}, 1000);"],
      background: true,
      backgroundWaitMs: 50,
      waitForPort: port,
      waitForPortTimeoutMs: 250,
    }, context);
    const result = asRecord(asRecord(output).result);

    assert.equal(result.exitCode, 0);
    assert.equal(result.background, true);
    assertControlledLogRef(result);
    assert.equal(result.waitForPort, port);
    assert.equal(result.portReady, false);
    assert.match(String(result.stderr), new RegExp(`Port ${port} did not become ready within 250ms\\.`));
    assert.match(String(asRecord(output).summary), new RegExp(`port ${port} not ready`));
    await shellCommand.execute({ commandLine: String(result.stopCommand), timeoutMs: 2_000 }, context);
    await ensurePidExited(typeof result.pid === "number" ? result.pid : undefined, 5_000);
  } finally {
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

function asRecord(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
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
