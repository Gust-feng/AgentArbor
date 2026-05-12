import type { TaskStatus } from "./types";

export type SettingsTab = "model" | "workspace" | "skills" | "tools" | "safety";

export const terminalStatuses = new Set<TaskStatus>(["completed", "failed", "cancelled", "blocked"]);
