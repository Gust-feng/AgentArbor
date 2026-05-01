export const USER_CLARIFICATION_REASONS = [
  "goal_conflict",
  "permission_boundary_unclear",
  "critical_fact_missing",
  "value_tradeoff_required",
  "hard_constraint_unclear",
] as const;

export type UserClarificationReason = (typeof USER_CLARIFICATION_REASONS)[number];

export type UserClarificationStatus = "requested" | "answered" | "cancelled" | "superseded";

export type UserClarificationBlockingLevel = "blocking" | "non_blocking";

export type UserClarificationQuestion = {
  questionId: string;
  prompt: string;
  reason: UserClarificationReason;
  relatedCandidateRefs: string[];
  blocking: boolean;
};

export type UserClarificationRequest = {
  requestId: string;
  goalId: string;
  relatedCandidateRefs: string[];
  primaryReason: UserClarificationReason;
  questions: UserClarificationQuestion[];
  blockingLevel: "blocking";
  createdAt: string;
  status: UserClarificationStatus;
};

export type UserClarificationAnswer = {
  questionId: string;
  answer: string;
  selectedOptionId?: string;
  evidenceRefs: string[];
};

export type UserClarificationResponse = {
  requestId: string;
  goalId: string;
  answeredAt: string;
  status: Extract<UserClarificationStatus, "answered">;
  answers: UserClarificationAnswer[];
  evidenceRefs: string[];
};

export type OpenQuestionDisposition = {
  candidateId: string;
  reason: UserClarificationReason;
  question: string;
  blockingLevel: UserClarificationBlockingLevel;
  disposition: "request_user_clarification" | "remain_open";
  evidenceRefs: string[];
};

export type UnknownClarificationClassification = {
  openQuestions: OpenQuestionDisposition[];
  userClarificationRequest?: UserClarificationRequest;
};

export class UserClarificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserClarificationError";
  }
}

export function createOpenQuestionDisposition(input: {
  candidateId: string;
  reason: UserClarificationReason;
  question?: string;
  blockingLevel: UserClarificationBlockingLevel;
  evidenceRefs?: readonly string[];
}): OpenQuestionDisposition {
  return {
    candidateId: input.candidateId,
    reason: input.reason,
    question: input.question ?? defaultQuestionForReason(input.reason, input.candidateId),
    blockingLevel: input.blockingLevel,
    disposition: input.blockingLevel === "blocking" ? "request_user_clarification" : "remain_open",
    evidenceRefs: [...(input.evidenceRefs ?? [])],
  };
}

export function createDefaultBlockingQuestionDisposition(candidateId: string): OpenQuestionDisposition {
  return createOpenQuestionDisposition({
    candidateId,
    reason: "critical_fact_missing",
    blockingLevel: "blocking",
  });
}

export function classifyUnknownsForClarification(input: {
  goalId: string;
  unknownCandidateRefs: readonly string[];
  dispositions?: readonly OpenQuestionDisposition[];
  requestId: string;
  createdAt: string;
  status?: UserClarificationStatus;
}): UnknownClarificationClassification {
  const unknownCandidateRefs = [...input.unknownCandidateRefs];
  if (unknownCandidateRefs.length === 0) {
    return { openQuestions: [] };
  }

  const unknownCandidateIds = new Set(unknownCandidateRefs);
  const dispositionByCandidateId = new Map<string, OpenQuestionDisposition>();
  for (const disposition of input.dispositions ?? []) {
    if (!unknownCandidateIds.has(disposition.candidateId)) {
      throw new UserClarificationError(
        `Open question disposition references a non-unknown candidate: ${disposition.candidateId}.`
      );
    }
    dispositionByCandidateId.set(disposition.candidateId, cloneOpenQuestionDisposition(disposition));
  }

  const openQuestions = unknownCandidateRefs.map(
    (candidateId) =>
      dispositionByCandidateId.get(candidateId) ?? createDefaultBlockingQuestionDisposition(candidateId)
  );
  const blockingQuestions = openQuestions.filter((question) => question.blockingLevel === "blocking");
  if (blockingQuestions.length === 0) {
    return { openQuestions };
  }

  const relatedCandidateRefs = [...new Set(blockingQuestions.map((question) => question.candidateId))];
  const questions = blockingQuestions.map((question, index) => ({
    questionId: `${input.requestId}:question-${index + 1}`,
    prompt: question.question,
    reason: question.reason,
    relatedCandidateRefs: [question.candidateId],
    blocking: true,
  }));

  return {
    openQuestions,
    userClarificationRequest: {
      requestId: input.requestId,
      goalId: input.goalId,
      relatedCandidateRefs,
      primaryReason: questions[0]?.reason ?? "critical_fact_missing",
      questions,
      blockingLevel: "blocking",
      createdAt: input.createdAt,
      status: input.status ?? "requested",
    },
  };
}

export function cloneOpenQuestionDisposition(disposition: OpenQuestionDisposition): OpenQuestionDisposition {
  return {
    ...disposition,
    evidenceRefs: [...disposition.evidenceRefs],
  };
}

export function cloneUserClarificationRequest(request: UserClarificationRequest): UserClarificationRequest {
  return {
    ...request,
    relatedCandidateRefs: [...request.relatedCandidateRefs],
    questions: request.questions.map((question) => ({
      ...question,
      relatedCandidateRefs: [...question.relatedCandidateRefs],
    })),
  };
}

export function cloneUserClarificationResponse(response: UserClarificationResponse): UserClarificationResponse {
  return {
    ...response,
    answers: response.answers.map((answer) => ({
      ...answer,
      evidenceRefs: [...answer.evidenceRefs],
    })),
    evidenceRefs: [...response.evidenceRefs],
  };
}

export function assertUserClarificationResponseMatchesRequest(
  request: UserClarificationRequest,
  response: UserClarificationResponse
): void {
  if (request.status !== "requested") {
    throw new UserClarificationError(`Cannot recover from clarification request in ${request.status} status.`);
  }
  if (response.status !== "answered") {
    throw new UserClarificationError("Clarification recovery requires an answered response.");
  }
  if (response.requestId !== request.requestId) {
    throw new UserClarificationError("Clarification response requestId must match the request.");
  }
  if (response.goalId !== request.goalId) {
    throw new UserClarificationError("Clarification response goalId must match the request.");
  }
  if (typeof response.answeredAt !== "string" || response.answeredAt.trim() === "") {
    throw new UserClarificationError("Clarification response must record answeredAt.");
  }

  const requiredQuestionIds = new Set(request.questions.map((question) => question.questionId));
  const answeredQuestionIds = new Set<string>();
  for (const answer of response.answers) {
    if (!requiredQuestionIds.has(answer.questionId)) {
      throw new UserClarificationError(`Clarification response answers unknown question: ${answer.questionId}.`);
    }
    if (typeof answer.answer !== "string" || answer.answer.trim() === "") {
      throw new UserClarificationError(`Clarification response answer is empty: ${answer.questionId}.`);
    }
    answeredQuestionIds.add(answer.questionId);
  }
  for (const questionId of requiredQuestionIds) {
    if (!answeredQuestionIds.has(questionId)) {
      throw new UserClarificationError(`Clarification response is missing answer for question: ${questionId}.`);
    }
  }
}

function defaultQuestionForReason(reason: UserClarificationReason, candidateId: string): string {
  switch (reason) {
    case "goal_conflict":
      return `Clarify which goal should win before candidate ${candidateId} can guide the direction.`;
    case "permission_boundary_unclear":
      return `Clarify the permission boundary before candidate ${candidateId} can guide the direction.`;
    case "critical_fact_missing":
      return `Provide the missing critical fact before candidate ${candidateId} can guide the direction.`;
    case "value_tradeoff_required":
      return `Choose the value tradeoff before candidate ${candidateId} can guide the direction.`;
    case "hard_constraint_unclear":
      return `Clarify the hard constraint before candidate ${candidateId} can guide the direction.`;
  }
}
