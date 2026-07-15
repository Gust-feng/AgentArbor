import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  collectSourceFiles,
  fileExistsSync,
  isTestAssetSource,
  relativePath,
  resolveRelativeImports,
} from "./source-structure-test-utils.js";

const APP_ROOT = path.join(process.cwd(), "src", "app");
const PANEL_SERVER_ROOT = path.join(APP_ROOT, "panel-server");

test("panel server integration tests stay under panel-server ownership", async () => {
  const integrationRoot = path.join(PANEL_SERVER_ROOT, "integration-tests");
  const misplaced = (await fs.readdir(APP_ROOT, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^panel-server-.*\.test\.ts$/u.test(entry.name))
    .map((entry) => entry.name);

  assert.deepEqual(misplaced, []);
  assert.equal(
    fileExistsSync(path.join(integrationRoot, "panel-server-ordinary-feature-api.test.ts")),
    true,
    "the production Ordinary route must keep an integration contract under panel-server ownership",
  );
});

test("production Panel code does not import shared test fixtures", async () => {
  const testingRoot = path.join(APP_ROOT, "testing");
  const violations: string[] = [];

  for (const file of await collectSourceFiles(PANEL_SERVER_ROOT)) {
    if (isTestAssetSource(file)) continue;
    const source = await fs.readFile(file, "utf8");
    for (const target of resolveRelativeImports(file, source)) {
      if (target.startsWith(testingRoot)) {
        violations.push(`${relativePath(file)} -> ${relativePath(target)}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("Ordinary feature source cannot depend on Panel adapters or read models", async () => {
  const ordinaryRoot = path.join(APP_ROOT, "ordinary-agent");
  const panelRoots = [
    PANEL_SERVER_ROOT,
    path.join(APP_ROOT, "panel-ui"),
    path.join(APP_ROOT, "panel-read-model"),
    path.join(APP_ROOT, "panel-conversation"),
  ];
  const violations: string[] = [];

  for (const file of await collectSourceFiles(ordinaryRoot)) {
    if (isTestAssetSource(file)) continue;
    const source = await fs.readFile(file, "utf8");
    for (const target of resolveRelativeImports(file, source)) {
      if (panelRoots.some((root) => target.startsWith(root))) {
        violations.push(`${relativePath(file)} -> ${relativePath(target)}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});
