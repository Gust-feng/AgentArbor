import type { ModelOutputDelta } from "../../domain/intelligence/index.js";
import type { EventLogEntry } from "../../kernel/events/in-memory-event-log.js";
import { redactOrdinaryMarkdownFragment } from "../safe-projection.js";
import type { PanelRunJob, PanelRunJobStore } from "./run-jobs.js";
import type { PanelRunStreamEvent } from "../panel-run-read-model.js";
import { asRecord, optionalString } from "./request-parsers.js";

type PanelRunStreamEventInput = Omit<PanelRunStreamEvent, "sequence">;

export type PanelLiveModelStreamRuntime = {
  readonly runJobs: Pick<PanelRunJobStore, "get" | "appendStreamEvent" | "recordActivity">;
};

export function appendLiveModelOutputDelta(
  runtime: PanelLiveModelStreamRuntime,
  runId: string,
  delta: ModelOutputDelta
): void {
  const safeDelta = redactOrdinaryMarkdownFragment(delta.delta, 8_000);
  if (safeDelta.length === 0) {
    return;
  }
  const job = runtime.runJobs.get(runId);
  if (job === undefined) {
    return;
  }
  const purpose = delta.purpose ?? modelPurposeForRequest(job, delta.requestId);
  if (!isUserFacingStreamingPurpose(job, purpose)) {
    return;
  }
  runtime.runJobs.recordActivity(runId);
  runtime.runJobs.appendStreamEvent(runId, streamEventFromLiveModelDelta(job, delta, safeDelta));
}

function streamEventFromLiveModelDelta(
  job: PanelRunJob,
  delta: ModelOutputDelta,
  safeDelta: string
): PanelRunStreamEventInput {
  const base = {
    eventId: `${job.runId}:live:model.${delta.kind === "reasoning" ? "reasoning" : "output"}.delta:${delta.requestId}:${delta.index}`,
    runId: job.runId,
    createdAt: delta.createdAt,
    delta: safeDelta,
    status: "running" as const,
    sourceRefs: [],
    modelCallRefs: [delta.requestId],
    toolCallRefs: [],
  };
  if (delta.kind === "reasoning") {
    return {
      ...base,
      type: "model.reasoning.delta",
      agentLabel: "模型",
      detail: {
        kind: "thinking",
        preview: safeDelta,
        truncated: false,
      },
    };
  }
  return {
    ...base,
    type: "model.output.delta",
    agentLabel: "助手",
  };
}

function modelPurposeForRequest(job: PanelRunJob, requestId: string): string | undefined {
  const requested = job.runtime?.eventLog.list().find((entry: EventLogEntry) => {
    if (entry.type !== "model.requested") {
      return false;
    }
    return optionalString(asRecord(entry.message.payload).requestId) === requestId;
  });
  return requested === undefined ? undefined : optionalString(asRecord(requested.message.payload).purpose);
}

function isUserFacingStreamingPurpose(job: PanelRunJob, purpose: string | undefined): boolean {
  if (job.runMode === "agent") {
    return purpose === "desktop_agent";
  }
  return purpose === "desktop_agent" ||
    purpose === "work_session_direct_answer" ||
    purpose === "work_session_synthesis";
}
