import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { DirectionHandoffPackageValidationError } from "../domain/agentarbor/direction-handoff-package.js";
import {
  createAwaitingUserDirectionHandoffPackageFixture,
  tamperAwaitingUserPackageToApprovedShape,
} from "../domain/agentarbor/test-fixtures.js";
import { StateGuardError } from "../kernel/state-machine/task-state-machine.js";
import { AbovegroundPlanner } from "./agents.js";
import { runMinimalLoop } from "./minimal-loop.js";

test("aboveground planner blocks draft and awaiting_user DirectionHandoffPackages", () => {
  const result = runMinimalLoop();
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

test("aboveground planner rejects awaiting_user package tampered into approved status", () => {
  const result = runMinimalLoop();
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

test("aboveground planner rejects ad-hoc DirectionHandoff material", () => {
  const result = runMinimalLoop();
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

test("runtime has no external LLM SDK dependency or direct provider adapter import outside adapter tests", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const prohibitedPackages = [
    "ai",
    "openai",
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

  for (const packageName of prohibitedPackages) {
    assert.equal(packageName in allDependencies, false, `${packageName} must not be introduced as a dependency`);
  }

  for (const file of sourceFiles(["src/domain", "src/kernel", "src/app"])) {
    const source = readFileSync(file, "utf8");
    assert.equal(
      /from\s+["'][^"']*adapters\/intelligence/.test(source),
      false,
      `${file} must not import provider adapters`
    );
    assert.equal(
      /from\s+["'](?:openai|ai|@ai-sdk\/openai|@anthropic-ai\/sdk|@google\/genai|langchain|@langchain\/core)["']/.test(source),
      false,
      `${file} must not import external LLM SDKs`
    );
  }
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
