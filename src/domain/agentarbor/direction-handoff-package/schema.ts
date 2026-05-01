import type { DirectionHandoffPackageFile } from "./contracts.js";

export const DIRECTION_HANDOFF_PACKAGE_SCHEMA_VERSION = "direction-handoff-package/v0.2" as const;

// The handoff package references Soil; it is not a Soil copy or final asset store.
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
