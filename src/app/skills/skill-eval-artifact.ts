import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentSkillDefinition } from "./skill-loader.js";

export type SkillEvalCaseKind = "routing" | "quality" | "regression";

export type SkillEvalValidationSeverity = "error" | "warning";

export type SkillEvalValidationIssueCode =
  | "eval_read_failed"
  | "eval_not_json"
  | "eval_not_object"
  | "missing_eval_cases"
  | "eval_cases_not_array"
  | "eval_case_not_object"
  | "missing_eval_case_id"
  | "missing_eval_goal"
  | "invalid_eval_kind"
  | "missing_routing_assertion"
  | "missing_quality_assertion"
  | "missing_quality_baseline"
  | "invalid_quality_baseline"
  | "quality_baseline_delta_failed"
  | "quality_check_failed";

export type SkillEvalValidationIssue = {
  readonly code: SkillEvalValidationIssueCode;
  readonly severity: SkillEvalValidationSeverity;
  readonly skillId: string;
  readonly path: string;
  readonly message: string;
  readonly caseId?: string;
};

export type SkillEvalCase = {
  readonly id: string;
  readonly kind: SkillEvalCaseKind;
  readonly goal: string;
  readonly path: string;
  readonly expectedSelected?: boolean;
  readonly qualityAssertionCount?: number;
  readonly hasWithSkillBaseline?: boolean;
  readonly hasWithoutSkillBaseline?: boolean;
  readonly qualityBaselinePassed?: boolean;
  readonly qualityCheckCount?: number;
  readonly qualityCheckPassedCount?: number;
  readonly qualityMustInclude?: readonly string[];
  readonly qualityMustNotInclude?: readonly string[];
  readonly qualityMinDelta?: number;
};

export type SkillEvalArtifactReport = {
  readonly path: string;
  readonly caseCount: number;
  readonly routingCaseCount: number;
  readonly qualityCaseCount: number;
  readonly regressionCaseCount: number;
  readonly qualityBaselineCaseCount: number;
  readonly cases: readonly SkillEvalCase[];
  readonly issues: readonly SkillEvalValidationIssue[];
};

export type SkillEvalArtifactSummary = {
  readonly artifactCount: number;
  readonly caseCount: number;
  readonly routingCaseCount: number;
  readonly qualityCaseCount: number;
  readonly regressionCaseCount: number;
  readonly qualityBaselineCaseCount: number;
  readonly validArtifactCount: number;
  readonly cases: readonly SkillEvalCase[];
  readonly issues: readonly SkillEvalValidationIssue[];
  readonly artifacts: readonly SkillEvalArtifactReport[];
};

type JsonRecord = Readonly<Record<string, unknown>>;

type QualityEvalPartialIssue = Omit<SkillEvalValidationIssue, "skillId" | "path" | "caseId"> & {
  readonly caseId?: string;
};

type QualityBaselineFacts = {
  readonly present: boolean;
  readonly valid: boolean;
  readonly withSkill: boolean;
  readonly withoutSkill: boolean;
  readonly passed?: boolean;
  readonly minDelta?: number;
  readonly withSkillSample?: string;
};

export async function validateSkillEvalArtifacts(skill: AgentSkillDefinition): Promise<SkillEvalArtifactSummary> {
  const resources = skill.resourceIndex
    .filter((resource) => resource.type === "eval" && resource.exists)
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const artifacts = await Promise.all(resources.map((resource) => validateEvalArtifact(skill, resource.relativePath)));
  const issues = artifacts.flatMap((artifact) => artifact.issues);
  return {
    artifactCount: artifacts.length,
    caseCount: artifacts.reduce((sum, artifact) => sum + artifact.caseCount, 0),
    routingCaseCount: artifacts.reduce((sum, artifact) => sum + artifact.routingCaseCount, 0),
    qualityCaseCount: artifacts.reduce((sum, artifact) => sum + artifact.qualityCaseCount, 0),
    regressionCaseCount: artifacts.reduce((sum, artifact) => sum + artifact.regressionCaseCount, 0),
    qualityBaselineCaseCount: artifacts.reduce((sum, artifact) => sum + artifact.qualityBaselineCaseCount, 0),
    validArtifactCount: artifacts.filter((artifact) => artifact.issues.every((issue) => issue.severity !== "error")).length,
    cases: artifacts.flatMap((artifact) => artifact.cases),
    issues,
    artifacts,
  };
}

async function validateEvalArtifact(
  skill: AgentSkillDefinition,
  relativePath: string
): Promise<SkillEvalArtifactReport> {
  const absolutePath = path.join(skill.packagePath, relativePath);
  let raw: string;
  try {
    raw = await fs.readFile(absolutePath, "utf8");
  } catch (error) {
    return artifactReport(relativePath, [{
      code: "eval_read_failed",
      severity: "error",
      skillId: skill.id,
      path: relativePath,
      message: error instanceof Error ? error.message : String(error),
    }]);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return artifactReport(relativePath, [{
      code: "eval_not_json",
      severity: "error",
      skillId: skill.id,
      path: relativePath,
      message: error instanceof Error ? error.message : String(error),
    }]);
  }

  if (!isRecord(parsed)) {
    return artifactReport(relativePath, [{
      code: "eval_not_object",
      severity: "error",
      skillId: skill.id,
      path: relativePath,
      message: "Skill eval artifact must be a JSON object.",
    }]);
  }

  const cases = parsed.cases;
  if (cases === undefined) {
    return artifactReport(relativePath, [{
      code: "missing_eval_cases",
      severity: "error",
      skillId: skill.id,
      path: relativePath,
      message: "Skill eval artifact must define a cases array.",
    }]);
  }
  if (!Array.isArray(cases)) {
    return artifactReport(relativePath, [{
      code: "eval_cases_not_array",
      severity: "error",
      skillId: skill.id,
      path: relativePath,
      message: "Skill eval artifact cases must be an array.",
    }]);
  }

  const issues: SkillEvalValidationIssue[] = [];
  const validCases: SkillEvalCase[] = [];
  let validCaseCount = 0;
  let routingCaseCount = 0;
  let qualityCaseCount = 0;
  let regressionCaseCount = 0;
  let qualityBaselineCaseCount = 0;
  for (const [index, candidate] of cases.entries()) {
    if (!isRecord(candidate)) {
      issues.push({
        code: "eval_case_not_object",
        severity: "error",
        skillId: skill.id,
        path: `${relativePath}#cases[${index}]`,
        message: "Skill eval case must be a JSON object.",
      });
      continue;
    }
    const caseId = stringField(candidate.id);
    const casePath = caseId === undefined ? `${relativePath}#cases[${index}]` : `${relativePath}#${caseId}`;
    if (caseId === undefined) {
      issues.push({
        code: "missing_eval_case_id",
        severity: "error",
        skillId: skill.id,
        path: casePath,
        message: "Skill eval case must define a non-empty id.",
      });
    }
    const goal = stringField(candidate.goal);
    if (goal === undefined) {
      issues.push({
        code: "missing_eval_goal",
        severity: "error",
        skillId: skill.id,
        path: casePath,
        caseId,
        message: "Skill eval case must define a non-empty goal.",
      });
    }
    const kind = evalCaseKind(candidate.kind);
    if (kind === undefined) {
      issues.push({
        code: "invalid_eval_kind",
        severity: "error",
        skillId: skill.id,
        path: casePath,
        caseId,
        message: "Skill eval case kind must be routing, quality, or regression.",
      });
    }
    if (kind === "routing") {
      routingCaseCount += 1;
      const expected = candidate.expected;
      const expectsSelected = isRecord(expected) && expected.selected === true;
      const expectsRejected = isRecord(expected) && expected.selected === false;
      if (!expectsSelected && !expectsRejected) {
        issues.push({
          code: "missing_routing_assertion",
          severity: "warning",
          skillId: skill.id,
          path: casePath,
          caseId,
          message: "Routing eval case should assert expected.selected as true or false.",
        });
      }
    }
    const qualityFacts = qualityAssertionFacts(candidate);
    if (kind === "quality" || kind === "regression") {
      qualityCaseCount += 1;
      if (kind === "regression") {
        regressionCaseCount += 1;
      }
      if (qualityFacts.assertionCount === 0) {
        issues.push({
          code: "missing_quality_assertion",
          severity: "warning",
          skillId: skill.id,
          path: casePath,
          caseId,
          message: "Quality eval case should define at least one expected assertion such as contains, notContains, minScore, or rubric.",
        });
      }
      if (!qualityFacts.hasWithSkillBaseline || !qualityFacts.hasWithoutSkillBaseline) {
        issues.push({
          code: "missing_quality_baseline",
          severity: "warning",
          skillId: skill.id,
          path: casePath,
          caseId,
          message: "Quality eval case should define baseline.withSkill and baseline.withoutSkill for with/without skill comparison.",
        });
      } else {
        qualityBaselineCaseCount += 1;
      }
      for (const issue of qualityFacts.issues) {
        issues.push({
          ...issue,
          skillId: skill.id,
          path: casePath,
          caseId,
        });
      }
    }
    if (caseId !== undefined && goal !== undefined && kind !== undefined) {
      validCaseCount += 1;
      validCases.push({
        id: caseId,
        kind,
        goal,
        path: casePath,
        expectedSelected: expectedSelected(candidate.expected),
        qualityAssertionCount: qualityFacts.assertionCount,
        hasWithSkillBaseline: qualityFacts.hasWithSkillBaseline,
        hasWithoutSkillBaseline: qualityFacts.hasWithoutSkillBaseline,
        qualityBaselinePassed: qualityFacts.baselinePassed,
        qualityCheckCount: qualityFacts.checkCount,
        qualityCheckPassedCount: qualityFacts.checkPassedCount,
        qualityMustInclude: qualityFacts.mustInclude,
        qualityMustNotInclude: qualityFacts.mustNotInclude,
        qualityMinDelta: qualityFacts.minDelta,
      });
    }
  }

  return {
    path: relativePath,
    caseCount: validCaseCount,
    routingCaseCount,
    qualityCaseCount,
    regressionCaseCount,
    qualityBaselineCaseCount,
    cases: validCases,
    issues,
  };
}

function artifactReport(
  relativePath: string,
  issues: readonly SkillEvalValidationIssue[]
): SkillEvalArtifactReport {
  return {
    path: relativePath,
    caseCount: 0,
    routingCaseCount: 0,
    qualityCaseCount: 0,
    regressionCaseCount: 0,
    qualityBaselineCaseCount: 0,
    cases: [],
    issues,
  };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function evalCaseKind(value: unknown): SkillEvalCaseKind | undefined {
  return value === "routing" || value === "quality" || value === "regression" ? value : undefined;
}

function expectedSelected(value: unknown): boolean | undefined {
  return isRecord(value) && typeof value.selected === "boolean" ? value.selected : undefined;
}

function qualityAssertionFacts(value: JsonRecord): {
  readonly assertionCount: number;
  readonly hasWithSkillBaseline: boolean;
  readonly hasWithoutSkillBaseline: boolean;
  readonly baselinePassed?: boolean;
  readonly checkCount: number;
  readonly checkPassedCount: number;
  readonly mustInclude: readonly string[];
  readonly mustNotInclude: readonly string[];
  readonly minDelta?: number;
  readonly issues: readonly QualityEvalPartialIssue[];
} {
  const expected = isRecord(value.expected) ? value.expected : {};
  const assertionCount = [
    nonEmptyStringArray(expected.contains).length,
    nonEmptyStringArray(expected.notContains).length,
    typeof expected.minScore === "number" && Number.isFinite(expected.minScore) ? 1 : 0,
    stringField(expected.rubric) === undefined ? 0 : 1,
  ].reduce((sum, count) => sum + count, 0);
  const issues: QualityEvalPartialIssue[] = [];
  const baseline = qualityBaselineFacts(value, issues);
  const checks = qualityCheckFacts(value, baseline.withSkillSample, issues);
  return {
    assertionCount,
    hasWithSkillBaseline: baseline.withSkill,
    hasWithoutSkillBaseline: baseline.withoutSkill,
    baselinePassed: baseline.passed,
    checkCount: checks.checkCount,
    checkPassedCount: checks.passedCount,
    mustInclude: checks.mustInclude,
    mustNotInclude: checks.mustNotInclude,
    minDelta: baseline.minDelta,
    issues,
  };
}

function nonEmptyStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function isNonEmptyBaseline(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (!isRecord(value)) {
    return false;
  }
  return stringField(value.expectedOutput) !== undefined ||
    stringField(value.notes) !== undefined ||
    stringField(value.summary) !== undefined ||
    stringField(value.outputSample) !== undefined ||
    scoreField(value) !== undefined ||
    nonEmptyStringArray(value.contains).length > 0 ||
    nonEmptyStringArray(value.notContains).length > 0;
}

function qualityBaselineFacts(
  value: JsonRecord,
  issues: QualityEvalPartialIssue[]
): QualityBaselineFacts {
  const baseline = baselineRecord(value);
  const withSkill = baseline === undefined ? undefined : baselineRecordValue(baseline.withSkill);
  const withoutSkill = baseline === undefined ? undefined : baselineRecordValue(baseline.withoutSkill);
  const hasWithSkill = isNonEmptyBaseline(withSkill);
  const hasWithoutSkill = isNonEmptyBaseline(withoutSkill);
  if (baseline === undefined) {
    return {
      present: false,
      valid: false,
      withSkill: false,
      withoutSkill: false,
    };
  }

  let valid = true;
  const withScore = scoreField(withSkill);
  const withoutScore = scoreField(withoutSkill);
  if (withScore === undefined || withoutScore === undefined) {
    valid = false;
    issues.push({
      code: "invalid_quality_baseline",
      severity: "warning",
      message: "Quality baseline withSkill.score and withoutSkill.score should be finite numbers from 0 to 5.",
    });
  }
  const minDeltaValue = baseline.minDelta;
  const minDelta = minDeltaValue === undefined ? undefined : scoreDeltaField(minDeltaValue);
  if (minDeltaValue !== undefined && minDelta === undefined) {
    valid = false;
    issues.push({
      code: "invalid_quality_baseline",
      severity: "warning",
      message: "Quality baseline minDelta should be a non-negative finite number.",
    });
  }
  const withSummary = isRecord(withSkill) ? stringField(withSkill.summary) : undefined;
  const withoutSummary = isRecord(withoutSkill) ? stringField(withoutSkill.summary) : undefined;
  if (withSummary === undefined || withoutSummary === undefined) {
    valid = false;
    issues.push({
      code: "invalid_quality_baseline",
      severity: "warning",
      message: "Quality baseline withSkill.summary and withoutSkill.summary should be non-empty strings.",
    });
  }

  const sample = outputSample(withSkill);
  if (sample !== undefined && sample.length > 4_000) {
    valid = false;
    issues.push({
      code: "invalid_quality_baseline",
      severity: "warning",
      message: "Quality baseline outputSample should be 4000 characters or fewer.",
    });
  }

  let passed: boolean | undefined;
  if (withScore !== undefined && withoutScore !== undefined && minDelta !== undefined) {
    passed = withScore - withoutScore >= minDelta;
    if (!passed) {
      issues.push({
        code: "quality_baseline_delta_failed",
        severity: "warning",
        message: "Quality baseline withSkill.score does not improve over withoutSkill.score by minDelta.",
      });
    }
  }

  return {
    present: true,
    valid,
    withSkill: hasWithSkill,
    withoutSkill: hasWithoutSkill,
    passed,
    minDelta,
    withSkillSample: sample,
  };
}

function qualityCheckFacts(
  value: JsonRecord,
  outputSample: string | undefined,
  issues: QualityEvalPartialIssue[]
): {
  readonly checkCount: number;
  readonly passedCount: number;
  readonly mustInclude: readonly string[];
  readonly mustNotInclude: readonly string[];
} {
  const checks = isRecord(value.qualityChecks) ? value.qualityChecks : {};
  const withSkillChecks = isRecord(checks.withSkill) ? checks.withSkill : {};
  const mustInclude = nonEmptyStringArray(withSkillChecks.mustInclude);
  const mustNotInclude = nonEmptyStringArray(withSkillChecks.mustNotInclude);
  let checkCount = mustInclude.length + mustNotInclude.length;
  let passedCount = 0;
  if (checkCount === 0) {
    return { checkCount, passedCount, mustInclude, mustNotInclude };
  }
  if (outputSample === undefined) {
    issues.push({
      code: "quality_check_failed",
      severity: "warning",
      message: "Quality checks require qualityBaseline.withSkill.outputSample.",
    });
    return { checkCount, passedCount, mustInclude, mustNotInclude };
  }
  for (const token of mustInclude) {
    if (outputSample.includes(token)) {
      passedCount += 1;
    } else {
      issues.push({
        code: "quality_check_failed",
        severity: "warning",
        message: `Quality check mustInclude failed for token ${JSON.stringify(token)}.`,
      });
    }
  }
  for (const token of mustNotInclude) {
    if (!outputSample.includes(token)) {
      passedCount += 1;
    } else {
      issues.push({
        code: "quality_check_failed",
        severity: "warning",
        message: `Quality check mustNotInclude failed for token ${JSON.stringify(token)}.`,
      });
    }
  }
  return { checkCount, passedCount, mustInclude, mustNotInclude };
}

function baselineRecord(value: JsonRecord): JsonRecord | undefined {
  if (isRecord(value.qualityBaseline)) {
    return value.qualityBaseline;
  }
  return isRecord(value.baseline) ? value.baseline : undefined;
}

function baselineRecordValue(value: unknown): unknown {
  return value;
}

function scoreField(value: unknown): number | undefined {
  if (!isRecord(value) || typeof value.score !== "number" || !Number.isFinite(value.score)) {
    return undefined;
  }
  return value.score >= 0 && value.score <= 5 ? value.score : undefined;
}

function scoreDeltaField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function outputSample(value: unknown): string | undefined {
  return isRecord(value) ? stringField(value.outputSample) : undefined;
}
