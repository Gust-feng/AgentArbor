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
      readonly results: readonly { readonly title: string; readonly url?: string; readonly summary?: string }[];
    }
  | {
      readonly kind: "browser_snapshot";
      readonly title?: string;
      readonly url?: string;
      readonly summary?: string;
    }
  | {
      readonly kind: "file_change_summary" | "file_diff_preview";
      readonly path?: string;
      readonly summary?: string;
      readonly preview?: string;
    }
  | {
      readonly kind: "command_summary";
      readonly command?: string;
      readonly exitCode?: number;
      readonly stdoutSummary?: string;
      readonly stderrSummary?: string;
    }
  | {
      readonly kind: "generic_tool_summary";
      readonly summary?: string;
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
      };
      readonly contextPack?: {
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
  readonly description?: string;
  readonly category?: string;
  readonly riskLevel?: string;
  readonly operationType?: string;
  readonly enabled: boolean;
  readonly available?: boolean;
  readonly unavailableReason?: string;
  readonly requiresConfirmation?: boolean;
};

export type ConfigResponse = {
  readonly config?: {
    readonly profileId?: string;
    readonly label?: string;
    readonly baseUrl?: string;
    readonly model?: string;
    readonly defaultAiMode?: "none" | "fake" | "openai-compatible";
    readonly secretConfigured?: boolean;
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
