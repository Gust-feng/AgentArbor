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
import type { ArborMessageType } from "../domain/common.js";
import {
  createDirectionHandoffPackageRef,
  resolveDirectionHandoffPackageMetaPath,
  type DirectionHandoffPackage,
  type DirectionHandoffPackageRef,
} from "../domain/agentarbor/direction-handoff-package.js";
import type { RunObservationSnapshot } from "../domain/observation/contracts.js";
import { createRunObservationSnapshot } from "../domain/observation/index.js";
import type {
  DirectionHandoff,
  UndergroundAgentClusterRun,
  UndergroundConvergenceReport,
  UndergroundExplorationReport,
  UserClarificationRequest,
  UserClarificationResponse,
} from "../domain/underground/index.js";
import { applyCandidateConvergenceDecisions } from "../domain/underground/index.js";
import { createMessage } from "../kernel/messages/create-message.js";
import {
  createClarificationRecoveryDirectionMaterial,
  createDefaultClarificationResponse,
} from "./underground/clarification/clarification-recovery.js";
import { publishConvergenceReviewCompleted } from "./underground/events.js";
import type {
  UndergroundDirectionSessionResult,
  UndergroundDirectionSessionTerminalStatus,
} from "./underground-direction-session.js";
import type { MinimalRuntime } from "./runtime.js";

export type UndergroundDirectionSessionRecoveryResult = {
  runtime: MinimalRuntime;
  traceId: string;
  goalId: string;
  terminalStatus: Extract<UndergroundDirectionSessionTerminalStatus, "approved_package_created">;
  awaitingUserDirectionHandoffPackage: DirectionHandoffPackage;
  approvedDirectionHandoffPackage: DirectionHandoffPackage;
  loadedApprovedDirectionHandoffPackage: DirectionHandoffPackage;
  directionHandoffPackageRef: DirectionHandoffPackageRef;
  undergroundReport: UndergroundExplorationReport;
  recoveredUndergroundReport: UndergroundExplorationReport;
  clarificationRequest: UserClarificationRequest;
  clarificationResponse: UserClarificationResponse;
  approvedConvergenceReport: UndergroundConvergenceReport;
  directionHandoff: DirectionHandoff;
  observationSnapshot: RunObservationSnapshot;
  eventTypes: ArborMessageType[];
  packageVersions: number[];
  writtenPackagePath?: string;
};

export function recoverUndergroundDirectionSession(
  awaitingSession: UndergroundDirectionSessionResult,
  clarificationResponse?: UserClarificationResponse
): UndergroundDirectionSessionRecoveryResult {
  const clarificationRequest = requireAwaitingUserClarificationRequest(awaitingSession);
  const response = clarificationResponse ?? createDefaultClarificationResponse(clarificationRequest);
  const previousPackageRef = createDirectionHandoffPackageRef(awaitingSession.loadedDirectionHandoffPackage);
  const agentId = awaitingSession.undergroundReport.convergenceReport.leadAgentId;

  publishUserApprovalReceived({
    runtime: awaitingSession.runtime,
    traceId: awaitingSession.traceId,
    goalId: awaitingSession.goalId,
    clarificationResponse: response,
    directionPackage: previousPackageRef,
  });
  publishDirectionHandoffRevisionRequested({
    runtime: awaitingSession.runtime,
    traceId: awaitingSession.traceId,
    goalId: awaitingSession.goalId,
    agentId,
    clarificationResponse: response,
    previousDirectionPackage: previousPackageRef,
    previousConvergenceReviewId: awaitingSession.loadedDirectionHandoffPackage.convergenceReview.reviewId,
    previousConvergenceOutcome: awaitingSession.loadedDirectionHandoffPackage.convergenceReview.outcome ?? "awaiting_user",
  });

  const material = createClarificationRecoveryDirectionMaterial({
    awaitingUserPackage: awaitingSession.loadedDirectionHandoffPackage,
    clarificationRequest,
    clarificationResponse: response,
  });
  const recoveredCandidatePool = applyCandidateConvergenceDecisions(
    awaitingSession.undergroundReport.candidatePool,
    material.convergenceReview.decisions,
    material.clarificationResponse.answeredAt
  );
  let recoveredUndergroundReport: UndergroundExplorationReport = {
    ...awaitingSession.undergroundReport,
    candidatePool: recoveredCandidatePool,
    convergenceReport: material.convergenceReview,
  };

  publishConvergenceReviewCompleted({
    runtime: awaitingSession.runtime,
    traceId: awaitingSession.traceId,
    agentId,
    goalId: awaitingSession.goalId,
    planId: awaitingSession.undergroundReport.plan.planId,
    convergenceReport: material.convergenceReview,
    candidatePool: recoveredCandidatePool,
    undergroundReport: recoveredUndergroundReport,
  });

  const approvedDirectionHandoffPackage = awaitingSession.runtime.directionHandoffPackageStore.save(
    material.directionHandoffPackage
  );
  const loadedApprovedDirectionHandoffPackage = awaitingSession.runtime.directionHandoffPackageStore.load(
    approvedDirectionHandoffPackage.manifest.directionId,
    approvedDirectionHandoffPackage.manifest.directionVersion
  );
  const directionHandoffPackageRef = createDirectionHandoffPackageRef(loadedApprovedDirectionHandoffPackage);
  recoveredUndergroundReport = {
    ...recoveredUndergroundReport,
    agentClusterRun: recoverAgentClusterRun({
      run: awaitingSession.undergroundReport.agentClusterRun,
      packageRef: directionHandoffPackageRef,
      candidateRefs: material.convergenceReview.handoffCandidateRefs,
      completedAt: material.clarificationResponse.answeredAt,
    }),
  };

  awaitingSession.runtime.bus.publish(
    createMessage({
      traceId: awaitingSession.traceId,
      from: { id: "underground-handoff-steward", role: "underground_center" },
      to: { role: "aboveground_center" },
      type: "direction_handoff.completed",
      intent: "complete_direction_handoff_revision",
      payload: {
        goalId: awaitingSession.goalId,
        directionHandoff: material.directionHandoff,
        clarificationResponse: material.clarificationResponse,
        previousDirectionPackage: previousPackageRef,
        directionPackage: directionHandoffPackageRef,
        lineage: loadedApprovedDirectionHandoffPackage.lineage,
        convergenceReport: {
          reviewId: material.convergenceReview.reviewId,
          outcome: material.convergenceReview.outcome,
        },
        agentCluster:
          recoveredUndergroundReport.agentClusterRun === undefined
            ? undefined
            : {
                plan: recoveredUndergroundReport.agentClusterRun.plan,
                run: recoveredUndergroundReport.agentClusterRun,
                invocations: recoveredUndergroundReport.agentClusterRun.invocations,
              },
      },
    })
  );

  const observationSnapshot = createRunObservationSnapshot({
    traceId: awaitingSession.traceId,
    goalId: awaitingSession.goalId,
    eventEntries: awaitingSession.runtime.eventLog.list(),
    undergroundReport: recoveredUndergroundReport,
    directionHandoffPackage: loadedApprovedDirectionHandoffPackage,
  });
  const packageVersions = awaitingSession.runtime.directionHandoffPackageStore.listVersions(
    loadedApprovedDirectionHandoffPackage.manifest.directionId
  );

  return {
    runtime: awaitingSession.runtime,
    traceId: awaitingSession.traceId,
    goalId: awaitingSession.goalId,
    terminalStatus: "approved_package_created",
    awaitingUserDirectionHandoffPackage: awaitingSession.loadedDirectionHandoffPackage,
    approvedDirectionHandoffPackage,
    loadedApprovedDirectionHandoffPackage,
    directionHandoffPackageRef,
    undergroundReport: awaitingSession.undergroundReport,
    recoveredUndergroundReport,
    clarificationRequest,
    clarificationResponse: material.clarificationResponse,
    approvedConvergenceReport: material.convergenceReview,
    directionHandoff: material.directionHandoff,
    observationSnapshot,
    eventTypes: awaitingSession.runtime.eventLog.types(),
    packageVersions,
    writtenPackagePath:
      awaitingSession.outputDirectory === undefined
        ? undefined
        : resolveDirectionHandoffPackageMetaPath(
            awaitingSession.outputDirectory,
            loadedApprovedDirectionHandoffPackage.manifest.directionId,
            loadedApprovedDirectionHandoffPackage.manifest.directionVersion
          ),
  };
}

function recoverAgentClusterRun(input: {
  run?: UndergroundAgentClusterRun;
  packageRef: DirectionHandoffPackageRef;
  candidateRefs: readonly string[];
  completedAt: string;
}): UndergroundAgentClusterRun | undefined {
  if (input.run === undefined) {
    return undefined;
  }
  return {
    ...input.run,
    invocations: input.run.invocations.map((invocation) =>
      invocation.role === "handoff_steward"
        ? {
            ...invocation,
            outputRefs: Array.from(new Set([...invocation.outputRefs, input.packageRef.packageId])),
            status: "completed",
            completedAt: input.completedAt,
          }
        : {
            ...invocation,
            inputRefs: [...invocation.inputRefs],
            outputRefs: [...invocation.outputRefs],
          }
    ),
    terminalStatus: "approved_package_created",
    candidateRefs: [...input.candidateRefs],
    packageRef: input.packageRef,
    completedAt: input.completedAt,
    stopReason: undefined,
  };
}

function requireAwaitingUserClarificationRequest(
  session: UndergroundDirectionSessionResult
): UserClarificationRequest {
  const request = session.undergroundReport.convergenceReport.userClarificationRequest;
  if (session.terminalStatus !== "awaiting_user" || request === undefined) {
    throw new Error("Underground direction session recovery requires an awaiting_user session.");
  }
  if (session.loadedDirectionHandoffPackage.manifest.status !== "awaiting_user") {
    throw new Error("Underground direction session recovery requires an awaiting_user package.");
  }
  return request;
}

function publishUserApprovalReceived(input: {
  runtime: MinimalRuntime;
  traceId: string;
  goalId: string;
  clarificationResponse: UserClarificationResponse;
  directionPackage: DirectionHandoffPackageRef;
}): void {
  input.runtime.bus.publish(
    createMessage({
      traceId: input.traceId,
      from: { id: "user", role: "user" },
      to: { role: "underground_center" },
      type: "user_approval.received",
      intent: "receive_user_clarification",
      payload: {
        goalId: input.goalId,
        requestId: input.clarificationResponse.requestId,
        answeredAt: input.clarificationResponse.answeredAt,
        answers: input.clarificationResponse.answers,
        evidenceRefs: input.clarificationResponse.evidenceRefs,
        clarificationResponse: input.clarificationResponse,
        directionPackage: input.directionPackage,
      },
    })
  );
}

function publishDirectionHandoffRevisionRequested(input: {
  runtime: MinimalRuntime;
  traceId: string;
  goalId: string;
  agentId: string;
  clarificationResponse: UserClarificationResponse;
  previousDirectionPackage: DirectionHandoffPackageRef;
  previousConvergenceReviewId: string;
  previousConvergenceOutcome: UndergroundConvergenceReport["outcome"];
}): void {
  input.runtime.bus.publish(
    createMessage({
      traceId: input.traceId,
      from: { id: input.agentId, role: "underground_center" },
      to: { role: "agentarbor_handoff" },
      type: "direction_handoff.revision_requested",
      intent: "request_direction_handoff_revision",
      payload: {
        goalId: input.goalId,
        revisionReason: "user_clarification_answered",
        requestId: input.clarificationResponse.requestId,
        answeredAt: input.clarificationResponse.answeredAt,
        evidenceRefs: input.clarificationResponse.evidenceRefs,
        clarificationResponse: input.clarificationResponse,
        directionPackage: input.previousDirectionPackage,
        convergenceReport: {
          reviewId: input.previousConvergenceReviewId,
          outcome: input.previousConvergenceOutcome,
        },
      },
    })
  );
}
