import type { ToolDisplayProjection } from "../../domain/tools/index.js";

export type AgentRunTreeAttachmentStatus = "running" | "completed" | "failed" | "stopped";

export type AgentRunTreeAttachmentRootletKind =
  | "option"
  | "risk"
  | "asset_fit"
  | "evidence"
  | "constraint"
  | "counterfactual";

export type AgentRunTreeSpecAttachment = {
  readonly specId: string;
  readonly agentId: string;
  readonly displayName: string;
  readonly agentKind: string;
  readonly role: string;
  readonly rootletKind?: AgentRunTreeAttachmentRootletKind;
  readonly promptRef: string;
  readonly outputContractRef: string;
  readonly permissions: {
    readonly allowModel: boolean;
    readonly allowedTools: readonly string[];
  };
  readonly budget: {
    readonly maxModelRounds?: number;
    readonly maxToolRounds?: number;
    readonly maxChildRuns?: number;
    readonly maxOutputRefs?: number;
  };
};

export type AgentRunTreeChildExecutionAttachment = {
  readonly modelRounds: number;
  readonly toolRounds: number;
  readonly modelRequestId?: string;
  readonly modelResponseId?: string;
  readonly modelMessages?: readonly {
    readonly requestId: string;
    readonly responseId?: string;
    readonly status: "completed" | "failed" | "cancelled";
    readonly text?: string;
    readonly reasoningSummary?: string;
    readonly toolCallIds: readonly string[];
    readonly finishReason?: "stop" | "length" | "tool_call" | "content_filter" | "error";
    readonly completedAt: string;
  }[];
  readonly toolCalls: readonly {
    readonly callId: string;
    readonly toolName: string;
    readonly status: "completed" | "failed" | "approval_required" | "cancelled";
    readonly summary?: string;
    readonly inputSummary?: string;
    readonly durationMs?: number;
    readonly display?: ToolDisplayProjection;
  }[];
};

export type AgentRunTreeChildExecutionSegmentAttachment = AgentRunTreeChildExecutionAttachment & {
  readonly outcome: "completed" | "blocked" | "failed" | "interrupted";
  readonly recordedAt: string;
};

export type AgentRunTreeChildPendingApprovalAttachment = {
  readonly confirmationId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly title: string;
  readonly actionSummary: string;
  readonly affectedResources: readonly string[];
  readonly riskLevel: "low" | "medium" | "high";
  readonly resumeAvailability?: "live" | "lost_after_restart";
  readonly requestedAt: string;
  readonly expiresAt?: string;
  readonly sourceRefs: readonly string[];
};

export type AgentRunTreeChildParentInstructionAttachment = {
  readonly instructionId: string;
  readonly messageRef?: string;
  readonly source: "manager" | "control_api";
  readonly status: "queued" | "executed" | "cancelled";
  readonly instructionSummary: string;
  readonly review?: {
    readonly decision: "accepted" | "rejected" | "needs_followup";
    readonly reason: string;
    readonly evidenceRefs: readonly string[];
    readonly confidence?: number;
  };
  readonly requestedAt: string;
  readonly queuedAt?: string;
  readonly executedAt?: string;
  readonly cancelledAt?: string;
};

export type AgentRunTreeAttachment = {
  readonly treeId: string;
  readonly rootRunId: string;
  readonly rootAgentId: string;
  readonly rootSpec: AgentRunTreeSpecAttachment;
  readonly childRuns: readonly {
    readonly childRunId: string;
    readonly parentAgentId: string;
    readonly spec: AgentRunTreeSpecAttachment;
    readonly status: string;
    readonly inputRefs: readonly string[];
    readonly outputRefs: readonly string[];
    readonly evidenceRefs: readonly string[];
    readonly failureReason?: string;
    readonly uncertainty?: string;
    readonly confidence?: number;
    readonly execution?: AgentRunTreeChildExecutionAttachment;
    readonly executionHistory?: readonly AgentRunTreeChildExecutionSegmentAttachment[];
    readonly parentInstructions?: readonly AgentRunTreeChildParentInstructionAttachment[];
    readonly pendingApproval?: AgentRunTreeChildPendingApprovalAttachment;
    readonly startedAt: string;
    readonly completedAt?: string;
  }[];
  readonly delegationDecisions: readonly {
    readonly decisionId: string;
    readonly parentAgentId: string;
    readonly action: string;
    readonly childSpecIds: readonly string[];
    readonly childRunIds: readonly string[];
    readonly rationale: string;
    readonly uncertainty: string;
    readonly source: string;
    readonly confidence: number;
    readonly reasoningTraceRefs: readonly string[];
    readonly createdAt: string;
  }[];
  readonly parentSyntheses: readonly {
    readonly synthesisId: string;
    readonly parentAgentId: string;
    readonly childRunIds: readonly string[];
    readonly retainedMaterialRefs: readonly string[];
    readonly rejectedMaterialRefs: readonly string[];
    readonly conflictRefs: readonly string[];
    readonly childReviews?: readonly {
      readonly childRunId: string;
      readonly decision: "accepted" | "rejected" | "needs_followup";
      readonly reason: string;
      readonly evidenceRefs: readonly string[];
      readonly sourceCandidateId?: string;
      readonly confidence?: number;
    }[];
    readonly outputRefs: readonly string[];
    readonly nextAction: string;
    readonly decisionSummary: string;
    readonly uncertainty: string;
    readonly source: string;
    readonly confidence: number;
    readonly reasoningTraceRefs: readonly string[];
    readonly createdAt: string;
  }[];
  readonly status: AgentRunTreeAttachmentStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
};
