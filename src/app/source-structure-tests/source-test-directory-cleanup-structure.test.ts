import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

import { collectSourceFiles, relativePath } from "./source-structure-test-utils.js";

/**
 * 测试临时目录清理的结构守卫。
 *
 * Windows 上防病毒扫描或搜索索引器会短暂持有测试目录内的文件句柄，导致不带重试
 * 的递归 rm 抛 ENOTEMPTY / EPERM / EBUSY，把通过的测试标成假失败。全仓曾有 134
 * 处此类裸清理，已统一为带 `maxRetries` 的形式；本守卫阻止裸写法回流。
 *
 * 新测试优先使用 `src/app/testing/fs-test-directories.ts` 的
 * `removeTestDirectory`，或至少给 rm 带上 `maxRetries`。
 */
const BARE_RECURSIVE_RM = /\b(?:fs\.)?rm(?:Sync)?\([^)]*recursive:\s*true[^)]*\)/gu;

test("test files never remove directories without Windows retry options", async () => {
  const root = process.cwd();
  const areas = ["src/app", "src/adapters", "src/domain", "src/kernel", "src/deferred"];
  const files = (await Promise.all(areas.map((area) => collectSourceFiles(path.join(root, area)))))
    .flat()
    .filter((file) => file.endsWith(".test.ts") || file.endsWith(".test.tsx"));

  const violations: string[] = [];

  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    for (const match of source.matchAll(BARE_RECURSIVE_RM)) {
      if (match[0].includes("maxRetries")) continue;
      const line = source.slice(0, match.index).split("\n").length;
      violations.push(`${relativePath(file)}:${line} ${match[0].split("\n")[0]}`);
    }
  }

  assert.deepEqual(
    violations.sort(),
    [],
    "recursive test-directory removal must set maxRetries (use removeTestDirectory from src/app/testing/fs-test-directories.ts); " +
      "bare rm intermittently fails on Windows while antivirus or the search indexer holds a handle",
  );
});
