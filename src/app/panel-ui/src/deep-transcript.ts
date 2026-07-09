export type TimestampedConversationTurn = {
  readonly createdAt: string;
};

export type DeepConversationTurnPartition<TTurn extends TimestampedConversationTurn> = {
  readonly leadingTurns: readonly TTurn[];
  readonly trailingTurns: readonly TTurn[];
};

export function splitConversationTurnsAroundRun<TTurn extends TimestampedConversationTurn>(
  turns: readonly TTurn[],
  runUpdatedAt: string,
): DeepConversationTurnPartition<TTurn> {
  const runUpdatedAtValue = timestampValue(runUpdatedAt);
  if (!Number.isFinite(runUpdatedAtValue)) {
    return {
      leadingTurns: turns,
      trailingTurns: [],
    };
  }
  const leadingTurns: TTurn[] = [];
  const trailingTurns: TTurn[] = [];
  for (const turn of turns) {
    if (timestampValue(turn.createdAt) > runUpdatedAtValue) {
      trailingTurns.push(turn);
      continue;
    }
    leadingTurns.push(turn);
  }
  return {
    leadingTurns,
    trailingTurns,
  };
}

function timestampValue(timestamp: string): number {
  const value = Date.parse(timestamp);
  return Number.isFinite(value) ? value : Number.NaN;
}
