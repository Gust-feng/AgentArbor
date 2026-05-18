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

export type BasicAgentRun = {
  readonly runId: string;
  readonly conversationId?: string;
  readonly title: string;
  readonly goalSummary: string;
  readonly status: TaskStatus;
  readonly runMode: "agent" | "deep";
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
  readonly refs: readonly ObservationRef[];
  readonly visibility: "compact" | "expanded" | "debug";
};

export type ConversationTurn = {
  readonly turnId: string;
  readonly role: "user" | "assistant";
  readonly title?: string;
  readonly content: string;
  readonly status: string;
  readonly runId?: string;
};

export type Conversation = {
  readonly conversationId: string;
  readonly title: string;
  readonly turns: readonly ConversationTurn[];
  readonly activeRunId?: string;
  readonly latestRunId?: string;
  readonly queuedRunIds?: readonly string[];
  readonly updatedAt?: string;
};

export type ConversationSummary = {
  readonly conversationId: string;
  readonly title: string;
  readonly status?: string;
  readonly activeRunId?: string;
  readonly latestRunId?: string;
  readonly updatedAt?: string;
};

export type ToolDisplayProjection =
  | {
      readonly kind: "search_results";
      readonly query?: string;
      readonly status?: string;
      readonly results: readonly { readonly title: string; readonly url?: string; readonly summary?: string; readonly snippet?: string; readonly refId?: string; readonly source?: string }[];
      readonly truncated?: boolean;
    }
  | {
      readonly kind: "browser_snapshot";
      readonly title?: string;
      readonly url?: string;
      readonly summary?: string;
      readonly text?: string;
      readonly truncated?: boolean;
    }
  | {
      readonly kind: "file_change_summary" | "file_diff_preview";
      readonly path?: string;
      readonly summary?: string;
      readonly preview?: string;
      readonly bytes?: number;
      readonly replacements?: number;
      readonly previousLength?: number;
      readonly nextLength?: number;
      readonly append?: boolean;
    }
  | {
      readonly kind: "command_summary";
      readonly command?: string;
      readonly args?: readonly string[];
      readonly exitCode?: number;
      readonly outputSummary?: string;
      readonly errorSummary?: string;
    }
  | {
      readonly kind: "generic_tool_summary";
      readonly action?: string;
      readonly summary?: string;
      readonly items?: readonly string[];
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
    readonly truncated?: boolean;
  };
};

export type DesktopRunDetail = {
  readonly runId: string;
  readonly status: string;
  readonly error?: { readonly code: string; readonly message: string };
  readonly transcript?: {
    readonly events?: readonly PanelStreamEvent[];
  };
  readonly canvas?: {
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
    readonly workSession?: {
      readonly directAnswer?: { readonly answer: string };
      readonly report?: {
        readonly title?: string;
        readonly decisionSummary?: string;
        readonly nextActions?: readonly string[];
      };
    };
    readonly underground?: {
      readonly status?: string;
      readonly convergenceSummary?: string;
      readonly recommendedDirection?: { readonly reason?: string };
    };
  };
  readonly restoredResult?: {
    readonly title: string;
    readonly summary: string;
  };
};

export type PendingConfirmation = NonNullable<
  NonNullable<NonNullable<DesktopRunDetail["canvas"]>["agent"]>["pendingConfirmation"]
>;

export type ContextAttachment = {
  readonly attachmentId: string;
  readonly kind: "workspace" | "file" | "project" | "web";
  readonly ref: string;
  readonly title: string;
  readonly summary: string;
  readonly permissionRefs: readonly string[];
  readonly readonlyPreviewMeta: {
    readonly available: boolean;
    readonly title?: string;
    readonly byteLength?: number;
    readonly truncated?: boolean;
  };
  readonly status: "ready" | "blocked";
  readonly warning?: string;
};

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

export type DesktopWorkSessionAnswer = {
  readonly title: string;
  readonly content: string;
  readonly evidenceRefs: readonly ObservationRef[];
  readonly nextActions: readonly string[];
};

export type ContextLedger = {
  readonly runId: string;
  readonly summary: string;
  readonly entries: readonly {
    readonly entryId: string;
    readonly kind: "goal" | "attachment" | "history" | "skill" | "tool_evidence" | "budget" | "truncation";
    readonly title: string;
    readonly summary: string;
    readonly refs: readonly ObservationRef[];
    readonly status: "used" | "truncated" | "omitted" | "blocked";
  }[];
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

export type DesktopWorkSession = {
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
  readonly answer?: DesktopWorkSessionAnswer;
  readonly deliverable?: AgentDeliverable;
  readonly visibleEvents: readonly RunEvent[];
  readonly safetySummary: {
    readonly summary: string;
    readonly pendingActionCount: number;
    readonly toolResultCount: number;
    readonly contextAttachmentCount: number;
  };
};

export type SkillDefinition = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly triggers?: readonly string[];
  readonly lastUsedAt?: string;
};

export type ToolCatalogItem = {
  readonly name: string;
  readonly displayName?: string;
  readonly displayDescription?: string;
  readonly description?: string;
  readonly category?: string;
  readonly categoryLabel?: string;
  readonly riskLevel?: string;
  readonly riskLabel?: string;
  readonly operationType?: string;
  readonly operationLabel?: string;
  readonly enabled: boolean;
  readonly available?: boolean;
  readonly unavailableReason?: string;
  readonly requiresConfirmation?: boolean;
  readonly confirmationLabel?: string;
};

export type ConfigResponse = {
  readonly config?: {
    readonly profileId?: string;
    readonly label?: string;
    readonly providerKind?: string;
    readonly protocolKind?: string;
    readonly baseUrl?: string;
    readonly model?: string;
    readonly defaultAiMode?: "none" | "fake" | "openai-compatible";
    readonly secretConfigured?: boolean;
  };
  readonly profile?: ModelProviderProfile;
  readonly profiles?: readonly ModelProviderProfile[];
  readonly modelProviderMarket?: {
    readonly presets?: readonly ModelProviderPreset[];
  };
  readonly workspace?: {
    readonly workspaceDirectory?: string;
  };
  readonly capabilities?: {
    readonly activeModel?: { readonly label?: string; readonly model?: string; readonly secretConfigured?: boolean };
    readonly modelCapabilities?: {
      readonly contextWindowTokens?: number;
      readonly maxOutputTokens?: number;
      readonly supportsToolCalling?: boolean;
    };
    readonly warnings?: readonly string[];
  };
};

export type ModelProviderProfile = NonNullable<ConfigResponse["config"]>;

export type ModelProviderPreset = {
  readonly presetId: string;
  readonly label: string;
  readonly vendor: string;
  readonly description: string;
  readonly providerKind: string;
  readonly protocolKind: string;
  readonly baseUrl: string;
  readonly modelsPath: string;
  readonly defaultModel?: string;
  readonly regionLabel?: string;
  readonly docsUrl?: string;
};

export type ModelProviderModelCatalog = {
  readonly profileId: string;
  readonly label?: string;
  readonly baseUrl: string;
  readonly modelsPath: string;
  readonly fetchedAt: string;
  readonly models: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly owner?: string;
    readonly createdAt?: string;
  }[];
};

export type ToolsResponse = {
  readonly tools?: {
    readonly webSearch?: {
      readonly provider?: string;
      readonly maxResults?: number;
      readonly secretConfigured?: boolean;
    };
    readonly catalog?: {
      readonly tools?: readonly ToolCatalogItem[];
    };
  };
};
