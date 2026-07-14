import type { FileSystemRuntimeDatabasePaths } from "../../adapters/runtime-database/index.js";
import type { RuntimeDatabase, RuntimeRunSnapshotContent } from "../../domain/runtime-database/index.js";
import type { ToolErrorFacts } from "../../domain/tools/index.js";
import { createId, nowIso } from "../../kernel/id.js";
import type { PanelConversationReadModel } from "../panel-conversation/panel-conversations.js";
import { toRuntimeConversationRecord } from "../panel-conversation/panel-conversations.js";
import { panelRunPayloadForStatus, PanelRunJobStore, type PanelRunJob } from "./run-jobs.js";
import { createPanelRunTrace, createPanelRunTranscript } from "../panel-run-read-model.js";
import {
  enqueuePanelPersistence,
  enqueuePanelPersistenceBackground,
  type PanelPersistenceChains,
} from "./persistence.js";
import {
  createRuntimeRunRecord,
  createRuntimeWorkspaceRecord,
  compactRuntimeText,
  toRuntimeArtifactRecords,
  toRuntimeConfirmationRecords,
  toRuntimeEventRecord,
  toRuntimeModelCallRecord,
  toRuntimeToolCallRecords,
} from "./runtime-records.js";
import { persistentPanelRunStreamEvents } from "./run-stream-sync.js";

export type PanelRunPersistenceRuntime = {
  readonly runJobs: PanelRunJobStore;
  readonly conversations: {
    getReadModel(conversationId: string): PanelConversationReadModel | undefined;
  };
  readonly persistenceChains: PanelPersistenceChains;
  readonly runtimeDatabase?: RuntimeDatabase;
  readonly runtimePaths?: FileSystemRuntimeDatabasePaths;
};

type PanelPersistenceFailureFacts = ToolErrorFacts & {
  readonly code: string;
  readonly message: string;
  readonly errorDomain: "runtime_error";
  readonly operation: "persist_panel_run";
  readonly runId: string;
  readonly runMode: PanelRunJob["runMode"];
  readonly runKind: PanelRunJob["runKind"];
  readonly retriable: true;
  readonly name: string | null;
};

export async function persistPanelRun(
  runtime: PanelRunPersistenceRuntime,
  job: PanelRunJob
): Promise<void> {
  if (runtime.runtimeDatabase === undefined || runtime.runtimePaths === undefined) {
    return;
  }
  await enqueuePanelPersistence(runtime.persistenceChains, job.runId, () => persistPanelRunNow(runtime, job));
}

export function persistPanelRunInBackground(
  runtime: PanelRunPersistenceRuntime,
  job: PanelRunJob
): void {
  if (runtime.runtimeDatabase === undefined || runtime.runtimePaths === undefined) {
    return;
  }
  enqueuePanelPersistenceBackground(
    runtime.persistenceChains,
    job.runId,
    () => persistPanelRunNow(runtime, job),
    (error) => recordBackgroundPersistenceFailure(runtime, job, error)
  );
}

export async function persistPanelConversation(
  runtime: PanelRunPersistenceRuntime,
  conversationId: string
): Promise<void> {
  await enqueuePanelPersistence(runtime.persistenceChains, `conversation:${conversationId}`, () =>
    persistPanelConversationNow(runtime, conversationId)
  );
}

async function persistPanelRunNow(
  runtime: PanelRunPersistenceRuntime,
  job: PanelRunJob
): Promise<void> {
  if (runtime.runtimeDatabase === undefined || runtime.runtimePaths === undefined) {
    return;
  }
  if (job.conversationId !== undefined) {
    await persistPanelConversation(runtime, job.conversationId);
  }
  const workspace = job.capabilitySnapshot?.workspace;
  const workspaceRecord = workspace === undefined ? undefined : createRuntimeWorkspaceRecord(workspace, job.updatedAt, job.runId);
  const run = createRuntimeRunRecord({
    job,
    workspace: workspaceRecord,
    appHome: runtime.runtimePaths.appHome,
    runtimeHome: runtime.runtimePaths.runtimeHome,
  });

  const eventEntries = job.runtime?.eventLog.list() ?? [];
  const trace = createPanelRunTrace({
    status: job.status,
    runMode: job.runMode,
    projection: "runtime",
    eventEntries,
  });
  const statusPayload = panelRunPayloadForStatus(job);
  const transcriptPayload = statusPayload === undefined || !("observation" in statusPayload) ? undefined : statusPayload;
  const streamEvents = persistentPanelRunStreamEvents(job.streamEvents);
  const transcript = createPanelRunTranscript({
    runId: job.runId,
    status: job.status,
    eventEntries,
    streamEvents,
    summary: transcriptPayload?.summary,
    observation: transcriptPayload?.observation,
    agentRunTree: transcriptPayload?.agentRunTree,
    desktopMode: job.runKind === "desktop" ? job.runMode : undefined,
    reasoningEffort: job.reasoningEffort,
    agentDefinitionRef: job.agentDefinitionRef,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
  const eventEntriesBySequence = new Map(eventEntries.map((entry) => [entry.sequence, entry]));
  const snapshot: RuntimeRunSnapshotContent = {
    run,
    workspace: workspaceRecord,
    events: trace.events.map((event) => toRuntimeEventRecord(
      job.runId,
      event,
      eventEntriesBySequence.get(event.sequence),
    )),
    modelCalls: transcript.modelCalls.map((call) => toRuntimeModelCallRecord(job.runId, call)),
    toolCalls: toRuntimeToolCallRecords(job.runId, streamEvents, eventEntries),
    artifacts: toRuntimeArtifactRecords(job),
    confirmations: toRuntimeConfirmationRecords(job, eventEntries),
    subAgentRuns: job.runtime?.subAgentRunTraceStore.list() ?? [],
    ordinaryModelContext: statusPayload?.ordinaryModelContext,
  };
  await runtime.runtimeDatabase.saveRunSnapshot(snapshot);
}

async function persistPanelConversationNow(
  runtime: PanelRunPersistenceRuntime,
  conversationId: string
): Promise<void> {
  const conversation = runtime.conversations.getReadModel(conversationId);
  if (conversation === undefined || runtime.runtimeDatabase === undefined) {
    return;
  }
  await runtime.runtimeDatabase.upsertConversation(toRuntimeConversationRecord(conversation));
}

function recordBackgroundPersistenceFailure(
  runtime: PanelRunPersistenceRuntime,
  job: PanelRunJob,
  error: unknown
): void {
  const failure = persistenceFailureFacts(job, error);
  console.error(
    `[panel-server] background persistence failed for ${job.runId}: ${failure.message}`,
    error
  );
  const createdAt = nowIso();
  runtime.runJobs.appendStreamEvent(job.runId, {
    eventId: `${job.runId}:persistence.failed:${createId("diagnostic")}`,
    runId: job.runId,
    type: "agent.note.completed",
    createdAt,
    agentLabel: "运行诊断",
    summary: `后台持久化失败：${failure.message}`,
    status: "failed",
    detail: {
      kind: "work",
      action: "后台持久化",
      preview: failure.message,
      error: failure.message,
      errorDomain: "runtime_error",
      errorFacts: failure,
    },
    sourceRefs: ["runtime:persistence"],
    modelCallRefs: [],
    toolCallRefs: [],
  });
}

function persistenceFailureFacts(
  job: PanelRunJob,
  error: unknown
): PanelPersistenceFailureFacts {
  const record = errorRecord(error);
  const code = compactRuntimeText(record.code ?? "panel_persistence_failed", 160);
  const message = compactRuntimeText(record.message ?? "后台持久化失败。", 900);
  return {
    code,
    message,
    errorDomain: "runtime_error",
    operation: "persist_panel_run",
    runId: job.runId,
    runMode: job.runMode,
    runKind: job.runKind,
    retriable: true,
    name: record.name === undefined ? null : compactRuntimeText(record.name, 160),
  };
}

function errorRecord(error: unknown): {
  readonly code?: string;
  readonly message?: string;
  readonly name?: string;
} {
  if (error instanceof Error) {
    return {
      code: stringFromUnknown((error as { readonly code?: unknown }).code),
      message: error.message,
      name: error.name,
    };
  }
  const record = asUnknownRecord(error);
  return {
    code: stringFromUnknown(record.code),
    message: stringFromUnknown(record.message) ?? stringFromUnknown(error),
    name: stringFromUnknown(record.name),
  };
}

function asUnknownRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function stringFromUnknown(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}
