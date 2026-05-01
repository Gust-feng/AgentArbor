import type { ArborMessageType } from "../contracts.js";
import type {
  ObservationProgress,
  ObservationRef,
  ObservationScope,
  ObservationSeverity,
  ObservationStatus,
  RunObservationEventEntry,
  RunObservationEventView,
} from "./contracts.js";

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
  return {
    sequence: entry.sequence,
    type: entry.type,
    summary: summarizeEvent(entry.type),
    scope: scopeForEvent(entry.type),
    severity: severityForEvent(entry.type),
    progress: progressForEvent(entry.type, entry.sequence, total),
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

function summarizeEvent(type: ArborMessageType): string {
  switch (type) {
    case "goal.received":
      return "User goal entered the runtime.";
    case "underground.exploration_planned":
      return "Underground Center planned bounded radial exploration.";
    case "rootlet_cluster.started":
      return "Underground rootlet clusters started.";
    case "exploration_candidate.produced":
      return "Rootlets produced exploration candidates.";
    case "candidate_pool.updated":
      return "Candidate pool was updated.";
    case "convergence_review.completed":
      return "Convergence review judged candidate outcomes.";
    case "direction_handoff.completed":
      return "Direction Handoff Package was completed.";
    case "growth_plan.completed":
      return "Aboveground Center completed the Growth Plan.";
    case "workflow.created":
      return "Workflow IR was created.";
    case "task.created":
      return "Executable task was created.";
    case "task.assigned":
      return "Task was assigned to an aboveground worker.";
    case "artifact.produced":
      return "Worker produced an artifact.";
    case "verification.completed":
      return "Verification completed.";
    case "fruit.proposed":
      return "Fruit candidate was proposed.";
    case "governance.review.completed":
      return "Governance review completed.";
    case "run_memory.captured":
      return "Run Memory was captured.";
    case "experience_candidate.proposed":
      return "Experience Candidate was proposed.";
    case "path_bias.suggested":
      return "Path Bias was suggested for future similar runs.";
    case "error.raised":
      return "Runtime raised an error.";
    default:
      return humanizeEventType(type);
  }
}

function scopeForEvent(type: ArborMessageType): ObservationScope {
  if (type === "goal.received") {
    return "soil";
  }
  if (
    type.startsWith("underground.") ||
    type.startsWith("rootlet_") ||
    type.startsWith("exploration_candidate") ||
    type.startsWith("candidate_") ||
    type.startsWith("convergence_review")
  ) {
    return "underground";
  }
  if (type.startsWith("direction_handoff") || type.startsWith("user_approval")) {
    return "handoff";
  }
  if (type.startsWith("growth_plan") || type.startsWith("workflow") || type.startsWith("task")) {
    return "aboveground";
  }
  if (type.startsWith("verification") || type.startsWith("acceptance")) {
    return "verification";
  }
  if (type.startsWith("artifact") || type.startsWith("fruit")) {
    return "fruits";
  }
  if (type.startsWith("governance") || type.startsWith("run_memory") || type.startsWith("experience_candidate")) {
    return "governance";
  }
  if (type.startsWith("path_bias")) {
    return "soil";
  }
  return "runtime";
}

function severityForEvent(type: ArborMessageType): ObservationSeverity {
  if (type === "error.raised") {
    return "error";
  }
  if (type.includes("failed") || type.includes("blocked") || type.includes("rejected")) {
    return "warning";
  }
  if (type.endsWith("revision_requested") || type.endsWith("requested")) {
    return "info";
  }
  return "info";
}

function progressForEvent(type: ArborMessageType, step: number, total?: number): ObservationProgress {
  return {
    status: progressStatusForEvent(type),
    step,
    total,
    label: humanizeEventType(type),
  };
}

function progressStatusForEvent(type: ArborMessageType): ObservationStatus {
  if (type === "error.raised" || type.includes("failed")) {
    return "failed";
  }
  if (type.includes("blocked") || type.includes("rejected")) {
    return "blocked";
  }
  if (type.endsWith("requested") || type.endsWith("started") || type.endsWith("progress")) {
    return "in_progress";
  }
  return "completed";
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
  const directionPackage = asRecord(payload.directionPackage);
  if (typeof directionPackage.packageId === "string") {
    refs.push({
      kind: "direction_package",
      id: directionPackage.packageId,
      version: typeof directionPackage.version === "number" ? directionPackage.version : undefined,
    });
  }
  if (typeof directionPackage.directionId === "string") {
    refs.push({
      kind: "direction_handoff",
      id: directionPackage.directionId,
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

function humanizeEventType(type: ArborMessageType): string {
  return type.replaceAll("_", " ").replaceAll(".", " ");
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  return {};
}
