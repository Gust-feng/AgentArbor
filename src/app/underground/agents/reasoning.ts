/**
 * @deprecated 废弃候选（T4-1 / ADR-0025 deep 一期）— ②' 固定拓扑主体（强耦合 directionHandoffPackage/Plan，不做本期主线）。
 *
 * 替代物：src/app/deep/* DeepRuntime（manager 自由决策循环 → 一层 child 探索 → 父层综合）；
 * 正式入口 POST /api/deep/conversations + /api/deep/conversations/:id/runs。
 *
 * 删除前置条件（闭环4 §8.1 阶段④）：smoke/tests 迁移完成 + 等价能力验证通过 + 无活跃引用。
 * 当前保持运行不阻塞构建；禁止改名/删除（仍被 test/smoke/compat 引用）。
 * 边界：domain/underground 的 AgentLoop/Guard/run tree/事件契约为保留复用抽象，不在退役范围。
 */
import type { Constraint } from "../../../domain/contracts.js";
import type {
  ModelCallRef,
  ModelMessage,
  ModelOutputContract,
  ModelPurpose,
  ModelResponse,
} from "../../../domain/intelligence/index.js";
import type { ObservationRef } from "../../../domain/observation/index.js";
import { sanitizeUndergroundConvergenceAiAdvisoryText } from "../../../domain/underground/index.js";
import { nowIso } from "../../../kernel/id.js";
import type {
  AgentTurnFallbackBehavior,
  AgentTurnRuntime,
  AgentTurnRuntimeResult,
} from "../../../kernel/intelligence/index.js";

export type UndergroundReasoningSource = "ai" | "deterministic_fallback";

export type UndergroundReasoningTraceEntry = {
  readonly agentId: string;
  readonly decisionSummary: string;
  readonly inputRefs: readonly string[];
  readonly modelCallRefs: readonly string[];
  readonly toolCallRefs: readonly string[];
  readonly fallbackRefs: readonly string[];
  readonly uncertainty: string;
  readonly confidence: number;
  readonly createdAt: string;
};

export type UndergroundReasoningParseResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly decisionSummary: string;
      readonly uncertainty?: string;
      readonly confidence?: number;
    }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly decisionSummary?: string;
      readonly uncertainty?: string;
      readonly confidence?: number;
    };

export type UndergroundReasoningResult<T> = {
  readonly status: "completed" | "failed" | "runtime_unavailable";
  readonly source: UndergroundReasoningSource;
  readonly value?: T;
  readonly confidence: number;
  readonly modelCallRefs: readonly ModelCallRef[];
  readonly toolCallRefs: readonly string[];
  readonly toolCallOutputs: readonly unknown[];
  readonly fallbackRefs: readonly string[];
  readonly reasoningTrace: readonly UndergroundReasoningTraceEntry[];
  readonly finalOutput?: ModelResponse;
  readonly failureReason?: string;
};

export async function reasonWithAgentTurn<T>(input: {
  readonly agentId: string;
  readonly agentTurnRuntime?: AgentTurnRuntime;
  readonly traceId: string;
  readonly goalId: string;
  readonly purpose: ModelPurpose;
  readonly outputContract: ModelOutputContract;
  readonly callerRef: ObservationRef;
  readonly inputRefs: readonly ObservationRef[];
  readonly inputRefIds: readonly string[];
  readonly messages: readonly ModelMessage[];
  readonly constraints: readonly Constraint[];
  readonly allowedTools?: readonly string[];
  readonly maxModelRounds?: number;
  readonly maxToolRounds?: number;
  readonly fallback?: AgentTurnFallbackBehavior;
  readonly budget?: { readonly maxOutputTokens?: number; readonly maxLatencyMs?: number };
  readonly parse: (output: unknown, response: ModelResponse) => UndergroundReasoningParseResult<T>;
}): Promise<UndergroundReasoningResult<T>> {
  if (input.agentTurnRuntime === undefined) {
    return failedReasoning({
      agentId: input.agentId,
      inputRefs: input.inputRefIds,
      fallbackRefs: ["agentturnruntime:missing", "deterministic_fallback"],
      failureReason: "AgentTurnRuntime is not configured.",
      uncertainty: "No model/tool turn runtime is available; only low-confidence fallback material may be used.",
      confidence: 0.12,
      status: "runtime_unavailable",
    });
  }

  const turn = await input.agentTurnRuntime.execute({
    policy: {
      allowModel: true,
      allowedTools: input.allowedTools ?? [],
      maxModelRounds: input.maxModelRounds ?? 1,
      maxToolRounds: input.maxToolRounds ?? 0,
      fallback: input.fallback ?? "deterministic",
      callerAgentId: input.agentId,
      traceId: input.traceId,
      goalId: input.goalId,
      purpose: input.purpose,
      outputContract: input.outputContract,
      sensitivity: "internal",
      budget: {
        maxOutputTokens: input.budget?.maxOutputTokens ?? 512,
        maxLatencyMs: input.budget?.maxLatencyMs ?? 15_000,
      },
    },
    callerRef: input.callerRef,
    inputRefs: input.inputRefs,
    sanitizedMessages: input.messages,
    constraintRefs: input.constraints.map((constraint) => ({
      constraintId: constraint.id,
      requiredLevel: constraint.level,
      enforcementGate: constraint.enforcementGate,
    })),
    requestedAt: nowIso(),
  }, FULL_TURN_OUTPUT);

  if (turn.status !== "completed" || turn.finalOutput?.status !== "completed" || turn.finalOutput.validation.status !== "passed") {
    return failedReasoning({
      agentId: input.agentId,
      inputRefs: input.inputRefIds,
      modelCallRefs: [modelCallRefFromTurn(turn)],
      toolCallRefs: toolCallRefsFromTurn(turn),
      fallbackRefs: [`agentturnruntime:${turn.stoppedReason}`, "deterministic_fallback"],
      failureReason: "AgentTurnRuntime did not return a completed, contract-valid model response.",
      uncertainty: `Model path stopped at ${turn.stoppedReason}.`,
      confidence: 0.18,
    });
  }

  const parsed = input.parse(turn.finalOutput.structuredOutput, turn.finalOutput);
  if (!parsed.ok) {
    return failedReasoning({
      agentId: input.agentId,
      inputRefs: input.inputRefIds,
      modelCallRefs: [modelCallRefFromTurn(turn)],
      toolCallRefs: toolCallRefsFromTurn(turn),
      fallbackRefs: [`parser:${parsed.reason}`, "deterministic_fallback"],
      failureReason: parsed.reason,
      decisionSummary: parsed.decisionSummary,
      uncertainty: parsed.uncertainty ?? "The model response passed the generic contract but failed the agent parser.",
      confidence: parsed.confidence ?? 0.2,
      finalOutput: turn.finalOutput,
    });
  }

  const modelCallRefs = [modelCallRefFromTurn(turn)];
  const toolCallRefs = toolCallRefsFromTurn(turn);
  const toolCallOutputs = turn.toolCalls.map((tc) => tc.output);
  const confidence = normalizeConfidence(parsed.confidence ?? confidenceFromOutput(turn.finalOutput.structuredOutput) ?? 0.72);
  return {
    status: "completed",
    source: "ai",
    value: parsed.value,
    confidence,
    modelCallRefs,
    toolCallRefs,
    toolCallOutputs,
    fallbackRefs: [],
    reasoningTrace: [
      createReasoningTrace({
        agentId: input.agentId,
        decisionSummary: parsed.decisionSummary,
        inputRefs: input.inputRefIds,
        modelCallRefs: modelCallRefs.map((ref) => ref.requestId),
        toolCallRefs,
        fallbackRefs: [],
        uncertainty: parsed.uncertainty ?? "Model output was accepted by the agent parser and boundary guard remains responsible for hard constraints.",
        confidence,
      }),
    ],
    finalOutput: turn.finalOutput,
  };
}

const FULL_TURN_OUTPUT = { blockedToolNames: [], exposeNonFinalOutput: true } as const;

export function fallbackReasoningTrace(input: {
  readonly agentId: string;
  readonly decisionSummary: string;
  readonly inputRefs: readonly string[];
  readonly fallbackRefs: readonly string[];
  readonly uncertainty?: string;
  readonly confidence?: number;
}): readonly UndergroundReasoningTraceEntry[] {
  const confidence = normalizeConfidence(input.confidence ?? 0.18);
  return [
    createReasoningTrace({
      agentId: input.agentId,
      decisionSummary: input.decisionSummary,
      inputRefs: input.inputRefs,
      modelCallRefs: [],
      toolCallRefs: [],
      fallbackRefs: input.fallbackRefs,
      uncertainty:
        input.uncertainty ?? "This is low-confidence deterministic fallback material, not an approved semantic judgment.",
      confidence,
    }),
  ];
}

export function reasoningTraceRefs(trace: readonly UndergroundReasoningTraceEntry[]): string[] {
  return trace.flatMap((entry) => [
    ...entry.modelCallRefs,
    ...entry.toolCallRefs,
    ...entry.fallbackRefs,
  ]);
}

function failedReasoning(input: {
  readonly agentId: string;
  readonly inputRefs: readonly string[];
  readonly modelCallRefs?: readonly ModelCallRef[];
  readonly toolCallRefs?: readonly string[];
  readonly fallbackRefs: readonly string[];
  readonly failureReason: string;
  readonly decisionSummary?: string;
  readonly uncertainty: string;
  readonly confidence: number;
  readonly status?: "failed" | "runtime_unavailable";
  readonly finalOutput?: ModelResponse;
}): UndergroundReasoningResult<never> {
  const modelCallRefs = input.modelCallRefs ?? [];
  const toolCallRefs = input.toolCallRefs ?? [];
  const confidence = normalizeConfidence(input.confidence);
  return {
    status: input.status ?? "failed",
    source: "deterministic_fallback",
    confidence,
    modelCallRefs,
    toolCallRefs,
    toolCallOutputs: [],
    fallbackRefs: input.fallbackRefs,
    reasoningTrace: [
      createReasoningTrace({
        agentId: input.agentId,
        decisionSummary: input.decisionSummary ?? input.failureReason,
        inputRefs: input.inputRefs,
        modelCallRefs: modelCallRefs.map((ref) => ref.requestId),
        toolCallRefs,
        fallbackRefs: input.fallbackRefs,
        uncertainty: input.uncertainty,
        confidence,
      }),
    ],
    finalOutput: input.finalOutput,
    failureReason: input.failureReason,
  };
}

function createReasoningTrace(input: Omit<UndergroundReasoningTraceEntry, "createdAt">): UndergroundReasoningTraceEntry {
  return {
    agentId: input.agentId,
    decisionSummary: safeText(input.decisionSummary),
    inputRefs: unique(input.inputRefs),
    modelCallRefs: unique(input.modelCallRefs),
    toolCallRefs: unique(input.toolCallRefs),
    fallbackRefs: unique(input.fallbackRefs),
    uncertainty: safeText(input.uncertainty),
    confidence: normalizeConfidence(input.confidence),
    createdAt: nowIso(),
  };
}

function modelCallRefFromTurn(turn: AgentTurnRuntimeResult): ModelCallRef {
  const response = turn.finalOutput;
  return {
    requestId: turn.modelRequestId ?? "unknown-model-request",
    responseId: turn.modelResponseId,
    providerId: response?.providerId,
    model: response?.model,
    outputKind: response?.outputKind ?? "explanation",
    eventRefs: [
      "model.requested",
      response?.status === "completed" ? "model.completed" : "model.failed",
    ].filter((value): value is string => value !== undefined),
    validationStatus: response?.validation.status ?? "pending",
  };
}

function toolCallRefsFromTurn(turn: AgentTurnRuntimeResult): string[] {
  return unique(turn.toolCalls.map((toolCall) => `tool-call:${toolCall.callId}`));
}

function confidenceFromOutput(output: unknown): number | undefined {
  const record = asRecord(output);
  const value = record.confidence;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function safeText(value: string): string {
  const text = sanitizeUndergroundConvergenceAiAdvisoryText(value);
  return text.length === 0 ? "No reasoning summary available." : text;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
