import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  buildSourceGraph,
  findDependencyPathsTo,
  importSpecifiersFrom,
  readSource,
  relativePath,
  sourceImportBindings,
  sourceInvocationNames,
} from "../source-structure-tests/source-structure-test-utils.js";

const APP_ROOT = path.join(process.cwd(), "src", "app");
const PANEL_SERVER_ROOT = path.join(APP_ROOT, "panel-server");

test("request handler delegates Ordinary HTTP traffic to ordinary-routes", async () => {
  const requestHandlerFile = path.join(PANEL_SERVER_ROOT, "request-handler.ts");
  const requestHandler = await readSource(requestHandlerFile);
  const imports = sourceImportBindings(requestHandler, requestHandlerFile);
  const invocations = sourceInvocationNames(requestHandler, requestHandlerFile);

  assert.equal(
    imports.some((binding) =>
      binding.importedName === "handlePanelOrdinaryRoute" &&
      binding.moduleSpecifier === "./ordinary-routes.js"
    ),
    true,
  );
  assert.equal(invocations.called.includes("handlePanelOrdinaryRoute"), true);

  for (const retiredRoute of [
    "./basic-agent-routes.js",
    "./conversation-routes.js",
    "./run-execution.js",
    "./run-routes.js",
  ]) {
    assert.equal(importSpecifiersFrom(requestHandler).includes(retiredRoute), false);
  }
});

test("ordinary-routes is a thin HTTP adapter over OrdinaryAgentFeature", async () => {
  const routeFile = path.join(PANEL_SERVER_ROOT, "ordinary-routes.ts");
  const source = await readSource(routeFile);
  const specifiers = importSpecifiersFrom(source);
  const invocations = sourceInvocationNames(source, routeFile);

  assert.match(source, /runtime\.ordinaryAgentFeature\.(commands|queries|events)\./);

  for (const forbiddenImport of [
    "adapters/intelligence",
    "model-runtime/factory",
    "tool-center/tool-center",
    "ordinary-agent/file-system-repository",
    "ordinary-agent/conversation-control-repository",
    "ordinary-agent/agent-loop-execution",
  ]) {
    assert.equal(
      specifiers.some((specifier) => specifier.includes(forbiddenImport)),
      false,
      `ordinary-routes must not import ${forbiddenImport}`,
    );
  }

  for (const forbiddenFactory of [
    "createOrdinaryAgentFeature",
    "createFileSystemOrdinaryRunRepository",
    "createFileSystemOrdinaryConversationControlRepository",
    "createOrdinaryAgentLoopExecutionPort",
    "createToolCenter",
  ]) {
    assert.equal(invocations.called.includes(forbiddenFactory), false, `ordinary-routes must not call ${forbiddenFactory}`);
  }
  assert.equal(
    invocations.constructed.some((name) => name.endsWith("Store") || name.endsWith("Repository")),
    false,
    "ordinary-routes must not construct stores or repositories",
  );
});

test("Panel production entrypoints cannot reach the retired Ordinary chain", async () => {
  const graph = await buildSourceGraph(path.join("src", "app"));
  const entrypoints = [
    path.join(PANEL_SERVER_ROOT, "request-handler.ts"),
    path.join(PANEL_SERVER_ROOT, "runtime.ts"),
  ];
  const retiredTargets = new Set([
    "src/app/basic-agent-runtime/run-executor.ts",
    "src/app/desktop-agent/desktop-agent-loop-preparation.ts",
    "src/app/desktop-agent/desktop-agent-session.ts",
    "src/app/desktop-agent/desktop-agent-session-events.ts",
    "src/app/desktop-agent/desktop-agent-session-runtime.ts",
    "src/app/panel-server/basic-agent-routes.ts",
    "src/app/panel-server/conversation-routes.ts",
    "src/app/panel-server/desktop-agent-execution.ts",
    "src/app/panel-server/run-execution.ts",
    "src/app/panel-server/run-routes.ts",
  ]);
  const paths = findDependencyPathsTo(
    graph,
    entrypoints,
    (file) => {
      const relative = relativePath(file);
      return retiredTargets.has(relative);
    },
  ).map((dependencyPath) => dependencyPath.map(relativePath));

  assert.deepEqual(paths, []);
});
