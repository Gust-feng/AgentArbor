import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(repoRoot, "dist");
const serialTestKeys = new Set([
  "dist/app/panel-server/integration-tests/panel-server-deep-routes.test.js",
]);

const testFiles = (await collectTestFiles(distRoot))
  .map((filePath) => path.relative(repoRoot, filePath))
  .sort((left, right) => left.localeCompare(right));
const serialFiles = testFiles.filter((filePath) => serialTestKeys.has(pathKey(filePath)));
const parallelFiles = testFiles.filter((filePath) => !serialTestKeys.has(pathKey(filePath)));

if (serialFiles.length !== serialTestKeys.size) {
  const found = new Set(serialFiles.map(pathKey));
  const missing = [...serialTestKeys].filter((filePath) => !found.has(filePath));
  throw new Error(`Expected serial test output is missing: ${missing.join(", ")}`);
}

const failures = [];
console.log(`Running ${parallelFiles.length} test files with concurrency 4.`);
try {
  await runNodeTests(parallelFiles, 4);
} catch (error) {
  failures.push(error);
}
console.log(`Running ${serialFiles.length} timing-sensitive integration test file serially.`);
try {
  await runNodeTests(serialFiles, 1);
} catch (error) {
  failures.push(error);
}
if (failures.length > 0) {
  throw new AggregateError(failures, `${failures.length} Node test group(s) failed.`);
}

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

function pathKey(filePath) {
  return filePath.split(path.sep).join("/");
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
