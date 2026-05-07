import type { ArborMessage } from "../domain/common.js";
import type { IntelligenceChannel } from "../domain/intelligence/index.js";
import type { ToolExecutionBroker } from "../domain/tools/index.js";
import { AgentTurnRuntime } from "../kernel/intelligence/index.js";
import type { MinimalRuntime } from "./runtime.js";
import {
  UndergroundAgentOrchestrator,
  UndergroundAgentOrchestratorError,
  type UndergroundAgentOrchestratorResult,
} from "./underground/orchestrator.js";

export class UndergroundMessageDispatcherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UndergroundMessageDispatcherError";
  }
}

export type MessageDrivenUndergroundDispatcherOptions = {
  readonly runtime: MinimalRuntime;
  readonly intelligenceChannel?: IntelligenceChannel;
  readonly toolCenter?: ToolExecutionBroker;
  readonly enableAutonomy?: boolean;
  readonly maxAutonomyCycles?: number;
  readonly maxDispatchSteps?: number;
};

export type UndergroundMessageDrivenDispatchResult = UndergroundAgentOrchestratorResult;

export class MessageDrivenUndergroundDispatcher {
  private readonly processedMessageIds = new Set<string>();

  constructor(private readonly options: MessageDrivenUndergroundDispatcherOptions) {}

  dispose(): void {}

  dispatchUntilIdle(): UndergroundMessageDrivenDispatchResult | undefined {
    if (this.options.intelligenceChannel !== undefined) {
      throw new UndergroundMessageDispatcherError("dispatchUntilIdleAsync is required when an intelligence channel is configured.");
    }
    const message = this.nextGoalMessage();
    if (message === undefined) {
      return undefined;
    }
    if ((this.options.maxDispatchSteps ?? Number.POSITIVE_INFINITY) <= 1) {
      throw new UndergroundMessageDispatcherError(`Message dispatcher exceeded maxDispatchSteps=${this.options.maxDispatchSteps}.`);
    }
    throw new UndergroundMessageDispatcherError("Synchronous underground dispatch is only supported for idle checks; use dispatchUntilIdleAsync for a full run.");
  }

  async dispatchUntilIdleAsync(): Promise<UndergroundMessageDrivenDispatchResult | undefined> {
    const message = this.nextGoalMessage();
    if (message === undefined) {
      return undefined;
    }
    try {
      const result = await this.createOrchestrator().runAsync(message);
      this.processedMessageIds.add(message.id);
      return { ...result, processedMessageIds: [message.id] };
    } catch (error) {
      throw asDispatcherError(error);
    }
  }

  private nextGoalMessage(): ArborMessage<{ readonly goalId: string; readonly goal: string }> | undefined {
    const messages = this.options.runtime.bus
      .getMessages("goal.received")
      .filter((message): message is ArborMessage<{ readonly goalId: string; readonly goal: string }> =>
        !this.processedMessageIds.has(message.id) && isGoalPayload(message.payload)
      );
    if (messages.length === 0) {
      const laterStage = this.options.runtime.bus.getMessages().find((message) => message.type !== "goal.received");
      if (laterStage !== undefined) {
        throw new UndergroundMessageDispatcherError("Cannot dispatch underground stage message without a prior goal.received context.");
      }
      return undefined;
    }
    const [first] = messages;
    return first;
  }

  private createOrchestrator(): UndergroundAgentOrchestrator {
    const agentTurnRuntime = this.options.intelligenceChannel === undefined
      ? undefined
      : new AgentTurnRuntime({
          intelligenceChannel: this.options.intelligenceChannel,
          toolCenter: this.options.toolCenter,
          publishToolEvent: (event) => this.options.runtime.bus.publish(event),
        });
    return new UndergroundAgentOrchestrator({
      runtime: this.options.runtime,
      intelligenceChannel: this.options.intelligenceChannel,
      toolCenter: this.options.toolCenter,
      agentTurnRuntime,
      enableAutonomy: this.options.enableAutonomy,
      maxAutonomyCycles: this.options.maxAutonomyCycles,
    });
  }
}

function isGoalPayload(value: unknown): value is { readonly goalId: string; readonly goal: string } {
  return typeof value === "object" && value !== null &&
    typeof (value as { goalId?: unknown }).goalId === "string" &&
    typeof (value as { goal?: unknown }).goal === "string";
}

function asDispatcherError(error: unknown): unknown {
  if (error instanceof UndergroundMessageDispatcherError) {
    return error;
  }
  if (error instanceof UndergroundAgentOrchestratorError || (error instanceof Error && error.name.startsWith("Underground"))) {
    return new UndergroundMessageDispatcherError(error.message);
  }
  return error;
}
