import {
  AgentHarness,
  InMemorySessionRepo,
  type AgentHarnessEvent,
  type AgentMessage,
  type AgentTool,
  type AgentToolUpdateCallback,
  type CompactionSettings,
  type ExecutionEnv,
  type Session,
  type ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import { isDeepStrictEqual } from "node:util";
import {
  isContextOverflow,
  Type,
  type Api,
  type AssistantMessage,
  type ImageContent,
  type Model,
  type Models,
  type Usage,
} from "@earendil-works/pi-ai";
import type {
  AgentLoop,
  AgentLoopAgentTool,
  AgentLoopAgentToolInvocation,
  AgentLoopContinuation,
  AgentLoopInput,
  AgentLoopResult,
  AgentLoopToolBoundary,
} from "../../app/model-runtime/agent-loop.js";
import { canonicalToolResultMessage } from "../../app/model-runtime/tool-result-message.js";
import type { ConfirmationDecision, ConfirmationRequest } from "../../domain/confirmation/index.js";
import type { ModelInputAttachment, ModelMessage, ModelUsage } from "../../domain/intelligence/index.js";
import {
  modelVisibleToolDescription,
  normalizeToolFactValue,
  toolModelAttachmentsFromOutput,
  toolCallFactId,
  type ToolCallRequest,
  type ToolCallResult,
  type ToolDefinition,
  type ToolFactValue,
} from "../../domain/tools/index.js";
import { modelFailureKindFromError } from "../../kernel/intelligence/failures.js";
import { compactSessionContextIfNeeded } from "./session-context-compaction.js";
import type { ModelProviderPayloadTransformer } from "./model-provider-binding.js";

export type AgentSessionLoopOptions = {
  readonly executionEnvironment: ExecutionEnv;
  readonly modelRegistry: Models;
  readonly selectedModel: Model<Api>;
  readonly agentSession: Session;
  readonly thinkingLevel?: ThinkingLevel;
  readonly transformProviderPayload?: ModelProviderPayloadTransformer;
  readonly compactionSettings?: CompactionSettings;
};

type ToolExecutionDetails = {
  readonly kind: "progress";
} | {
  readonly kind: "result";
  readonly result: ToolCallResult;
};

type Deferred<T> = {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

type PendingApproval = {
  readonly result: ToolCallResult & { readonly status: "approval_required" };
  readonly decision: Deferred<ApprovalResolution>;
};

type ApprovalResolution = {
  readonly kind: "resolved";
  readonly decision: ConfirmationDecision;
  readonly abortSignal: AbortSignal;
};

type DelegatedAgentResultGateway = AgentLoopToolBoundary["gateway"] & {
  readonly deliverResult: NonNullable<AgentLoopToolBoundary["gateway"]["deliverResult"]>;
};

type AgentSessionExecutionState = {
  readonly toolResults: Map<string, ToolCallResult>;
  readonly approvals: ApprovalDecisionCoordinator;
  readonly sessionId: string;
  readonly agentSession: Session;
  readonly startLeafEntryId: string | null;
  readonly compactionEntryIds: string[];
  readonly abortSignalCleanups: Set<() => void>;
  inputEntryId?: string;
  latestLeafEntryId: string | null;
  safeLeafEntryId: string | null;
  abortRun?: () => Promise<void>;
  usage: ModelUsage;
  maintenanceFailure?: { readonly code: string; readonly error: string };
  toolAcceptanceFailure?: unknown;
};

type ActiveAgentLoopExecution = {
  readonly run: Promise<AssistantMessage>;
  readonly abort: () => Promise<void>;
};

type DelegatedAgentExecutionMetrics = {
  modelRounds: number;
  toolCallCount: number;
  usage: ModelUsage;
};

/** Provider-neutral mechanical loop whose transcript is owned by one agent Session. */
export function createAgentSessionLoop(options: AgentSessionLoopOptions): AgentLoop {
  let activeExecution: ActiveAgentLoopExecution | undefined;
  let released = false;

  return {
    async execute(input) {
      if (released) throw new Error("Agent session loop has been released.");
      if (activeExecution !== undefined) throw new Error("Agent session loop is already executing.");
      if (input.abortSignal.aborted) return cancelledBeforeStart(input);
      const prompt = preparePromptInput(input);
      const sessionId = (await options.agentSession.getMetadata()).id;
      const startEntryId = await options.agentSession.getLeafId();
      const state: AgentSessionExecutionState = {
        toolResults: new Map(),
        approvals: new ApprovalDecisionCoordinator(),
        sessionId,
        agentSession: options.agentSession,
        startLeafEntryId: startEntryId,
        compactionEntryIds: [],
        abortSignalCleanups: new Set(),
        latestLeafEntryId: startEntryId,
        safeLeafEntryId: startEntryId,
        usage: {},
      };
      await input.onSessionWriteCheckpoint?.({
        kind: "start_leaf_captured",
        sessionId,
        startLeafRef: startEntryId === null ? null : { sessionId, entryId: startEntryId },
      });
      const runtimeSession = createEphemeralAttachmentSession(options.agentSession);
      const harness = new AgentHarness({
        env: options.executionEnvironment,
        session: runtimeSession,
        models: options.modelRegistry,
        model: options.selectedModel,
        thinkingLevel: options.thinkingLevel,
        systemPrompt: input.instructions,
        tools: createHarnessTools(input, state, options),
      });
      attachHarnessHooks(harness, input, state, options, runtimeSession);
      const run = harness.prompt(prompt.text, { images: prompt.images });
      let abortPromise: Promise<void> | undefined;
      const abort = (): Promise<void> => {
        abortPromise ??= harness.abort().then(() => undefined);
        return abortPromise;
      };
      state.abortRun = abort;
      const currentExecution: ActiveAgentLoopExecution = { run, abort };
      activeExecution = currentExecution;
      bindRunAbortSignal(state, input.abortSignal);
      const clearActiveRun = (): void => {
        clearRunAbortSignals(state);
        if (activeExecution === currentExecution) activeExecution = undefined;
      };
      void run.then(clearActiveRun, clearActiveRun);
      const settle = async (): Promise<AgentLoopResult> => {
        try {
          const assistant = await run;
          return finalResult(assistant, input, state, options.selectedModel.contextWindow);
        } catch (error) {
          return failedRunResult(error, input, state);
        }
      };
      return state.approvals.wait(settle, () => approvalResult(input, state, settle));
    },
    async release() {
      released = true;
      const currentExecution = activeExecution;
      if (currentExecution !== undefined) {
        await currentExecution.abort();
        await currentExecution.run.catch(() => undefined);
        if (activeExecution === currentExecution) activeExecution = undefined;
      }
    },
  };
}

function preparePromptInput(
  input: AgentLoopInput,
): { readonly text: string; readonly images?: ImageContent[] } {
  const withoutSystem = input.messages.filter((message) => message.role !== "system");
  const current = withoutSystem.at(-1);
  if (current?.role !== "user") {
    throw new Error("Agent loop input must end with the current user message.");
  }
  const images = imageContentFromAttachments(current.attachments);
  return {
    text: current.content,
    ...(images.length === 0 ? {} : { images }),
  };
}

/** Keeps provider input ephemeral while retaining a truthful durable Session transcript. */
function createEphemeralAttachmentSession(session: Session): Session {
  const overlays: Array<{ readonly durable: AgentMessage; readonly ephemeral: AgentMessage }> = [];
  return new Proxy(session, {
    get(target, property, receiver) {
      if (property === "appendMessage") {
        return (message: AgentMessage) => {
          const durable = sanitizeSessionMessage(message);
          if (!isDeepStrictEqual(durable, message)) {
            overlays.push({
              durable: globalThis.structuredClone(durable),
              ephemeral: globalThis.structuredClone(message),
            });
          }
          return target.appendMessage(durable);
        };
      }
      if (property === "buildContext") {
        return async (...args: Parameters<Session["buildContext"]>) => {
          const context = await target.buildContext(...args);
          const remaining = [...overlays];
          const messages = context.messages.map((message) => {
            const index = remaining.findIndex((overlay) => isDeepStrictEqual(overlay.durable, message));
            if (index < 0) return message;
            const [overlay] = remaining.splice(index, 1);
            return globalThis.structuredClone(overlay.ephemeral);
          });
          return { ...context, messages };
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Session;
}

function sanitizeSessionMessage(message: AgentMessage): AgentMessage {
  if (!("content" in message) || !Array.isArray(message.content)) return message;
  const content = message.content.map((block) => block.type === "image"
    ? { type: "text" as const, text: "[image attachment omitted from durable Session]" }
    : block);
  return { ...message, content } as AgentMessage;
}

function createHarnessTools(
  input: AgentLoopInput,
  state: AgentSessionExecutionState,
  options: AgentSessionLoopOptions,
): AgentTool[] {
  const allowed = new Set(input.tools.permission.allowedTools);
  const mechanicalTools = input.tools.gateway.list()
    .filter((definition) => allowed.has(definition.name))
    .map((definition) => createHarnessTool(definition, input, state, input.tools));
  const agentTools = input.agentTools ?? [];
  const delegatedTools = agentTools.length === 0
    ? []
    : agentTools.map((agentTool) => createDelegatedAgentTool(
        agentTool,
        input,
        state,
        options,
        requireDelegatedAgentResultGateway(input.tools.gateway),
      ));
  assertUniqueToolNames([...mechanicalTools, ...delegatedTools]);
  return [...mechanicalTools, ...delegatedTools];
}

function createHarnessTool(
  definition: ToolDefinition,
  input: AgentLoopInput,
  state: AgentSessionExecutionState,
  boundary: AgentLoopToolBoundary,
  requestScope?: (request: ToolCallRequest) => ToolCallRequest,
  onToolInvoked?: () => void,
): AgentTool {
  return {
    name: definition.name,
    label: definition.name,
    description: modelVisibleToolDescription(definition),
    parameters: Type.Unsafe(globalThis.structuredClone(definition.inputSchema)),
    executionMode: definition.metadata?.operationType === "read-only" ? "parallel" : "sequential",
    async execute(callId, parameters, signal, onUpdate) {
      const unscopedRequest: ToolCallRequest = {
        callId,
        toolName: definition.name,
        input: normalizeToolFactValue(parameters),
      };
      const request = requestScope?.(unscopedRequest) ?? unscopedRequest;
      emitToolRequested(input, request);
      onToolInvoked?.();
      let context = toolExecutionContext(input, boundary, request, signal, onUpdate);
      const preflight = boundary.gateway.preflight(request, context, boundary.permission);
      if (preflight.status === "blocked") {
        const deliveryFailure = await acceptToolResultForDelivery(input, state, preflight.result);
        if (deliveryFailure !== undefined) return deliveryFailure;
        return harnessToolResult(preflight.result, preflight.result.status === "cancelled");
      }
      let approvedConfirmationIds = boundary.permission.approvedConfirmationIds;
      if (preflight.status === "approval_required") {
        const approval = requireApprovalRequiredResult(preflight.result);
        const resolution = await resolveApproval(input, state, approval, context);
        if (resolution.kind === "delivery_failure") return resolution.response;
        if (resolution.kind === "cancelled") return harnessToolResult(resolution.result, true);
        if (resolution.kind === "denied") return harnessToolResult(resolution.result);
        approvedConfirmationIds = uniqueStrings([
          ...(approvedConfirmationIds ?? []),
          requireConfirmationRequest(approval).confirmationId,
        ]);
        context = toolExecutionContext(
          input,
          boundary,
          request,
          continuedToolAbortSignal(context.abortSignal, input.abortSignal, resolution.abortSignal),
          onUpdate,
        );
      }
      let executionRequest = preflight.status === "ready" ? preflight.request : toolRequestFromResult(preflight.result);
      while (true) {
        const result = await boundary.gateway.execute(
          executionRequest,
          context,
          { ...boundary.permission, approvedConfirmationIds },
        );
        if (result.status !== "approval_required") {
          const deliveryFailure = await acceptToolResultForDelivery(input, state, result);
          if (deliveryFailure !== undefined) return deliveryFailure;
          return harnessToolResult(result, result.status === "cancelled");
        }

        // ToolCenter may discover a gate after starting a read-only operation. Keep
        // that partial result as a fact before waiting, then retry only after the
        // matching confirmation has been accepted.
        const approval = requireApprovalRequiredResult(result);
        const resolution = await resolveApproval(input, state, approval, context);
        if (resolution.kind === "delivery_failure") return resolution.response;
        if (resolution.kind === "cancelled") return harnessToolResult(resolution.result, true);
        if (resolution.kind === "denied") return harnessToolResult(resolution.result);
        approvedConfirmationIds = uniqueStrings([
          ...(approvedConfirmationIds ?? []),
          requireConfirmationRequest(approval).confirmationId,
        ]);
        context = toolExecutionContext(
          input,
          boundary,
          executionRequest,
          continuedToolAbortSignal(context.abortSignal, input.abortSignal, resolution.abortSignal),
          onUpdate,
        );
        executionRequest = toolRequestFromResult(approval);
      }
    },
  };
}

function createDelegatedAgentTool(
  contribution: AgentLoopAgentTool,
  input: AgentLoopInput,
  state: AgentSessionExecutionState,
  options: AgentSessionLoopOptions,
  resultGateway: DelegatedAgentResultGateway,
): AgentTool {
  return {
    name: contribution.toolName,
    label: contribution.toolName,
    description: contribution.toolDescription,
    parameters: Type.Unsafe(globalThis.structuredClone(contribution.inputSchema)),
    executionMode: "sequential",
    async execute(callId, parameters, signal) {
      const request: ToolCallRequest = {
        callId,
        toolName: contribution.toolName,
        input: normalizeToolFactValue(parameters),
      };
      emitToolRequested(input, request);
      const startedAt = Date.now();
      let result: ToolCallResult;
      try {
        const invocation = validateDelegatedToolBoundary(
          input.tools,
          input.agentTools ?? [],
          await contribution.resolve(requiredDelegatedAgentInput(request)),
        );
        result = await runDelegatedAgent({
          invocation,
          request,
          input,
          state,
          options,
          abortSignal: signal ?? input.abortSignal,
          startedAt,
        });
      } catch (error) {
        result = delegatedAgentFailure(request, error, signal?.aborted === true || input.abortSignal.aborted, startedAt);
      }
      const delivered = await deliverDelegatedAgentResult(input, resultGateway, result);
      const acceptanceFailure = await acceptToolResultForDelivery(input, state, delivered);
      return acceptanceFailure ?? harnessToolResult(
        delivered,
        state.toolAcceptanceFailure !== undefined || delivered.status === "cancelled",
      );
    },
  };
}

async function runDelegatedAgent(input: {
  readonly invocation: AgentLoopAgentToolInvocation;
  readonly request: ToolCallRequest;
  readonly input: AgentLoopInput;
  readonly state: AgentSessionExecutionState;
  readonly options: AgentSessionLoopOptions;
  readonly abortSignal: AbortSignal;
  readonly startedAt: number;
}): Promise<ToolCallResult> {
  const parentFactId = toolCallFactId(input.request);
  const boundary = delegatedToolBoundary(input.input.tools, input.invocation);
  const metrics: DelegatedAgentExecutionMetrics = { modelRounds: 0, toolCallCount: 0, usage: {} };
  const session = await new InMemorySessionRepo().create({ id: `delegated-agent:${parentFactId}` });
  const tools = boundary.gateway.list()
    .filter((definition) => boundary.permission.allowedTools.includes(definition.name))
    .map((definition) => createHarnessTool(
      definition,
      input.input,
      input.state,
      boundary,
      (request) => scopedDelegatedToolRequest(parentFactId, request),
      () => { metrics.toolCallCount += 1; },
    ));
  const harness = new AgentHarness({
    env: input.options.executionEnvironment,
    session,
    models: input.options.modelRegistry,
    model: input.options.selectedModel,
    thinkingLevel: input.options.thinkingLevel,
    systemPrompt: input.invocation.instructions,
    tools,
  });
  attachDelegatedHarnessHooks(
    harness,
    session,
    input.state,
    input.options,
    input.abortSignal,
    boundary.gateway.list(),
    metrics,
  );
  const handleAbort = (): void => { void harness.abort().catch(() => undefined); };
  input.abortSignal.addEventListener("abort", handleAbort, { once: true });
  if (input.abortSignal.aborted) handleAbort();
  try {
    const assistant = await harness.prompt(input.invocation.input);
    if (input.abortSignal.aborted || assistant.stopReason === "aborted") {
      return delegatedAgentFailure(input.request, input.abortSignal.reason ?? assistant.errorMessage, true, input.startedAt, metrics);
    }
    if (assistant.stopReason !== "stop") {
      return delegatedAgentFailure(
        input.request,
        assistant.errorMessage ?? `Delegated agent stopped with ${assistant.stopReason}.`,
        false,
        input.startedAt,
        metrics,
      );
    }
    return {
      ...input.request,
      output: assistantText(assistant),
      status: "completed",
      delegatedExecution: delegatedExecutionMetadata(metrics),
      durationMs: Math.max(0, Date.now() - input.startedAt),
    };
  } finally {
    input.abortSignal.removeEventListener("abort", handleAbort);
  }
}

function attachDelegatedHarnessHooks(
  harness: AgentHarness,
  agentSession: Session,
  state: AgentSessionExecutionState,
  options: AgentSessionLoopOptions,
  abortSignal: AbortSignal,
  tools: readonly ToolDefinition[],
  metrics: DelegatedAgentExecutionMetrics,
): void {
  attachProviderPayloadHook(harness, options, tools);
  harness.on("context", async ({ messages }) => {
    const compaction = await compactSessionContextIfNeeded({
      agentSession,
      activeContextMessages: messages,
      modelRegistry: options.modelRegistry,
      selectedModel: harness.getModel(),
      abortSignal,
      ...(options.compactionSettings === undefined ? {} : { compactionSettings: options.compactionSettings }),
    });
    if (compaction.status === "failed") throw new Error(compaction.error);
    return compaction.status === "compacted"
      ? { messages: [...compaction.compactedContextMessages] }
      : undefined;
  });
  harness.on("tool_result", ({ details }) => {
    const result = toolResultFromDetails(details);
    return result === undefined ? undefined : { isError: result.status !== "completed" };
  });
  harness.subscribe((event) => {
    if (event.type === "message_end" && event.message.role === "assistant") {
      const usage = modelUsageFromProvider(event.message.usage);
      metrics.modelRounds += 1;
      metrics.usage = mergeUsage(metrics.usage, usage);
      // A child request contributes to the run total but is not a parent model
      // request, so it must not replace the parent's context-capacity snapshot.
      state.usage = mergeUsage(state.usage, usage, { preserveLatestAgentRequest: true });
    }
  });
}

function attachHarnessHooks(
  harness: AgentHarness,
  input: AgentLoopInput,
  state: AgentSessionExecutionState,
  options: AgentSessionLoopOptions,
  runtimeSession: Session,
): void {
  attachProviderPayloadHook(harness, options, input.tools.gateway.list());
  harness.on("context", async ({ messages }) => {
    const sessionCompaction = await compactSessionContextIfNeeded({
      agentSession: runtimeSession,
      activeContextMessages: messages,
      modelRegistry: options.modelRegistry,
      selectedModel: harness.getModel(),
      abortSignal: input.abortSignal,
      ...(options.compactionSettings === undefined
        ? {}
        : { compactionSettings: options.compactionSettings }),
    });
    if (sessionCompaction.status === "failed") {
      state.maintenanceFailure = { code: sessionCompaction.code, error: sessionCompaction.error };
      throw new Error(sessionCompaction.error);
    }
    if (sessionCompaction.status === "compacted") {
      state.compactionEntryIds.push(sessionCompaction.compactionEntryRef.entryId);
      state.latestLeafEntryId = sessionCompaction.compactionEntryRef.entryId;
      try {
        await input.onSessionWriteCheckpoint?.({
          kind: "compaction_entry_committed",
          sessionId: state.sessionId,
          compactionEntryRef: sessionCompaction.compactionEntryRef,
          tokensBefore: sessionCompaction.tokensBefore,
        });
      } catch (error) {
        state.maintenanceFailure = { code: "context_compaction_fact_rejected", error: errorMessage(error) };
        throw error;
      }
      state.safeLeafEntryId = sessionCompaction.compactionEntryRef.entryId;
      return { messages: [...sessionCompaction.compactedContextMessages] };
    }
    return undefined;
  });
  harness.on("tool_result", ({ details }) => {
    const result = toolResultFromDetails(details);
    return result === undefined ? undefined : { isError: result.status !== "completed" };
  });
  harness.subscribe(async (event) => {
    await projectHarnessEvent(event, input, state);
  });
}

function attachProviderPayloadHook(
  harness: AgentHarness,
  options: AgentSessionLoopOptions,
  tools: readonly ToolDefinition[],
): void {
  if (options.transformProviderPayload === undefined) return;
  harness.on("before_provider_payload", ({ model, payload }) => ({
    payload: options.transformProviderPayload?.({ model, payload, tools }) ?? payload,
  }));
}

async function projectHarnessEvent(
  event: AgentHarnessEvent,
  input: AgentLoopInput,
  state: AgentSessionExecutionState,
): Promise<void> {
  if (event.type === "message_update") {
    if (event.assistantMessageEvent.type === "text_delta") input.onTextDelta?.(event.assistantMessageEvent.delta);
    if (event.assistantMessageEvent.type === "thinking_delta") input.onReasoningDelta?.(event.assistantMessageEvent.delta);
    return;
  }
  if (event.type === "turn_end") {
    if (event.message.role !== "assistant") return;
    const toolCallIds = (modelMessageFromAssistant(event.message).toolCalls ?? []).map((call) => call.callId);
    if (toolCallIds.length === 0) return;
    const resultIds = event.toolResults.map((result) => result.toolCallId);
    if (!sameIds(toolCallIds, resultIds)) {
      state.maintenanceFailure = {
        code: "session_tool_result_group_incomplete",
        error: "Pi Session turn ended without one tool result for every assistant tool call.",
      };
      throw new Error(state.maintenanceFailure.error);
    }
    const entryId = await state.agentSession.getLeafId();
    if (entryId === null) throw new Error("Session did not expose the completed tool-result group leaf.");
    state.latestLeafEntryId = entryId;
    await input.onSessionWriteCheckpoint?.({
      kind: "tool_result_entries_committed",
      sessionId: state.sessionId,
      toolRoundLeafRef: { sessionId: state.sessionId, entryId },
      toolCallIds,
    });
    state.safeLeafEntryId = entryId;
    return;
  }
  if (event.type !== "message_end") return;
  const entryId = await state.agentSession.getLeafId();
  if (entryId === null) throw new Error("Session did not expose the entry appended by message_end.");
  state.latestLeafEntryId = entryId;
  if (event.message.role === "user") {
    state.inputEntryId ??= entryId;
    await input.onSessionWriteCheckpoint?.({
      kind: "input_entry_committed",
      sessionId: state.sessionId,
      inputEntryRef: { sessionId: state.sessionId, entryId },
    });
    state.safeLeafEntryId = entryId;
    return;
  }
  if (event.message.role === "assistant") {
    const message = modelMessageFromAssistant(event.message);
    const toolCalls = message.toolCalls ?? [];
    if (toolCalls.length > 0) {
      const toolCallIds = toolCalls.map((call) => call.callId);
      await input.onSessionWriteCheckpoint?.({
        kind: "assistant_tool_call_entry_committed",
        sessionId: state.sessionId,
        assistantEntryRef: { sessionId: state.sessionId, entryId },
        toolCallIds,
      });
    } else {
      await input.onSessionWriteCheckpoint?.({
        kind: "assistant_response_entry_committed",
        sessionId: state.sessionId,
        assistantEntryRef: { sessionId: state.sessionId, entryId },
      });
    }
    state.usage = mergeUsage(state.usage, modelUsageFromProvider(event.message.usage));
    const reasoning = event.message.content
      .filter((block) => block.type === "thinking")
      .map((block) => block.thinking)
      .join("\n");
    if (reasoning.length > 0) await input.onReasoningCompleted?.(reasoning);
    return;
  }
}

function approvalResult(
  input: AgentLoopInput,
  state: AgentSessionExecutionState,
  settle: () => Promise<AgentLoopResult>,
): AgentLoopResult {
  return {
    status: "approval_required",
    toolResults: [...state.toolResults.values()].map(cloneToolResult),
    usage: state.usage,
    confirmationRequests: state.approvals.requests(),
    session: sessionExecutionRefs(state),
    continuation: approvalContinuation(input, state, settle),
  };
}

function approvalContinuation(
  input: AgentLoopInput,
  state: AgentSessionExecutionState,
  settle: () => Promise<AgentLoopResult>,
): AgentLoopContinuation {
  let consumed = false;
  return {
    availability: "live_only",
    async decide(decisionInput) {
      if (consumed) {
        return failedResult(state, "Agent loop approval continuation has already been decided.", "confirmation_already_decided");
      }
      if (decisionInput.abortSignal.aborted || input.abortSignal.aborted) {
        await abortRun(state);
        return cancelledResult(state, decisionInput.abortSignal.reason ?? input.abortSignal.reason);
      }
      try {
        bindRunAbortSignal(state, decisionInput.abortSignal);
        state.approvals.decide(
          "decisions" in decisionInput ? decisionInput.decisions : [decisionInput.decision],
          decisionInput.abortSignal,
        );
      } catch (error) {
        await abortRun(state);
        return failedResult(state, errorMessage(error), "confirmation_decision_mismatch");
      }
      consumed = true;
      // Let each released request resume before returning the next remaining
      // approval set. This preserves one-at-a-time UI decisions without
      // turning an approved tool into a batch barrier.
      await Promise.resolve();
      return state.approvals.wait(settle, () => approvalResult(input, state, settle));
    },
  };
}

function finalResult(
  assistant: AssistantMessage,
  input: AgentLoopInput,
  state: AgentSessionExecutionState,
  contextWindow: number,
): AgentLoopResult {
  const facts = resultFacts(state);
  if (input.abortSignal.aborted) return { ...facts, status: "cancelled", error: abortMessage(input.abortSignal.reason) };
  if (state.maintenanceFailure !== undefined) {
    return {
      ...facts,
      status: "failed",
      error: state.maintenanceFailure.error,
      errorCode: state.maintenanceFailure.code,
    };
  }
  if (state.toolAcceptanceFailure !== undefined) {
    return { ...facts, status: "failed", error: errorMessage(state.toolAcceptanceFailure), errorCode: "tool_result_acceptance_failed" };
  }
  if (assistant.stopReason === "aborted") {
    return { ...facts, status: "cancelled", error: assistant.errorMessage ?? "cancelled" };
  }
  const refusal = providerRefusalFromAssistant(assistant);
  if (refusal !== undefined) {
    return {
      ...facts,
      status: "failed",
      error: refusal.length === 0
        ? "The model refused the request without an explanation."
        : `The model refused the request: ${refusal}`,
      errorCode: "model_refusal",
    };
  }
  const providerFailure = providerFailureFromAssistant(assistant, contextWindow);
  if (providerFailure !== undefined) {
    return { ...facts, status: "failed", ...providerFailure };
  }
  if (assistant.stopReason === "length") {
    const incompleteReason = assistant.providerMetadata?.incompleteReason?.trim();
    return {
      ...facts,
      status: "failed",
      error: incompleteReason === undefined || incompleteReason.length === 0
        ? "Model stopped before completing its response."
        : `Model response was incomplete: ${incompleteReason}.`,
      errorCode: incompleteReason === "content_filter" ? "content_filtered" : "output_truncated",
    };
  }
  if (assistant.stopReason !== "stop") {
    return {
      ...facts,
      status: "failed",
      error: assistant.errorMessage ?? `Model stopped with ${assistant.stopReason}.`,
      errorCode: "agent_loop_failed",
    };
  }
  return { ...facts, status: "completed", finalText: assistantText(assistant) };
}

function providerRefusalFromAssistant(assistant: AssistantMessage): string | undefined {
  const diagnostic = assistant.diagnostics?.find((item) => item.type === "provider_refusal");
  if (diagnostic === undefined) return undefined;
  const refusal = diagnostic.details?.refusal;
  return typeof refusal === "string" ? refusal.trim() : "";
}

function providerFailureFromAssistant(
  assistant: AssistantMessage,
  contextWindow: number,
): { readonly error: string; readonly errorCode: string } | undefined {
  if (isContextOverflow(assistant, contextWindow)) {
    return {
      error: assistant.errorMessage ?? "The model request exceeded the available context window.",
      errorCode: "context_overflow",
    };
  }
  if (assistant.stopReason !== "error") {
    return undefined;
  }
  const error = assistant.errorMessage ?? "Provider returned an error stop reason.";
  return {
    error,
    errorCode: modelFailureKindFromError(new Error(error)),
  };
}

function failedRunResult(error: unknown, input: AgentLoopInput, state: AgentSessionExecutionState): AgentLoopResult {
  if (input.abortSignal.aborted) return cancelledResult(state, input.abortSignal.reason ?? error);
  if (state.maintenanceFailure !== undefined) {
    return failedResult(state, state.maintenanceFailure.error, state.maintenanceFailure.code);
  }
  if (state.toolAcceptanceFailure !== undefined) {
    return failedResult(state, errorMessage(state.toolAcceptanceFailure), "tool_result_acceptance_failed");
  }
  if (isAbortError(error)) return cancelledResult(state, error);
  return failedResult(state, errorMessage(error), "agent_loop_failed");
}

function failedResult(state: AgentSessionExecutionState, error: string, errorCode: string): AgentLoopResult {
  return { ...resultFacts(state), status: "failed", error, errorCode };
}

function cancelledResult(state: AgentSessionExecutionState, reason: unknown): AgentLoopResult {
  return { ...resultFacts(state), status: "cancelled", error: abortMessage(reason) };
}

function cancelledBeforeStart(input: AgentLoopInput): AgentLoopResult {
  return {
    status: "cancelled",
    toolResults: [],
    usage: {},
    confirmationRequests: [],
    error: abortMessage(input.abortSignal.reason),
  };
}

function resultFacts(state: AgentSessionExecutionState) {
  return {
    toolResults: [...state.toolResults.values()].map(cloneToolResult),
    usage: state.usage,
    confirmationRequests: [] as const,
    session: sessionExecutionRefs(state),
  };
}

function sessionExecutionRefs(state: AgentSessionExecutionState) {
  const entry = (entryId: string) => ({ sessionId: state.sessionId, entryId });
  return {
    sessionId: state.sessionId,
    startLeafRef: state.startLeafEntryId === null ? null : entry(state.startLeafEntryId),
    ...(state.inputEntryId === undefined ? {} : { inputEntryRef: entry(state.inputEntryId) }),
    safeLeafRef: state.safeLeafEntryId === null ? null : entry(state.safeLeafEntryId),
    latestLeafRef: state.latestLeafEntryId === null ? null : entry(state.latestLeafEntryId),
    compactionEntryRefs: state.compactionEntryIds.map(entry),
  };
}

async function abortRun(state: AgentSessionExecutionState): Promise<void> {
  try {
    await state.abortRun?.();
  } catch {
    // The owning resource lease reports cleanup failures without replacing the primary run outcome.
  }
}

type ResolvedToolApproval =
  | { readonly kind: "approved"; readonly abortSignal: AbortSignal }
  | { readonly kind: "denied"; readonly result: ToolCallResult }
  | { readonly kind: "cancelled"; readonly result: ToolCallResult }
  | { readonly kind: "delivery_failure"; readonly response: ReturnType<typeof harnessToolResult> };

async function resolveApproval(
  input: AgentLoopInput,
  state: AgentSessionExecutionState,
  approval: ToolCallResult & { readonly status: "approval_required" },
  context: ReturnType<typeof toolExecutionContext>,
): Promise<ResolvedToolApproval> {
  const deliveryFailure = await acceptToolResultForDelivery(input, state, approval);
  if (deliveryFailure !== undefined) {
    return { kind: "delivery_failure", response: deliveryFailure };
  }
  let resolution: ApprovalResolution;
  try {
    resolution = await state.approvals.request(approval, context.abortSignal);
  } catch (error) {
    if (!context.abortSignal.aborted && !input.abortSignal.aborted) throw error;
    const cancelled = cancelledApprovalResult(approval, error);
    const cancellationDeliveryFailure = await acceptToolResultForDelivery(input, state, cancelled);
    return cancellationDeliveryFailure === undefined
      ? { kind: "cancelled", result: cancelled }
      : { kind: "delivery_failure", response: cancellationDeliveryFailure };
  }
  if (resolution.decision.decision !== "approve_once") {
    const denied = deniedToolResult(approval, resolution.decision);
    const denialDeliveryFailure = await acceptToolResultForDelivery(input, state, denied);
    return denialDeliveryFailure === undefined
      ? { kind: "denied", result: denied }
      : { kind: "delivery_failure", response: denialDeliveryFailure };
  }
  return { kind: "approved", abortSignal: resolution.abortSignal };
}

class ApprovalDecisionCoordinator {
  private readonly pending = new Map<string, PendingApproval>();
  private change = deferred<void>();

  async request(
    result: ToolCallResult & { readonly status: "approval_required" },
    abortSignal: AbortSignal,
  ): Promise<ApprovalResolution> {
    if (abortSignal.aborted) throw abortReason(abortSignal);
    const confirmationId = requireConfirmationRequest(result).confirmationId;
    if (this.pending.has(confirmationId)) throw new Error(`Duplicate confirmation ${confirmationId}.`);
    const decision = deferred<ApprovalResolution>();
    this.pending.set(confirmationId, { result, decision });
    this.notifyChange();
    const handleAbort = (): void => {
      decision.reject(abortReason(abortSignal));
    };
    abortSignal.addEventListener("abort", handleAbort, { once: true });
    try {
      return await decision.promise;
    } finally {
      abortSignal.removeEventListener("abort", handleAbort);
      if (this.pending.get(confirmationId)?.decision === decision) {
        this.pending.delete(confirmationId);
        this.notifyChange();
      }
    }
  }

  requests(): ConfirmationRequest[] {
    return [...this.pending.values()].map((entry) =>
      globalThis.structuredClone(requireConfirmationRequest(entry.result)));
  }

  decide(decisions: readonly ConfirmationDecision[], abortSignal: AbortSignal): void {
    const unique = new Map(decisions.map((decision) => [decision.confirmationId, decision]));
    if (unique.size !== decisions.length || [...unique.keys()].some((id) => !this.pending.has(id))) {
      throw new Error("Agent loop confirmation decisions do not match pending confirmations.");
    }
    for (const [id, decision] of unique) {
      const entry = this.pending.get(id)!;
      this.pending.delete(id);
      entry.decision.resolve({ kind: "resolved", decision, abortSignal });
    }
    this.notifyChange();
  }

  async wait(
    settle: () => Promise<AgentLoopResult>,
    approval: () => AgentLoopResult,
  ): Promise<AgentLoopResult> {
    if (this.pending.size > 0) return approval();
    const change = this.change.promise;
    return Promise.race([
      settle(),
      change.then(async () => {
        await Promise.resolve();
        return this.pending.size > 0 ? approval() : this.wait(settle, approval);
      }),
    ]);
  }

  private notifyChange(): void {
    const previous = this.change;
    this.change = deferred<void>();
    previous.resolve(undefined);
  }
}

async function acceptToolResult(
  input: AgentLoopInput,
  state: AgentSessionExecutionState,
  result: ToolCallResult,
): Promise<void> {
  const deliverable = toolResultForPiTransport(result);
  state.toolResults.set(toolCallFactId(deliverable), cloneToolResult(deliverable));
  try {
    await input.onToolResult?.(cloneToolResult(deliverable));
  } catch (error) {
    state.toolAcceptanceFailure ??= error;
    throw error;
  }
}

async function acceptToolResultForDelivery(
  input: AgentLoopInput,
  state: AgentSessionExecutionState,
  result: ToolCallResult,
) {
  try {
    await acceptToolResult(input, state, result);
    return undefined;
  } catch (error) {
    const failure = toolResultAcceptanceFailure(result, error);
    state.toolResults.set(toolCallFactId(failure), failure);
    return harnessToolResult(failure, true);
  }
}

function toolExecutionContext(
  input: AgentLoopInput,
  boundary: AgentLoopToolBoundary,
  request: ToolCallRequest,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<ToolExecutionDetails> | undefined,
) {
  return {
    ...boundary.context,
    toolCallId: toolCallFactId(request),
    abortSignal: signal ?? input.abortSignal,
    ...(input.onToolProgress === undefined ? {} : {
      reportProgress: (progress: Parameters<NonNullable<typeof input.onToolProgress>>[0]["progress"]) => {
        input.onToolProgress?.({
          callId: request.callId,
          ...(request.factId === undefined ? {} : { factId: request.factId }),
          toolName: request.toolName,
          progress,
        });
        onUpdate?.({
          content: [{ type: "text", text: "Tool progress updated." }],
          details: { kind: "progress" },
        });
      },
    }),
  };
}

/**
 * Approval continuation adds a decision-scoped signal; it must not replace the
 * run or Pi tool signal that was already governing the operation.
 */
function continuedToolAbortSignal(
  toolSignal: AbortSignal,
  runSignal: AbortSignal,
  decisionSignal: AbortSignal,
): AbortSignal {
  return AbortSignal.any([toolSignal, runSignal, decisionSignal]);
}

function validateDelegatedToolBoundary(
  parent: AgentLoopToolBoundary,
  agentTools: readonly AgentLoopAgentTool[],
  invocation: AgentLoopAgentToolInvocation,
): AgentLoopAgentToolInvocation {
  const parentAllowed = new Set(parent.permission.allowedTools);
  const delegatedNames = new Set(agentTools.map((tool) => tool.toolName));
  const requested = uniqueStrings(invocation.allowedTools);
  const unavailable = requested.filter((name) =>
    !parentAllowed.has(name) || !parent.gateway.has(name) || delegatedNames.has(name));
  if (unavailable.length > 0) {
    throw new Error(`Delegated agent requested tools outside the parent boundary: ${unavailable.join(", ")}`);
  }
  return { ...invocation, allowedTools: requested };
}

function requiredDelegatedAgentInput(request: ToolCallRequest): ToolFactValue {
  if (request.input === undefined) {
    throw new Error(`Delegated agent tool ${request.toolName} requires a JSON input value.`);
  }
  return request.input;
}

function delegatedToolBoundary(
  parent: AgentLoopToolBoundary,
  invocation: AgentLoopAgentToolInvocation,
): AgentLoopToolBoundary {
  return {
    gateway: parent.gateway,
    context: { ...parent.context, callerAgentId: invocation.callerAgentId },
    permission: {
      ...parent.permission,
      callerAgentId: invocation.callerAgentId,
      allowedTools: [...invocation.allowedTools],
    },
  };
}

function scopedDelegatedToolRequest(parentFactId: string, request: ToolCallRequest): ToolCallRequest {
  return {
    ...request,
    factId: delegatedToolFactId(parentFactId, request.callId),
    parentToolCallFactId: parentFactId,
  };
}

function delegatedToolFactId(parentFactId: string, providerCallId: string): string {
  return `agent-tool:${parentFactId.length}:${parentFactId}/tool:${providerCallId}`;
}

async function deliverDelegatedAgentResult(
  input: AgentLoopInput,
  gateway: DelegatedAgentResultGateway,
  result: ToolCallResult,
): Promise<ToolCallResult> {
  try {
    return await gateway.deliverResult.call(
      gateway,
      result,
      input.tools.permission,
      input.tools.context.traceId,
    );
  } catch (error) {
    return {
      ...result,
      output: undefined,
      status: "failed",
      error: `Delegated agent output could not be delivered: ${errorMessage(error)}`,
      errorDomain: "runtime_error",
      errorFacts: {
        code: "sub_agent_result_delivery_failed",
        sourceExecutionStatus: result.status,
        doNotBlindlyRetry: true,
      },
      confirmationRequest: undefined,
    };
  }
}

function requireDelegatedAgentResultGateway(
  gateway: AgentLoopToolBoundary["gateway"],
): DelegatedAgentResultGateway {
  if (gateway.deliverResult === undefined) {
    throw new Error("Delegated agent tools require a gateway with complete result delivery.");
  }
  return gateway as DelegatedAgentResultGateway;
}

function delegatedAgentFailure(
  request: ToolCallRequest,
  error: unknown,
  cancelled: boolean,
  startedAt: number,
  metrics?: DelegatedAgentExecutionMetrics,
): ToolCallResult {
  return {
    ...request,
    output: undefined,
    status: cancelled ? "cancelled" : "failed",
    error: cancelled
      ? `Delegated agent was cancelled: ${abortMessage(error)}`
      : `Delegated agent failed: ${errorMessage(error)}`,
    errorDomain: cancelled ? "runtime_error" : "model_error",
    errorFacts: { code: cancelled ? "sub_agent_cancelled" : "sub_agent_execution_failed" },
    ...(metrics === undefined ? {} : { delegatedExecution: delegatedExecutionMetadata(metrics) }),
    durationMs: Math.max(0, Date.now() - startedAt),
  };
}

function delegatedExecutionMetadata(metrics: DelegatedAgentExecutionMetrics) {
  return {
    modelRounds: metrics.modelRounds,
    toolCallCount: metrics.toolCallCount,
    usage: globalThis.structuredClone(metrics.usage),
  };
}

function assertUniqueToolNames(tools: readonly AgentTool[]): void {
  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.name)) throw new Error(`Agent session tool name is duplicated: ${tool.name}`);
    names.add(tool.name);
  }
}

function bindRunAbortSignal(state: AgentSessionExecutionState, signal: AbortSignal): void {
  const abort = (): void => { void state.abortRun?.().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  const cleanup = (): void => signal.removeEventListener("abort", abort);
  state.abortSignalCleanups.add(cleanup);
  if (signal.aborted) abort();
}

function clearRunAbortSignals(state: AgentSessionExecutionState): void {
  for (const cleanup of state.abortSignalCleanups) cleanup();
  state.abortSignalCleanups.clear();
}

function harnessToolResult(result: ToolCallResult, terminate = false) {
  const deliverable = toolResultForPiTransport(result);
  const message = canonicalToolResultMessage(deliverable);
  const imageContent = toolResultImageContentFromAttachments(message.attachments);
  return {
    content: [{ type: "text" as const, text: message.content }, ...imageContent],
    details: { kind: "result" as const, result: cloneToolResult(deliverable) },
    ...(terminate || deliverable.errorFacts?.code === "tool_result_attachment_not_supported"
      ? { terminate: true }
      : {}),
  };
}

function toolResultForPiTransport(result: ToolCallResult): ToolCallResult {
  const attachments = toolModelAttachmentsFromOutput(result.output);
  const unsupported = attachments?.find((attachment) =>
    attachment.kind !== "image" || attachment.source.kind !== "data"
  );
  if (unsupported === undefined) return result;
  return {
    ...result,
    status: "failed",
    error: `Tool result could not be delivered to the Pi model because ${unsupported.kind} attachments are unsupported by the active model transport.`,
    errorDomain: "runtime_error",
    errorFacts: {
      ...(result.errorFacts ?? {}),
      code: "tool_result_attachment_not_supported",
      sourceExecutionStatus: result.status,
      doNotBlindlyRetry: true,
      outputDeliveryPhase: "model_transport",
      attachmentKind: unsupported.kind,
      attachmentSource: unsupported.source.kind,
    },
    confirmationRequest: undefined,
  };
}

function deniedToolResult(
  approval: ToolCallResult & { readonly status: "approval_required" },
  decision: ConfirmationDecision,
): ToolCallResult {
  const guidance = decision.decision === "guidance" ? decision.guidance?.trim() : undefined;
  return {
    ...approval,
    status: "failed",
    error: guidance === undefined || guidance.length === 0
      ? "User rejected this tool call."
      : `User rejected this tool call with guidance: ${guidance}`,
    errorDomain: "tool_error",
    errorFacts: { code: decision.decision === "guidance" ? "tool_call_guidance" : "tool_call_denied" },
    confirmationRequest: undefined,
  };
}

function cancelledApprovalResult(
  approval: ToolCallResult & { readonly status: "approval_required" },
  reason: unknown,
): ToolCallResult {
  return {
    ...approval,
    status: "cancelled",
    error: `Tool call was cancelled while awaiting confirmation: ${abortMessage(reason)}`,
    errorDomain: "tool_error",
    errorFacts: { code: "tool_call_cancelled" },
    confirmationRequest: undefined,
  };
}

function toolResultAcceptanceFailure(result: ToolCallResult, error: unknown): ToolCallResult {
  return {
    ...result,
    output: undefined,
    status: "failed",
    error: `The owning feature could not accept this tool result: ${errorMessage(error)}`,
    errorDomain: "runtime_error",
    errorFacts: {
      code: "tool_result_acceptance_failed",
      sourceExecutionStatus: result.status,
      doNotBlindlyRetry: true,
    },
    confirmationRequest: undefined,
  };
}

function requireConfirmationRequest(result: ToolCallResult): ConfirmationRequest {
  if (result.confirmationRequest === undefined) {
    throw new Error(`Approval-required tool result ${toolCallFactId(result)} is missing its confirmation request.`);
  }
  return result.confirmationRequest;
}

function requireApprovalRequiredResult(
  result: ToolCallResult,
): ToolCallResult & { readonly status: "approval_required" } {
  if (result.status !== "approval_required") {
    throw new Error(`Expected an approval-required tool result, received ${result.status}.`);
  }
  return result as ToolCallResult & { readonly status: "approval_required" };
}

function toolRequestFromResult(result: ToolCallResult): ToolCallRequest {
  return {
    callId: result.callId,
    ...(result.factId === undefined ? {} : { factId: result.factId }),
    ...(result.parentToolCallFactId === undefined ? {} : { parentToolCallFactId: result.parentToolCallFactId }),
    toolName: result.toolName,
    input: result.input,
  };
}

function toolResultFromDetails(details: unknown): ToolCallResult | undefined {
  if (typeof details !== "object" || details === null || !("kind" in details)) return undefined;
  const candidate = details as ToolExecutionDetails;
  return candidate.kind === "result" ? candidate.result : undefined;
}

function emitToolRequested(input: AgentLoopInput, request: ToolCallRequest): void {
  try {
    input.onToolRequested?.(globalThis.structuredClone(request));
  } catch {
    // Requested activity is observational and cannot change execution.
  }
}

function modelMessageFromAssistant(message: AssistantMessage): ModelMessage {
  const text = message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
  const toolCalls = message.content
    .filter((block) => block.type === "toolCall")
    .map((call) => ({ callId: call.id, toolName: call.name, input: normalizeToolFactValue(call.arguments) }));
  return {
    role: "assistant",
    content: text,
    ...(toolCalls.length === 0 ? {} : { toolCalls }),
  };
}

function imageContentFromAttachments(attachments: readonly ModelInputAttachment[] | undefined): ImageContent[] {
  return (attachments ?? []).map((attachment) => {
    if (attachment.kind !== "image" || attachment.source.kind !== "data") {
      throw new Error(`Agent loop cannot persist ${attachment.kind} attachment ${attachment.attachmentId ?? "unknown"}.`);
    }
    return { type: "image", mimeType: attachment.source.mimeType, data: attachment.source.data };
  });
}

function toolResultImageContentFromAttachments(
  attachments: readonly ModelInputAttachment[] | undefined,
): ImageContent[] {
  return (attachments ?? [])
    .flatMap((attachment) => {
      if (attachment.kind !== "image" || attachment.source.kind !== "data") return [];
      return [{
        type: "image" as const,
        mimeType: attachment.source.mimeType,
        data: attachment.source.data,
      }];
    });
}

function assistantText(message: AssistantMessage): string {
  return message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
}

function modelUsageFromProvider(usage: Usage): ModelUsage {
  return {
    requestCount: 1,
    inputTokens: usage.input + usage.cacheRead,
    outputTokens: usage.output,
    totalTokens: usage.totalTokens,
    cachedInputTokens: usage.cacheRead,
    cacheWriteInputTokens: usage.cacheWrite,
    uncachedInputTokens: usage.input,
    ...(usage.reasoning === undefined ? {} : { reasoningOutputTokens: usage.reasoning }),
    estimatedCostUsd: usage.cost.total,
    latestAgentRequest: {
      inputTokens: usage.input + usage.cacheRead,
      outputTokens: usage.output,
      totalTokens: usage.totalTokens,
      cachedInputTokens: usage.cacheRead,
      cacheWriteInputTokens: usage.cacheWrite,
      uncachedInputTokens: usage.input,
      ...(usage.reasoning === undefined ? {} : { reasoningOutputTokens: usage.reasoning }),
    },
  };
}

function mergeUsage(
  current: ModelUsage,
  next: ModelUsage | undefined,
  options: { readonly preserveLatestAgentRequest?: boolean } = {},
): ModelUsage {
  if (next === undefined) return current;
  return {
    requestCount: (current.requestCount ?? 0) + (next.requestCount ?? 0),
    inputTokens: (current.inputTokens ?? 0) + (next.inputTokens ?? 0),
    outputTokens: (current.outputTokens ?? 0) + (next.outputTokens ?? 0),
    totalTokens: (current.totalTokens ?? 0) + (next.totalTokens ?? 0),
    cachedInputTokens: (current.cachedInputTokens ?? 0) + (next.cachedInputTokens ?? 0),
    cacheWriteInputTokens: (current.cacheWriteInputTokens ?? 0) + (next.cacheWriteInputTokens ?? 0),
    uncachedInputTokens: (current.uncachedInputTokens ?? 0) + (next.uncachedInputTokens ?? 0),
    reasoningOutputTokens: (current.reasoningOutputTokens ?? 0) + (next.reasoningOutputTokens ?? 0),
    estimatedCostUsd: (current.estimatedCostUsd ?? 0) + (next.estimatedCostUsd ?? 0),
    latestAgentRequest: options.preserveLatestAgentRequest
      ? current.latestAgentRequest
      : next.latestAgentRequest ?? current.latestAgentRequest,
  };
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function cloneModelMessage(message: ModelMessage): ModelMessage {
  return globalThis.structuredClone(message);
}

function cloneToolResult(result: ToolCallResult): ToolCallResult {
  return globalThis.structuredClone(result);
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function sameIds(expected: readonly string[], actual: readonly string[]): boolean {
  if (expected.length !== actual.length) return false;
  const actualIds = new Set(actual);
  return actualIds.size === actual.length && expected.every((id) => actualIds.has(id));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Agent loop was cancelled.", "AbortError");
}

function abortMessage(reason: unknown): string {
  return reason === undefined ? "cancelled" : errorMessage(reason);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isRecord(value: unknown): value is Record<string, ToolFactValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
