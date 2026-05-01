import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DirectionHandoffPackage,
  DirectionHandoffPackageCandidateReference,
  DirectionHandoffPackageFile,
  DirectionHandoffPackageFilePath,
  DirectionHandoffPackageValidationIssue,
  DirectionHandoffPackageValidationResult,
  DirectionHandoff,
  ConvergenceReview,
} from "../contracts.js";
import { assertDirectionHandoffConverged } from "./direction-handoff.js";

export const DIRECTION_HANDOFF_PACKAGE_SCHEMA_VERSION = "direction-handoff-package/v0.2" as const;

export const DIRECTION_HANDOFF_PACKAGE_FILES: readonly DirectionHandoffPackageFile[] = [
  { path: "handoff.meta.json", role: "package_metadata", contentType: "application/json", required: true },
  { path: "direction.md", role: "direction_brief", contentType: "text/markdown", required: true },
  { path: "options.json", role: "direction_evidence", contentType: "application/json", required: true },
  { path: "decision-record.md", role: "direction_evidence", contentType: "text/markdown", required: true },
  { path: "constraints.json", role: "constraint_refs", contentType: "application/json", required: true },
  { path: "soil-refs.json", role: "soil_refs", contentType: "application/json", required: true },
  { path: "evidence-index.md", role: "evidence_index", contentType: "text/markdown", required: true },
  { path: "risk-register.md", role: "direction_evidence", contentType: "text/markdown", required: true },
  { path: "open-questions.md", role: "open_questions", contentType: "text/markdown", required: true },
  { path: "escalation-rules.md", role: "escalation_rules", contentType: "text/markdown", required: true },
  { path: "growth-entry.json", role: "growth_entry", contentType: "application/json", required: true },
];

export interface DirectionHandoffPackageStore {
  save(pkg: DirectionHandoffPackage): DirectionHandoffPackage;
  load(directionId: string, version: number): DirectionHandoffPackage;
  listVersions(directionId: string): number[];
  validate(pkg: DirectionHandoffPackage): DirectionHandoffPackageValidationResult;
}

export class DirectionHandoffPackageValidationError extends Error {
  readonly result: DirectionHandoffPackageValidationResult;

  constructor(result: DirectionHandoffPackageValidationResult) {
    super(`DirectionHandoffPackage validation failed: ${result.errors.map((error) => error.code).join(", ")}`);
    this.name = "DirectionHandoffPackageValidationError";
    this.result = result;
  }
}

export class DirectionHandoffPackageStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DirectionHandoffPackageStoreError";
  }
}

export function createDirectionHandoffPackage(input: {
  directionHandoff: DirectionHandoff;
  convergenceReview: ConvergenceReview;
  createdAt?: string;
  updatedAt?: string;
}): DirectionHandoffPackage {
  const files = cloneFiles(DIRECTION_HANDOFF_PACKAGE_FILES);
  const createdAt = input.createdAt ?? input.directionHandoff.createdAt;
  const updatedAt = input.updatedAt ?? input.directionHandoff.updatedAt;
  const candidateReferenceIndex = createCandidateReferenceIndex(
    input.directionHandoff,
    input.convergenceReview
  );
  const basePackage: DirectionHandoffPackage = {
    manifest: {
      packageId: `${input.directionHandoff.id}@v${input.directionHandoff.version}`,
      schemaVersion: DIRECTION_HANDOFF_PACKAGE_SCHEMA_VERSION,
      directionId: input.directionHandoff.id,
      directionVersion: input.directionHandoff.version,
      status: input.directionHandoff.status,
      sourceGoalId: input.directionHandoff.sourceGoalId,
      createdAt,
      updatedAt,
      files,
    },
    directionHandoff: input.directionHandoff,
    convergenceReview: input.convergenceReview,
    candidateReferenceIndex,
    files,
    validation: {
      passed: false,
      checkedAt: nowIso(),
      errors: [],
      warnings: [],
    },
  };

  return withValidation(basePackage);
}

export function validateDirectionHandoffPackage(
  pkg: DirectionHandoffPackage
): DirectionHandoffPackageValidationResult {
  const errors: DirectionHandoffPackageValidationIssue[] = [];
  const warnings: DirectionHandoffPackageValidationIssue[] = [];
  const addError = (code: string, path: string, message: string): void => {
    errors.push({ code, path, message, severity: "error" });
  };

  if (pkg.manifest.schemaVersion !== DIRECTION_HANDOFF_PACKAGE_SCHEMA_VERSION) {
    addError(
      "INVALID_SCHEMA_VERSION",
      "manifest.schemaVersion",
      "DirectionHandoffPackage must use the V0.2 schema version."
    );
  }

  if (pkg.manifest.directionId !== pkg.directionHandoff.id) {
    addError("MANIFEST_DIRECTION_ID_MISMATCH", "manifest.directionId", "Manifest directionId must match handoff id.");
  }

  if (pkg.manifest.directionVersion !== pkg.directionHandoff.version) {
    addError(
      "MANIFEST_DIRECTION_VERSION_MISMATCH",
      "manifest.directionVersion",
      "Manifest directionVersion must match handoff version."
    );
  }

  if (pkg.manifest.status !== pkg.directionHandoff.status) {
    addError("MANIFEST_STATUS_MISMATCH", "manifest.status", "Manifest status must match handoff status.");
  }

  if (pkg.manifest.sourceGoalId !== pkg.directionHandoff.sourceGoalId) {
    addError(
      "MANIFEST_SOURCE_GOAL_MISMATCH",
      "manifest.sourceGoalId",
      "Manifest sourceGoalId must match handoff sourceGoalId."
    );
  }

  if (pkg.directionHandoff.status !== "approved") {
    addError(
      "DIRECTION_HANDOFF_NOT_APPROVED",
      "directionHandoff.status",
      "Aboveground planning requires an approved DirectionHandoffPackage."
    );
  }

  if (typeof pkg.directionHandoff.convergenceReviewRef !== "string" || pkg.directionHandoff.convergenceReviewRef.trim() === "") {
    addError(
      "MISSING_CONVERGENCE_REVIEW_REF",
      "directionHandoff.convergenceReviewRef",
      "DirectionHandoffPackage must reference a convergence review."
    );
  }

  if (!Array.isArray(pkg.directionHandoff.sourceCandidateRefs) || pkg.directionHandoff.sourceCandidateRefs.length === 0) {
    addError(
      "MISSING_SOURCE_CANDIDATE_REFS",
      "directionHandoff.sourceCandidateRefs",
      "DirectionHandoffPackage must include source candidate references."
    );
  }

  if (pkg.directionHandoff.convergenceReviewRef !== pkg.convergenceReview.reviewId) {
    addError(
      "CONVERGENCE_REVIEW_REF_MISMATCH",
      "convergenceReview.reviewId",
      "Package convergence review must match DirectionHandoff.convergenceReviewRef."
    );
  }

  try {
    assertDirectionHandoffConverged(pkg.directionHandoff, pkg.convergenceReview);
  } catch (error) {
    addError(
      "UNCONVERGED_SOURCE_CANDIDATES",
      "directionHandoff.sourceCandidateRefs",
      error instanceof Error ? error.message : "DirectionHandoff contains unconverged candidates."
    );
  }

  validateCandidateReferenceIndex(pkg, addError);
  validateFileContract(pkg, addError);
  validateSoilReferences(pkg, addError);
  validateDirectionEvidenceBoundary(pkg, addError);

  return {
    passed: errors.length === 0,
    checkedAt: nowIso(),
    errors,
    warnings,
  };
}

export function assertDirectionHandoffPackageValidForPlanning(pkg: DirectionHandoffPackage): void {
  const validation = validateDirectionHandoffPackage(pkg);
  if (!validation.passed) {
    throw new DirectionHandoffPackageValidationError(validation);
  }
}

export class InMemoryDirectionHandoffPackageStore implements DirectionHandoffPackageStore {
  private readonly packages = new Map<string, DirectionHandoffPackage>();

  save(pkg: DirectionHandoffPackage): DirectionHandoffPackage {
    const stored = withValidation(pkg);
    this.packages.set(packageKey(stored.manifest.directionId, stored.manifest.directionVersion), clonePackage(stored));
    return clonePackage(stored);
  }

  load(directionId: string, version: number): DirectionHandoffPackage {
    const stored = this.packages.get(packageKey(directionId, version));
    if (stored === undefined) {
      throw new DirectionHandoffPackageStoreError(`DirectionHandoffPackage not found: ${directionId}@v${version}`);
    }
    return withValidation(clonePackage(stored));
  }

  listVersions(directionId: string): number[] {
    const prefix = `${directionId}@v`;
    return [...this.packages.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => Number(key.slice(prefix.length)))
      .filter((version) => Number.isInteger(version))
      .sort((a, b) => a - b);
  }

  validate(pkg: DirectionHandoffPackage): DirectionHandoffPackageValidationResult {
    return validateDirectionHandoffPackage(pkg);
  }
}

export class FileSystemDirectionHandoffPackageStore implements DirectionHandoffPackageStore {
  constructor(private readonly rootDirectory: string) {
    if (rootDirectory.trim() === "") {
      throw new DirectionHandoffPackageStoreError(
        "FileSystemDirectionHandoffPackageStore requires an explicit root directory."
      );
    }
  }

  save(pkg: DirectionHandoffPackage): DirectionHandoffPackage {
    const stored = withValidation(pkg);
    const packageDirectory = this.packageDirectory(stored.manifest.directionId, stored.manifest.directionVersion);
    mkdirSync(packageDirectory, { recursive: true });

    const serializedFiles = serializeDirectionHandoffPackageFiles(stored);
    for (const [filePath, content] of Object.entries(serializedFiles)) {
      writeFileSync(join(packageDirectory, filePath), content, "utf8");
    }

    return clonePackage(stored);
  }

  load(directionId: string, version: number): DirectionHandoffPackage {
    const packageDirectory = this.packageDirectory(directionId, version);
    const metaPath = join(packageDirectory, "handoff.meta.json");
    if (!existsSync(metaPath)) {
      throw new DirectionHandoffPackageStoreError(`DirectionHandoffPackage not found: ${directionId}@v${version}`);
    }

    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as {
      manifest: DirectionHandoffPackage["manifest"];
      directionHandoff: DirectionHandoff;
      convergenceReview: ConvergenceReview;
      candidateReferenceIndex: DirectionHandoffPackageCandidateReference[];
      files: DirectionHandoffPackageFile[];
      validation: DirectionHandoffPackageValidationResult;
    };

    return withValidation({
      manifest: meta.manifest,
      directionHandoff: meta.directionHandoff,
      convergenceReview: meta.convergenceReview,
      candidateReferenceIndex: meta.candidateReferenceIndex,
      files: meta.files,
      validation: meta.validation,
    });
  }

  listVersions(directionId: string): number[] {
    const directionDirectory = join(this.rootDirectory, "directions", encodeURIComponent(directionId));
    if (!existsSync(directionDirectory)) {
      return [];
    }

    return readdirSync(directionDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^v\d+$/.test(entry.name))
      .map((entry) => Number(entry.name.slice(1)))
      .sort((a, b) => a - b);
  }

  validate(pkg: DirectionHandoffPackage): DirectionHandoffPackageValidationResult {
    return validateDirectionHandoffPackage(pkg);
  }

  private packageDirectory(directionId: string, version: number): string {
    return join(this.rootDirectory, "directions", encodeURIComponent(directionId), `v${version}`);
  }
}

export function serializeDirectionHandoffPackageFiles(
  pkg: DirectionHandoffPackage
): Record<DirectionHandoffPackageFilePath, string> {
  const stored = withValidation(pkg);
  return {
    "handoff.meta.json": `${JSON.stringify(stored, null, 2)}\n`,
    "direction.md": renderDirection(stored.directionHandoff),
    "options.json": `${JSON.stringify(stored.directionHandoff.options, null, 2)}\n`,
    "decision-record.md": renderDecisionRecord(stored.directionHandoff),
    "constraints.json": `${JSON.stringify(
      {
        constraintRefs: stored.directionHandoff.constraintRefs,
        candidateConstraintRefs: stored.directionHandoff.candidateConstraintRefs,
      },
      null,
      2
    )}\n`,
    "soil-refs.json": `${JSON.stringify({ soilRefs: stored.directionHandoff.soilRefs }, null, 2)}\n`,
    "evidence-index.md": renderList("Evidence Index", stored.directionHandoff.evidenceRefs),
    "risk-register.md": renderRiskRegister(stored.directionHandoff),
    "open-questions.md": renderList("Open Questions", stored.directionHandoff.missingInformation),
    "escalation-rules.md": renderList("Escalation Rules", stored.directionHandoff.growthEntry.escalationRules),
    "growth-entry.json": `${JSON.stringify(stored.directionHandoff.growthEntry, null, 2)}\n`,
  };
}

function createCandidateReferenceIndex(
  handoff: DirectionHandoff,
  convergenceReview: ConvergenceReview
): DirectionHandoffPackageCandidateReference[] {
  return handoff.sourceCandidateRefs.map((candidate) => ({
    candidateId: candidate.id,
    kind: candidate.kind,
    producedByAgentId: candidate.producedByAgentId,
    clusterId: candidate.clusterId,
    sourceRefs: [...candidate.sourceRefs],
    status: candidate.status,
    convergenceReviewRef: convergenceReview.reviewId,
  }));
}

function validateCandidateReferenceIndex(
  pkg: DirectionHandoffPackage,
  addIssue: (code: string, path: string, message: string) => void
): void {
  const sourceCandidateIds = new Set(pkg.directionHandoff.sourceCandidateRefs.map((candidate) => candidate.id));
  const indexedCandidateIds = new Set(pkg.candidateReferenceIndex.map((candidate) => candidate.candidateId));

  for (const candidateId of sourceCandidateIds) {
    if (!indexedCandidateIds.has(candidateId)) {
      addIssue(
        "CANDIDATE_INDEX_MISSING_SOURCE_REF",
        "candidateReferenceIndex",
        `Candidate reference index is missing source candidate ${candidateId}.`
      );
    }
  }

  for (const candidateId of indexedCandidateIds) {
    if (!sourceCandidateIds.has(candidateId)) {
      addIssue(
        "CANDIDATE_INDEX_HAS_NON_SOURCE_REF",
        "candidateReferenceIndex",
        `Candidate reference index contains non-source candidate ${candidateId}.`
      );
    }
  }
}

function validateFileContract(
  pkg: DirectionHandoffPackage,
  addIssue: (code: string, path: string, message: string) => void
): void {
  const manifestFilePaths = new Set(pkg.manifest.files.map((file) => file.path));
  const packageFilePaths = new Set(pkg.files.map((file) => file.path));

  for (const expectedFile of DIRECTION_HANDOFF_PACKAGE_FILES) {
    if (!manifestFilePaths.has(expectedFile.path)) {
      addIssue("MISSING_MANIFEST_FILE", "manifest.files", `Manifest is missing ${expectedFile.path}.`);
    }
    if (!packageFilePaths.has(expectedFile.path)) {
      addIssue("MISSING_PACKAGE_FILE", "files", `Package file list is missing ${expectedFile.path}.`);
    }
  }

  const evidenceOnlyFiles: DirectionHandoffPackageFilePath[] = [
    "options.json",
    "decision-record.md",
    "risk-register.md",
  ];
  for (const filePath of evidenceOnlyFiles) {
    const file = pkg.files.find((entry) => entry.path === filePath);
    if (file !== undefined && file.role !== "direction_evidence") {
      addIssue(
        "DIRECTION_EVIDENCE_FILE_ROLE_INVALID",
        `files.${filePath}`,
        `${filePath} must remain direction evidence and must not become GrowthPlan material.`
      );
    }
  }
}

function validateSoilReferences(
  pkg: DirectionHandoffPackage,
  addIssue: (code: string, path: string, message: string) => void
): void {
  const soilRefs = pkg.directionHandoff.soilRefs as unknown[];
  if (!Array.isArray(soilRefs)) {
    addIssue("SOIL_REFS_NOT_ARRAY", "directionHandoff.soilRefs", "Soil references must be an array of refs.");
    return;
  }

  for (const [index, soilRef] of soilRefs.entries()) {
    if (typeof soilRef !== "string" || soilRef.trim() === "") {
      addIssue(
        "INLINE_SOIL_ASSET_CONTENT",
        `directionHandoff.soilRefs.${index}`,
        "DirectionHandoffPackage may include only Soil refs, not inline Soil asset content, body, or copies."
      );
    }
  }

  const packageRecord = pkg as unknown as Record<string, unknown>;
  if (hasInlineSoilContent(packageRecord.soilReferenceIndex)) {
    addIssue(
      "INLINE_SOIL_ASSET_CONTENT",
      "soilReferenceIndex",
      "Soil reference indexes may include refs only, not inline Soil asset content, body, or copies."
    );
  }
}

function validateDirectionEvidenceBoundary(
  pkg: DirectionHandoffPackage,
  addIssue: (code: string, path: string, message: string) => void
): void {
  const packageRecord = pkg as unknown as Record<string, unknown>;
  if ("growthPlan" in packageRecord) {
    addIssue(
      "GROWTH_PLAN_INLINE_IN_HANDOFF_PACKAGE",
      "growthPlan",
      "DirectionHandoffPackage must not embed GrowthPlan; Aboveground Center creates it after validation."
    );
  }
}

function hasInlineSoilContent(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => hasInlineSoilContent(entry));
  }
  if (typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  const disallowedKeys = new Set(["content", "body", "copy", "assetContent", "assetBody", "soilAssetContent"]);
  return Object.entries(record).some(
    ([key, nestedValue]) => disallowedKeys.has(key) || hasInlineSoilContent(nestedValue)
  );
}

function withValidation(pkg: DirectionHandoffPackage): DirectionHandoffPackage {
  const withoutValidation = {
    ...pkg,
    validation: {
      passed: false,
      checkedAt: nowIso(),
      errors: [],
      warnings: [],
    },
  };
  return {
    ...withoutValidation,
    validation: validateDirectionHandoffPackage(withoutValidation),
  };
}

function clonePackage(pkg: DirectionHandoffPackage): DirectionHandoffPackage {
  return JSON.parse(JSON.stringify(pkg)) as DirectionHandoffPackage;
}

function cloneFiles(files: readonly DirectionHandoffPackageFile[]): DirectionHandoffPackageFile[] {
  return files.map((file) => ({ ...file }));
}

function packageKey(directionId: string, version: number): string {
  return `${directionId}@v${version}`;
}

function renderDirection(handoff: DirectionHandoff): string {
  return `# Direction Handoff

Direction: ${handoff.clarifiedGoal}

## Non Goals
${markdownList(handoff.nonGoals)}

## Assumptions
${markdownList(handoff.assumptions)}

## Risks
${markdownList(handoff.risks)}
`;
}

function renderDecisionRecord(handoff: DirectionHandoff): string {
  return `# Decision Record

- retainedOptionId: ${handoff.decisionRecord.retainedOptionId}
- mergedOptionIds: ${handoff.decisionRecord.mergedOptionIds.join(", ") || "none"}
- rejectedOptionIds: ${handoff.decisionRecord.rejectedOptionIds.join(", ") || "none"}
- userDecisionRequired: ${handoff.decisionRecord.userDecisionRequired.join(", ") || "none"}
- abovegroundReferenceOptionIds: ${handoff.decisionRecord.abovegroundReferenceOptionIds.join(", ") || "none"}
`;
}

function renderRiskRegister(handoff: DirectionHandoff): string {
  const risks = handoff.riskRegister.map(
    (risk) => `- ${risk.riskId}: ${risk.name} (${risk.blockingLevel})`
  );
  return `# Risk Register

${risks.length > 0 ? risks.join("\n") : "- none"}
`;
}

function renderList(title: string, entries: string[]): string {
  return `# ${title}

${markdownList(entries)}
`;
}

function markdownList(entries: string[]): string {
  return entries.length > 0 ? entries.map((entry) => `- ${entry}`).join("\n") : "- none";
}

function nowIso(): string {
  return new Date().toISOString();
}
