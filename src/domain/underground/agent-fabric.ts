import type { AgentTurnPermissionPolicy } from "../common.js";
import type { ToolDisplayProjection } from "../observation/tool-display.js";
import type { AgentProtocol } from "./agent-loop.js";
import type { RootletClusterKind } from "./rootlet-contracts.js";
import type { WorkspaceView } from "./workspace.js";
import { createWorkspaceProjectionView } from "./workspace.js";

export const AGENT_FABRIC_AGENT_KINDS = ["manager", "core", "rootlet", "child"] as const;
export type AgentFabricAgentKind = (typeof AGENT_FABRIC_AGENT_KINDS)[number];

// ADR-0022 MVP boundary: parent agents may spawn one child/rootlet layer,
// but child agents cannot delegate again until subtree guards are born.
export const AGENT_FABRIC_MVP_MAX_DEPTH = 1 as const;

export const DELEGATION_DECISION_ACTIONS = [
  "spawn_children",
  "wait_for_children",
  "interrupt_child",
  "resume_child",
  "request_parent_synthesis",
  "request_user_clarification",
  "request_convergence",
  "stop",
] as const;
export type DelegationDecisionAction = (typeof DELEGATION_DECISION_ACTIONS)[number];

export const CHILD_AGENT_RUN_STATUSES = [
  "planned",
  "running",
  "blocked",
  "completed",
  "failed",
  "interrupted",
  "resumed",
] as const;
export type ChildAgentRunStatus = (typeof CHILD_AGENT_RUN_STATUSES)[number];

export const PARENT_SYNTHESIS_NEXT_ACTIONS = [
  "continue_exploration",
  "request_convergence",
  "request_user_clarification",
  "stop",
] as const;
export type ParentSynthesisNextAction = (typeof PARENT_SYNTHESIS_NEXT_ACTIONS)[number];

export type AgentSpecBudget = {
  readonly maxModelRounds?: number;
  readonly maxToolRounds?: number;
  readonly maxChildRuns?: number;
  readonly maxOutputRefs?: number;
};

export type AgentSpec = {
  readonly specId: string;
  readonly agentId: string;
  readonly displayName: string;
  readonly agentKind: AgentFabricAgentKind;
  readonly role: string;
  readonly rootletKind?: RootletClusterKind;
  readonly instructions?: {
    readonly objective?: string;
    readonly systemPromptRef?: string;
  };
  readonly protocol: AgentProtocol;
  readonly promptRef: string;
  readonly outputContractRef: string;
  readonly permissions: AgentTurnPermissionPolicy;
  readonly budget: AgentSpecBudget;
  readonly inputRefs: readonly string[];
  readonly createdAt: string;
};

export type ChildAgentRunToolCallTrace = {
  readonly callId: string;
  readonly toolName: string;
  readonly status: "completed" | "failed" | "approval_required" | "cancelled";
  readonly summary?: string;
  readonly inputSummary?: string;
  readonly durationMs?: number;
  readonly display?: ToolDisplayProjection;
};

export type ChildAgentRunModelMessageTrace = {
  readonly requestId: string;
  readonly responseId?: string;
  readonly status: "completed" | "failed" | "cancelled";
  readonly text?: string;
  readonly reasoningSummary?: string;
  readonly toolCallIds: readonly string[];
  readonly finishReason?: "stop" | "length" | "tool_call" | "content_filter" | "error";
  readonly completedAt: string;
};

export type ChildAgentRunExecution = {
  readonly modelRounds: number;
  readonly toolRounds: number;
  readonly modelRequestId?: string;
  readonly modelResponseId?: string;
  readonly modelMessages?: readonly ChildAgentRunModelMessageTrace[];
  readonly toolCalls: readonly ChildAgentRunToolCallTrace[];
};

export type ChildAgentRunExecutionOutcome = "completed" | "blocked" | "failed" | "interrupted";

export type ChildAgentRunExecutionSegment = ChildAgentRunExecution & {
  readonly outcome: ChildAgentRunExecutionOutcome;
  readonly continuationContextRef?: string;
  readonly recordedAt: string;
};

export type ChildAgentRunFailureDetail = {
  readonly layer: "model_provider" | "agent_runtime" | "user_or_parent" | "output_validation" | "unknown";
  readonly failureKind?: string;
  readonly retryable?: boolean;
  readonly message: string;
};

export type ChildAgentRunPendingApproval = {
  readonly confirmationId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly title: string;
  readonly actionSummary: string;
  readonly affectedResources: readonly string[];
  readonly riskLevel: "low" | "medium" | "high";
  readonly resumeAvailability?: "live" | "lost_after_restart";
  readonly requestedAt: string;
  readonly expiresAt?: string;
  readonly sourceRefs: readonly string[];
};

export type ChildAgentRunParentInstructionSource = "manager" | "control_api";

export type ChildAgentRunParentInstructionStatus = "queued" | "executed" | "cancelled";

export type ChildAgentRunParentReviewDecision = "accepted" | "rejected" | "needs_followup";

export type ChildAgentRunParentReview = {
  readonly decision: ChildAgentRunParentReviewDecision;
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
  readonly confidence?: number;
};

export type ChildAgentRunParentInstruction = {
  readonly instructionId: string;
  /** Safe ref for the parent-to-child message; does not contain the raw instruction text. */
  readonly messageRef?: string;
  readonly source: ChildAgentRunParentInstructionSource;
  readonly status: ChildAgentRunParentInstructionStatus;
  readonly instructionSummary: string;
  /** Parent Agent's safe review of why this child needs the operation. */
  readonly review?: ChildAgentRunParentReview;
  readonly requestedAt: string;
  readonly queuedAt?: string;
  readonly executedAt?: string;
  readonly cancelledAt?: string;
};

export type ParentSynthesisChildReviewDecision = ChildAgentRunParentReviewDecision;

export type ParentSynthesisChildReview = {
  readonly childRunId: string;
  readonly decision: ParentSynthesisChildReviewDecision;
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
  readonly sourceCandidateId?: string;
  readonly confidence?: number;
};

export type DelegationDecision = {
  readonly decisionId: string;
  readonly parentAgentId: string;
  readonly action: DelegationDecisionAction;
  readonly childSpecIds: readonly string[];
  readonly childRunIds: readonly string[];
  readonly inputRefs: readonly string[];
  readonly rationale: string;
  readonly uncertainty: string;
  readonly source: "ai" | "deterministic_fallback" | "control_api";
  readonly confidence: number;
  readonly reasoningTraceRefs: readonly string[];
  readonly createdAt: string;
};

export type ChildAgentRun = {
  readonly childRunId: string;
  readonly parentAgentId: string;
  readonly spec: AgentSpec;
  readonly status: ChildAgentRunStatus;
  readonly inputRefs: readonly string[];
  readonly outputRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly failureReason?: string;
  readonly failureDetail?: ChildAgentRunFailureDetail;
  readonly continuationContextRef?: string;
  readonly uncertainty?: string;
  readonly confidence?: number;
  /**
   * Latest execution segment, kept for compact projections and compatibility.
   * `executionHistory` preserves every model/tool loop segment across parent
   * continuations, approval resumes, blocks, and failures of the same child run.
   */
  readonly execution?: ChildAgentRunExecution;
  readonly executionHistory?: readonly ChildAgentRunExecutionSegment[];
  /**
   * Parent operations addressed to this same child run. This is separate from
   * executionHistory: parentInstructions records what the parent asked and when
   * it was queued/executed/cancelled; executionHistory records the child loop
   * segments that resulted.
   */
  readonly parentInstructions?: readonly ChildAgentRunParentInstruction[];
  readonly pendingApproval?: ChildAgentRunPendingApproval;
  readonly startedAt: string;
  readonly completedAt?: string;
};

export type ParentSynthesisResult = {
  readonly synthesisId: string;
  readonly parentAgentId: string;
  readonly childRunIds: readonly string[];
  readonly inputRefs: readonly string[];
  readonly retainedMaterialRefs: readonly string[];
  readonly rejectedMaterialRefs: readonly string[];
  readonly conflictRefs: readonly string[];
  readonly childReviews?: readonly ParentSynthesisChildReview[];
  readonly outputRefs: readonly string[];
  readonly nextAction: ParentSynthesisNextAction;
  readonly decisionSummary: string;
  readonly uncertainty: string;
  readonly source: "ai" | "deterministic_fallback";
  readonly confidence: number;
  readonly reasoningTraceRefs: readonly string[];
  readonly createdAt: string;
};

export type AgentRunTree = {
  readonly treeId: string;
  readonly rootRunId: string;
  readonly rootAgentId: string;
  readonly rootSpec: AgentSpec;
  readonly childRuns: readonly ChildAgentRun[];
  readonly delegationDecisions: readonly DelegationDecision[];
  readonly parentSyntheses: readonly ParentSynthesisResult[];
  readonly status: "running" | "completed" | "failed" | "stopped";
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type AgentSpecValidationResult = {
  readonly ok: boolean;
  readonly issues: readonly string[];
};

export class AgentFabricContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentFabricContractError";
  }
}

export function validateAgentSpec(spec: AgentSpec): AgentSpecValidationResult {
  const issues: string[] = [];
  if (spec.specId.trim().length === 0) {
    issues.push("specId is required");
  }
  if (spec.agentId.trim().length === 0) {
    issues.push("agentId is required");
  }
  if (spec.displayName.trim().length === 0) {
    issues.push("displayName is required");
  }
  if (spec.agentKind === "rootlet" && spec.rootletKind === undefined) {
    issues.push("rootlet spec requires rootletKind");
  }
  if (spec.agentKind !== "rootlet" && spec.rootletKind !== undefined) {
    issues.push("only rootlet specs may carry rootletKind");
  }
  if (spec.promptRef.trim().length === 0) {
    issues.push("promptRef is required");
  }
  if (spec.outputContractRef.trim().length === 0) {
    issues.push("outputContractRef is required");
  }
  if (
    (spec.budget.maxModelRounds !== undefined && spec.budget.maxModelRounds < 0) ||
    (spec.budget.maxToolRounds !== undefined && spec.budget.maxToolRounds < 0)
  ) {
    issues.push("model/tool budgets must be non-negative");
  }
  if (!spec.permissions.allowModel && spec.permissions.allowedTools.length > 0) {
    issues.push("tools cannot be exposed when model turns are disabled");
  }
  return { ok: issues.length === 0, issues };
}

export function assertValidAgentSpec(spec: AgentSpec): void {
  const validation = validateAgentSpec(spec);
  if (!validation.ok) {
    throw new AgentFabricContractError(`Invalid AgentSpec ${spec.specId || "(empty)"}: ${validation.issues.join("; ")}`);
  }
}

export function createAgentRunTree(input: {
  readonly treeId: string;
  readonly rootRunId: string;
  readonly rootAgentId: string;
  readonly rootSpec: AgentSpec;
  readonly createdAt: string;
}): AgentRunTree {
  assertValidAgentSpec(input.rootSpec);
  return {
    treeId: input.treeId,
    rootRunId: input.rootRunId,
    rootAgentId: input.rootAgentId,
    rootSpec: cloneAgentSpec(input.rootSpec),
    childRuns: [],
    delegationDecisions: [],
    parentSyntheses: [],
    status: "running",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

export function createChildAgentRun(input: {
  readonly childRunId: string;
  readonly parentAgentId: string;
  readonly spec: AgentSpec;
  readonly inputRefs: readonly string[];
  readonly startedAt: string;
}): ChildAgentRun {
  assertValidAgentSpec(input.spec);
  return {
    childRunId: input.childRunId,
    parentAgentId: input.parentAgentId,
    spec: cloneAgentSpec(input.spec),
    status: "planned",
    inputRefs: [...input.inputRefs],
    outputRefs: [],
    evidenceRefs: [],
    startedAt: input.startedAt,
  };
}

export function startChildAgentRun(run: ChildAgentRun, startedAt: string): ChildAgentRun {
  return {
    ...cloneChildAgentRun(run),
    status: "running",
    startedAt,
    completedAt: undefined,
    failureReason: undefined,
    pendingApproval: undefined,
  };
}

export function completeChildAgentRun(input: {
  readonly run: ChildAgentRun;
  readonly outputRefs: readonly string[];
  readonly evidenceRefs?: readonly string[];
  readonly confidence?: number;
  readonly uncertainty?: string;
  readonly execution?: ChildAgentRunExecution;
  readonly completedAt: string;
}): ChildAgentRun {
  return {
    ...cloneChildAgentRun(input.run),
    status: "completed",
    outputRefs: [...input.outputRefs],
    evidenceRefs: [...(input.evidenceRefs ?? [])],
    confidence: input.confidence,
    uncertainty: input.uncertainty,
    execution: cloneChildAgentRunExecution(input.execution ?? input.run.execution),
    executionHistory: appendChildAgentRunExecutionSegment({
      history: input.run.executionHistory,
      execution: input.execution,
      outcome: "completed",
      recordedAt: input.completedAt,
    }),
    pendingApproval: undefined,
    completedAt: input.completedAt,
  };
}

export function blockChildAgentRun(input: {
  readonly run: ChildAgentRun;
  readonly reason: string;
  readonly blockedAt: string;
  readonly outputRefs?: readonly string[];
  readonly evidenceRefs?: readonly string[];
  readonly confidence?: number;
  readonly uncertainty?: string;
  readonly execution?: ChildAgentRunExecution;
  readonly pendingApproval?: ChildAgentRunPendingApproval;
}): ChildAgentRun {
  return {
    ...cloneChildAgentRun(input.run),
    status: "blocked",
    outputRefs: [...(input.outputRefs ?? input.run.outputRefs)],
    evidenceRefs: [...(input.evidenceRefs ?? input.run.evidenceRefs)],
    failureReason: input.reason,
    confidence: input.confidence,
    uncertainty: input.uncertainty,
    execution: cloneChildAgentRunExecution(input.execution ?? input.run.execution),
    executionHistory: appendChildAgentRunExecutionSegment({
      history: input.run.executionHistory,
      execution: input.execution,
      outcome: "blocked",
      recordedAt: input.blockedAt,
    }),
    pendingApproval: cloneChildAgentRunPendingApproval(input.pendingApproval),
    completedAt: input.blockedAt,
  };
}

export function interruptChildAgentRun(
  run: ChildAgentRun,
  reason: string,
  interruptedAt: string,
  execution?: ChildAgentRunExecution,
): ChildAgentRun {
  return {
    ...cloneChildAgentRun(run),
    status: "interrupted",
    failureReason: reason,
    execution: cloneChildAgentRunExecution(execution ?? run.execution),
    executionHistory: appendChildAgentRunExecutionSegment({
      history: run.executionHistory,
      execution,
      outcome: "interrupted",
      recordedAt: interruptedAt,
    }),
    pendingApproval: undefined,
    completedAt: interruptedAt,
  };
}

export function resumeChildAgentRun(run: ChildAgentRun, resumedAt: string): ChildAgentRun {
  return {
    ...cloneChildAgentRun(run),
    status: "resumed",
    completedAt: undefined,
    failureReason: undefined,
    pendingApproval: undefined,
    startedAt: resumedAt,
  };
}

export function recordChildAgentRunParentInstruction(
  run: ChildAgentRun,
  instruction: ChildAgentRunParentInstruction,
): ChildAgentRun {
  const existing = cloneChildAgentRunParentInstructions(run.parentInstructions) ?? [];
  const index = existing.findIndex((item) => item.instructionId === instruction.instructionId);
  const next = cloneChildAgentRunParentInstruction(instruction);
  const parentInstructions =
    index >= 0
      ? existing.map((item, itemIndex) => itemIndex === index ? next : item)
      : [...existing, next];
  return {
    ...cloneChildAgentRun(run),
    parentInstructions,
  };
}

export function markChildAgentRunParentInstructionExecuted(
  run: ChildAgentRun,
  instructionId: string,
  executedAt: string,
): ChildAgentRun {
  const existing = cloneChildAgentRunParentInstructions(run.parentInstructions) ?? [];
  const parentInstructions = existing.map((instruction) =>
    instruction.instructionId === instructionId
      ? {
          ...instruction,
          status: "executed" as const,
          executedAt,
          cancelledAt: undefined,
        }
      : instruction
  );
  return {
    ...cloneChildAgentRun(run),
    parentInstructions: parentInstructions.length === 0 ? undefined : parentInstructions,
  };
}

export function markChildAgentRunParentInstructionCancelled(
  run: ChildAgentRun,
  instructionId: string,
  cancelledAt: string,
): ChildAgentRun {
  const existing = cloneChildAgentRunParentInstructions(run.parentInstructions) ?? [];
  const parentInstructions = existing.map((instruction) =>
    instruction.instructionId === instructionId && instruction.status === "queued"
      ? {
          ...instruction,
          status: "cancelled" as const,
          cancelledAt,
        }
      : instruction
  );
  return {
    ...cloneChildAgentRun(run),
    parentInstructions: parentInstructions.length === 0 ? undefined : parentInstructions,
  };
}

export function replaceChildAgentRunParentInstructions(
  run: ChildAgentRun,
  parentInstructions: readonly ChildAgentRunParentInstruction[] | undefined,
): ChildAgentRun {
  return {
    ...cloneChildAgentRun(run),
    parentInstructions: cloneChildAgentRunParentInstructions(parentInstructions),
  };
}

export function failChildAgentRun(
  run: ChildAgentRun,
  reason: string,
  failedAt: string,
  execution?: ChildAgentRunExecution,
): ChildAgentRun {
  return {
    ...cloneChildAgentRun(run),
    status: "failed",
    failureReason: reason,
    execution: cloneChildAgentRunExecution(execution ?? run.execution),
    executionHistory: appendChildAgentRunExecutionSegment({
      history: run.executionHistory,
      execution,
      outcome: "failed",
      recordedAt: failedAt,
    }),
    pendingApproval: undefined,
    completedAt: failedAt,
  };
}

export function appendChildRunToTree(tree: AgentRunTree, childRun: ChildAgentRun, updatedAt: string): AgentRunTree {
  return {
    ...cloneAgentRunTree(tree),
    childRuns: [...tree.childRuns.map(cloneChildAgentRun), cloneChildAgentRun(childRun)],
    updatedAt,
  };
}

export function replaceChildRunInTree(tree: AgentRunTree, childRun: ChildAgentRun, updatedAt: string): AgentRunTree {
  const found = tree.childRuns.some((run) => run.childRunId === childRun.childRunId);
  const childRuns = found
    ? tree.childRuns.map((run) => run.childRunId === childRun.childRunId ? cloneChildAgentRun(childRun) : cloneChildAgentRun(run))
    : [...tree.childRuns.map(cloneChildAgentRun), cloneChildAgentRun(childRun)];
  return {
    ...cloneAgentRunTree(tree),
    childRuns,
    updatedAt,
  };
}

export function appendDelegationDecisionToTree(
  tree: AgentRunTree,
  decision: DelegationDecision,
  updatedAt: string,
): AgentRunTree {
  return {
    ...cloneAgentRunTree(tree),
    delegationDecisions: [...tree.delegationDecisions.map(cloneDelegationDecision), cloneDelegationDecision(decision)],
    updatedAt,
  };
}

export function appendParentSynthesisToTree(
  tree: AgentRunTree,
  synthesis: ParentSynthesisResult,
  updatedAt: string,
): AgentRunTree {
  return {
    ...cloneAgentRunTree(tree),
    parentSyntheses: [...tree.parentSyntheses.map(cloneParentSynthesisResult), cloneParentSynthesisResult(synthesis)],
    updatedAt,
  };
}

export function completeAgentRunTree(
  tree: AgentRunTree,
  status: AgentRunTree["status"],
  updatedAt: string,
): AgentRunTree {
  return {
    ...cloneAgentRunTree(tree),
    status,
    updatedAt,
  };
}

export function assertNoDirectChildOutputHandoff(input: {
  readonly handoffInputRefs: readonly string[];
  readonly childRuns: readonly ChildAgentRun[];
}): void {
  // Compatibility name: the invariant now protects Plan creation. MVP depth=1 means child/rootlet
  // runs cannot spawn descendants, and their output must pass through parent synthesis first.
  const childOutputRefs = new Set(input.childRuns.flatMap((run) => run.outputRefs));
  const directRefs = input.handoffInputRefs.filter((ref) => childOutputRefs.has(ref));
  if (directRefs.length > 0) {
    throw new AgentFabricContractError(
      `Child agent output cannot bypass parent synthesis into Plan Package input: ${directRefs.join(", ")}`
    );
  }
}

export function forkAgentWorkspaceProjection<TParent, TChild>(input: {
  readonly parentWorkspace: WorkspaceView<TParent>;
  readonly project: (snapshot: TParent) => TChild;
}): WorkspaceView<TChild> {
  const parentSnapshot = input.parentWorkspace.snapshot();
  return createWorkspaceProjectionView(input.project(parentSnapshot));
}

export function cloneAgentRunTree(tree: AgentRunTree): AgentRunTree {
  return {
    ...tree,
    rootSpec: cloneAgentSpec(tree.rootSpec),
    childRuns: tree.childRuns.map(cloneChildAgentRun),
    delegationDecisions: tree.delegationDecisions.map(cloneDelegationDecision),
    parentSyntheses: tree.parentSyntheses.map(cloneParentSynthesisResult),
  };
}

export function cloneAgentSpec(spec: AgentSpec): AgentSpec {
  return {
    ...spec,
    instructions: spec.instructions === undefined ? undefined : { ...spec.instructions },
    protocol: {
      inputs: spec.protocol.inputs.map((input) => ({ ...input })),
      outputs: spec.protocol.outputs.map((output) => ({ ...output })),
    },
    permissions: {
      ...spec.permissions,
      allowedTools: [...spec.permissions.allowedTools],
    },
    budget: { ...spec.budget },
    inputRefs: [...spec.inputRefs],
  };
}

export function cloneChildAgentRun(run: ChildAgentRun): ChildAgentRun {
  return {
    ...run,
    spec: cloneAgentSpec(run.spec),
    inputRefs: [...run.inputRefs],
    outputRefs: [...run.outputRefs],
    evidenceRefs: [...run.evidenceRefs],
    failureDetail: cloneChildAgentRunFailureDetail(run.failureDetail),
    execution: cloneChildAgentRunExecution(run.execution),
    executionHistory: cloneChildAgentRunExecutionHistory(run.executionHistory),
    parentInstructions: cloneChildAgentRunParentInstructions(run.parentInstructions),
    pendingApproval: cloneChildAgentRunPendingApproval(run.pendingApproval),
  };
}

function appendChildAgentRunExecutionSegment(input: {
  readonly history: readonly ChildAgentRunExecutionSegment[] | undefined;
  readonly execution: ChildAgentRunExecution | undefined;
  readonly outcome: ChildAgentRunExecutionOutcome;
  readonly recordedAt: string;
}): readonly ChildAgentRunExecutionSegment[] | undefined {
  const history = cloneChildAgentRunExecutionHistory(input.history) ?? [];
  if (input.execution === undefined) {
    return history.length === 0 ? undefined : history;
  }
  return [
    ...history,
    {
      ...cloneChildAgentRunExecution(input.execution)!,
      outcome: input.outcome,
      recordedAt: input.recordedAt,
    },
  ];
}

function cloneChildAgentRunExecution(
  execution: ChildAgentRunExecution | undefined,
): ChildAgentRunExecution | undefined {
  if (execution === undefined) {
    return undefined;
  }
  const modelMessages = cloneChildAgentRunModelMessages(execution.modelMessages);
  return {
    ...execution,
    ...(modelMessages === undefined ? {} : { modelMessages }),
    toolCalls: execution.toolCalls.map((call) => ({ ...call })),
  };
}

function cloneChildAgentRunExecutionHistory(
  history: readonly ChildAgentRunExecutionSegment[] | undefined,
): readonly ChildAgentRunExecutionSegment[] | undefined {
  if (history === undefined) {
    return undefined;
  }
  return history.map((segment) => {
    const modelMessages = cloneChildAgentRunModelMessages(segment.modelMessages);
    return {
      ...segment,
      ...(modelMessages === undefined ? {} : { modelMessages }),
      toolCalls: segment.toolCalls.map((call) => ({ ...call })),
    };
  });
}

function cloneChildAgentRunFailureDetail(
  failureDetail: ChildAgentRunFailureDetail | undefined,
): ChildAgentRunFailureDetail | undefined {
  if (failureDetail === undefined) {
    return undefined;
  }
  return { ...failureDetail };
}

function cloneChildAgentRunModelMessages(
  messages: readonly ChildAgentRunModelMessageTrace[] | undefined,
): readonly ChildAgentRunModelMessageTrace[] | undefined {
  if (messages === undefined) {
    return undefined;
  }
  return messages.map((message) => ({
    ...message,
    toolCallIds: [...message.toolCallIds],
  }));
}

function cloneChildAgentRunParentInstructions(
  parentInstructions: readonly ChildAgentRunParentInstruction[] | undefined,
): readonly ChildAgentRunParentInstruction[] | undefined {
  if (parentInstructions === undefined) {
    return undefined;
  }
  return parentInstructions.map(cloneChildAgentRunParentInstruction);
}

function cloneChildAgentRunParentInstruction(
  instruction: ChildAgentRunParentInstruction,
): ChildAgentRunParentInstruction {
  return {
    ...instruction,
    review: cloneChildAgentRunParentReview(instruction.review),
  };
}

function cloneChildAgentRunParentReview(
  review: ChildAgentRunParentReview | undefined,
): ChildAgentRunParentReview | undefined {
  if (review === undefined) {
    return undefined;
  }
  return {
    ...review,
    evidenceRefs: [...review.evidenceRefs],
  };
}

function cloneChildAgentRunPendingApproval(
  pendingApproval: ChildAgentRunPendingApproval | undefined,
): ChildAgentRunPendingApproval | undefined {
  if (pendingApproval === undefined) {
    return undefined;
  }
  return {
    ...pendingApproval,
    affectedResources: [...pendingApproval.affectedResources],
    sourceRefs: [...pendingApproval.sourceRefs],
  };
}

export function cloneDelegationDecision(decision: DelegationDecision): DelegationDecision {
  return {
    ...decision,
    childSpecIds: [...decision.childSpecIds],
    childRunIds: [...decision.childRunIds],
    inputRefs: [...decision.inputRefs],
    reasoningTraceRefs: [...decision.reasoningTraceRefs],
  };
}

export function cloneParentSynthesisResult(synthesis: ParentSynthesisResult): ParentSynthesisResult {
  return {
    ...synthesis,
    childRunIds: [...synthesis.childRunIds],
    inputRefs: [...synthesis.inputRefs],
    retainedMaterialRefs: [...synthesis.retainedMaterialRefs],
    rejectedMaterialRefs: [...synthesis.rejectedMaterialRefs],
    conflictRefs: [...synthesis.conflictRefs],
    childReviews: cloneParentSynthesisChildReviews(synthesis.childReviews),
    outputRefs: [...synthesis.outputRefs],
    reasoningTraceRefs: [...synthesis.reasoningTraceRefs],
  };
}

function cloneParentSynthesisChildReviews(
  reviews: readonly ParentSynthesisChildReview[] | undefined,
): readonly ParentSynthesisChildReview[] | undefined {
  if (reviews === undefined) {
    return undefined;
  }
  return reviews.map((review) => ({
    ...review,
    evidenceRefs: [...review.evidenceRefs],
  }));
}
