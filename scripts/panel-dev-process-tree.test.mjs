import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { stopDevelopmentProcessTree } from "./panel-dev-process-tree.mjs";

test("development cleanup uses taskkill for the full Windows child tree", async () => {
  const commands = [];
  const child = { pid: 8123, exitCode: null, signalCode: null, kill: () => assert.fail("should use taskkill") };

  await stopDevelopmentProcessTree(child, {
    platform: "win32",
    spawnProcess: (file, args, options) => {
      commands.push({ file, args, options });
      const taskkill = new EventEmitter();
      queueMicrotask(() => taskkill.emit("exit", 0, null));
      return taskkill;
    },
  });

  assert.deepEqual(commands, [{
    file: "taskkill",
    args: ["/pid", "8123", "/T", "/F"],
    options: { stdio: "ignore", windowsHide: true },
  }]);
});

test("development cleanup terminates the detached POSIX process group", async () => {
  const signals = [];
  const child = { pid: 8124, exitCode: null, signalCode: null, kill: () => assert.fail("should signal process group") };

  await stopDevelopmentProcessTree(child, {
    platform: "linux",
    signalProcess: (pid, signal) => {
      signals.push({ pid, signal });
    },
  });

  assert.deepEqual(signals, [{ pid: -8124, signal: "SIGTERM" }]);
});

test("development cleanup does not touch an already exited child", async () => {
  await stopDevelopmentProcessTree({ pid: 8125, exitCode: 0, signalCode: null, kill: () => assert.fail("should not kill") }, {
    platform: "win32",
    spawnProcess: () => assert.fail("should not spawn taskkill"),
  });
});

test("development cleanup falls back to the direct child when taskkill is unavailable", async () => {
  let killCount = 0;
  const child = {
    pid: 8126,
    exitCode: null,
    signalCode: null,
    kill: (signal) => {
      assert.equal(signal, "SIGTERM");
      killCount += 1;
    },
  };

  await stopDevelopmentProcessTree(child, {
    platform: "win32",
    spawnProcess: () => {
      const taskkill = new EventEmitter();
      queueMicrotask(() => taskkill.emit("exit", 1, null));
      return taskkill;
    },
  });

  assert.equal(killCount, 1);
});
