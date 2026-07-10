import { FakeModelProvider } from "../../adapters/intelligence/fake-model-provider.js";
import type { FakeModelProviderResponse } from "../../adapters/intelligence/fake-model-provider-contracts.js";
import type { ModelRequest, ModelResponse } from "../../domain/intelligence/contracts.js";
import { createTaskSoil } from "../../domain/soil/task-soil.js";
import { InMemoryEventLog } from "../../kernel/events/in-memory-event-log.js";
import { NativeIntelligenceChannel } from "../../kernel/intelligence/channel.js";
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
  responses?: readonly FakeModelProviderResponse[],
): import("./deep-run-executor.js").DeepRunExecutorConfig {
  return makeTurnRuntimeForProvider(new FakeModelProvider({ responses }));
}

export function makeTurnRuntimeForProvider(
  provider: FakeModelProvider,
): import("./deep-run-executor.js").DeepRunExecutorConfig {
  const channel = new NativeIntelligenceChannel({
    provider,
    bus: new InMemoryMessageBus(new InMemoryEventLog()),
  });
  return { turnRuntime: createDeepTurnRuntime({ intelligenceChannel: channel }) };
}

export class CapturingFakeModelProvider extends FakeModelProvider {
  readonly requests: ModelRequest[] = [];

  override async complete(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    return super.complete(request);
  }
}
