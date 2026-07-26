import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { renameWithRetry } from "./atomic-write.js";

async function tempRoot(t: test.TestContext): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-atomic-rename-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  return root;
}

test("renameWithRetry moves a file in the common non-contended case", async (t) => {
  const root = await tempRoot(t);
  const source = path.join(root, "source.tmp");
  const target = path.join(root, "target.json");
  await fs.writeFile(source, "payload", "utf8");

  await renameWithRetry(source, target);

  assert.equal(await fs.readFile(target, "utf8"), "payload");
  assert.equal(await fs.access(source).then(() => true, () => false), false);
});

test("renameWithRetry retries every transient platform code the stores depend on", async (t) => {
  const root = await tempRoot(t);

  // EBUSY 曾在配置存储的判定集合中缺失，导致 Windows 上配置写入直接失败而不重试。
  for (const code of ["EPERM", "EACCES", "EBUSY", "ENOTEMPTY"]) {
    const source = path.join(root, `${code}.tmp`);
    const target = path.join(root, `${code}.json`);
    await fs.writeFile(source, code, "utf8");

    const original = fs.rename;
    let attempts = 0;
    fs.rename = (async (from: Parameters<typeof fs.rename>[0], to: Parameters<typeof fs.rename>[1]) => {
      attempts += 1;
      if (attempts < 3) {
        throw Object.assign(new Error(`simulated ${code}`), { code });
      }
      await original(from, to);
    }) as typeof fs.rename;

    try {
      await renameWithRetry(source, target, { backoffMs: () => 0 });
    } finally {
      fs.rename = original;
    }

    assert.equal(attempts, 3, `${code} must be retried until it succeeds`);
    assert.equal(await fs.readFile(target, "utf8"), code);
  }
});

test("renameWithRetry rethrows non-transient errors without retrying", async (t) => {
  const root = await tempRoot(t);
  const source = path.join(root, "source.tmp");
  const target = path.join(root, "target.json");
  await fs.writeFile(source, "payload", "utf8");

  const original = fs.rename;
  let attempts = 0;
  fs.rename = (async () => {
    attempts += 1;
    throw Object.assign(new Error("simulated ENOENT"), { code: "ENOENT" });
  }) as typeof fs.rename;

  try {
    await assert.rejects(
      () => renameWithRetry(source, target, { backoffMs: () => 0 }),
      (error: unknown) => (error as { code?: string }).code === "ENOENT",
    );
  } finally {
    fs.rename = original;
  }

  assert.equal(attempts, 1, "non-transient failures must fail fast");
});

test("renameWithRetry surfaces the original errno after exhausting attempts", async (t) => {
  const root = await tempRoot(t);
  const source = path.join(root, "source.tmp");
  const target = path.join(root, "target.json");
  await fs.writeFile(source, "payload", "utf8");

  const original = fs.rename;
  let attempts = 0;
  fs.rename = (async () => {
    attempts += 1;
    throw Object.assign(new Error("simulated EBUSY"), { code: "EBUSY" });
  }) as typeof fs.rename;

  try {
    await assert.rejects(
      () => renameWithRetry(source, target, { maxAttempts: 3, backoffMs: () => 0 }),
      (error: unknown) => (error as { code?: string }).code === "EBUSY",
    );
  } finally {
    fs.rename = original;
  }

  assert.equal(attempts, 3, "the caller-provided attempt budget must be respected");
});
