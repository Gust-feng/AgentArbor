import assert from "node:assert/strict";
import test from "node:test";
import {
  createPlatformPortOccupantProbe,
  createPlatformProcessTerminator,
  killProcessTree,
  probePlatformPortOccupant,
  type RuntimeGuardCommandRequest,
  type RuntimeGuardCommandResult,
  type RuntimeGuardSignal,
} from "./platform-process-utils.js";

test("killProcessTree uses taskkill for Windows process trees", async () => {
  const requests: RuntimeGuardCommandRequest[] = [];

  const result = await killProcessTree(4321, {
    platform: "win32",
    commandRunner(request) {
      requests.push(request);
      return {
        exitCode: 0,
        stdout: "SUCCESS: Sent termination signal.",
        stderr: "",
      };
    },
  });

  assert.equal(result.status, "killed");
  assert.equal(result.message, "SUCCESS: Sent termination signal.");
  assert.deepEqual(requests, [
    {
      file: "taskkill",
      args: ["/PID", "4321", "/T", "/F"],
      timeoutMs: 5_000,
    },
  ]);
});

test("killProcessTree reports exited when Windows taskkill says the process is absent", async () => {
  const result = await killProcessTree(4321, {
    platform: "win32",
    commandRunner() {
      return {
        exitCode: 128,
        stdout: "",
        stderr: "ERROR: The process \"4321\" not found.",
      };
    },
  });

  assert.equal(result.status, "exited");
  assert.equal(result.message, "ERROR: The process \"4321\" not found.");
});

test("killProcessTree reports unknown when Windows taskkill exits without a code", async () => {
  const result = await killProcessTree(4321, {
    platform: "win32",
    commandRunner() {
      return {
        exitCode: null,
        signal: "SIGTERM",
        stdout: "",
        stderr: "taskkill was interrupted.",
      };
    },
  });

  assert.equal(result.status, "unknown");
  assert.equal(result.signal, "SIGTERM");
  assert.equal(result.message, "taskkill was interrupted.");
});

test("killProcessTree reports failed command facts without recovery advice", async () => {
  const result = await killProcessTree(4321, {
    platform: "win32",
    commandRunner() {
      return {
        exitCode: 5,
        stdout: "",
        stderr: "ERROR: Access is denied.",
      };
    },
  });

  assert.equal(result.status, "failed");
  assert.equal(result.errorMessage, "ERROR: Access is denied.");
  assert.equal(JSON.stringify(result).includes("recovery"), false);
  assert.equal(JSON.stringify(result).includes("suggest"), false);
});

test("killProcessTree sends SIGTERM to the POSIX process group when possible", async () => {
  const signals: Array<{ readonly pid: number; readonly signal: RuntimeGuardSignal }> = [];
  let alive = true;

  const result = await killProcessTree(4321, {
    platform: "linux",
    signalSender(pid, signal) {
      signals.push({ pid, signal });
      if (pid === -4321 && signal === "SIGTERM") {
        alive = false;
      }
      if (pid === 4321 && signal === 0 && !alive) {
        throw errnoError("kill ESRCH", "ESRCH");
      }
    },
  });

  assert.equal(result.status, "killed");
  assert.equal(result.signal, "SIGTERM");
  assert.deepEqual(signals, [
    { pid: -4321, signal: "SIGTERM" },
    { pid: 4321, signal: 0 },
  ]);
});

test("killProcessTree falls back to the POSIX process pid when the group is absent", async () => {
  const signals: Array<{ readonly pid: number; readonly signal: RuntimeGuardSignal }> = [];
  let alive = true;

  const result = await killProcessTree(4321, {
    platform: "linux",
    signalSender(pid, signal) {
      signals.push({ pid, signal });
      if (pid === -4321) {
        throw errnoError("kill ESRCH", "ESRCH");
      }
      if (pid === 4321 && signal === "SIGTERM") {
        alive = false;
      }
      if (pid === 4321 && signal === 0 && !alive) {
        throw errnoError("kill ESRCH", "ESRCH");
      }
    },
  });

  assert.equal(result.status, "killed");
  assert.equal(result.message, "Sent SIGTERM to process 4321 and confirmed it exited.");
  assert.deepEqual(signals, [
    { pid: -4321, signal: "SIGTERM" },
    { pid: 4321, signal: 0 },
    { pid: 4321, signal: "SIGTERM" },
    { pid: 4321, signal: 0 },
  ]);
});

test("killProcessTree reports unknown when POSIX signal is sent but exit is not confirmed", async () => {
  const result = await killProcessTree(4321, {
    platform: "linux",
    timeoutMs: 1,
    signalSender() {
      return undefined;
    },
  });

  assert.equal(result.status, "unknown");
  assert.equal(result.message, "Sent SIGTERM to process group 4321; process exit could not be confirmed.");
});

test("killProcessTree reports exited when POSIX group and pid are absent", async () => {
  const result = await killProcessTree(4321, {
    platform: "linux",
    signalSender() {
      throw errnoError("kill ESRCH", "ESRCH");
    },
  });

  assert.equal(result.status, "exited");
  assert.equal(result.message, "Process 4321 was not running.");
});

test("createPlatformProcessTerminator adapts killProcessTree to ProcessTerminator", async () => {
  const terminator = createPlatformProcessTerminator({
    platform: "win32",
    commandRunner() {
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
      };
    },
  });

  const result = await terminator.killTree(4321, {
    processId: "process-a",
    pid: 4321,
    kind: "background",
    owned: true,
    commandLine: "node server.js",
    cwd: "Z:\\AgentArbor",
    startedAt: "2026-06-15T00:00:00.000Z",
    status: "running",
    ports: [],
    facts: [],
  });

  assert.equal(result.status, "killed");
});

test("probePlatformPortOccupant parses Windows netstat LISTENING rows", async () => {
  const requests: RuntimeGuardCommandRequest[] = [];

  const result = await probePlatformPortOccupant(portInput(5173), {
    platform: "win32",
    commandRunner(request) {
      requests.push(request);
      return commandResult([
        "  Proto  Local Address          Foreign Address        State           PID",
        "  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       12001",
      ].join("\r\n"));
    },
  });

  assert.deepEqual(result, {
    pid: 12001,
    observedBy: "netstat",
  });
  assert.deepEqual(requests.map((request) => [request.file, request.args]), [["netstat", ["-ano", "-p", "tcp"]]]);
});

test("probePlatformPortOccupant prefers Linux ss and parses pid facts", async () => {
  const result = await probePlatformPortOccupant(portInput(5173), {
    platform: "linux",
    commandRunner(request) {
      assert.equal(request.file, "ss");
      return commandResult('LISTEN 0 511 127.0.0.1:5173 0.0.0.0:* users:(("node",pid=12001,fd=21))');
    },
  });

  assert.deepEqual(result, {
    pid: 12001,
    observedBy: "ss",
  });
});

test("probePlatformPortOccupant keeps Linux ss occupancy facts when pid is unavailable", async () => {
  const result = await probePlatformPortOccupant(portInput(5173), {
    platform: "linux",
    commandRunner(request) {
      assert.equal(request.file, "ss");
      return commandResult("LISTEN 0 511 127.0.0.1:5173 0.0.0.0:*");
    },
  });

  assert.deepEqual(result, {
    observedBy: "ss",
  });
});

test("probePlatformPortOccupant falls back to lsof when Linux ss is unavailable", async () => {
  const files: string[] = [];

  const result = await probePlatformPortOccupant(portInput(5173), {
    platform: "linux",
    commandRunner(request) {
      files.push(request.file);
      if (request.file === "ss") {
        return {
          exitCode: null,
          stdout: "",
          stderr: "",
          errorCode: "ENOENT",
          errorMessage: "spawn ss ENOENT",
        };
      }
      return commandResult("p12002\n");
    },
  });

  assert.deepEqual(files, ["ss", "lsof"]);
  assert.deepEqual(result, {
    pid: 12002,
    observedBy: "lsof",
  });
});

test("probePlatformPortOccupant tolerates missing platform tools", async () => {
  const result = await probePlatformPortOccupant(portInput(5173), {
    platform: "linux",
    commandRunner() {
      return {
        exitCode: null,
        stdout: "",
        stderr: "",
        errorCode: "ENOENT",
        errorMessage: "missing command",
      };
    },
  });

  assert.equal(result, undefined);
});

test("createPlatformPortOccupantProbe returns an injectable probe function", async () => {
  const probe = createPlatformPortOccupantProbe({
    platform: "win32",
    commandRunner() {
      return commandResult("TCP    [::]:5173              [::]:0                 LISTENING       12003");
    },
  });

  assert.deepEqual(await probe(portInput(5173)), {
    pid: 12003,
    observedBy: "netstat",
  });
});

function portInput(port: number) {
  return {
    port,
    host: "127.0.0.1" as const,
    observedAt: "2026-06-15T00:00:00.000Z",
  };
}

function commandResult(stdout: string): RuntimeGuardCommandResult {
  return {
    exitCode: 0,
    stdout,
    stderr: "",
  };
}

function errnoError(message: string, code: string): Error {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}
