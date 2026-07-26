import assert from "node:assert/strict";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

import { collectSourceFiles, relativePath } from "./source-structure-test-utils.js";

/**
 * 归档区（`src/deferred/`）的边界守卫。
 *
 * Multi-Agent 实现按 ADR-0025 保留内部闭环，但不由生产 Composition Root 装配，
 * `/api/deep/*` 固定返回 410。它被移出 `src/app/`、排除出 `tsconfig.json` 与
 * `pnpm test`，以免约 3 万行不可达代码持续占用主干构建时间与重构面。
 *
 * 归档要成立必须同时满足两个方向的约束：
 * 1. 生产代码不能依赖归档区，否则归档只是换了个目录名。
 * 2. 归档区必须仍能编译、仍被 `pnpm test:deferred` 覆盖，否则它会静默腐烂，
 *    等到未来恢复时才发现无法使用。
 *
 * 详见 `docs/开发指南/06-工程实现/17-Multi-Agent源码归档边界.md`。
 */
const DEFERRED_ROOT = path.join(process.cwd(), "src", "deferred");

test("production source never imports the deferred archive", async () => {
  const root = process.cwd();
  const productionRoots = [
    path.join(root, "src", "app"),
    path.join(root, "src", "adapters"),
    path.join(root, "src", "domain"),
    path.join(root, "src", "kernel"),
  ];

  const files = (await Promise.all(productionRoots.map((dir) => collectSourceFiles(dir)))).flat();
  const violations: string[] = [];

  for (const file of files) {
    const relative = relativePath(file);
    const source = await fs.readFile(file, "utf8");

    for (const match of source.matchAll(/from\s+["']([^"']+)["']/gu)) {
      const specifier = match[1] ?? "";
      // 结构测试可以按路径读取归档源码做契约比对，但不能 import 它的运行时。
      if (specifier.includes("/deferred/") || specifier.startsWith("../deferred")) {
        violations.push(`${relative} imports ${specifier}`);
      }
    }
  }

  assert.deepEqual(
    violations.sort(),
    [],
    "src/deferred is archived and must stay unreachable from production code; " +
      "reviving Multi-Agent requires moving it back under src/app with an explicit ADR",
  );
});

test("the deferred archive keeps its own build and test entry points", async () => {
  const root = process.cwd();

  // 归档区必须真实存在且非空，否则说明归档被误删而不是被恢复。
  assert.equal(existsSync(DEFERRED_ROOT), true, "src/deferred must exist while Multi-Agent stays deferred");
  const deferredFiles = await collectSourceFiles(DEFERRED_ROOT);
  assert.equal(deferredFiles.length > 0, true, "src/deferred must retain the archived implementation");
  assert.equal(
    deferredFiles.some((file) => file.endsWith(".test.ts")),
    true,
    "the archive must keep executable tests so it cannot rot unnoticed",
  );

  const [tsconfig, deferredTsconfig, packageJson] = await Promise.all([
    fs.readFile(path.join(root, "tsconfig.json"), "utf8"),
    fs.readFile(path.join(root, "tsconfig.deferred.json"), "utf8"),
    fs.readFile(path.join(root, "package.json"), "utf8"),
  ]);

  // 主构建排除归档，否则归档代码仍会进入 dist 并被主测试发现。
  assert.match(tsconfig, /"src\/deferred"/u, "tsconfig.json must exclude src/deferred from the main build");
  // 归档构建必须重新纳入它，否则归档无法编译验证。
  assert.doesNotMatch(
    deferredTsconfig,
    /"exclude":\s*\[[^\]]*"src\/deferred"/su,
    "tsconfig.deferred.json must still compile src/deferred",
  );

  const scripts = (JSON.parse(packageJson) as { readonly scripts?: Record<string, string> }).scripts ?? {};
  assert.equal(typeof scripts["build:deferred"], "string", "pnpm build:deferred must stay available");
  assert.equal(typeof scripts["test:deferred"], "string", "pnpm test:deferred must stay available");
  // 归档验证不应混入主干测试，否则归档节省的时间会被重新消耗掉。
  assert.equal(
    (scripts["test"] ?? "").includes("test:deferred"),
    false,
    "pnpm test must stay free of the deferred archive",
  );
});
