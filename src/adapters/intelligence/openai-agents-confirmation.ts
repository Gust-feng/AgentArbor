import type { ConfirmationDecision, ConfirmationRequest } from "../../domain/confirmation/index.js";
import type { ToolCallRequest, ToolCallResult } from "../../domain/tools/index.js";

export type OpenAIAgentsPendingConfirmation<TInterruption> = {
  readonly interruption: TInterruption;
  readonly request: ToolCallRequest;
  readonly confirmation: ConfirmationRequest;
};

export function pendingOpenAIAgentsConfirmations<TInterruption extends { readonly rawItem: unknown }>(
  interruptions: readonly TInterruption[],
  resolve: (callId: string) => {
    readonly request: ToolCallRequest;
    readonly confirmation?: ConfirmationRequest;
  } | undefined,
): readonly OpenAIAgentsPendingConfirmation<TInterruption>[] | undefined {
  const pending: OpenAIAgentsPendingConfirmation<TInterruption>[] = [];
  const callIds = new Set<string>();
  const confirmationIds = new Set<string>();
  for (const interruption of interruptions) {
    const callId = interruptionCallId(interruption.rawItem);
    const fact = callId === undefined ? undefined : resolve(callId);
    if (
      callId === undefined ||
      fact?.confirmation === undefined ||
      callIds.has(callId) ||
      confirmationIds.has(fact.confirmation.confirmationId)
    ) {
      return undefined;
    }
    callIds.add(callId);
    confirmationIds.add(fact.confirmation.confirmationId);
    pending.push({
      interruption,
      request: fact.request,
      confirmation: fact.confirmation,
    });
  }
  return pending;
}

export function selectOpenAIAgentsConfirmationDecisions<TInterruption>(
  pending: readonly OpenAIAgentsPendingConfirmation<TInterruption>[],
  decisions: readonly ConfirmationDecision[],
): readonly {
  readonly pending: OpenAIAgentsPendingConfirmation<TInterruption>;
  readonly decision: ConfirmationDecision;
}[] | undefined {
  if (decisions.length === 0) {
    return undefined;
  }
  const byConfirmationId = new Map(pending.map((item) => [item.confirmation.confirmationId, item]));
  const selected: {
    pending: OpenAIAgentsPendingConfirmation<TInterruption>;
    decision: ConfirmationDecision;
  }[] = [];
  const seen = new Set<string>();
  for (const decision of decisions) {
    const item = byConfirmationId.get(decision.confirmationId);
    if (
      item === undefined ||
      seen.has(decision.confirmationId) ||
      decision.runId !== item.confirmation.runId
    ) {
      return undefined;
    }
    seen.add(decision.confirmationId);
    selected.push({ pending: item, decision });
  }
  return selected;
}

export function openAIAgentsRejectionMessage(decision: ConfirmationDecision): string {
  return decision.decision === "guidance"
    ? decision.guidance?.trim() || "The user rejected this tool call and provided no guidance."
    : "The user rejected this tool call.";
}

export function rejectedOpenAIAgentsToolResult(
  request: ToolCallRequest,
  decision: ConfirmationDecision,
): ToolCallResult {
  return {
    ...request,
    output: decision.decision === "guidance" ? { guidance: decision.guidance ?? "" } : undefined,
    status: "cancelled",
    error: openAIAgentsRejectionMessage(decision),
    errorFacts: { decision: decision.decision },
    durationMs: 0,
  };
}

function interruptionCallId(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const callId = (value as Readonly<Record<string, unknown>>).callId;
  return typeof callId === "string" ? callId : undefined;
}
