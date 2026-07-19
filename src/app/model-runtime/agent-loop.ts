import type { ConfirmationDecision, ConfirmationRequest } from "../../domain/confirmation/index.js";
import type { ModelMessage, ModelUsage } from "../../domain/intelligence/index.js";
import type {
  ToolCallResult,
  ToolCallProgress,
  ToolCallRequest,
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
  /** Provider-normalized visible reasoning text for the active model turn. */
  readonly onReasoningDelta?: (delta: string) => void;
  /** Authoritative complete reasoning text observed at the model response boundary. */
  readonly onReasoningCompleted?: (content: string) => Promise<void>;
  /** Emitted once when an exact tool request enters its execution boundary. */
  readonly onToolRequested?: (request: ToolCallRequest) => void;
  /** Live-only bounded progress emitted by the active tool executor. */
  readonly onToolProgress?: (progress: ToolCallProgress) => void;
  /** Resolves only after the owning feature has durably accepted the executed tool fact. */
  readonly onToolResult?: (result: ToolCallResult) => Promise<void>;
  /** Resolves before the SDK may preflight or execute any tool from this validated root turn. */
  readonly onToolRound?: (input: {
    /** Exact canonical prefix consumed by the provider for this tool-producing turn. */
    readonly canonicalMessagesBeforeRound: readonly ModelMessage[];
    readonly assistantMessage: ModelMessage;
  }) => Promise<void>;
  /** Runs immediately before every provider request with the exact canonical request history. */
  readonly maintainContext?: (input: {
    readonly messages: readonly ModelMessage[];
    /** True when this request contains tool results the main model has not consumed. */
    readonly hasUnseenToolResults: boolean;
    readonly abortSignal: AbortSignal;
  }) => Promise<
    | { readonly status: "unchanged" }
    | { readonly status: "compacted"; readonly messages: readonly ModelMessage[] }
    | { readonly status: "failed"; readonly code: string; readonly error: string }
  >;
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
  /** Cumulative usage for this execute/continuation chain, not a per-resume delta. */
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
      /** Stable mechanical failure classification when the adapter can prove one. */
      readonly errorCode?: string;
    });

/** Mechanical model-tool-model execution. Business completion remains feature-owned. */
export interface AgentLoop {
  execute(input: AgentLoopInput): Promise<AgentLoopResult>;
  release(): Promise<void>;
}
