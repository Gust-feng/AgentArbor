import assert from "node:assert/strict";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  collectSourceFiles,
  importSpecifiersFrom,
  isTestAssetSource,
  relativePath,
  resolveRelativeImports,
} from "./source-structure-test-utils.js";

test("Tool Registry remains owned by ToolCenter without an Ordinary compatibility facade", async () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const toolCenterRoot = path.join(appRoot, "tool-center");
  const registryOwner = path.join(toolCenterRoot, "tool-registry.ts");
  const files = (await collectSourceFiles(appRoot)).filter((file) => !isTestAssetSource(file));
  const violations: string[] = [];

  assert.equal(existsSync(registryOwner), true, "ToolCenter must own the Tool Registry implementation");

  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    for (const target of resolveRelativeImports(file, source)) {
      if (path.basename(target) === "tool-registry.ts" && !isPathWithin(target, toolCenterRoot)) {
        violations.push(`${relativePath(file)} -> ${relativePath(target)}`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    "production code must import Tool Registry contracts from tool-center",
  );
});

test("production code does not restore or import retired app runtime facades", async () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const retiredRoots = [
    path.join(appRoot, "basic-agent-runtime"),
    path.join(appRoot, "run-read-model"),
    path.join(appRoot, "underground"),
  ];
  const retiredFilePrefixes = ["desktop-agent-session", "desktop-chat-session", "minimal-runtime"];
  const violations: string[] = [];

  for (const root of retiredRoots) {
    assert.equal(existsSync(root), false, `${relativePath(root)} must remain retired`);
  }

  const files = (await collectSourceFiles(appRoot)).filter((file) => !isTestAssetSource(file));
  for (const file of files) {
    const sourceName = path.basename(file, path.extname(file));
    if (retiredFilePrefixes.some((prefix) => sourceName.startsWith(prefix))) {
      violations.push(`${relativePath(file)} restored a retired runtime facade`);
    }
    const source = await fs.readFile(file, "utf8");
    for (const specifier of importSpecifiersFrom(source)) {
      if (!specifier.startsWith(".")) continue;
      const target = unresolvedSourceTarget(file, specifier);
      if (
        retiredRoots.some((root) => isPathWithin(target, root)) ||
        retiredFilePrefixes.some((prefix) => path.basename(target).startsWith(prefix))
      ) {
        violations.push(`${relativePath(file)} -> ${specifier}`);
      }
    }
  }

  assert.deepEqual(violations, [], "production code must import current feature and capability owners directly");
});

test("ToolCenter owns executor fact normalization while adapters only normalize explicit failure facts", async () => {
  const root = process.cwd();
  const sourceRoot = path.join(root, "src");
  const mcpAdapter = path.join(sourceRoot, "adapters", "mcp", "mcp-tool-adapter.ts");
  const agentSessionLoopAdapter = path.join(
    sourceRoot,
    "adapters",
    "intelligence",
    "agent-session-loop.ts",
  );
  const fileSystemSessionAdapter = path.join(
    sourceRoot,
    "adapters",
    "intelligence",
    "file-system-agent-session-repository.ts",
  );
  const allowedCallers = new Set([
    path.join(sourceRoot, "app", "tool-center", "tool-center.ts"),
    path.join(sourceRoot, "domain", "tools", "fact-value.ts"),
    path.join(sourceRoot, "domain", "tools", "error-facts.ts"),
    mcpAdapter,
    agentSessionLoopAdapter,
    fileSystemSessionAdapter,
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
  const agentSessionLoop = await fs.readFile(agentSessionLoopAdapter, "utf8");
  assert.equal(
    agentSessionLoop.includes("normalizeToolFactValue("),
    true,
    "the Agent Session adapter must normalize unknown tool params at its external boundary",
  );
  assert.equal(
    agentSessionLoop.includes("normalizeToolErrorFacts("),
    false,
    "the Agent Session adapter must trust ToolCenter error facts",
  );
});

function unresolvedSourceTarget(file: string, specifier: string): string {
  return path.resolve(path.dirname(file), specifier.replace(/\.js$/u, ""));
}

function isPathWithin(file: string, directory: string): boolean {
  const relative = path.relative(directory, file);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
