import type { ModelCapabilities } from "../../domain/config/index.js";
import type { IntelligenceChannel, ModelMessage } from "../../domain/intelligence/index.js";
import type { ToolDefinition } from "../../domain/tools/index.js";

export type AgentLoopTokenCounter = {
  readonly source: "openai_tiktoken";
  readonly model: string;
  countText(text: string): number;
  countMessage(message: ModelMessage): number;
  countMessages(messages: readonly ModelMessage[]): number;
};

export type AgentLoopContextSummary = {
  readonly summaryId: string;
  readonly summary: string;
  readonly coveredRefs: readonly string[];
  readonly modelRequestId: string;
  readonly modelResponseId?: string;
};

export type AgentLoopContextMaintenanceResult =
  | {
      readonly status: "unchanged";
      readonly tokenCount: number;
      readonly threshold: number;
    }
  | {
      readonly status: "compacted";
      readonly tokenCount: number;
      readonly threshold: number;
      readonly messages: readonly ModelMessage[];
      readonly conversationSummary: AgentLoopContextSummary;
    }
  | {
      readonly status: "failed";
      readonly tokenCount: number;
      readonly threshold: number;
      readonly message: string;
      readonly requestId?: string;
      readonly responseId?: string;
    };

export type MaintainAgentLoopContextInput = {
  readonly goal: string;
  readonly traceId: string;
  readonly goalId: string;
  readonly agentIdentity?: {
    readonly agentId: string;
    readonly displayName: string;
  };
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ToolDefinition[];
  readonly intelligenceChannel: IntelligenceChannel;
  readonly modelCapabilities?: ModelCapabilities;
  readonly tokenCounter?: AgentLoopTokenCounter;
  readonly thresholdRatio?: number;
  readonly preserveRecentMessages?: number;
};
