/*
 * Unified LLM Protocol Types Draft
 * Author: Manus AI
 * Generated: 2026-05-20 GMT+8
 *
 * This file is a provider-neutral draft for adapters targeting:
 * - OpenAI Responses
 * - OpenAI Chat Completions compatible providers
 * - Anthropic Messages
 */

export type ProviderId =
  | "openai"
  | "anthropic"
  | "deepseek"
  | "zai_glm"
  | "kimi_moonshot"
  | "minimax";

export type ProtocolFamily =
  | "openai_responses"
  | "openai_chat_completions"
  | "anthropic_messages";

export type MessageRole = "system" | "developer" | "user" | "assistant" | "tool";

export type ContentPart =
  | TextPart
  | ImagePart
  | AudioPart
  | VideoPart
  | FilePart
  | ToolUsePart
  | ToolResultPart
  | ReasoningPart;

export interface TextPart {
  type: "text";
  text: string;
}

export interface ImagePart {
  type: "image";
  url?: string;
  base64?: string;
  media_type?: string;
}

export interface AudioPart {
  type: "audio";
  url?: string;
  base64?: string;
  media_type?: string;
}

export interface VideoPart {
  type: "video";
  url: string;
  media_type?: string;
}

export interface FilePart {
  type: "file";
  url?: string;
  file_id?: string;
  filename?: string;
  media_type?: string;
}

export interface ReasoningPart {
  type: "reasoning";
  text?: string;
  signature?: string;
  provider_field?: string;
}

export interface ToolUsePart {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultPart {
  type: "tool_result";
  tool_use_id: string;
  content: string | ContentPart[];
  is_error?: boolean;
}

export interface UnifiedMessage {
  id?: string;
  role: MessageRole;
  content: string | ContentPart[];
  name?: string;
  tool_call_id?: string;
  partial?: boolean;
  raw_provider_message?: unknown;
  provider_options?: Record<string, unknown>;
}

export interface UnifiedTool {
  type: "function";
  name: string;
  description?: string;
  input_schema: JsonSchema;
  strict?: boolean;
}

export type ToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; name: string };

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  enum?: unknown[];
  items?: JsonSchema;
  description?: string;
  [key: string]: unknown;
}

export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "max";

export interface UnifiedReasoningConfig {
  enabled?: boolean;
  effort?: ReasoningEffort;
  budget_tokens?: number;
  adaptive?: boolean;
  /**
   * Whether adapter should preserve provider-specific hidden/visible reasoning
   * in conversation history when the provider requires it.
   */
  preserve_in_history?: boolean;
  /** Provider-specific pass-through values, e.g. MiniMax reasoning_split. */
  provider_options?: Record<string, unknown>;
}

export type StructuredOutputMode = "strict_json_schema" | "json_schema" | "json_object" | "prompt_only";

export interface UnifiedStructuredOutput {
  mode: StructuredOutputMode;
  name?: string;
  schema?: JsonSchema;
  strict?: boolean;
  /** If true, adapter may downgrade strict schema to JSON mode or prompt-only JSON. */
  allow_downgrade?: boolean;
}

export interface UnifiedStateConfig {
  /** OpenAI Responses previous_response_id or equivalent state pointer. */
  previous_response_id?: string;
  /** OpenAI Conversations or provider-managed state identifier. */
  conversation_id?: string;
  /** Whether provider should store response, if supported. */
  store?: boolean;
  /** Whether client adapter must append full assistant message, including reasoning/tool calls. */
  preserve_full_assistant_message?: boolean;
  metadata?: Record<string, string>;
}

export interface UnifiedGenerateRequest {
  provider: ProviderId;
  model: string;
  protocol_family?: ProtocolFamily;
  system?: string | ContentPart[];
  developer?: string | ContentPart[];
  messages: UnifiedMessage[];
  tools?: UnifiedTool[];
  tool_choice?: ToolChoice;
  reasoning?: UnifiedReasoningConfig;
  structured_output?: UnifiedStructuredOutput;
  state?: UnifiedStateConfig;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number;
  stop?: string | string[];
  user?: string;
  metadata?: Record<string, string>;
  provider_options?: Record<string, unknown>;
}

export interface UnifiedGenerateResponse {
  id?: string;
  provider: ProviderId;
  model: string;
  protocol_family: ProtocolFamily;
  role: "assistant";
  content: ContentPart[];
  text?: string;
  reasoning?: ReasoningPart[];
  tool_calls?: UnifiedToolCall[];
  usage?: UnifiedUsage;
  stop_reason?: string;
  state?: UnifiedStateResult;
  raw_response?: unknown;
}

export interface UnifiedToolCall {
  id: string;
  name: string;
  arguments: unknown;
  arguments_json?: string;
  index?: number;
  raw_tool_call?: unknown;
}

export interface UnifiedUsage {
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  total_tokens?: number;
  raw_usage?: unknown;
}

export interface UnifiedStateResult {
  response_id?: string;
  previous_response_id?: string;
  conversation_id?: string;
  provider_state?: unknown;
}

export type UnifiedStreamEvent =
  | StreamMessageStart
  | StreamTextDelta
  | StreamReasoningDelta
  | StreamToolCallStart
  | StreamToolCallDelta
  | StreamToolCallDone
  | StreamUsageDelta
  | StreamMessageStop
  | StreamError
  | StreamUnknown;

export interface BaseStreamEvent {
  provider: ProviderId;
  protocol_family: ProtocolFamily;
  sequence?: number;
  raw_event?: unknown;
  raw_chunk?: unknown;
}

export interface StreamMessageStart extends BaseStreamEvent {
  type: "message_start";
  id?: string;
  model?: string;
}

export interface StreamTextDelta extends BaseStreamEvent {
  type: "text_delta";
  delta: string;
  index?: number;
}

export interface StreamReasoningDelta extends BaseStreamEvent {
  type: "reasoning_delta";
  delta: string;
  index?: number;
  signature_delta?: string;
}

export interface StreamToolCallStart extends BaseStreamEvent {
  type: "tool_call_start";
  tool_call_id: string;
  name?: string;
  index?: number;
}

export interface StreamToolCallDelta extends BaseStreamEvent {
  type: "tool_call_delta";
  tool_call_id?: string;
  name_delta?: string;
  arguments_delta?: string;
  index?: number;
}

export interface StreamToolCallDone extends BaseStreamEvent {
  type: "tool_call_done";
  tool_call: UnifiedToolCall;
}

export interface StreamUsageDelta extends BaseStreamEvent {
  type: "usage_delta";
  usage: UnifiedUsage;
}

export interface StreamMessageStop extends BaseStreamEvent {
  type: "message_stop";
  stop_reason?: string;
  usage?: UnifiedUsage;
}

export interface StreamError extends BaseStreamEvent {
  type: "error";
  error: UnifiedError;
}

export interface StreamUnknown extends BaseStreamEvent {
  type: "unknown";
  provider_type?: string;
}

export interface UnifiedError {
  provider: ProviderId;
  status?: number;
  code?: string;
  type?: string;
  message: string;
  request_id?: string;
  raw_error?: unknown;
  retryable?: boolean;
}

export interface ProviderCapability {
  provider: ProviderId;
  protocol_families: ProtocolFamily[];
  default_protocol_family: ProtocolFamily;
  supports: {
    tools: boolean;
    streaming: boolean;
    reasoning: boolean;
    structured_output: "strict" | "json_schema" | "json_object" | "prompt_only" | false;
    server_side_state: boolean;
    prompt_cache: boolean | "native_only" | "unknown";
    multimodal_input: boolean | string[];
  };
  limits?: {
    context_window?: number;
    max_tools?: number;
    temperature_min?: number;
    temperature_max?: number;
    n_values?: number[];
  };
  ignored_fields?: string[];
  adapter_notes?: string[];
}

export interface ProviderAdapter<ProviderRequest = unknown, ProviderResponse = unknown> {
  readonly provider: ProviderId;
  readonly defaultProtocolFamily: ProtocolFamily;
  readonly capability: ProviderCapability;
  toProviderRequest(request: UnifiedGenerateRequest): ProviderRequest;
  fromProviderResponse(response: ProviderResponse): UnifiedGenerateResponse;
  parseStreamChunk?(chunk: unknown): UnifiedStreamEvent[];
  toProviderToolResult?(message: UnifiedMessage): unknown;
}
