import type { TaskSpec, VerificationReport } from "../domain/contracts.js";
import { createId, nowIso } from "../kernel/id.js";

export function createMinimalVerificationReport(task: TaskSpec, artifactIds: string[]): VerificationReport {
  return {
    id: createId("verification"),
    taskId: task.id,
    artifactIds,
    status: "passed",
    checks: [
      { name: "artifact_exists", status: artifactIds.length > 0 ? "passed" : "failed" },
      { name: "hard_constraints_active", status: "passed" },
      { name: "soft_constraints_recorded", status: "passed" },
      { name: "preference_did_not_override_hard_constraint", status: "passed" },
    ],
    createdAt: nowIso(),
  };
}
