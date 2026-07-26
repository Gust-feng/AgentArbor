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
import { runSkillDoctor } from "./skill-doctor.js";

test("runSkillDoctor reports package quality issues without loading resource contents", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skill-doctor-"));
  try {
    await writeSkill(root, "valid-review", [
      "---",
      "name: valid-review",
      "description: Reviews changes.",
      "when_to_use: Use for code review requests.",
      "references: [references/checklist.md]",
      "---",
      "",
      "Review body.",
    ].join("\n"));
    await fs.mkdir(path.join(root, "valid-review", "references"), { recursive: true });
    await fs.mkdir(path.join(root, "valid-review", "evals"), { recursive: true });
    await fs.writeFile(path.join(root, "valid-review", "references", "checklist.md"), "RESOURCE_SENTINEL", "utf8");
    await fs.writeFile(
      path.join(root, "valid-review", "evals", "review-case.json"),
      JSON.stringify({
        cases: [
          {
            id: "select-review",
            kind: "routing",
            goal: "Please review this code change.",
            expected: { selected: true },
          },
          {
            id: "quality-review",
            kind: "quality",
            goal: "Review a small patch.",
            expected: {
              contains: ["risk"],
              notContains: ["EVAL_SENTINEL"],
              minScore: 0.75,
              rubric: "Check that the answer identifies material review risk.",
            },
            qualityBaseline: {
              withSkill: {
                score: 4,
                summary: "Finds material risk and cites the relevant file.",
                outputSample: "The review identifies a material risk and cites the relevant file.",
              },
              withoutSkill: {
                score: 2,
                summary: "Generic review with no reusable checklist.",
                outputSample: "Generic review.",
              },
              minDelta: 1,
            },
            qualityChecks: {
              withSkill: {
                mustInclude: ["material risk"],
                mustNotInclude: ["EVAL_SENTINEL"],
              },
            },
          },
        ],
      }),
      "utf8"
    );

    await writeSkill(root, "missing-hints", [
      "---",
      "name: missing-hints",
      "description: Has only a description.",
      "---",
      "",
      "Body.",
    ].join("\n"));

    await writeSkill(root, "unreachable", [
      "---",
      "name: unreachable",
      "description: Cannot be selected.",
      "disable-model-invocation: true",
      "user-invocable: false",
      "---",
      "",
      "Body.",
    ].join("\n"));

    await writeSkill(root, "missing-resource", [
      "---",
      "name: missing-resource",
      "description: Declares a missing resource.",
      "triggers: [missing]",
      "references: [references/missing.md]",
      "---",
      "",
      "Body.",
    ].join("\n"));

    await writeSkill(root, "large-body", [
      "---",
      "name: large-body",
      "description: Has a large body.",
      "triggers: [large]",
      "---",
      "",
      "x".repeat(80),
    ].join("\n"));

    await writeSkill(root, "bad-eval", [
      "---",
      "name: bad-eval",
      "description: Has a malformed eval artifact.",
      "when_to_use: Use for bad eval diagnostics.",
      "---",
      "",
      "Body.",
    ].join("\n"));
    await fs.mkdir(path.join(root, "bad-eval", "evals"), { recursive: true });
    await fs.writeFile(
      path.join(root, "bad-eval", "evals", "bad.json"),
      JSON.stringify({
        cases: [
          { id: "missing-goal", kind: "routing", expected: {} },
          { id: "missing-quality-baseline", kind: "quality", goal: "Review this patch.", expected: {} },
          {
            id: "quality-delta-fail",
            kind: "regression",
            goal: "Review a regression patch.",
            expected: { contains: ["risk"] },
            qualityBaseline: {
              withSkill: {
                score: 2,
                summary: "Weak answer.",
                outputSample: "This misses the expected wording.",
              },
              withoutSkill: {
                score: 2,
                summary: "Weak baseline.",
                outputSample: "Generic.",
              },
              minDelta: 1,
            },
            qualityChecks: {
              withSkill: {
                mustInclude: ["risk"],
              },
            },
          },
        ],
      }),
      "utf8"
    );

    await fs.mkdir(path.join(root, "invalid-skill"), { recursive: true });
    await fs.writeFile(
      path.join(root, "invalid-skill", "SKILL.md"),
      "---\nname: invalid-skill\n---\n\nMissing description.",
      "utf8"
    );

    const report = await runSkillDoctor({ roots: [root], maxBodyChars: 40 });
    const issues = report.skills.flatMap((skill) => skill.issues);

    assert.equal(report.rootCount, 1);
    assert.equal(report.skillCount, 7);
    assert.equal(report.validSkillCount, 6);
    assert.equal(report.errorCount, 2);
    assert.equal(report.warningCount, 8);
    assert.equal(report.evalArtifactCount, 2);
    assert.equal(report.evalCaseCount, 4);
    assert.equal(report.qualityEvalCaseCount, 3);
    assert.equal(report.regressionEvalCaseCount, 1);
    assert.equal(report.qualityEvalBaselineCaseCount, 2);
    assert.equal(report.routingEvalCaseCount, 2);
    assert.equal(report.routingEvalPassedCount, 0);
    assert.equal(report.routingEvalFailedCount, 0);
    assert.equal(report.routingEvalSkippedCount, 0);
    assert.equal(report.qualityEvalRunCaseCount, 0);
    assert.equal(report.qualityEvalRunPassedCount, 0);
    assert.equal(report.qualityEvalRunFailedCount, 0);
    assert.equal(report.qualityEvalRunSkippedCount, 0);
    assert.equal(report.infoCount, 5);
    assert.equal(issueFor(issues, "missing_routing_hint", "missing-hints")?.severity, "warning");
    assert.equal(issueFor(issues, "not_invocable", "unreachable")?.severity, "warning");
    assert.equal(issueFor(issues, "missing_declared_resource", "missing-resource")?.path, "references/missing.md");
    assert.equal(issueFor(issues, "large_skill_body", "large-body")?.severity, "info");
    assert.equal(issueFor(issues, "missing_eval_artifact", "missing-hints")?.severity, "info");
    assert.equal(report.skills.find((skill) => skill.skillId === "valid-review")?.evalArtifactCount, 1);
    assert.equal(report.skills.find((skill) => skill.skillId === "valid-review")?.evalCaseCount, 2);
    assert.equal(report.skills.find((skill) => skill.skillId === "valid-review")?.qualityEvalCaseCount, 1);
    assert.equal(report.skills.find((skill) => skill.skillId === "valid-review")?.regressionEvalCaseCount, 0);
    assert.equal(report.skills.find((skill) => skill.skillId === "valid-review")?.qualityEvalBaselineCaseCount, 1);
    assert.equal(report.skills.find((skill) => skill.skillId === "valid-review")?.routingEvalCaseCount, 1);
    assert.equal(issueFor(issues, "invalid_eval_artifact", "bad-eval")?.path, "evals/bad.json#missing-goal");
    assert.equal(issueFor(issues, "missing_routing_eval_case", "bad-eval")?.path, "evals/bad.json#missing-goal");
    assert.equal(issueFor(issues, "missing_quality_eval_assertion", "bad-eval")?.path, "evals/bad.json#missing-quality-baseline");
    assert.equal(issueFor(issues, "missing_quality_eval_baseline", "bad-eval")?.path, "evals/bad.json#missing-quality-baseline");
    assert.equal(issueFor(issues, "quality_eval_baseline_delta_failed", "bad-eval")?.path, "evals/bad.json#quality-delta-fail");
    assert.equal(issueFor(issues, "quality_eval_check_failed", "bad-eval")?.path, "evals/bad.json#quality-delta-fail");
    assert.equal(issueFor(issues, "invalid_skill", "invalid-skill")?.severity, "error");
    assert.equal(JSON.stringify(report).includes("RESOURCE_SENTINEL"), false);
    assert.equal(JSON.stringify(report).includes("EVAL_SENTINEL"), false);
    assert.equal(JSON.stringify(report).includes("The review identifies a material risk"), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("runSkillDoctor can execute routing eval cases through the model router when a channel is provided", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skill-routing-eval-"));
  try {
    await writeSkill(root, "review", [
      "---",
      "name: review",
      "description: Reviews code changes.",
      "when_to_use: Use for code review requests.",
      "---",
      "",
      "Review body.",
    ].join("\n"));
    await fs.mkdir(path.join(root, "review", "evals"), { recursive: true });
    await fs.writeFile(
      path.join(root, "review", "evals", "routing.json"),
      JSON.stringify({
        cases: [
          {
            id: "select-review",
            kind: "routing",
            goal: "Please review this patch.",
            expected: { selected: true },
          },
          {
            id: "reject-summary",
            kind: "routing",
            goal: "Summarize the meeting notes.",
            expected: { selected: false },
          },
          {
            id: "intentional-fail",
            kind: "routing",
            goal: "Review this diff but expect failure for test coverage.",
            expected: { selected: false },
          },
        ],
      }),
      "utf8"
    );

    const channel = new RoutingEvalChannel((request) => {
      const body = JSON.parse(request.sanitizedMessages[1]?.content ?? "{}") as { readonly goal?: string };
      return {
        selectedSkillIds: body.goal?.toLowerCase().includes("review") ? ["review"] : [],
        reasons: [{ skillId: "review", reason: "Review request.", confidence: 0.8 }],
        confidence: 0.8,
      };
    });

    const report = await runSkillDoctor({ roots: [root], intelligenceChannel: channel });
    const review = report.skills.find((skill) => skill.skillId === "review");

    assert.equal(report.routingEvalCaseCount, 3);
    assert.equal(report.routingEvalPassedCount, 2);
    assert.equal(report.routingEvalFailedCount, 1);
    assert.equal(report.routingEvalSkippedCount, 0);
    assert.equal(review?.routingEvalPassedCount, 2);
    assert.equal(review?.routingEvalFailedCount, 1);
    assert.equal(issueFor(review?.issues ?? [], "routing_eval_failed", "review")?.path, "evals/routing.json#intentional-fail");
    assert.equal(channel.requests.length, 3);
    assert.equal(channel.requests.every((request) => request.purpose === "skill_routing"), true);
    assert.equal(channel.requests.every((request) => (request.tools ?? []).length === 0), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("runSkillDoctor can explicitly execute quality eval cases without exposing raw outputs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skill-quality-eval-doctor-"));
  try {
    await writeSkill(root, "review", [
      "---",
      "name: review",
      "description: Reviews code changes.",
      "when_to_use: Use for code review requests.",
      "---",
      "",
      "Review body says to identify material risk.",
    ].join("\n"));
    await fs.mkdir(path.join(root, "review", "evals"), { recursive: true });
    await fs.writeFile(
      path.join(root, "review", "evals", "quality.json"),
      JSON.stringify({
        cases: [
          {
            id: "quality-pass",
            kind: "quality",
            goal: "Review this patch.",
            expected: { contains: ["material risk"] },
            qualityBaseline: {
              withoutSkill: {
                score: 2,
                summary: "Generic.",
                outputSample: "GENERIC_OUTPUT_SENTINEL",
              },
              withSkill: {
                score: 4,
                summary: "Finds risk.",
                outputSample: "WITH_SKILL_OUTPUT_SENTINEL material risk",
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

    const channel = new QualityEvalChannel((request) =>
      request.requestId.endsWith("without_skill")
        ? "Generic answer."
        : "This answer identifies material risk and avoids banned wording."
    );

    const report = await runSkillDoctor({
      roots: [root],
      intelligenceChannel: channel,
      runQualityEvals: true,
    });
    const review = report.skills.find((skill) => skill.skillId === "review");

    assert.equal(report.qualityEvalRunCaseCount, 1);
    assert.equal(report.qualityEvalRunPassedCount, 1);
    assert.equal(report.qualityEvalRunFailedCount, 0);
    assert.equal(report.qualityEvalRunSkippedCount, 0);
    assert.equal(review?.qualityEvalRunPassedCount, 1);
    assert.equal(channel.requests.length, 2);
    assert.equal(channel.requests.every((request) => request.purpose === "skill_quality_eval"), true);
    assert.equal(JSON.stringify(report).includes("GENERIC_OUTPUT_SENTINEL"), false);
    assert.equal(JSON.stringify(report).includes("WITH_SKILL_OUTPUT_SENTINEL"), false);
    assert.equal(JSON.stringify(report).includes("This answer identifies material risk"), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

async function writeSkill(root: string, name: string, content: string): Promise<void> {
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), content, "utf8");
}

function issueFor(
  issues: readonly { readonly code: string; readonly skillId: string; readonly path?: string; readonly severity: string }[],
  code: string,
  skillId: string
) {
  return issues.find((issue) => issue.code === code && issue.skillId === skillId);
}

class RoutingEvalChannel implements IntelligenceChannel {
  readonly requests: ModelRequest[] = [];

  constructor(private readonly handler: (request: ModelRequest) => unknown) {}

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
      structuredOutput: this.handler(request),
      validation: {
        status: "passed",
        checkedAt: "2026-06-21T00:00:00.000Z",
        issues: [],
      },
      completedAt: "2026-06-21T00:00:00.000Z",
    };
  }

  validateResponse(_request: ModelRequest, response: ModelResponse): ModelOutputValidationResult {
    return response.validation;
  }
}

class QualityEvalChannel implements IntelligenceChannel {
  readonly requests: ModelRequest[] = [];

  constructor(private readonly handler: (request: ModelRequest) => string) {}

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
        status: "passed",
        checkedAt: "2026-06-21T00:00:00.000Z",
        issues: [],
      },
      completedAt: "2026-06-21T00:00:00.000Z",
    };
  }

  validateResponse(_request: ModelRequest, response: ModelResponse): ModelOutputValidationResult {
    return response.validation;
  }
}
