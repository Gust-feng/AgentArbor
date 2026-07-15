import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
test("runtime keeps external LLM SDKs behind provider adapters", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const allowedAdapterOnlyPackages = ["openai", "@openai/agents"];
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
  //   - external LLM SDK 只能由 adapters/intelligence 持有；feature 和 Panel
  //     通过中性模型/AgentLoop 契约使用它们。
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
  const sdkImportPattern = /from\s+["'](?:openai|@openai\/agents)["']/;
  const sdkOwners = sourceFiles([join("src")])
    .filter((file) => sdkImportPattern.test(readFileSync(file, "utf8")))
    .map(normalizedPath)
    .filter((file) => !file.startsWith("src/adapters/intelligence/"));
  assert.deepEqual(sdkOwners, [], "OpenAI SDK imports must remain adapter-owned");
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
  return [
    join("src", "app", "model-runtime", "factory.ts"),
    join("src", "app", "model-runtime", "agent-loop-factory.ts"),
  ].some((compositionRoot) => file.endsWith(compositionRoot));
}
