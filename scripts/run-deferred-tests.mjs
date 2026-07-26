import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 归档模块（`src/deferred/`）的独立测试入口。
 *
 * Multi-Agent 实现按 ADR-0025 保留，但不由生产 Composition Root 装配，
 * `/api/deep/*` 固定返回 410。它被排除出 `tsconfig.json` 与 `pnpm test`，
 * 以免 3 万行不可达代码持续占用主干构建时间和重构面。
 *
 * 归档不等于放任腐烂：本入口把 `src/deferred/` 连同其依赖的现役模块一起编译到
 * `dist-deferred/`，再只运行归档目录下的用例。任何对现役代码的改动若破坏了归档
 * 模块的编译或行为，都会在这里暴露，而不是等到未来恢复时才发现。
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deferredRoot = path.join(repoRoot, "dist-deferred", "deferred");

/**
 * 归档模块内部仍不可运行的用例。
 *
 * `panel-server-deep-routes.test.ts` 是历史 HTTP 套件，它断言 `/api/deep/*` 返回真实
 * 业务响应；而生产 `request-handler` 已把这些路径固定为 410。这不是归档造成的回归——
 * 归档前它同样被 `run-node-tests.mjs` 的 deferredTestKeys 排除。恢复 Multi-Agent 时
 * 需要连同这套 HTTP 契约一起重新设计，届时再从本名单移除。
 */
const unrunnableTestKeys = new Set([
  "dist-deferred/deferred/panel-server-deep-routes.test.js",
]);

const testFiles = (await collectTestFiles(deferredRoot))
  .map((filePath) => path.relative(repoRoot, filePath))
  .filter((filePath) => !unrunnableTestKeys.has(filePath.split(path.sep).join("/")))
  .sort((left, right) => left.localeCompare(right));

if (testFiles.length === 0) {
  console.error(
    "No deferred test files found. Run `pnpm build:deferred` first so dist-deferred/ exists.",
  );
  process.exit(1);
}

console.log(`Running ${testFiles.length} deferred test files with concurrency 4.`);
await runNodeTests(testFiles, 4);

async function collectTestFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectTestFiles(entryPath);
    }
    return entry.isFile() && entry.name.endsWith(".test.js") ? [entryPath] : [];
  }));
  return files.flat();
}

function runNodeTests(files, concurrency) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--test", `--test-concurrency=${concurrency}`, ...files],
      { cwd: repoRoot, stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Deferred test runner exited with code ${code}.`));
    });
  });
}
