import type { ObservationRef } from "../observation/index.js";

export type AgentTaskStatus =
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

export type BasicAgentRun = {
  readonly runId: string;
  readonly conversationId?: string;
  readonly title: string;
  readonly goalSummary: string;
  readonly status: AgentTaskStatus;
  readonly runMode: "agent" | "deep";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly currentStep?: string;
  readonly nextStep?: string;
  readonly requiresUserAction?: boolean;
  readonly eventCursor: {
    readonly lastSequence: number;
    readonly eventCount: number;
  };
};

export type RunEventVisibility = "compact" | "expanded" | "debug";

export type RunEvent = {
  readonly id: string;
  readonly runId: string;
  readonly sequence: number;
  readonly type: string;
  readonly title: string;
  readonly summary?: string;
  readonly status: AgentTaskStatus;
  readonly timestamp: string;
  readonly refs: readonly ObservationRef[];
  readonly visibility: RunEventVisibility;
};

export type ConfirmationRiskLevel = "low" | "medium" | "high";

export type ConfirmationRequest = {
  readonly confirmationId: string;
  readonly runId: string;
  readonly conversationId?: string;
  readonly title: string;
  readonly actionSummary: string;
  readonly affectedResources: readonly string[];
  readonly riskLevel: ConfirmationRiskLevel;
  readonly requestedAt: string;
  readonly expiresAt?: string;
  readonly sourceRefs: readonly string[];
};

export type ConfirmationDecision = {
  readonly confirmationId: string;
  readonly runId: string;
  readonly decision: "approve_once" | "deny" | "guidance";
  readonly decidedAt: string;
  readonly guidance?: string;
};

export type SkillDefinition = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly sourcePath: string;
  readonly triggers: readonly string[];
  readonly lastUsedAt?: string;
};
