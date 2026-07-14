import type { ConfirmationDecision, ConfirmationRequest } from "../../domain/confirmation/index.js";
import type { ModelMessage, ModelUsage } from "../../domain/intelligence/index.js";
import type {
  ToolCallResult,
  ToolExecutionContext,
  ToolExecutionGateway,
  ToolFactValue,
  ToolInputSchema,
  ToolPermissionCheck,
} from "../../domain/tools/index.js";

export type AgentLoopToolBoundary = {
  readonly gateway: ToolExecutionGateway;
  readonly context: ToolExecutionContext;
  readonly permission: ToolPermissionCheck;
};

/** One feature-owned specialist exposed to the parent model as a tool. */
export type AgentLoopAgentToolInvocation = {
  readonly agentName: string;
  readonly instructions: string;
  readonly input: string;
  readonly callerAgentId: string;
  readonly allowedTools: readonly string[];
};

/**
 * Provider-neutral agents-as-tools contribution. The model adapter owns the nested
 * model loop; the contributing feature owns definition lookup and permission narrowing.
 */
export type AgentLoopAgentTool = {
  readonly toolName: string;
  readonly toolDescription: string;
  readonly inputSchema: ToolInputSchema;
  resolve(input: ToolFactValue): Promise<AgentLoopAgentToolInvocation>;
};

export type AgentLoopInput = {
  readonly instructions: string;
  readonly messages: readonly ModelMessage[];
  readonly tools: AgentLoopToolBoundary;
  readonly agentTools?: readonly AgentLoopAgentTool[];
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
