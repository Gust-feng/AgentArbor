/**
 * Public contracts for one deep child Agent execution.
 *
 * This module deliberately contains no execution or result-mapping logic. It
 * lets the runner, scheduler, persistence adapters, and result mapper share
 * the same boundary without depending on the runner implementation.
 */
import type { BasicAgentCapabilitySnapshot } from "../../domain/config/index.js";
import type { ToolConfirmationPolicy } from "../../domain/tools/contracts.js";
import type {
  ChildAgentRun,
  ChildAgentRunModelMessageTrace,
  ChildAgentRunParentInstructionSource,
  ChildAgentRunParentInstructionStatus,
  ChildAgentRunParentReview,
} from "../../domain/underground/agent-fabric.js";
import type { AgentTurnPendingApproval, AgentTurnRuntime } from "../../kernel/intelligence/agent-turn-runtime.js";
import type { DeepChildSpec, DeepChildSummary } from "./contracts.js";
import type { DeepChildLoopContextStore } from "./deep-child-loop-contexts.js";

export const DEEP_CHILD_AGENT_PROMPT_TEMPLATE_ID = "deep.child.agent.standard.v1";
export const DEEP_CHILD_DEFAULT_MAX_MODEL_ROUNDS = 200;
export const DEEP_CHILD_DEFAULT_MAX_TOOL_ROUNDS = 200;

export type DeepChildAgentPrompt = {
  readonly templateId: typeof DEEP_CHILD_AGENT_PROMPT_TEMPLATE_ID;
  readonly objective: string;
  readonly role: string;
  readonly displayName: string;
  readonly inputRefs: readonly string[];
};

export type DeepChildAgentExecutionStats = {
  readonly modelRounds: number;
  readonly toolRounds: number;
  readonly modelRequestId?: string;
  readonly modelResponseId?: string;
  readonly modelMessages?: readonly ChildAgentRunModelMessageTrace[];
  readonly toolCalls: readonly {
    readonly callId: string;
    readonly toolName: string;
    readonly status: "completed" | "failed" | "approval_required" | "cancelled";
  }[];
};

export type DeepChildAgentRunInput = {
  readonly runId?: string;
  readonly childRun: ChildAgentRun;
  /** The parent-created semantic delegation used to build this child run. */
  readonly childSpec: DeepChildSpec;
  readonly goal: string;
  readonly permissionBoundaryRefs: readonly string[];
  readonly turnRuntime: AgentTurnRuntime;
  readonly traceId: string;
  readonly goalId: string;
  readonly confirmationPolicy?: ToolConfirmationPolicy;
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  readonly childLoopContextStore?: DeepChildLoopContextStore;
  readonly abortSignal?: AbortSignal;
};

export type DeepChildAgentContinuationInput = DeepChildAgentRunInput & {
  readonly parentInstruction: string;
  /** Current parent operation ref; used to keep the prompt history from repeating this instruction. */
  readonly currentParentInstructionRef?: string;
  /** Safe parent review for the current follow-up operation. */
  readonly currentParentReview?: ChildAgentRunParentReview;
  readonly previousSummary?: DeepChildSummary;
  /**
   * Internal parent-to-child message history resolved from DeepChildMessageStore.
   * It is model context for continuing the same child run, not a UI projection.
   */
  readonly parentMessageHistory?: readonly DeepChildParentMessageContext[];
};

export type DeepChildParentMessageContext = {
  readonly messageRef: string;
  readonly source: ChildAgentRunParentInstructionSource;
  readonly status: ChildAgentRunParentInstructionStatus;
  readonly content: string;
  readonly updatedAt: string;
};

export type DeepChildAgentRunResult = {
  readonly summary: DeepChildSummary;
  readonly completedRun: ChildAgentRun;
  readonly prompt: DeepChildAgentPrompt;
  readonly execution: DeepChildAgentExecutionStats;
  /** Runtime-only continuation for approval_required child runs. Never persist this object. */
  readonly pendingContinuation?: DeepChildAgentRuntimeContinuation;
};

export type DeepChildAgentRuntimeContinuation = {
  readonly childRunId: string;
  readonly confirmationId: string;
  readonly childRun: ChildAgentRun;
  readonly childSpec: DeepChildSpec;
  readonly pendingApproval: AgentTurnPendingApproval;
};

export type DeepChildConfirmationDecision = {
  readonly decision: "approve_once" | "deny" | "guidance";
  readonly guidance?: string;
};

export type DeepChildAgentResumeInput = {
  readonly runId?: string;
  readonly childRun: ChildAgentRun;
  readonly childSpec: DeepChildSpec;
  readonly pendingApproval: AgentTurnPendingApproval;
  readonly decision: DeepChildConfirmationDecision;
  readonly turnRuntime: AgentTurnRuntime;
  readonly childLoopContextStore?: DeepChildLoopContextStore;
  readonly abortSignal?: AbortSignal;
};

export function normalizeDeepChildRoundLimit(value: number | undefined, fallback: number): number {
  const normalized = normalizeOptionalDeepChildRoundLimit(value);
  return Math.min(normalized ?? fallback, fallback);
}

export function normalizeOptionalDeepChildRoundLimit(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.floor(value));
}
