/**
 * Deep child Agent runner.
 *
 * This is the explicit child Agent run boundary for the multi-Agent path:
 * the parent creates a DeepChildSpec (the semantic prompt variable), while the
 * child runs the standard AgentTurnRuntime autonomous loop with the delegated
 * prompt, allowed tools, tool confirmation policy, and bounded parent-assigned
 * round limits. Omitted limits default to the conservative deep child ceiling.
 */
import type { BasicAgentCapabilitySnapshot } from "../../domain/config/index.js";
import type { ModelMessage } from "../../domain/intelligence/contracts.js";
import type { ObservationRef } from "../../domain/observation/contracts.js";
import type { ToolConfirmationPolicy } from "../../domain/tools/contracts.js";
import type {
  ChildAgentRun,
  ChildAgentRunExecution,
  ChildAgentRunFailureDetail,
  ChildAgentRunModelMessageTrace,
  ChildAgentRunParentInstruction,
  ChildAgentRunParentReview,
  ChildAgentRunParentInstructionSource,
  ChildAgentRunParentInstructionStatus,
  ChildAgentRunPendingApproval,
} from "../../domain/underground/agent-fabric.js";
import {
  blockChildAgentRun,
  completeChildAgentRun,
  failChildAgentRun,
  interruptChildAgentRun,
  resumeChildAgentRun,
  startChildAgentRun,
} from "../../domain/underground/agent-fabric.js";
import type {
  AgentTurnPendingApproval,
  AgentTurnRuntime,
  AgentTurnRuntimeResult,
} from "../../kernel/intelligence/agent-turn-runtime.js";
import { nowIso } from "../../kernel/id.js";
import type { DeepChildSpec, DeepChildSummary } from "./contracts.js";
import {
  createDeepChildLoopContextRecord,
  type DeepChildLoopContextStore,
} from "./deep-child-loop-contexts.js";
import {
  deepChildMaterialMessages,
  deepChildMaterialOutputContract,
  DEEP_CHILD_MATERIAL_CONTRACT_ID,
  extractStructuredOutput,
  parseDeepChildMaterial,
} from "./deep-model-io.js";

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
  /**
   * The parent-created child spec. Passing this keeps the child prompt exactly
   * aligned with manager delegation. When omitted, the runner falls back to the
   * persisted ChildAgentRun spec for compatibility with older callers.
   */
  readonly childSpec?: DeepChildSpec;
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

export async function runDeepChildAgent(input: DeepChildAgentRunInput): Promise<DeepChildAgentRunResult> {
  const childSpec = resolveRuntimeChildSpec(input);
  const startedRun = startChildAgentRun(input.childRun, input.childRun.startedAt);
  return executeDeepChildAgentLoop({
    ...input,
    childSpec,
    activeRun: startedRun,
    messages: deepChildMaterialMessages({
      goal: input.goal,
      childSpec,
      permissionBoundaryRefs: input.permissionBoundaryRefs,
      capabilitySnapshot: input.capabilitySnapshot,
    }),
  });
}

export async function continueDeepChildAgent(
  input: DeepChildAgentContinuationInput,
): Promise<DeepChildAgentRunResult> {
  const childSpec = resolveRuntimeChildSpec(input);
  const resumedRun = resumeChildAgentRun(input.childRun, nowIso());
  const baseMessages = await continuationBaseMessages(input, childSpec);
  return executeDeepChildAgentLoop({
    ...input,
    childSpec,
    activeRun: resumedRun,
    messages: [
      ...baseMessages,
      continuationInstructionMessage({
        childRun: input.childRun,
        childSpec,
        parentInstruction: input.parentInstruction,
        currentParentInstructionRef: input.currentParentInstructionRef,
        currentParentReview: input.currentParentReview,
        parentMessageHistory: input.parentMessageHistory,
        previousSummary: input.previousSummary,
      }),
    ],
  });
}

async function continuationBaseMessages(
  input: DeepChildAgentContinuationInput,
  childSpec: DeepChildSpec,
): Promise<readonly ModelMessage[]> {
  const contextRef = input.childRun.continuationContextRef ?? input.previousSummary?.continuationContextRef;
  if (input.runId !== undefined && input.childLoopContextStore !== undefined && contextRef !== undefined) {
    const record = await input.childLoopContextStore.getByRef(input.runId, contextRef);
    if (record !== undefined && record.messages.length > 0) {
      return record.messages;
    }
  }
  return deepChildMaterialMessages({
    goal: input.goal,
    childSpec,
    permissionBoundaryRefs: input.permissionBoundaryRefs,
    capabilitySnapshot: input.capabilitySnapshot,
  });
}

async function executeDeepChildAgentLoop(input: DeepChildAgentRunInput & {
  readonly childSpec: DeepChildSpec;
  readonly activeRun: ChildAgentRun;
  readonly messages: readonly ModelMessage[];
}): Promise<DeepChildAgentRunResult> {
  const childSpec = input.childSpec;
  const callerRef: ObservationRef = {
    kind: "agent_run",
    id: input.childRun.childRunId,
    label: `deep_child:${childSpec.role}`,
  };
  const prompt: DeepChildAgentPrompt = {
    templateId: DEEP_CHILD_AGENT_PROMPT_TEMPLATE_ID,
    objective: childSpec.objective,
    role: childSpec.role,
    displayName: childSpec.displayName,
    inputRefs: [...childSpec.inputRefs],
  };
  const turn = await input.turnRuntime.executeAutonomous({
    policy: {
      allowModel: true,
      allowedTools: childSpec.allowedTools,
      maxModelRounds: childSpec.maxModelRounds,
      maxToolRounds: childSpec.maxToolRounds,
      confirmationPolicy: input.confirmationPolicy,
      fallback: "disabled",
      callerAgentId: input.childRun.spec.agentId,
      traceId: input.traceId,
      goalId: input.goalId,
      purpose: "deep_child_material",
      outputContract: deepChildMaterialOutputContract(),
      sensitivity: "internal",
      budget: {},
    },
    callerRef,
    inputRefs: dedupeObservationRefs([
      { kind: "trace", id: input.traceId },
      { kind: "goal", id: input.goalId },
      ...input.childRun.inputRefs.map((ref) => observationRefFromString(ref)),
    ]),
    sanitizedMessages: input.messages,
    constraintRefs: [],
    toolChoice: "auto",
    requestedAt: nowIso(),
    abortSignal: input.abortSignal,
  });
  const continuationContextRef = await persistContinuationContext(input, turn);
  if (isOutputValidationChildTurn(turn)) {
    const failureDetail = failureDetailFromTurn(turn);
    return buildFailedDeepChildAgentRun({
      childRun: input.activeRun,
      childSpec,
      reason: invalidOutputFailureReason(failureDetail),
      failedAt: nowIso(),
      execution: executionStatsFromTurn(turn),
      failureDetail,
      continuationContextRef,
    });
  }
  if (isBlockedChildTurn(turn)) {
    return buildBlockedDeepChildAgentRun({
      childRun: input.activeRun,
      childSpec,
      turn,
      blockedAt: nowIso(),
      continuationContextRef,
    });
  }
  if (isInterruptedChildTurn(turn)) {
    return buildInterruptedDeepChildAgentRun({
      childRun: input.activeRun,
      childSpec,
      turn,
      interruptedAt: nowIso(),
      continuationContextRef,
    });
  }
  if (turn.status !== "completed" || turn.finalOutput?.status !== "completed") {
    throw new Error(
      `Deep child Agent run failed: ${input.childRun.childRunId} / ${DEEP_CHILD_MATERIAL_CONTRACT_ID} (status=${turn.status})`,
    );
  }
  const structured = extractStructuredOutput(turn.finalOutput);
  let summary: DeepChildSummary;
  try {
    summary = parseDeepChildMaterial({
      value: structured,
      childSpec,
      childRunId: input.childRun.childRunId,
    });
  } catch (error) {
    return buildFailedDeepChildAgentRun({
      childRun: input.activeRun,
      childSpec,
      reason: `invalid child material: ${errorMessage(error)}`,
      failedAt: nowIso(),
      execution: executionStatsFromTurn(turn),
      failureDetail: {
        layer: "output_validation",
        failureKind: "invalid_child_material",
        retryable: false,
        message: errorMessage(error),
      },
      continuationContextRef,
    });
  }
  const completedRun = completeChildAgentRun({
    run: input.activeRun,
    outputRefs: summary.evidenceRefs.slice(0, 6),
    evidenceRefs: summary.evidenceRefs,
    confidence: summary.confidence,
    uncertainty: summary.uncertainty,
    execution: executionStatsFromTurn(turn),
    completedAt: nowIso(),
  });
  const completedRunWithContext = withChildRunRuntimeDetails(completedRun, {
    continuationContextRef,
  });
  const summaryWithContext = withSummaryRuntimeDetails(summary, {
    continuationContextRef,
  });
  return {
    summary: summaryWithContext,
    completedRun: completedRunWithContext,
    prompt,
    execution: executionStatsFromTurn(turn),
  };
}

async function persistContinuationContext(
  input: {
    readonly runId?: string;
    readonly childRun: ChildAgentRun;
    readonly childLoopContextStore?: DeepChildLoopContextStore;
  },
  turn: AgentTurnRuntimeResult,
): Promise<string | undefined> {
  if (input.runId === undefined || input.childLoopContextStore === undefined) {
    return undefined;
  }
  const messages = turn.contextMessages;
  if (messages === undefined || messages.length === 0) {
    return undefined;
  }
  const record = createDeepChildLoopContextRecord({
    runId: input.runId,
    childRunId: input.childRun.childRunId,
    messages,
  });
  return (await input.childLoopContextStore.upsert(record)).contextRef;
}

function withChildRunRuntimeDetails(
  run: ChildAgentRun,
  details: {
    readonly failureDetail?: ChildAgentRunFailureDetail;
    readonly continuationContextRef?: string;
  },
): ChildAgentRun {
  return {
    ...run,
    failureDetail: details.failureDetail ?? run.failureDetail,
    continuationContextRef: details.continuationContextRef ?? run.continuationContextRef,
  };
}

function withSummaryRuntimeDetails(
  summary: DeepChildSummary,
  details: {
    readonly failureDetail?: ChildAgentRunFailureDetail;
    readonly continuationContextRef?: string;
  },
): DeepChildSummary {
  return {
    ...summary,
    failureDetail: details.failureDetail ?? summary.failureDetail,
    continuationContextRef: details.continuationContextRef ?? summary.continuationContextRef,
  };
}

export async function resumeDeepChildAgent(input: {
  readonly runId?: string;
  readonly childRun: ChildAgentRun;
  readonly childSpec?: DeepChildSpec;
  readonly pendingApproval: AgentTurnPendingApproval;
  readonly decision: DeepChildConfirmationDecision;
  readonly turnRuntime: AgentTurnRuntime;
  readonly childLoopContextStore?: DeepChildLoopContextStore;
  readonly abortSignal?: AbortSignal;
}): Promise<DeepChildAgentRunResult> {
  const childSpec = resolveRuntimeChildSpec({ childRun: input.childRun, childSpec: input.childSpec });
  const resumedRun = resumeChildAgentRun(input.childRun, nowIso());
  const prompt = promptFromChildSpec(childSpec);
  const confirmationId = input.pendingApproval.confirmationId;
  const turn = input.decision.decision === "approve_once"
    ? await input.turnRuntime.resumeAutonomous({
        pendingApproval: input.pendingApproval,
        approvedConfirmationIds: [confirmationId],
        abortSignal: input.abortSignal,
      })
    : await input.turnRuntime.resumeAutonomousWithConfirmationDecision({
        pendingApproval: input.pendingApproval,
        decision: {
          confirmationId,
          decision: input.decision.decision,
          guidance: input.decision.guidance,
        },
        abortSignal: input.abortSignal,
      });
  const continuationContextRef = await persistContinuationContext({
    runId: input.runId,
    childRun: input.childRun,
    childLoopContextStore: input.childLoopContextStore,
  }, turn);

  if (isOutputValidationChildTurn(turn)) {
    const failureDetail = failureDetailFromTurn(turn);
    return buildFailedDeepChildAgentRun({
      childRun: resumedRun,
      childSpec,
      reason: invalidOutputFailureReason(failureDetail),
      failedAt: nowIso(),
      execution: executionStatsFromTurn(turn),
      failureDetail,
      continuationContextRef,
    });
  }
  if (isBlockedChildTurn(turn)) {
    return buildBlockedDeepChildAgentRun({
      childRun: resumedRun,
      childSpec,
      turn,
      blockedAt: nowIso(),
      continuationContextRef,
    });
  }
  if (isInterruptedChildTurn(turn)) {
    return buildInterruptedDeepChildAgentRun({
      childRun: resumedRun,
      childSpec,
      turn,
      interruptedAt: nowIso(),
      continuationContextRef,
    });
  }
  if (turn.status !== "completed" || turn.finalOutput?.status !== "completed") {
    return buildInterruptedDeepChildAgentRun({
      childRun: resumedRun,
      childSpec,
      turn,
      interruptedAt: nowIso(),
      continuationContextRef,
    });
  }
  const structured = extractStructuredOutput(turn.finalOutput);
  let summary: DeepChildSummary;
  try {
    summary = parseDeepChildMaterial({
      value: structured,
      childSpec,
      childRunId: input.childRun.childRunId,
    });
  } catch (error) {
    return buildFailedDeepChildAgentRun({
      childRun: resumedRun,
      childSpec,
      reason: `invalid child material: ${errorMessage(error)}`,
      failedAt: nowIso(),
      execution: executionStatsFromTurn(turn),
      failureDetail: {
        layer: "output_validation",
        failureKind: "invalid_child_material",
        retryable: false,
        message: errorMessage(error),
      },
      continuationContextRef,
    });
  }
  const completedRun = completeChildAgentRun({
    run: resumedRun,
    outputRefs: summary.evidenceRefs.slice(0, 6),
    evidenceRefs: summary.evidenceRefs,
    confidence: summary.confidence,
    uncertainty: summary.uncertainty,
    execution: executionStatsFromTurn(turn),
    completedAt: nowIso(),
  });
  const completedRunWithContext = withChildRunRuntimeDetails(completedRun, {
    continuationContextRef,
  });
  const summaryWithContext = withSummaryRuntimeDetails(summary, {
    continuationContextRef,
  });
  return {
    summary: summaryWithContext,
    completedRun: completedRunWithContext,
    prompt,
    execution: executionStatsFromTurn(turn),
  };
}

function continuationInstructionMessage(input: {
  readonly childRun: ChildAgentRun;
  readonly childSpec: DeepChildSpec;
  readonly parentInstruction: string;
  readonly currentParentInstructionRef?: string;
  readonly currentParentReview?: ChildAgentRunParentReview;
  readonly parentMessageHistory?: readonly DeepChildParentMessageContext[];
  readonly previousSummary?: DeepChildSummary;
}): ModelMessage {
  const instruction = input.parentInstruction.trim();
  const previous = input.previousSummary;
  const previousSection = previous === undefined
    ? [
        `Previous child status: ${input.childRun.status}`,
        `Previous uncertainty: ${input.childRun.uncertainty ?? input.childRun.failureReason ?? "(none)"}`,
        `Previous evidence refs: ${input.childRun.evidenceRefs.join(", ") || "(none)"}`,
      ]
    : [
        `Previous child status: ${previous.status}`,
        `Previous summary: ${previous.summary}`,
        `Previous findings: ${previous.findings.join("; ") || "(none)"}`,
        `Previous evidence refs: ${previous.evidenceRefs.join(", ") || "(none)"}`,
        `Previous uncertainty: ${previous.uncertainty ?? "(none)"}`,
      ];
  return {
    role: "user",
    ref: `context:deep:child_parent_instruction:${input.childRun.childRunId}`,
    content: [
      "Parent Agent follow-up instruction for the same child Agent run.",
      "Continue as the same child; keep the original role/objective and use the standard tool loop when useful.",
      "Do not create sub-agents. Produce a complete child material JSON when the added work is done.",
      "",
      `Child run id: ${input.childRun.childRunId}`,
      `Original role: ${input.childSpec.role} (${input.childSpec.displayName})`,
      `Original objective: ${input.childSpec.objective}`,
      ...childRunContinuationFactLines(input.childRun, input.currentParentInstructionRef),
      ...currentParentReviewLines(input.currentParentReview),
      ...parentMessageHistoryLines(input.parentMessageHistory),
      ...previousSection,
      "",
      `Parent instruction: ${instruction}`,
    ].join("\n"),
  };
}

function currentParentReviewLines(review: ChildAgentRunParentReview | undefined): string[] {
  if (review === undefined) {
    return ["Current parent review: (none)"];
  }
  const evidenceRefs = review.evidenceRefs.length === 0 ? "(none)" : review.evidenceRefs.join(", ");
  return [
    `Current parent review decision: ${review.decision}`,
    `Current parent review reason: ${review.reason}`,
    `Current parent review evidence refs: ${evidenceRefs}`,
  ];
}

function parentMessageHistoryLines(
  history: readonly DeepChildParentMessageContext[] | undefined,
): string[] {
  if (history === undefined || history.length === 0) {
    return ["Parent message history: (none)"];
  }
  return [
    "Parent message history (internal, raw parent-to-child messages):",
    ...history.slice(-4).map((message, index) =>
      `  ${index + 1}. ${message.source}/${message.status} (${message.messageRef}, ${message.updatedAt}): ${formatParentMessageContent(message.content)}`,
    ),
  ];
}

function formatParentMessageContent(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= 1200) {
    return normalized;
  }
  return `${normalized.slice(0, 1197)}...`;
}

function childRunContinuationFactLines(
  childRun: ChildAgentRun,
  currentParentInstructionRef?: string,
): string[] {
  const executionSegments = childRun.executionHistory?.length ?? (childRun.execution === undefined ? 0 : 1);
  const latestExecution = childRun.execution === undefined
    ? "Latest execution: (none)"
    : [
        `Latest execution: modelRounds=${childRun.execution.modelRounds}`,
        `toolRounds=${childRun.execution.toolRounds}`,
        `toolCalls=${formatChildToolCalls(childRun.execution.toolCalls)}`,
      ].join("; ");
  const parentInstructions = parentInstructionsExcludingCurrent(
    childRun.parentInstructions,
    currentParentInstructionRef,
  );
  const parentOperations = parentInstructions.length === 0
    ? "Parent operations so far: (none)"
    : [
        "Parent operations so far:",
        ...parentInstructions.slice(-4).map((instruction, index) =>
          `  ${index + 1}. ${instruction.source}/${instruction.status} (${instruction.messageRef ?? instruction.instructionId}): ${instruction.instructionSummary}${formatParentInstructionReview(instruction)}`,
        ),
      ].join("\n");
  return [
    `Execution segments so far: ${executionSegments}`,
    `Execution segment history: ${formatChildExecutionSegmentHistory(childRun)}`,
    latestExecution,
    parentOperations,
  ];
}

function formatParentInstructionReview(instruction: ChildAgentRunParentInstruction): string {
  if (instruction.review === undefined) {
    return "";
  }
  const evidenceRefs = instruction.review.evidenceRefs.length === 0
    ? "(none)"
    : instruction.review.evidenceRefs.join(", ");
  return ` | parentReview=${instruction.review.decision}: ${instruction.review.reason}; evidenceRefs=${evidenceRefs}`;
}

function parentInstructionsExcludingCurrent(
  parentInstructions: readonly ChildAgentRunParentInstruction[] | undefined,
  currentParentInstructionRef: string | undefined,
): readonly ChildAgentRunParentInstruction[] {
  if (parentInstructions === undefined) {
    return [];
  }
  if (currentParentInstructionRef === undefined) {
    return parentInstructions;
  }
  return parentInstructions.filter((instruction) =>
    instruction.messageRef !== currentParentInstructionRef &&
    instruction.instructionId !== currentParentInstructionRef
  );
}

function formatChildExecutionSegmentHistory(childRun: ChildAgentRun): string {
  const history = childRun.executionHistory ?? [];
  if (history.length === 0) {
    return childRun.execution === undefined
      ? "(none)"
      : `latestOnly modelRounds=${childRun.execution.modelRounds}; toolRounds=${childRun.execution.toolRounds}; toolCalls=${formatChildToolCalls(childRun.execution.toolCalls)}`;
  }
  return history.slice(-4).map((segment, index) => {
    const segmentNumber = history.length - Math.min(history.length, 4) + index + 1;
    return [
      `${segmentNumber}.${segment.outcome}`,
      `modelRounds=${segment.modelRounds}`,
      `toolRounds=${segment.toolRounds}`,
      `toolCalls=${formatChildToolCalls(segment.toolCalls)}`,
      `recordedAt=${segment.recordedAt}`,
    ].join("; ");
  }).join(" | ");
}

function buildBlockedDeepChildAgentRun(input: {
  readonly childRun: ChildAgentRun;
  readonly childSpec: DeepChildSpec;
  readonly turn: AgentTurnRuntimeResult;
  readonly blockedAt: string;
  readonly continuationContextRef?: string;
}): DeepChildAgentRunResult {
  const block = describeBlockedTurn(input.turn);
  const evidenceRefs = input.turn.toolCalls.map((call) => call.callId);
  const blockedRun = withChildRunRuntimeDetails(blockChildAgentRun({
    run: input.childRun,
    reason: block.reason,
    evidenceRefs,
    confidence: 0,
    uncertainty: block.uncertainty,
    execution: executionStatsFromTurn(input.turn),
    pendingApproval: pendingApprovalFromTurn(input.turn),
    blockedAt: input.blockedAt,
  }), {
    continuationContextRef: input.continuationContextRef,
  });
  const summary: DeepChildSummary = withSummaryRuntimeDetails({
    childRunId: input.childRun.childRunId,
    spec: input.childSpec,
    status: "blocked",
    summary: block.summary,
    findings: block.findings,
    evidenceRefs,
    confidence: 0,
    uncertainty: block.uncertainty,
  }, {
    continuationContextRef: input.continuationContextRef,
  });
  return {
    summary,
    completedRun: blockedRun,
    prompt: promptFromChildSpec(input.childSpec),
    execution: executionStatsFromTurn(input.turn),
    pendingContinuation: input.turn.pendingApproval === undefined
      ? undefined
      : {
          childRunId: input.childRun.childRunId,
          confirmationId: input.turn.pendingApproval.confirmationId,
          childRun: blockedRun,
          childSpec: input.childSpec,
          pendingApproval: input.turn.pendingApproval,
        },
  };
}

function buildInterruptedDeepChildAgentRun(input: {
  readonly childRun: ChildAgentRun;
  readonly childSpec: DeepChildSpec;
  readonly turn: AgentTurnRuntimeResult;
  readonly interruptedAt: string;
  readonly continuationContextRef?: string;
}): DeepChildAgentRunResult {
  const failureDetail = failureDetailFromTurn(input.turn);
  const reason = failureDetail.message;
  const evidenceRefs = input.turn.toolCalls.map((call) => call.callId);
  const interruptedRun = withChildRunRuntimeDetails(interruptChildAgentRun(
    input.childRun,
    reason,
    input.interruptedAt,
    executionStatsFromTurn(input.turn),
  ), {
    failureDetail,
    continuationContextRef: input.continuationContextRef,
  });
  const summary: DeepChildSummary = withSummaryRuntimeDetails({
    childRunId: input.childRun.childRunId,
    spec: input.childSpec,
    status: "interrupted",
    summary: interruptedChildSummary(failureDetail),
    findings: [],
    evidenceRefs,
    confidence: 0,
    uncertainty: "This child Agent did not produce governed child material before the loop stopped; the parent can review and continue the same child run.",
  }, {
    failureDetail,
    continuationContextRef: input.continuationContextRef,
  });
  return {
    summary,
    completedRun: interruptedRun,
    prompt: promptFromChildSpec(input.childSpec),
    execution: executionStatsFromTurn(input.turn),
  };
}

export function buildFailedDeepChildAgentRun(input: {
  readonly childRun: ChildAgentRun;
  readonly childSpec?: DeepChildSpec;
  readonly reason: string;
  readonly failedAt: string;
  readonly execution?: ChildAgentRunExecution;
  readonly failureDetail?: ChildAgentRunFailureDetail;
  readonly continuationContextRef?: string;
}): DeepChildAgentRunResult {
  const childSpec = resolveRuntimeChildSpec({ childRun: input.childRun, childSpec: input.childSpec });
  const failedRun = withChildRunRuntimeDetails(
    failChildAgentRun(input.childRun, input.reason, input.failedAt, input.execution),
    {
      failureDetail: input.failureDetail,
      continuationContextRef: input.continuationContextRef,
    },
  );
  const trimmedReason = input.reason.trim().length > 0 ? input.reason.trim() : "unknown exploration error";
  const summary: DeepChildSummary = withSummaryRuntimeDetails({
    childRunId: input.childRun.childRunId,
    spec: childSpec,
    status: "failed",
    summary: `Child Agent run failed: ${trimmedReason}`,
    findings: [],
    evidenceRefs: [],
    confidence: 0,
    uncertainty: `This child Agent run failed (${trimmedReason}); no usable evidence collected.`,
  }, {
    failureDetail: input.failureDetail,
    continuationContextRef: input.continuationContextRef,
  });
  return {
    summary,
    completedRun: failedRun,
    prompt: {
      templateId: DEEP_CHILD_AGENT_PROMPT_TEMPLATE_ID,
      objective: childSpec.objective,
      role: childSpec.role,
      displayName: childSpec.displayName,
      inputRefs: [...childSpec.inputRefs],
    },
    execution: input.execution ?? {
      modelRounds: 0,
      toolRounds: 0,
      toolCalls: [],
    },
  };
}

function promptFromChildSpec(childSpec: DeepChildSpec): DeepChildAgentPrompt {
  return {
    templateId: DEEP_CHILD_AGENT_PROMPT_TEMPLATE_ID,
    objective: childSpec.objective,
    role: childSpec.role,
    displayName: childSpec.displayName,
    inputRefs: [...childSpec.inputRefs],
  };
}

function isBlockedChildTurn(turn: AgentTurnRuntimeResult): boolean {
  return turn.status === "approval_required" ||
    (turn.status === "paused" && (
      turn.stoppedReason === "out_of_fuel" ||
      turn.stoppedReason === "context_overflow"
    ));
}

function isOutputValidationChildTurn(turn: AgentTurnRuntimeResult): boolean {
  return turn.status === "failed" &&
    turn.stoppedReason === "model_failed" &&
    turn.finalOutput?.failure?.kind === "output_validation";
}

function isInterruptedChildTurn(turn: AgentTurnRuntimeResult): boolean {
  return turn.status === "cancelled" ||
    turn.stoppedReason === "cancelled" ||
    (turn.status === "failed" && (
      turn.stoppedReason === "model_failed" ||
      turn.stoppedReason === "runtime_error"
    ) && turn.finalOutput?.failure?.kind !== "output_validation");
}

function failureDetailFromTurn(turn: AgentTurnRuntimeResult): ChildAgentRunFailureDetail {
  if (turn.status === "cancelled" || turn.stoppedReason === "cancelled") {
    return {
      layer: "user_or_parent",
      failureKind: "cancelled",
      retryable: false,
      message: "child Agent loop was cancelled",
    };
  }
  const failure = turn.finalOutput?.failure;
  const message = failure?.message?.trim();
  if (failure?.kind === "output_validation") {
    return {
      layer: "output_validation",
      failureKind: failure.kind,
      retryable: failure.retryable,
      message: message && message.length > 0 ? message : "child Agent output validation failed",
    };
  }
  if (turn.stoppedReason === "runtime_error") {
    return {
      layer: "agent_runtime",
      failureKind: failure?.kind ?? "runtime_error",
      retryable: failure?.retryable,
      message: message && message.length > 0 ? message : "child Agent runtime stopped unexpectedly",
    };
  }
  if (turn.stoppedReason === "model_failed") {
    return {
      layer: "model_provider",
      failureKind: failure?.kind ?? "provider_response",
      retryable: failure?.retryable,
      message: message && message.length > 0 ? message : "child Agent model call stopped unexpectedly",
    };
  }
  return {
    layer: "unknown",
    failureKind: turn.stoppedReason,
    retryable: false,
    message: `child Agent loop stopped unexpectedly (${turn.stoppedReason})`,
  };
}

function interruptedChildSummary(failureDetail: ChildAgentRunFailureDetail): string {
  switch (failureDetail.failureKind) {
    case "provider_network":
      return `模型通道暂时中断：${failureDetail.message}`;
    case "provider_timeout":
      return `模型通道请求超时：${failureDetail.message}`;
    case "provider_rate_limit":
      return `模型通道被限流：${failureDetail.message}`;
    case "cancelled":
      return `子 Agent 已取消：${failureDetail.message}`;
    default:
      return failureDetail.layer === "agent_runtime"
        ? `子 Agent 运行时异常：${failureDetail.message}`
        : `模型通道异常：${failureDetail.message}`;
  }
}

function invalidOutputFailureReason(failureDetail: ChildAgentRunFailureDetail): string {
  const message = failureDetail.message.trim();
  return message.length === 0
    ? "invalid child material: output validation failed"
    : `invalid child material: ${message}`;
}

function describeBlockedTurn(turn: AgentTurnRuntimeResult): {
  readonly reason: string;
  readonly summary: string;
  readonly findings: readonly string[];
  readonly uncertainty: string;
} {
  if (turn.status === "approval_required") {
    const approvalTools = uniqueStrings(
      turn.toolCalls
        .filter((call) => call.status === "approval_required")
        .map((call) => call.toolName),
    );
    const toolList = approvalTools.length === 0 ? "tool" : approvalTools.join(", ");
    return {
      reason: "waiting for tool confirmation",
      summary: `Child Agent blocked: waiting for confirmation to use ${toolList}.`,
      findings: [`Waiting for tool confirmation: ${toolList}.`],
      uncertainty: "This child Agent needs confirmation before it can continue its standard tool loop.",
    };
  }
  if (turn.stoppedReason === "context_overflow") {
    return {
      reason: "context overflow",
      summary: "Child Agent blocked: context overflow prevented completion.",
      findings: ["Context overflow prevented this child Agent from producing a final material summary."],
      uncertainty: "The child Agent needs a smaller context or better context maintenance before continuing.",
    };
  }
  return {
    reason: "round budget exhausted",
    summary: "达到探索上限，可基于已保留上下文继续或综合。",
    findings: ["The child Agent reached its model/tool exploration limit before producing final material."],
    uncertainty: "The parent Agent can continue this same child from preserved context or synthesize from available material.",
  };
}

export function deepChildSpecFromRun(run: ChildAgentRun): DeepChildSpec {
  return {
    specId: run.spec.specId,
    displayName: run.spec.displayName,
    role: run.spec.role,
    objective: run.spec.instructions?.objective ?? `Explore from angle: ${run.spec.role}`,
    allowedTools: [...run.spec.permissions.allowedTools],
    inputRefs: [...run.spec.inputRefs],
    maxModelRounds: run.spec.permissions.maxModelRounds ?? run.spec.budget.maxModelRounds,
    maxToolRounds: run.spec.permissions.maxToolRounds ?? run.spec.budget.maxToolRounds,
  };
}

function resolveRuntimeChildSpec(input: {
  readonly childRun: ChildAgentRun;
  readonly childSpec?: DeepChildSpec;
}): DeepChildSpec {
  const delegated = input.childSpec ?? deepChildSpecFromRun(input.childRun);
  const effectiveAllowedTools = intersectPreserveLeftOrder(
    delegated.allowedTools,
    input.childRun.spec.permissions.allowedTools,
  );
  return {
    ...delegated,
    allowedTools: effectiveAllowedTools,
    inputRefs: uniqueStrings([...delegated.inputRefs, ...input.childRun.inputRefs]),
    maxModelRounds: optionalDeepChildRoundLimit(
      delegated.maxModelRounds ?? input.childRun.spec.permissions.maxModelRounds ?? input.childRun.spec.budget.maxModelRounds,
      DEEP_CHILD_DEFAULT_MAX_MODEL_ROUNDS,
    ),
    maxToolRounds: optionalDeepChildRoundLimit(
      delegated.maxToolRounds ?? input.childRun.spec.permissions.maxToolRounds ?? input.childRun.spec.budget.maxToolRounds,
      DEEP_CHILD_DEFAULT_MAX_TOOL_ROUNDS,
    ),
  };
}

function optionalDeepChildRoundLimit(value: number | undefined, maxValue: number): number | undefined {
  return value === undefined ? undefined : normalizeDeepChildRoundLimit(value, maxValue);
}

function executionStatsFromTurn(turn: AgentTurnRuntimeResult): ChildAgentRunExecution {
  return {
    modelRounds: turn.modelRounds,
    toolRounds: turn.toolRounds,
    modelRequestId: turn.modelRequestId,
    modelResponseId: turn.modelResponseId,
    modelMessages: turn.modelResponses.map((response) => ({
      requestId: response.requestId,
      responseId: response.responseId,
      status: response.status,
      text: response.text,
      reasoningSummary: response.reasoningSummary,
      toolCallIds: [...response.toolCallIds],
      finishReason: response.finishReason,
      completedAt: response.completedAt,
    })),
    toolCalls: turn.toolCalls.map((toolCall) => ({
      callId: toolCall.callId,
      toolName: toolCall.toolName,
      status: toolCall.status,
      summary: toolCallSummary(toolCall),
      inputSummary: summarizeToolInput(toolCall.input),
      durationMs: toolCall.durationMs,
      display: toolCall.projection?.display ?? toolCall.projection?.envelope?.uiDisplay,
    })),
  };
}

function toolCallSummary(toolCall: AgentTurnRuntimeResult["toolCalls"][number]): string | undefined {
  const summary =
    toolCall.projection?.uiSummary ??
    toolCall.projection?.envelope?.agentSummary ??
    toolCall.error;
  return compactTraceText(summary, 500);
}

function summarizeToolInput(input: unknown): string | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (typeof input === "string") {
    return compactTraceText(input, 240);
  }
  try {
    return compactTraceText(JSON.stringify(input), 240);
  } catch {
    return undefined;
  }
}

function compactTraceText(value: string | undefined, maxLength: number): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim();
  if (text === undefined || text.length === 0) {
    return undefined;
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function pendingApprovalFromTurn(turn: AgentTurnRuntimeResult): ChildAgentRunPendingApproval | undefined {
  const pending = turn.pendingApproval;
  if (pending === undefined) {
    return undefined;
  }
  const request = pending.toolLoop.pendingToolCall;
  const confirmation = pending.toolLoop.confirmationRequest;
  return {
    confirmationId: pending.confirmationId,
    toolCallId: request.callId,
    toolName: request.toolName,
    title: confirmation?.title ?? "需要确认",
    actionSummary: confirmation?.actionSummary ?? request.toolName,
    affectedResources: [...(confirmation?.affectedResources ?? [])],
    riskLevel: confirmation?.riskLevel ?? "medium",
    resumeAvailability: confirmation?.resumeAvailability,
    requestedAt: confirmation?.requestedAt ?? nowIso(),
    expiresAt: confirmation?.expiresAt,
    sourceRefs: [...(confirmation?.sourceRefs ?? [request.callId])],
  };
}

function formatChildToolCalls(toolCalls: ChildAgentRunExecution["toolCalls"]): string {
  if (toolCalls.length === 0) {
    return "(none)";
  }
  return toolCalls.map((call) => `${call.toolName}:${call.status}`).join(", ");
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : String(error);
}

function intersectPreserveLeftOrder(left: readonly string[], right: readonly string[]): string[] {
  const allowed = new Set(right);
  return uniqueStrings(left).filter((toolName) => allowed.has(toolName));
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

export function normalizeDeepChildRoundLimit(value: number | undefined, fallback: number): number {
  const normalized = normalizeOptionalRoundLimit(value);
  return Math.min(normalized ?? fallback, fallback);
}

function normalizeOptionalRoundLimit(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.floor(value));
}

const OBSERVATION_REF_KINDS: ReadonlySet<string> = new Set<string>([
  "trace", "goal", "event", "task", "artifact", "direction_handoff",
  "direction_package", "growth_plan", "workflow", "rootlet", "candidate",
  "candidate_pool", "autonomy_decision", "convergence_review", "model_call",
  "tool_call", "agent_spec", "agent_run", "agent_delegation",
  "parent_synthesis", "user_clarification", "verification", "fruit",
  "run_memory", "experience_candidate", "path_bias",
]);

function observationRefFromString(ref: string): ObservationRef {
  const trimmed = ref.trim();
  const index = trimmed.indexOf(":");
  if (index <= 0) {
    return { kind: "artifact", id: trimmed };
  }
  const kind = trimmed.slice(0, index);
  const id = trimmed.slice(index + 1);
  if (id.length === 0) {
    return { kind: "artifact", id: trimmed };
  }
  if (OBSERVATION_REF_KINDS.has(kind)) {
    return { kind: kind as ObservationRef["kind"], id };
  }
  return { kind: "artifact", id: trimmed };
}

function dedupeObservationRefs(refs: readonly ObservationRef[]): ObservationRef[] {
  const seen = new Set<string>();
  const result: ObservationRef[] = [];
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(ref);
    }
  }
  return result;
}
