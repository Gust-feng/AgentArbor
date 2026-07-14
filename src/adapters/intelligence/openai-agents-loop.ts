import { createHash } from "node:crypto";
import {
  Agent,
  type AgentOutputType,
  OpenAIProvider,
  Runner,
  type AgentInputItem,
  type FunctionTool,
  type ModelSettings,
  type RunResult,
  type RunState,
  setTracingDisabled,
  tool,
} from "@openai/agents";
import OpenAI from "openai";
import type { OpenAIModelRequestSettings } from "../../domain/config/index.js";
import type { ConfirmationRequest } from "../../domain/confirmation/index.js";
import {
  OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION,
  type ModelMessage,
  type ModelUsage,
} from "../../domain/intelligence/index.js";
import type {
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolFactValue,
} from "../../domain/tools/index.js";
import { modelVisibleToolDescription } from "../../domain/tools/index.js";
import type {
  AgentLoop,
  AgentLoopInput,
  AgentLoopResult,
} from "../../app/model-runtime/agent-loop.js";
import { isOfficialOpenAIBaseUrl } from "./openai-compatible-base-url.js";
import {
  openAIAgentsRejectionMessage,
  pendingOpenAIAgentsConfirmations,
  rejectedOpenAIAgentsToolResult,
  selectOpenAIAgentsConfirmationDecisions,
  type OpenAIAgentsPendingConfirmation,
} from "./openai-agents-confirmation.js";
import {
  canonicalToolResultMessage,
  createOpenAIAgentsInputMapper,
  type OpenAIAgentsInputMapper,
} from "./openai-agents-input.js";
import { toOpenAIFetch, type FetchLike } from "./openai-fetch-bridge.js";
import { openAIResponsesOutputItems } from "./openai-responses-continuation.js";

export type OpenAIAgentsLoopProtocol =
  | "openai_responses"
  | "openai_compatible_chat_completions";

export type OpenAIAgentsLoopConfig = {
  readonly protocol: OpenAIAgentsLoopProtocol;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly requestSettings?: OpenAIModelRequestSettings;
  readonly fetch?: FetchLike;
};

type SdkExecutionContext = {
  readonly execution: ExecutionState;
};

type SdkNonStrictObjectSchema = {
  readonly type: "object";
  readonly properties: Record<string, unknown>;
  readonly required: string[];
  readonly additionalProperties: true;
};

type PreflightFact = {
  readonly request: ToolCallRequest;
  readonly result?: ToolCallResult;
  readonly needsApproval: boolean;
};

type ExecutionState = {
  abortSignal: AbortSignal;
  readonly input: AgentLoopInput;
  readonly baseMessages: readonly ModelMessage[];
  readonly toolResults: ToolCallResult[];
  readonly preflightByCallId: Map<string, PreflightFact>;
  readonly modelInput: OpenAIAgentsInputMapper;
};

type SdkInterruption = ReturnType<RunState<
  SdkExecutionContext,
  Agent<SdkExecutionContext, AgentOutputType>
>["getInterruptions"]>[number];

type PendingInterruption = OpenAIAgentsPendingConfirmation<SdkInterruption>;

// Runner-level tracing is not sufficient in SDK 0.13.3: an outer workflow trace is
// still created. AgentArbor never exports SDK traces, so keep the process guard too.
setTracingDisabled(true);

export function createOpenAIAgentsLoop(config: OpenAIAgentsLoopConfig): AgentLoop {
  return new OpenAIAgentsLoop(config);
}

class OpenAIAgentsLoop implements AgentLoop {
  private readonly config: OpenAIAgentsLoopConfig;
  private readonly provider: OpenAIProvider;
  private readonly runner: Runner;
  private released = false;
  private releasePromise: Promise<void> | undefined;

  constructor(config: OpenAIAgentsLoopConfig) {
    validateConfig(config);
    validateRequestSettings(config.protocol, config.requestSettings);
    this.config = config;
    const openAIClient = config.fetch === undefined
      ? undefined
      : new OpenAI({
          apiKey: config.apiKey,
          baseURL: config.baseUrl,
          fetch: toOpenAIFetch(config.fetch),
        });
    this.provider = new OpenAIProvider({
      ...(openAIClient === undefined
        ? { apiKey: config.apiKey, baseURL: config.baseUrl }
        : { openAIClient }),
      useResponses: config.protocol === "openai_responses",
      strictFeatureValidation: true,
      cacheResponsesWebSocketModels: false,
    });
    this.runner = new Runner({
      modelProvider: this.provider,
      tracingDisabled: true,
      traceIncludeSensitiveData: false,
    });
  }

  async execute(input: AgentLoopInput): Promise<AgentLoopResult> {
    this.assertLive();
    const baseMessages = cloneMessages(input.messages);
    const modelInput = createOpenAIAgentsInputMapper({
      protocol: this.config.protocol,
      messages: baseMessages,
    });
    const execution: ExecutionState = {
      abortSignal: input.abortSignal,
      input,
      baseMessages,
      toolResults: [],
      preflightByCallId: new Map(),
      modelInput,
    };
    try {
      const sdkInput = modelInput.messages(input.instructions);
      const agent = this.createAgent(execution);
      const result = await this.run(agent, sdkInput, execution, input.abortSignal);
      return this.resultFromSdk(agent, result, execution);
    } catch (error) {
      return terminalErrorResult(error, execution);
    }
  }

  release(): Promise<void> {
    if (this.releasePromise !== undefined) {
      return this.releasePromise;
    }
    this.released = true;
    this.releasePromise = this.provider.close();
    return this.releasePromise;
  }

  private createAgent(execution: ExecutionState): Agent<SdkExecutionContext, AgentOutputType> {
    const definitions = frozenToolDefinitions(execution.input);
    const sdkTools = definitions.map((definition) => createSdkTool(definition, execution));
    return new Agent<SdkExecutionContext, AgentOutputType>({
      name: "AgentArborOrdinaryMechanicalLoop",
      instructions: execution.input.instructions,
      model: this.config.model,
      modelSettings: modelSettings({
        config: this.config,
        instructions: execution.input.instructions,
        tools: definitions,
      }),
      tools: sdkTools,
    });
  }

  private async run(
    agent: Agent<SdkExecutionContext, AgentOutputType>,
    input: AgentInputItem[] | RunState<SdkExecutionContext, Agent<SdkExecutionContext, AgentOutputType>>,
    execution: ExecutionState,
    abortSignal: AbortSignal,
  ): Promise<RunResult<SdkExecutionContext, Agent<SdkExecutionContext, AgentOutputType>>> {
    execution.abortSignal = abortSignal;
    const stream = execution.input.onTextDelta !== undefined && this.config.requestSettings?.stream !== false;
    if (!stream) {
      return this.runner.run(agent, input, {
        context: { execution },
        maxTurns: null,
        signal: abortSignal,
      });
    }
    const result = await this.runner.run(agent, input, {
      context: { execution },
      maxTurns: null,
      signal: abortSignal,
      stream: true,
    });
    for await (const delta of result.toTextStream()) {
      execution.input.onTextDelta?.(delta);
    }
    await result.completed;
    if (result.cancelled) {
      throw abortError("OpenAI Agents SDK stream was cancelled.");
    }
    if (result.error !== undefined && result.error !== null) {
      throw result.error;
    }
    return result;
  }

  private resultFromSdk(
    agent: Agent<SdkExecutionContext, AgentOutputType>,
    result: RunResult<SdkExecutionContext, Agent<SdkExecutionContext, AgentOutputType>>,
    execution: ExecutionState,
  ): AgentLoopResult {
    const interruptions = result.interruptions;
    if (interruptions.length > 0) {
      const pending = pendingOpenAIAgentsConfirmations(interruptions, (callId) => {
        const preflight = execution.preflightByCallId.get(callId);
        return preflight === undefined
          ? undefined
          : {
              request: preflight.request,
              confirmation: preflight.result?.confirmationRequest,
            };
      });
      if (pending === undefined) {
        return failedResult(execution, usageFromSdk(result.runContext.usage), "The SDK interruption did not match an exact ToolCenter confirmation fact.");
      }
      return this.approvalRequiredResult(agent, result, execution, pending);
    }
    const finalText = typeof result.finalOutput === "string" ? result.finalOutput : "";
    return {
      status: "completed",
      finalText,
      messages: canonicalMessagesFromResponses({
        baseMessages: execution.baseMessages,
        rawResponses: result.rawResponses,
        protocol: this.config.protocol,
        toolResults: execution.toolResults,
      }),
      toolResults: cloneToolResults(execution.toolResults),
      usage: usageFromSdk(result.runContext.usage),
      confirmationRequests: [],
    };
  }

  private approvalRequiredResult(
    agent: Agent<SdkExecutionContext, AgentOutputType>,
    result: RunResult<SdkExecutionContext, Agent<SdkExecutionContext, AgentOutputType>>,
    execution: ExecutionState,
    pending: readonly PendingInterruption[],
  ): AgentLoopResult {
    const usage = usageFromSdk(result.runContext.usage);
    let decided = false;
    return {
      status: "approval_required",
      messages: cloneMessages(execution.baseMessages),
      toolResults: cloneToolResults(execution.toolResults),
      usage,
      confirmationRequests: pending.map(({ confirmation }) => cloneConfirmation(confirmation)),
      continuation: {
        availability: "live_only",
        decide: async (input) => {
          this.assertLive();
          if (decided) {
            return failedResult(execution, usage, "This live confirmation continuation has already been decided.");
          }
          const decisions = "decision" in input ? [input.decision] : [...input.decisions];
          const selected = selectOpenAIAgentsConfirmationDecisions(pending, decisions);
          if (selected === undefined) {
            return failedResult(execution, usage, "The confirmation decisions do not match the pending tool calls.");
          }
          decided = true;
          for (const { pending: item, decision } of selected) {
            if (decision.decision === "approve_once") {
              result.state.approve(item.interruption);
            } else {
              result.state.reject(item.interruption, { message: openAIAgentsRejectionMessage(decision) });
              execution.toolResults.push(rejectedOpenAIAgentsToolResult(item.request, decision));
            }
          }
          const decidedIds = new Set(decisions.map((decision) => decision.confirmationId));
          const remaining = pending.filter(({ confirmation }) => !decidedIds.has(confirmation.confirmationId));
          if (remaining.length > 0) {
            return this.approvalRequiredResult(agent, result, execution, remaining);
          }
          try {
            const resumed = await this.run(agent, result.state, execution, input.abortSignal);
            return this.resultFromSdk(agent, resumed, execution);
          } catch (error) {
            return terminalErrorResult(error, execution);
          }
        },
      },
    };
  }

  private assertLive(): void {
    if (this.released) {
      throw new Error("OpenAI Agents loop has been released.");
    }
  }
}

function createSdkTool(
  definition: ToolDefinition,
  execution: ExecutionState,
): FunctionTool<SdkExecutionContext, SdkNonStrictObjectSchema> {
  const parameters = sdkToolInputSchema(definition);
  return tool<SdkNonStrictObjectSchema, SdkExecutionContext>({
    name: definition.name,
    description: modelVisibleToolDescription(definition),
    parameters,
    strict: false,
    needsApproval: async (_runContext, input, callId) => {
      const exactCallId = requiredCallId(callId);
      const existing = execution.preflightByCallId.get(exactCallId);
      if (existing !== undefined) {
        return existing.needsApproval;
      }
      const request = toolCallRequest(exactCallId, definition.name, input);
      const preflight = execution.input.tools.gateway.preflight(
        request,
        toolContext(execution, exactCallId),
        execution.input.tools.permission,
      );
      if (preflight.status === "ready") {
        execution.preflightByCallId.set(exactCallId, { request: preflight.request, needsApproval: false });
        return false;
      }
      const fact: PreflightFact = {
        request,
        result: preflight.result,
        needsApproval: preflight.status === "approval_required",
      };
      execution.preflightByCallId.set(exactCallId, fact);
      execution.toolResults.push(preflight.result);
      return fact.needsApproval;
    },
    execute: async (input, _runContext, details) => {
      const callId = requiredCallId(details?.toolCall?.callId);
      const cached = execution.preflightByCallId.get(callId);
      if (cached?.result !== undefined && cached.result.status !== "approval_required") {
        return execution.modelInput.toolResult(cached.result);
      }
      const request = cached?.request ?? toolCallRequest(callId, definition.name, input);
      const approvedConfirmationId = cached?.result?.confirmationRequest?.confirmationId;
      const approvedConfirmationIds = cached?.needsApproval === true
        ? uniqueStrings([
            ...(execution.input.tools.permission.approvedConfirmationIds ?? []),
            ...(approvedConfirmationId === undefined ? [] : [approvedConfirmationId]),
          ])
        : execution.input.tools.permission.approvedConfirmationIds;
      const result = await execution.input.tools.gateway.execute(
        request,
        toolContext(execution, callId),
        {
          ...execution.input.tools.permission,
          approvedConfirmationIds,
        },
      );
      execution.toolResults.push(result);
      return execution.modelInput.toolResult(result);
    },
  });
}

function toolContext(execution: ExecutionState, callId: string) {
  return {
    ...execution.input.tools.context,
    toolCallId: callId,
    abortSignal: execution.abortSignal,
  };
}

function frozenToolDefinitions(input: AgentLoopInput): readonly ToolDefinition[] {
  const allowed = new Set(input.tools.permission.allowedTools);
  return input.tools.gateway.list()
    .filter((definition) => allowed.has(definition.name))
    .map((definition) => globalThis.structuredClone(definition));
}

function modelSettings(input: {
  readonly config: OpenAIAgentsLoopConfig;
  readonly instructions: string;
  readonly tools: readonly ToolDefinition[];
}): ModelSettings {
  const settings = input.config.requestSettings;
  const officialOpenAI = isOfficialOpenAIBaseUrl(input.config.baseUrl);
  const providerData: Record<string, unknown> = officialOpenAI
    ? {
        prompt_cache_key: openAIAgentsPromptCacheKey(
          input.config.protocol,
          input.config.model,
          input.instructions,
          input.tools,
        ),
        ...(settings?.serviceTier === undefined ? {} : { service_tier: settings.serviceTier }),
        ...(input.config.protocol === "openai_responses"
          ? { include: ["reasoning.encrypted_content"] }
          : {}),
      }
    : {};
  return {
    temperature: settings?.temperature,
    topP: settings?.topP,
    maxTokens: settings?.maxOutputTokens,
    reasoning: settings?.reasoningEffort === undefined && settings?.reasoningSummary === undefined
      ? undefined
      : {
          effort: settings?.reasoningEffort,
          summary: settings?.reasoningSummary,
        },
    text: settings?.textVerbosity === undefined ? undefined : { verbosity: settings.textVerbosity },
    truncation: settings?.truncation,
    parallelToolCalls: input.tools.length === 0 ? undefined : settings?.parallelToolCalls,
    store: settings?.store,
    providerData,
  };
}

function canonicalMessagesFromResponses(input: {
  readonly baseMessages: readonly ModelMessage[];
  readonly rawResponses: readonly { readonly output: readonly unknown[] }[];
  readonly protocol: OpenAIAgentsLoopProtocol;
  readonly toolResults: readonly ToolCallResult[];
}): readonly ModelMessage[] {
  const messages = cloneMessages(input.baseMessages);
  for (const response of input.rawResponses) {
    const calls = response.output.flatMap(functionCallFromSdkItem);
    const content = response.output.flatMap(textFromSdkItem).join("");
    if (calls.length > 0 || content.length > 0) {
      const outputItems = input.protocol === "openai_responses"
        ? openAIResponsesOutputItems(response.output)
        : undefined;
      messages.push({
        role: "assistant",
        content,
        toolCalls: calls.length === 0 ? undefined : calls,
        protocolExtensions: outputItems === undefined
          ? undefined
          : { [OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION]: outputItems },
      });
    }
    for (const call of calls) {
      const result = latestResolvedToolResult(input.toolResults, call.callId);
      if (result !== undefined) {
        messages.push(toolResultMessage(result));
      }
    }
  }
  return messages;
}

function functionCallFromSdkItem(value: unknown): readonly ToolCallRequest[] {
  const record = asRecord(value);
  if (record.type !== "function_call" || typeof record.callId !== "string" || typeof record.name !== "string") {
    return [];
  }
  const input = typeof record.arguments === "string" ? parseToolInput(record.arguments) : undefined;
  return [{ callId: record.callId, toolName: record.name, input }];
}

function textFromSdkItem(value: unknown): readonly string[] {
  const record = asRecord(value);
  if (record.role !== "assistant" || !Array.isArray(record.content)) {
    return [];
  }
  return record.content.flatMap((part) => {
    const content = asRecord(part);
    return content.type === "output_text" && typeof content.text === "string" ? [content.text] : [];
  });
}

function latestResolvedToolResult(results: readonly ToolCallResult[], callId: string): ToolCallResult | undefined {
  return [...results].reverse().find((result) => result.callId === callId && result.status !== "approval_required");
}

function toolResultMessage(result: ToolCallResult): ModelMessage {
  return canonicalToolResultMessage(result);
}

function usageFromSdk(usage: {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly inputTokensDetails: readonly Readonly<Record<string, number>>[];
  readonly outputTokensDetails: readonly Readonly<Record<string, number>>[];
}): ModelUsage {
  const cachedInputTokens = sumDetail(usage.inputTokensDetails, "cached_tokens");
  const cacheWriteInputTokens = sumDetail(usage.inputTokensDetails, "cache_write_tokens");
  const reasoningOutputTokens = sumDetail(usage.outputTokensDetails, "reasoning_tokens");
  return compactUsage({
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cachedInputTokens,
    cacheWriteInputTokens,
    uncachedInputTokens: cachedInputTokens === undefined
      ? undefined
      : Math.max(0, usage.inputTokens - cachedInputTokens),
    reasoningOutputTokens,
  });
}

function sumDetail(details: readonly Readonly<Record<string, number>>[], key: string): number | undefined {
  let found = false;
  let total = 0;
  for (const detail of details) {
    const value = detail[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      found = true;
      total += value;
    }
  }
  return found ? total : undefined;
}

function compactUsage(usage: ModelUsage): ModelUsage {
  return Object.fromEntries(Object.entries(usage).filter(([, value]) => value !== undefined));
}

export function openAIAgentsPromptCacheKey(
  protocol: OpenAIAgentsLoopProtocol,
  model: string,
  instructions: string,
  tools: readonly ToolDefinition[],
): string {
  const identity = JSON.stringify({
    protocol,
    model,
    instructions,
    tools: [...tools]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((definition) => ({
        name: definition.name,
        description: modelVisibleToolDescription(definition),
        inputSchema: sdkToolInputSchema(definition),
      })),
  });
  return `agentarbor:${createHash("sha256").update(identity).digest("hex").slice(0, 32)}`;
}

function sdkToolInputSchema(definition: ToolDefinition): SdkNonStrictObjectSchema {
  return {
    type: "object",
    properties: globalThis.structuredClone(definition.inputSchema.properties),
    required: definition.inputSchema.required === undefined ? [] : [...definition.inputSchema.required],
    additionalProperties: true,
  };
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function validateConfig(config: OpenAIAgentsLoopConfig): void {
  for (const [name, value] of [["baseUrl", config.baseUrl], ["apiKey", config.apiKey], ["model", config.model]] as const) {
    if (value.trim().length === 0) {
      throw new Error(`OpenAI Agents loop ${name} must not be blank.`);
    }
  }
}

function validateRequestSettings(protocol: OpenAIAgentsLoopProtocol, settings: OpenAIModelRequestSettings | undefined): void {
  if (protocol !== "openai_compatible_chat_completions" || settings === undefined) {
    return;
  }
  const unsupported = [
    settings.reasoningSummary === undefined ? undefined : "reasoningSummary",
    settings.truncation === undefined ? undefined : "truncation",
  ].filter((value): value is string => value !== undefined);
  if (unsupported.length > 0) {
    throw new Error(`OpenAI compatible Chat Completions does not support settings: ${unsupported.join(", ")}.`);
  }
}

function toolCallRequest(callId: string, toolName: string, input: unknown): ToolCallRequest {
  return {
    callId,
    toolName,
    input: input as ToolFactValue,
  };
}

function parseToolInput(value: string): ToolFactValue | undefined {
  try {
    return JSON.parse(value) as ToolFactValue;
  } catch {
    return undefined;
  }
}

function requiredCallId(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    throw new Error("OpenAI Agents SDK did not provide a function tool call id.");
  }
  return value;
}

function terminalErrorResult(error: unknown, execution: ExecutionState): AgentLoopResult {
  const message = errorMessage(error);
  const facts = {
    messages: cloneMessages(execution.baseMessages),
    toolResults: cloneToolResults(execution.toolResults),
    usage: {},
    confirmationRequests: [],
  };
  return isAbortError(error) || execution.abortSignal.aborted
    ? { ...facts, status: "cancelled", error: message }
    : { ...facts, status: "failed", error: message };
}

function failedResult(execution: ExecutionState, usage: ModelUsage, error: string): AgentLoopResult {
  return {
    status: "failed",
    error,
    messages: cloneMessages(execution.baseMessages),
    toolResults: cloneToolResults(execution.toolResults),
    usage,
    confirmationRequests: [],
  };
}

function cloneMessages(messages: readonly ModelMessage[]): ModelMessage[] {
  return messages.map((message) => globalThis.structuredClone(message));
}

function cloneToolResults(results: readonly ToolCallResult[]): ToolCallResult[] {
  return results.map((result) => globalThis.structuredClone(result));
}

function cloneConfirmation(value: ConfirmationRequest): ConfirmationRequest {
  return globalThis.structuredClone(value);
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || /abort/iu.test(error.message));
}

function abortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}
