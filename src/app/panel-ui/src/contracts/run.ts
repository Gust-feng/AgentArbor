import type { ObservationRef, TaskStatus } from "./common";
import type { ModelCapabilities } from "./config";
import type { ContextAttachment } from "./context";
import type {
  ToolDisplayProjection,
  ToolErrorFacts,
  ToolFileDisplayOperation,
} from "./tools";
import type {
  OrdinaryPanelReplay,
  OrdinaryPanelRunDetail,
  OrdinaryPanelRunView,
} from "../../../panel-read-model/ordinary-agent-run-contracts";

export type RunAgentDefinitionRef = {
  readonly agentId: string;
  readonly agentDisplayName: string;
  readonly promptRef: string;
  readonly promptVersion: string;
  readonly outputContractId: string;
  readonly toolVisibilityProfileId: string;
  readonly definitionHash?: string;
};

export type RunToolExposure = {
  readonly name: string;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly modelVisible: boolean;
  readonly scopes: readonly string[];
  readonly availability: "available" | "unavailable";
  readonly riskLevel: "low" | "medium" | "high";
  readonly operationType: "read-only" | "read-write" | "execute" | "external-submit";
  readonly fileOperation?: ToolFileDisplayOperation;
  readonly requiresConfirmation: boolean;
  readonly confirmationPolicy?: "prompt" | "full_access";
  readonly reasonCode?: string;
  readonly reason: string;
};

export type ProtocolToolCallCapabilities = {
  readonly protocolKind: string;
  readonly canSendToolDefinitions: boolean;
  readonly canReceiveToolCalls: boolean;
  readonly canRoundTripToolResults: boolean;
};

export type RunCapabilityPlanToolPolicy = {
  readonly canExposeToModel: boolean;
  readonly allowedTools: readonly string[];
};

export type RunCapabilityPlanFilePolicy = {
  readonly canReadWorkspace: boolean;
  readonly canWriteWorkspace: boolean;
  readonly canDeleteWorkspace: boolean;
  readonly canExecuteCommands: boolean;
};

export type RunCapabilityPlanUiPolicy = {
  readonly canShowStreamingOutput: boolean;
  readonly canShowToolCards: boolean;
  readonly visibleToolNames: readonly string[];
};

export type RunCapabilityPlan = {
  readonly protocolToolCallCapabilities: ProtocolToolCallCapabilities;
  readonly modelCapabilities: ModelCapabilities;
  readonly canExposeModelTools: boolean;
  readonly tools?: RunCapabilityPlanToolPolicy;
  readonly fileOperations?: RunCapabilityPlanFilePolicy;
  readonly uiDisplay?: RunCapabilityPlanUiPolicy;
  readonly allowedTools: readonly string[];
  readonly warnings: readonly string[];
};

export type CapabilitySkillMetadataValue = string | number | boolean | readonly string[];

export type RunEnabledSkill = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly triggers: readonly string[];
  readonly summary?: string;
  readonly category?: string;
  readonly metadata?: Readonly<Record<string, CapabilitySkillMetadataValue>>;
  readonly allowedTools?: readonly string[];
  readonly contentHash?: string;
  readonly bodyHash?: string;
};

export type RunCapabilityResolution = {
  readonly resolutionId: string;
  readonly snapshotId: string;
  readonly runMode: "agent";
  readonly agentId: string;
  readonly agentDisplayName: string;
  readonly toolVisibilityProfileId: string;
  readonly capabilityPlan: RunCapabilityPlan;
  readonly allowedTools: readonly string[];
  readonly toolExposures: readonly RunToolExposure[];
  readonly enabledSkills: readonly RunEnabledSkill[];
  readonly mcpDrafts: readonly {
    readonly draftId: string;
    readonly source: "mcp";
    readonly label: string;
    readonly availability: "configured" | "disabled" | "unavailable";
    readonly enabled: boolean;
    readonly reason: string;
  }[];
  readonly warnings: readonly string[];
  readonly createdAt: string;
};

export type BasicAgentRun = {
  readonly runId: string;
  readonly conversationId?: string;
  readonly title: string;
  readonly goalSummary: string;
  readonly status: TaskStatus;
  readonly runMode: "agent";
  readonly agentDefinitionRef?: RunAgentDefinitionRef;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly currentStep?: string;
  readonly nextStep?: string;
  readonly requiresUserAction: boolean;
  readonly eventCursor: {
    readonly lastSequence: number;
    readonly eventCount: number;
  };
};

export type RunEvent = {
  readonly id: string;
  readonly runId: string;
  readonly sequence: number;
  readonly type: string;
  readonly title: string;
  readonly summary?: string;
  readonly delta?: string;
  readonly status: TaskStatus;
  readonly timestamp: string;
  readonly toolName?: string;
  readonly refs: readonly ObservationRef[];
  readonly visibility: "compact" | "expanded" | "debug";
  readonly detail?: {
    readonly action?: string;
    readonly path?: string;
    readonly query?: string;
    readonly command?: string;
    readonly exitCode?: number;
    readonly preview?: string;
    readonly display?: ToolDisplayProjection;
    readonly truncated?: boolean;
    readonly error?: string;
    readonly errorDomain?: string;
    readonly errorFacts?: ToolErrorFacts;
  };
};

export type ModelUsage = {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly cachedInputTokens?: number;
  readonly cacheWriteInputTokens?: number;
  readonly uncachedInputTokens?: number;
  readonly reasoningOutputTokens?: number;
  readonly estimatedCostUsd?: number;
  readonly latencyMs?: number;
  readonly firstTokenLatencyMs?: number;
  readonly outputDurationMs?: number;
  readonly outputTokensPerSecond?: number;
};

export type PanelStreamEvent = {
  readonly eventId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly type: string;
  readonly createdAt: string;
  readonly agentLabel?: string;
  readonly summary?: string;
  readonly status?: string;
  readonly toolName?: string;
  readonly detail?: {
    readonly action?: string;
    readonly path?: string;
    readonly query?: string;
    readonly command?: string;
    readonly exitCode?: number;
    readonly preview?: string;
    readonly display?: ToolDisplayProjection;
    readonly error?: string;
    readonly errorDomain?: string;
    readonly errorFacts?: ToolErrorFacts;
    readonly truncated?: boolean;
    readonly modelUsage?: ModelUsage;
  };
};

export type TranscriptNodeKind =
  | "thinking"
  | "tool"
  | "confirmation"
  | "user_decision"
  | "answer"
  | "body"
  | "system";

export type TranscriptNodePhase =
  | "noted"
  | "preparing"
  | "waiting_approval"
  | "approved"
  | "denied"
  | "guidance"
  | "executing"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled";

export type TranscriptConfirmation = {
  readonly confirmationId: string;
  readonly ownerRunId: string;
  readonly toolCallFactId: string;
  readonly conversationId?: string;
  readonly title: string;
  readonly actionSummary: string;
  readonly affectedResources: readonly string[];
  readonly riskLevel: "low" | "medium" | "high";
  readonly resumeAvailability?: "live" | "lost_after_restart";
  readonly requestedAt: string;
  readonly expiresAt?: string;
  readonly sourceRefs: readonly string[];
};

export type TranscriptNode = {
  readonly nodeId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly eventType: string;
  readonly kind: TranscriptNodeKind;
  readonly phase: TranscriptNodePhase;
  readonly title: string;
  readonly summary?: string;
  readonly text?: string;
  readonly timestamp: string;
  readonly toolName?: string;
  readonly display?: ToolDisplayProjection;
  readonly confirmation?: TranscriptConfirmation;
  readonly modelUsage?: ModelUsage;
  readonly refs: readonly ObservationRef[];
};

export type DesktopRunDetail = OrdinaryPanelRunDetail;

export type PendingConfirmation = {
  readonly confirmationId: string;
  readonly title: string;
  readonly question: string;
  readonly consequence: string;
  readonly affectedResources?: readonly string[];
  readonly riskLevel: string;
  readonly resumeAvailability?: "live" | "lost_after_restart";
  readonly requestedAt?: string;
  readonly expiresAt?: string;
  readonly sourceRefs?: readonly string[];
};

export type OrdinaryRunCursor = string;

export type BasicAgentReplay = OrdinaryPanelReplay;

export type AgentDeliverable = {
  readonly deliverableId: string;
  readonly runId: string;
  readonly title: string;
  readonly summary: string;
  readonly sections: readonly {
    readonly sectionId: string;
    readonly title: string;
    readonly content: string;
    readonly evidenceRefs: readonly ObservationRef[];
  }[];
  readonly evidenceRefs: readonly ObservationRef[];
  readonly toolDisplays: readonly ToolDisplayProjection[];
  readonly fileChanges: readonly ToolDisplayProjection[];
  readonly commands: readonly ToolDisplayProjection[];
  readonly nextActions: readonly string[];
  readonly createdAt: string;
};

export type DesktopWorkViewAnswer = {
  readonly title: string;
  readonly content: string;
  readonly evidenceRefs: readonly ObservationRef[];
  readonly nextActions: readonly string[];
};

export type DesktopWorkView = {
  readonly run: BasicAgentRun;
  readonly stage:
    | "drafting"
    | "queued"
    | "understanding"
    | "gathering_context"
    | "using_tools"
    | "awaiting_approval"
    | "composing_result"
    | "completed"
    | "blocked"
    | "failed"
    | "cancelled";
  readonly headline: string;
  readonly currentAction: string;
  readonly contextAttachments: readonly ContextAttachment[];
  readonly pendingConfirmation?: {
    readonly confirmationId: string;
    readonly ownerRunId: string;
    readonly toolCallFactId: string;
    readonly conversationId?: string;
    readonly title: string;
    readonly actionSummary: string;
    readonly affectedResources: readonly string[];
    readonly riskLevel: "low" | "medium" | "high";
    readonly resumeAvailability?: "live" | "lost_after_restart";
    readonly requestedAt: string;
    readonly expiresAt?: string;
    readonly sourceRefs: readonly string[];
  };
  readonly answer?: DesktopWorkViewAnswer;
  readonly deliverable?: AgentDeliverable;
  readonly visibleEvents: readonly RunEvent[];
  readonly transcriptNodes?: readonly TranscriptNode[];
  readonly workSummary: {
    readonly summary: string;
    readonly pendingActionCount: number;
    readonly toolResultCount: number;
    readonly contextAttachmentCount: number;
  };
};

export type BasicAgentRunView = OrdinaryPanelRunView;
