import type { ModelCapabilities } from "../../domain/config/index.js";
import type { IntelligenceChannel, ModelMessage } from "../../domain/intelligence/index.js";
import type { ToolDefinition } from "../../domain/tools/index.js";
import type { DesktopAgentConversationMessage } from "../desktop-agent-contracts.js";
import type { BasicAgentTokenCounter } from "./token-counter.js";

export type BasicAgentConversationSummary = {
  readonly summaryId: string;
  readonly summary: string;
  readonly coveredRefs: readonly string[];
  readonly modelRequestId: string;
  readonly modelResponseId?: string;
};

export type BasicAgentCompactionAgentIdentity = {
  readonly agentId: string;
  readonly displayName: string;
};

export type BasicAgentLoopContextCompactionResult =
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
      readonly conversationSummary: BasicAgentConversationSummary;
    }
  | {
      readonly status: "failed";
      readonly tokenCount: number;
      readonly threshold: number;
      readonly message: string;
      readonly requestId?: string;
      readonly responseId?: string;
    };

export type CompactBasicAgentLoopContextInput = {
  readonly goal: string;
  readonly traceId: string;
  readonly goalId: string;
  readonly agentIdentity?: BasicAgentCompactionAgentIdentity;
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ToolDefinition[];
  readonly intelligenceChannel: IntelligenceChannel;
  readonly modelCapabilities?: ModelCapabilities;
  readonly tokenCounter?: BasicAgentTokenCounter;
  readonly thresholdRatio?: number;
  readonly preserveRecentMessages?: number;
};

export type BasicAgentConversationCompactionResult = {
  readonly conversationHistory: readonly DesktopAgentConversationMessage[];
  readonly conversationSummary?: BasicAgentConversationSummary;
  readonly compacted: boolean;
  readonly failed?: {
    readonly message: string;
    readonly requestId?: string;
    readonly responseId?: string;
  };
};

export type CompactBasicAgentConversationInput = {
  readonly goal: string;
  readonly traceId: string;
  readonly goalId: string;
  readonly agentIdentity?: BasicAgentCompactionAgentIdentity;
  readonly conversationHistory: readonly DesktopAgentConversationMessage[];
  readonly intelligenceChannel: IntelligenceChannel;
  readonly modelCapabilities?: ModelCapabilities;
  readonly tokenCounter?: BasicAgentTokenCounter;
  readonly thresholdRatio?: number;
  readonly recentPairs?: number;
};
