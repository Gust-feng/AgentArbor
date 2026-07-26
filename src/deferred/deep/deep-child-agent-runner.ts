import { errorMessage } from "../../kernel/values/index.js";
/**
 * Deep child Agent runner.
 *
 * This is the explicit child Agent run boundary for the multi-Agent path:
 * the parent creates a DeepChildSpec (the semantic prompt variable), while the
 * child runs the standard AgentTurnRuntime autonomous loop with the delegated
 * prompt, allowed tools, tool confirmation policy, and bounded parent-assigned
 * round limits. Omitted limits default to the conservative deep child ceiling.
 */
import type { ModelMessage } from "../../domain/intelligence/contracts.js";
import type { ObservationRef } from "../../domain/observation/contracts.js";
import type {
  ChildAgentRun,
  ChildAgentRunExecution,
  ChildAgentRunParentInstruction,
  ChildAgentRunParentReview,
} from "../../domain/underground/agent-fabric.js";
import {
  resumeChildAgentRun,
  startChildAgentRun,
} from "../../domain/underground/agent-fabric.js";
import type { AgentTurnRuntimeResult } from "../../kernel/intelligence/agent-turn-runtime.js";
import { nowIso } from "../../kernel/id.js";
import type { DeepChildSpec, DeepChildSummary } from "./contracts.js";
import {
  frozenSnapshotHasToolOutputReader,
  inheritToolOutputReader,
} from "../../app/capability/tool-output-reader-capability.js";
import {
  createDeepChildLoopContextRef,
  createDeepChildLoopContextRecord,
  type DeepChildLoopContextRecord,
  type DeepChildLoopContextStore,
} from "./deep-child-loop-contexts.js";
import {
  DeepChildExecutionAdmissionError,
  type DeepChildAgentContinuationInput,
  type DeepChildAgentResumeInput,
  type DeepChildAgentRunInput,
  type DeepChildAgentRunResult,
  type DeepChildParentMessageContext,
} from "./deep-child-run-contracts.js";

const CHILD_AGENT_TURN_SEMANTICS = {
  blockedToolNames: [],
  exposeNonFinalOutput: false,
} as const;

export {
  DeepChildExecutionAdmissionError,
  DEEP_CHILD_AGENT_PROMPT_TEMPLATE_ID,
  DEEP_CHILD_DEFAULT_MAX_MODEL_ROUNDS,
  DEEP_CHILD_DEFAULT_MAX_TOOL_ROUNDS,
  normalizeDeepChildRoundLimit,
  normalizeOptionalDeepChildRoundLimit,
} from "./deep-child-run-contracts.js";
export type {
  DeepChildAgentContinuationInput,
  DeepChildAgentExecutionStats,
  DeepChildAgentResumeInput,
  DeepChildAgentRunInput,
  DeepChildAgentRunResult,
  DeepChildAgentPrompt,
  DeepChildAgentRuntimeContinuation,
  DeepChildConfirmationDecision,
  DeepChildParentMessageContext,
} from "./deep-child-run-contracts.js";
import {
  buildBlockedDeepChildAgentRun,
  buildCompletedDeepChildAgentRun,
  buildFailedDeepChildAgentRun,
  buildInterruptedDeepChildAgentRun,
  buildInvalidDeepChildMaterialRun,
  classifyDeepChildTurn,
  executionStatsFromTurn,
  failureDetailFromTurn,
  invalidOutputFailureReason,
  resolveRuntimeChildSpec,
} from "./deep-child-run-result-mapping.js";
export {
  buildFailedDeepChildAgentRun,
} from "./deep-child-run-result-mapping.js";
import {
  deepChildMaterialMessages,
  deepChildMaterialOutputContract,
  DEEP_CHILD_MATERIAL_CONTRACT_ID,
  extractStructuredOutput,
  parseDeepChildMaterial,
} from "./deep-model-io.js";

/**
 * The model/tool turn has a known result, but its mechanical continuation
 * snapshot did not commit. A valid pending snapshot remains retryable; an
 * invalid snapshot is represented by a failed child result. In both cases the
 * caller must not replay the turn or classify the side effect as unknown.
 */
export class DeepChildPostExecutionPersistenceError extends Error {
  constructor(
    readonly result: DeepChildAgentRunResult,
    cause: unknown,
  ) {
    super(`Deep child post-execution persistence failed: ${errorMessage(cause)}`);
    this.name = "DeepChildPostExecutionPersistenceError";
    (this as Error & { cause?: unknown }).cause = cause;
  }
}

export async function runDeepChildAgent(input: DeepChildAgentRunInput): Promise<DeepChildAgentRunResult> {
  const childSpec = resolveRuntimeChildSpec(input);
  const startedRun = startChildAgentRun(input.childRun, input.childRun.startedAt);
  return executeDeepChildAgentLoop({
    ...input,
    childSpec,
    activeRun: startedRun,
    persistenceFailureMode: "return_failed_result",
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
  let baseMessages: readonly ModelMessage[];
  try {
    baseMessages = await continuationBaseMessages(input, childSpec);
    await input.beforeExecution?.();
  } catch (error) {
    throw new DeepChildExecutionAdmissionError(error);
  }
  return executeDeepChildAgentLoop({
    ...input,
    childSpec,
    activeRun: resumedRun,
    persistenceFailureMode: "return_failed_result",
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
  if (input.runId !== undefined && input.childLoopContextStore !== undefined) {
    const contextRef = createDeepChildLoopContextRef(input.childRun.childRunId);
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
  readonly persistenceFailureMode: "return_failed_result";
}): Promise<DeepChildAgentRunResult> {
  const childSpec = input.childSpec;
  const allowedTools = inheritToolOutputReader({
    businessAllowedTools: childSpec.allowedTools,
    parentAllowedTools: input.capabilitySnapshot?.toolCatalog.allowedTools ?? [],
    readerExecutable: frozenSnapshotHasToolOutputReader(input.capabilitySnapshot),
  });
  const callerRef: ObservationRef = {
    kind: "agent_run",
    id: input.childRun.childRunId,
    label: `deep_child:${childSpec.role}`,
  };
  const turn = await input.turnRuntime.execute({
    policy: {
      allowModel: true,
      allowedTools,
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
  }, CHILD_AGENT_TURN_SEMANTICS);
  return finalizeDeepChildTurnWithContextPersistence({
    childRun: input.activeRun,
    childSpec,
    turn,
    unexpectedTurn: "throw",
    runId: input.runId,
    contextChildRunId: input.childRun.childRunId,
    childLoopContextStore: input.childLoopContextStore,
    persistenceFailureMode: input.persistenceFailureMode,
  });
}

function prepareContinuationContextPersistence(
  input: {
    readonly runId?: string;
    readonly childRunId: string;
    readonly childLoopContextStore?: DeepChildLoopContextStore;
  },
  turn: AgentTurnRuntimeResult,
): {
  readonly store: DeepChildLoopContextStore;
  readonly record: DeepChildLoopContextRecord;
} | undefined {
  if (input.runId === undefined || input.childLoopContextStore === undefined) {
    return undefined;
  }
  const messages = turn.contextMessages;
  if (messages === undefined || messages.length === 0) {
    return undefined;
  }
  const record = createDeepChildLoopContextRecord({
    runId: input.runId,
    childRunId: input.childRunId,
    messages,
  });
  return { store: input.childLoopContextStore, record };
}

export async function resumeDeepChildAgent(input: DeepChildAgentResumeInput): Promise<DeepChildAgentRunResult> {
  const childSpec = resolveRuntimeChildSpec(input);
  const resumedRun = resumeChildAgentRun(input.childRun, nowIso());
  const confirmationId = input.pendingApproval.confirmationId;
  const turn = input.decision.decision === "approve_once"
    ? await input.turnRuntime.resume({
        pendingApproval: input.pendingApproval,
        approvedConfirmationIds: [confirmationId],
        abortSignal: input.abortSignal,
      }, CHILD_AGENT_TURN_SEMANTICS)
    : await input.turnRuntime.resumeWithConfirmationDecision({
        pendingApproval: input.pendingApproval,
        decision: {
          confirmationId,
          decision: input.decision.decision,
          guidance: input.decision.guidance,
        },
        abortSignal: input.abortSignal,
      }, CHILD_AGENT_TURN_SEMANTICS);
  return finalizeDeepChildTurnWithContextPersistence({
    childRun: resumedRun,
    childSpec,
    turn,
    unexpectedTurn: "interrupt",
    runId: input.runId,
    contextChildRunId: input.childRun.childRunId,
    childLoopContextStore: input.childLoopContextStore,
    persistenceFailureMode: "retain_for_confirmation_retry",
  });
}

async function finalizeDeepChildTurnWithContextPersistence(input: {
  readonly childRun: ChildAgentRun;
  readonly childSpec: DeepChildSpec;
  readonly turn: AgentTurnRuntimeResult;
  readonly unexpectedTurn: "throw" | "interrupt";
  readonly runId?: string;
  readonly contextChildRunId: string;
  readonly childLoopContextStore?: DeepChildLoopContextStore;
  readonly persistenceFailureMode: "return_failed_result" | "retain_for_confirmation_retry";
}): Promise<DeepChildAgentRunResult> {
  let pending: ReturnType<typeof prepareContinuationContextPersistence>;
  try {
    pending = prepareContinuationContextPersistence({
      runId: input.runId,
      childRunId: input.contextChildRunId,
      childLoopContextStore: input.childLoopContextStore,
    }, input.turn);
  } catch (error) {
    const failed = buildUnpersistableDeepChildContextResult(input, error);
    if (input.persistenceFailureMode === "return_failed_result") {
      return failed;
    }
    throw new DeepChildPostExecutionPersistenceError(failed, error);
  }
  if (pending === undefined) {
    return finalizeDeepChildTurn(input);
  }
  let stored: DeepChildLoopContextRecord;
  try {
    stored = await pending.store.upsert(pending.record);
  } catch (error) {
    if (input.persistenceFailureMode === "return_failed_result") {
      return buildUnpersistableDeepChildContextResult(input, error);
    }
    const result = finalizeDeepChildTurn({
      ...input,
      continuationContextRef: pending.record.contextRef,
    });
    throw new DeepChildPostExecutionPersistenceError({
      ...result,
      pendingPersistence: {
        kind: "child_loop_context",
        record: pending.record,
      },
    }, error);
  }
  return finalizeDeepChildTurn({
    ...input,
    continuationContextRef: stored.contextRef,
  });
}

/** Completes only the write left by a known child turn; no model/tool code runs. */
export async function retryDeepChildAgentPostExecutionPersistence(
  result: DeepChildAgentRunResult,
  childLoopContextStore: DeepChildLoopContextStore,
): Promise<DeepChildAgentRunResult> {
  const pending = result.pendingPersistence;
  if (pending === undefined) {
    return result;
  }
  const stored = await childLoopContextStore.upsert(pending.record);
  if (stored.contextRef !== pending.record.contextRef) {
    throw new Error(
      `Deep child loop context persistence returned an unexpected ref: ${stored.contextRef}`,
    );
  }
  const { pendingPersistence: _pendingPersistence, ...persistedResult } = result;
  return persistedResult;
}

function buildUnpersistableDeepChildContextResult(
  input: {
    readonly childRun: ChildAgentRun;
    readonly childSpec: DeepChildSpec;
    readonly turn: AgentTurnRuntimeResult;
  },
  error: unknown,
): DeepChildAgentRunResult {
  const message = errorMessage(error);
  return buildFailedDeepChildAgentRun({
    childRun: input.childRun,
    childSpec: input.childSpec,
    reason: `child continuation context is not persistable: ${message}`,
    failedAt: nowIso(),
    execution: executionStatsFromTurn(input.turn),
    failureDetail: {
      layer: "agent_runtime",
      failureKind: errorCode(error) ?? "child_loop_context_not_persistable",
      retryable: false,
      message,
    },
  });
}

function finalizeDeepChildTurn(input: {
  readonly childRun: ChildAgentRun;
  readonly childSpec: DeepChildSpec;
  readonly turn: AgentTurnRuntimeResult;
  readonly continuationContextRef?: string;
  readonly unexpectedTurn: "throw" | "interrupt";
}): DeepChildAgentRunResult {
  const disposition = classifyDeepChildTurn(input.turn);
  if (disposition === "output_validation_failure") {
    const failureDetail = failureDetailFromTurn(input.turn);
    return buildFailedDeepChildAgentRun({
      childRun: input.childRun,
      childSpec: input.childSpec,
      reason: invalidOutputFailureReason(failureDetail),
      failedAt: nowIso(),
      execution: executionStatsFromTurn(input.turn),
      failureDetail,
      continuationContextRef: input.continuationContextRef,
    });
  }
  if (disposition === "blocked") {
    return buildBlockedDeepChildAgentRun({
      childRun: input.childRun,
      childSpec: input.childSpec,
      turn: input.turn,
      blockedAt: nowIso(),
      continuationContextRef: input.continuationContextRef,
    });
  }
  if (disposition === "interrupted" ||
    (input.unexpectedTurn === "interrupt" && disposition !== "completed")) {
    return buildInterruptedDeepChildAgentRun({
      childRun: input.childRun,
      childSpec: input.childSpec,
      turn: input.turn,
      interruptedAt: nowIso(),
      continuationContextRef: input.continuationContextRef,
    });
  }
  if (disposition !== "completed") {
    throw new Error(
      `Deep child Agent run failed: ${input.childRun.childRunId} / ${DEEP_CHILD_MATERIAL_CONTRACT_ID} (status=${input.turn.status})`,
    );
  }
  const structured = extractStructuredOutput(input.turn.finalOutput);
  try {
    const summary = parseDeepChildMaterial({
      value: structured,
      childSpec: input.childSpec,
      childRunId: input.childRun.childRunId,
    });
    return buildCompletedDeepChildAgentRun({
      childRun: input.childRun,
      childSpec: input.childSpec,
      summary,
      turn: input.turn,
      completedAt: nowIso(),
      continuationContextRef: input.continuationContextRef,
    });
  } catch (error) {
    return buildInvalidDeepChildMaterialRun({
      childRun: input.childRun,
      childSpec: input.childSpec,
      reason: errorMessage(error),
      failedAt: nowIso(),
      turn: input.turn,
      continuationContextRef: input.continuationContextRef,
    });
  }
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

function formatChildToolCalls(toolCalls: ChildAgentRunExecution["toolCalls"]): string {
  if (toolCalls.length === 0) {
    return "(none)";
  }
  return toolCalls.map((call) => `${call.toolName}:${call.status}`).join(", ");
}


function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = error.code;
  return typeof code === "string" && code.length > 0 ? code : undefined;
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
