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
  pushConvergenceRef(refs, payload);
  pushClarificationRequestRef(refs, payload);
  pushCandidatePoolRef(refs, payload);
  pushRootletRefs(refs, payload);

  return refs;
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

function pushClarificationRequestRef(refs: ObservationRef[], payload: Readonly<Record<string, unknown>>): void {
  const clarificationRequest = asRecord(payload.clarificationRequest);
  if (typeof clarificationRequest.requestId === "string") {
    refs.push({ kind: "user_clarification", id: clarificationRequest.requestId });
  }
  const clarificationResponse = asRecord(payload.clarificationResponse);
  if (typeof clarificationResponse.requestId === "string") {
    refs.push({ kind: "user_clarification", id: clarificationResponse.requestId, label: "response" });
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
