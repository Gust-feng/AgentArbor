import type { Constraint } from "../constraints.js";
export * from "./store.js";
export * from "./task-soil.js";

export function createMinimalSoilConstraints(): Constraint[] {
  return [
    {
      id: "constraint-minimal-runtime-only",
      source: "user",
      type: "scope",
      level: "hard",
      statement: "First-phase demo must remain local, in-memory, and free of real network calls by default.",
      owner: "user",
      appliesTo: ["minimal-runtime-kernel"],
      evidenceRefs: ["docs/开发指南/06-工程实现/06-最小实现边界.md"],
      enforcementGate: "task_assignment",
      conflictPolicy: "block",
      status: "active",
    },
    {
      id: "constraint-record-soft-deviation",
      source: "soil",
      type: "verification",
      level: "soft",
      statement: "Soft constraint deviations must be visible in verification and run memory.",
      owner: "verification",
      appliesTo: ["minimal-runtime-kernel"],
      evidenceRefs: ["docs/开发指南/04-模型与契约/07-约束工程.md"],
      enforcementGate: "verification",
      conflictPolicy: "verification_reviews",
      status: "active",
    },
    {
      id: "constraint-prefer-proven-path",
      source: "soil",
      type: "evolution",
      level: "preference",
      statement: "Prefer a previously verified minimal path when it does not conflict with hard constraints.",
      owner: "governance",
      appliesTo: ["minimal-runtime-kernel"],
      evidenceRefs: ["docs/开发指南/02-核心闭环/06-路径倾向机制.md"],
      enforcementGate: "growth_plan",
      conflictPolicy: "aboveground_center_decides",
      status: "active",
    },
  ];
}
