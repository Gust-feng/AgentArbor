import type { IntelligenceChannel } from "../domain/intelligence/index.js";
import type { ToolExecutionBroker } from "../domain/tools/index.js";
import { AgentTurnRuntime } from "../kernel/intelligence/index.js";
import type { MinimalRuntime } from "./runtime.js";
import {
  UndergroundAgentRunner,
  UndergroundAgentRunnerError,
  type UndergroundAgentRunnerResult,
} from "./underground/cluster/agent-runner.js";

export class UndergroundMessageDispatcherError extends UndergroundAgentRunnerError {
  constructor(message: string) {
    super(message);
    this.name = "UndergroundMessageDispatcherError";
  }
}

export type MessageDrivenUndergroundDispatcherOptions = {
  readonly runtime: MinimalRuntime;
  readonly intelligenceChannel?: IntelligenceChannel;
  readonly toolCenter?: ToolExecutionBroker;
  readonly maxDispatchSteps?: number;
};

export type UndergroundMessageDrivenDispatchResult = UndergroundAgentRunnerResult;

export class MessageDrivenUndergroundDispatcher {
  private readonly runner: UndergroundAgentRunner;

  constructor(options: MessageDrivenUndergroundDispatcherOptions) {
    this.runner = new UndergroundAgentRunner({
      ...options,
      agentTurnRuntime:
        options.intelligenceChannel === undefined
          ? undefined
          : new AgentTurnRuntime({
              intelligenceChannel: options.intelligenceChannel,
              toolCenter: options.toolCenter,
              publishToolEvent: (event) => options.runtime.bus.publish(event),
            }),
    });
  }

  dispose(): void {
    this.runner.dispose();
  }

  dispatchUntilIdle(): UndergroundMessageDrivenDispatchResult | undefined {
    try {
      return this.runner.dispatchUntilIdle();
    } catch (error) {
      throw asDispatcherError(error);
    }
  }

  dispatchUntilIdleAsync(): Promise<UndergroundMessageDrivenDispatchResult | undefined> {
    return this.runner.dispatchUntilIdleAsync().catch((error: unknown) => {
      throw asDispatcherError(error);
    });
  }
}

function asDispatcherError(error: unknown): unknown {
  if (error instanceof Error && error.name.startsWith("Underground")) {
    return new UndergroundMessageDispatcherError(error.message);
  }
  return error;
}
