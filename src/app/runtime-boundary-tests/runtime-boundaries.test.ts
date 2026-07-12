import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { DirectionHandoffPackageValidationError } from "../../domain/agentarbor/direction-handoff-package.js";
import {
  createAwaitingUserDirectionHandoffPackageFixture,
  tamperAwaitingUserPackageToApprovedShape,
} from "../../domain/agentarbor/test-fixtures.js";
import { StateGuardError } from "../../kernel/state-machine/task-state-machine.js";
import { AbovegroundPlanner } from "../agents.js";
import { runMinimalLoop } from "../underground/minimal/minimal-loop.js";

test("aboveground planner blocks draft and awaiting_user Plan Packages", async () => {
  const result = await runMinimalLoop();
  const planner = new AbovegroundPlanner();

  for (const status of ["draft", "awaiting_user"] as const) {
    const blockedPackage = JSON.parse(JSON.stringify(result.directionHandoffPackage)) as typeof result.directionHandoffPackage;
    blockedPackage.directionHandoff.status = status;
    blockedPackage.manifest.status = status;
    result.runtime.directionHandoffPackageStore.save(blockedPackage);

    assert.throws(
      () =>
        planner.plan(
          blockedPackage.manifest.directionId,
          blockedPackage.manifest.directionVersion,
          "trace-test",
          result.runtime
        ),
      DirectionHandoffPackageValidationError
    );
  }
});

test("aboveground planner rejects awaiting_user package tampered into approved status", async () => {
  const result = await runMinimalLoop();
  const planner = new AbovegroundPlanner();
  const { directionHandoffPackage } = createAwaitingUserDirectionHandoffPackageFixture();
  const tamperedPackage = tamperAwaitingUserPackageToApprovedShape(directionHandoffPackage);
  result.runtime.directionHandoffPackageStore.save(tamperedPackage);

  assert.throws(
    () =>
      planner.plan(
        tamperedPackage.manifest.directionId,
        tamperedPackage.manifest.directionVersion,
        "trace-test",
        result.runtime
      ),
    DirectionHandoffPackageValidationError
  );
});

test("aboveground planner rejects ad-hoc Plan material", async () => {
  const result = await runMinimalLoop();
  const planner = new AbovegroundPlanner();

  assert.throws(
    () =>
      (planner as unknown as {
        plan(directionId: unknown, version: number, traceId: string, runtime: typeof result.runtime): unknown;
      }).plan(result.directionHandoff, result.directionHandoff.version, "trace-test", result.runtime),
    StateGuardError
  );
});

test("aboveground planner cannot create direction exploration candidates", () => {
  const planner = new AbovegroundPlanner();

  assert.throws(() => planner.createExplorationCandidate(), StateGuardError);
});

test("runtime keeps external LLM SDKs behind provider adapters", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const allowedAdapterOnlyPackages = ["openai"];
  const prohibitedPackages = [
    "ai",
    "@ai-sdk/openai",
    "@anthropic-ai/sdk",
    "@google/genai",
    "langchain",
    "@langchain/core",
  ];
  const allDependencies = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
  };

  for (const packageName of allowedAdapterOnlyPackages) {
    assert.equal(packageName in allDependencies, true, `${packageName} SDK should be declared explicitly for provider adapters`);
  }

  for (const packageName of prohibitedPackages) {
    assert.equal(packageName in allDependencies, false, `${packageName} must not be introduced as a dependency`);
  }

  // 边界规则区分 production 运行时代码与测试代码：
  //   - production（domain/kernel/app 非测试）不得直接 import adapters/intelligence，
  //     只能经 model-runtime/factory 组合根使用模型能力，保证依赖倒置。
  //   - 测试文件（*.test.ts）使用 FakeModelProvider 等测试桩构造 IntelligenceChannel
  //     是标准测试实践；FakeModelProvider 是 adapters/intelligence 下的测试基础设施，
  //     不构成对真实 provider 实现的耦合，故对 adapters/intelligence import 豁免。
  //   - external LLM SDK（openai 等）禁止在任何文件（含测试）直接 import（见下），
  //     这是真正的安全底线，不受测试豁免影响。
  for (const file of sourceFiles(["src/domain", "src/kernel", "src/app"])) {
    const source = readFileSync(file, "utf8");
    const isTestFile = file.endsWith(".test.ts");
    if (!isAllowedProviderAdapterCompositionRoot(file) && !isTestFile) {
      assert.equal(
        /from\s+["'][^"']*adapters\/intelligence/.test(source),
        false,
        `${file} must not import provider adapters`
      );
    }
    assert.equal(
      /from\s+["'](?:openai|ai|@ai-sdk\/openai|@anthropic-ai\/sdk|@google\/genai|langchain|@langchain\/core)["']/.test(source),
      false,
      `${file} must not import external LLM SDKs`
    );
  }
});

test("ordinary panel mainline stays clear of legacy work-session and underground compat names", () => {
  const ordinaryMainlineFiles = [
    join("src", "app", "panel-server", "conversation-routes.ts"),
    join("src", "app", "panel-server", "conversation-current-run.ts"),
    join("src", "app", "panel-server", "basic-agent-run-view.ts"),
    join("src", "app", "panel-server", "desktop-agent-execution.ts"),
  ];
  const compatNamePattern = /workSession|WorkSession|work-session|work_session|underground/;

  for (const file of ordinaryMainlineFiles) {
    assert.equal(
      compatNamePattern.test(readFileSync(file, "utf8")),
      false,
      `${file} must not depend on legacy work-session or underground compat naming`
    );
  }
});

test("removed ordinary compatibility entrypoints cannot return", () => {
  const routeSource = readFileSync(join("src", "app", "panel-server", "basic-agent-routes.ts"), "utf8");
  assert.doesNotMatch(routeSource, /\/work-session/);
  assert.doesNotMatch(routeSource, /workSession:\s*view\.workView/);

  const staleDesktopChatSources = sourceFiles([join("src")])
    .filter((file) => !file.endsWith(".test.ts"))
    .filter((file) => /desktop_chat|desktop\.chat|DesktopChat|desktop-chat/.test(readFileSync(file, "utf8")))
    .map(normalizedPath);
  assert.deepEqual(staleDesktopChatSources, []);

  const staleIntentGateSources = sourceFiles([join("src")])
    .filter((file) => !file.endsWith(".test.ts"))
    .filter((file) => /desktop_intent_gate|desktop\.intent_gate\.v1/.test(readFileSync(file, "utf8")))
    .map(normalizedPath);
  assert.deepEqual(staleIntentGateSources, []);
});

test("active legacy work-session replay aliases stay in explicit compatibility files", () => {
  const allowedCompatFiles = new Set([
    "src/app/panel-server/basic-agent-read-models.ts",
    "src/app/panel-server/conversation-sync.ts",
    "src/app/panel-server/live-model-stream.ts",
    "src/app/panel-server/runtime-records.ts",
  ]);
  const compatNamePattern = /workSession|WorkSession|work-session|work_session/;
  const unexpectedFiles = sourceFiles([join("src", "app", "panel-server")])
    .filter((file) => !file.endsWith(".test.ts"))
    .filter((file) => compatNamePattern.test(readFileSync(file, "utf8")))
    .map(normalizedPath)
    .filter((file) => !allowedCompatFiles.has(file));

  assert.deepEqual(unexpectedFiles, []);
});

test("restored ordinary run views require frozen facts while legacy runs keep scoped fallback config", () => {
  const runViewSource = readFileSync(join("src", "app", "panel-server", "basic-agent-run-view.ts"), "utf8");
  const persistedResponseSource = readFileSync(join("src", "app", "panel-server", "persisted-run-response.ts"), "utf8");

  assert.match(runViewSource, /capabilityResolution:\s*snapshot\.run\.capabilityResolution/);
  assert.equal(/configCenter|getModelProviderConfig|getInformationAccessConfig/.test(runViewSource), false);
  assert.match(
    persistedResponseSource,
    /const ordinarySnapshot\s*=\s*input\.snapshot\.run\.runMode\s*===\s*"agent"[\s\S]*?requireRestorableOrdinaryRuntimeSnapshot\(input\.snapshot\)/
  );
  assert.match(
    persistedResponseSource,
    /const config\s*=\s*ordinarySnapshot\s*===\s*undefined[\s\S]*?input\.snapshot\.run\.capabilitySnapshot\?\.activeModel\s*\?\?\s*input\.config[\s\S]*?:\s*ordinarySnapshot\.run\.capabilitySnapshot\.activeModel;/
  );
  assert.match(
    persistedResponseSource,
    /const informationAccess\s*=\s*ordinarySnapshot\s*===\s*undefined[\s\S]*?input\.snapshot\.run\.informationAccess\s*\?\?\s*input\.informationAccess[\s\S]*?:\s*ordinarySnapshot\.run\.informationAccess;/
  );
  assert.match(persistedResponseSource, /capabilityResolution:\s*input\.snapshot\.run\.capabilityResolution/);
});

function sourceFiles(roots: readonly string[]): string[] {
  const files: string[] = [];
  const walk = (path: string): void => {
    for (const entry of readdirSync(path)) {
      const child = join(path, entry);
      const stats = statSync(child);
      if (stats.isDirectory()) {
        walk(child);
      } else if (child.endsWith(".ts")) {
        files.push(child);
      }
    }
  };

  for (const root of roots) {
    walk(root);
  }
  return files;
}

function normalizedPath(file: string): string {
  return file.replaceAll("\\", "/");
}

function isAllowedProviderAdapterCompositionRoot(file: string): boolean {
  return file.endsWith(join("src", "app", "model-runtime", "factory.ts"));
}
