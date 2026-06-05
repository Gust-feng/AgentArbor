export type WorklineTaskStatus =
  | "queued"
  | "planning"
  | "running"
  | "needs_input"
  | "approval_needed"
  | "paused"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled"
  | "pending";

export type WorklineConversationTurn = {
  readonly turnId: string;
  readonly role: "user" | "assistant";
  readonly title?: string;
  readonly content: string;
  readonly status: string;
  readonly runId?: string;
};

export type WorklineTranscriptNode = {
  readonly runId: string;
};

export type WorklineProjectedTurn<TTurn extends WorklineConversationTurn> = {
  readonly turn: TTurn;
  readonly displayRunId?: string;
  readonly claimedCurrentRun: boolean;
};

export type ChatWorklineProjection<TTurn extends WorklineConversationTurn> = {
  readonly turns: readonly WorklineProjectedTurn<TTurn>[];
  readonly standaloneRun: boolean;
};

export function projectChatWorkline<TTurn extends WorklineConversationTurn>(input: {
  readonly turns: readonly TTurn[];
  readonly currentRunId: string | undefined;
  readonly currentRunStatus: WorklineTaskStatus | undefined;
  readonly transcriptNodes: readonly WorklineTranscriptNode[];
  readonly hasAnswer: boolean;
  readonly hasLiveAnswer: boolean;
  readonly hasPendingConfirmation: boolean;
  readonly hasDeliverable: boolean;
}): ChatWorklineProjection<TTurn> {
  const runIdsWithVisibleNodes = new Set(input.transcriptNodes.map((node) => node.runId));
  const currentRunHasMaterial = hasCurrentRunMaterial(input, runIdsWithVisibleNodes);
  const hasAssistantTurnForCurrentRun = input.currentRunId !== undefined &&
    input.turns.some((turn) => turn.role === "assistant" && turn.runId === input.currentRunId);
  const claimableTurnId = hasAssistantTurnForCurrentRun || !currentRunHasMaterial
    ? undefined
    : latestClaimableAssistantTurnId(input.turns);

  const projectedTurns = input.turns
    .map((turn): WorklineProjectedTurn<TTurn> => {
      const claimedCurrentRun = claimableTurnId !== undefined && turn.turnId === claimableTurnId;
      return {
        turn,
        displayRunId: turn.runId ?? (claimedCurrentRun ? input.currentRunId : undefined),
        claimedCurrentRun,
      };
    })
    .filter((projection) => shouldShowTurn(projection, input.currentRunId, runIdsWithVisibleNodes, currentRunHasMaterial));

  const projectedAssistantOwnsCurrentRun = input.currentRunId !== undefined &&
    projectedTurns.some((projection) =>
      projection.turn.role === "assistant" &&
      projection.displayRunId === input.currentRunId
    );

  return {
    turns: projectedTurns,
    standaloneRun: input.currentRunId !== undefined &&
      !projectedAssistantOwnsCurrentRun &&
      currentRunHasMaterial,
  };
}

function hasCurrentRunMaterial<TTurn extends WorklineConversationTurn>(
  input: {
    readonly currentRunId: string | undefined;
    readonly currentRunStatus: WorklineTaskStatus | undefined;
    readonly hasAnswer: boolean;
    readonly hasLiveAnswer: boolean;
    readonly hasPendingConfirmation: boolean;
    readonly hasDeliverable: boolean;
  },
  runIdsWithVisibleNodes: ReadonlySet<string>
): boolean {
  if (input.currentRunId === undefined) return false;
  return runIdsWithVisibleNodes.has(input.currentRunId) ||
    input.hasAnswer ||
    input.hasLiveAnswer ||
    input.hasPendingConfirmation ||
    input.hasDeliverable ||
    input.currentRunStatus === "queued" ||
    input.currentRunStatus === "planning" ||
    input.currentRunStatus === "running" ||
    input.currentRunStatus === "approval_needed" ||
    input.currentRunStatus === "needs_input";
}

function latestClaimableAssistantTurnId<TTurn extends WorklineConversationTurn>(
  turns: readonly TTurn[]
): string | undefined {
  return [...turns].reverse().find((turn) =>
    turn.role === "assistant" &&
    turn.runId === undefined &&
    turn.content.trim().length === 0 &&
    (turn.status === "running" || turn.status === "pending")
  )?.turnId;
}

function shouldShowTurn<TTurn extends WorklineConversationTurn>(
  projection: WorklineProjectedTurn<TTurn>,
  currentRunId: string | undefined,
  runIdsWithVisibleNodes: ReadonlySet<string>,
  currentRunHasMaterial: boolean
): boolean {
  const turn = projection.turn;
  if (turn.role === "user") return true;
  if (turn.content.trim().length > 0) return true;
  if (projection.displayRunId !== undefined && runIdsWithVisibleNodes.has(projection.displayRunId)) return true;
  if (projection.claimedCurrentRun) return true;
  if (turn.status !== "running" && turn.status !== "pending") return false;
  if (turn.runId !== undefined) return turn.runId === currentRunId;
  return currentRunId === undefined || !currentRunHasMaterial;
}
