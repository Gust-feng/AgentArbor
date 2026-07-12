import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import ts from "typescript";

export type SourceGraph = ReadonlyMap<string, readonly string[]>;

export type SourceImportBinding = {
  readonly moduleSpecifier: string;
  readonly importedName: string;
  readonly localName: string;
  readonly typeOnly: boolean;
};

export type SourceInvocationNames = {
  readonly called: readonly string[];
  readonly constructed: readonly string[];
};

const SOURCE_EXTENSIONS = [".ts", ".tsx"] as const;
const IMPORT_SPECIFIER_PATTERN =
  /(?:import|export)\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?["']([^"']+)["']/g;

export async function buildSourceGraph(area: string): Promise<SourceGraph> {
  const root = process.cwd();
  const sourceRoot = path.join(root, area);
  const files = await collectSourceFiles(sourceRoot);
  const fileSet = new Set(files);
  const graph = new Map<string, string[]>();

  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    graph.set(file, resolveRelativeImports(file, source).filter((target) => fileSet.has(target)));
  }

  return graph;
}

export async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") {
      continue;
    }

    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(fullPath)));
    } else if (SOURCE_EXTENSIONS.includes(path.extname(entry.name) as (typeof SOURCE_EXTENSIONS)[number])) {
      files.push(fullPath);
    }
  }

  return files;
}

export async function collectOrdinaryAgentSourceFiles(): Promise<string[]> {
  const appRoot = path.join(process.cwd(), "src", "app");
  const panelServerRoot = path.join(appRoot, "panel-server");
  const files = [
    ...(await collectSourceFiles(path.join(appRoot, "basic-agent-runtime"))),
    ...(await collectDirectSourceFiles(path.join(appRoot, "desktop-agent"), (name) =>
      name.startsWith("desktop-agent-session")
    )),
    ...(await collectDirectSourceFiles(panelServerRoot, (name) => name.startsWith("basic-agent"))),
    ...(await collectDirectSourceFiles(panelServerRoot, (name) => name.startsWith("conversation"))),
  ];

  return [...new Set(files)].sort((left, right) => relativePath(left).localeCompare(relativePath(right)));
}

export async function collectDirectSourceFiles(
  directory: string,
  matchesName: (name: string) => boolean
): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });

  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        matchesName(entry.name) &&
        SOURCE_EXTENSIONS.includes(path.extname(entry.name) as (typeof SOURCE_EXTENSIONS)[number])
    )
    .map((entry) => path.join(directory, entry.name));
}

export async function readSource(file: string): Promise<string> {
  return fs.readFile(file, "utf8");
}

export function resolveRelativeImports(file: string, source: string): string[] {
  const targets: string[] = [];
  for (const specifier of importSpecifiersFrom(source)) {
    if (!specifier.startsWith(".")) {
      continue;
    }

    const target = resolveSourceSpecifier(file, specifier);
    if (target !== undefined) {
      targets.push(target);
    }
  }

  return targets;
}

export function importSpecifiersFrom(source: string): string[] {
  return [...source.matchAll(IMPORT_SPECIFIER_PATTERN)].map((match) => match[1]);
}

export function sourceImportBindings(source: string, fileName: string): readonly SourceImportBinding[] {
  const sourceFile = parseTypeScriptSource(source, fileName);
  const bindings: SourceImportBinding[] = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) {
      continue;
    }
    const importClause = statement.importClause;
    if (importClause === undefined) {
      continue;
    }
    const moduleSpecifier = statement.moduleSpecifier.text;
    if (importClause.name !== undefined) {
      bindings.push({
        moduleSpecifier,
        importedName: "default",
        localName: importClause.name.text,
        typeOnly: importClause.isTypeOnly,
      });
    }
    const namedBindings = importClause.namedBindings;
    if (namedBindings === undefined) {
      continue;
    }
    if (ts.isNamespaceImport(namedBindings)) {
      bindings.push({
        moduleSpecifier,
        importedName: "*",
        localName: namedBindings.name.text,
        typeOnly: importClause.isTypeOnly,
      });
      continue;
    }
    for (const element of namedBindings.elements) {
      bindings.push({
        moduleSpecifier,
        importedName: element.propertyName?.text ?? element.name.text,
        localName: element.name.text,
        typeOnly: importClause.isTypeOnly || element.isTypeOnly,
      });
    }
  }

  return bindings;
}

export function sourceInvocationNames(source: string, fileName: string): SourceInvocationNames {
  const sourceFile = parseTypeScriptSource(source, fileName);
  const called = new Set<string>();
  const constructed = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = invokedExpressionName(node.expression);
      if (name !== undefined) {
        called.add(name);
      }
    } else if (ts.isNewExpression(node)) {
      const name = invokedExpressionName(node.expression);
      if (name !== undefined) {
        constructed.add(name);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return {
    called: [...called].sort(),
    constructed: [...constructed].sort(),
  };
}

export function isSiblingBarrelImport(specifier: string): boolean {
  return /^(\.\.\/|\.\/)[^/]+\/index\.js$/.test(specifier);
}

export function fileExistsSync(file: string): boolean {
  return existsSync(file);
}

export function isTestAssetSource(file: string): boolean {
  const normalized = relativePath(file);
  return normalized.endsWith(".test.ts") || normalized.includes("/integration-tests/") || normalized.includes("/tests/");
}

export function findDependencyCycles(graph: SourceGraph, maxLength: number): string[][] {
  const cycles = new Map<string, string[]>();

  for (const start of graph.keys()) {
    const stack = [start];
    const visited = new Set([start]);

    searchDependencyCycles(start, start, stack, visited, graph, cycles, maxLength);
  }

  return [...cycles.values()].sort(compareCycle);
}

export function findDependencyPathsTo(
  graph: SourceGraph,
  startFiles: readonly string[],
  isForbiddenTarget: (file: string) => boolean
): string[][] {
  const violations: string[][] = [];
  const queue = startFiles.map((start) => [start]);
  const visited = new Set(startFiles);
  const foundTargets = new Set<string>();

  while (queue.length > 0) {
    const currentPath = queue.shift();
    if (currentPath === undefined) {
      break;
    }
    const current = currentPath[currentPath.length - 1];
    if (current === undefined) {
      continue;
    }
    for (const next of graph.get(current) ?? []) {
      if (isForbiddenTarget(next)) {
        if (!foundTargets.has(next)) {
          foundTargets.add(next);
          violations.push([...currentPath, next]);
        }
        continue;
      }
      if (visited.has(next)) {
        continue;
      }
      visited.add(next);
      queue.push([...currentPath, next]);
    }
  }

  return violations;
}

export function relativePath(file: string): string {
  return path.relative(process.cwd(), file).replaceAll(path.sep, "/");
}

function resolveSourceSpecifier(file: string, specifier: string): string | undefined {
  const withoutJsExtension = path.resolve(path.dirname(file), specifier).replace(/\.js$/, "");
  const candidates = [
    `${withoutJsExtension}.ts`,
    `${withoutJsExtension}.tsx`,
    path.join(withoutJsExtension, "index.ts"),
    path.join(withoutJsExtension, "index.tsx"),
  ];

  return candidates.find((candidate) => fileExistsSync(candidate));
}

function parseTypeScriptSource(source: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

function invokedExpressionName(expression: ts.LeftHandSideExpression): string | undefined {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression !== undefined &&
    ts.isStringLiteralLike(expression.argumentExpression)
  ) {
    return expression.argumentExpression.text;
  }
  return undefined;
}

function searchDependencyCycles(
  start: string,
  current: string,
  stack: string[],
  visited: Set<string>,
  graph: SourceGraph,
  cycles: Map<string, string[]>,
  maxLength: number
): void {
  if (stack.length > maxLength) {
    return;
  }

  for (const next of graph.get(current) ?? []) {
    if (next === start && stack.length > 1) {
      const cycle = canonicalCycle(stack.map(relativePath));
      cycles.set(cycle.join(" -> "), cycle);
      continue;
    }

    if (visited.has(next)) {
      continue;
    }

    visited.add(next);
    stack.push(next);
    searchDependencyCycles(start, next, stack, visited, graph, cycles, maxLength);
    stack.pop();
    visited.delete(next);
  }
}

function canonicalCycle(cycle: string[]): string[] {
  let best = cycle;
  for (let index = 1; index < cycle.length; index += 1) {
    const rotated = [...cycle.slice(index), ...cycle.slice(0, index)];
    if (rotated.join("\n") < best.join("\n")) {
      best = rotated;
    }
  }

  return best;
}

function compareCycle(left: string[], right: string[]): number {
  return left.length - right.length || left.join("").localeCompare(right.join(""));
}
