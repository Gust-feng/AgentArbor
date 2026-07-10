/**
 * @deprecated 废弃候选（T4-1 / ADR-0025 deep 一期）— ② 确定性编排主线（线性函数式编排）。
 *
 * 替代物：src/app/deep/* DeepRuntime（manager 自由决策循环 → 一层 child 探索 → 父层综合）；
 * 正式入口 POST /api/deep/conversations + /api/deep/conversations/:id/runs。
 *
 * 删除前置条件（闭环4 §8.1 阶段④）：smoke/tests 迁移完成 + 等价能力验证通过 + 无活跃引用。
 * 当前保持运行不阻塞构建；禁止改名/删除（仍被 test/smoke/compat 引用）。
 * 边界：domain/underground 的 AgentLoop/Guard/run tree/事件契约为保留复用抽象，不在退役范围。
 */
import type { DirectionHandoffPackage } from "../domain/agentarbor/direction-handoff-package/contracts.js";
import type {
  RootletClusterKind,
} from "../domain/underground/index.js";
import type { ModelVisibleOutputProjection } from "../domain/intelligence/index.js";
import type {
  UndergroundDirectionSessionResult,
} from "./underground-direction-session.js";
import type { UndergroundDirectionSessionRecoveryResult } from "./underground-direction-recovery.js";
import type {
  RunDirectionPackageSummary,
  RunSummary,
  RunSummaryAiInput,
  RunSummaryAiSummary,
  RunSummaryToolSummary,
} from "./run-read-model/run-summary.js";

export type UndergroundDemoSummary = RunSummary;

export type UndergroundDemoAiInput = RunSummaryAiInput;

export type UndergroundDemoAiSummary = RunSummaryAiSummary;

export type UndergroundDemoToolSummary = RunSummaryToolSummary;

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
    tools: summarizeTools((recovery?.runtime ?? result.runtime).eventLog.list()),
    underground: {
      autonomy: {
        enabled: undergroundReport.autonomy?.enabled ?? false,
        cycleCount: undergroundReport.autonomy?.cycles.length ?? 0,
        latestAction: undergroundReport.autonomy?.latestDecision?.action,
        latestDecisionStatus: undergroundReport.autonomy?.latestDecision?.status,
        spawnedRootletCount: undergroundReport.autonomy?.latestDecision?.spawnRequests.length ?? 0,
        stopReason: undergroundReport.autonomy?.stopReason ?? undergroundReport.autonomy?.latestDecision?.stopReason,
        sourceRefs: undergroundReport.autonomy?.latestDecision?.sourceRefs ?? [],
        modelCallRefs:
          undergroundReport.autonomy?.latestDecision?.modelCallRefs.map((ref) => ref.requestId) ?? [],
      },
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

function summarizeDirectionPackage(pkg: DirectionHandoffPackage): RunDirectionPackageSummary {
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

function summarizeTools(
  eventEntries: ReturnType<UndergroundDirectionSessionResult["runtime"]["eventLog"]["list"]>
): UndergroundDemoToolSummary {
  const toolEvents = eventEntries.filter(
    (entry) => entry.type === "tool.requested" || entry.type === "tool.completed" || entry.type === "tool.failed"
  );
  const calls = new Map<
    string,
    {
      callId: string;
      toolName?: string;
      callerAgentId?: string;
      status: "requested" | "completed" | "failed";
      durationMs?: number;
      eventRefs: string[];
    }
  >();

  for (const event of toolEvents) {
    const payload = asRecord(event.message.payload);
    const callId = stringOrUndefined(payload.callId);
    if (callId === undefined) {
      continue;
    }
    const existing = calls.get(callId) ?? {
      callId,
      status: "requested" as const,
      eventRefs: [],
    };
    calls.set(callId, {
      ...existing,
      toolName: stringOrUndefined(payload.toolName) ?? existing.toolName,
      callerAgentId: stringOrUndefined(payload.callerAgentId) ?? existing.callerAgentId,
      status: event.type === "tool.failed" ? "failed" : event.type === "tool.completed" ? "completed" : existing.status,
      durationMs: numberOrUndefined(payload.durationMs) ?? existing.durationMs,
      eventRefs: [...existing.eventRefs, event.message.id],
    });
  }

  return {
    eventCounts: {
      requested: toolEvents.filter((entry) => entry.type === "tool.requested").length,
      completed: toolEvents.filter((entry) => entry.type === "tool.completed").length,
      failed: toolEvents.filter((entry) => entry.type === "tool.failed").length,
    },
    toolCallRefs: [...calls.values()],
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
  const rootletKindSummaries = summarizeRootletKindAi(modelEvents, input.undergroundReport);
  const aiCandidateCount = rootletKindSummaries.reduce((total, item) => total + item.aiCandidateCount, 0);
  const fallbackCount = rootletKindSummaries.reduce((total, item) => total + item.fallbackCount, 0);

  return {
    enabled,
    mode: input.aiInput?.mode ?? (enabled ? "fake" : "none"),
    providerId: input.aiInput?.providerId ?? stringOrUndefined(firstPayload?.providerId),
    providerKind: input.aiInput?.providerKind ?? stringOrUndefined(firstPayload?.providerKind),
    protocolKind: input.aiInput?.protocolKind ?? stringOrUndefined(firstPayload?.protocolKind),
    model: input.aiInput?.model ?? stringOrUndefined(firstPayload?.model),
    status: aiStatus(enabled, input.aiInput, eventCounts),
    eventCounts,
    aiCandidateCount,
    fallbackCount,
    aiFallbackUsed: fallbackCount > 0,
    rootletKinds: rootletKindSummaries,
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
      visibleOutput?: ModelVisibleOutputProjection;
      rootletKind?: RootletClusterKind;
    }
  >();
  const rootletKindByRequestId = rootletKindsByRequestId(modelEvents);

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
      visibleOutput: modelVisibleOutputOrUndefined(payload.visibleOutput) ?? existing.visibleOutput,
      rootletKind: rootletKindByRequestId.get(requestId) ?? existing.rootletKind,
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

function summarizeRootletKindAi(
  modelEvents: ReturnType<UndergroundDirectionSessionResult["runtime"]["eventLog"]["list"]>,
  undergroundReport: UndergroundDirectionSessionResult["undergroundReport"]
): UndergroundDemoAiSummary["rootletKinds"] {
  const kindByRequestId = rootletKindsByRequestId(modelEvents);
  const counts = new Map<
    RootletClusterKind,
    {
      kind: RootletClusterKind;
      requested: number;
      completed: number;
      failed: number;
    }
  >();

  for (const event of modelEvents) {
    const payload = asRecord(event.message.payload);
    const requestId = stringOrUndefined(payload.requestId);
    const kind = requestId === undefined ? undefined : kindByRequestId.get(requestId);
    if (kind === undefined) {
      continue;
    }
    const current = counts.get(kind) ?? { kind, requested: 0, completed: 0, failed: 0 };
    if (event.type === "model.requested") {
      current.requested += 1;
    } else if (event.type === "model.completed") {
      current.completed += 1;
    } else if (event.type === "model.failed") {
      current.failed += 1;
    }
    counts.set(kind, current);
  }

  return [...counts.values()].map((item) => {
    const aiCandidateCount = undergroundReport.rootletOutputs.filter(
      (output) => output.kind === item.kind && output.source === "ai"
    ).length;
    const fallbackCount = undergroundReport.rootletOutputs.filter(
      (output) => output.kind === item.kind && output.source === "deterministic_fallback"
    ).length;
    return {
      ...item,
      status: item.failed > 0 ? "failed" : item.completed > 0 ? "completed" : "requested",
      aiCandidateCount,
      fallbackCount,
      aiFallbackUsed: fallbackCount > 0,
    };
  });
}

function rootletKindsByRequestId(
  modelEvents: ReturnType<UndergroundDirectionSessionResult["runtime"]["eventLog"]["list"]>
): ReadonlyMap<string, RootletClusterKind> {
  const result = new Map<string, RootletClusterKind>();
  for (const event of modelEvents) {
    if (event.type !== "model.requested") {
      continue;
    }
    const payload = asRecord(event.message.payload);
    const requestId = stringOrUndefined(payload.requestId);
    const outputContract = asRecord(payload.outputContract);
    const contractId = stringOrUndefined(outputContract.contractId);
    const kind = rootletKindFromAdviceContractId(contractId);
    if (requestId !== undefined && kind !== undefined) {
      result.set(requestId, kind);
    }
  }
  return result;
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

function rootletKindFromAdviceContractId(contractId: string | undefined): RootletClusterKind | undefined {
  if (contractId === undefined) {
    return undefined;
  }
  const prefix = "underground.rootlet_candidate_advice.";
  if (!contractId.startsWith(prefix)) {
    return undefined;
  }
  const kind = contractId.slice(prefix.length).split(".")[0];
  return isRootletClusterKind(kind) ? kind : undefined;
}

function isRootletClusterKind(value: string | undefined): value is RootletClusterKind {
  return (
    value === "option" ||
    value === "risk" ||
    value === "asset_fit" ||
    value === "evidence" ||
    value === "constraint" ||
    value === "counterfactual"
  );
}

function hasProviderIdentity(payload: Readonly<Record<string, unknown>> | undefined): payload is Readonly<Record<string, unknown>> {
  return payload !== undefined && typeof payload.providerId === "string";
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function modelVisibleOutputOrUndefined(value: unknown): ModelVisibleOutputProjection | undefined {
  const record = asRecord(value);
  if (
    typeof record.contractId !== "string" ||
    typeof record.outputKind !== "string" ||
    (record.source !== "structured_output" && record.source !== "text_output") ||
    record.validationStatus !== "passed" ||
    !Array.isArray(record.items)
  ) {
    return undefined;
  }
  return record as unknown as ModelVisibleOutputProjection;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  return {};
}
