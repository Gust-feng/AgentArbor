import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  buildSourceGraph,
  collectOrdinaryAgentSourceFiles,
  collectSourceFiles,
  findDependencyCycles,
  importSpecifiersFrom,
  isSiblingBarrelImport,
  relativePath,
  resolveRelativeImports,
} from "./source-structure-test-utils.js";

test("app and domain source dependencies do not form local cycles", async () => {
  for (const area of ["src/app", "src/domain"]) {
    const graph = await buildSourceGraph(area);
    const cycles = findDependencyCycles(graph, 10);

    assert.deepEqual(cycles, [], `${area} should not contain local import cycles`);
  }
});

test("domain internals avoid sibling barrel imports", async () => {
  const files = await collectSourceFiles(path.join(process.cwd(), "src", "domain"));
  const violations: string[] = [];

  for (const file of files) {
    if (path.basename(file) === "index.ts") {
      continue;
    }

    const source = await fs.readFile(file, "utf8");
    for (const specifier of importSpecifiersFrom(source)) {
      if (isSiblingBarrelImport(specifier)) {
        violations.push(`${relativePath(file)} -> ${specifier}`);
      }
    }
  }

  assert.deepEqual(violations, [], "domain implementation files should import sibling contracts directly");
});

test("domain and kernel do not depend on app or adapters", async () => {
  const root = process.cwd();
  const files = [
    ...(await collectSourceFiles(path.join(root, "src", "domain"))),
    ...(await collectSourceFiles(path.join(root, "src", "kernel"))),
  ];
  const violations: string[] = [];

  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    for (const target of resolveRelativeImports(file, source)) {
      const targetPath = relativePath(target);
      if (targetPath.startsWith("src/app/") || targetPath.startsWith("src/adapters/")) {
        violations.push(`${relativePath(file)} -> ${targetPath}`);
      }
    }
  }

  assert.deepEqual(violations, [], "domain/kernel layers must not import app or adapters");
});

test("Basic Agent runtime does not depend on panel-private modules", async () => {
  const files = await collectSourceFiles(path.join(process.cwd(), "src", "app", "basic-agent-runtime"));
  const violations: string[] = [];

  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    for (const target of resolveRelativeImports(file, source)) {
      const targetPath = relativePath(target);
      const name = path.basename(targetPath);
      if (name.startsWith("panel-")) {
        violations.push(`${relativePath(file)} -> ${targetPath}`);
      }
    }
  }

  assert.deepEqual(violations, [], "Basic Agent runtime should consume app-level contracts, not panel-private helpers");
});

test("Basic Agent runtime does not depend on underground domain contracts", async () => {
  const files = await collectSourceFiles(path.join(process.cwd(), "src", "app", "basic-agent-runtime"));
  const violations: string[] = [];

  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    for (const target of resolveRelativeImports(file, source)) {
      const targetPath = relativePath(target);
      if (targetPath.startsWith("src/domain/underground/")) {
        violations.push(`${relativePath(file)} -> ${targetPath}`);
      }
    }
  }

  assert.deepEqual(violations, [], "Basic Agent runtime should keep deep/underground structures behind app-level attachments");
});

test("ordinary Agent paths do not import top-level domain barrels", async () => {
  const files = await collectOrdinaryAgentSourceFiles();
  const forbiddenTargets = new Set([
    relativePath(path.join(process.cwd(), "src", "domain", "contracts.ts")),
    relativePath(path.join(process.cwd(), "src", "domain", "index.ts")),
  ]);
  const violations: string[] = [];

  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    for (const target of resolveRelativeImports(file, source)) {
      const targetPath = relativePath(target);
      if (forbiddenTargets.has(targetPath)) {
        violations.push(`${relativePath(file)} -> ${targetPath}`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    "ordinary Agent paths should import narrow domain contracts instead of src/domain top-level barrels"
  );
});
