export type PanelRunStatus =
  | "pending"
  | "running"
  | "approval_needed"
  | "needs_input"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked";
