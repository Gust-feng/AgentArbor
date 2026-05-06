import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import type { UndergroundDemoSummary } from "./underground-demo-summary.js";

const execFileAsync = promisify(execFile);

test("underground demo CLI defaults to fake AI as the minimal happy path", async () => {
  const result = await runDemo([]);
  const summary = parseSummary(result.stdout);

  assert.equal(result.code, 0);
  assert.equal(result.stdout.includes("model.requested"), true);
  assert.equal(summary.terminalStatus, "approved_package_created");
  assert.equal(summary.ai.enabled, true);
  assert.equal(summary.ai.mode, "fake");
  assert.equal(summary.ai.status, "completed");
  assert.equal(summary.ai.eventCounts.requested > 0, true);
  assert.equal(summary.ai.eventCounts.completed > 0, true);
  assert.equal(summary.ai.eventCounts.failed, 0);
  assert.equal(summary.directionPackage.status, "approved");
});

test("underground demo CLI --ai fake emits model events and keeps AI candidate-layer only", async () => {
  const result = await runDemo(["--ai", "fake", "Build a small deterministic helper."]);
  const summary = parseSummary(result.stdout);

  assert.equal(result.code, 0);
  assert.equal(result.stdout.includes("model.requested"), true);
  assert.equal(result.stdout.includes("model.completed"), true);
  assert.equal(summary.ai.enabled, true);
  assert.equal(summary.ai.mode, "fake");
  assert.equal(summary.ai.status, "completed");
  assert.equal(summary.ai.eventCounts.requested > 0, true);
  assert.equal(summary.ai.eventCounts.completed, summary.ai.eventCounts.requested);
  assert.equal(summary.ai.eventCounts.failed, 0);
  const rootletModelCall = summary.ai.modelCallRefs.find((ref) => ref.rootletKind === "option");
  const advisoryModelCall = summary.ai.modelCallRefs.find((ref) => ref.rootletKind === undefined);
  assert.equal(summary.ai.modelCallRefs.length, summary.ai.eventCounts.completed);
  assert.notEqual(rootletModelCall, undefined);
  assert.notEqual(advisoryModelCall, undefined);
  assert.equal(rootletModelCall?.rootletOutputRefs.length, 2);
  assert.equal(rootletModelCall?.candidateRefs.length, 2);
  assert.deepEqual(
    summary.eventLog.filter((type) => !type.startsWith("model.")),
    ["direction_handoff.completed"]
  );
  assert.equal(summary.eventLog.includes("growth_plan.completed"), false);
});

test("underground demo CLI --ai openai-compatible fails without API key before model events", async () => {
  const result = await runDemo(["--ai", "openai-compatible", "Build a small deterministic helper."], {
    AGENTARBOR_MODEL_NAME: "test-model",
    AGENTARBOR_MODEL_API_KEY: undefined,
    OPENAI_API_KEY: undefined,
  });
  const summary = parseConfigurationSummary(result.stderr);

  assert.equal(result.code, 1);
  assert.equal(result.stdout.includes("model.requested"), false);
  assert.equal(result.stderr.includes("requires AGENTARBOR_MODEL_API_KEY or OPENAI_API_KEY"), true);
  assert.equal(summary.ai.status, "configuration_failed");
  assert.equal(summary.ai.configurationError.code, "missing_api_key");
  assert.equal(summary.ai.eventCounts.requested, 0);
});

test("underground demo CLI configuration failure does not leak provided API key", async () => {
  const secret = "sk-test-secret-token";
  const result = await runDemo(["--ai", "openai-compatible", "Build a small deterministic helper."], {
    AGENTARBOR_MODEL_API_KEY: secret,
    AGENTARBOR_MODEL_NAME: undefined,
    OPENAI_API_KEY: undefined,
  });

  assert.equal(result.code, 1);
  assert.equal(result.stderr.includes(secret), false);
  assert.equal(result.stdout.includes(secret), false);
});

type DemoRunResult = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};

async function runDemo(
  args: readonly string[],
  envOverrides: Record<string, string | undefined> = {}
): Promise<DemoRunResult> {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  try {
    const result = await execFileAsync(process.execPath, ["dist/app/underground-demo.js", ...args], {
      encoding: "utf8",
      env,
      windowsHide: true,
    });
    return {
      code: 0,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const execError = error as {
      readonly code?: number;
      readonly stdout?: string;
      readonly stderr?: string;
    };
    return {
      code: typeof execError.code === "number" ? execError.code : 1,
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
    };
  }
}

function parseSummary(stdout: string): UndergroundDemoSummary {
  const marker = "Summary:\n";
  const index = stdout.indexOf(marker);
  assert.notEqual(index, -1, stdout);
  return JSON.parse(stdout.slice(index + marker.length)) as UndergroundDemoSummary;
}

function parseConfigurationSummary(stderr: string): {
  readonly ai: {
    readonly status: "configuration_failed";
    readonly eventCounts: { readonly requested: number };
    readonly configurationError: { readonly code: string };
  };
} {
  const index = stderr.indexOf("{");
  assert.notEqual(index, -1, stderr);
  return JSON.parse(stderr.slice(index)) as {
    readonly ai: {
      readonly status: "configuration_failed";
      readonly eventCounts: { readonly requested: number };
      readonly configurationError: { readonly code: string };
    };
  };
}
