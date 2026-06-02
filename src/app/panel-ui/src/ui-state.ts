import type { TaskStatus } from "./contracts/common";

export type SettingsTab = "model" | "workspace" | "skills" | "tools" | "safety";

export const terminalStatuses = new Set<TaskStatus>(["completed", "failed", "cancelled", "blocked"]);
