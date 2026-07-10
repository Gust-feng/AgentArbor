import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import type { UndergroundAiProviderFetch } from "../underground-ai-runtime.js";
import { runRealAiSmoke } from "./real-ai-smoke-runner.js";

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
  assert.equal(result.stdout.includes("AgentArbor Cognitive Work Session real AI smoke skipped"), true);
  assert.equal(result.stdout.includes(secret), false);
  assert.equal(summary.status, "skipped");
  assert.equal(summary.runtime, "cognitive_work_session");
  assert.equal(summary.boundary, "configuration");
  assert.equal(summary.code, "missing_model_name");
  assert.equal(summary.eventCounts.requested, 0);
});

test("real AI smoke runner drives Cognitive Work Session with stubbed openai-compatible provider", async () => {
  const secret = "sk-real-ai-smoke-runner-secret";
  const fetchCalls: { readonly authorization?: string; readonly body: Record<string, unknown> }[] = [];
  const providerFetch: UndergroundAiProviderFetch = async (_url, init) => {
    const body = JSON.parse(init.body ?? "{}") as Record<string, unknown>;
    fetchCalls.push({ authorization: init.headers.authorization, body });
    const response = responseForCall(fetchCalls.length);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: `chatcmpl-real-ai-smoke-${fetchCalls.length}`,
        model: "gpt-real-ai-smoke",
        choices: [
          {
            message: response.toolCalls === undefined
              ? { role: "assistant", content: JSON.stringify(response.output) }
              : { role: "assistant", content: "", tool_calls: response.toolCalls },
            finish_reason: response.toolCalls === undefined ? "stop" : "tool_calls",
          },
        ],
      }),
    };
  };

  const summary = await runRealAiSmoke("分析当前 AgentArbor 项目，产出下一步优化报告", {
    env: {
      AGENTARBOR_MODEL_API_KEY: secret,
      AGENTARBOR_MODEL_NAME: "gpt-real-ai-smoke",
      AGENTARBOR_MODEL_BASE_URL: "https://llm.example.test",
      AGENTARBOR_INFORMATION_SOURCE_PREFERENCE: "codebase",
    },
    providerFetch,
  });
  const serialized = JSON.stringify(summary);

  assert.equal(summary.status, "completed");
  assert.equal(summary.runtime, "cognitive_work_session");
  assert.equal(summary.mode, "openai-compatible");
  assert.equal(summary.childRunCount, 1);
  assert.equal(summary.parentSynthesisCount, 1);
  assert.deepEqual(summary.stepActions, ["use_tools", "spawn_children", "synthesize", "produce_artifact"]);
  assert.equal(summary.toolCallRefs.includes("call-search-cognitive-work-session"), true);
  assert.equal(summary.eventCounts.toolCompleted, 1);
  assert.equal(summary.eventCounts.failed, 0);
  assert.equal(fetchCalls.length >= 7, true);
  assert.equal(fetchCalls[0]?.authorization, `Bearer ${secret}`);
  assert.equal((fetchCalls[0]?.body.tools as unknown[]).length > 0, true);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("Bearer"), false);
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
  readonly runtime?: string;
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
    readonly runtime?: string;
    readonly boundary?: string;
    readonly code?: string;
    readonly eventCounts: { readonly requested: number };
  };
}

function responseForCall(callNumber: number): {
  readonly output?: Record<string, unknown>;
  readonly toolCalls?: readonly Record<string, unknown>[];
} {
  switch (callNumber) {
    case 1:
      return {
        toolCalls: [
          {
            id: "call-search-cognitive-work-session",
            type: "function",
            function: {
              name: "search",
              arguments: JSON.stringify({
                query: "runCognitiveWorkSession",
                sources: ["codebase"],
                limit: 2,
              }),
            },
          },
        ],
      };
    case 2:
      return {
        output: {
          action: "use_tools",
          childSpecs: [],
          decisionSummary: "Use codebase search evidence before delegation.",
          uncertainty: "Search refs still require child review and parent synthesis.",
          confidence: 0.72,
        },
      };
    case 3:
      return {
        output: {
          action: "spawn_children",
          childSpecs: [
            {
              specId: "project-analysis-child",
              displayName: "Project Analysis Child",
              role: "project_analysis_child",
              objective: "Inspect the Work Session runtime and identify concrete project optimization points.",
              allowedTools: ["read"],
              inputRefs: ["tool-call:call-search-cognitive-work-session"],
            },
          ],
          decisionSummary: "Delegate codebase material review to one bounded child agent.",
          uncertainty: "Child material remains untrusted until parent synthesis.",
          confidence: 0.73,
        },
      };
    case 4:
      return {
        output: {
          summary: "Project analysis child reviewed Work Session runtime refs.",
          findings: [
            "The real AI smoke path should exercise Cognitive Work Session rather than the legacy minimal loop.",
            "Tool results should remain refs until parent synthesis produces the final report.",
          ],
          evidenceRefs: ["research:codebase:work-session", "tool-call:call-search-cognitive-work-session"],
          uncertainty: "Stubbed provider output proves the contract path, not real model quality.",
          confidence: 0.7,
        },
      };
    case 5:
      return {
        output: {
          action: "synthesize",
          childSpecs: [],
          decisionSummary: "Synthesize child material and tool refs.",
          uncertainty: "Synthesis must preserve uncertainty and evidence refs.",
          confidence: 0.74,
        },
      };
    case 6:
      return {
        output: {
          reportTitle: "AgentArbor Cognitive Work Session 真实 smoke 报告",
          keyFindings: [
            "真实 smoke 已切到 Cognitive Work Session 主线。",
            "工具证据和 child material 需要父层 synthesis 才能进入最终 artifact。",
          ],
          recommendations: [
            "继续用显式 openai-compatible smoke 验证真实模型 contract。",
            "把失败诊断保持在安全 refs、purpose 和 contract 层面。",
          ],
          evidenceRefs: ["research:codebase:work-session", "tool-call:call-search-cognitive-work-session"],
          uncertainty: ["Stubbed provider 不能代表真实模型质量。"],
          nextActions: ["配置真实 AGENTARBOR_MODEL_* 后运行 real-ai smoke。"],
          decisionSummary: "Parent synthesis produced a safe project analysis report.",
          confidence: 0.76,
        },
      };
    default:
      return {
        output: {
          action: "produce_artifact",
          childSpecs: [],
          decisionSummary: "Produce final artifact after parent synthesis.",
          uncertainty: "No additional fixture uncertainty.",
          confidence: 0.77,
        },
      };
  }
}
