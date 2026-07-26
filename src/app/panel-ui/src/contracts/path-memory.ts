export type PathMemoryTerminalStatus = "completed" | "failed" | "cancelled" | "blocked";

export type PathMemoryToolStep = {
  readonly ordinal: number;
  readonly toolFactId: string;
  readonly parentToolFactId?: string;
  readonly toolName: string;
  readonly status: "completed" | "failed" | "cancelled";
  readonly durationMs: number;
  readonly resultRef: string;
  readonly error?: {
    readonly domain?: string;
    readonly code?: string;
    readonly message: string;
  };
};

export type PathMemoryVerification =
  | {
      readonly status: "verified" | "failed";
      readonly evidenceRefs: readonly string[];
    }
  | {
      readonly status: "not_recorded";
      readonly evidenceRefs: readonly [];
    };

export type PathMemoryOutcome =
  | {
      readonly terminalStatus: "completed";
      readonly answerRef: string;
    }
  | {
      readonly terminalStatus: "failed";
      readonly error: { readonly code: string; readonly message: string };
    }
  | {
      readonly terminalStatus: "cancelled";
      readonly reason: string;
    }
  | {
      readonly terminalStatus: "blocked";
      readonly reason: { readonly code: string; readonly message: string };
      readonly continueBy: "new_turn";
    };

export type PathMemorySource = {
  readonly feature: "ordinary";
  readonly runId: string;
  readonly sourceRevision: number;
  readonly conversationId: string;
  readonly userTurnId: string;
  readonly assistantTurnId: string;
  readonly predecessorRunId?: string;
  readonly runCreatedAt: string;
  readonly terminalAt: string;
};

export type PathMemoryRecord = {
  readonly id: string;
  readonly source: PathMemorySource;
  readonly scope: {
    readonly workspaceRoot: string;
    readonly workspaceSelection: "default" | "explicit";
  };
  readonly goal: {
    readonly userRequest: string;
    readonly taskContextRefs: readonly string[];
  };
  readonly path: {
    readonly executionStarted: boolean;
    readonly toolSteps: readonly PathMemoryToolStep[];
  };
  readonly outcome: PathMemoryOutcome;
  readonly verification: PathMemoryVerification;
  readonly evidenceRefs: readonly string[];
  readonly capturedAt: string;
};

export type PathMemoryListResponse = {
  readonly ok: true;
  readonly memories: readonly PathMemoryRecord[];
};

export type PathMemoryDetailResponse = {
  readonly ok: true;
  readonly memory: PathMemoryRecord;
};

export type PathMemoryDiagnostics = {
  readonly realtime: {
    readonly captured: number;
    readonly existing: number;
    readonly replaced: number;
    readonly skippedUnstable: number;
    readonly skippedDeleted: number;
    readonly failures: number;
  };
  readonly reconciliation: {
    readonly status: "running" | "completed" | "failed";
    readonly scannedTerminalRuns: number;
    readonly captured: number;
    readonly existing: number;
    readonly replaced: number;
    readonly skippedUnstable: number;
    readonly skippedDeleted: number;
    readonly failures: number;
    readonly durationMs?: number;
  };
  readonly lastFailure?: {
    readonly source: string;
    readonly runId?: string;
    readonly message: string;
    readonly occurredAt: string;
  };
  readonly records: {
    readonly total: number;
  };
};

export type PathMemoryDiagnosticsResponse = {
  readonly ok: true;
  readonly diagnostics: PathMemoryDiagnostics;
};
