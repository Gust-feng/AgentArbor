import type { ObservationRef } from "../../domain/observation/contracts.js";
import type { TaskSoil } from "../../domain/soil/task-soil.js";
import type { ChildAgentRun, ParentSynthesisResult } from "../../domain/underground/agent-fabric.js";
import type { AgentTurnRuntime } from "../../kernel/intelligence/agent-turn-runtime.js";
import { nowIso } from "../../kernel/id.js";
import type {
  DeepConversation,
  DeepDelegationDecision,
  DeepFollowUpContext,
  DeepIntakeContext,
  DeepRun,
  DeepChildSummary,
  SynthesizedConclusion,
} from "./contracts.js";
import {
  deepDecisionMessages,
  deepDecisionOutputContract,
  deepDirectAnswerMessages,
  deepDirectAnswerOutputContract,
  extractStructuredOutput,
  parseDeepDecision,
  parseDeepDirectAnswer,
} from "./deep-model-io.js";
import { executeDeepTurn } from "./deep-turn.js";
import { DEEP_MANAGER_AGENT_ID } from "./child-delegation.js";
import { synthesizeDeepConclusion } from "./parent-synthesis.js";
import type { DeepChildScheduler } from "./deep-child-scheduler.js";
import type { MultiAgentCapabilitySnapshot } from "./multi-agent-capability-snapshot.js";

/** The stable run facts visible to manager model turns. */
export type DeepManagerRunContext = {
  readonly run: DeepRun;
  readonly conversation: DeepConversation;
  readonly taskSoil: TaskSoil;
  readonly permissionBoundaryRefs: readonly string[];
  readonly capabilitySnapshot?: MultiAgentCapabilitySnapshot;
  readonly traceId: string;
  readonly goalId: string;
  readonly followUpContext?: DeepFollowUpContext;
  readonly intakeContext?: DeepIntakeContext;
};

export async function runDeepManagerDecisionTurn(input: {
  readonly context: DeepManagerRunContext;
  readonly turnRuntime: AgentTurnRuntime;
  readonly scheduler: DeepChildScheduler;
  readonly stepIndex: number;
  readonly stepLimit: number;
  readonly maxChildren: number;
  readonly maxModelRounds: number;
  readonly maxToolRounds: number;
  readonly maxRetries: number;
  readonly retryBackoffMs: number;
  readonly childSummaries: readonly DeepChildSummary[];
  readonly completedChildRuns: readonly ChildAgentRun[];
  readonly evidenceRefs: readonly string[];
  readonly priorDecisions: readonly DeepDelegationDecision[];
  readonly correctionContext?: readonly string[];
  readonly goal: string;
  readonly createdAt: string;
}): Promise<DeepDelegationDecision> {
  const callerRef: ObservationRef = {
    kind: "agent_run",
    id: input.context.run.runId,
    label: `${DEEP_MANAGER_AGENT_ID}:decision:${input.stepIndex}`,
  };
  const inputRefs = buildDeepManagerInputRefs(input.context, input.priorDecisions);
  const taskBoardSnapshot = input.scheduler.snapshot();
  let lastError: unknown;
  let priorParseError: string | undefined;
  for (let attempt = 0; attempt <= input.maxRetries; attempt += 1) {
    let turn;
    try {
      turn = await executeDeepTurn({
        turnRuntime: input.turnRuntime,
        traceId: input.context.traceId,
        goalId: input.context.goalId,
        callerAgentId: DEEP_MANAGER_AGENT_ID,
        callerRef,
        purpose: "deep_decision",
        outputContract: deepDecisionOutputContract(),
        inputRefs,
        messages: deepDecisionMessages({
          goal: input.goal,
          taskSoil: input.context.taskSoil,
          stepIndex: input.stepIndex,
          stepLimit: input.stepLimit,
          childSummaries: input.childSummaries,
          childRuns: input.completedChildRuns,
          followUpContext: input.context.followUpContext,
          intakeContext: input.context.intakeContext,
          priorDecisionSummaries: input.priorDecisions.map((decision) => decision.decisionSummary),
          evidenceRefs: input.evidenceRefs,
          permissionBoundaryRefs: input.context.permissionBoundaryRefs,
          maxChildren: input.maxChildren,
          correctionContext: input.correctionContext,
          capabilitySnapshot: input.context.capabilitySnapshot,
          priorParseError,
          taskBoardSnapshot,
        }),
        allowedTools: [],
        maxModelRounds: input.maxModelRounds,
        maxToolRounds: input.maxToolRounds,
      });
    } catch (turnError) {
      lastError = turnError;
      priorParseError = undefined;
      if (attempt < input.maxRetries) {
        await sleep(input.retryBackoffMs * (attempt + 1));
        continue;
      }
      break;
    }
    try {
      return parseDeepDecision({
        value: extractStructuredOutput(turn.finalOutput),
        parentAgentId: DEEP_MANAGER_AGENT_ID,
        createdAt: input.createdAt,
      });
    } catch (parseError) {
      lastError = parseError;
      priorParseError = describeDeepManagerTurnError(parseError);
      if (attempt < input.maxRetries) {
        continue;
      }
      break;
    }
  }
  throw lastError;
}

export async function runDeepDirectAnswerTurn(input: {
  readonly context: DeepManagerRunContext;
  readonly turnRuntime: AgentTurnRuntime;
  readonly decision: DeepDelegationDecision;
  readonly evidenceRefs: readonly string[];
  readonly maxModelRounds: number;
  readonly maxToolRounds: number;
  readonly maxRetries: number;
  readonly retryBackoffMs: number;
  readonly goal: string;
  readonly createdAt: string;
}): Promise<SynthesizedConclusion> {
  const callerRef: ObservationRef = {
    kind: "agent_run",
    id: input.context.run.runId,
    label: `${DEEP_MANAGER_AGENT_ID}:direct_answer`,
  };
  const inputRefs = buildDeepManagerInputRefs(input.context, []);
  let lastError: unknown;
  let priorParseError: string | undefined;
  for (let attempt = 0; attempt <= input.maxRetries; attempt += 1) {
    let turn;
    try {
      turn = await executeDeepTurn({
        turnRuntime: input.turnRuntime,
        traceId: input.context.traceId,
        goalId: input.context.goalId,
        callerAgentId: DEEP_MANAGER_AGENT_ID,
        callerRef,
        purpose: "deep_direct_answer",
        outputContract: deepDirectAnswerOutputContract(),
        inputRefs,
        messages: deepDirectAnswerMessages({
          goal: input.goal,
          taskSoil: input.context.taskSoil,
          decision: input.decision,
          evidenceRefs: input.evidenceRefs,
          priorParseError,
        }),
        allowedTools: [],
        maxModelRounds: input.maxModelRounds,
        maxToolRounds: input.maxToolRounds,
      });
    } catch (turnError) {
      lastError = turnError;
      priorParseError = undefined;
      if (attempt < input.maxRetries) {
        await sleep(input.retryBackoffMs * (attempt + 1));
        continue;
      }
      break;
    }
    try {
      return parseDeepDirectAnswer({
        value: extractStructuredOutput(turn.finalOutput),
        createdAt: input.createdAt,
        evidenceRefs: input.evidenceRefs,
      });
    } catch (parseError) {
      lastError = parseError;
      priorParseError = describeDeepManagerTurnError(parseError);
      if (attempt < input.maxRetries) {
        continue;
      }
      break;
    }
  }
  throw lastError;
}

export async function attemptDeepPartialSynthesis(input: {
  readonly context: DeepManagerRunContext;
  readonly turnRuntime: AgentTurnRuntime;
  readonly childSummaries: readonly DeepChildSummary[];
  readonly completedChildRuns: readonly ChildAgentRun[];
  readonly decisions: readonly DeepDelegationDecision[];
  readonly goal: string;
  readonly maxModelRounds: number;
  readonly maxToolRounds: number;
}): Promise<{ readonly conclusion: SynthesizedConclusion; readonly synthesisRecord: ParentSynthesisResult } | undefined> {
  if (input.childSummaries.length === 0) {
    return undefined;
  }
  try {
    return await synthesizeDeepConclusion({
      turnRuntime: input.turnRuntime,
      traceId: input.context.traceId,
      goalId: input.context.goalId,
      runId: input.context.run.runId,
      goal: input.goal,
      taskSoil: input.context.taskSoil,
      childSummaries: input.childSummaries,
      completedChildRuns: input.completedChildRuns,
      evidenceRefs: collectDeepChildEvidenceRefs(input.childSummaries),
      inputRefs: buildDeepManagerInputRefs(input.context, input.decisions),
      maxModelRounds: input.maxModelRounds,
      maxToolRounds: input.maxToolRounds,
      createdAt: nowIso(),
    });
  } catch {
    return undefined;
  }
}

export function buildDeepManagerInputRefs(
  context: DeepManagerRunContext,
  decisions: readonly DeepDelegationDecision[],
): ObservationRef[] {
  const refs: ObservationRef[] = [
    { kind: "trace", id: context.traceId },
    { kind: "goal", id: context.goalId },
    { kind: "agent_run", id: context.run.runId, label: "deep-manager-run" },
  ];
  for (const contextRef of context.taskSoil.contextRefs) {
    refs.push({
      kind: "artifact",
      id: contextRef.ref,
      label: contextRef.summary,
    });
  }
  for (const decision of decisions) {
    refs.push({ kind: "agent_delegation", id: decision.decisionId });
  }
  return refs;
}

export function collectDeepChildEvidenceRefs(childSummaries: readonly DeepChildSummary[]): string[] {
  const refs = new Set<string>();
  for (const child of childSummaries) {
    for (const ref of child.evidenceRefs) {
      const trimmed = ref.trim();
      if (trimmed.length > 0) {
        refs.add(trimmed);
      }
    }
  }
  return [...refs];
}

export function describeDeepManagerTurnError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
