import type {
  ProcessFact,
  ProcessKind,
  ProcessPortFact,
  ProcessRunProcessSummary,
  ProcessRunResidueSummary,
  ProcessStatus,
  ProcessStatusCounts,
} from "../../runtime-guard/index.js";

export type PanelRuntimeProcessStatus = ProcessStatus;
export type PanelRuntimeProcessKind = ProcessKind;

export type PanelRuntimeStatusCounts = ProcessStatusCounts;

export type PanelRuntimePortFact = ProcessPortFact;

export type PanelRuntimeProcessFact = ProcessFact;

export type PanelRuntimeProcessSummary = {
  readonly processId: string;
  readonly runId?: string;
  readonly toolCallId?: string;
  readonly pid?: number;
  readonly kind: PanelRuntimeProcessKind;
  readonly owned: boolean;
  readonly commandLine: string;
  readonly cwd: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly status: PanelRuntimeProcessStatus;
  readonly exitCode?: number;
  readonly signal?: string;
  readonly logRef?: string;
  readonly logPath?: string;
  readonly stopCommand?: string;
  readonly ports: readonly PanelRuntimePortFact[];
  readonly factCount: number;
  readonly latestFact?: PanelRuntimeProcessFact;
};

export type PanelRuntimeSummaryReadModel = {
  readonly kind: "panel_runtime_visibility_summary";
  readonly runId: string;
  readonly observedAt: string;
  readonly totalCount: number;
  readonly ownedCount: number;
  readonly unownedCount: number;
  readonly residualCount: number;
  readonly statuses: PanelRuntimeStatusCounts;
  readonly processes: readonly PanelRuntimeProcessSummary[];
  readonly residualProcesses: readonly PanelRuntimeProcessSummary[];
};

export type PanelRuntimeSummaryRegistry = {
  readonly summarizeRun: (runId: string) => ProcessRunResidueSummary;
};

export function summarizePanelRuntimeVisibility(input: {
  readonly runId: string;
  readonly processRegistry?: PanelRuntimeSummaryRegistry;
}): PanelRuntimeSummaryReadModel | undefined {
  const summary = input.processRegistry?.summarizeRun(input.runId);
  if (summary === undefined || summary.totalCount === 0) {
    return undefined;
  }
  return panelRuntimeSummaryFromProcessRunSummary(summary);
}

export function panelRuntimeSummaryFromProcessRunSummary(
  summary: ProcessRunResidueSummary
): PanelRuntimeSummaryReadModel {
  return {
    kind: "panel_runtime_visibility_summary",
    runId: summary.runId,
    observedAt: summary.observedAt,
    totalCount: summary.totalCount,
    ownedCount: summary.ownedCount,
    unownedCount: summary.unownedCount,
    residualCount: summary.residualCount,
    statuses: { ...summary.statuses },
    processes: summary.processes.map(panelRuntimeProcessSummary),
    residualProcesses: summary.residualProcesses.map(panelRuntimeProcessSummary),
  };
}

function panelRuntimeProcessSummary(process: ProcessRunProcessSummary): PanelRuntimeProcessSummary {
  return {
    processId: process.processId,
    runId: process.runId,
    toolCallId: process.toolCallId,
    pid: process.pid,
    kind: process.kind,
    owned: process.owned,
    commandLine: process.commandLine,
    cwd: process.cwd,
    startedAt: process.startedAt,
    endedAt: process.endedAt,
    status: process.status,
    exitCode: process.exitCode,
    signal: process.signal,
    logRef: process.logRef,
    logPath: process.logPath,
    stopCommand: process.stopCommand,
    ports: process.ports.map((port) => ({ ...port })),
    factCount: process.factCount,
    latestFact: process.latestFact === undefined ? undefined : { ...process.latestFact },
  };
}
