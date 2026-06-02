export type TaskStatus =
  | "queued"
  | "planning"
  | "running"
  | "needs_input"
  | "approval_needed"
  | "paused"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export type ObservationRef = {
  readonly kind: string;
  readonly id: string;
  readonly label?: string;
};
