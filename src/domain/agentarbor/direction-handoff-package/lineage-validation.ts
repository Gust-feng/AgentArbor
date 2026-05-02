import type { DirectionHandoffPackage } from "./contracts.js";
import type { AddDirectionHandoffPackageIssue } from "./validation-issues.js";

export function validateLineage(
  pkg: DirectionHandoffPackage,
  addIssue: AddDirectionHandoffPackageIssue
): void {
  const lineage = pkg.lineage;
  if (lineage === undefined) {
    addIssue("MISSING_PACKAGE_LINEAGE", "lineage", "DirectionHandoffPackage must carry lineage metadata.");
    return;
  }

  if (lineage.current.packageId !== pkg.manifest.packageId) {
    addIssue("LINEAGE_CURRENT_PACKAGE_MISMATCH", "lineage.current.packageId", "Lineage current packageId must match manifest.");
  }
  if (lineage.current.directionId !== pkg.manifest.directionId) {
    addIssue("LINEAGE_CURRENT_DIRECTION_MISMATCH", "lineage.current.directionId", "Lineage current directionId must match manifest.");
  }
  if (lineage.current.version !== pkg.manifest.directionVersion) {
    addIssue("LINEAGE_CURRENT_VERSION_MISMATCH", "lineage.current.version", "Lineage current version must match manifest.");
  }
  if (lineage.current.status !== pkg.manifest.status) {
    addIssue("LINEAGE_CURRENT_STATUS_MISMATCH", "lineage.current.status", "Lineage current status must match manifest.");
  }
  if (lineage.current.schemaVersion !== pkg.manifest.schemaVersion) {
    addIssue(
      "LINEAGE_CURRENT_SCHEMA_VERSION_MISMATCH",
      "lineage.current.schemaVersion",
      "Lineage current schemaVersion must match manifest."
    );
  }

  if (lineage.revisionReason === "initial" && lineage.previous !== undefined) {
    addIssue("INITIAL_LINEAGE_HAS_PREVIOUS", "lineage.previous", "Initial DirectionHandoffPackage lineage must not point to a previous package.");
  }
  if (lineage.revisionReason !== "initial" && lineage.previous === undefined) {
    addIssue("REVISION_LINEAGE_MISSING_PREVIOUS", "lineage.previous", "Revised DirectionHandoffPackage lineage must point to the previous package.");
  }
  if (lineage.previous !== undefined) {
    if (lineage.previous.directionId !== pkg.manifest.directionId) {
      addIssue("LINEAGE_PREVIOUS_DIRECTION_MISMATCH", "lineage.previous.directionId", "Revised package lineage must stay on the same direction id.");
    }
    if (lineage.previous.version >= pkg.manifest.directionVersion) {
      addIssue("LINEAGE_PREVIOUS_VERSION_INVALID", "lineage.previous.version", "Lineage previous version must be lower than the current package version.");
    }
  }

  if (!Array.isArray(lineage.sourceRefs) || lineage.sourceRefs.length === 0) {
    addIssue("LINEAGE_SOURCE_REFS_EMPTY", "lineage.sourceRefs", "Package lineage must record source refs for the revision.");
  }
  if (typeof lineage.createdAt !== "string" || lineage.createdAt.trim() === "") {
    addIssue("LINEAGE_CREATED_AT_MISSING", "lineage.createdAt", "Package lineage must record createdAt.");
  }
}
