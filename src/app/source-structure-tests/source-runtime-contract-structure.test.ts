import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  collectSourceFiles,
  importSpecifiersFrom,
  isTestAssetSource,
  readSource,
  relativePath,
  resolveRelativeImports,
} from "./source-structure-test-utils.js";

const APP_ROOT = path.join(process.cwd(), "src", "app");
const ORDINARY_ROOT = path.join(APP_ROOT, "ordinary-agent");

test("OrdinaryAgentFeature owns its state and does not depend on Panel or retired Ordinary implementations", async () => {
  const forbiddenRoots = [
    path.join(APP_ROOT, "basic-agent-runtime"),
    path.join(APP_ROOT, "panel-server"),
    path.join(APP_ROOT, "panel-ui"),
    path.join(APP_ROOT, "panel-read-model"),
    path.join(APP_ROOT, "panel-conversation"),
    path.join(APP_ROOT, "deep"),
  ];
  const violations: string[] = [];

  for (const file of await collectSourceFiles(ORDINARY_ROOT)) {
    if (isTestAssetSource(file)) continue;
    const source = await readSource(file);
    for (const target of resolveRelativeImports(file, source)) {
      if (forbiddenRoots.some((root) => target.startsWith(root))) {
        violations.push(`${relativePath(file)} -> ${relativePath(target)}`);
      }
    }
    for (const specifier of importSpecifiersFrom(source)) {
      if (specifier === "@openai/agents" || specifier === "openai") {
        violations.push(`${relativePath(file)} -> ${specifier}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("neutral model runtime does not depend on Ordinary or Multi-Agent features", async () => {
  const modelRuntimeRoot = path.join(APP_ROOT, "model-runtime");
  const featureRoots = [ORDINARY_ROOT, path.join(APP_ROOT, "deep")];
  const violations: string[] = [];

  for (const file of await collectSourceFiles(modelRuntimeRoot)) {
    if (isTestAssetSource(file)) continue;
    const source = await fs.readFile(file, "utf8");
    for (const target of resolveRelativeImports(file, source)) {
      if (featureRoots.some((root) => target.startsWith(root))) {
        violations.push(`${relativePath(file)} -> ${relativePath(target)}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("panel server resolves Ordinary definitions through the runtime catalog", async () => {
  const panelServerRoot = path.join(APP_ROOT, "panel-server");
  const defaultDefinition = path.join(APP_ROOT, "agent-prompts", "desktop-root-agent.ts");
  const violations: string[] = [];

  for (const file of await collectSourceFiles(panelServerRoot)) {
    if (isTestAssetSource(file)) continue;
    const source = await readSource(file);
    for (const target of resolveRelativeImports(file, source)) {
      if (target === defaultDefinition) {
        violations.push(`${relativePath(file)} -> ${relativePath(target)}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});
