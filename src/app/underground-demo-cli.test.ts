import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import type { UndergroundDemoSummary } from "./underground-demo-summary.js";

const execFileAsync = promisify(execFile);

test("underground demo CLI remains deterministic by default", async () => {
  const result = await runDemo([]);
  const summary = parseSummary(result.stdout);

  assert.equal(result.code, 0);
  assert.equal(result.stdout.includes("model.requested"), false);
  assert.equal(summary.ai.enabled, false);
  assert.equal(summary.ai.status, "disabled");
  assert.deepEqual(summary.ai.eventCounts, { requested: 0, completed: 0, failed: 0 });
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
  assert.deepEqual(summary.ai.eventCounts, { requested: 1, completed: 1, failed: 0 });
  assert.equal(summary.ai.modelCallRefs.length, 1);
  assert.equal(summary.ai.modelCallRefs[0]?.rootletOutputRefs.length, 1);
  assert.equal(summary.ai.modelCallRefs[0]?.candidateRefs.length, 1);
  assert.deepEqual(
    summary.eventLog.filter((type) => !type.startsWith("model.")),
    [
      "goal.received",
      "underground.exploration_planned",
      "rootlet_cluster.started",
      "exploration_candidate.produced",
      "candidate_pool.updated",
      "convergence_review.completed",
      "direction_handoff.completed",
    ]
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
