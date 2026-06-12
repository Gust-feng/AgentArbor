import type { FileSystemRuntimeDatabasePaths } from "../../adapters/runtime-database/index.js";
import type { RuntimeDatabase } from "../../domain/runtime-database/index.js";
import type { BasicAgentRunExecutor } from "../basic-agent-runtime/index.js";
import type { PanelConversationReadModel } from "../panel-conversations.js";
import { toRuntimeConversationRecord } from "../panel-conversations.js";
import { panelRunPayloadForStatus, PanelRunJobStore, type PanelRunJob } from "../panel-run-jobs.js";
import { createPanelRunTrace, createPanelRunTranscript } from "../panel-run-read-model.js";
import { createLiveBasicAgentWorkViewReadModel } from "./basic-agent-read-models.js";
import {
  enqueuePanelPersistence,
  enqueuePanelPersistenceBackground,
  type PanelPersistenceChains,
} from "./persistence.js";
import {
  createRuntimeRunRecord,
  createRuntimeWorkspaceRecord,
  toRuntimeArtifactRecords,
  toRuntimeConfirmationRecords,
  toRuntimeEventRecord,
  toRuntimeModelCallRecord,
  toRuntimeToolCallRecords,
} from "./runtime-records.js";
import { syncPanelRunStreamEventsForJob } from "./run-stream-sync.js";

export type PanelRunPersistenceRuntime = {
  readonly runJobs: PanelRunJobStore;
  readonly runExecutor: Pick<BasicAgentRunExecutor, "get" | "replayEvents" | "syncRunEvents">;
  readonly conversations: {
    getReadModel(conversationId: string): PanelConversationReadModel | undefined;
  };
  readonly persistenceChains: PanelPersistenceChains;
  readonly runtimeDatabase?: RuntimeDatabase;
  readonly runtimePaths?: FileSystemRuntimeDatabasePaths;
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
  enqueuePanelPersistenceBackground(runtime.persistenceChains, job.runId, () => persistPanelRunNow(runtime, job));
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
  const workspaceRecord = workspace === undefined ? undefined : createRuntimeWorkspaceRecord(workspace, job.updatedAt);
  if (workspaceRecord !== undefined) {
    await runtime.runtimeDatabase.upsertWorkspace(workspaceRecord);
  }
  await runtime.runtimeDatabase.upsertRun(createRuntimeRunRecord({
    job,
    workspace: workspaceRecord,
    appHome: runtime.runtimePaths.appHome,
    runtimeHome: runtime.runtimePaths.runtimeHome,
  }));

  const eventEntries = job.runtime?.eventLog.list() ?? [];
  const trace = createPanelRunTrace({
    status: job.status,
    runMode: job.runMode,
    projection: "runtime",
    eventEntries,
  });
  const statusPayload = panelRunPayloadForStatus(job);
  const transcriptPayload = statusPayload === undefined || !("observation" in statusPayload) ? undefined : statusPayload;
  const streamEvents = syncPanelRunStreamEventsForJob(runtime, job);
  const basicRun = runtime.runExecutor.get(job.runId);
  const basicReplay = runtime.runExecutor.replayEvents(job.runId, 0);
  const transcript = createPanelRunTranscript({
    runId: job.runId,
    status: job.status,
    eventEntries,
    summary: transcriptPayload?.summary,
    observation: transcriptPayload?.observation,
    agentRunTree: transcriptPayload?.agentRunTree,
    desktopMode: job.runKind === "desktop" ? job.runMode : undefined,
    reasoningEffort: job.reasoningEffort,
    agentDefinitionRef: job.agentDefinitionRef,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
  if (basicRun !== undefined) {
    await runtime.runtimeDatabase.upsertBasicRun(basicRun);
  }
  if (basicReplay !== undefined) {
    await runtime.runtimeDatabase.replaceBasicRunEvents(job.runId, basicReplay.events);
  }
  if (basicRun !== undefined && basicReplay !== undefined) {
    await runtime.runtimeDatabase.upsertContextLedger(
      createLiveBasicAgentWorkViewReadModel({
        job,
        run: basicRun,
        events: basicReplay.events,
        streamEvents,
      }).contextLedger
    );
  }
  await runtime.runtimeDatabase.replaceRunEvents(job.runId, trace.events.map((event) => toRuntimeEventRecord(job.runId, event)));
  await runtime.runtimeDatabase.replaceModelCalls(
    job.runId,
    transcript.modelCalls.map((call) => toRuntimeModelCallRecord(job.runId, call))
  );
  await runtime.runtimeDatabase.replaceToolCalls(job.runId, toRuntimeToolCallRecords(job.runId, streamEvents, eventEntries));
  await runtime.runtimeDatabase.replaceArtifacts(job.runId, toRuntimeArtifactRecords(job));
  await runtime.runtimeDatabase.replaceConfirmations(job.runId, toRuntimeConfirmationRecords(job, eventEntries));
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
