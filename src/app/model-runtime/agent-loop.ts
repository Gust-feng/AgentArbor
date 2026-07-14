import type { ConfirmationDecision, ConfirmationRequest } from "../../domain/confirmation/index.js";
import type { ModelMessage, ModelUsage } from "../../domain/intelligence/index.js";
import type {
  ToolCallResult,
  ToolExecutionContext,
  ToolExecutionGateway,
  ToolPermissionCheck,
} from "../../domain/tools/index.js";

export type AgentLoopToolBoundary = {
  readonly gateway: ToolExecutionGateway;
  readonly context: ToolExecutionContext;
  readonly permission: ToolPermissionCheck;
};

export type AgentLoopInput = {
  readonly instructions: string;
  readonly messages: readonly ModelMessage[];
  readonly tools: AgentLoopToolBoundary;
  readonly abortSignal: AbortSignal;
  readonly onTextDelta?: (delta: string) => void;
};

export type AgentLoopContinuation = {
  readonly availability: "live_only";
  decide(input: ({
    readonly decision: ConfirmationDecision;
  } | {
    readonly decisions: readonly ConfirmationDecision[];
  }) & {
    readonly abortSignal: AbortSignal;
  }): Promise<AgentLoopResult>;
};

type AgentLoopResultFacts = {
  readonly messages: readonly ModelMessage[];
  readonly toolResults: readonly ToolCallResult[];
  readonly usage: ModelUsage;
  readonly confirmationRequests: readonly ConfirmationRequest[];
};

export type AgentLoopResult =
  | (AgentLoopResultFacts & {
      readonly status: "completed";
      readonly finalText: string;
    })
  | (AgentLoopResultFacts & {
      readonly status: "approval_required";
      readonly continuation: AgentLoopContinuation;
    })
  | (AgentLoopResultFacts & {
      readonly status: "cancelled";
      readonly error?: string;
    })
  | (AgentLoopResultFacts & {
      readonly status: "failed";
      readonly error: string;
    });

/** Mechanical model-tool-model execution. Business completion remains feature-owned. */
export interface AgentLoop {
  execute(input: AgentLoopInput): Promise<AgentLoopResult>;
  release(): Promise<void>;
}
