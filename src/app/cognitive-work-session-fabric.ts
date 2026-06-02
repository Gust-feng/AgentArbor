import {
  createChildAgentRun,
  type AgentSpec,
  type ChildAgentRun,
  type DelegationDecision,
  type ParentSynthesisResult,
} from "../domain/underground/agent-fabric.js";
import { createId, nowIso } from "../kernel/id.js";
import type {
  CognitiveWorkSessionReport,
  WorkSessionChildSpecRequest,
  WorkSessionDecision,
} from "./cognitive-work-session-contracts.js";
import { WORK_SESSION_ALLOWED_TOOLS } from "./cognitive-work-session-contracts.js";
import { clampConfidence, safeText, safeToken, unique } from "./cognitive-work-session-safe.js";

export const MANAGER_AGENT_ID = "cognitive-work-session-manager";
export const WORK_SESSION_MAX_CHILDREN = 4;

export function createManagerSpec(input: {
  readonly goalId: string;
  readonly traceId: string;
  readonly createdAt: string;
}): AgentSpec {
  return {
    specId: "cognitive-work-session-manager",
    agentId: MANAGER_AGENT_ID,
    displayName: "Cognitive Work Session Manager",
    agentKind: "manager",
    role: "work_session_manager",
    protocol: {
      inputs: [
        { source: "workspace", key: "task_soil_goal", required: true },
        { source: "workspace", key: "context_refs", required: false },
      ],
      outputs: [{ type: "artifact", payloadSchema: "work_session.report.v1" }],
    },
    promptRef: "prompt:work_session.manager.v1",
    outputContractRef: "work_session.decision.v1",
    permissions: {
      allowModel: true,
      allowedTools: [...WORK_SESSION_ALLOWED_TOOLS],
      maxModelRounds: 2,
      maxToolRounds: 1,
      fallback: "disabled",
    },
    budget: {
      maxModelRounds: 2,
      maxToolRounds: 1,
      maxChildRuns: WORK_SESSION_MAX_CHILDREN,
      maxOutputRefs: 4,
    },
    inputRefs: [`goal:${input.goalId}`, `trace:${input.traceId}`],
    createdAt: input.createdAt,
  };
}

export function createPlannedChildren(input: {
  readonly requests: readonly WorkSessionChildSpecRequest[];
  readonly parentAgentId: string;
  readonly goalId: string;
  readonly traceId: string;
  readonly createdAt: string;
}): readonly ChildAgentRun[] {
  return input.requests.map((request, index) => {
    const spec = createChildSpec({ request, index, goalId: input.goalId, traceId: input.traceId, createdAt: input.createdAt });
    return createChildAgentRun({
      childRunId: createId("child-run"),
      parentAgentId: input.parentAgentId,
      spec,
      inputRefs: spec.inputRefs,
      startedAt: input.createdAt,
    });
  });
}

function createChildSpec(input: {
  readonly request: WorkSessionChildSpecRequest;
  readonly index: number;
  readonly goalId: string;
  readonly traceId: string;
  readonly createdAt: string;
}): AgentSpec {
  const token = safeToken(input.request.specId, `work-session-child-${input.index + 1}`);
  const allowedTools = input.request.allowedTools.filter((tool) =>
    WORK_SESSION_ALLOWED_TOOLS.includes(tool as (typeof WORK_SESSION_ALLOWED_TOOLS)[number])
  );
  return {
    specId: token,
    agentId: safeToken(input.request.role, `child-agent-${input.index + 1}`),
    displayName: safeText(input.request.displayName, 80),
    agentKind: "child",
    role: safeToken(input.request.role, "work_session_child"),
    protocol: {
      inputs: [{ source: "workspace", key: "task_soil_goal", required: true }],
      outputs: [{ type: "material", payloadSchema: "work_session.child_material.v1" }],
    },
    promptRef: `prompt:work_session.child.${token}.v1`,
    outputContractRef: "work_session.child_material.v1",
    permissions: {
      allowModel: true,
      allowedTools,
      maxModelRounds: 2,
      maxToolRounds: 1,
      fallback: "disabled",
    },
    budget: {
      maxModelRounds: 2,
      maxToolRounds: 1,
      maxOutputRefs: 4,
    },
    inputRefs: unique([`goal:${input.goalId}`, `trace:${input.traceId}`, ...input.request.inputRefs.map((ref) => safeText(ref, 160))]),
    createdAt: input.createdAt,
  };
}

export function createDelegationDecision(input: {
  readonly decision: WorkSessionDecision;
  readonly childRuns: readonly ChildAgentRun[];
  readonly traceId: string;
  readonly modelCallRefs: readonly string[];
}): DelegationDecision {
  return {
    decisionId: createId("delegation"),
    parentAgentId: MANAGER_AGENT_ID,
    action: "spawn_children",
    childSpecIds: input.childRuns.map((child) => child.spec.specId),
    childRunIds: input.childRuns.map((child) => child.childRunId),
    inputRefs: [`trace:${input.traceId}`],
    rationale: safeText(input.decision.decisionSummary, 360),
    uncertainty: safeText(input.decision.uncertainty, 240),
    source: "ai",
    confidence: clampConfidence(input.decision.confidence),
    reasoningTraceRefs: input.modelCallRefs.map((ref) => `model:${ref}`),
    createdAt: nowIso(),
  };
}

export function createParentSynthesis(input: {
  readonly report: CognitiveWorkSessionReport;
  readonly childRuns: readonly ChildAgentRun[];
  readonly traceId: string;
  readonly modelCallRefs: readonly string[];
}): ParentSynthesisResult {
  const synthesisId = createId("parent-synthesis");
  return {
    synthesisId,
    parentAgentId: MANAGER_AGENT_ID,
    childRunIds: input.childRuns.map((child) => child.childRunId),
    inputRefs: [`trace:${input.traceId}`, ...input.childRuns.map((child) => `agent_run:${child.childRunId}`)],
    retainedMaterialRefs: input.childRuns.flatMap((child) => child.outputRefs),
    rejectedMaterialRefs: [],
    conflictRefs: [],
    outputRefs: [`parent-synthesis:${synthesisId}`],
    nextAction: "request_convergence",
    decisionSummary: safeText(input.report.decisionSummary, 360),
    uncertainty: safeText(input.report.uncertainty.join("; "), 360),
    source: "ai",
    confidence: clampConfidence(input.report.confidence),
    reasoningTraceRefs: input.modelCallRefs.map((ref) => `model:${ref}`),
    createdAt: nowIso(),
  };
}
