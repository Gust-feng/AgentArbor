import type { DirectionHandoffPackage, DirectionHandoffPackageFilePath } from "./contracts.js";
import { DIRECTION_HANDOFF_PACKAGE_FILES } from "./schema.js";
import type { AddDirectionHandoffPackageIssue } from "./validation-issues.js";

export function validateFileContract(
  pkg: DirectionHandoffPackage,
  addIssue: AddDirectionHandoffPackageIssue
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

export function validateSoilReferences(
  pkg: DirectionHandoffPackage,
  addIssue: AddDirectionHandoffPackageIssue
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

export function validateDirectionEvidenceBoundary(
  pkg: DirectionHandoffPackage,
  addIssue: AddDirectionHandoffPackageIssue
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
