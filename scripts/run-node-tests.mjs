import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Multi-Agent 源码已归档到 src/deferred/，被 tsconfig.json 排除，不会编译进 dist。
// 因此这里不再需要按文件名过滤延期用例；归档代码由 pnpm test:deferred 单独验证。
const distRoot = path.join(repoRoot, "dist");

const productionTestFiles = (await collectTestFiles(distRoot))
  .map((filePath) => path.relative(repoRoot, filePath))
  .sort((left, right) => left.localeCompare(right));

console.log(`Running ${productionTestFiles.length} production test files with concurrency 4.`);
await runNodeTests(productionTestFiles, 4);

async function collectTestFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
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
  if (files.length === 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--test", `--test-concurrency=${concurrency}`, ...files],
      {
        cwd: repoRoot,
        stdio: "inherit",
        windowsHide: true,
      },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(
        signal === null
          ? `Node test runner exited with code ${code ?? "unknown"}.`
          : `Node test runner was terminated by signal ${signal}.`,
      ));
    });
  });
}
