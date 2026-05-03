import type { ArborMessageType } from "../domain/common.js";
import type {
  DirectionHandoffPackage,
  DirectionHandoffPackageLineage,
  DirectionHandoffPackageValidationResult,
} from "../domain/agentarbor/direction-handoff-package/contracts.js";
import type { ObservationStatus, RunPhase, RunStage } from "../domain/observation/contracts.js";
import type {
  CandidatePoolCounts,
  ExplorationBudget,
  RootletClusterKind,
  UndergroundConvergenceOutcome,
  UserClarificationReason,
} from "../domain/underground/index.js";
import type {
  UndergroundDirectionSessionResult,
  UndergroundDirectionSessionTerminalStatus,
} from "./underground-direction-session.js";
import type { UndergroundDirectionSessionRecoveryResult } from "./underground-direction-recovery.js";

type DirectionPackageSummary = {
  readonly id: string;
  readonly directionId: string;
  readonly version: number;
  readonly status: string;
  readonly validation: Pick<DirectionHandoffPackageValidationResult, "passed" | "errors" | "warnings">;
};

export type UndergroundDemoSummary = {
  readonly terminalStatus: UndergroundDirectionSessionTerminalStatus;
  readonly directionPackage: DirectionPackageSummary;
  readonly recoveredPackage?: DirectionPackageSummary;
  readonly lineage: DirectionHandoffPackageLineage;
  readonly versions: readonly number[];
  readonly writtenPackagePath?: string;
  readonly ai: UndergroundDemoAiSummary;
  readonly underground: {
    readonly rootletKinds: readonly RootletClusterKind[];
    readonly budget: ExplorationBudget;
    readonly candidateCounts: CandidatePoolCounts;
    readonly convergence: {
      readonly reviewId: string;
      readonly outcome: UndergroundConvergenceOutcome;
      readonly accepted: number;
      readonly merged: number;
      readonly rejected: number;
      readonly unknown: number;
      readonly userEscalationRequired: boolean;
      readonly stopReason?: string;
    };
  };
  readonly userEscalation?: {
    readonly requestId: string;
    readonly reason: UserClarificationReason;
    readonly questionCount: number;
    readonly relatedCandidateRefs: readonly string[];
  };
  readonly observationSnapshot: {
    readonly phase: RunPhase;
    readonly stage: RunStage;
    readonly eventCursor: UndergroundDirectionSessionResult["observationSnapshot"]["eventCursor"];
    readonly layerStatuses: {
      readonly underground: ObservationStatus;
      readonly handoff: ObservationStatus;
      readonly aboveground: ObservationStatus;
      readonly fruits: ObservationStatus;
      readonly governance: ObservationStatus;
      readonly soilReturnStub: ObservationStatus;
    };
  };
  readonly eventLog: readonly ArborMessageType[];
};

export type UndergroundDemoAiInput = {
  readonly enabled: boolean;
  readonly mode: "none" | "fake" | "openai-compatible";
  readonly providerId?: string;
  readonly providerKind?: string;
  readonly protocolKind?: string;
  readonly model?: string;
  readonly configurationError?: {
    readonly code: string;
    readonly message: string;
  };
};

export type UndergroundDemoAiSummary = {
  readonly enabled: boolean;
  readonly mode: UndergroundDemoAiInput["mode"];
  readonly providerId?: string;
  readonly providerKind?: string;
  readonly protocolKind?: string;
  readonly model?: string;
  readonly status:
    | "disabled"
    | "not_requested"
    | "requested"
    | "completed"
    | "failed"
    | "configuration_failed";
  readonly eventCounts: {
    readonly requested: number;
    readonly completed: number;
    readonly failed: number;
  };
  readonly modelCallRefs: readonly {
    readonly requestId: string;
    readonly responseId?: string;
    readonly providerId?: string;
    readonly providerKind?: string;
    readonly protocolKind?: string;
    readonly model?: string;
    readonly outputKind?: string;
    readonly validationStatus?: string;
    readonly rootletOutputRefs: readonly string[];
    readonly candidateRefs: readonly string[];
  }[];
  readonly configurationError?: {
    readonly code: string;
    readonly message: string;
  };
};

export function createUndergroundDemoSummary(
  result: UndergroundDirectionSessionResult,
  recovery?: UndergroundDirectionSessionRecoveryResult,
  aiInput?: UndergroundDemoAiInput
): UndergroundDemoSummary {
  const pkg = recovery?.loadedApprovedDirectionHandoffPackage ?? result.loadedDirectionHandoffPackage;
  const undergroundReport = recovery?.recoveredUndergroundReport ?? result.undergroundReport;
  const convergence = undergroundReport.convergenceReport;
  const escalation = convergence.userClarificationRequest;
  const observationSnapshot = recovery?.observationSnapshot ?? result.observationSnapshot;

  return {
    terminalStatus: recovery?.terminalStatus ?? result.terminalStatus,
    directionPackage: summarizeDirectionPackage(pkg),
    recoveredPackage:
      recovery === undefined ? undefined : summarizeDirectionPackage(recovery.loadedApprovedDirectionHandoffPackage),
    lineage: pkg.lineage,
    versions: recovery?.packageVersions ?? result.packageVersions,
    writtenPackagePath: recovery?.writtenPackagePath ?? result.writtenPackagePath,
    ai: summarizeAi({
      result,
      recovery,
      undergroundReport,
      aiInput,
    }),
    underground: {
      rootletKinds: undergroundReport.plan.rootletClusters.map((cluster) => cluster.kind),
      budget: undergroundReport.plan.budget,
      candidateCounts: undergroundReport.candidatePool.counts,
      convergence: {
        reviewId: convergence.reviewId,
        outcome: convergence.outcome,
        accepted: convergence.acceptedCandidateRefs.length,
        merged: convergence.mergedCandidateRefs.length,
        rejected: convergence.rejectedCandidateRefs.length,
        unknown: convergence.unknownCandidateRefs.length,
        userEscalationRequired: convergence.userEscalationRequired,
        stopReason: convergence.stopReason,
      },
    },
    userEscalation:
      escalation === undefined
        ? undefined
        : {
            requestId: escalation.requestId,
            reason: escalation.primaryReason,
            questionCount: escalation.questions.length,
            relatedCandidateRefs: escalation.relatedCandidateRefs,
          },
    observationSnapshot: {
      phase: observationSnapshot.currentPhase,
      stage: observationSnapshot.currentStage,
      eventCursor: observationSnapshot.eventCursor,
      layerStatuses: {
        underground: observationSnapshot.underground.status,
        handoff: observationSnapshot.handoff.status,
        aboveground: observationSnapshot.aboveground.status,
        fruits: observationSnapshot.fruits.status,
        governance: observationSnapshot.governance.status,
        soilReturnStub: observationSnapshot.soilReturnStub.status,
      },
    },
    eventLog: recovery?.eventTypes ?? result.eventTypes,
  };
}

function summarizeDirectionPackage(pkg: DirectionHandoffPackage): DirectionPackageSummary {
  return {
    id: pkg.manifest.packageId,
    directionId: pkg.manifest.directionId,
    version: pkg.manifest.directionVersion,
    status: pkg.manifest.status,
    validation: {
      passed: pkg.validation.passed,
      errors: pkg.validation.errors,
      warnings: pkg.validation.warnings,
    },
  };
}

function summarizeAi(input: {
  result: UndergroundDirectionSessionResult;
  recovery?: UndergroundDirectionSessionRecoveryResult;
  undergroundReport: UndergroundDirectionSessionResult["undergroundReport"];
  aiInput?: UndergroundDemoAiInput;
}): UndergroundDemoAiSummary {
  const eventEntries = (input.recovery?.runtime ?? input.result.runtime).eventLog.list();
  const modelEvents = eventEntries.filter(
    (entry) => entry.type === "model.requested" || entry.type === "model.completed" || entry.type === "model.failed"
  );
  const eventCounts = {
    requested: modelEvents.filter((entry) => entry.type === "model.requested").length,
    completed: modelEvents.filter((entry) => entry.type === "model.completed").length,
    failed: modelEvents.filter((entry) => entry.type === "model.failed").length,
  };
  const firstPayload = modelEvents.map((entry) => asRecord(entry.message.payload)).find(hasProviderIdentity);
  const enabled = input.aiInput?.enabled ?? modelEvents.length > 0;

  return {
    enabled,
    mode: input.aiInput?.mode ?? (enabled ? "fake" : "none"),
    providerId: input.aiInput?.providerId ?? stringOrUndefined(firstPayload?.providerId),
    providerKind: input.aiInput?.providerKind ?? stringOrUndefined(firstPayload?.providerKind),
    protocolKind: input.aiInput?.protocolKind ?? stringOrUndefined(firstPayload?.protocolKind),
    model: input.aiInput?.model ?? stringOrUndefined(firstPayload?.model),
    status: aiStatus(enabled, input.aiInput, eventCounts),
    eventCounts,
    modelCallRefs: summarizeModelCallRefs(modelEvents, input.undergroundReport),
    configurationError: input.aiInput?.configurationError,
  };
}

function summarizeModelCallRefs(
  modelEvents: ReturnType<UndergroundDirectionSessionResult["runtime"]["eventLog"]["list"]>,
  undergroundReport: UndergroundDirectionSessionResult["undergroundReport"]
): UndergroundDemoAiSummary["modelCallRefs"] {
  const calls = new Map<
    string,
    {
      requestId: string;
      responseId?: string;
      providerId?: string;
      providerKind?: string;
      protocolKind?: string;
      model?: string;
      outputKind?: string;
      validationStatus?: string;
    }
  >();

  for (const event of modelEvents) {
    const payload = asRecord(event.message.payload);
    const requestId = stringOrUndefined(payload.requestId);
    if (requestId === undefined) {
      continue;
    }
    const existing = calls.get(requestId) ?? { requestId };
    calls.set(requestId, {
      ...existing,
      responseId: stringOrUndefined(payload.responseId) ?? existing.responseId,
      providerId: stringOrUndefined(payload.providerId) ?? existing.providerId,
      providerKind: stringOrUndefined(payload.providerKind) ?? existing.providerKind,
      protocolKind: stringOrUndefined(payload.protocolKind) ?? existing.protocolKind,
      model: stringOrUndefined(payload.model) ?? existing.model,
      outputKind: stringOrUndefined(payload.outputKind) ?? existing.outputKind,
      validationStatus: stringOrUndefined(payload.validationStatus) ?? existing.validationStatus,
    });
  }

  return [...calls.values()].map((call) => {
    const rootletOutputRefs = inputRelatedRootletOutputRefs(call, undergroundReport);
    return {
      ...call,
      rootletOutputRefs,
      candidateRefs: undergroundReport.candidatePool.candidates
        .filter((candidate) => candidate.sourceRefs.some((ref) => rootletOutputRefs.includes(ref)))
        .map((candidate) => candidate.id),
    };
  });
}

function inputRelatedRootletOutputRefs(
  call: {
    requestId: string;
    responseId?: string;
  },
  undergroundReport: UndergroundDirectionSessionResult["undergroundReport"]
): string[] {
  return undergroundReport.rootletOutputs
    .filter((output) => {
      const refs = [...output.sourceRefs, ...output.evidenceRefs];
      return (
        refs.includes(call.requestId) ||
        (call.responseId !== undefined &&
          (refs.includes(call.responseId) || refs.includes(`model-call:${call.responseId}`)))
      );
    })
    .map((output) => output.outputId);
}

function aiStatus(
  enabled: boolean,
  aiInput: UndergroundDemoAiInput | undefined,
  eventCounts: UndergroundDemoAiSummary["eventCounts"]
): UndergroundDemoAiSummary["status"] {
  if (aiInput?.configurationError !== undefined) {
    return "configuration_failed";
  }
  if (!enabled) {
    return "disabled";
  }
  if (eventCounts.failed > 0) {
    return "failed";
  }
  if (eventCounts.completed > 0) {
    return "completed";
  }
  if (eventCounts.requested > 0) {
    return "requested";
  }
  return "not_requested";
}

function hasProviderIdentity(payload: Readonly<Record<string, unknown>> | undefined): payload is Readonly<Record<string, unknown>> {
  return payload !== undefined && typeof payload.providerId === "string";
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  return {};
}
