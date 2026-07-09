import type { ModelRunReasoningEffort, RunAgentDefinitionRef } from "../../../domain/config/index.js";
import type { ToolDisplayProjection } from "../../../domain/tools/index.js";
import type { TranscriptNode } from "../../../domain/basic-agent/index.js";
import type { EventLogEntry } from "../../../kernel/events/in-memory-event-log.js";
import type { AgentRunTreeAttachment } from "../../agent-run-tree-attachment.js";
import type { PanelTranscriptModelCall } from "../transcript/panel-transcript-model-calls.js";
import type { PanelRunStreamEvent } from "./panel-run-stream-contracts.js";
import type { PanelRunStatus } from "./panel-run-status.js";
import type { PanelObservationReadModel } from "./panel-run-tracking-contracts.js";
import type { PanelRunSummary } from "../../panel-run-summary.js";
import type { AgentWorkNote } from "./panel-work-note-contracts.js";

export type PanelRunStepToolItem = {
  readonly toolName?: string;
  readonly title: string;
  readonly target?: string;
  readonly preview?: string;
  readonly display?: ToolDisplayProjection;
  readonly exitCode?: number;
  readonly truncated?: boolean;
  readonly error?: string;
  readonly status: "running" | "completed" | "failed";
};

export type PanelRunStep = {
  readonly stepId: string;
  readonly stepNumber: number;
  readonly toolCalls: readonly PanelRunStepToolItem[];
  readonly status: "running" | "completed" | "failed";
};

export type PanelTranscriptNode = TranscriptNode;

export type PanelRunStreamCursor = {
  readonly runId: string;
  readonly lastSequence: number;
};

export type PanelRunTranscript = {
  readonly runId: string;
  readonly status: PanelRunStatus;
  readonly updatedAt: string;
  readonly events: readonly PanelRunStreamEvent[];
  readonly transcriptNodes: readonly PanelTranscriptNode[];
  readonly steps: readonly PanelRunStep[];
  readonly workNotes: readonly AgentWorkNote[];
  readonly modelCalls: readonly PanelTranscriptModelCall[];
};

export type CreatePanelRunTranscriptInput = {
  readonly runId: string;
  readonly status: PanelRunStatus;
  readonly eventEntries: readonly EventLogEntry[];
  readonly streamEvents?: readonly PanelRunStreamEvent[];
  readonly summary?: PanelRunSummary;
  readonly observation?: PanelObservationReadModel;
  readonly agentRunTree?: AgentRunTreeAttachment;
  readonly desktopMode?: "agent" | "deep";
  readonly reasoningEffort?: ModelRunReasoningEffort;
  readonly agentDefinitionRef?: Pick<RunAgentDefinitionRef, "agentId" | "agentDisplayName">;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly error?: { readonly code: string; readonly message: string };
};
