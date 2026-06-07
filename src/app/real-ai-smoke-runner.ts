import type { ArborMessageType } from "../domain/common.js";
import type { ToolExecutionBroker } from "../domain/tools/index.js";
import type { EventLogEntry } from "../kernel/events/in-memory-event-log.js";
import { createMinimalRuntime, type MinimalRuntime } from "./runtime.js";
import {
  runCognitiveWorkSession,
  type CognitiveWorkSessionResult,
} from "./cognitive-work-session.js";
import {
  createUndergroundAiRuntimeConfig,
  UndergroundAiConfigurationError,
  type UndergroundAiEnvironment,
  type UndergroundAiProviderFetch,
} from "./underground-ai-runtime.js";

export type RealAiSmokeSummary =
  | {
      readonly status: "completed";
      readonly runtime: "cognitive_work_session";
      readonly mode: "openai-compatible";
      readonly traceId: string;
      readonly goalId: string;
      readonly taskSoilId: string;
      readonly workSessionStatus: CognitiveWorkSessionResult["status"];
      readonly artifactId: string;
      readonly reportTitle: string;
      readonly childRunCount: number;
      readonly parentSynthesisCount: number;
      readonly stepActions: readonly string[];
      readonly evidenceRefs: readonly string[];
      readonly modelCallRefs: readonly string[];
      readonly toolCallRefs: readonly string[];
      readonly eventCounts: RealAiSmokeEventCounts;
    }
  | {
      readonly status: "failed";
      readonly runtime: "cognitive_work_session";
      readonly mode: "openai-compatible";
      readonly boundary: "runtime";
      readonly traceId?: string;
      readonly goalId?: string;
      readonly message: string;
      readonly latestModelFailure?: RealAiSmokeModelFailure;
      readonly eventCounts: RealAiSmokeEventCounts;
    }
  | {
      readonly status: "skipped";
      readonly runtime: "cognitive_work_session";
      readonly boundary: "configuration";
      readonly mode: "openai-compatible";
      readonly code: UndergroundAiConfigurationError["issue"]["code"];
      readonly message: string;
      readonly eventCounts: RealAiSmokeEventCounts;
    };

export type RealAiSmokeEventCounts = {
  readonly requested: number;
  readonly completed: number;
  readonly failed: number;
  readonly toolRequested: number;
  readonly toolCompleted: number;
  readonly toolFailed: number;
};

export type RealAiSmokeModelFailure = {
  readonly purpose: string;
  readonly contractId: string;
  readonly failureKind: string;
  readonly validationStatus: string;
  readonly requestId?: string;
  readonly responseId?: string;
};

export type RunRealAiSmokeOptions = {
  readonly env?: UndergroundAiEnvironment;
  readonly providerFetch?: UndergroundAiProviderFetch;
  readonly createToolCenter?: (runtime: MinimalRuntime) => ToolExecutionBroker;
  readonly runtime?: MinimalRuntime;
};

const DEFAULT_GOAL =
  "Analyze the current AgentArbor project and produce a concise optimization report with evidence refs, risks, and next actions.";

export async function runRealAiSmoke(
  goal = DEFAULT_GOAL,
  options: RunRealAiSmokeOptions = {}
): Promise<RealAiSmokeSummary> {
  const runtime = options.runtime ?? createMinimalRuntime();
  try {
    const aiConfig = createUndergroundAiRuntimeConfig({
      mode: "openai-compatible",
      env: options.env,
      fetch: options.providerFetch,
    });

    if (!aiConfig.enabled) {
      return skippedSummary("ai_disabled", "AI disabled; real AI smoke was not started.");
    }

    const result = await runCognitiveWorkSession(goal, {
      aiMode: "openai-compatible",
      runtime,
      aiEnvironment: options.env,
      providerFetch: options.providerFetch,
      createIntelligenceChannel: aiConfig.createIntelligenceChannel,
      createToolCenter: options.createToolCenter ?? aiConfig.createToolCenter,
      taskSoilInput: {
        contextRefs: [
          {
            kind: "project",
            ref: "workspace:current",
            summary: "Current AgentArbor repository, available through safe codebase search/read tools.",
          },
        ],
        permissionBoundaryRefs: ["permission:read-only-workspace"],
      },
    });

    if (result.status !== "completed" || result.finalArtifact === undefined || result.report === undefined) {
      return runtimeFailedSummary({
        runtime,
        traceId: result.traceId,
        goalId: result.goalId,
        message: `Cognitive Work Session ended with status ${result.status}; no completed artifact was produced.`,
      });
    }

    return {
      status: "completed",
      runtime: "cognitive_work_session",
      mode: "openai-compatible",
      traceId: result.traceId,
      goalId: result.goalId,
      taskSoilId: result.taskSoil.taskSoilId,
      workSessionStatus: result.status,
      artifactId: result.finalArtifact.ref.id,
      reportTitle: result.report.title,
      childRunCount: result.agentRunTree.childRuns.length,
      parentSynthesisCount: result.agentRunTree.parentSyntheses.length,
      stepActions: result.steps.map((step) => step.action),
      evidenceRefs: result.evidenceRefs.slice(0, 24),
      modelCallRefs: result.modelCallRefs.slice(0, 24),
      toolCallRefs: result.toolCallRefs.slice(0, 24),
      eventCounts: eventCounts(runtime.eventLog.types()),
    };
  } catch (error) {
    if (error instanceof UndergroundAiConfigurationError) {
      return skippedSummary(error.issue.code, configurationSkipMessage(error.issue.code));
    }
    return runtimeFailedSummary({
      runtime,
      message: error instanceof Error ? error.message : "Cognitive Work Session real AI smoke failed.",
    });
  }
}

function skippedSummary(
  code: UndergroundAiConfigurationError["issue"]["code"],
  message: string
): RealAiSmokeSummary {
  return {
    status: "skipped",
    runtime: "cognitive_work_session",
    boundary: "configuration",
    mode: "openai-compatible",
    code,
    message,
    eventCounts: emptyEventCounts(),
  };
}

function runtimeFailedSummary(input: {
  readonly runtime: MinimalRuntime;
  readonly traceId?: string;
  readonly goalId?: string;
  readonly message: string;
}): RealAiSmokeSummary {
  const events = input.runtime.eventLog.list();
  return {
    status: "failed",
    runtime: "cognitive_work_session",
    mode: "openai-compatible",
    boundary: "runtime",
    traceId: input.traceId,
    goalId: input.goalId,
    message: safeText(input.message, 500),
    latestModelFailure: latestModelFailure(events),
    eventCounts: eventCounts(events.map((entry) => entry.type)),
  };
}

function configurationSkipMessage(code: UndergroundAiConfigurationError["issue"]["code"]): string {
  if (code === "missing_api_key") {
    return "AGENTARBOR_MODEL_API_KEY or OPENAI_API_KEY is required; no provider fetch was attempted.";
  }
  if (code === "missing_model_name") {
    return "AGENTARBOR_MODEL_NAME is required; no provider fetch was attempted.";
  }
  return "AI disabled; real AI smoke was not started.";
}

function latestModelFailure(eventEntries: readonly EventLogEntry[]): RealAiSmokeModelFailure | undefined {
  const latestFailure = [...eventEntries].reverse().find((entry) => entry.type === "model.failed");
  if (latestFailure === undefined) {
    return undefined;
  }
  const failurePayload = asRecord(latestFailure.message.payload);
  const requestId = optionalString(failurePayload.requestId);
  const requestedPayload = requestId === undefined ? {} : modelRequestedPayloadFor(eventEntries, requestId);
  const outputContract = asRecord(requestedPayload.outputContract);
  return {
    purpose: optionalString(requestedPayload.purpose) ?? "unknown",
    contractId: optionalString(outputContract.contractId) ?? "unknown",
    failureKind: optionalString(failurePayload.failureKind) ?? "model_failed",
    validationStatus: optionalString(failurePayload.validationStatus) ?? "unknown",
    requestId,
    responseId: optionalString(failurePayload.responseId),
  };
}

function modelRequestedPayloadFor(eventEntries: readonly EventLogEntry[], requestId: string): Record<string, unknown> {
  const requested = eventEntries.find((entry) => {
    if (entry.type !== "model.requested") {
      return false;
    }
    return optionalString(asRecord(entry.message.payload).requestId) === requestId;
  });
  return requested === undefined ? {} : asRecord(requested.message.payload);
}

function eventCounts(types: readonly ArborMessageType[]): RealAiSmokeEventCounts {
  return {
    requested: types.filter((type) => type === "model.requested").length,
    completed: types.filter((type) => type === "model.completed").length,
    failed: types.filter((type) => type === "model.failed").length,
    toolRequested: types.filter((type) => type === "tool.requested").length,
    toolCompleted: types.filter((type) => type === "tool.completed").length,
    toolFailed: types.filter((type) => type === "tool.failed").length,
  };
}

function emptyEventCounts(): RealAiSmokeEventCounts {
  return {
    requested: 0,
    completed: 0,
    failed: 0,
    toolRequested: 0,
    toolCompleted: 0,
    toolFailed: 0,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function safeText(value: string, maxLength: number): string {
  const normalized = value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:api[_ -]?key|apikey|token|password)\s*[:=]\s*[^;\s"'}\]]+/gi, "$1=[redacted]")
    .trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}
