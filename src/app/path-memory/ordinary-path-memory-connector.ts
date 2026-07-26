import type {
  OrdinaryRunSummary,
  OrdinaryStableTerminalRunFacts,
} from "../ordinary-agent/contracts.js";
import type {
  PathMemoryCaptureInput,
  PathMemoryFeature,
  PathMemoryOutcome,
} from "./contracts.js";

export type OrdinaryPathMemoryConnector = {
  /** Resolves when startup reconciliation has drained. Ordinary routes never depend on it. */
  ready(): Promise<void>;
  /** Immutable in-process snapshot of capture health; never a second fact source. */
  diagnostics(): OrdinaryPathMemoryConnectorDiagnostics;
  release(): Promise<void>;
};

export type OrdinaryPathMemoryConnectorDiagnostics = {
  readonly realtime: {
    readonly captured: number;
    readonly existing: number;
    /** Source restated the run at a higher revision; the older record was superseded. */
    readonly replaced: number;
    readonly skippedUnstable: number;
    /** The user explicitly deleted this memory; a tombstone keeps it forgotten. */
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
    readonly source: "realtime" | "reconciliation";
    readonly runId?: string;
    readonly message: string;
    readonly occurredAt: string;
  };
};

/** Exact public port the connector needs; it never touches wider Ordinary state. */
export type OrdinaryStableTerminalSourcePort = {
  readonly queries: {
    listRuns(limit?: number): Promise<readonly OrdinaryRunSummary[]>;
    getStableTerminalRunFacts(runId: string): Promise<OrdinaryStableTerminalRunFacts | undefined>;
  };
  readonly events: {
    subscribeStableTerminalRuns(listener: (runId: string) => void): () => void;
  };
};

export type CreateOrdinaryPathMemoryConnectorInput = {
  readonly ordinary: OrdinaryStableTerminalSourcePort;
  readonly pathMemory: Pick<PathMemoryFeature, "commands">;
  /** Capture failures are diagnostics; they never rewrite Ordinary terminal state. */
  readonly onDiagnostic?: (diagnostic: {
    readonly source: "realtime" | "reconciliation";
    readonly runId?: string;
    readonly error: unknown;
  }) => void;
  /** Injectable clock for deterministic diagnostics timestamps in tests. */
  readonly now?: () => Date;
};

/**
 * Wiring adapter between Ordinary stable terminal facts and PathMemory capture.
 * It owns no state, interprets no task semantics and forms no second fact source.
 */
export function createOrdinaryPathMemoryConnector(
  input: CreateOrdinaryPathMemoryConnectorInput,
): OrdinaryPathMemoryConnector {
  const { ordinary, pathMemory } = input;
  const onDiagnostic = input.onDiagnostic ?? (() => undefined);
  const now = input.now ?? (() => new Date());
  const inFlight = new Set<Promise<void>>();
  let released = false;

  type CaptureCounters = {
    captured: number;
    existing: number;
    replaced: number;
    skippedUnstable: number;
    skippedDeleted: number;
    failures: number;
  };
  const realtimeCounters: CaptureCounters = { captured: 0, existing: 0, replaced: 0, skippedUnstable: 0, skippedDeleted: 0, failures: 0 };
  const reconciliationCounters: CaptureCounters = { captured: 0, existing: 0, replaced: 0, skippedUnstable: 0, skippedDeleted: 0, failures: 0 };
  let reconciliationStatus: "running" | "completed" | "failed" = "running";
  let reconciliationScanned = 0;
  let reconciliationDurationMs: number | undefined;
  let lastFailure:
    | {
        readonly source: "realtime" | "reconciliation";
        readonly runId?: string;
        readonly message: string;
        readonly occurredAt: string;
      }
    | undefined;

  function recordFailure(source: "realtime" | "reconciliation", error: unknown, runId?: string): void {
    const counters = source === "realtime" ? realtimeCounters : reconciliationCounters;
    counters.failures += 1;
    lastFailure = {
      source,
      ...(runId === undefined ? {} : { runId }),
      message: error instanceof Error ? error.message : String(error),
      occurredAt: now().toISOString(),
    };
  }

  function trackCapture(source: "realtime" | "reconciliation", runId: string): void {
    const counters = source === "realtime" ? realtimeCounters : reconciliationCounters;
    const operation = (async () => {
      const facts = await ordinary.queries.getStableTerminalRunFacts(runId);
      if (facts === undefined) {
        counters.skippedUnstable += 1;
        return;
      }
      const result = await pathMemory.commands.capture(captureInputFromFacts(facts));
      if (result.status === "created") {
        counters.captured += 1;
      } else if (result.status === "replaced") {
        counters.replaced += 1;
      } else if (result.status === "suppressed") {
        counters.skippedDeleted += 1;
      } else {
        counters.existing += 1;
      }
    })().catch((error: unknown) => {
      recordFailure(source, error, runId);
      onDiagnostic({ source, runId, error });
    });
    inFlight.add(operation);
    void operation.finally(() => {
      inFlight.delete(operation);
    });
  }

  // Subscribe before scanning so the initialization window cannot lose runs;
  // duplicate hits converge through the idempotent source key.
  const unsubscribe = ordinary.events.subscribeStableTerminalRuns((runId) => {
    if (released) return;
    trackCapture("realtime", runId);
  });

  const reconciliationStartedAt = now().getTime();
  const reconciliation = (async () => {
    const summaries = await ordinary.queries.listRuns(Number.MAX_SAFE_INTEGER);
    for (const summary of summaries) {
      if (released) return;
      if (summary.status !== "completed" && summary.status !== "failed" &&
          summary.status !== "cancelled" && summary.status !== "blocked") {
        continue;
      }
      reconciliationScanned += 1;
      trackCapture("reconciliation", summary.runId);
      // Sequential draining keeps startup IO bounded on large local histories.
      await Promise.allSettled([...inFlight]);
    }
  })().then(() => {
    reconciliationStatus = "completed";
    reconciliationDurationMs = now().getTime() - reconciliationStartedAt;
  }, (error: unknown) => {
    reconciliationStatus = "failed";
    reconciliationDurationMs = now().getTime() - reconciliationStartedAt;
    recordFailure("reconciliation", error);
    onDiagnostic({ source: "reconciliation", error });
  });

  async function drain(): Promise<void> {
    await reconciliation;
    while (inFlight.size > 0) {
      await Promise.allSettled([...inFlight]);
    }
  }

  return {
    async ready() {
      await drain();
    },
    diagnostics(): OrdinaryPathMemoryConnectorDiagnostics {
      // Fresh objects on every call keep internal counters unreachable from callers.
      return {
        realtime: { ...realtimeCounters },
        reconciliation: {
          status: reconciliationStatus,
          scannedTerminalRuns: reconciliationScanned,
          ...reconciliationCounters,
          ...(reconciliationDurationMs === undefined ? {} : { durationMs: reconciliationDurationMs }),
        },
        ...(lastFailure === undefined ? {} : { lastFailure: { ...lastFailure } }),
      };
    },
    async release() {
      released = true;
      unsubscribe();
      await drain();
    },
  };
}

function captureInputFromFacts(facts: OrdinaryStableTerminalRunFacts): PathMemoryCaptureInput {
  return {
    source: {
      feature: "ordinary",
      runId: facts.runId,
      sourceRevision: facts.sourceRevision,
      conversationId: facts.turn.conversationId,
      userTurnId: facts.turn.userTurnId,
      assistantTurnId: facts.turn.assistantTurnId,
      ...(facts.turn.predecessorRunId === undefined ? {} : { predecessorRunId: facts.turn.predecessorRunId }),
      runCreatedAt: facts.createdAt,
      terminalAt: facts.terminalAt,
    },
    scope: {
      workspaceRoot: facts.workspaceRoot,
      workspaceSelection: facts.workspaceSelection,
    },
    goal: {
      userRequest: facts.userMessage,
      taskContextRefs: facts.taskContextRefs,
    },
    path: {
      executionStarted: facts.executionStarted,
      toolSteps: facts.toolFacts.map((fact, index) => ({
        ordinal: index + 1,
        toolFactId: fact.toolFactId,
        ...(fact.parentToolFactId === undefined ? {} : { parentToolFactId: fact.parentToolFactId }),
        toolName: fact.toolName,
        status: fact.status,
        durationMs: fact.durationMs,
        resultRef: `ordinary-run:${facts.runId}#tool:${fact.toolFactId}`,
        ...(fact.error === undefined ? {} : { error: fact.error }),
      })),
    },
    outcome: outcomeFromStatus(facts),
    // Ordinary has no formal Verification owner; completion never implies verified.
    verification: { status: "not_recorded", evidenceRefs: [] },
    evidenceRefs: [`ordinary-run:${facts.runId}`],
  };
}

function outcomeFromStatus(facts: OrdinaryStableTerminalRunFacts): PathMemoryOutcome {
  const status = facts.status;
  switch (status.kind) {
    case "completed":
      return { terminalStatus: "completed", answerRef: `ordinary-run:${facts.runId}#answer` };
    case "failed":
      return { terminalStatus: "failed", error: status.error };
    case "cancelled":
      return { terminalStatus: "cancelled", reason: status.reason };
    case "blocked":
      return { terminalStatus: "blocked", reason: status.reason, continueBy: status.continueBy };
  }
}
