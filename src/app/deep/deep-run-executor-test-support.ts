import type { ModelProvider, ModelRequest, ModelResponse, ModelToolCall } from "../../domain/intelligence/contracts.js";
import { createTaskSoil } from "../../domain/soil/task-soil.js";
import { InMemoryEventLog } from "../../kernel/events/in-memory-event-log.js";
import { NativeIntelligenceChannel } from "../../kernel/intelligence/channel.js";
import { createFailedModelResponse } from "../../kernel/intelligence/failures.js";
import { pendingModelOutputValidation } from "../../kernel/intelligence/validation.js";
import { createId, nowIso } from "../../kernel/id.js";
import { InMemoryMessageBus } from "../../kernel/messages/in-memory-message-bus.js";
import {
  DEEP_RUN_KIND,
  DEEP_RUN_MODE,
  type DeepConversation,
  type DeepRun,
} from "./contracts.js";
import { createDeepConversationIsolationMark } from "./deep-conversation.js";
import { createDeepTurnRuntime } from "./deep-turn.js";

export { startDeepRun } from "./deep-run-executor.js";
export type { DeepRunExecutorConfig, StartDeepRunInput } from "./deep-run-executor.js";

export type SequenceModelProviderResponse = {
  readonly output?: unknown;
  readonly textOutput?: string;
  readonly toolCalls?: readonly ModelToolCall[];
  readonly fail?: boolean;
  readonly failureMessage?: string;
};

export function makeDeepConversation(goal: string): DeepConversation {
  const now = new Date().toISOString();
  return {
    conversationId: "conv-test-deep",
    title: goal.slice(0, 40),
    goal,
    isolation: createDeepConversationIsolationMark(),
    permissionBoundaryRefs: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function makeDeepRun(goal: string): DeepRun {
  const now = new Date().toISOString();
  return {
    runId: "run-test-deep",
    conversationId: "conv-test-deep",
    goal,
    status: "running",
    isolation: {
      kind: "deep_conversation",
      runKind: DEEP_RUN_KIND,
      runMode: DEEP_RUN_MODE,
    },
    startedAt: now,
    updatedAt: now,
  };
}

export function makeStartInput(goal: string, modelAvailable: boolean): import("./deep-run-executor.js").StartDeepRunInput {
  return {
    run: makeDeepRun(goal),
    conversation: makeDeepConversation(goal),
    taskSoil: createTaskSoil({ rawGoal: goal }),
    permissionBoundaryRefs: [],
    modelAvailable,
    traceId: "trace-test-deep",
    goalId: "goal-test-deep",
  };
}

export function makeTurnRuntime(
  responses?: readonly SequenceModelProviderResponse[],
): import("./deep-run-executor.js").DeepRunExecutorConfig {
  return makeTurnRuntimeForProvider(new SequenceModelProvider(responses));
}

export function makeTurnRuntimeForProvider(
  provider: ModelProvider,
): import("./deep-run-executor.js").DeepRunExecutorConfig {
  const channel = new NativeIntelligenceChannel({
    provider,
    bus: new InMemoryMessageBus(new InMemoryEventLog()),
  });
  return { turnRuntime: createDeepTurnRuntime({ intelligenceChannel: channel }) };
}

class SequenceModelProvider implements ModelProvider {
  readonly providerId = "deep-sequence-provider";
  readonly providerKind = "fake" as const;
  readonly protocolKind = "openai_compatible_chat_completions" as const;
  readonly model = "deep-sequence-model";
  private index = 0;

  constructor(private readonly responses: readonly SequenceModelProviderResponse[] = []) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const response = this.responses[this.index++] ?? {};
    if (response.fail) {
      return createFailedModelResponse({
        requestId: request.requestId,
        providerId: this.providerId,
        providerKind: this.providerKind,
        protocolKind: this.protocolKind,
        model: this.model,
        outputKind: request.outputContract.outputKind,
        failureKind: "provider_response",
        message: response.failureMessage ?? "Sequence provider was configured to fail.",
      });
    }
    return {
      responseId: createId("model-response"),
      requestId: request.requestId,
      providerId: this.providerId,
      providerKind: this.providerKind,
      protocolKind: this.protocolKind,
      model: this.model,
      status: "completed",
      outputKind: request.outputContract.outputKind,
      structuredOutput: response.output,
      textOutput: response.textOutput,
      toolCalls: response.toolCalls?.map((call) => ({ ...call, input: globalThis.structuredClone(call.input) })),
      finishReason: response.toolCalls === undefined || response.toolCalls.length === 0 ? "stop" : "tool_call",
      validation: pendingModelOutputValidation(),
      completedAt: nowIso(),
    };
  }
}

export class CapturingFakeModelProvider extends SequenceModelProvider {
  readonly requests: ModelRequest[] = [];

  constructor(options: { readonly responses?: readonly SequenceModelProviderResponse[] } = {}) {
    super(options.responses);
  }

  override async complete(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    return super.complete(request);
  }
}
