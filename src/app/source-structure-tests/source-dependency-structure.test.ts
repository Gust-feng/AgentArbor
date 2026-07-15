import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  buildSourceGraph,
  collectOrdinaryAgentSourceFiles,
  collectSourceFiles,
  findDependencyCycles,
  findDependencyPathsTo,
  importSpecifiersFrom,
  isSiblingBarrelImport,
  isTestAssetSource,
  relativePath,
  resolveRelativeImports,
  sourceImportBindings,
  sourceInvocationNames,
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

test("runtime feature modules do not depend on panel-server composition", async () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const panelServerRoot = path.join(appRoot, "panel-server");
  const featureRoots = [
    path.join(appRoot, "ordinary-agent"),
    path.join(appRoot, "sub-agents"),
    path.join(appRoot, "deep"),
    path.join(appRoot, "skills"),
    path.join(appRoot, "research"),
  ];
  const files = (await Promise.all(featureRoots.map((root) => collectSourceFiles(root))))
    .flat()
    .filter((file) => !isTestAssetSource(file));
  const graph = await buildSourceGraph("src/app");
  const violations = findDependencyPathsTo(graph, files, (target) => isPathWithin(target, panelServerRoot));

  assert.deepEqual(
    formatDependencyPaths(violations),
    [],
    "feature modules must receive composed dependencies instead of importing panel-server"
  );
});

test("Deep and Multi-Agent feature code do not depend on ordinary Desktop implementations", async () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const deepRoot = path.join(appRoot, "deep");
  const forbiddenRoots = [
    path.join(appRoot, "ordinary-agent"),
    path.join(appRoot, "desktop-agent"),
    path.join(appRoot, "sub-agents"),
  ];
  const files = (await collectSourceFiles(deepRoot)).filter((file) => !isTestAssetSource(file));
  const graph = await buildSourceGraph("src/app");
  const violations = findDependencyPathsTo(
    graph,
    files,
    (target) => forbiddenRoots.some((root) => isPathWithin(target, root))
  );

  assert.deepEqual(
    formatDependencyPaths(violations),
    [],
    "Deep/Multi-Agent must consume neutral contracts and injected services, not ordinary/Desktop implementations"
  );
});

test("Multi-Agent feature uses precise infrastructure ports instead of MinimalRuntime", async () => {
  const files = (await collectSourceFiles(path.join(process.cwd(), "src", "app", "deep")))
    .filter((file) => !isTestAssetSource(file));
  const violations: string[] = [];
  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    if (/\b(?:createMinimalRuntime|MinimalRuntime)\b/.test(source)) {
      violations.push(relativePath(file));
    }
  }
  assert.deepEqual(
    violations,
    [],
    "Multi-Agent must inject bus, constraints, soil, model, tools and stores explicitly",
  );
});

test("Ordinary Agent feature uses its exact runtime contract instead of MinimalRuntime", async () => {
  const files = (await collectOrdinaryAgentSourceFiles()).filter((file) => !isTestAssetSource(file));
  const violations: string[] = [];
  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    if (/\b(?:createMinimalRuntime|MinimalRuntime)\b/.test(source)) {
      violations.push(relativePath(file));
    }
  }
  assert.deepEqual(
    violations,
    [],
    "Ordinary Agent must own a precise session runtime instead of the legacy service locator",
  );
});

test("neutral runtime contracts and primitives do not depend on product feature implementations", async () => {
  const root = process.cwd();
  const appRoot = path.join(root, "src", "app");
  const neutralFiles = [
    ...(await collectSourceFiles(path.join(appRoot, "context-maintenance"))),
    ...(await collectSourceFiles(path.join(appRoot, "model-runtime"))),
    ...(await collectSourceFiles(path.join(root, "src", "kernel", "intelligence"))),
  ].filter((file) => !isTestAssetSource(file));
  const forbiddenRoots = [
    "ordinary-agent",
    "basic-agent-runtime",
    "desktop-agent",
    "deep",
    "research",
    "sub-agents",
    "skills",
    "panel-server",
    "panel-ui",
  ].map((directory) => path.join(appRoot, directory));
  const graph = await buildSourceGraph("src");
  const violations = findDependencyPathsTo(
    graph,
    neutralFiles,
    (target) => forbiddenRoots.some((directory) => isPathWithin(target, directory))
  );

  assert.deepEqual(
    formatDependencyPaths(violations),
    [],
    "neutral model/context contracts and primitives must not depend on product feature implementations"
  );
});

test("model runtime owns no tool construction", async () => {
  const files = (await collectSourceFiles(path.join(process.cwd(), "src", "app", "model-runtime")))
    .filter((file) => !isTestAssetSource(file));
  const violations: string[] = [];

  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    if (/create(?:Default|Configured)?ToolCenter|createAgentToolRegistry/.test(source)) {
      violations.push(relativePath(file));
    }
  }

  assert.deepEqual(violations, [], "model-runtime must create providers/channels only; tool assembly belongs to tool-center");
});

test("model-runtime is the only production owner allowed to create the OpenAI Agents loop adapter", async () => {
  const root = process.cwd();
  const adapterDefinition = path.join(root, "src", "adapters", "intelligence", "openai-agents-loop.ts");
  const modelRuntimeRoot = path.join(root, "src", "app", "model-runtime");
  const files = (await collectSourceFiles(path.join(root, "src")))
    .filter((file) => !isTestAssetSource(file));
  const violations: string[] = [];

  for (const file of files) {
    if (file === adapterDefinition || isPathWithin(file, modelRuntimeRoot)) {
      continue;
    }
    const source = await fs.readFile(file, "utf8");
    if (/\bcreateOpenAIAgentsLoop\s*\(/u.test(source)) {
      violations.push(relativePath(file));
    }
  }

  assert.deepEqual(
    violations,
    [],
    "features and hosts must request AgentLoop from model-runtime instead of constructing the provider adapter",
  );
});

test("AgentTurnRuntime exposes only explicit feature-neutral execution semantics", async () => {
  const file = path.join(process.cwd(), "src", "kernel", "intelligence", "agent-turn-runtime.ts");
  const source = await fs.readFile(file, "utf8");
  assert.equal(source.includes("executeAutonomous"), false);
  assert.equal(source.includes("resumeAutonomous"), false);
  assert.equal(source.includes("finish_task"), false);
  assert.equal(source.includes("AgentTurnExecutionSemantics"), true);
});

test("tool infrastructure does not depend on product feature implementations", async () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const files = (await collectSourceFiles(path.join(appRoot, "tool-center")))
    .filter((file) => !isTestAssetSource(file));
  const forbiddenRoots = [
    "ordinary-agent",
    "basic-agent-runtime",
    "desktop-agent",
    "deep",
    "research",
    "sub-agents",
    "skills",
    "panel-server",
    "panel-ui",
  ].map((directory) => path.join(appRoot, directory));
  const graph = await buildSourceGraph("src/app");
  const violations = findDependencyPathsTo(
    graph,
    files,
    (target) => forbiddenRoots.some((directory) => isPathWithin(target, directory))
  );

  assert.deepEqual(
    formatDependencyPaths(violations),
    [],
    "tool-center must expose neutral execution and registry capabilities without importing product features"
  );
  const productScopeLeaks: string[] = [];
  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    if (source.includes('"desktop-basic"')) {
      productScopeLeaks.push(relativePath(file));
    }
  }
  assert.deepEqual(productScopeLeaks, [], "neutral tool infrastructure must not choose a Desktop scope");
});

test("MultiAgentFeature is constructed only by the panel runtime composition root", async () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const compositionRoot = path.join(appRoot, "panel-server", "runtime.ts");
  const productionFiles = (await collectSourceFiles(appRoot)).filter((file) => !isTestAssetSource(file));
  const callSites: string[] = [];

  for (const file of productionFiles) {
    const source = await fs.readFile(file, "utf8");
    const invocations = sourceInvocationNames(source, file);
    const factoryBindings = sourceImportBindings(source, file)
      .filter((binding) => binding.importedName === "createMultiAgentFeature" && !binding.typeOnly);
    if (factoryBindings.some((binding) => invocations.called.includes(binding.localName))) {
      callSites.push(relativePath(file));
    }
  }

  assert.deepEqual(
    callSites.sort(),
    [relativePath(compositionRoot)],
    "only panel-server/runtime.ts may call createMultiAgentFeature in production"
  );
});

test("MultiAgentFeature facade does not expose owned stores or lifecycle registries", async () => {
  const file = path.join(process.cwd(), "src", "app", "deep", "multi-agent-feature.ts");
  const source = await fs.readFile(file, "utf8");
  const publicFacade = source.slice(
    source.indexOf("export type MultiAgentFeature ="),
    source.indexOf("type MultiAgentFeatureRuntime ="),
  );
  for (const forbidden of [
    "conversationStore",
    "runRecordStore",
    "childMessageStore",
    "childLoopContextStore",
    "childContinuations",
    "childInstructionQueues",
    "registerControlHandle",
    "controlHandleForRun",
    "trackActiveRun",
    "rememberRunFacts",
    "saveConversation",
    "nextTurnOrdinal",
    "executeIntake",
    "createRuntimeConfigForRun",
    "createTurnRuntimeForExistingRun",
  ]) {
    assert.equal(publicFacade.includes(forbidden), false, `${forbidden} must remain feature-internal`);
  }
});

test("deep routes consume composed Multi-Agent services without constructing runtime or stores", async () => {
  const deepRoutes = path.join(process.cwd(), "src", "app", "panel-server", "deep-routes.ts");
  const source = await fs.readFile(deepRoutes, "utf8");
  const forbiddenImports = sourceImportBindings(source, deepRoutes)
    .filter((binding) =>
      isForbiddenDeepRouteImport(binding.importedName) || isForbiddenDeepRouteImport(binding.localName)
    )
    .map((binding) => `${binding.moduleSpecifier}:${binding.importedName}`)
    .sort();
  const invocations = sourceInvocationNames(source, deepRoutes);
  const forbiddenCalls = invocations.called.filter(isForbiddenDeepRouteInvocation);
  const forbiddenConstructions = invocations.constructed.filter(isForbiddenDeepRouteInvocation);

  assert.deepEqual(forbiddenImports, [], "deep-routes must not import MinimalRuntime or concrete Deep store factories");
  assert.deepEqual(forbiddenCalls, [], "deep-routes must not call MinimalRuntime or concrete Deep store factories");
  assert.deepEqual(forbiddenConstructions, [], "deep-routes must not instantiate Deep runtime-owned stores");
  assert.equal(
    /\.(?:conversationStore|runRecordStore|childMessageStore|childLoopContextStore|childContinuations|childInstructionQueues)\b/.test(source),
    false,
    "deep-routes must use MultiAgentFeature commands/queries instead of reaching into feature-owned state",
  );
  for (const movedBusinessOperation of [
    "buildDeepFollowUpContext",
    "confirmedDeepIntakeContext",
    "nextTurnOrdinal",
    ".saveConversation(",
  ]) {
    assert.equal(
      source.includes(movedBusinessOperation),
      false,
      `${movedBusinessOperation} belongs to MultiAgentFeature commands, not HTTP routes`,
    );
  }

  const featureFile = path.join(process.cwd(), "src", "app", "deep", "multi-agent-feature.ts");
  const featureSource = await fs.readFile(featureFile, "utf8");
  const runtimeFacade = featureSource.slice(
    featureSource.indexOf("type MultiAgentFeatureRuntime ="),
    featureSource.indexOf("export function createMultiAgentFeature"),
  );
  assert.equal(
    /readonly bus\s*:/.test(runtimeFacade),
    false,
    "MultiAgentFeature must create per-run or per-operation buses instead of retaining model history for its lifetime",
  );
  assert.equal(
    featureSource.includes("const runFacts = new Map"),
    false,
    "post-terminal continuation facts must be durable DeepRun facts, not a process-lifetime map",
  );
  const releaseCalls = featureSource.match(/childRuntime\.releaseResources\(\);/g) ?? [];
  const awaitedReleaseCalls = featureSource.match(/await childRuntime\.releaseResources\(\);/g) ?? [];
  assert.equal(
    awaitedReleaseCalls.length,
    releaseCalls.length,
    "every existing-run resource lease release must be awaited by its operation",
  );
  assert.equal(
    featureSource.includes("void resources.release()"),
    false,
    "resource release failures must not be detached from their lifecycle owner",
  );
});

test("shared Agent run resources do not own feature contributions", async () => {
  const file = path.join(process.cwd(), "src", "app", "panel-server", "agent-run-resources.ts");
  const source = await fs.readFile(file, "utf8");
  const imports = sourceImportBindings(source, file)
    .filter((binding) => /\/(?:ordinary-agent|desktop-agent|deep|skills|sub-agents)(?:\/|$)/.test(
      binding.moduleSpecifier.replaceAll("\\", "/"),
    ))
    .map((binding) => `${binding.moduleSpecifier}:${binding.importedName}`)
    .sort();

  assert.deepEqual(
    imports,
    [],
    "shared run resources must accept neutral contributions; feature-specific adapters belong at composition edges",
  );
});

function isPathWithin(file: string, directory: string): boolean {
  const relative = path.relative(directory, file);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function formatDependencyPaths(paths: readonly (readonly string[])[]): string[] {
  return paths
    .map((dependencyPath) => dependencyPath.map(relativePath).join(" -> "))
    .sort();
}

function isForbiddenDeepRouteImport(name: string): boolean {
  return name === "MinimalRuntime" ||
    name === "createMinimalRuntime" ||
    name === "prepareAgentRunResources" ||
    name === "createAgentToolCenterFactory" ||
    name === "createDeepTurnRuntime" ||
    name === "createDeepConversationService" ||
    name === "executeDeepRun" ||
    name === "resumeDeepChildAgent" ||
    name === "continueDeepChildAgent" ||
    name === "synthesizeDeepConclusion" ||
    /^create.*Deep.*(?:Store|Repository)/.test(name) ||
    /^InMemoryDeep.*(?:Store|Repository)/.test(name);
}

function isForbiddenDeepRouteInvocation(name: string): boolean {
  return name === "createMinimalRuntime" ||
    name === "prepareAgentRunResources" ||
    name === "createAgentToolCenterFactory" ||
    name === "createDeepTurnRuntime" ||
    name === "createDeepConversationService" ||
    name === "executeDeepRun" ||
    name === "resumeDeepChildAgent" ||
    name === "continueDeepChildAgent" ||
    name === "synthesizeDeepConclusion" ||
    /^create.*Deep.*(?:Store|Repository)/.test(name) ||
    /^(?:InMemory)?Deep.*(?:Store|Repository)$/.test(name);
}
