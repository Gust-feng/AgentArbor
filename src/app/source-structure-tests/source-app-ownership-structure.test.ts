import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  collectDirectSourceFiles,
  collectSourceFiles,
  importSpecifiersFrom,
  relativePath,
} from "./source-structure-test-utils.js";

const APP_ROOT = path.join(process.cwd(), "src", "app");
const TOP_LEVEL_COMPATIBILITY_FACADE =
  /^(?:export\s+\*\s+from\s+["']\.\/[^"']+\/[^"']+\.js["'];\s*)+$/u;

test("active app entrypoints stay thin and delegate to their owners", async () => {
  const [panelEntrypoint, smokeEntrypoint, panelCli] = await Promise.all([
    fs.readFile(path.join(APP_ROOT, "panel.ts"), "utf8"),
    fs.readFile(path.join(APP_ROOT, "real-ai-smoke.ts"), "utf8"),
    fs.readFile(path.join(APP_ROOT, "panel-server", "panel-cli.ts"), "utf8"),
  ]);

  assert.deepEqual(importSpecifiersFrom(panelEntrypoint), ["./panel-server/panel-cli.js"]);
  assert.deepEqual(importSpecifiersFrom(smokeEntrypoint), ["./smoke/real-ai-smoke.js"]);
  assert.equal(panelEntrypoint.includes("startLocalPanelServer"), false);
  assert.equal(panelEntrypoint.includes("process.on"), false);
  assert.equal(panelCli.includes("export async function runPanelCli"), true);
});

test("top-level app sources do not recreate compatibility re-export facades", async () => {
  const topLevelSources = await collectDirectSourceFiles(APP_ROOT, (name) => !name.endsWith(".test.ts"));
  const facades: string[] = [];

  for (const file of topLevelSources) {
    const source = await fs.readFile(file, "utf8");
    if (TOP_LEVEL_COMPATIBILITY_FACADE.test(source.trim())) {
      facades.push(relativePath(file));
    }
  }

  assert.deepEqual(
    facades,
    [],
    "callers must import the owning app module directly instead of restoring top-level aliases",
  );
});

test("structure tests stay under their owning test modules", async () => {
  const misplaced = await collectDirectSourceFiles(
    APP_ROOT,
    (name) => name.includes("structure") && name.endsWith(".test.ts"),
  );
  assert.deepEqual(misplaced.map(relativePath), []);

  for (const owner of ["panel-structure-tests", "source-structure-tests", "runtime-boundary-tests"]) {
    const files = await collectSourceFiles(path.join(APP_ROOT, owner));
    assert.equal(
      files.some((file) => file.endsWith(".test.ts")),
      true,
      `${owner} must keep executable architecture tests`,
    );
  }
});

test("desktop shell implementation stays under desktop ownership", async () => {
  const entrypoint = await fs.readFile(path.join(APP_ROOT, "panel-desktop.ts"), "utf8");
  const topLevelDesktopImplementations = await collectDirectSourceFiles(
    APP_ROOT,
    (name) => name.startsWith("panel-desktop-") || name.startsWith("panel-startup-"),
  );
  const desktopSources = await collectSourceFiles(path.join(APP_ROOT, "desktop"));

  assert.deepEqual(importSpecifiersFrom(entrypoint), ["./desktop/panel-desktop-main.js"]);
  assert.deepEqual(topLevelDesktopImplementations.map(relativePath), []);
  assert.equal(desktopSources.some((file) => file.endsWith("panel-desktop-main.ts")), true);
});
