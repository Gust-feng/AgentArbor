import { createApprovedDirectionHandoff } from "../domain/agentarbor/direction-handoff.js";
import {
  createDirectionHandoffPackage,
  createDirectionHandoffPackageRef,
} from "../domain/agentarbor/direction-handoff-package.js";
import type { DirectionHandoffPackage } from "../domain/agentarbor/direction-handoff-package/contracts.js";
import type {
  CandidateConvergenceDecision,
  ConvergenceReview,
  DirectionHandoff,
  ExplorationCandidateRef,
  UndergroundConvergenceReport,
  UserClarificationRequest,
  UserClarificationResponse,
} from "../domain/underground/index.js";
import {
  assertUserClarificationResponseMatchesRequest,
  cloneUserClarificationResponse,
} from "../domain/underground/index.js";
import { createId, nowIso } from "../kernel/id.js";

export type ClarificationRecoveryDirectionMaterial = {
  clarificationResponse: UserClarificationResponse;
  convergenceReview: UndergroundConvergenceReport;
  directionHandoff: DirectionHandoff;
  directionHandoffPackage: DirectionHandoffPackage;
};

export function createDefaultClarificationResponse(
  request: UserClarificationRequest
): UserClarificationResponse {
  const answers = request.questions.map((question, index) => ({
    questionId: question.questionId,
    answer: "User confirms Aboveground execution may proceed within the current permission boundary.",
    selectedOptionId: "approved",
    evidenceRefs: [`${request.requestId}:answer-${index + 1}`],
  }));
  return {
    requestId: request.requestId,
    goalId: request.goalId,
    answeredAt: nowIso(),
    status: "answered",
    answers,
    evidenceRefs: uniqueStrings(answers.flatMap((answer) => answer.evidenceRefs)),
  };
}

export function createClarificationRecoveryDirectionMaterial(input: {
  awaitingUserPackage: DirectionHandoffPackage;
  clarificationRequest: UserClarificationRequest;
  clarificationResponse: UserClarificationResponse;
}): ClarificationRecoveryDirectionMaterial {
  assertUserClarificationResponseMatchesRequest(input.clarificationRequest, input.clarificationResponse);
  assertAwaitingUserPackageMatchesRequest(input.awaitingUserPackage, input.clarificationRequest);

  const response = cloneUserClarificationResponse(input.clarificationResponse);
  const convergenceReview = createApprovedConvergenceReviewFromClarification({
    awaitingUserPackage: input.awaitingUserPackage,
    clarificationRequest: input.clarificationRequest,
    clarificationResponse: response,
  });
  const directionHandoff = createApprovedRecoveredDirectionHandoff({
    awaitingUserPackage: input.awaitingUserPackage,
    convergenceReview,
    clarificationRequest: input.clarificationRequest,
    clarificationResponse: response,
  });
  const directionHandoffPackage = createDirectionHandoffPackage({
    directionHandoff,
    convergenceReview,
    createdAt: response.answeredAt,
    updatedAt: response.answeredAt,
    lineage: {
      previous: createDirectionHandoffPackageRef(input.awaitingUserPackage),
      revisionReason: "user_clarification_answered",
      sourceRefs: lineageSourceRefs({
        previousPackage: input.awaitingUserPackage,
        clarificationRequest: input.clarificationRequest,
        clarificationResponse: response,
        convergenceReview,
      }),
      createdAt: response.answeredAt,
    },
  });

  return {
    clarificationResponse: response,
    convergenceReview,
    directionHandoff,
    directionHandoffPackage,
  };
}

function assertAwaitingUserPackageMatchesRequest(
  pkg: DirectionHandoffPackage,
  request: UserClarificationRequest
): void {
  if (pkg.manifest.status !== "awaiting_user" || pkg.directionHandoff.status !== "awaiting_user") {
    throw new Error("Clarification recovery requires an awaiting_user DirectionHandoffPackage.");
  }
  const packageRequest = pkg.convergenceReview.userClarificationRequest;
  if (packageRequest?.requestId !== request.requestId) {
    throw new Error("Clarification recovery request must match the awaiting-user package.");
  }
}

function createApprovedConvergenceReviewFromClarification(input: {
  awaitingUserPackage: DirectionHandoffPackage;
  clarificationRequest: UserClarificationRequest;
  clarificationResponse: UserClarificationResponse;
}): UndergroundConvergenceReport {
  const previousReview = input.awaitingUserPackage.convergenceReview as ConvergenceReview &
    Partial<UndergroundConvergenceReport>;
  const answeredCandidateRefs = new Set(input.clarificationRequest.relatedCandidateRefs);
  const sourceCandidateRefs = input.awaitingUserPackage.directionHandoff.sourceCandidateRefs;
  const acceptedCandidateRefs = sourceCandidateRefs
    .filter((candidate) => candidate.status === "accepted")
    .map((candidate) => candidate.id);
  const mergedCandidateRefs = sourceCandidateRefs
    .filter((candidate) => candidate.status === "merged")
    .map((candidate) => candidate.id);
  const responseEvidenceRefs = collectClarificationEvidenceRefs(input.clarificationResponse);
  const decisions = createRecoveredDecisions({
    previousReview,
    sourceCandidateRefs,
    answeredCandidateRefs,
    clarificationResponse: input.clarificationResponse,
    responseEvidenceRefs,
  });

  return {
    reviewId: createId("convergence"),
    reviewedByAgentIds: [...previousReview.reviewedByAgentIds],
    leadAgentId: previousReview.leadAgentId,
    crossCheckedCandidateRefs: uniqueStrings([
      ...previousReview.crossCheckedCandidateRefs,
      ...input.clarificationRequest.relatedCandidateRefs,
    ]),
    deduplicatedCandidateRefs: uniqueStrings([...acceptedCandidateRefs, ...mergedCandidateRefs]),
    acceptedCandidateRefs,
    mergedCandidateRefs,
    rejectedCandidateRefs: uniqueStrings([
      ...previousReview.rejectedCandidateRefs,
      ...input.clarificationRequest.relatedCandidateRefs,
    ]),
    unknownCandidateRefs: (previousReview.unknownCandidateRefs ?? []).filter(
      (candidateId) => !answeredCandidateRefs.has(candidateId)
    ),
    conflictResolutionRefs: uniqueStrings([
      ...previousReview.conflictResolutionRefs,
      input.clarificationRequest.requestId,
    ]),
    provenanceRefs: uniqueStrings([
      ...previousReview.provenanceRefs,
      previousReview.reviewId,
      input.clarificationRequest.requestId,
      "user_approval.received",
      ...responseEvidenceRefs,
    ]),
    decisions,
    summary: "User clarification was answered; blocking unknowns no longer block the direction handoff.",
    outcome: "approved",
    userEscalationRequired: false,
    openQuestions: (previousReview.openQuestions ?? []).filter(
      (question) =>
        !answeredCandidateRefs.has(question.candidateId) &&
        question.disposition !== "request_user_clarification" &&
        question.blockingLevel !== "blocking"
    ),
    budgetExhausted: previousReview.budgetExhausted ?? true,
    handoffCandidateRefs: sourceCandidateRefs.map((candidate) => candidate.id),
  };
}

function createRecoveredDecisions(input: {
  previousReview: ConvergenceReview & Partial<UndergroundConvergenceReport>;
  sourceCandidateRefs: readonly ExplorationCandidateRef[];
  answeredCandidateRefs: ReadonlySet<string>;
  clarificationResponse: UserClarificationResponse;
  responseEvidenceRefs: readonly string[];
}): CandidateConvergenceDecision[] {
  const previousDecisions = input.previousReview.decisions ?? input.sourceCandidateRefs.map((candidate) => ({
    decisionId: createId("convergence-decision"),
    candidateId: candidate.id,
    sourceCandidateRefs: [candidate.id],
    status: candidate.status === "merged" ? "merged" : "accepted",
    decidedByRole: "convergence_judge" as const,
    reason: `${candidate.clusterId} remains selected for the recovered direction handoff.`,
    provenanceRefs: [...candidate.sourceRefs],
  }));

  return previousDecisions.map((decision) => {
    if (!input.answeredCandidateRefs.has(decision.candidateId)) {
      return {
        ...decision,
        sourceCandidateRefs: [...decision.sourceCandidateRefs],
        provenanceRefs: [...decision.provenanceRefs],
      };
    }
    return {
      ...decision,
      status: "rejected",
      reason:
        "User clarification answered this blocking unknown; it is resolved as revision evidence and excluded from handoff source candidates.",
      provenanceRefs: uniqueStrings([
        ...decision.provenanceRefs,
        input.clarificationResponse.requestId,
        ...input.responseEvidenceRefs,
      ]),
    };
  });
}

function createApprovedRecoveredDirectionHandoff(input: {
  awaitingUserPackage: DirectionHandoffPackage;
  convergenceReview: UndergroundConvergenceReport;
  clarificationRequest: UserClarificationRequest;
  clarificationResponse: UserClarificationResponse;
}): DirectionHandoff {
  const previousHandoff = input.awaitingUserPackage.directionHandoff;
  const { status: _status, ...draft } = previousHandoff;
  const questionIds = new Set(input.clarificationRequest.questions.map((question) => question.questionId));
  const responseEvidenceRefs = collectClarificationEvidenceRefs(input.clarificationResponse);

  return createApprovedDirectionHandoff(
    {
      ...draft,
      version: previousHandoff.version + 1,
      assumptions: cleanClarificationTexts(previousHandoff.assumptions, input.clarificationRequest),
      missingInformation: [],
      evidenceRefs: uniqueStrings([
        ...previousHandoff.evidenceRefs,
        input.clarificationResponse.requestId,
        ...responseEvidenceRefs,
      ]),
      risks: cleanClarificationTexts(previousHandoff.risks, input.clarificationRequest),
      options: previousHandoff.options.map((option) => ({
        ...option,
        unknowns: [],
        recommendationScore: 1,
        doNotChooseWhen: cleanClarificationTexts(option.doNotChooseWhen, input.clarificationRequest),
      })),
      decisionRecord: {
        ...previousHandoff.decisionRecord,
        userDecisionRequired: previousHandoff.decisionRecord.userDecisionRequired.filter(
          (questionId) => !questionIds.has(questionId)
        ),
        rationaleEvidenceRefs: uniqueStrings([
          ...previousHandoff.decisionRecord.rationaleEvidenceRefs,
          input.clarificationResponse.requestId,
          ...responseEvidenceRefs,
        ]),
        rationaleRiskRefs: previousHandoff.decisionRecord.rationaleRiskRefs.filter(
          (riskRef) => riskRef !== input.clarificationRequest.requestId
        ),
      },
      riskRegister: previousHandoff.riskRegister.filter(
        (risk) =>
          risk.source !== input.clarificationRequest.requestId &&
          risk.blockingLevel !== "ask_user"
      ),
      convergenceReviewRef: input.convergenceReview.reviewId,
      growthEntry: {
        ...previousHandoff.growthEntry,
        escalationRules: cleanClarificationTexts(
          previousHandoff.growthEntry.escalationRules,
          input.clarificationRequest
        ),
      },
      updatedAt: input.clarificationResponse.answeredAt,
    },
    input.convergenceReview
  );
}

function lineageSourceRefs(input: {
  previousPackage: DirectionHandoffPackage;
  clarificationRequest: UserClarificationRequest;
  clarificationResponse: UserClarificationResponse;
  convergenceReview: UndergroundConvergenceReport;
}): string[] {
  return uniqueStrings([
    input.previousPackage.manifest.packageId,
    input.previousPackage.convergenceReview.reviewId,
    input.clarificationRequest.requestId,
    input.convergenceReview.reviewId,
    "user_approval.received",
    ...collectClarificationEvidenceRefs(input.clarificationResponse),
  ]);
}

function collectClarificationEvidenceRefs(response: UserClarificationResponse): string[] {
  return uniqueStrings([
    ...response.evidenceRefs,
    ...response.answers.flatMap((answer) => answer.evidenceRefs),
  ]);
}

function cleanClarificationTexts(
  values: readonly string[],
  request: UserClarificationRequest
): string[] {
  return values.filter((value) => !isClarificationBlockerText(value, request));
}

function isClarificationBlockerText(value: string, request: UserClarificationRequest): boolean {
  const normalized = value.toLowerCase();
  return (
    value.includes(request.requestId) ||
    normalized.includes("blocked until user clarification is answered") ||
    normalized.includes("blocking user clarification") ||
    normalized.includes("clarification request remains unanswered") ||
    normalized.includes("resolve user clarification request")
  );
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
