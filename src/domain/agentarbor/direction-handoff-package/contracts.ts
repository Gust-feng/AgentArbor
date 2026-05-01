import type { ConvergenceReview, DirectionHandoff, ExplorationCandidateRef } from "../../underground/contracts.js";

export type DirectionHandoffPackageFilePath =
  | "handoff.meta.json"
  | "direction.md"
  | "options.json"
  | "decision-record.md"
  | "constraints.json"
  | "soil-refs.json"
  | "evidence-index.md"
  | "risk-register.md"
  | "open-questions.md"
  | "escalation-rules.md"
  | "growth-entry.json";

export type DirectionHandoffPackageFileRole =
  | "package_metadata"
  | "direction_brief"
  | "direction_evidence"
  | "constraint_refs"
  | "soil_refs"
  | "evidence_index"
  | "open_questions"
  | "escalation_rules"
  | "growth_entry";

export type DirectionHandoffPackageFile = {
  path: DirectionHandoffPackageFilePath;
  role: DirectionHandoffPackageFileRole;
  contentType: "application/json" | "text/markdown";
  required: true;
};

export type DirectionHandoffPackageManifest = {
  packageId: string;
  schemaVersion: "direction-handoff-package/v0.2";
  directionId: string;
  directionVersion: number;
  status: DirectionHandoff["status"];
  sourceGoalId: string;
  createdAt: string;
  updatedAt: string;
  files: DirectionHandoffPackageFile[];
};

export type DirectionHandoffPackageRef = {
  packageId: string;
  directionId: string;
  version: number;
  status: DirectionHandoff["status"];
  schemaVersion: DirectionHandoffPackageManifest["schemaVersion"];
};

export type DirectionHandoffPackageRevisionReason =
  | "initial"
  | "user_clarification_answered";

export type DirectionHandoffPackageLineage = {
  current: DirectionHandoffPackageRef;
  previous?: DirectionHandoffPackageRef;
  revisionReason: DirectionHandoffPackageRevisionReason;
  sourceRefs: string[];
  createdAt: string;
};

export type DirectionHandoffPackageCandidateReference = {
  candidateId: string;
  kind: ExplorationCandidateRef["kind"];
  producedByAgentId: string;
  clusterId: string;
  sourceRefs: string[];
  status: ExplorationCandidateRef["status"];
  convergenceReviewRef: string;
};

export type DirectionHandoffPackageValidationIssue = {
  code: string;
  message: string;
  path: string;
  severity: "error" | "warning";
};

export type DirectionHandoffPackageValidationResult = {
  passed: boolean;
  checkedAt: string;
  errors: DirectionHandoffPackageValidationIssue[];
  warnings: DirectionHandoffPackageValidationIssue[];
};

export type DirectionHandoffPackage = {
  manifest: DirectionHandoffPackageManifest;
  lineage: DirectionHandoffPackageLineage;
  directionHandoff: DirectionHandoff;
  convergenceReview: ConvergenceReview;
  candidateReferenceIndex: DirectionHandoffPackageCandidateReference[];
  files: DirectionHandoffPackageFile[];
  validation: DirectionHandoffPackageValidationResult;
};

export interface DirectionHandoffPackageStore {
  save(pkg: DirectionHandoffPackage): DirectionHandoffPackage;
  load(directionId: string, version: number): DirectionHandoffPackage;
  listVersions(directionId: string): number[];
  validate(pkg: DirectionHandoffPackage): DirectionHandoffPackageValidationResult;
}
