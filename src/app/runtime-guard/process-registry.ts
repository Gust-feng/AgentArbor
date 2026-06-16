import type {
  ExternalPortOccupantFact,
  LocalPortErrorFact,
  LocalPortHost,
  LocalPortProbeFact,
  LocalPortProbeStatus,
  LocalPortWaitFact,
} from "./port-probe.js";

export type ProcessStatus = "starting" | "running" | "exited" | "killing" | "killed" | "unknown";

export type ProcessKind = "background" | "foreground";

export type ProcessPortFact = {
  readonly port: number;
  readonly host: LocalPortHost;
  readonly requestedAt: string;
  readonly status?: LocalPortProbeStatus;
  readonly ready?: boolean;
  readonly checkedAt?: string;
  readonly durationMs?: number;
  readonly timeoutMs?: number;
  readonly timedOut?: true;
  readonly cancelled?: true;
  readonly error?: LocalPortErrorFact;
  readonly externalOccupant?: ExternalPortOccupantFact;
};

export type ProcessKillTreeStatus = "killed" | "exited" | "unknown" | "failed";

export type ProcessKillTreeResult = {
  readonly status: ProcessKillTreeStatus;
  readonly exitCode?: number;
  readonly signal?: string;
  readonly message?: string;
  readonly errorMessage?: string;
};

export type ProcessKillTreeFact = {
  readonly kind: "kill_tree";
  readonly observedAt: string;
  readonly pid?: number;
  readonly beforeStatus: ProcessStatus;
  readonly resultStatus: ProcessKillTreeStatus;
  readonly exitCode?: number;
  readonly signal?: string;
  readonly message?: string;
  readonly errorMessage?: string;
};

export type ProcessFact = ProcessKillTreeFact;

export type ProcessRecord = {
  readonly processId: string;
  readonly runId?: string;
  readonly toolCallId?: string;
  readonly pid?: number;
  readonly kind: ProcessKind;
  readonly owned: boolean;
  readonly commandLine: string;
  readonly cwd: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly status: ProcessStatus;
  readonly exitCode?: number;
  readonly signal?: string;
  readonly logRef?: string;
  readonly logPath?: string;
  readonly stopCommand?: string;
  readonly ports: readonly ProcessPortFact[];
  readonly facts: readonly ProcessFact[];
};

export type ProcessRegistration = Omit<ProcessRecord, "ports" | "facts"> & {
  readonly ports?: readonly ProcessPortFact[];
  readonly facts?: readonly ProcessFact[];
};

export type ProcessRecordUpdate = Partial<Omit<ProcessRecord, "processId">>;

export type MarkProcessExitedInput = {
  readonly exitCode?: number;
  readonly signal?: string;
  readonly exitedAt?: string;
};

export type ProcessCleanupSkipReason = "unowned" | "inactive_status";

export type ProcessCleanupSkip = {
  readonly processId: string;
  readonly pid?: number;
  readonly status: ProcessStatus;
  readonly reason: ProcessCleanupSkipReason;
};

export type ProcessCleanupAttemptOutcome = "killed" | "already-exited" | "unknown" | "error";

export type ProcessCleanupAttempt = {
  readonly processId: string;
  readonly pid?: number;
  readonly beforeStatus: ProcessStatus;
  readonly afterStatus: ProcessStatus;
  readonly outcome: ProcessCleanupAttemptOutcome;
  readonly killTree: ProcessKillTreeResult;
};

export type ProcessCleanupReason = "cancel" | "shutdown";

export type ProcessCleanupScope = "run" | "registry";

export type ProcessCleanupFact = {
  readonly kind: "process_cleanup";
  readonly observedAt: string;
  readonly scope: ProcessCleanupScope;
  readonly reason: ProcessCleanupReason;
  readonly runId?: string;
  readonly attempted: readonly ProcessCleanupAttempt[];
  readonly skipped: readonly ProcessCleanupSkip[];
};

export type ProcessCleanupResult = {
  readonly runId: string;
  readonly attempted: readonly ProcessCleanupAttempt[];
  readonly skipped: readonly ProcessCleanupSkip[];
  readonly summary: ProcessRunResidueSummary;
  readonly fact: ProcessCleanupFact;
};

export type ProcessCleanupOptions = {
  readonly includeUnowned?: boolean;
  readonly statuses?: readonly ProcessStatus[];
  readonly reason?: ProcessCleanupReason;
};

export type ProcessRegistryCleanupResult = {
  readonly kind: "process_registry_cleanup";
  readonly reason: ProcessCleanupReason;
  readonly observedAt: string;
  readonly attempted: readonly ProcessCleanupAttempt[];
  readonly skipped: readonly ProcessCleanupSkip[];
  readonly fact: ProcessCleanupFact;
};

export type ProcessStatusCounts = Readonly<Record<ProcessStatus, number>>;

export type ProcessRunProcessSummary = {
  readonly processId: string;
  readonly runId?: string;
  readonly toolCallId?: string;
  readonly pid?: number;
  readonly kind: ProcessKind;
  readonly owned: boolean;
  readonly commandLine: string;
  readonly cwd: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly status: ProcessStatus;
  readonly exitCode?: number;
  readonly signal?: string;
  readonly logRef?: string;
  readonly logPath?: string;
  readonly stopCommand?: string;
  readonly ports: readonly ProcessPortFact[];
  readonly factCount: number;
  readonly latestFact?: ProcessFact;
};

export type ProcessRunResidueSummary = {
  readonly kind: "process_run_residue_summary";
  readonly runId: string;
  readonly observedAt: string;
  readonly totalCount: number;
  readonly ownedCount: number;
  readonly unownedCount: number;
  readonly residualCount: number;
  readonly statuses: ProcessStatusCounts;
  readonly processes: readonly ProcessRunProcessSummary[];
  readonly residualProcesses: readonly ProcessRunProcessSummary[];
};

export type ProcessRegistryClock = () => string;

export type ProcessTerminator = {
  readonly killTree: (pid: number, record: ProcessRecord) => Promise<ProcessKillTreeResult> | ProcessKillTreeResult;
};

const ACTIVE_PROCESS_STATUSES: readonly ProcessStatus[] = ["starting", "running", "killing"];
const UNRESOLVED_PROCESS_STATUSES: readonly ProcessStatus[] = ["starting", "running", "killing", "unknown"];
const PROCESS_STATUSES: readonly ProcessStatus[] = ["starting", "running", "exited", "killing", "killed", "unknown"];

export class InMemoryProcessRegistry {
  private readonly records = new Map<string, ProcessRecord>();
  private readonly cleanupFacts: ProcessCleanupFact[] = [];
  private readonly residueSummaries: ProcessRunResidueSummary[] = [];
  private readonly now: ProcessRegistryClock;

  constructor(options: { readonly now?: ProcessRegistryClock } = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  register(input: ProcessRegistration): ProcessRecord {
    if (this.records.has(input.processId)) {
      throw new Error(`Process already registered: ${input.processId}`);
    }

    const record: ProcessRecord = {
      ...input,
      ports: clonePortFacts(input.ports ?? []),
      facts: cloneFacts(input.facts ?? []),
    };

    this.records.set(record.processId, cloneRecord(record));
    return cloneRecord(record);
  }

  get(processId: string): ProcessRecord | undefined {
    const record = this.records.get(processId);
    return record === undefined ? undefined : cloneRecord(record);
  }

  listAll(): readonly ProcessRecord[] {
    return Array.from(this.records.values(), cloneRecord);
  }

  listCleanupFacts(): readonly ProcessCleanupFact[] {
    return this.cleanupFacts.map(cloneCleanupFact);
  }

  listRunResidueSummaries(runId?: string): readonly ProcessRunResidueSummary[] {
    const summaries = runId === undefined
      ? this.residueSummaries
      : this.residueSummaries.filter((summary) => summary.runId === runId);
    return summaries.map(cloneRunResidueSummary);
  }

  listByRun(runId: string): readonly ProcessRecord[] {
    return this.listAll().filter((record) => record.runId === runId);
  }

  listActiveByRun(runId: string): readonly ProcessRecord[] {
    return this.listByRun(runId).filter((record) => isActiveStatus(record.status));
  }

  listUnresolvedByRun(runId: string): readonly ProcessRecord[] {
    return this.listByRun(runId).filter((record) => isUnresolvedStatus(record.status));
  }

  summarizeRun(runId: string): ProcessRunResidueSummary {
    return processRunResidueSummary(runId, this.listByRun(runId), this.now());
  }

  recordRunResidueSummary(runId: string): ProcessRunResidueSummary {
    const summary = this.summarizeRun(runId);
    this.residueSummaries.push(cloneRunResidueSummary(summary));
    return cloneRunResidueSummary(summary);
  }

  update(processId: string, patch: ProcessRecordUpdate): ProcessRecord | undefined {
    const current = this.records.get(processId);
    if (current === undefined) {
      return undefined;
    }

    const next: ProcessRecord = {
      ...current,
      ...patch,
      processId: current.processId,
      ports: patch.ports === undefined ? current.ports : clonePortFacts(patch.ports),
      facts: patch.facts === undefined ? current.facts : cloneFacts(patch.facts),
    };

    this.records.set(processId, cloneRecord(next));
    return cloneRecord(next);
  }

  markExited(processId: string, input: MarkProcessExitedInput = {}): ProcessRecord | undefined {
    return this.update(processId, {
      status: "exited",
      endedAt: input.exitedAt ?? this.now(),
      exitCode: input.exitCode,
      signal: input.signal,
    });
  }

  appendPortFact(processId: string, fact: ProcessPortFact): ProcessRecord | undefined {
    const current = this.records.get(processId);
    if (current === undefined) {
      return undefined;
    }

    const next: ProcessRecord = {
      ...current,
      ports: [...current.ports, clonePortFact(fact)],
    };

    this.records.set(processId, cloneRecord(next));
    return cloneRecord(next);
  }

  async cleanupByRun(
    runId: string,
    terminator: ProcessTerminator,
    options: ProcessCleanupOptions = {}
  ): Promise<ProcessCleanupResult> {
    const cleanup = await this.cleanupMatchingRecords({
      scope: "run",
      runId,
      reason: options.reason ?? "cancel",
      records: Array.from(this.records.values()).filter((record) => record.runId === runId),
      terminator,
      includeUnowned: options.includeUnowned ?? false,
      statuses: options.statuses ?? UNRESOLVED_PROCESS_STATUSES,
    });

    return {
      runId,
      attempted: cleanup.attempted,
      skipped: cleanup.skipped,
      summary: this.summarizeRun(runId),
      fact: cleanup.fact,
    };
  }

  async cleanupOwnedBackgroundProcesses(
    terminator: ProcessTerminator,
    options: Omit<ProcessCleanupOptions, "includeUnowned"> = {}
  ): Promise<ProcessRegistryCleanupResult> {
    const cleanup = await this.cleanupMatchingRecords({
      scope: "registry",
      reason: options.reason ?? "shutdown",
      records: Array.from(this.records.values()).filter((record) => record.kind === "background"),
      terminator,
      includeUnowned: false,
      statuses: options.statuses ?? UNRESOLVED_PROCESS_STATUSES,
    });
    return {
      kind: "process_registry_cleanup",
      reason: cleanup.fact.reason,
      observedAt: cleanup.fact.observedAt,
      attempted: cleanup.attempted,
      skipped: cleanup.skipped,
      fact: cleanup.fact,
    };
  }

  private async cleanupMatchingRecords(input: {
    readonly scope: ProcessCleanupScope;
    readonly runId?: string;
    readonly reason: ProcessCleanupReason;
    readonly records: readonly ProcessRecord[];
    readonly terminator: ProcessTerminator;
    readonly includeUnowned: boolean;
    readonly statuses: readonly ProcessStatus[];
  }): Promise<{
    readonly attempted: readonly ProcessCleanupAttempt[];
    readonly skipped: readonly ProcessCleanupSkip[];
    readonly fact: ProcessCleanupFact;
  }> {
    const attempted: ProcessCleanupAttempt[] = [];
    const skipped: ProcessCleanupSkip[] = [];

    for (const record of input.records) {
      if (!input.includeUnowned && !record.owned) {
        skipped.push(cleanupSkip(record, "unowned"));
        continue;
      }

      if (!input.statuses.includes(record.status)) {
        skipped.push(cleanupSkip(record, "inactive_status"));
        continue;
      }

      const before = this.records.get(record.processId);
      if (before === undefined) {
        continue;
      }

      this.records.set(record.processId, cloneRecord({ ...before, status: "killing" }));

      const killTree = await this.killTree(record, input.terminator);
      const observedAt = this.now();
      const latest = this.records.get(record.processId) ?? before;
      const nextStatus = latest.status === "exited" ? "exited" : processStatusFromKillTree(killTree);
      const fact: ProcessKillTreeFact = {
        kind: "kill_tree",
        observedAt,
        pid: before.pid,
        beforeStatus: before.status,
        resultStatus: killTree.status,
        exitCode: killTree.exitCode,
        signal: killTree.signal,
        message: killTree.message,
        errorMessage: killTree.errorMessage,
      };
      const next: ProcessRecord = {
        ...latest,
        status: nextStatus,
        endedAt: isTerminalStatus(nextStatus) ? latest.endedAt ?? observedAt : latest.endedAt,
        exitCode: killTree.exitCode ?? latest.exitCode,
        signal: killTree.signal ?? latest.signal,
        facts: [...latest.facts, fact],
      };

      this.records.set(record.processId, cloneRecord(next));
      attempted.push({
        processId: record.processId,
        pid: before.pid,
        beforeStatus: before.status,
        afterStatus: next.status,
        outcome: cleanupOutcomeFromKillTree(killTree),
        killTree: cloneKillTreeResult(killTree),
      });
    }

    const cleanupBase: ProcessCleanupFact = {
      kind: "process_cleanup",
      observedAt: this.now(),
      scope: input.scope,
      reason: input.reason,
      attempted: attempted.map(cloneCleanupAttempt),
      skipped: skipped.map(cloneCleanupSkip),
    };
    const cleanupFact = withDefinedOptionals(cleanupBase, {
      runId: input.runId,
    });
    this.cleanupFacts.push(cloneCleanupFact(cleanupFact));
    return {
      attempted: attempted.map(cloneCleanupAttempt),
      skipped: skipped.map(cloneCleanupSkip),
      fact: cloneCleanupFact(cleanupFact),
    };
  }

  private async killTree(record: ProcessRecord, terminator: ProcessTerminator): Promise<ProcessKillTreeResult> {
    if (record.pid === undefined) {
      return {
        status: "unknown",
        message: "Cannot terminate process without a pid.",
      };
    }

    try {
      return await terminator.killTree(record.pid, cloneRecord(record));
    } catch (error) {
      return {
        status: "failed",
        errorMessage: errorMessage(error),
      };
    }
  }
}

export function processPortFactFromLocalPortFact(fact: LocalPortProbeFact | LocalPortWaitFact): ProcessPortFact {
  const portFact: ProcessPortFact = {
    port: fact.port,
    host: fact.host,
    requestedAt: fact.requestedAt,
    checkedAt: fact.checkedAt,
  };
  return withDefinedOptionals(portFact, {
    status: fact.status,
    ready: fact.ready,
    durationMs: fact.durationMs,
    timeoutMs: fact.timeoutMs,
    timedOut: fact.timedOut,
    cancelled: fact.cancelled,
    error: fact.error,
    externalOccupant: fact.externalOccupant,
  });
}

function withDefinedOptionals<T extends object>(base: T, optionals: Partial<T>): T {
  const output: Record<string, unknown> = {};
  Object.assign(output, base);
  for (const [key, value] of Object.entries(optionals)) {
    if (value !== undefined) {
      output[key] = value;
    }
  }
  return output as T;
}

function isActiveStatus(status: ProcessStatus): boolean {
  return ACTIVE_PROCESS_STATUSES.includes(status);
}

function isUnresolvedStatus(status: ProcessStatus): boolean {
  return UNRESOLVED_PROCESS_STATUSES.includes(status);
}

function isTerminalStatus(status: ProcessStatus): boolean {
  return status === "exited" || status === "killed";
}

function processStatusFromKillTree(result: ProcessKillTreeResult): ProcessStatus {
  if (result.status === "killed") {
    return "killed";
  }

  if (result.status === "exited") {
    return "exited";
  }

  return "unknown";
}

function cleanupOutcomeFromKillTree(result: ProcessKillTreeResult): ProcessCleanupAttemptOutcome {
  if (result.status === "killed") {
    return "killed";
  }
  if (result.status === "exited") {
    return "already-exited";
  }
  if (result.status === "failed") {
    return "error";
  }
  return "unknown";
}

function cleanupSkip(record: ProcessRecord, reason: ProcessCleanupSkipReason): ProcessCleanupSkip {
  return {
    processId: record.processId,
    pid: record.pid,
    status: record.status,
    reason,
  };
}

function cloneRecord(record: ProcessRecord): ProcessRecord {
  return {
    ...record,
    ports: clonePortFacts(record.ports),
    facts: cloneFacts(record.facts),
  };
}

function clonePortFacts(facts: readonly ProcessPortFact[]): readonly ProcessPortFact[] {
  return facts.map(clonePortFact);
}

function clonePortFact(fact: ProcessPortFact): ProcessPortFact {
  return {
    ...fact,
    ...(fact.error === undefined ? {} : { error: { ...fact.error } }),
    ...(fact.externalOccupant === undefined ? {} : { externalOccupant: { ...fact.externalOccupant } }),
  };
}

function cloneFacts(facts: readonly ProcessFact[]): readonly ProcessFact[] {
  return facts.map((fact) => ({ ...fact }));
}

function cloneCleanupAttempt(attempt: ProcessCleanupAttempt): ProcessCleanupAttempt {
  return {
    ...attempt,
    killTree: cloneKillTreeResult(attempt.killTree),
  };
}

function cloneCleanupSkip(skip: ProcessCleanupSkip): ProcessCleanupSkip {
  return { ...skip };
}

function cloneCleanupFact(fact: ProcessCleanupFact): ProcessCleanupFact {
  const clone: ProcessCleanupFact = {
    kind: fact.kind,
    observedAt: fact.observedAt,
    scope: fact.scope,
    reason: fact.reason,
    attempted: fact.attempted.map(cloneCleanupAttempt),
    skipped: fact.skipped.map(cloneCleanupSkip),
  };
  return withDefinedOptionals(clone, {
    runId: fact.runId,
  });
}

function cloneKillTreeResult(result: ProcessKillTreeResult): ProcessKillTreeResult {
  return { ...result };
}

function cloneRunResidueSummary(summary: ProcessRunResidueSummary): ProcessRunResidueSummary {
  return {
    ...summary,
    statuses: { ...summary.statuses },
    processes: summary.processes.map(cloneRunProcessSummary),
    residualProcesses: summary.residualProcesses.map(cloneRunProcessSummary),
  };
}

function cloneRunProcessSummary(summary: ProcessRunProcessSummary): ProcessRunProcessSummary {
  const clone: ProcessRunProcessSummary = {
    processId: summary.processId,
    kind: summary.kind,
    owned: summary.owned,
    commandLine: summary.commandLine,
    cwd: summary.cwd,
    startedAt: summary.startedAt,
    status: summary.status,
    ports: clonePortFacts(summary.ports),
    factCount: summary.factCount,
  };
  return withDefinedOptionals(clone, {
    runId: summary.runId,
    toolCallId: summary.toolCallId,
    pid: summary.pid,
    endedAt: summary.endedAt,
    exitCode: summary.exitCode,
    signal: summary.signal,
    logRef: summary.logRef,
    logPath: summary.logPath,
    stopCommand: summary.stopCommand,
    latestFact: summary.latestFact === undefined ? undefined : { ...summary.latestFact },
  });
}

function processRunResidueSummary(
  runId: string,
  records: readonly ProcessRecord[],
  observedAt: string
): ProcessRunResidueSummary {
  const processes = records.map(processRunProcessSummary);
  return {
    kind: "process_run_residue_summary",
    runId,
    observedAt,
    totalCount: processes.length,
    ownedCount: processes.filter((process) => process.owned).length,
    unownedCount: processes.filter((process) => !process.owned).length,
    residualCount: processes.filter((process) => isUnresolvedStatus(process.status)).length,
    statuses: processStatusCounts(records),
    processes,
    residualProcesses: processes.filter((process) => isUnresolvedStatus(process.status)),
  };
}

function processRunProcessSummary(record: ProcessRecord): ProcessRunProcessSummary {
  const latestFact = record.facts.at(-1);
  const summary: ProcessRunProcessSummary = {
    processId: record.processId,
    runId: record.runId,
    toolCallId: record.toolCallId,
    pid: record.pid,
    kind: record.kind,
    owned: record.owned,
    commandLine: record.commandLine,
    cwd: record.cwd,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    status: record.status,
    exitCode: record.exitCode,
    signal: record.signal,
    logRef: record.logRef,
    logPath: record.logPath,
    stopCommand: record.stopCommand,
    ports: clonePortFacts(record.ports),
    factCount: record.facts.length,
    latestFact: latestFact === undefined ? undefined : { ...latestFact },
  };
  return withDefinedOptionals(summary, {
    runId: summary.runId,
    toolCallId: summary.toolCallId,
    pid: summary.pid,
    endedAt: summary.endedAt,
    exitCode: summary.exitCode,
    signal: summary.signal,
    logRef: summary.logRef,
    logPath: summary.logPath,
    stopCommand: summary.stopCommand,
    latestFact: summary.latestFact,
  });
}

function processStatusCounts(records: readonly ProcessRecord[]): ProcessStatusCounts {
  const counts: Record<ProcessStatus, number> = {
    starting: 0,
    running: 0,
    exited: 0,
    killing: 0,
    killed: 0,
    unknown: 0,
  };
  for (const record of records) {
    counts[record.status] += 1;
  }
  for (const status of PROCESS_STATUSES) {
    counts[status] = counts[status] ?? 0;
  }
  return counts;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
