import type { RunObservationSnapshot } from "../domain/observation/index.js";
import type { EventLogEntry } from "../kernel/events/in-memory-event-log.js";
import type { SafeAgentRunTreeView } from "./panel-agent-run-tree-view.js";
import type { PanelTranscriptModelCall } from "./panel-transcript-model-calls.js";
import type { UndergroundDemoSummary } from "./underground-demo-summary.js";

export type AgentWorkNote = {
  readonly noteId: string;
  readonly agentId: string;
  readonly agentLabel: string;
  readonly stage: string;
  readonly status: "pending" | "running" | "completed" | "failed" | "skipped";
  readonly summary: string;
  readonly detail: string;
  readonly evidenceRefs: readonly string[];
  readonly eventRefs: readonly string[];
  readonly candidateRefs: readonly string[];
  readonly modelCallRefs: readonly string[];
  readonly reasoningTrace?: {
    readonly decisionSummary?: string;
    readonly uncertainty?: string;
    readonly confidence?: number;
    readonly source: "ai" | "deterministic_fallback";
  };
  readonly createdAt: string;
};

export type PanelWorkNotesInput = {
  readonly runId: string;
  readonly status: "pending" | "running" | "approval_needed" | "needs_input" | "completed" | "failed" | "cancelled" | "blocked";
  readonly eventEntries: readonly EventLogEntry[];
  readonly summary?: UndergroundDemoSummary;
  readonly observation?: Pick<RunObservationSnapshot, "underground">;
  readonly agentRunTree?: SafeAgentRunTreeView;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly modelCalls: readonly PanelTranscriptModelCall[];
  readonly desktopChatOnly: boolean;
};
