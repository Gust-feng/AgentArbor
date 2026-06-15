import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

export async function ensurePidExited(pid: number | undefined, timeoutMs: number): Promise<void> {
  if (pid === undefined) {
    await delay(100);
    return;
  }
  if (await waitForPidExit(pid, timeoutMs)) {
    return;
  }
  await forceKillPidTree(pid);
  await waitForPidExit(pid, 2_000);
}

async function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  for (;;) {
    if (!isPidRunning(pid)) {
      return true;
    }
    if (Date.now() - startedAt > timeoutMs) {
      return false;
    }
    await delay(100);
  }
}

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function forceKillPidTree(pid: number): Promise<void> {
  if (process.platform === "win32") {
    await runProcess("taskkill", ["/pid", String(pid), "/T", "/F"]);
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already exited.
    }
  }
}

async function runProcess(file: string, args: readonly string[]): Promise<void> {
  await new Promise<void>((resolve) => {
    const child = spawn(file, [...args], {
      windowsHide: true,
      stdio: "ignore",
    });
    child.once("error", () => resolve());
    child.once("close", () => resolve());
  });
}
