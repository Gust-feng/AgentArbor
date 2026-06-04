import type { TaskStatus } from "./contracts/common";

export const terminalStatuses = new Set<TaskStatus>(["completed", "failed", "cancelled", "blocked"]);
