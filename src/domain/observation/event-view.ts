import { isToolLifecycleMessageType, type ArborMessageType } from "../common.js";
import type {
  ObservationProgress,
  ObservationRef,
  RunObservationEventEntry,
  RunObservationEventView,
} from "./contracts.js";
import { getEventObservationMetadata } from "./event-metadata.js";

export function createRunObservationEventViews(
  entries: readonly RunObservationEventEntry[]
): readonly RunObservationEventView[] {
  const total = entries.length;
  return entries.map((entry) => createRunObservationEventView(entry, total));
}

export function createRunObservationEventView(
  entry: RunObservationEventEntry,
  total?: number
): RunObservationEventView {
  const metadata = getEventObservationMetadata(entry.type);
  return {
    sequence: entry.sequence,
    type: entry.type,
    summary: metadata.summary,
    scope: metadata.scope,
    severity: metadata.severity,
    progress: progressForEvent(metadata.progress, entry.sequence, total),
    refs: refsForEvent(entry),
    traceId: entry.message.traceId,
    taskId: entry.message.taskId,
    intent: entry.message.intent,
    from: { ...entry.message.from },
    to: entry.message.to === undefined ? undefined : { ...entry.message.to },
    createdAt: entry.message.createdAt,
    recordedAt: entry.recordedAt,
  };
}

function progressForEvent(
  progress: Pick<ObservationProgress, "status" | "label">,
  step: number,
  total?: number
): ObservationProgress {
  return {
    status: progress.status,
    step,
    total,
    label: progress.label,
  };
}

function refsForEvent(entry: RunObservationEventEntry): ObservationRef[] {
  const refs: ObservationRef[] = [
    { kind: "trace", id: entry.message.traceId },
    { kind: "event", id: String(entry.sequence), label: entry.type },
  ];
  if (entry.message.taskId !== undefined) {
    refs.push({ kind: "task", id: entry.message.taskId });
  }
  for (const artifact of entry.message.artifacts ?? []) {
    refs.push({ kind: "artifact", id: artifact.id, label: artifact.type, version: artifact.version });
  }

  const payload = asRecord(entry.message.payload);
  pushStringRef(refs, payload, "goalId", "goal");
  pushObjectIdRef(refs, payload, "growthPlan", "growth_plan");
  pushObjectIdRef(refs, payload, "workflow", "workflow");
  pushObjectIdRef(refs, payload, "task", "task");
  pushObjectIdRef(refs, payload, "verification", "verification");
  pushObjectIdRef(refs, payload, "fruit", "fruit");
  pushObjectIdRef(refs, payload, "runMemory", "run_memory");
  pushObjectIdRef(refs, payload, "experienceCandidate", "experience_candidate");
  pushObjectIdRef(refs, payload, "pathBias", "path_bias");
  pushPackageRef(refs, payload);
  pushAutonomyRef(refs, payload);
  pushConvergenceRef(refs, payload);
  pushModelCallRefs(refs, entry.type, payload);
  pushToolCallRefs(refs, entry.type, payload);
  pushSubAgentRefs(refs, entry.type, payload);
  pushAgentFabricRefs(refs, payload);
  pushClarificationRequestRef(refs, entry.type, payload);
  pushCandidatePoolRef(refs, payload);
  pushRootletRefs(refs, payload);

  return refs;
}

function pushAutonomyRef(refs: ObservationRef[], payload: Readonly<Record<string, unknown>>): void {
  const autonomyDecision = asRecord(payload.autonomyDecision);
  if (typeof autonomyDecision.decisionId === "string") {
    refs.push({ kind: "autonomy_decision", id: autonomyDecision.decisionId });
  }
  const autonomyDecisionId = payload.autonomyDecisionId;
  if (typeof autonomyDecisionId === "string") {
    refs.push({ kind: "autonomy_decision", id: autonomyDecisionId });
  }
}

function pushStringRef(
  refs: ObservationRef[],
  payload: Readonly<Record<string, unknown>>,
  key: string,
  kind: ObservationRef["kind"]
): void {
  const value = payload[key];
  if (typeof value === "string") {
    refs.push({ kind, id: value });
  }
}

function pushObjectIdRef(
  refs: ObservationRef[],
  payload: Readonly<Record<string, unknown>>,
  key: string,
  kind: ObservationRef["kind"]
): void {
  const value = asRecord(payload[key]);
  if (typeof value.id === "string") {
    refs.push({ kind, id: value.id });
  }
}

function pushModelCallRefs(
  refs: ObservationRef[],
  type: ArborMessageType,
  payload: Readonly<Record<string, unknown>>
): void {
  if (type !== "model.requested" && type !== "model.completed" && type !== "model.failed") {
    return;
  }
  pushStringRef(refs, payload, "requestId", "model_call");
  pushStringRef(refs, payload, "responseId", "model_call");
}

function pushToolCallRefs(
  refs: ObservationRef[],
  type: ArborMessageType,
  payload: Readonly<Record<string, unknown>>
): void {
  if (!isToolLifecycleMessageType(type)) {
    return;
  }
  pushStringRef(refs, payload, "callId", "tool_call");
}

function pushSubAgentRefs(
  refs: ObservationRef[],
  type: ArborMessageType,
  payload: Readonly<Record<string, unknown>>
): void {
  if (
    type !== "sub_agent.started" &&
    type !== "sub_agent.completed" &&
    type !== "sub_agent_batch.started" &&
    type !== "sub_agent_batch.completed"
  ) {
    return;
  }
  pushStringRef(refs, payload, "subRunId", "sub_agent_run");
  pushStringRef(refs, payload, "batchId", "sub_agent_batch");
}

function pushAgentFabricRefs(refs: ObservationRef[], payload: Readonly<Record<string, unknown>>): void {
  pushStringRef(refs, payload, "specId", "agent_spec");
  pushStringRef(refs, payload, "childRunId", "agent_run");
  pushStringRef(refs, payload, "decisionId", "agent_delegation");
  pushStringRef(refs, payload, "synthesisId", "parent_synthesis");

  const agentSpec = asRecord(payload.agentSpec);
  if (typeof agentSpec.specId === "string") {
    refs.push({ kind: "agent_spec", id: agentSpec.specId, label: stringLabel(agentSpec.displayName) });
  }
  const childRun = asRecord(payload.childRun);
  if (typeof childRun.childRunId === "string") {
    refs.push({ kind: "agent_run", id: childRun.childRunId, label: stringLabel(childRun.status) });
  }
  const delegationDecision = asRecord(payload.delegationDecision);
  if (typeof delegationDecision.decisionId === "string") {
    refs.push({ kind: "agent_delegation", id: delegationDecision.decisionId, label: stringLabel(delegationDecision.action) });
  }
  const parentSynthesis = asRecord(payload.parentSynthesis);
  if (typeof parentSynthesis.synthesisId === "string") {
    refs.push({ kind: "parent_synthesis", id: parentSynthesis.synthesisId, label: stringLabel(parentSynthesis.nextAction) });
  }
  const agentRunTree = asRecord(payload.agentRunTree);
  if (typeof agentRunTree.treeId === "string") {
    refs.push({ kind: "agent_run", id: agentRunTree.treeId, label: "run_tree" });
  }

  const childRuns = payload.childRuns;
  if (Array.isArray(childRuns)) {
    for (const value of childRuns) {
      const run = asRecord(value);
      if (typeof run.childRunId === "string") {
        refs.push({ kind: "agent_run", id: run.childRunId, label: stringLabel(run.status) });
      }
    }
  }
}

function pushPackageRef(refs: ObservationRef[], payload: Readonly<Record<string, unknown>>): void {
  for (const key of [
    "directionPackage",
    "previousDirectionPackage",
    "approvedDirectionPackage",
    "awaitingUserDirectionPackage",
  ]) {
    pushPackageRefFromValue(refs, payload[key], key);
  }
}

function pushPackageRefFromValue(refs: ObservationRef[], value: unknown, label: string): void {
  const directionPackage = asRecord(value);
  if (typeof directionPackage.packageId === "string") {
    refs.push({
      kind: "direction_package",
      id: directionPackage.packageId,
      label,
      version: typeof directionPackage.version === "number" ? directionPackage.version : undefined,
    });
  }
  if (typeof directionPackage.directionId === "string") {
    refs.push({
      kind: "direction_handoff",
      id: directionPackage.directionId,
      label,
      version: typeof directionPackage.version === "number" ? directionPackage.version : undefined,
    });
  }
}

function pushConvergenceRef(refs: ObservationRef[], payload: Readonly<Record<string, unknown>>): void {
  const convergenceReport = asRecord(payload.convergenceReport);
  if (typeof convergenceReport.reviewId === "string") {
    refs.push({ kind: "convergence_review", id: convergenceReport.reviewId });
  }
}

function pushClarificationRequestRef(
  refs: ObservationRef[],
  type: ArborMessageType,
  payload: Readonly<Record<string, unknown>>
): void {
  const clarificationRequest = asRecord(payload.clarificationRequest);
  if (typeof clarificationRequest.requestId === "string") {
    refs.push({ kind: "user_clarification", id: clarificationRequest.requestId });
  }
  const clarificationResponse = asRecord(payload.clarificationResponse);
  if (typeof clarificationResponse.requestId === "string") {
    refs.push({ kind: "user_clarification", id: clarificationResponse.requestId, label: "response" });
  }
  if (type !== "user_approval.received" && type !== "direction_handoff.revision_requested") {
    return;
  }
  const requestId = payload.requestId;
  if (typeof requestId === "string") {
    refs.push({ kind: "user_clarification", id: requestId });
  }
}

function pushCandidatePoolRef(refs: ObservationRef[], payload: Readonly<Record<string, unknown>>): void {
  const candidatePool = asRecord(payload.candidatePool);
  if (typeof candidatePool.poolId === "string") {
    refs.push({ kind: "candidate_pool", id: candidatePool.poolId });
  }
}

function pushRootletRefs(refs: ObservationRef[], payload: Readonly<Record<string, unknown>>): void {
  const rootletClusters = payload.rootletClusters;
  if (!Array.isArray(rootletClusters)) {
    return;
  }
  for (const rootletCluster of rootletClusters) {
    const cluster = asRecord(rootletCluster);
    if (typeof cluster.clusterId === "string") {
      refs.push({ kind: "rootlet", id: cluster.clusterId });
    }
  }
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  return {};
}

function stringLabel(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
