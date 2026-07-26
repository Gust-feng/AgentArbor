import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type {
  IntelligenceChannel,
  ModelOutputValidationResult,
  ModelRequest,
  ModelRequestOptions,
  ModelResponse,
} from "../../domain/intelligence/index.js";
import { discoverSkills } from "./skill-loader.js";
import { runSkillQualityEvals } from "./skill-quality-eval.js";

test("runSkillQualityEvals skips quality cases without an intelligence channel", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skill-quality-skip-"));
  try {
    await writeQualitySkill(root, "review");
    const skills = await discoverSkills({ roots: [root] });

    const report = await runSkillQualityEvals({ skills, evalRunId: "skip-run" });

    assert.equal(report.caseCount, 1);
    assert.equal(report.evalRunId, "skip-run");
    assert.equal(report.skippedCount, 1);
    assert.equal(report.results[0]?.status, "skipped");
    assert.equal(report.results[0]?.reason, "Quality eval requires an intelligence channel.");
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("runSkillQualityEvals generates with and without skill outputs without exposing raw text", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skill-quality-run-"));
  try {
    await writeQualitySkill(root, "review");
    const skills = await discoverSkills({ roots: [root] });
    const channel = new QualityEvalChannel((request) => {
      if (request.requestId.endsWith("without_skill")) {
        return "Generic review without reusable checklist.";
      }
      return "This review identifies material risk and avoids banned wording.";
    });

    const report = await runSkillQualityEvals({
      skills,
      intelligenceChannel: channel,
      evalRunId: "quality-run",
      now: new Date("2026-06-21T00:00:00.000Z"),
    });
    const result = report.results[0];

    assert.equal(report.caseCount, 1);
    assert.equal(report.passedCount, 1);
    assert.equal(result?.status, "passed");
    assert.equal(result?.checkCount, 2);
    assert.equal(result?.withSkillCheckPassedCount, 2);
    assert.equal(result?.withoutSkillCheckPassedCount, 1);
    assert.equal(result?.requiredDelta, 1);
    assert.equal(result?.actualDelta, 1);
    assert.equal(channel.requests.length, 2);
    assert.equal(channel.requests[0]?.requestId, "skill-quality-eval-quality-run-review-review-quality-without_skill");
    assert.equal(channel.requests[1]?.requestId, "skill-quality-eval-quality-run-review-review-quality-with_skill");
    assert.equal(channel.requests.every((request) => request.requestedAt === "2026-06-21T00:00:00.000Z"), true);
    assert.equal(channel.requests.every((request) => request.purpose === "skill_quality_eval"), true);
    assert.equal(channel.requests.every((request) => request.toolChoice === "none"), true);
    assert.equal(channel.requests.every((request) => (request.tools ?? []).length === 0), true);
    assert.equal(JSON.stringify(report).includes("Generic review without reusable checklist"), false);
    assert.equal(JSON.stringify(report).includes("This review identifies material risk"), false);
    assert.equal(JSON.stringify(report).includes(root), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("runSkillQualityEvals fails when with-skill output does not improve by required delta", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skill-quality-fail-"));
  try {
    await writeQualitySkill(root, "review");
    const skills = await discoverSkills({ roots: [root] });
    const channel = new QualityEvalChannel(() => "Both variants mention material risk.");

    const report = await runSkillQualityEvals({ skills, intelligenceChannel: channel, evalRunId: "quality-fail-run" });
    const result = report.results[0];

    assert.equal(report.failedCount, 1);
    assert.equal(result?.status, "failed");
    assert.equal(result?.withSkillCheckPassedCount, 2);
    assert.equal(result?.withoutSkillCheckPassedCount, 2);
    assert.equal(result?.actualDelta, 0);
    assert.equal(result?.reason, "withSkill output did not satisfy all quality checks or required delta.");
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("runSkillQualityEvals isolates model failures and validation failures per case", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skill-quality-validation-"));
  try {
    await writeQualitySkill(root, "review");
    const skills = await discoverSkills({ roots: [root] });
    const throwingChannel = new ThrowingQualityEvalChannel();
    const validationChannel = new QualityEvalChannel(() => "material risk", { validationStatus: "failed" });

    const thrown = await runSkillQualityEvals({
      skills,
      intelligenceChannel: throwingChannel,
      evalRunId: "throwing-run",
    });
    const invalid = await runSkillQualityEvals({
      skills,
      intelligenceChannel: validationChannel,
      evalRunId: "invalid-run",
    });

    assert.equal(thrown.failedCount, 1);
    assert.equal(thrown.results[0]?.failureCode, "model_request_failed");
    assert.equal(thrown.results[0]?.reason, "withoutSkill quality eval model request failed: model request threw");
    assert.equal(invalid.failedCount, 1);
    assert.equal(invalid.results[0]?.failureCode, "model_validation_failed");
    assert.equal(invalid.results[0]?.withoutSkillRequestId, "skill-quality-eval-invalid-run-review-review-quality-without_skill");
    assert.equal(JSON.stringify(thrown).includes(root), false);
    assert.equal(JSON.stringify(invalid).includes("material risk"), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

async function writeQualitySkill(root: string, name: string): Promise<void> {
  const skillDir = path.join(root, name);
  await fs.mkdir(path.join(skillDir, "evals"), { recursive: true });
  await fs.writeFile(
    path.join(skillDir, "SKILL.md"),
    [
      "---",
      `name: ${name}`,
      "description: Reviews changes with a reusable checklist.",
      "when_to_use: Use for code review requests.",
      "---",
      "",
      "Always identify material risk and avoid forbidden wording.",
    ].join("\n"),
    "utf8"
  );
  await fs.writeFile(
    path.join(skillDir, "evals", "quality.json"),
    JSON.stringify({
      cases: [
        {
          id: "review-quality",
          kind: "quality",
          goal: "Review this change.",
          expected: {
            contains: ["material risk"],
          },
          qualityBaseline: {
            withoutSkill: {
              score: 2,
              summary: "Generic review.",
              outputSample: "Generic review without reusable checklist.",
            },
            withSkill: {
              score: 4,
              summary: "Finds material risk.",
              outputSample: "This review identifies material risk.",
            },
            minDelta: 1,
          },
          qualityChecks: {
            withSkill: {
              mustInclude: ["material risk"],
              mustNotInclude: ["forbidden"],
            },
          },
        },
      ],
    }),
    "utf8"
  );
}

class QualityEvalChannel implements IntelligenceChannel {
  readonly requests: ModelRequest[] = [];

  constructor(
    private readonly handler: (request: ModelRequest) => string,
    private readonly options: { readonly validationStatus?: ModelOutputValidationResult["status"] } = {}
  ) {}

  async request(request: ModelRequest, _options?: ModelRequestOptions): Promise<ModelResponse> {
    this.requests.push(request);
    return {
      responseId: `${request.requestId}-response`,
      requestId: request.requestId,
      providerId: "test-provider",
      providerKind: "fake",
      protocolKind: "openai_compatible_chat_completions",
      model: "test-model",
      status: "completed",
      outputKind: request.outputContract.outputKind,
      textOutput: this.handler(request),
      validation: {
        status: this.options.validationStatus ?? "passed",
        checkedAt: "2026-06-21T00:00:00.000Z",
        issues: this.options.validationStatus === "failed"
          ? [{ code: "invalid", message: "invalid response" }]
          : [],
      },
      completedAt: "2026-06-21T00:00:00.000Z",
    };
  }

  validateResponse(_request: ModelRequest, response: ModelResponse): ModelOutputValidationResult {
    return response.validation;
  }
}

class ThrowingQualityEvalChannel implements IntelligenceChannel {
  async request(_request: ModelRequest, _options?: ModelRequestOptions): Promise<ModelResponse> {
    throw new Error("SHOULD_NOT_LEAK_PATH_OR_SECRET");
  }

  validateResponse(_request: ModelRequest, response: ModelResponse): ModelOutputValidationResult {
    return response.validation;
  }
}
