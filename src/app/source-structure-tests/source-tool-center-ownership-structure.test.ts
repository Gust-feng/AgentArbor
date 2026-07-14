import assert from "node:assert/strict";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  collectSourceFiles,
  importSpecifiersFrom,
  isTestAssetSource,
  relativePath,
} from "./source-structure-test-utils.js";

test("Tool Registry remains owned by ToolCenter without an Ordinary compatibility facade", async () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const ordinaryRoot = path.join(appRoot, "basic-agent-runtime");
  const removedFacade = path.join(ordinaryRoot, "tool-registry.ts");
  const ordinaryBarrel = await fs.readFile(path.join(ordinaryRoot, "index.ts"), "utf8");
  const files = (await collectSourceFiles(appRoot)).filter((file) => !isTestAssetSource(file));
  const violations: string[] = [];

  assert.equal(existsSync(removedFacade), false, "the removed Ordinary Tool Registry facade must not return");
  assert.deepEqual(
    importSpecifiersFrom(ordinaryBarrel).filter((specifier) => specifier.includes("tool-registry")),
    [],
    "the Ordinary barrel must not re-export Tool Registry contracts",
  );

  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    for (const specifier of importSpecifiersFrom(source)) {
      if (specifier.replaceAll("\\", "/").includes("basic-agent-runtime/tool-registry")) {
        violations.push(`${relativePath(file)} -> ${specifier}`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    "production code must import Tool Registry contracts from tool-center",
  );
});

test("Ordinary runtime does not restore unused internal compatibility facades", async () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const ordinaryRoot = path.join(appRoot, "basic-agent-runtime");
  const ordinaryBarrel = await fs.readFile(path.join(ordinaryRoot, "index.ts"), "utf8");
  const removedFiles = [
    "conversation-compaction-common.ts",
    "conversation-compaction-contracts.ts",
    "conversation-compaction.ts",
    "conversation-history-compaction.ts",
    "loop-context-compaction.ts",
    "tool-registry.ts",
    "work-session.ts",
    "work-session-context.ts",
    "work-session-transcript.ts",
    "work-session-transcript-tools.ts",
  ];

  assert.deepEqual(
    removedFiles.filter((file) => existsSync(path.join(ordinaryRoot, file))),
    [],
    "unused Ordinary compatibility modules must not return",
  );
  assert.equal(ordinaryBarrel.includes("DesktopWorkSession"), false);
  assert.equal(ordinaryBarrel.includes("createDesktopWorkSessionReadModel"), false);
  assert.equal(ordinaryBarrel.includes("conversation-compaction"), false);
  assert.equal(existsSync(path.join(appRoot, "desktop-chat-session.ts")), false);
  assert.equal(existsSync(path.join(appRoot, "desktop-agent", "desktop-chat-session.ts")), false);
});

test("ToolCenter owns executor fact normalization while adapters only normalize explicit failure facts", async () => {
  const root = process.cwd();
  const sourceRoot = path.join(root, "src");
  const mcpAdapter = path.join(sourceRoot, "adapters", "mcp", "mcp-tool-adapter.ts");
  const allowedCallers = new Set([
    path.join(sourceRoot, "app", "tool-center", "tool-center.ts"),
    path.join(sourceRoot, "domain", "tools", "fact-value.ts"),
    path.join(sourceRoot, "domain", "tools", "error-facts.ts"),
    mcpAdapter,
  ]);
  const violations: string[] = [];
  const files = (await collectSourceFiles(sourceRoot)).filter((file) => !isTestAssetSource(file));

  for (const file of files) {
    if (allowedCallers.has(file)) {
      continue;
    }
    const source = await fs.readFile(file, "utf8");
    if (source.includes("normalizeToolFactValue(") || source.includes("normalizeToolErrorFacts(")) {
      violations.push(relativePath(file));
    }
  }

  assert.deepEqual(
    violations,
    [],
    "production consumers must trust ToolCallResult facts instead of normalizing them again",
  );
  assert.equal(
    existsSync(path.join(sourceRoot, "domain", "basic-agent", "confirmation-contracts.ts")),
    false,
    "the deleted Ordinary confirmation compatibility contract must not return",
  );
});
