import { createHash } from "node:crypto";
import {
  Agent,
  type AgentOutputType,
  type CallModelInputFilter,
  type Model,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  type ModelRetryAdvice,
  type ModelRetryAdviceRequest,
  OpenAIProvider,
  retryPolicies,
  Runner,
  RunContext,
  RunResult,
  RunState,
  type ModelSettings,
  type StreamEvent,
  isOpenAIChatCompletionsRawModelStreamEvent,
  isOpenAIResponsesRawModelStreamEvent,
  setTracingDisabled,
  webSearchTool,
} from "@openai/agents";
import OpenAI from "openai";
import type { OpenAIModelRequestSettings, ProviderProtocolProfileId } from "../../domain/config/index.js";
import type { ConfirmationRequest } from "../../domain/confirmation/index.js";
import {
  type ModelMessage,
  type ModelUsage,
} from "../../domain/intelligence/index.js";
import type {
  ToolCallResult,
  ToolDefinition,
} from "../../domain/tools/index.js";
import { modelVisibleToolDescription } from "../../domain/tools/index.js";
import {
  modelErrorMessageFromError,
  modelFailureKindFromError,
} from "../../kernel/intelligence/failures.js";
import type {
  AgentLoop,
  AgentLoopAgentTool,
  AgentLoopInput,
  AgentLoopResult,
} from "../../app/model-runtime/agent-loop.js";
import { canonicalToolResultMessage } from "../../app/model-runtime/tool-result-message.js";
import {
  applyOpenAICompatibleChatDialectControls,
  applyOpenAICompatibleChatRequestPolicy,
  resolveOpenAICompatibleChatDialect,
} from "./openai-compatible-chat-protocol.js";
import {
  completedReasoningFromAgentOutput,
  OpenAIReasoningStreamNormalizer,
} from "./openai-reasoning-normalizer.js";
import {
  pendingOpenAIAgentsConfirmations,
  rejectedOpenAIAgentsToolResult,
  selectOpenAIAgentsConfirmationDecisions,
  type OpenAIAgentsPendingConfirmation,
} from "./openai-agents-confirmation.js";
import {
  canonicalMessagesFromOpenAIAgentsInput,
  createOpenAIAgentsInputMapper,
  modelMessagesForOpenAIProtocol,
} from "./openai-agents-input.js";
import { withOpenAICompatibleChatProfile } from "./openai-agents-provider-profile.js";
import { toOpenAIFetch, type FetchLike } from "./openai-fetch-bridge.js";
import { withOpenAIResponsesStreamReconciliation } from "./openai-responses-stream-reconciliation.js";
import {
  preservedOpenAIAgentsTerminalResponse,
  withOpenAIAgentsTerminalGuard,
} from "./openai-agents-terminal.js";
import {
  createOpenAIAgentsToolAssembly,
  recordOpenAIAgentsToolResult,
  openAIAgentsAgentToolCacheIdentity,
  type OpenAIAgentsExecutionState,
  type OpenAIAgentsSdkExecutionContext,
} from "./openai-agents-tools.js";

export type OpenAIAgentsLoopProtocol =
  | "openai_responses"
  | "openai_compatible_chat_completions";

export type OpenAIAgentsLoopConfig = {
  readonly protocol: OpenAIAgentsLoopProtocol;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly requestSettings?: OpenAIModelRequestSettings;
  readonly providerProfileId?: ProviderProtocolProfileId;
  readonly enableWebSearch?: boolean;
  readonly fetch?: FetchLike;
};

type ExecutionState = OpenAIAgentsExecutionState;
type SdkExecutionContext = OpenAIAgentsSdkExecutionContext;
type SdkNonStrictObjectSchema = {
  readonly type: "object";
  readonly properties: Record<string, unknown>;
  readonly required: string[];
  readonly additionalProperties: true;
};

type SdkInterruption = ReturnType<RunState<
  SdkExecutionContext,
  Agent<SdkExecutionContext, AgentOutputType>
>["getInterruptions"]>[number];

type PendingInterruption = OpenAIAgentsPendingConfirmation<SdkInterruption>;

// Runner-level tracing is not sufficient in SDK 0.13.3: an outer workflow trace is
// still created. AgentArbor never exports SDK traces, so keep the process guard too.
setTracingDisabled(true);

const globalOpenAIFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);
const MODEL_TRANSPORT_MAX_RETRIES = 2;

export function createOpenAIAgentsLoop(config: OpenAIAgentsLoopConfig): AgentLoop {
  return new OpenAIAgentsLoop(config);
}

class OpenAIAgentsLoop implements AgentLoop {
  private readonly config: OpenAIAgentsLoopConfig;
  private readonly provider: OpenAIProvider;
  private readonly modelProvider: ModelProvider;
  private readonly runner: Runner;
  private released = false;
  private releasePromise: Promise<void> | undefined;

  constructor(config: OpenAIAgentsLoopConfig) {
    validateConfig(config);
    validateRequestSettings(config.protocol, config.requestSettings);
    this.config = config;
    const configuredFetch = config.fetch === undefined ? undefined : toOpenAIFetch(config.fetch);
    // The Agents SDK owns model retries because it knows whether a stream has
    // emitted provider events. Disable client retries to avoid multiplying attempts.
    const openAIClient = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      maxRetries: 0,
      ...(config.protocol === "openai_responses"
        ? { fetch: withOpenAIResponsesStreamReconciliation(configuredFetch ?? globalOpenAIFetch) }
        : configuredFetch === undefined ? {} : { fetch: configuredFetch }),
    });
    this.provider = new OpenAIProvider({
      openAIClient,
      useResponses: config.protocol === "openai_responses",
      strictFeatureValidation: true,
      cacheResponsesWebSocketModels: false,
    });
    const profiledProvider = config.protocol === "openai_compatible_chat_completions"
      ? withOpenAICompatibleChatProfile(
          this.provider,
          compatibleChatDialectSettings(config).providerData,
        )
      : this.provider;
    this.modelProvider = withOpenAIAgentsTerminalGuard(profiledProvider, config.protocol);
    this.runner = new Runner({
      modelProvider: this.modelProvider,
      tracingDisabled: true,
      traceIncludeSensitiveData: false,
    });
  }

  async execute(input: AgentLoopInput): Promise<AgentLoopResult> {
    this.assertLive();
    const baseMessages = modelMessagesForOpenAIProtocol({
      protocol: this.config.protocol,
      messages: input.messages,
    });
    const modelInput = createOpenAIAgentsInputMapper({
      protocol: this.config.protocol,
      messages: baseMessages,
    });
    const execution: ExecutionState = {
      abortSignal: input.abortSignal,
      input,
      baseMessages,
      toolResults: [],
      requestedFactIds: new Set(),
      preflightByFactId: new Map(),
      interruptionFactIds: new WeakMap(),
      modelInput,
      modelRequestCount: 0,
      latestRequestIncludedResponses: 0,
    };
    let sdkState: RunState<SdkExecutionContext, Agent<SdkExecutionContext, AgentOutputType>> | undefined;
    try {
      const rootModel = withRootModelTurnObserver({
        model: await this.modelProvider.getModel(this.config.model),
        protocol: this.config.protocol,
        execution,
        onToolRound: input.onToolRound,
        onReasoningCompleted: input.onReasoningCompleted,
      });
      const agent = this.createAgent(execution, rootModel);
      sdkState = new RunState(
        new RunContext<SdkExecutionContext>({ execution }),
        modelInput.messages(input.instructions),
        agent,
        null,
      );
      const result = await this.run(agent, sdkState, execution, input.abortSignal);
      return this.resultFromSdk(agent, result, execution);
    } catch (error) {
      return terminalErrorResult(error, execution, sdkState);
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

  private createAgent(
    execution: ExecutionState,
    rootModel: Model,
  ): Agent<SdkExecutionContext, AgentOutputType> {
    const assembly = createOpenAIAgentsToolAssembly({
      execution,
      model: this.config.model,
      nestedModelSettings: nestedModelSettings(this.config),
      streamAgentTools: execution.input.onTextDelta !== undefined && supportsSdkStreaming(this.config),
    });
    return new Agent<SdkExecutionContext, AgentOutputType>({
      name: "AgentArborOrdinaryMechanicalLoop",
      instructions: execution.input.instructions,
      model: rootModel,
      modelSettings: modelSettings({
        config: this.config,
        instructions: execution.input.instructions,
        tools: assembly.definitions,
        agentTools: execution.input.agentTools ?? [],
      }),
      tools: [
        ...assembly.tools,
        ...(this.config.enableWebSearch === true ? [webSearchTool({ searchContextSize: "medium" })] : []),
      ],
    });
  }

  private async run(
    agent: Agent<SdkExecutionContext, AgentOutputType>,
    input: RunState<SdkExecutionContext, Agent<SdkExecutionContext, AgentOutputType>>,
    execution: ExecutionState,
    abortSignal: AbortSignal,
  ): Promise<RunResult<SdkExecutionContext, Agent<SdkExecutionContext, AgentOutputType>>> {
    execution.abortSignal = abortSignal;
    const stream = hasStreamObserver(execution.input) && supportsSdkStreaming(this.config);
    const callModelInputFilter = createContextMaintenanceFilter(execution, this.config.protocol);
    if (!stream) {
      return this.runner.run(agent, input, {
        maxTurns: null,
        signal: abortSignal,
        callModelInputFilter,
      });
    }
    const result = await this.runner.run(agent, input, {
      maxTurns: null,
      signal: abortSignal,
      stream: true,
      callModelInputFilter,
    });
    const reasoningStream = new OpenAIReasoningStreamNormalizer(this.config.protocol);
    for await (const event of result) {
      let rawEvent: unknown;
      if (isOpenAIChatCompletionsRawModelStreamEvent(event)) {
        // Some compatible gateways emit non-delta transport events through the
        // Chat stream channel. They are not text deltas; terminal validation
        // remains owned by the model boundary guard.
        rawEvent = event.data.event;
      } else if (isOpenAIResponsesRawModelStreamEvent(event)) {
        rawEvent = event.data.event;
      } else continue;
      emitNormalizedStreamDelta(reasoningStream.push(rawEvent), execution.input);
    }
    emitNormalizedStreamDelta(reasoningStream.flush(), execution.input);
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
      const pending = pendingOpenAIAgentsConfirmations(interruptions, (callId, interruption) => {
        const factId = execution.interruptionFactIds.get(interruption) ?? callId;
        const preflight = execution.preflightByFactId.get(factId);
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
      messages: canonicalMessagesForResult(execution, result.rawResponses, this.config.protocol),
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
      messages: canonicalMessagesForResult(execution, result.rawResponses, this.config.protocol),
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
              const rejected = rejectedOpenAIAgentsToolResult(item.request, decision);
              await recordOpenAIAgentsToolResult(execution, rejected);
              result.state.reject(item.interruption, {
                message: stringToolOutput(execution.modelInput.toolResult(rejected)),
              });
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
            return terminalErrorResult(error, execution, result.state);
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

function hasStreamObserver(input: AgentLoopInput): boolean {
  return input.onTextDelta !== undefined || input.onReasoningDelta !== undefined;
}

function withRootModelTurnObserver(input: {
  readonly model: Model;
  readonly protocol: OpenAIAgentsLoopProtocol;
  readonly execution: ExecutionState;
  readonly onToolRound: AgentLoopInput["onToolRound"];
  readonly onReasoningCompleted: AgentLoopInput["onReasoningCompleted"];
}): Model {
  return input.onToolRound === undefined && input.onReasoningCompleted === undefined
    ? input.model
    : new RootModelTurnObserver(
        input.model,
        input.protocol,
        input.execution,
        input.onToolRound,
        input.onReasoningCompleted,
      );
}

class RootModelTurnObserver implements Model {
  constructor(
    private readonly inner: Model,
    private readonly protocol: OpenAIAgentsLoopProtocol,
    private readonly execution: ExecutionState,
    private readonly onToolRound: AgentLoopInput["onToolRound"],
    private readonly onReasoningCompleted: AgentLoopInput["onReasoningCompleted"],
  ) {}

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    const response = await this.inner.getResponse(request);
    await this.acceptModelTurn(response);
    return response;
  }

  async *getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent> {
    for await (const event of this.inner.getStreamedResponse(request)) {
      if (event.type === "response_done") {
        await this.acceptModelTurn(event.response);
      }
      yield event;
    }
  }

  getRetryAdvice(args: ModelRetryAdviceRequest): ModelRetryAdvice | Promise<ModelRetryAdvice | undefined> | undefined {
    if (args.error instanceof ModelTurnAcceptanceError) {
      return {
        suggested: false,
        reason: "The owning feature did not durably accept the observed model turn.",
      };
    }
    return this.inner.getRetryAdvice?.(args);
  }

  private async acceptModelTurn(response: Pick<ModelResponse, "output">): Promise<void> {
    const reasoning = completedReasoningFromAgentOutput(response.output);
    try {
      if (reasoning.length > 0) {
        await this.onReasoningCompleted?.(reasoning);
      }
      await this.acceptToolRound(response);
    } catch (error) {
      throw new ModelTurnAcceptanceError(error);
    }
  }

  private async acceptToolRound(response: Pick<ModelResponse, "output">): Promise<void> {
    if (this.onToolRound === undefined) return;
    const providerAssistantMessage = canonicalMessagesFromOpenAIAgentsInput({
      protocol: this.protocol,
      items: response.output,
    }).find((message) => message.role === "assistant" && (message.toolCalls?.length ?? 0) > 0);
    if (providerAssistantMessage === undefined) {
      return;
    }
    await this.onToolRound({
      canonicalMessagesBeforeRound: cloneMessages(
        this.execution.latestRequestMessages ?? this.execution.baseMessages,
      ),
      assistantMessage: globalThis.structuredClone(providerAssistantMessage),
    });
  }
}

class ModelTurnAcceptanceError extends Error {
  constructor(cause: unknown) {
    super(errorMessage(cause), { cause });
    this.name = "ModelTurnAcceptanceError";
  }
}

function emitNormalizedStreamDelta(
  delta: { readonly reasoningDelta: string; readonly textDelta: string },
  input: AgentLoopInput,
): void {
  if (delta.reasoningDelta.length > 0) input.onReasoningDelta?.(delta.reasoningDelta);
  if (delta.textDelta.length > 0) input.onTextDelta?.(delta.textDelta);
}

function createContextMaintenanceFilter(
  execution: ExecutionState,
  protocol: OpenAIAgentsLoopProtocol,
): CallModelInputFilter {
  return async ({ modelData }) => {
    const instructions = modelData.instructions ?? execution.input.instructions;
    const mappedMessages = canonicalMessagesFromOpenAIAgentsInput({
      protocol,
      instructions,
      items: modelData.input,
    });
    let restoredAcceptedToolResult = false;
    const messagesWithAcceptedToolResults = mappedMessages.map((message) => {
      if (message.role !== "tool" || message.content.length > 0 || message.toolCallId === undefined) {
        return message;
      }
      const accepted = latestResolvedToolResult(execution.toolResults, message.toolCallId);
      if (accepted === undefined) return message;
      restoredAcceptedToolResult = true;
      return canonicalToolResultMessage(accepted);
    });
    const canonicalMessages = preserveCanonicalMetadata(
      messagesWithAcceptedToolResults,
      execution.latestRequestMessages ?? execution.baseMessages,
    );
    execution.latestRequestMessages = cloneMessages(canonicalMessages);
    execution.latestRequestIncludedResponses = execution.modelRequestCount;
    if (execution.input.maintainContext === undefined) {
      execution.modelRequestCount += 1;
      return restoredAcceptedToolResult
        ? {
            instructions,
            input: createOpenAIAgentsInputMapper({ protocol, messages: canonicalMessages }).messages(instructions),
          }
        : modelData;
    }
    const maintained = await execution.input.maintainContext!({
      messages: canonicalMessages,
      abortSignal: execution.abortSignal,
    });
    if (maintained.status === "failed") {
      throw new ContextMaintenanceError(maintained.code, maintained.error);
    }
    const requestMessages = maintained.status === "compacted"
      ? maintained.messages
      : canonicalMessages;
    execution.latestRequestMessages = cloneMessages(requestMessages);
    execution.modelRequestCount += 1;
    if (maintained.status === "unchanged" && !restoredAcceptedToolResult) {
      return modelData;
    }
    return {
      instructions,
      input: createOpenAIAgentsInputMapper({ protocol, messages: requestMessages }).messages(instructions),
    };
  };
}

function preserveCanonicalMetadata(
  messages: readonly ModelMessage[],
  previous: readonly ModelMessage[],
): readonly ModelMessage[] {
  return messages.map((message, index) => {
    const prior = previous[index];
    if (prior === undefined || !sameCanonicalMessage(message, prior)) return message;
    const ref = prior.ref ?? message.ref;
    const attachments = prior.attachments ?? message.attachments;
    return {
      ...message,
      ...(ref === undefined ? {} : { ref }),
      ...(attachments === undefined
        ? {}
        : { attachments: attachments.map((attachment) => globalThis.structuredClone(attachment)) }),
    };
  });
}

function sameCanonicalMessage(left: ModelMessage, right: ModelMessage): boolean {
  return left.role === right.role &&
    left.content === right.content &&
    left.toolCallId === right.toolCallId &&
    left.toolName === right.toolName &&
    JSON.stringify(left.toolCalls ?? []) === JSON.stringify(right.toolCalls ?? []);
}

function canonicalMessagesForResult(
  execution: ExecutionState,
  rawResponses: readonly { readonly output: readonly unknown[] }[],
  protocol: OpenAIAgentsLoopProtocol,
): readonly ModelMessage[] {
  const baseMessages = execution.latestRequestMessages ?? execution.baseMessages;
  const unseen = execution.latestRequestMessages === undefined
    ? rawResponses
    : rawResponses.slice(execution.latestRequestIncludedResponses);
  return canonicalMessagesFromResponses({
    baseMessages,
    rawResponses: unseen,
    protocol,
    toolResults: execution.toolResults,
  });
}

function modelSettings(input: {
  readonly config: OpenAIAgentsLoopConfig;
  readonly instructions: string;
  readonly tools: readonly ToolDefinition[];
  readonly agentTools: readonly AgentLoopAgentTool[];
}): ModelSettings {
  const settings = input.config.requestSettings;
  const dialectSettings = compatibleChatDialectSettings(input.config);
  const providerData: Record<string, unknown> = {
    // A stable cache identity is useful to every OpenAI-compatible gateway;
    // endpoint ownership is unrelated to whether it can cache a stable prefix.
    prompt_cache_key: openAIAgentsPromptCacheKey(
      input.config.protocol,
      input.config.model,
      input.instructions,
      input.tools,
      input.agentTools,
      input.config.enableWebSearch === true,
    ),
    ...(settings?.serviceTier === undefined ? {} : { service_tier: settings.serviceTier }),
    ...(input.config.protocol === "openai_responses"
      ? { include: ["reasoning.encrypted_content"] }
      : {}),
    ...dialectSettings.providerData,
  };
  return {
    temperature: dialectSettings.temperature,
    topP: dialectSettings.topP,
    maxTokens: settings?.maxOutputTokens,
    reasoning: dialectSettings.privateReasoning ||
      (settings?.reasoningEffort === undefined && settings?.reasoningSummary === undefined)
      ? undefined
      : {
          effort: settings?.reasoningEffort,
          summary: settings?.reasoningSummary,
        },
    text: settings?.textVerbosity === undefined ? undefined : { verbosity: settings.textVerbosity },
    truncation: settings?.truncation,
    parallelToolCalls: input.tools.length === 0 && input.agentTools.length === 0
      ? undefined
      : settings?.parallelToolCalls,
    store: settings?.store,
    retry: {
      maxRetries: MODEL_TRANSPORT_MAX_RETRIES,
      backoff: {
        initialDelayMs: 300,
        maxDelayMs: 2_000,
        multiplier: 2,
        jitter: true,
      },
      policy: retryPolicies.any(
        retryPolicies.providerSuggested(),
        retryPolicies.networkError(),
        retryPolicies.retryAfter(),
        retryPolicies.httpStatus([408, 409, 429, 500, 502, 503, 504]),
      ),
    },
    providerData,
  };
}

function nestedModelSettings(config: OpenAIAgentsLoopConfig): ModelSettings {
  const root = modelSettings({ config, instructions: "", tools: [], agentTools: [] });
  const { providerData: rootProviderData, parallelToolCalls: _parallelToolCalls, ...base } = root;
  const { prompt_cache_key: _promptCacheKey, ...providerData } = asRecord(rootProviderData);
  return { ...base, providerData };
}

function compatibleChatDialectSettings(config: OpenAIAgentsLoopConfig): {
  readonly temperature?: number;
  readonly topP?: number;
  readonly privateReasoning: boolean;
  readonly providerData: Record<string, unknown>;
} {
  const settings = config.requestSettings;
  if (config.protocol !== "openai_compatible_chat_completions") {
    return {
      temperature: settings?.temperature,
      topP: settings?.topP,
      privateReasoning: false,
      providerData: {},
    };
  }
  const dialect = resolveOpenAICompatibleChatDialect({
    providerProfileId: config.providerProfileId,
    baseUrl: config.baseUrl,
    model: config.model,
  });
  const privateReasoning = dialect.profileId === "deepseek" || dialect.profileId === "moonshot" ||
    dialect.profileId === "glm" || dialect.profileId === "minimax";
  if (!privateReasoning) {
    return {
      temperature: settings?.temperature,
      topP: settings?.topP,
      privateReasoning,
      providerData: {},
    };
  }
  const fields = applyOpenAICompatibleChatRequestPolicy({
    dialect,
    fields: applyOpenAICompatibleChatDialectControls({
      dialect,
      settings,
      fields: {
        ...(settings?.temperature === undefined ? {} : { temperature: settings.temperature }),
        ...(settings?.topP === undefined ? {} : { top_p: settings.topP }),
        ...(settings?.reasoningEffort === undefined ? {} : { reasoning_effort: settings.reasoningEffort }),
      },
    }),
  });
  const { temperature, top_p: topP, ...providerData } = fields;
  return {
    temperature: typeof temperature === "number" ? temperature : undefined,
    topP: typeof topP === "number" ? topP : undefined,
    privateReasoning,
    providerData,
  };
}

function supportsSdkStreaming(config: OpenAIAgentsLoopConfig): boolean {
  if (config.requestSettings?.stream === false) return false;
  if (config.protocol !== "openai_compatible_chat_completions") return true;
  const dialect = resolveOpenAICompatibleChatDialect({
    providerProfileId: config.providerProfileId,
    baseUrl: config.baseUrl,
    model: config.model,
  });
  return dialect.supportsStreaming && dialect.streamDeltaMode === "incremental";
}

function canonicalMessagesFromResponses(input: {
  readonly baseMessages: readonly ModelMessage[];
  readonly rawResponses: readonly { readonly output: readonly unknown[] }[];
  readonly protocol: OpenAIAgentsLoopProtocol;
  readonly toolResults: readonly ToolCallResult[];
}): readonly ModelMessage[] {
  const messages = cloneMessages(input.baseMessages);
  for (const response of input.rawResponses) {
    const assistantMessages = canonicalMessagesFromOpenAIAgentsInput({
      protocol: input.protocol,
      items: response.output,
    }).filter((message) => message.role === "assistant");
    messages.push(...assistantMessages);
    for (const call of assistantMessages.flatMap((message) => message.toolCalls ?? [])) {
      const result = latestResolvedToolResult(input.toolResults, call.callId);
      if (result !== undefined) {
        messages.push(toolResultMessage(result));
      }
    }
  }
  return messages;
}

function latestResolvedToolResult(results: readonly ToolCallResult[], callId: string): ToolCallResult | undefined {
  return [...results].reverse().find((result) =>
    result.callId === callId &&
    (result.factId === undefined || result.factId === result.callId) &&
    result.status !== "approval_required");
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
  agentTools: readonly AgentLoopAgentTool[] = [],
  enableWebSearch = false,
): string {
  const identity = JSON.stringify({
    protocol,
    model,
    instructions,
    enableWebSearch,
    tools: [...tools]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((definition) => ({
        name: definition.name,
        description: modelVisibleToolDescription(definition),
        inputSchema: sdkToolInputSchema(definition),
      })),
    agentTools: [...agentTools]
      .sort((left, right) => left.toolName.localeCompare(right.toolName))
      .map(openAIAgentsAgentToolCacheIdentity),
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

function validateConfig(config: OpenAIAgentsLoopConfig): void {
  for (const [name, value] of [["baseUrl", config.baseUrl], ["apiKey", config.apiKey], ["model", config.model]] as const) {
    if (value.trim().length === 0) {
      throw new Error(`OpenAI Agents loop ${name} must not be blank.`);
    }
  }
  if (config.enableWebSearch === true && config.protocol !== "openai_responses") {
    throw new Error("OpenAI model built-in Web Search requires the Responses protocol.");
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

function terminalErrorResult(
  error: unknown,
  execution: ExecutionState,
  sdkState?: RunState<SdkExecutionContext, Agent<SdkExecutionContext, AgentOutputType>>,
): AgentLoopResult {
  const message = modelErrorMessageFromError(error, errorMessage(error));
  const errorCode = contextMaintenanceErrorCode(error) ?? transportFailureCode(error);
  const stateResponses = sdkState === undefined ? [] : new RunResult(sdkState).rawResponses;
  const preservedTerminalResponse = preservedOpenAIAgentsTerminalResponse(error);
  const rawResponses = preservedTerminalResponse === undefined
    ? stateResponses
    : [...stateResponses, preservedTerminalResponse];
  const facts = {
    messages: canonicalMessagesForResult(execution, rawResponses, execution.modelInput.protocol),
    toolResults: cloneToolResults(execution.toolResults),
    usage: {},
    confirmationRequests: [],
  };
  return isAbortError(error) || execution.abortSignal.aborted
    ? { ...facts, status: "cancelled", error: message }
    : {
        ...facts,
        status: "failed",
        error: message,
        ...(errorCode === undefined
          ? {}
          : { errorCode }),
      };
}

function transportFailureCode(error: unknown): string | undefined {
  const kind = modelFailureKindFromError(error);
  return kind === "provider_network" || kind === "provider_timeout"
    ? kind
    : undefined;
}

class ContextMaintenanceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ContextMaintenanceError";
  }
}

function contextMaintenanceErrorCode(error: unknown): string | undefined {
  return error instanceof ContextMaintenanceError ? error.code : undefined;
}

function stringToolOutput(value: ReturnType<OpenAIAgentsExecutionState["modelInput"]["toolResult"]>): string {
  if (typeof value !== "string") {
    throw new Error("OpenAI rejection tool results cannot carry model attachments.");
  }
  return value;
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
