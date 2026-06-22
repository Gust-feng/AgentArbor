import type { ObservationRef, TaskStatus } from "./common";
import type { ModelCapabilities } from "./config";
import type { ContextAttachment } from "./context";
import type {
  ToolDisplayProjection,
  ToolErrorFacts,
  ToolFileDisplayOperation,
  ToolResultEnvelope,
} from "./tools";
import type {
  PanelBasicAgentReplay,
  PanelBasicAgentRunDetail,
  PanelBasicAgentRunView,
} from "../../../panel-basic-agent-run-view-contracts";

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
    readonly envelope?: ToolResultEnvelope;
    readonly truncated?: boolean;
    readonly error?: string;
    readonly errorFacts?: ToolErrorFacts;
  };
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
    readonly envelope?: ToolResultEnvelope;
    readonly error?: string;
    readonly errorDomain?: string;
    readonly errorFacts?: ToolErrorFacts;
    readonly truncated?: boolean;
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
  readonly runId: string;
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
  readonly refs: readonly ObservationRef[];
};

export type DesktopRunCanvas = {
  readonly kind?: string;
  readonly agent?: {
    readonly answer?: { readonly answer: string };
    readonly pendingConfirmation?: {
      readonly confirmationId: string;
      readonly title: string;
      readonly question: string;
      readonly consequence: string;
      readonly riskLevel: string;
      readonly resumeAvailability?: "live" | "lost_after_restart";
    };
    readonly context?: {
      readonly usageSummary?: string;
      readonly items?: readonly {
        readonly itemId: string;
        readonly sourceKind: string;
        readonly summary: string;
        readonly truncated?: boolean;
      }[];
    };
  };
};

export type DesktopRunDetail = PanelBasicAgentRunDetail<
  PanelStreamEvent,
  TranscriptNode,
  DesktopRunCanvas
>;

export type PendingConfirmation = NonNullable<
  NonNullable<NonNullable<DesktopRunDetail["canvas"]>["agent"]>["pendingConfirmation"]
>;

export type BasicAgentReplay = PanelBasicAgentReplay<RunEvent>;

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

export type ContextLedgerSkillLoadStatus = "loaded" | "failed";

export type ContextLedgerSkillInjectionStatus = "loaded" | "injected" | "omitted" | "failed";

export type ContextLedgerSkillMarkUsedStatus = "succeeded" | "failed" | "skipped";

export type ContextLedgerSkillFacts = {
  readonly skillId: string;
  readonly name: string;
  readonly triggerReason: string;
  readonly summary: string;
  readonly sourceRef: string;
  readonly selectedAt?: string;
  readonly loadedAt?: string;
  readonly bodyHash?: string;
  readonly contentHash?: string;
  readonly bodyCharCount?: number;
  readonly loadStatus: ContextLedgerSkillLoadStatus;
  readonly injectionStatus: ContextLedgerSkillInjectionStatus;
  readonly markUsedStatus?: ContextLedgerSkillMarkUsedStatus;
  readonly truncated: boolean;
  readonly omitted: boolean;
  readonly error?: string;
  readonly warning?: string;
};

export type ContextLedgerEntry = {
  readonly entryId: string;
  readonly kind: "goal" | "attachment" | "history" | "skill" | "tool_evidence" | "budget" | "truncation";
  readonly title: string;
  readonly summary: string;
  readonly refs: readonly ObservationRef[];
  readonly status: "used" | "truncated" | "omitted" | "blocked" | "failed";
  readonly skill?: ContextLedgerSkillFacts;
};

export type TriggeredSkillReadModel = {
  readonly skillId: string;
  readonly name: string;
  readonly triggerReason: string;
  readonly summary: string;
  readonly sourceRef: string;
  readonly truncated: boolean;
  readonly loadedAt?: string;
  readonly bodyHash?: string;
  readonly contentHash?: string;
  readonly bodyCharCount?: number;
  readonly loadStatus?: ContextLedgerSkillLoadStatus;
  readonly injectionStatus?: ContextLedgerSkillInjectionStatus;
  readonly markUsedStatus?: ContextLedgerSkillMarkUsedStatus;
  readonly omitted?: boolean;
  readonly error?: string;
  readonly warning?: string;
};

export type ContextLedger = {
  readonly runId: string;
  readonly summary: string;
  readonly entries: readonly ContextLedgerEntry[];
  readonly budget?: {
    readonly maxMessages?: number;
    readonly maxInputTokens?: number;
    readonly usedInputTokens?: number;
    readonly tokenCountSource?: string;
    readonly maxChars?: number;
    readonly usedChars?: number;
    readonly inputTokenBudget?: number;
    readonly reservedOutputTokens?: number;
    readonly budgetSource?: string;
  };
  readonly truncation: {
    readonly truncated: boolean;
    readonly omittedItemCount: number;
    readonly truncatedItemIds: readonly string[];
  };
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
  readonly contextLedger: ContextLedger;
  readonly triggeredSkills: readonly TriggeredSkillReadModel[];
  readonly pendingConfirmation?: {
    readonly confirmationId: string;
    readonly runId: string;
    readonly conversationId?: string;
    readonly title: string;
    readonly actionSummary: string;
    readonly affectedResources: readonly string[];
    readonly riskLevel: "low" | "medium" | "high";
    readonly resumeAvailability?: "live" | "lost_after_restart";
    readonly requestedAt: string;
    readonly sourceRefs: readonly string[];
  };
  readonly answer?: DesktopWorkViewAnswer;
  readonly deliverable?: AgentDeliverable;
  readonly visibleEvents: readonly RunEvent[];
  readonly transcriptNodes?: readonly TranscriptNode[];
  readonly safetySummary: {
    readonly summary: string;
    readonly pendingActionCount: number;
    readonly toolResultCount: number;
    readonly contextAttachmentCount: number;
  };
};

type BackendBasicAgentRunView = PanelBasicAgentRunView<
  BasicAgentRun,
  DesktopWorkView,
  RunEvent,
  PanelStreamEvent,
  TranscriptNode,
  DesktopRunCanvas,
  RunCapabilityResolution
>;

export type BasicAgentRunView = BackendBasicAgentRunView;
