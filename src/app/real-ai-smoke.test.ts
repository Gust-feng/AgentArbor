import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("real AI smoke reports skipped configuration boundary without failing or leaking secrets", async () => {
  const secret = "sk-real-ai-smoke-secret";
  const result = await runSmoke({
    AGENTARBOR_MODEL_API_KEY: secret,
    AGENTARBOR_MODEL_NAME: undefined,
    OPENAI_API_KEY: undefined,
  });
  const summary = parseSmokeSummary(result.stdout);

  assert.equal(result.code, 0);
  assert.equal(result.stdout.includes("AgentArbor real AI smoke skipped"), true);
  assert.equal(result.stdout.includes(secret), false);
  assert.equal(summary.status, "skipped");
  assert.equal(summary.boundary, "configuration");
  assert.equal(summary.code, "missing_model_name");
  assert.equal(summary.eventCounts.requested, 0);
});

type SmokeRunResult = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};

async function runSmoke(envOverrides: Record<string, string | undefined>): Promise<SmokeRunResult> {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  try {
    const result = await execFileAsync(process.execPath, ["dist/app/real-ai-smoke.js"], {
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

function parseSmokeSummary(stdout: string): {
  readonly status: string;
  readonly boundary?: string;
  readonly code?: string;
  readonly eventCounts: { readonly requested: number };
} {
  const jsonStart = stdout.indexOf("{");
  if (jsonStart < 0) {
    throw new Error(`Smoke summary JSON missing from stdout: ${stdout}`);
  }
  return JSON.parse(stdout.slice(jsonStart)) as {
    readonly status: string;
    readonly boundary?: string;
    readonly code?: string;
    readonly eventCounts: { readonly requested: number };
  };
}
