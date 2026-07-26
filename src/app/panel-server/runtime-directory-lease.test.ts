import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  acquirePanelRuntimeDirectoryLease,
  PanelRuntimeDirectoryInUseError,
} from "./runtime-directory-lease.js";

test("panel runtime directory has one live writer and can be acquired again after release", async (t) => {
  const runtimeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-runtime-lease-"));
  t.after(() => fs.rm(runtimeDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const first = await acquirePanelRuntimeDirectoryLease(runtimeDirectory);
  t.after(() => first.release());

  await assert.rejects(
    acquirePanelRuntimeDirectoryLease(runtimeDirectory),
    (error: unknown) => error instanceof PanelRuntimeDirectoryInUseError &&
      error.code === "panel_runtime_directory_in_use" &&
      error.ownerPid === process.pid,
  );

  await first.release();
  const next = await acquirePanelRuntimeDirectoryLease(runtimeDirectory);
  await next.release();
});
