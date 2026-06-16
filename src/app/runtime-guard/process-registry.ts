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

export type ProcessCleanupAttempt = {
  readonly processId: string;
  readonly pid?: number;
  readonly beforeStatus: ProcessStatus;
  readonly afterStatus: ProcessStatus;
  readonly killTree: ProcessKillTreeResult;
};

export type ProcessCleanupResult = {
  readonly runId: string;
  readonly attempted: readonly ProcessCleanupAttempt[];
  readonly skipped: readonly ProcessCleanupSkip[];
  readonly summary: ProcessRunResidueSummary;
};

export type ProcessCleanupOptions = {
  readonly includeUnowned?: boolean;
  readonly statuses?: readonly ProcessStatus[];
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
    const includeUnowned = options.includeUnowned ?? false;
    const cleanupStatuses = options.statuses ?? UNRESOLVED_PROCESS_STATUSES;
    const attempted: ProcessCleanupAttempt[] = [];
    const skipped: ProcessCleanupSkip[] = [];

    for (const record of Array.from(this.records.values())) {
      if (record.runId !== runId) {
        continue;
      }

      if (!includeUnowned && !record.owned) {
        skipped.push(cleanupSkip(record, "unowned"));
        continue;
      }

      if (!cleanupStatuses.includes(record.status)) {
        skipped.push(cleanupSkip(record, "inactive_status"));
        continue;
      }

      const before = this.records.get(record.processId);
      if (before === undefined) {
        continue;
      }

      this.records.set(record.processId, cloneRecord({ ...before, status: "killing" }));

      const killTree = await this.killTree(record, terminator);
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
        killTree: cloneKillTreeResult(killTree),
      });
    }

    return {
      runId,
      attempted,
      skipped,
      summary: this.summarizeRun(runId),
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
  return { ...fact };
}

function cloneFacts(facts: readonly ProcessFact[]): readonly ProcessFact[] {
  return facts.map((fact) => ({ ...fact }));
}

function cloneKillTreeResult(result: ProcessKillTreeResult): ProcessKillTreeResult {
  return { ...result };
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
