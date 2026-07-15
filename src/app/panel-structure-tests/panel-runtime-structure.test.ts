import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  collectSourceFiles,
  importSpecifiersFrom,
  readSource,
  relativePath,
  sourceImportBindings,
  sourceInvocationNames,
} from "../source-structure-tests/source-structure-test-utils.js";

const PANEL_SERVER_ROOT = path.join(process.cwd(), "src", "app", "panel-server");

test("panel runtime is the only composition root for Ordinary and Multi-Agent features", async () => {
  const runtimeFile = path.join(PANEL_SERVER_ROOT, "runtime.ts");
  const runtime = await readSource(runtimeFile);
  const imports = sourceImportBindings(runtime, runtimeFile);
  const invocations = sourceInvocationNames(runtime, runtimeFile);

  assert.equal(
    imports.some((binding) =>
      binding.importedName === "createOrdinaryAgentFeature" &&
      binding.moduleSpecifier === "../ordinary-agent/index.js"
    ),
    true,
  );
  assert.equal(
    imports.some((binding) =>
      binding.importedName === "createMultiAgentFeature" &&
      binding.moduleSpecifier === "../deep/multi-agent-feature.js"
    ),
    true,
  );
  assert.equal(invocations.called.includes("createOrdinaryAgentFeature"), true);
  assert.equal(invocations.called.includes("createMultiAgentFeature"), true);

  const otherCompositionRoots: string[] = [];
  for (const file of await collectSourceFiles(PANEL_SERVER_ROOT)) {
    if (file === runtimeFile || file.endsWith(".test.ts") || file.includes(`${path.sep}integration-tests${path.sep}`)) {
      continue;
    }
    const source = await readSource(file);
    const bindings = sourceImportBindings(source, file);
    if (bindings.some((binding) =>
      binding.importedName === "createOrdinaryAgentFeature" ||
      binding.importedName === "createMultiAgentFeature"
    )) {
      otherCompositionRoots.push(relativePath(file));
    }
  }

  assert.deepEqual(otherCompositionRoots, []);
});

test("PanelRuntime exposes feature facades instead of the retired Ordinary execution state", async () => {
  const runtime = await readSource(path.join(PANEL_SERVER_ROOT, "runtime.ts"));
  const runtimeContract = runtime.slice(
    runtime.indexOf("export type PanelRuntime ="),
    runtime.indexOf("type PanelSkillRootsInput"),
  );

  assert.match(runtimeContract, /readonly ordinaryAgentFeature: OrdinaryAgentFeature;/);
  assert.match(runtimeContract, /readonly multiAgentFeature: MultiAgentFeature;/);

  for (const retiredField of [
    "runExecutor",
    "runJobs",
    "activeRunJobs",
    "abortControllers",
    "persistenceChains",
    "runStreamProjection",
  ]) {
    assert.equal(runtimeContract.includes(retiredField), false, `PanelRuntime must not expose ${retiredField}`);
  }
});

test("panel composition does not restore the retired BasicAgent executor", async () => {
  const runtime = await readSource(path.join(PANEL_SERVER_ROOT, "runtime.ts"));
  const requestHandler = await readSource(path.join(PANEL_SERVER_ROOT, "request-handler.ts"));

  for (const source of [runtime, requestHandler]) {
    assert.equal(source.includes("BasicAgentRunExecutor"), false);
    assert.equal(
      importSpecifiersFrom(source).some((specifier) => specifier.includes("basic-agent-runtime/run-executor")),
      false,
    );
  }
});
