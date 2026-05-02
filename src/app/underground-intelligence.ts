import type { Constraint } from "../domain/contracts.js";
import type { IntelligenceChannel, ModelOutputContract } from "../domain/intelligence/index.js";
import type { RootletOutput } from "../domain/underground/index.js";
import { createId, nowIso } from "../kernel/id.js";

export const UNDERGROUND_ROOTLET_CANDIDATE_ADVICE_CONTRACT: ModelOutputContract = {
  contractId: "underground.rootlet_candidate_advice.v1",
  outputKind: "candidate",
  format: "json_object",
  requiredFields: ["summary"],
  requiredStringFields: ["summary"],
};

export async function requestUndergroundRootletCandidateAdvice(input: {
  readonly intelligenceChannel: IntelligenceChannel;
  readonly traceId: string;
  readonly goalId: string;
  readonly goal: string;
  readonly producedByAgentId: string;
  readonly constraints: readonly Constraint[];
}): Promise<RootletOutput[]> {
  const requestId = createId("model-request");
  const response = await input.intelligenceChannel.request({
    requestId,
    traceId: input.traceId,
    callerRef: { kind: "goal", id: input.goalId },
    purpose: "rootlet_candidate",
    inputRefs: [{ kind: "goal", id: input.goalId }],
    sanitizedMessages: [
      {
        role: "system",
        content:
          "Return a JSON object with a concise rootlet candidate summary. The result is advice only and cannot approve a Direction Handoff.",
        ref: "docs/开发指南/04-模型与契约/08-智能通道契约.md",
      },
      {
        role: "user",
        content: `Goal: ${input.goal}`,
        ref: input.goalId,
      },
    ],
    outputContract: UNDERGROUND_ROOTLET_CANDIDATE_ADVICE_CONTRACT,
    constraintRefs: input.constraints.map((constraint) => ({
      constraintId: constraint.id,
      requiredLevel: constraint.level,
      enforcementGate: constraint.enforcementGate,
    })),
    budget: {
      maxOutputTokens: 256,
      maxLatencyMs: 30_000,
    },
    sensitivity: "internal",
    requestedAt: nowIso(),
  });

  if (response.status !== "completed" || response.validation.status !== "passed") {
    return [];
  }

  const summary = rootletSummaryFromModelOutput(response.structuredOutput);
  if (summary === undefined) {
    return [];
  }

  return [
    {
      outputId: createId("rootlet-output"),
      clusterId: "rootlet-option",
      kind: "option",
      producedByAgentId: input.producedByAgentId,
      summary,
      sourceRefs: [input.goalId, response.requestId, response.responseId],
      evidenceRefs: [`model-call:${response.responseId}`],
      soilAssetFitRefs: [],
      constraintRefs: [],
      riskRefs: [],
      status: "produced",
    },
  ];
}

function rootletSummaryFromModelOutput(output: unknown): string | undefined {
  if (typeof output !== "object" || output === null || Array.isArray(output)) {
    return undefined;
  }
  const summary = (output as { summary?: unknown }).summary;
  return typeof summary === "string" && summary.trim().length > 0 ? summary.trim() : undefined;
}
