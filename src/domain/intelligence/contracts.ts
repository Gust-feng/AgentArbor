import type { ArtifactRef } from "../common.js";
import type { ConstraintRef } from "../constraints.js";
import type { ObservationRef } from "../observation/contracts.js";
import type { ToolCallRequest, ToolDefinition } from "../tools/index.js";

export const MODEL_PROTOCOL_KINDS = [
  "openai_compatible_chat_completions",
  "openai_responses",
  "anthropic_messages",
  "gemini_generate_content",
] as const;

export type ModelProtocolKind = (typeof MODEL_PROTOCOL_KINDS)[number];

export type ModelProviderKind = "fake" | "openai_compatible" | "openai" | "anthropic" | "gemini" | "local";

export type ModelPurpose =
  | "intent_profile"
  | "rootlet_candidate"
  | "counterfactual"
  | "growth_governance"
  | "plan_draft"
  | "verification_advice"
  | "governance_advice"
  | "autonomy_decision"
  | "convergence_advisory"
  | "convergence_judgment"
  | "handoff_narrative"
  | "candidate_aggregation"
  | "desktop_intent_gate"
  | "desktop_agent"
  | "desktop_chat"
  | "work_session_decision"
  | "work_session_child_material"
  | "work_session_synthesis"
  | "work_session_direct_answer";

export type ModelOutputKind = "candidate" | "draft" | "explanation" | "evidence_suggestion";

export type ModelMessage = {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
  readonly ref?: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly toolCalls?: readonly ToolCallRequest[];
  /**
   * Opaque protocol continuation fields returned by an adapter and replayed only
   * to that adapter during a tool-use loop. These fields are never projected to
   * EventLog, panel read models, Plan material, or user-visible output.
   */
  readonly protocolExtensions?: Readonly<Record<string, unknown>>;
};

export type ModelBudget = {
  readonly maxInputTokens?: number;
  readonly maxOutputTokens?: number;
  readonly maxTotalTokens?: number;
  readonly maxLatencyMs?: number;
  readonly maxCostUsd?: number;
};

export type ModelOutputContract = {
  readonly contractId: string;
  readonly outputKind: ModelOutputKind;
  readonly format: "json_object" | "text";
  readonly requiredFields?: readonly string[];
  readonly requiredStringFields?: readonly string[];
  readonly minTextLength?: number;
  readonly maxTextLength?: number;
  readonly visibleOutput?: {
    readonly arrayField?: string;
    readonly fields: readonly string[];
    readonly fieldTypes?: Readonly<Record<string, ModelVisibleOutputFieldType>>;
    readonly maxItems?: number;
    readonly maxFieldLength?: number;
  };
};

export type ModelOutputValidationIssue = {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
};

export type ModelOutputValidationResult = {
  readonly status: "pending" | "passed" | "failed";
  readonly checkedAt: string;
  readonly issues: readonly ModelOutputValidationIssue[];
};

export type ModelVisibleOutputFieldType = "string" | "string_array";

export type ModelVisibleOutputField = {
  readonly name: string;
  readonly value: string;
  readonly truncated: boolean;
};

export type ModelVisibleOutputItem = {
  readonly itemId: string;
  readonly fields: readonly ModelVisibleOutputField[];
};

export type ModelVisibleOutputProjection = {
  readonly source: "structured_output" | "text_output";
  readonly contractId: string;
  readonly outputKind: ModelOutputKind;
  readonly validationStatus: ModelOutputValidationResult["status"];
  readonly rootletKind?: string;
  readonly items: readonly ModelVisibleOutputItem[];
  readonly truncated: boolean;
};

export type ModelRequest = {
  readonly requestId: string;
  readonly traceId: string;
  readonly callerRef: ObservationRef | string;
  readonly purpose: ModelPurpose;
  readonly inputRefs: readonly ObservationRef[];
  readonly sanitizedMessages: readonly ModelMessage[];
  readonly tools?: readonly ToolDefinition[];
  readonly toolChoice?: ModelToolChoice;
  readonly outputContract: ModelOutputContract;
  readonly constraintRefs: readonly ConstraintRef[];
  readonly budget: ModelBudget;
  readonly sensitivity: "public" | "internal" | "restricted";
  readonly requestedAt: string;
};

export type ModelToolChoice =
  | "auto"
  | "none"
  | { readonly type: "function"; readonly function: { readonly name: string } };

export type ModelToolCall = ToolCallRequest;

export type ModelUsage = {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly estimatedCostUsd?: number;
  readonly latencyMs?: number;
};

export type ModelOutputDelta = {
  readonly requestId: string;
  readonly purpose?: ModelPurpose;
  readonly providerId: string;
  readonly model: string;
  readonly delta: string;
  readonly index: number;
  readonly createdAt: string;
};

export type ModelFailureKind =
  | "request_validation"
  | "provider_config"
  | "provider_auth"
  | "provider_rate_limit"
  | "provider_timeout"
  | "provider_network"
  | "provider_response"
  | "output_validation";

export type ModelFailure = {
  readonly kind: ModelFailureKind;
  readonly retryable: boolean;
  readonly message: string;
  readonly sanitizedErrorRef?: string;
};

export type ModelResponse = {
  readonly responseId: string;
  readonly requestId: string;
  readonly providerId: string;
  readonly providerKind: ModelProviderKind;
  readonly protocolKind: ModelProtocolKind;
  readonly model: string;
  readonly status: "completed" | "failed" | "cancelled";
  readonly outputKind: ModelOutputKind;
  readonly structuredOutput?: unknown;
  readonly textOutput?: string;
  readonly textOutputRef?: ArtifactRef;
  readonly assistantMessage?: ModelMessage;
  readonly toolCalls?: readonly ToolCallRequest[];
  readonly usage?: ModelUsage;
  readonly finishReason?: "stop" | "length" | "tool_call" | "content_filter" | "error";
  readonly validation: ModelOutputValidationResult;
  readonly failure?: ModelFailure;
  readonly completedAt: string;
};

export type ModelCallRef = {
  readonly requestId: string;
  readonly responseId?: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly outputKind: ModelOutputKind;
  readonly eventRefs: readonly string[];
  readonly validationStatus: "pending" | "passed" | "failed";
};

export type ModelProvider = {
  readonly providerId: string;
  readonly providerKind: ModelProviderKind;
  readonly protocolKind: ModelProtocolKind;
  readonly model: string;
  complete(request: ModelRequest): Promise<ModelResponse>;
};

export type IntelligenceChannel = {
  request(request: ModelRequest): Promise<ModelResponse>;
  validateResponse(request: ModelRequest, response: ModelResponse): ModelOutputValidationResult;
};
