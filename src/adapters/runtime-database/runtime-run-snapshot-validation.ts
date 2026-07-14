import { ARBOR_MESSAGE_TYPES } from "../../domain/common.js";
import {
  RUNTIME_RUN_MANIFEST_SCHEMA_VERSION,
  RUNTIME_RUN_SNAPSHOT_SCHEMA_VERSION,
} from "../../domain/runtime-database/index.js";
import type {
  RuntimeRunManifest,
  RuntimeRunRecord,
  RuntimeRunSnapshotContent,
  RuntimeRunSnapshotDocument,
  RuntimeRunSummaryRecord,
} from "../../domain/runtime-database/index.js";

export type RuntimeSnapshotValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

const RUN_STATUSES = new Set([
  "pending", "running", "approval_needed", "needs_input", "completed", "failed", "stopped", "cancelled", "blocked",
]);
const CONTINUATION_AVAILABILITIES = new Set(["none", "live", "lost_after_restart", "new_turn"]);
const ARBOR_TYPES = new Set<string>(ARBOR_MESSAGE_TYPES);

export function validateRuntimeRunManifest(
  value: unknown,
  expectedRunId: string,
): RuntimeSnapshotValidationResult<RuntimeRunManifest> {
  const record = object(value);
  if (record === undefined) return invalid("manifest must be an object");
  if (record.schemaVersion !== RUNTIME_RUN_MANIFEST_SCHEMA_VERSION) return invalid("manifest schemaVersion is invalid");
  if (!positiveInteger(record.revision)) return invalid("manifest revision is invalid");
  if (record.snapshotRef !== `snapshots/${record.revision}.json`) return invalid("manifest snapshot reference is invalid");
  if (!runSummary(record.run) || record.run.runId !== expectedRunId) return invalid("manifest run summary is invalid");
  return valid(value as RuntimeRunManifest);
}

export function validateRuntimeRunSnapshotDocument(
  value: unknown,
  expectedRunId: string,
  manifest: RuntimeRunManifest,
): RuntimeSnapshotValidationResult<RuntimeRunSnapshotDocument> {
  const record = object(value);
  if (record === undefined) return invalid("snapshot document must be an object");
  if (record.schemaVersion !== RUNTIME_RUN_SNAPSHOT_SCHEMA_VERSION) return invalid("snapshot schemaVersion is invalid");
  if (!positiveInteger(record.revision) || record.revision !== manifest.revision) {
    return invalid("snapshot revision does not match the manifest");
  }
  const contentValidation = validateRuntimeRunSnapshotContent(record.content, expectedRunId);
  if (!contentValidation.ok) return contentValidation;
  const content = contentValidation.value;
  if (!sameSummary(manifest.run, runtimeRunSummary(content.run))) {
    return invalid("manifest run summary does not match snapshot content");
  }
  return valid(value as RuntimeRunSnapshotDocument);
}

export function validateRuntimeRunSnapshotContent(
  value: unknown,
  expectedRunId?: string,
): RuntimeSnapshotValidationResult<RuntimeRunSnapshotContent> {
  if (!snapshotContent(value)) return invalid("snapshot content shape or enum value is invalid");
  const content = value;
  const runId = content.run.runId;
  if (expectedRunId !== undefined && runId !== expectedRunId) return invalid("snapshot run identity is invalid");
  if (content.workspace !== undefined && (
    content.workspace.workspaceId !== content.run.workspaceId ||
    content.workspace.path !== content.run.workspacePath
  )) return invalid("workspace identity does not match the run");
  if (content.events.some((item) => item.runId !== runId)) return invalid("events contain another runId");
  if (content.modelCalls.some((item) => item.runId !== runId)) return invalid("modelCalls contain another runId");
  if (content.toolCalls.some((item) => item.runId !== runId)) return invalid("toolCalls contain another runId");
  if (content.artifacts.some((item) => item.runId !== runId)) return invalid("artifacts contain another runId");
  if (content.confirmations.some((item) => item.runId !== runId)) return invalid("confirmations contain another runId");
  if (content.subAgentRuns.some((item) => item.parentRunId !== undefined && item.parentRunId !== runId)) {
    return invalid("subAgentRuns contain another parentRunId");
  }
  if (content.contextLedger !== undefined && content.contextLedger.runId !== runId) {
    return invalid("contextLedger runId is invalid");
  }
  return valid(content);
}

export function runtimeRunSummary(run: RuntimeRunRecord): RuntimeRunSummaryRecord {
  return {
    runId: run.runId,
    profile: run.profile,
    runKind: run.runKind,
    runMode: run.runMode,
    status: run.status,
    goalSummary: run.goalSummary,
    aiMode: run.aiMode,
    workspaceId: run.workspaceId,
    workspacePath: run.workspacePath,
    conversationId: run.conversationId,
    appHome: run.appHome,
    runHome: run.runHome,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    completedAt: run.completedAt,
    resultTitle: run.resultTitle,
    resultSummary: run.resultSummary,
    stopReason: run.stopReason,
    continuationAvailability: run.continuationAvailability,
    error: run.error,
  };
}

function snapshotContent(value: unknown): value is RuntimeRunSnapshotContent {
  const content = object(value);
  if (content === undefined || !runRecord(content.run)) return false;
  if (content.workspace !== undefined && !workspace(content.workspace)) return false;
  return eventArray(content.events, (item) => runtimeEvent(item)) &&
    eventArray(content.modelCalls, (item) => modelCall(item)) &&
    eventArray(content.toolCalls, (item) => toolCall(item)) &&
    eventArray(content.artifacts, (item) => runIdRecord(item)) &&
    eventArray(content.confirmations, (item) => confirmation(item)) &&
    eventArray(content.subAgentRuns, (item) => subAgentRun(item)) &&
    (content.contextLedger === undefined || contextLedger(content.contextLedger));
}

function runRecord(value: unknown): value is RuntimeRunRecord {
  const run = object(value);
  if (run === undefined || !runSummary(run)) return false;
  const fullRun = run as RuntimeRunRecord;
  return optionalString(fullRun.traceId) && optionalString(fullRun.goalId) && optionalString(fullRun.resultAnswer) &&
    optionalObject(fullRun.agentDefinitionRef) && optionalObject(fullRun.capabilitySnapshot) &&
    optionalObject(fullRun.capabilityResolution) && optionalObject(fullRun.informationAccess);
}

function runSummary(value: unknown): value is RuntimeRunSummaryRecord {
  const run = object(value);
  return run !== undefined && nonEmpty(run.runId) &&
    enumValue(run.profile, new Set(["lite", "full"])) &&
    enumValue(run.runKind, new Set(["desktop", "underground"])) &&
    enumValue(run.runMode, new Set(["agent", "deep"])) &&
    enumValue(run.status, RUN_STATUSES) && typeof run.goalSummary === "string" &&
    enumValue(run.aiMode, new Set(["none", "fake", "openai-compatible", "openai-responses"])) &&
    nonEmpty(run.appHome) && nonEmpty(run.runHome) && nonEmpty(run.createdAt) && nonEmpty(run.updatedAt) &&
    optionalString(run.workspaceId) && optionalString(run.workspacePath) && optionalString(run.conversationId) &&
    optionalString(run.completedAt) && optionalString(run.resultTitle) && optionalString(run.resultSummary) &&
    optionalString(run.stopReason) && optionalEnum(run.continuationAvailability, CONTINUATION_AVAILABILITIES) &&
    optionalError(run.error);
}

function workspace(value: unknown): boolean {
  const item = object(value);
  return item !== undefined && nonEmpty(item.workspaceId) && item.kind === "local_directory" &&
    nonEmpty(item.path) && typeof item.label === "string" && nonEmpty(item.selectedAt) && nonEmpty(item.updatedAt);
}

function subAgentRun(value: unknown): boolean {
  const item = object(value);
  return item !== undefined && nonEmpty(item.subRunId) && optionalString(item.parentRunId) &&
    enumValue(item.status, new Set(["completed", "failed", "approval_required", "cancelled"])) &&
    Array.isArray(item.modelExchanges) && Array.isArray(item.toolTraces);
}

function contextLedger(value: unknown): boolean {
  const ledger = object(value);
  return ledger !== undefined && nonEmpty(ledger.runId) && typeof ledger.summary === "string" &&
    Array.isArray(ledger.entries) && object(ledger.truncation) !== undefined;
}

function runtimeEvent(value: unknown): boolean {
  const event = object(value);
  const progress = object(event?.progress);
  return event !== undefined && progress !== undefined && nonEmpty(event.runId) && integer(event.sequence) &&
    enumValue(event.type, ARBOR_TYPES) && enumValue(event.scope, new Set([
      "runtime", "soil", "underground", "handoff", "aboveground", "verification", "fruits", "governance",
    ])) && enumValue(event.severity, new Set(["info", "warning", "error", "critical"])) &&
    enumValue(progress.status, new Set(["not_started", "pending", "in_progress", "completed", "blocked", "failed", "cancelled", "skipped"]));
}

function modelCall(value: unknown): boolean {
  const call = object(value);
  return call !== undefined && nonEmpty(call.runId) && nonEmpty(call.requestId) &&
    enumValue(call.status, new Set(["requested", "completed", "failed"]));
}

function toolCall(value: unknown): boolean {
  const call = object(value);
  return call !== undefined && nonEmpty(call.runId) && nonEmpty(call.callId) &&
    enumValue(call.status, new Set(["requested", "approval_required", "completed", "failed", "cancelled"]));
}

function confirmation(value: unknown): boolean {
  const item = object(value);
  return item !== undefined && nonEmpty(item.runId) && nonEmpty(item.confirmationId) &&
    enumValue(item.status, new Set(["pending", "approved", "denied", "guidance"])) &&
    enumValue(item.riskLevel, new Set(["low", "medium", "high"]));
}

function runIdRecord(value: unknown): value is { readonly runId: string } {
  const item = object(value);
  return item !== undefined && nonEmpty(item.runId);
}

function sameSummary(left: RuntimeRunSummaryRecord, right: RuntimeRunSummaryRecord): boolean {
  const fields: readonly (keyof RuntimeRunSummaryRecord)[] = [
    "runId", "profile", "runKind", "runMode", "status", "goalSummary", "aiMode", "workspaceId", "workspacePath",
    "conversationId", "appHome", "runHome", "createdAt", "updatedAt", "completedAt", "resultTitle", "resultSummary",
    "stopReason", "continuationAvailability",
  ];
  return fields.every((field) => left[field] === right[field]) &&
    (left.error === undefined || right.error === undefined
      ? left.error === right.error
      : left.error.code === right.error.code && left.error.message === right.error.message && left.error.errorDomain === right.error.errorDomain);
}

function optionalError(value: unknown): boolean {
  if (value === undefined) return true;
  const error = object(value);
  return error !== undefined && nonEmpty(error.code) && typeof error.message === "string";
}

function eventArray(value: unknown, predicate: (item: unknown) => boolean): boolean {
  return Array.isArray(value) && value.every(predicate);
}

function object(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

function optionalObject(value: unknown): boolean { return value === undefined || object(value) !== undefined; }
function optionalString(value: unknown): boolean { return value === undefined || typeof value === "string"; }
function optionalEnum(value: unknown, values: ReadonlySet<string>): boolean {
  return value === undefined || enumValue(value, values);
}
function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function integer(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value) && value >= 0; }
function positiveInteger(value: unknown): value is number { return integer(value) && value > 0; }
function enumValue(value: unknown, values: ReadonlySet<string>): value is string { return typeof value === "string" && values.has(value); }
function valid<T>(value: T): RuntimeSnapshotValidationResult<T> { return { ok: true, value }; }
function invalid<T>(reason: string): RuntimeSnapshotValidationResult<T> { return { ok: false, reason }; }
