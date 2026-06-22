import type { IntelligenceChannel, ModelBudget } from "../../domain/intelligence/index.js";
import type { SkillValidationIssue } from "./skill-validation.js";
import { validateSkillEvalArtifacts } from "./skill-eval-artifact.js";
import { discoverSkills, loadSkillBodyFacts, type AgentSkillDefinition } from "./skill-loader.js";
import { runSkillQualityEvals, type SkillQualityEvalReport } from "./skill-quality-eval.js";
import { runSkillRoutingEvals, type SkillRoutingEvalReport } from "./skill-routing-eval.js";

export type SkillDoctorSeverity = "error" | "warning" | "info";

export type SkillDoctorIssueCode =
  | "invalid_skill"
  | "missing_routing_hint"
  | "not_invocable"
  | "missing_declared_resource"
  | "large_skill_body"
  | "missing_eval_artifact"
  | "invalid_eval_artifact"
  | "missing_routing_eval_case"
  | "missing_quality_eval_assertion"
  | "missing_quality_eval_baseline"
  | "invalid_quality_eval_baseline"
  | "quality_eval_baseline_delta_failed"
  | "quality_eval_check_failed"
  | "quality_eval_failed"
  | "routing_eval_failed";

export type SkillDoctorIssue = {
  readonly code: SkillDoctorIssueCode;
  readonly severity: SkillDoctorSeverity;
  readonly skillId: string;
  readonly message: string;
  readonly path?: string;
};

export type SkillDoctorSkillReport = {
  readonly skillId: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly valid: boolean;
  readonly bodyCharCount?: number;
  readonly resourceCount: number;
  readonly evalArtifactCount: number;
  readonly evalCaseCount: number;
  readonly qualityEvalCaseCount: number;
  readonly regressionEvalCaseCount: number;
  readonly qualityEvalBaselineCaseCount: number;
  readonly routingEvalCaseCount: number;
  readonly routingEvalPassedCount: number;
  readonly routingEvalFailedCount: number;
  readonly routingEvalSkippedCount: number;
  readonly qualityEvalRunCaseCount: number;
  readonly qualityEvalRunPassedCount: number;
  readonly qualityEvalRunFailedCount: number;
  readonly qualityEvalRunSkippedCount: number;
  readonly issues: readonly SkillDoctorIssue[];
};

export type SkillDoctorReport = {
  readonly rootCount: number;
  readonly skillCount: number;
  readonly validSkillCount: number;
  readonly evalArtifactCount: number;
  readonly evalCaseCount: number;
  readonly qualityEvalCaseCount: number;
  readonly regressionEvalCaseCount: number;
  readonly qualityEvalBaselineCaseCount: number;
  readonly routingEvalCaseCount: number;
  readonly routingEvalPassedCount: number;
  readonly routingEvalFailedCount: number;
  readonly routingEvalSkippedCount: number;
  readonly qualityEvalRunCaseCount: number;
  readonly qualityEvalRunPassedCount: number;
  readonly qualityEvalRunFailedCount: number;
  readonly qualityEvalRunSkippedCount: number;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly skills: readonly SkillDoctorSkillReport[];
};

export type RunSkillDoctorOptions = {
  readonly roots: readonly string[];
  readonly maxBodyChars?: number;
  readonly intelligenceChannel?: IntelligenceChannel;
  readonly routingEvalBudget?: ModelBudget;
  readonly runQualityEvals?: boolean;
  readonly qualityEvalBudget?: ModelBudget;
  readonly qualityEvalMaxSkillBodyChars?: number;
};

const DEFAULT_MAX_BODY_CHARS = 4_000;

export async function runSkillDoctor(options: RunSkillDoctorOptions): Promise<SkillDoctorReport> {
  const skills = await discoverSkills({ roots: options.roots });
  const routingEvalReport = options.intelligenceChannel === undefined
    ? undefined
    : await runSkillRoutingEvals({
      skills,
      intelligenceChannel: options.intelligenceChannel,
      budget: options.routingEvalBudget,
    });
  const qualityEvalReport = options.runQualityEvals === true && options.intelligenceChannel !== undefined
    ? await runSkillQualityEvals({
      skills,
      intelligenceChannel: options.intelligenceChannel,
      budget: options.qualityEvalBudget,
      maxSkillBodyChars: options.qualityEvalMaxSkillBodyChars,
    })
    : undefined;
  const skillReports = await Promise.all(skills.map((skill) =>
    diagnoseSkill(skill, options.maxBodyChars ?? DEFAULT_MAX_BODY_CHARS, routingEvalReport, qualityEvalReport)
  ));
  const issues = skillReports.flatMap((report) => report.issues);
  return {
    rootCount: options.roots.length,
    skillCount: skillReports.length,
    validSkillCount: skillReports.filter((report) => report.valid).length,
    evalArtifactCount: skillReports.reduce((sum, report) => sum + report.evalArtifactCount, 0),
    evalCaseCount: skillReports.reduce((sum, report) => sum + report.evalCaseCount, 0),
    qualityEvalCaseCount: skillReports.reduce((sum, report) => sum + report.qualityEvalCaseCount, 0),
    regressionEvalCaseCount: skillReports.reduce((sum, report) => sum + report.regressionEvalCaseCount, 0),
    qualityEvalBaselineCaseCount: skillReports.reduce((sum, report) => sum + report.qualityEvalBaselineCaseCount, 0),
    routingEvalCaseCount: skillReports.reduce((sum, report) => sum + report.routingEvalCaseCount, 0),
    routingEvalPassedCount: skillReports.reduce((sum, report) => sum + report.routingEvalPassedCount, 0),
    routingEvalFailedCount: skillReports.reduce((sum, report) => sum + report.routingEvalFailedCount, 0),
    routingEvalSkippedCount: skillReports.reduce((sum, report) => sum + report.routingEvalSkippedCount, 0),
    qualityEvalRunCaseCount: skillReports.reduce((sum, report) => sum + report.qualityEvalRunCaseCount, 0),
    qualityEvalRunPassedCount: skillReports.reduce((sum, report) => sum + report.qualityEvalRunPassedCount, 0),
    qualityEvalRunFailedCount: skillReports.reduce((sum, report) => sum + report.qualityEvalRunFailedCount, 0),
    qualityEvalRunSkippedCount: skillReports.reduce((sum, report) => sum + report.qualityEvalRunSkippedCount, 0),
    errorCount: issues.filter((issue) => issue.severity === "error").length,
    warningCount: issues.filter((issue) => issue.severity === "warning").length,
    infoCount: issues.filter((issue) => issue.severity === "info").length,
    skills: skillReports,
  };
}

async function diagnoseSkill(
  skill: AgentSkillDefinition,
  maxBodyChars: number,
  routingEvalReport: SkillRoutingEvalReport | undefined,
  qualityEvalReport: SkillQualityEvalReport | undefined
): Promise<SkillDoctorSkillReport> {
  const issues: SkillDoctorIssue[] = [];
  const valid = skill.enabled && skill.loadError === undefined && (skill.validationErrors?.length ?? 0) === 0;
  for (const issue of skill.validationErrors ?? []) {
    issues.push(validationIssue(skill, issue));
  }
  if (skill.loadError !== undefined && (skill.validationErrors?.length ?? 0) === 0) {
    issues.push({
      code: "invalid_skill",
      severity: "error",
      skillId: skill.id,
      message: skill.loadError,
    });
  }
  if (valid && skill.triggers.length === 0 && skill.whenToUse === undefined && skill.disableModelInvocation !== true) {
    issues.push({
      code: "missing_routing_hint",
      severity: "warning",
      skillId: skill.id,
      message: "Skill has no triggers or when_to_use; model routing has only description metadata.",
    });
  }
  if (valid && skill.disableModelInvocation === true && skill.userInvocable === false) {
    issues.push({
      code: "not_invocable",
      severity: "warning",
      skillId: skill.id,
      message: "Skill disables model invocation and is not user-invocable, so ordinary runs cannot select it.",
    });
  }
  for (const resource of skill.resourceIndex) {
    if (resource.source === "frontmatter" && !resource.exists) {
      issues.push({
        code: "missing_declared_resource",
        severity: "warning",
        skillId: skill.id,
        path: resource.relativePath,
        message: `Declared ${resource.type} resource does not exist: ${resource.relativePath}.`,
      });
    }
  }
  const evalArtifactCount = skill.resourceIndex.filter((resource) => resource.type === "eval" && resource.exists).length;
  let evalCaseCount = 0;
  let qualityEvalCaseCount = 0;
  let regressionEvalCaseCount = 0;
  let qualityEvalBaselineCaseCount = 0;
  let routingEvalCaseCount = 0;
  let routingEvalPassedCount = 0;
  let routingEvalFailedCount = 0;
  let routingEvalSkippedCount = 0;
  let qualityEvalRunCaseCount = 0;
  let qualityEvalRunPassedCount = 0;
  let qualityEvalRunFailedCount = 0;
  let qualityEvalRunSkippedCount = 0;
  if (valid && evalArtifactCount === 0) {
    issues.push({
      code: "missing_eval_artifact",
      severity: "info",
      skillId: skill.id,
      message: "Skill has no evals/ artifacts; add local eval cases when this skill becomes a repeatable workflow.",
    });
  }
  if (valid && evalArtifactCount > 0) {
    const evalSummary = await validateSkillEvalArtifacts(skill);
    evalCaseCount = evalSummary.caseCount;
    qualityEvalCaseCount = evalSummary.qualityCaseCount;
    regressionEvalCaseCount = evalSummary.regressionCaseCount;
    qualityEvalBaselineCaseCount = evalSummary.qualityBaselineCaseCount;
    routingEvalCaseCount = evalSummary.routingCaseCount;
    for (const issue of evalSummary.issues) {
      issues.push({
        code: doctorIssueCodeForEvalIssue(issue.code, issue.severity),
        severity: issue.severity,
        skillId: skill.id,
        path: issue.path,
        message: issue.message,
      });
    }
  }
  if (valid && routingEvalReport !== undefined) {
    const skillRoutingResults = routingEvalReport.results.filter((result) => result.skillId === skill.id);
    routingEvalPassedCount = skillRoutingResults.filter((result) => result.status === "passed").length;
    routingEvalFailedCount = skillRoutingResults.filter((result) => result.status === "failed").length;
    routingEvalSkippedCount = skillRoutingResults.filter((result) => result.status === "skipped").length;
    for (const result of skillRoutingResults.filter((item) => item.status === "failed")) {
      issues.push({
        code: "routing_eval_failed",
        severity: "warning",
        skillId: skill.id,
        path: result.path,
        message: `Routing eval case "${result.caseId}" expected selected=${result.expectedSelected} but got selected=${result.actualSelected}.`,
      });
    }
  }
  if (valid && qualityEvalReport !== undefined) {
    const skillQualityResults = qualityEvalReport.results.filter((result) => result.skillId === skill.id);
    qualityEvalRunCaseCount = skillQualityResults.length;
    qualityEvalRunPassedCount = skillQualityResults.filter((result) => result.status === "passed").length;
    qualityEvalRunFailedCount = skillQualityResults.filter((result) => result.status === "failed").length;
    qualityEvalRunSkippedCount = skillQualityResults.filter((result) => result.status === "skipped").length;
    for (const result of skillQualityResults.filter((item) => item.status === "failed")) {
      issues.push({
        code: "quality_eval_failed",
        severity: "warning",
        skillId: skill.id,
        path: result.path,
        message: `Quality eval case "${result.caseId}" failed deterministic checks: ${result.reason ?? "unknown"}`,
      });
    }
  }

  let bodyCharCount: number | undefined;
  if (valid) {
    try {
      const facts = await loadSkillBodyFacts(skill);
      bodyCharCount = facts.body.length;
      if (bodyCharCount > maxBodyChars) {
        issues.push({
          code: "large_skill_body",
          severity: "info",
          skillId: skill.id,
          message: `Skill body has ${bodyCharCount} characters; prefer moving details into references/.`,
        });
      }
    } catch (error) {
      issues.push({
        code: "invalid_skill",
        severity: "error",
        skillId: skill.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    skillId: skill.id,
    name: skill.name,
    enabled: skill.enabled,
    valid,
    bodyCharCount,
    resourceCount: skill.resourceIndex.length,
    evalArtifactCount,
    evalCaseCount,
    qualityEvalCaseCount,
    regressionEvalCaseCount,
    qualityEvalBaselineCaseCount,
    routingEvalCaseCount,
    routingEvalPassedCount,
    routingEvalFailedCount,
    routingEvalSkippedCount,
    qualityEvalRunCaseCount,
    qualityEvalRunPassedCount,
    qualityEvalRunFailedCount,
    qualityEvalRunSkippedCount,
    issues,
  };
}

function doctorIssueCodeForEvalIssue(
  code: string,
  severity: SkillDoctorSeverity
): SkillDoctorIssueCode {
  if (severity === "error") {
    return "invalid_eval_artifact";
  }
  if (code === "missing_quality_assertion") {
    return "missing_quality_eval_assertion";
  }
  if (code === "missing_quality_baseline") {
    return "missing_quality_eval_baseline";
  }
  if (code === "invalid_quality_baseline") {
    return "invalid_quality_eval_baseline";
  }
  if (code === "quality_baseline_delta_failed") {
    return "quality_eval_baseline_delta_failed";
  }
  if (code === "quality_check_failed") {
    return "quality_eval_check_failed";
  }
  return "missing_routing_eval_case";
}

function validationIssue(skill: AgentSkillDefinition, issue: SkillValidationIssue): SkillDoctorIssue {
  return {
    code: "invalid_skill",
    severity: "error",
    skillId: skill.id,
    path: issue.path,
    message: issue.message,
  };
}
